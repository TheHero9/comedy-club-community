"""The `transcript_segments` index: settings, writes, and transcript search.

🚨 WHY THIS IS A SEPARATE INDEX, and not three extra fields on the episode
document. An episode transcript is ~26,000 words. Dropped into the same document
as a 60-character title it would:

  - make almost every episode match almost every common Bulgarian word, so
    search starts returning the whole catalogue
  - let a throwaway mention outrank an episode genuinely about the subject,
    because Meilisearch ranks per document, not per passage
  - throw away the timestamp, which is the entire reason transcripts are worth
    storing

Two indexes, two questions. `episodes` answers "which episodes are ABOUT this".
`transcript_segments` answers "where was this SAID". The API layer presents them
as one result page - see podcast/api/search.py.

⚠️ Measured cost on this box (2026-08-09): ~1.2 MB of Meilisearch per hour of
audio, ~0.6s to index one 2h38m episode. The whole 1,914-hour catalogue projects
to ~2.0-2.5 GB. Budget host RAM against that number, not against Postgres, which
holds the same text in ~56 MB compressed.

🚨 Postgres is the source of truth. `manage.py reindex --drop` rebuilds this
index from nothing, exactly like the episodes one.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Iterable, Sequence
from typing import Any

from django.db.models import QuerySet

from podcast.models import Transcript, TranscriptSegment

from .client import (
    SEARCH_ERRORS,
    TRANSCRIPTS_INDEX,
    get_client,
    get_index,
    graceful,
    is_available,
    wait_for_task,
)
from .index import (
    BYTES_PER_CYRILLIC_CHAR,
    LOCALIZED_ATTRIBUTES,
    STOP_WORDS,
    SYNONYMS,
    escape_filter_value,
)
from .transcript_documents import (
    build_segment_document,
    build_segment_documents,
    segment_index_queryset,
)

logger = logging.getLogger(__name__)

PRIMARY_KEY = "id"

# Only the spoken text is searchable. Everything else on the document exists to
# filter or to render the hit, and making an id searchable would let a stray
# numeric query match documents by their key.
SEARCHABLE_ATTRIBUTES: list[str] = ["text"]

FILTERABLE_ATTRIBUTES: list[str] = [
    "episode_id",
    "channel_id",
    "channel_slug",
    "content_kind",
    "members_only",
    "language",
    "upload_year",
    "upload_date",
    "start_sec",
]

SORTABLE_ATTRIBUTES: list[str] = ["start_sec", "upload_date"]

# The six defaults plus one tie-breaker. There is no `public_score` here - a
# segment has no rating - so equally relevant passages fall back to "more
# recent", matching how the episodes index breaks its own ties.
RANKING_RULES: list[str] = [
    "words",
    "typo",
    "proximity",
    "attribute",
    "sort",
    "exactness",
    "upload_date:desc",
]

# 🚨 BYTES, not characters - see the same constant in index.py. Cyrillic is 2
# bytes per character, so these are 5 and 9 CHARACTERS.
#
# 🇧🇬 Deliberately STRICTER than the episodes index. Auto-captions are already
# noisy - lowercase, unpunctuated, with garbled words ("comed клуб", "пка") - so
# loose typo tolerance over ~115k passages turns near-misses into false matches
# at scale. A title gets the benefit of the doubt; ASR text does not.
TYPO_TOLERANCE: dict[str, Any] = {
    "enabled": True,
    "minWordSizeForTypos": {
        "oneTypo": 5 * BYTES_PER_CYRILLIC_CHAR,
        "twoTypos": 9 * BYTES_PER_CYRILLIC_CHAR,
    },
    "disableOnWords": [],
    "disableOnAttributes": [],
}

INDEX_SETTINGS: dict[str, Any] = {
    "searchableAttributes": SEARCHABLE_ATTRIBUTES,
    "filterableAttributes": FILTERABLE_ATTRIBUTES,
    "sortableAttributes": SORTABLE_ATTRIBUTES,
    "rankingRules": RANKING_RULES,
    "typoTolerance": TYPO_TOLERANCE,
    # 🇧🇬 Same Bulgarian function words the episodes index strips. They matter
    # far MORE here: unfiltered, "да" alone would match essentially every
    # segment in the catalogue.
    "stopWords": STOP_WORDS,
    "synonyms": SYNONYMS,
    "localizedAttributes": LOCALIZED_ATTRIBUTES,
    # 🚨 This CLAMPS `estimatedTotalHits`, and the UI prints that as "N mentions".
    # A common word legitimately appears in tens of thousands of segments, so the
    # ceiling is much higher than the episodes index needs. Raising it costs
    # memory per query; lowering it silently makes the count a lie.
    "pagination": {"maxTotalHits": 20_000},
    "searchCutoffMs": 200,
}

HIGHLIGHT_ATTRIBUTES: list[str] = ["text"]

SETTINGS_TIMEOUT_MS = 30_000
BATCH_TIMEOUT_MS = 300_000

# Segments are small documents and there are ~150 per episode, so a bigger batch
# than the episodes index uses keeps the round trips down on a full rebuild.
DEFAULT_BATCH_SIZE = 2_000

# Guards the once-per-process settings push in `ensure_index_once`.
_settings_lock = threading.Lock()
_settings_applied = False


# ---------------------------------------------------------------------------
# Index lifecycle
# ---------------------------------------------------------------------------


def _wait(task: Any, timeout_ms: int = BATCH_TIMEOUT_MS) -> None:
    wait_for_task(task, timeout_ms)


def ensure_index(*, wait: bool = True) -> Any:
    """Create the index if missing and push the settings above. Idempotent."""
    client = get_client()
    try:
        client.get_index(TRANSCRIPTS_INDEX)
    except SEARCH_ERRORS as exc:
        if getattr(exc, "code", None) != "index_not_found":
            raise
        logger.info("Creating Meilisearch index %r", TRANSCRIPTS_INDEX)
        _wait(client.create_index(TRANSCRIPTS_INDEX, {"primaryKey": PRIMARY_KEY}))

    index = client.index(TRANSCRIPTS_INDEX)
    task = index.update_settings(INDEX_SETTINGS)
    if wait:
        _wait(task, SETTINGS_TIMEOUT_MS)

    global _settings_applied
    with _settings_lock:
        _settings_applied = True
    return index


def ensure_index_once() -> None:
    """Apply the index settings once per process, before the first write.

    🚨 Without this, `add_documents` against a missing index creates it with
    DEFAULT settings - every attribute searchable, NOTHING filterable. The
    symptom is not an indexing error but a later search failure
    ("Attribute `episode_id` is not filterable"), and only on the code paths
    that filter, so an unfiltered query keeps working and hides it. Hit for real
    on 2026-08-09: the incremental Celery path created the index, `reindex` had
    never run, and episode-scoped transcript search 500'd while global search
    looked fine.

    Cheap after the first call. `reindex` still applies settings explicitly.
    """
    global _settings_applied
    if _settings_applied:
        return
    with _settings_lock:
        if _settings_applied:
            return
        ensure_index()
        _settings_applied = True


def drop_index(*, wait: bool = True) -> None:
    global _settings_applied
    logger.warning("Deleting Meilisearch index %r", TRANSCRIPTS_INDEX)
    task = get_client().delete_index(TRANSCRIPTS_INDEX)
    if wait:
        _wait(task, SETTINGS_TIMEOUT_MS)
    # The index is gone, so the next write must re-apply settings.
    with _settings_lock:
        _settings_applied = False


def _index() -> Any:
    return get_index(TRANSCRIPTS_INDEX)


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


def _add_documents(documents: Sequence[dict[str, Any]], *, wait: bool = False) -> int:
    if not documents:
        return 0
    # Every write path funnels through here, so this is the one place that has
    # to guarantee the index exists WITH its settings. See ensure_index_once().
    ensure_index_once()
    task = _index().add_documents(list(documents), primary_key=PRIMARY_KEY)
    if wait:
        _wait(task)
    return len(documents)


def remove_episode_segments(
    episode_id: int, *, strict: bool = False, wait: bool = False
) -> bool:
    """Drop every segment document for one episode.

    🚨 Deletes BY FILTER, not by computed id. Re-running a backfill with a
    different window size produces different `start_sec` values and therefore
    different document ids, so deleting the ids we are about to write would
    leave the old windowing behind as duplicate hits.
    """
    runner = (
        _remove_episode_segments_strict
        if strict
        else graceful(default=False)(_remove_episode_segments_strict)
    )
    return runner(episode_id, wait=wait)


def _remove_episode_segments_strict(episode_id: int, *, wait: bool = False) -> bool:
    # Deleting by filter needs `episode_id` filterable, so the settings must be
    # in place even when this runs before the first write of the process.
    ensure_index_once()
    task = _index().delete_documents(filter=f"episode_id = {int(episode_id)}")
    if wait:
        _wait(task)
    return True


def index_transcript(
    episode_id: int, *, strict: bool = False, wait: bool = False, replace: bool = True
) -> int:
    """Index every segment of one episode's transcript. Returns documents sent.

    Removes the episode's existing documents first, so an episode whose
    transcript was deleted, shortened or re-windowed cannot leave orphans behind.
    """
    runner = _index_transcript_strict if strict else graceful(default=0)(_index_transcript_strict)
    return runner(episode_id, wait=wait, replace=replace)


def _index_transcript_strict(
    episode_id: int, *, wait: bool = False, replace: bool = True
) -> int:
    if replace:
        # Wait for the delete, always. Meilisearch processes tasks in order, but
        # not waiting here makes the write path depend on that ordering holding.
        _remove_episode_segments_strict(episode_id, wait=True)

    segments = segment_index_queryset().filter(
        transcript__episode_id=episode_id, transcript__status=Transcript.Status.OK
    )
    documents = build_segment_documents(segments)
    return _add_documents(documents, wait=wait)


def index_segments(
    segments: Iterable[TranscriptSegment],
    *,
    strict: bool = False,
    wait: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress: Callable[[str], None] | None = None,
) -> int:
    """Index many segments in batches. Feed it `segment_index_queryset()`."""
    runner = _index_segments_strict if strict else graceful(default=0)(_index_segments_strict)
    return runner(segments, wait=wait, batch_size=batch_size, progress=progress)


def _index_segments_strict(
    segments: Iterable[TranscriptSegment],
    *,
    wait: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress: Callable[[str], None] | None = None,
) -> int:
    if isinstance(segments, QuerySet):
        # Re-apply select_related (cheap when already there) and stream, so a
        # 115,000-row rebuild never materialises the whole table in memory.
        segments = segment_index_queryset(segments).iterator(chunk_size=batch_size)

    sent = 0
    batch: list[dict[str, Any]] = []
    for segment in segments:
        batch.append(build_segment_document(segment))
        if len(batch) >= batch_size:
            sent += _add_documents(batch, wait=wait)
            if progress:
                progress(f"  indexed {sent} segments")
            batch = []
    if batch:
        sent += _add_documents(batch, wait=wait)
        if progress:
            progress(f"  indexed {sent} segments")
    return sent


def rebuild_all(
    *,
    drop: bool = False,
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Rebuild the whole transcript index from Postgres. STRICT: failures propagate."""
    started = time.monotonic()

    if drop:
        try:
            drop_index()
        except SEARCH_ERRORS as exc:
            if getattr(exc, "code", None) != "index_not_found":
                raise
    else:
        # Without --drop there is no per-episode reconciliation to lean on: a
        # transcript deleted in Postgres would linger. Clearing is cheap next to
        # re-adding every document anyway.
        try:
            _wait(_index().delete_all_documents())
        except SEARCH_ERRORS as exc:
            if getattr(exc, "code", None) != "index_not_found":
                raise

    ensure_index()
    if progress:
        progress("transcript index settings applied")

    queryset = segment_index_queryset().order_by("pk")
    total = queryset.count()
    sent = _index_segments_strict(queryset, wait=True, batch_size=batch_size, progress=progress)

    return {
        "segments_in_db": total,
        "documents_indexed": sent,
        "transcripts_in_db": Transcript.objects.filter(status=Transcript.Status.OK).count(),
        "elapsed_sec": time.monotonic() - started,
        "dropped": drop,
    }


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def build_filter(
    *,
    episode_id: int | None = None,
    channel_slug: str | Sequence[str] | None = None,
    content_kind: str | None = None,
    members_only: bool | None = None,
    uploaded_after: int | None = None,
    uploaded_before: int | None = None,
) -> list[Any]:
    """🔒 Same escaping contract as the episodes index: never interpolate raw text."""
    filters: list[Any] = []

    if episode_id is not None:
        filters.append(f"episode_id = {int(episode_id)}")
    if channel_slug:
        values = [channel_slug] if isinstance(channel_slug, str) else list(channel_slug)
        clause = [f"channel_slug = {escape_filter_value(v)}" for v in values]
        if clause:
            filters.append(clause if len(clause) > 1 else clause[0])
    if content_kind:
        filters.append(f"content_kind = {escape_filter_value(content_kind)}")
    if members_only is not None:
        filters.append(f"members_only = {escape_filter_value(members_only)}")
    if uploaded_after is not None:
        filters.append(f"upload_date >= {escape_filter_value(uploaded_after)}")
    if uploaded_before is not None:
        filters.append(f"upload_date <= {escape_filter_value(uploaded_before)}")

    return filters


