"""The `episodes` index: settings, writes, and the search entry point.

🚨 Write functions are graceful by default (log and no-op when Meilisearch is
down) and strict on demand. Pass `strict=True` from a Celery task so the task
retries; leave it False anywhere a user is waiting on a response.

🚨 Indexing belongs in Celery tasks, never inline in a request. These functions
are written to be called by a task - see the module docstring in reindex.py for
the wrappers `podcast/tasks.py` needs.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Iterable, Sequence
from typing import Any

from django.db.models import QuerySet

from podcast.models import Episode

from .client import (
    EPISODES_INDEX,
    SEARCH_ERRORS,
    get_client,
    get_index,
    graceful,
    is_available,
    wait_for_task,
)
from .documents import build_document, build_documents, episode_index_queryset

logger = logging.getLogger(__name__)

PRIMARY_KEY = "id"

# ---------------------------------------------------------------------------
# Index settings
# ---------------------------------------------------------------------------

# Order matters: Meilisearch ranks a hit higher when the match lands in an
# earlier attribute. Title first, then the COMMUNITY labels - those are the
# whole reason this app exists, because YouTube cannot search them. Description
# is last: on the probed channel it averages 118 chars and is mostly links.
SEARCHABLE_ATTRIBUTES: list[str] = [
    "title",
    "topics",
    "moments",
    "participants",
    "channel_name",
    "description",
]

FILTERABLE_ATTRIBUTES: list[str] = [
    "channel_id",
    "channel_slug",
    "content_kind",
    "availability",
    "members_only",
    "language",
    "topics",
    "topic_slugs",
    "participants",
    "participant_slugs",
    "upload_date",
    "upload_year",
    "duration_sec",
    "public_score",
    "elite_score",
    "rating_count",
]

SORTABLE_ATTRIBUTES: list[str] = [
    "upload_date",
    "public_score",
    "elite_score",
    "duration_sec",
    "rating_count",
    "view_count",
]

# The six defaults in the default order, plus two tie-breakers. Equally relevant
# episodes then fall back to "better rated" and "more recent" instead of an
# arbitrary internal order.
RANKING_RULES: list[str] = [
    "words",
    "typo",
    "proximity",
    "attribute",
    "sort",
    "exactness",
    "public_score:desc",
    "upload_date:desc",
]

# 🚨 `minWordSizeForTypos` is measured in BYTES, not characters. Cyrillic is 2
# bytes per character in UTF-8, so every Bulgarian word crosses these thresholds
# at HALF the word length you would assume. Proven by sweep on 2026-08-09: the
# query "пица" (4 chars / 8 bytes) kept matching "пича", "пичаги" and "пичове"
# at every threshold up to 8 and stopped dead at 9 - exactly its byte length.
# 95 of 100 hits were false.
#
# These values previously read {4, 8} in the belief they meant characters. They
# actually meant 2 and 4 CHARACTERS, so a 2-letter Bulgarian word got a typo and
# a 4-letter one got two - which is how "пица" reached "пичове".
#
# 🇧🇬 Intent is unchanged and stated in characters: one typo from 4 characters,
# two from 8. Bulgarian words are long and inflected and users type them on a
# phone keyboard they may be switching layouts on, so this is still LOOSER than
# Meilisearch's English-tuned default of 5/9 characters.
BYTES_PER_CYRILLIC_CHAR = 2
TYPO_TOLERANCE: dict[str, Any] = {
    "enabled": True,
    "minWordSizeForTypos": {
        "oneTypo": 4 * BYTES_PER_CYRILLIC_CHAR,
        "twoTypos": 8 * BYTES_PER_CYRILLIC_CHAR,
    },
    "disableOnWords": [],
    # Never typo-correct an id or a slug: a one-character "fix" makes it a
    # different record.
    "disableOnAttributes": ["youtube_id", "slug", "topic_slugs", "participant_slugs"],
}

# 🇧🇬 High-frequency Bulgarian function words. Removed from both documents and
# queries, so "епизодът за политиката" matches on the nouns and not on "за".
# Deliberately conservative: anything that can carry meaning stays out of here.
STOP_WORDS: list[str] = [
    "а",
    "ако",
    "ама",
    "б",
    "без",
    "би",
    "бъде",
    "в",
    "върху",
    "г",
    "го",
    "д",
    "да",
    "де",
    "докато",
    "е",
    "един",
    "една",
    "едно",
    "за",
    "и",
    "или",
    "им",
    "ими",
    "иска",
    "й",
    "каза",
    "как",
    "какво",
    "като",
    "кога",
    "който",
    "която",
    "което",
    "които",
    "ли",
    "ме",
    "между",
    "ми",
    "мога",
    "му",
    "на",
    "над",
    "най",
    "не",
    "него",
    "нея",
    "ни",
    "ние",
    "но",
    "от",
    "още",
    "по",
    "при",
    "с",
    "са",
    "само",
    "се",
    "си",
    "сме",
    "според",
    "сте",
    "съм",
    "със",
    "също",
    "т",
    "те",
    "тези",
    "този",
    "той",
    "то",
    "това",
    "тук",
    "ти",
    "у",
    "че",
    "ще",
    "щом",
    "я",
]

# 🇧🇬 Query-side rewrites. Bulgarians routinely type Latin for a Cyrillic word
# (and the reverse), and the shorthands below are what people actually type.
# This map is meant to GROW from real query logs, not from guesses.
SYNONYMS: dict[str, list[str]] = {
    "youtube": ["ютуб", "юутюб"],
    "ютуб": ["youtube"],
    "бг": ["българия", "български"],
    "българия": ["бг"],
    "podcast": ["подкаст"],
    "подкаст": ["podcast"],
    "live": ["на живо", "стрийм"],
    "стрийм": ["live", "на живо"],
}

# 🇧🇬 Force Bulgarian tokenisation instead of letting Meilisearch guess per
# document. Detection is unreliable on short strings, and an episode title is
# short. Cyrillic segmentation is unaffected by the guess going wrong, but
# being explicit removes the variable entirely.
LOCALIZED_ATTRIBUTES: list[dict[str, Any]] = [{"attributePatterns": ["*"], "locales": ["bul"]}]

# ⚠️ separatorTokens / nonSeparatorTokens are deliberately left at their
# defaults. Bulgarian hyphenates ("по-добър"), and the default treats "-" as a
# separator, so that indexes as "по" + "добър" and a search for "добър" finds
# it. Overriding this would break exactly the case it looks like it helps.
INDEX_SETTINGS: dict[str, Any] = {
    "searchableAttributes": SEARCHABLE_ATTRIBUTES,
    "filterableAttributes": FILTERABLE_ATTRIBUTES,
    "sortableAttributes": SORTABLE_ATTRIBUTES,
    "rankingRules": RANKING_RULES,
    "typoTolerance": TYPO_TOLERANCE,
    "stopWords": STOP_WORDS,
    "synonyms": SYNONYMS,
    "localizedAttributes": LOCALIZED_ATTRIBUTES,
    "faceting": {
        "maxValuesPerFacet": 200,
        # Facet lists in the UI should lead with the busiest channel/topic.
        "sortFacetValuesBy": {"*": "count"},
    },
    # 🚨 This CLAMPS `estimatedTotalHits`, so it is a correctness setting, not just
    # a pagination guard: any query matching more episodes than this reports
    # exactly this number, and the /search page prints it as the result count.
    # It became reachable when the corpus went 74 -> 1392 episodes: "подкаст"
    # matches every episode of the "Комеди Клуб Подкаст" channel (channel_name is
    # searchable) and reported a flat, wrong "1000 results".
    # ⚠️ MUST stay comfortably above the episode count. Revisit when the corpus
    # approaches this number.
    "pagination": {"maxTotalHits": 5000},
    # Hard ceiling on a single search. The wave targets sub-50ms; this stops a
    # pathological query from ever holding a request open.
    "searchCutoffMs": 200,
}

DEFAULT_HIGHLIGHT_ATTRIBUTES: list[str] = ["title", "description", "topics", "moments"]

# Meilisearch task waits. Settings changes are fast; a full document batch is not.
SETTINGS_TIMEOUT_MS = 30_000
BATCH_TIMEOUT_MS = 120_000

DEFAULT_BATCH_SIZE = 500

# Guards the once-per-process settings push in `ensure_index_once`.
_settings_lock = threading.Lock()
_settings_applied = False


# ---------------------------------------------------------------------------
# Index lifecycle
# ---------------------------------------------------------------------------


def _wait(task: Any, timeout_ms: int = BATCH_TIMEOUT_MS) -> None:
    """Block until an enqueued Meilisearch task finishes.

    Shared with the transcript index, so the implementation lives in client.py.
    """
    wait_for_task(task, timeout_ms)


def ensure_index(*, wait: bool = True) -> Any:
    """Create the index if missing and push the settings above. Idempotent."""
    client = get_client()
    try:
        client.get_index(EPISODES_INDEX)
    except SEARCH_ERRORS as exc:
        # A missing index is a 404 from the API; anything else is a real fault.
        if getattr(exc, "code", None) != "index_not_found":
            raise
        logger.info("Creating Meilisearch index %r", EPISODES_INDEX)
        _wait(client.create_index(EPISODES_INDEX, {"primaryKey": PRIMARY_KEY}))

    index = client.index(EPISODES_INDEX)
    task = index.update_settings(INDEX_SETTINGS)
    if wait:
        _wait(task, SETTINGS_TIMEOUT_MS)

    # 🚨 A bare assignment, NOT `with _settings_lock` - ensure_index_once calls
    # this while already holding that non-reentrant lock, and taking it again
    # here self-deadlocks on the process's first index write (hung the whole
    # test suite on 2026-08-14 before it ever shipped). The lock guards the
    # do-once dance; the boolean write itself is atomic under the GIL.
    global _settings_applied
    _settings_applied = True
    return index


def ensure_index_once() -> None:
    """Apply the index settings once per process, before the first write.

    🚨 Without this, `add_documents` against a missing index creates it with
    DEFAULT settings - every attribute searchable, NOTHING filterable. The
    symptom is not an indexing error but a later search failure ("Attribute
    `channel_slug` is not filterable") on exactly the filtered code paths, so an
    unfiltered query keeps working and hides it. The transcript index hit this
    for real on 2026-08-09; this is the same guard for the episodes index.

    Cheap after the first call. `reindex` still applies settings explicitly.

    ⚠️ `wait=False`, deliberately. Meilisearch executes tasks on one index in
    enqueue order, so the settings task is guaranteed to apply before the
    `add_documents` that follows it - blocking here adds latency to the first
    write of every process for nothing. It also matters for the test suite:
    the mocked client's task never reaches a terminal status, so a synchronous
    wait would poll for the full 120s timeout per call (found the hard way -
    this hung the suite on 2026-08-14).
    """
    global _settings_applied
    if _settings_applied:
        return
    with _settings_lock:
        if _settings_applied:
            return
        ensure_index(wait=False)
        _settings_applied = True


def drop_index(*, wait: bool = True) -> None:
    """Delete the whole index. Used by `reindex --drop`."""
    global _settings_applied
    logger.warning("Deleting Meilisearch index %r", EPISODES_INDEX)
    task = get_client().delete_index(EPISODES_INDEX)
    if wait:
        _wait(task, SETTINGS_TIMEOUT_MS)
    # The index is gone, so the next write must re-apply settings.
    with _settings_lock:
        _settings_applied = False


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


def _add_documents(documents: Sequence[dict[str, Any]], *, wait: bool = False) -> int:
    if not documents:
        return 0
    # Every write path funnels through here, so this is the one place that has
    # to guarantee the index exists WITH its settings. See ensure_index_once().
    ensure_index_once()
    task = get_index().add_documents(list(documents), primary_key=PRIMARY_KEY)
    if wait:
        _wait(task)
    return len(documents)


def index_episode(episode: Episode | int, *, strict: bool = False, wait: bool = False) -> bool:
    """Index one episode. Accepts an Episode or a pk.

    Returns True when the document was handed to Meilisearch.
    """
    runner = _index_episode_strict if strict else graceful(default=False)(_index_episode_strict)
    return runner(episode, wait=wait)


def _index_episode_strict(episode: Episode | int, *, wait: bool = False) -> bool:
    if isinstance(episode, int):
        loaded = episode_index_queryset().filter(pk=episode).first()
        if loaded is None:
            logger.warning("Episode %s no longer exists, removing from index instead", episode)
            return remove_episode(episode, wait=wait)
        episode = loaded
    elif not isinstance(episode, Episode):
        raise TypeError(f"index_episode expects an Episode or a pk, got {type(episode)!r}")
    _add_documents([build_document(episode)], wait=wait)
    return True


def index_episodes(
    episodes: QuerySet[Episode] | Iterable[Episode],
    *,
    strict: bool = False,
    wait: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> int:
    """Index many episodes in batches. Returns the number of documents sent."""
    runner = _index_episodes_strict if strict else graceful(default=0)(_index_episodes_strict)
    return runner(episodes, wait=wait, batch_size=batch_size)


def _index_episodes_strict(
    episodes: QuerySet[Episode] | Iterable[Episode],
    *,
    wait: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress: Callable[[str], None] | None = None,
) -> int:
    if isinstance(episodes, QuerySet):
        # Re-apply the prefetches. Cheap when they are already there, and the
        # difference between 4 queries and 3N+1 when they are not.
        episodes = episode_index_queryset(episodes).iterator(chunk_size=batch_size)

    sent = 0
    batch: list[dict[str, Any]] = []
    for episode in episodes:
        batch.append(build_document(episode))
        if len(batch) >= batch_size:
            sent += _add_documents(batch, wait=wait)
            if progress:
                progress(f"  indexed {sent} documents")
            batch = []
    if batch:
        sent += _add_documents(batch, wait=wait)
        if progress:
            progress(f"  indexed {sent} documents")
    return sent


def remove_episode(episode_id: int, *, strict: bool = False, wait: bool = False) -> bool:
    """Remove a single document. Safe to call for an id that is not indexed."""
    runner = _remove_episode_strict if strict else graceful(default=False)(_remove_episode_strict)
    return runner(episode_id, wait=wait)


def _remove_episode_strict(episode_id: int, *, wait: bool = False) -> bool:
    task = get_index().delete_document(episode_id)
    if wait:
        _wait(task)
    return True


def indexed_document_ids() -> set[int]:
    """Every id currently in the index. Used to spot documents Postgres dropped."""
    index = get_index()
    ids: set[int] = set()
    offset = 0
    page = 1000
    while True:
        results = index.get_documents({"limit": page, "offset": offset, "fields": ["id"]})
        rows = getattr(results, "results", results)
        if not rows:
            break
        for row in rows:
            raw = row.get("id") if isinstance(row, dict) else getattr(row, "id", None)
            if raw is not None:
                ids.add(int(raw))
        if len(rows) < page:
            break
        offset += page
    return ids


def rebuild_all(
    *,
    drop: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Rebuild the whole index from Postgres. STRICT: failures propagate.

    🚨 Postgres is the source of truth, so this must be able to recreate the
    index from nothing. `drop=True` proves it by deleting the index first.
    """
    started = time.monotonic()

    if drop:
        try:
            drop_index()
        except SEARCH_ERRORS as exc:
            if getattr(exc, "code", None) != "index_not_found":
                raise

    ensure_index()
    if progress:
        progress("index settings applied")

    queryset = Episode.objects.order_by("pk")
    total = queryset.count()

    sent = _index_episodes_strict(queryset, wait=True, batch_size=batch_size, progress=progress)

    removed = 0
    if not drop:
        # An episode deleted from Postgres must not linger in search results.
        stale = indexed_document_ids() - set(
            Episode.objects.order_by().values_list("pk", flat=True)
        )
        for episode_id in stale:
            _remove_episode_strict(episode_id)
            removed += 1
        if removed:
            if progress:
                progress(f"removed {removed} stale documents")

    elapsed = time.monotonic() - started
    return {
        "episodes_in_db": total,
        "documents_indexed": sent,
        "stale_removed": removed,
        "elapsed_sec": elapsed,
        "dropped": drop,
    }


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def escape_filter_value(value: Any) -> str:
    """Quote a value for a Meilisearch filter expression.

    🔒 Filters are built from user input (a channel slug in a query string).
    Never interpolate raw text into a filter.
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def build_filter(
    *,
    channel_slug: str | Sequence[str] | None = None,
    content_kind: str | None = None,
    members_only: bool | None = None,
    topic_slug: str | Sequence[str] | None = None,
    min_public_score: float | None = None,
    uploaded_after: int | None = None,
    uploaded_before: int | None = None,
) -> list[Any]:
    """Turn the /search page facets into a Meilisearch filter.

    Returns the array form, where the outer list is AND and a nested list is OR.
    """
    filters: list[Any] = []

    def _any_of(field: str, value: str | Sequence[str]) -> None:
        values = [value] if isinstance(value, str) else list(value)
        if not values:
            return
        clause = [f"{field} = {escape_filter_value(v)}" for v in values]
        filters.append(clause if len(clause) > 1 else clause[0])

    if channel_slug:
        _any_of("channel_slug", channel_slug)
    if topic_slug:
        _any_of("topic_slugs", topic_slug)
    if content_kind:
        filters.append(f"content_kind = {escape_filter_value(content_kind)}")
    if members_only is not None:
        filters.append(f"members_only = {escape_filter_value(members_only)}")
    if min_public_score is not None:
        filters.append(f"public_score >= {escape_filter_value(min_public_score)}")
    if uploaded_after is not None:
        filters.append(f"upload_date >= {escape_filter_value(uploaded_after)}")
    if uploaded_before is not None:
        filters.append(f"upload_date <= {escape_filter_value(uploaded_before)}")

    return filters


def empty_result(query: str, limit: int, offset: int, *, available: bool = True) -> dict[str, Any]:
    return {
        "query": query,
        "hits": [],
        "estimated_total_hits": 0,
        "limit": limit,
        "offset": offset,
        "processing_time_ms": 0,
        "facet_distribution": {},
        "available": available,
    }


def search(
    query: str,
    *,
    filters: str | Sequence[Any] | None = None,
    limit: int = 20,
    offset: int = 0,
    sort: Sequence[str] | None = None,
    facets: Sequence[str] | None = None,
    highlight: bool = False,
    attributes: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Search the episodes index.

    Never raises. When Meilisearch is down the result comes back empty with
    `available: False`, which is the signal for the API layer to fall back to
    Postgres full-text search behind the same endpoint.

    ⚡ `attributes` maps to Meilisearch's `attributesToRetrieve`. A document has 31
    fields including a description of up to 5,000 chars, and the /search endpoint
    reads exactly three of them, so leaving this unset ships up to 50 KB per query
    across the wire to be thrown away. Pass the fields you actually read.
    Leave it None to retrieve everything (what `highlight=True` callers want).
    """
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if filters:
        params["filter"] = filters
    if attributes:
        params["attributesToRetrieve"] = list(attributes)
    if sort:
        params["sort"] = list(sort)
    if facets:
        params["facets"] = list(facets)
    if highlight:
        params["attributesToHighlight"] = DEFAULT_HIGHLIGHT_ATTRIBUTES
        params["highlightPreTag"] = "<mark>"
        params["highlightPostTag"] = "</mark>"

    try:
        raw = get_index().search(query, params)
    except SEARCH_ERRORS as exc:
        logger.warning("Meilisearch search failed for %r: %s", query, exc)
        return empty_result(query, limit, offset, available=False)

    return {
        "query": raw.get("query", query),
        "hits": raw.get("hits", []),
        "estimated_total_hits": raw.get("estimatedTotalHits", len(raw.get("hits", []))),
        "limit": raw.get("limit", limit),
        "offset": raw.get("offset", offset),
        "processing_time_ms": raw.get("processingTimeMs", 0),
        "facet_distribution": raw.get("facetDistribution", {}),
        "available": True,
    }


def stats() -> dict[str, Any] | None:
    """Document count and field distribution, or None when unavailable."""
    if not is_available(force=True):
        return None
    return graceful(default=None)(lambda: get_index().get_stats().__dict__)()


__all__ = [
    "FILTERABLE_ATTRIBUTES",
    "INDEX_SETTINGS",
    "RANKING_RULES",
    "SEARCHABLE_ATTRIBUTES",
    "SORTABLE_ATTRIBUTES",
    "build_documents",
    "build_filter",
    "drop_index",
    "ensure_index",
    "escape_filter_value",
    "index_episode",
    "index_episodes",
    "rebuild_all",
    "remove_episode",
    "search",
    "stats",
]