def search(
    query: str,
    *,
    filters: str | Sequence[Any] | None = None,
    limit: int = 40,
    offset: int = 0,
    highlight: bool = True,
    attributes: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Search spoken text. Never raises.

    Returns `available: False` when Meilisearch is down, which is the API
    layer's signal to omit the transcript section rather than fail the request.
    There is deliberately NO Postgres fallback: an ILIKE over 115k segments is a
    sequential scan of every transcript in the catalogue.
    """
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if filters:
        params["filter"] = filters
    if attributes:
        params["attributesToRetrieve"] = list(attributes)
    if highlight:
        params["attributesToHighlight"] = HIGHLIGHT_ATTRIBUTES
        params["highlightPreTag"] = "<mark>"
        params["highlightPostTag"] = "</mark>"
        # The passage is ~170 words; the UI shows a snippet around the match.
        params["attributesToCrop"] = HIGHLIGHT_ATTRIBUTES
        params["cropLength"] = 30

    try:
        raw = _index().search(query, params)
    except SEARCH_ERRORS as exc:
        logger.warning("Transcript search failed for %r: %s", query, exc)
        return {
            "query": query,
            "hits": [],
            "estimated_total_hits": 0,
            "limit": limit,
            "offset": offset,
            "processing_time_ms": 0,
            "available": False,
        }

    return {
        "query": raw.get("query", query),
        "hits": raw.get("hits", []),
        "estimated_total_hits": raw.get("estimatedTotalHits", len(raw.get("hits", []))),
        "limit": raw.get("limit", limit),
        "offset": raw.get("offset", offset),
        "processing_time_ms": raw.get("processingTimeMs", 0),
        "available": True,
    }


def stats() -> dict[str, Any] | None:
    if not is_available(force=True):
        return None
    return graceful(default=None)(lambda: _index().get_stats().__dict__)()


__all__ = [
    "DEFAULT_BATCH_SIZE",
    "INDEX_SETTINGS",
    "build_filter",
    "drop_index",
    "ensure_index",
    "index_segments",
    "index_transcript",
    "rebuild_all",
    "remove_episode_segments",
    "search",
    "stats",
]
