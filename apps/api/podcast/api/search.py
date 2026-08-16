"""Search endpoints.

🎯 This is the reason the app exists: YouTube's own search across these channels is
bad, and with near-empty descriptions, community topics, moments and the free
auto-captions are what make episodes findable.

Two indexes, two questions, one page:
  - `episodes`            - "which episodes are ABOUT this"
  - `transcript_segments` - "where was this SAID"

Both endpoints share three rules, and all three exist because breaking any one of
them makes search *look* like it works while lying:

 1. 🇧🇬 **Matching is LOOSE by default** (`frequency`, see
    `podcast/search/querying.py`). A three-word memory of something heard in a
    podcast almost never appears verbatim, so requiring every word returns
    nothing far too often.
 2. 🚨 **Loose matches are LABELLED, not hidden.** Every hit carries
    `match_kind`, and `total_full` says exactly where the full matches stop, so
    the UI can rank a two-of-three-words hit below a perfect one instead of
    passing it off as the same thing.
 3. 🚨 **Every count is EXACT and is a count of the thing it is named after.**
    `total` counts episodes; `total_episodes` counts episodes; `total_segments`
    counts passages. They come from exhaustive `page`/`hitsPerPage` searches
    rather than `estimatedTotalHits`, which over-reported one query's 13
    episodes as 17 and another's as 3,852 out of a 1,961-episode catalogue.

The response says which backend answered, so a degraded search is visible rather
than silently worse.
"""

from __future__ import annotations

import logging

from django.db.models import Prefetch, Q
from ninja import Query, Router

from podcast.models import Episode, EpisodeTopic
from podcast.search.querying import (
    FULL,
    LOOSE,
    STRICT,
    content_tokens,
    partition_index,
    wants_partial_split,
)

from .schemas import SearchOut, TranscriptSearchOut
from .serializers import episode_brief, episode_list_queryset

logger = logging.getLogger("podcast")

router = Router(tags=["search"], auth=None)

MAX_LIMIT = 50

# ⚠️ EPISODES, not segments. This changed on 2026-08-16 along with the endpoint's
# whole pagination model - see `search_transcripts`. It is lower than it looks
# because each episode on a page also costs up to MAX_MATCHES_PER_EPISODE
# passages in the follow-up fetch.
MAX_TRANSCRIPT_LIMIT = 50

# Timestamps shown per episode before the UI would need a "show more".
MAX_MATCHES_PER_EPISODE = 5

# The only fields `_meilisearch_search` reads off a hit. Everything the response
# actually renders is re-read from Postgres (the source of truth) by
# `episode_list_queryset`, so pulling the rest of the document is dead weight.
MEILI_HIT_FIELDS = ("id", "topics", "moments")

# The only fields the transcript passage fetch reads off a segment document.
MEILI_SEGMENT_FIELDS = ("episode_id", "youtube_id", "start_sec", "end_sec", "text")

# `matched_topics` / `matched_moments` are capped at this in the response.
MAX_MATCHED_LABELS = 5


def has_searchable_text(query: str) -> bool:
    """True if a query contains anything a tokenizer can actually match on.

    🇧🇬 `str.isalnum()` is Unicode-aware, so Cyrillic counts: "Каспаров" is
    searchable, "???" and "..." are not, and a bare number like "2024" still is.
    Exported because the transcript endpoint applies the identical rule - two
    search endpoints disagreeing about what an unsearchable query means is how
    one of them ends up returning the whole corpus.
    """
    return any(character.isalnum() for character in query)


def _meilisearch_available() -> bool:
    try:
        from podcast.search.client import is_available

        return is_available()
    except Exception:
        # The search package may not be wired yet, or Meilisearch may be down.
        # Neither is a reason to 500 a user's search.
        return False


def _exact_total(result: dict, fallback_key: str = "estimated_total_hits") -> int:
    """Read the exhaustive count, falling back to the estimate.

    A `count_only` search always carries `total_hits`. The fallback covers a
    mocked client in the test suite and any future caller that forgets.
    """
    total = result.get("total_hits")
    return int(total) if total is not None else int(result.get(fallback_key) or 0)


# ---------------------------------------------------------------------------
# /search - which episodes are ABOUT this
# ---------------------------------------------------------------------------


@router.get("/search", response=SearchOut)
def search(
    request,
    q: str = Query("", description="Query text. Bulgarian and typos are expected."),
    channel: str | None = Query(None, description="Channel slug"),
    kind: str | None = Query(None, description="video | stream"),
    members_only: bool | None = Query(None),
    limit: int = Query(20, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
):
    query = (q or "").strip()

    # 🚨 `has_searchable_text` is not the same test as `not query`, and the
    # difference is the whole point. A query of "???" is non-empty, so it used to
    # reach Meilisearch - which tokenizes it to nothing, treats that as a
    # placeholder search, and answers with the ENTIRE catalogue. The endpoint
    # then reported 1,393 episodes as matches for "???".
    #
    # Returning everything is the worst possible failure for a search box: it
    # looks like a working feature. It is also precisely the symptom CLAUDE.md
    # documents for Cyrillic mangled by a shell (every letter becomes "?"), so
    # the API answering it honestly is what keeps that diagnosis readable.
    #
    # The endpoint has always held that an empty query returns 0 hits rather
    # than everything. A query that tokenizes to empty is the same question.
    if not has_searchable_text(query):
        return {
            "query": query,
            "hits": [],
            "total": 0,
            "total_full": 0,
            "word_count": 0,
            "limit": limit,
            "offset": offset,
            "backend": "postgres",
            "processing_ms": 0,
        }

    if _meilisearch_available():
        try:
            result = _meilisearch_search(query, channel, kind, members_only, limit, offset)
        except Exception:
            logger.exception("Meilisearch query failed, falling back to Postgres")
        else:
            # ⚠️ A reachable but EMPTY or STALE index answers every query with zero
            # hits, which looks identical to "nothing matches" and makes the whole
            # feature appear broken. If Meilisearch finds nothing, confirm against
            # Postgres before believing it. Costs one extra query only on a miss.
            if result["total"] > 0:
                return result
            fallback = _postgres_search(query, channel, kind, members_only, limit, offset)
            if fallback["total"] > 0:
                logger.warning(
                    "Meilisearch returned 0 hits for %r but Postgres found %d. "
                    "The index is probably empty or stale - run `manage.py reindex`.",
                    query, fallback["total"],
                )
                return fallback
            return result

    return _postgres_search(query, channel, kind, members_only, limit, offset)


def _meilisearch_search(query, channel, kind, members_only, limit, offset) -> dict:
    from podcast.search.client import EPISODES_INDEX, multi_search
    from podcast.search.index import build_filter, build_search_params, normalize_result

    # 🔒 Filters are built from query-string input. build_filter escapes values, so
    # never hand-interpolate a slug into a filter expression.
    filters = build_filter(
        channel_slug=channel or None,
        content_kind=kind or None,
        members_only=members_only,
    ) or None

    split = wants_partial_split(query)

    # ⚡ One round trip for up to three questions. Each costs Meilisearch 0-6ms
    # but ~25ms of network on this box, so batching is most of the wall clock.
    #
    # ⚡ Only three fields are retrieved for the page. Meilisearch documents carry
    # 31 fields (including a description of up to 5,000 chars) and Postgres is
    # re-read below for everything the response renders, so pulling the full
    # document was pure waste: 50,378B -> 1,126B for "подкаст" at limit=24.
    queries = [
        {
            "indexUid": EPISODES_INDEX,
            "q": query,
            **build_search_params(
                filters=filters,
                limit=limit,
                offset=offset,
                attributes=MEILI_HIT_FIELDS,
                matching_strategy=LOOSE,
            ),
        },
        {
            "indexUid": EPISODES_INDEX,
            "q": query,
            **build_search_params(
                filters=filters, matching_strategy=LOOSE, count_only=True
            ),
        },
    ]
    if split:
        queries.append(
            {
                "indexUid": EPISODES_INDEX,
                "q": query,
                **build_search_params(
                    filters=filters, matching_strategy=STRICT, count_only=True
                ),
            }
        )

    raw_results = multi_search(queries)
    if len(raw_results) < len(queries):
        raise RuntimeError("Meilisearch multi-search returned fewer results than queries")

    page = normalize_result(raw_results[0], query, limit, offset)
    total = _exact_total(normalize_result(raw_results[1], query, 1, 0))
    # A single-content-word query cannot have a partial match, so every hit is
    # full. Saying `total_full = total` rather than 0 is what keeps the UI from
    # inventing a "partial matches" heading over an ordinary one-word search.
    total_full = (
        _exact_total(normalize_result(raw_results[2], query, 1, 0)) if split else total
    )

    hit_ids = [int(hit["id"]) for hit in page.get("hits", [])]
    episodes = {
        episode.id: episode
        for episode in episode_list_queryset().filter(id__in=hit_ids)
    }

    hits = []
    for position, hit in enumerate(page.get("hits", [])):
        episode = episodes.get(int(hit["id"]))
        if not episode:
            # Indexed but since deleted. Skip rather than 500.
            continue
        hits.append(
            {
                "episode": episode_brief(episode),
                "matched_topics": hit.get("topics", [])[:MAX_MATCHED_LABELS],
                "matched_moments": hit.get("moments", [])[:MAX_MATCHED_LABELS],
                # 🚨 From the ABSOLUTE rank, not from this page's index. See
                # `partition_index` - a hit's kind must not change when the same
                # episode is reached via a different offset.
                "match_kind": partition_index(total_full, offset, position),
            }
        )

    return {
        "query": query,
        "hits": hits,
        "total": total,
        "total_full": total_full,
        "word_count": len(content_tokens(query)),
        "limit": limit,
        "offset": offset,
        "backend": "meilisearch",
        "processing_ms": page.get("processing_time_ms"),
    }


def _postgres_search(query, channel, kind, members_only, limit, offset) -> dict:
    """Fallback. Searches the same joined text Meilisearch indexes.

    🇧🇬 `icontains` maps to ILIKE, which is Unicode-safe in a UTF-8 database, so
    Cyrillic works. It is NOT typo-tolerant - that is what Meilisearch adds.

    🚨 Multi-word queries are matched WORD BY WORD, not as one literal substring.
    A single `ILIKE '%историята с колата%'` requires those words to appear
    adjacent and in that order, which for a remembered phrase is almost never
    true - so with Meilisearch down the fallback answered "nothing matches" for
    queries that have hundreds of real hits. Each word must appear SOMEWHERE in
    the joined text (an AND across words, an OR across fields), which is the
    closest Postgres gets to the strict half of what Meilisearch does.
    """
    import time

    started = time.monotonic()

    def _any_field(term: str) -> Q:
        return (
            Q(title__icontains=term)
            | Q(description__icontains=term)
            | Q(topics__topic__name__icontains=term)
            | Q(moments__label__icontains=term)
            | Q(participants__person__name__icontains=term)
            | Q(channel__name__icontains=term)
        )

    # Stop words are stripped so the query means the same thing it means to
    # Meilisearch. If a query is nothing BUT stop words, fall back to the raw
    # string rather than matching everything.
    terms = content_tokens(query) or [query]

    queryset = (
        episode_list_queryset()
        # 🚨 The "why did this match" loop below reads episode.topics and
        # episode.moments for every hit. Without these prefetches that is 2 extra
        # queries PER HIT: 102 queries and ~600ms for a 50-hit page (measured
        # 2026-08-09). Prefetching makes it 2 queries regardless of page size.
        .prefetch_related(
            Prefetch("topics", queryset=EpisodeTopic.objects.select_related("topic")),
            "moments",
        )
    )
    for term in terms:
        queryset = queryset.filter(_any_field(term))
    queryset = queryset.distinct()

    if channel:
        queryset = queryset.filter(channel__slug=channel)
    if kind:
        queryset = queryset.filter(content_kind=kind)
    if members_only is not None:
        queryset = queryset.filter(members_only=members_only)

    queryset = queryset.order_by("-upload_date", "-id")

    total = queryset.count()
    page = list(queryset[offset : offset + limit])

    # Show WHY each episode matched, so a topic-driven hit does not look arbitrary.
    lowered = [term.lower() for term in terms]

    def _matches_any(text: str) -> bool:
        low = text.lower()
        return any(term in low for term in lowered)

    hits = []
    for episode in page:
        hits.append(
            {
                "episode": episode_brief(episode),
                # `.all()` on purpose: it reads the prefetch cache. Calling
                # `.select_related("topic")` here builds a NEW queryset, which
                # bypasses the cache and re-queries once per episode.
                "matched_topics": [
                    et.topic.name
                    for et in episode.topics.all()
                    if _matches_any(et.topic.name)
                ][:MAX_MATCHED_LABELS],
                "matched_moments": [
                    moment.label
                    for moment in episode.moments.all()
                    if _matches_any(moment.label)
                ][:MAX_MATCHED_LABELS],
                # Every word was required, so every Postgres hit is a full match.
                "match_kind": FULL,
            }
        )

    return {
        "query": query,
        "hits": hits,
        "total": total,
        "total_full": total,
        "word_count": len(content_tokens(query)),
        "limit": limit,
        "offset": offset,
        "backend": "postgres",
        "processing_ms": int((time.monotonic() - started) * 1000),
    }


# ---------------------------------------------------------------------------
# /search/transcripts - where a phrase was SAID
# ---------------------------------------------------------------------------


@router.get("/search/transcripts", response=TranscriptSearchOut)
def search_transcripts(
    request,
    q: str = Query("", description="Query text. Bulgarian and typos are expected."),
    channel: str | None = Query(None, description="Channel slug"),
    episode: int | None = Query(None, description="Restrict to one episode id"),
    members_only: bool | None = Query(None),
    limit: int = Query(20, ge=1, le=MAX_TRANSCRIPT_LIMIT, description="EPISODES per page"),
    offset: int = Query(0, ge=0),
):
    """Find where a phrase was SPOKEN, with a timestamp.

    🎯 The half of search community labels cannot cover. Labels answer "which
    episodes are about X"; this answers "X was said at 45:12 in these episodes".

    🚨 **`limit`/`offset` page over EPISODES**, and did not always. Until
    2026-08-16 they paged over PASSAGES, which were then grouped for display - so
    the number of episodes in a response was an accident of how many passages
    happened to land on that page, and `hits` was not a page of anything. The
    page above it advertised "21 passages in 13 episodes" and rendered six cards
    with no way to reach the rest. Meilisearch's `distinct` does the grouping
    inside the engine instead, which makes the page size mean what it says and
    makes `total_episodes` exact.

    Two round trips, deliberately: the first batch cannot know which episodes are
    on the page, so the passages that fill each card have to be fetched once
    those ids are known. Each episode carries its best-ranked passage from the
    first batch as a floor, so a card can never render empty.

    ⚠️ Coverage is PARTIAL and date-dependent - roughly the newer part of the
    catalogue has captions, and members-only episodes have none. An episode
    missing from these results has not been ruled out, it may simply have no
    transcript. Never present this as exhaustive.
    """
    query = (q or "").strip()
    empty = {
        "query": query,
        "hits": [],
        "total_segments": 0,
        "total_episodes": 0,
        "total_full_episodes": 0,
        "word_count": len(content_tokens(query)),
        "limit": limit,
        "offset": offset,
        "available": True,
        "processing_ms": 0,
    }
    # Same rule as `/search`: a query with nothing alphanumeric in it tokenizes
    # to a placeholder search, which would return every indexed segment.
    if not has_searchable_text(query):
        return empty

    from podcast.search.client import TRANSCRIPTS_INDEX, multi_search
    from podcast.search.index import normalize_result
    from podcast.search.transcript_index import (
        DISTINCT_EPISODE,
        build_filter,
        build_search_params,
    )
    from podcast.search.transcript_index import search as transcript_search

    # 🔒 Escaped by build_filter. Never hand-interpolate a slug into a filter.
    filters = build_filter(
        episode_id=episode,
        channel_slug=channel or None,
        members_only=members_only,
    ) or None

    split = wants_partial_split(query)

    def _query(**kwargs) -> dict:
        return {
            "indexUid": TRANSCRIPTS_INDEX,
            "q": query,
            **build_search_params(filters=filters, **kwargs),
        }

    queries = [
        # 1. The page: one best passage per episode, in relevance order.
        _query(
            limit=limit,
            offset=offset,
            distinct=DISTINCT_EPISODE,
            attributes=MEILI_SEGMENT_FIELDS,
            matching_strategy=LOOSE,
        ),
        # 2. Exactly how many EPISODES contain the words.
        _query(distinct=DISTINCT_EPISODE, matching_strategy=LOOSE, count_only=True),
        # 3. Exactly how many PASSAGES do. A different question, printed as a
        #    different number - conflating the two is the original bug.
        _query(matching_strategy=LOOSE, count_only=True),
    ]
    if split:
        # 4. How many of those episodes contain EVERY word.
        queries.append(
            _query(distinct=DISTINCT_EPISODE, matching_strategy=STRICT, count_only=True)
        )

    try:
        raw_results = multi_search(queries)
    except Exception:
        logger.warning("Transcript multi-search failed for %r", query, exc_info=True)
        return {**empty, "available": False}

    if len(raw_results) < len(queries):
        return {**empty, "available": False}

    page = normalize_result(raw_results[0], query, limit, offset)
    total_episodes = _exact_total(normalize_result(raw_results[1], query, 1, 0))
    total_segments = _exact_total(normalize_result(raw_results[2], query, 1, 0))
    total_full_episodes = (
        _exact_total(normalize_result(raw_results[3], query, 1, 0))
        if split
        else total_episodes
    )

    # `distinct` gives one representative segment per episode, in rank order.
    # This dict is the page's episode ORDER as well as its floor of passages.
    representative: dict[int, dict] = {}
    for hit in page.get("hits", []):
        episode_id = int(hit["episode_id"])
        representative.setdefault(episode_id, hit)

    if not representative:
        return {
            **empty,
            "total_segments": total_segments,
            "total_episodes": total_episodes,
            "total_full_episodes": total_full_episodes,
            "processing_ms": page.get("processing_time_ms"),
        }

    episode_ids = list(representative)

    # Round trip two: every passage for the episodes on this page, so a card can
    # show several timestamps rather than one. Scoped by an `IN` filter, so its
    # cost is bounded by the page size and not by how common the word is.
    #
    # ⚠️ Not `distinct`: the whole point is to get MULTIPLE passages per episode.
    id_filter = f"episode_id IN [{', '.join(str(i) for i in episode_ids)}]"
    extra = transcript_search(
        query,
        filters=id_filter,
        limit=len(episode_ids) * MAX_MATCHES_PER_EPISODE,
        attributes=MEILI_SEGMENT_FIELDS,
        matching_strategy=LOOSE,
    )

    # Postgres is the source of truth for everything rendered, so the documents
    # deliberately carry no title/thumbnail/score to re-read here.
    episodes = {
        row.id: row for row in episode_list_queryset().filter(id__in=episode_ids)
    }

    def _passage(hit: dict) -> dict:
        formatted = hit.get("_formatted") or {}
        return {
            "start_sec": hit["start_sec"],
            "end_sec": hit["end_sec"],
            # `_formatted` carries the cropped, <mark>-wrapped passage.
            "text": formatted.get("text") or hit.get("text", ""),
            "deep_link": (
                f"https://www.youtube.com/watch?v={hit['youtube_id']}&t={hit['start_sec']}"
            ),
        }

    grouped: dict[int, list[dict]] = {}
    seen_starts: dict[int, set[int]] = {}
    for hit in extra.get("hits", []) if extra.get("available", True) else []:
        episode_id = int(hit["episode_id"])
        if episode_id not in representative:
            continue
        starts = seen_starts.setdefault(episode_id, set())
        if hit["start_sec"] in starts:
            continue
        starts.add(hit["start_sec"])
        grouped.setdefault(episode_id, []).append(_passage(hit))

    hits = []
    # Iterate `representative`, not `grouped`: dicts preserve insertion order, so
    # this keeps the page in the relevance order the distinct search decided,
    # and guarantees an entry for every episode even if the follow-up fetch
    # returned nothing for it.
    for position, episode_id in enumerate(representative):
        row = episodes.get(episode_id)
        if row is None:
            # Indexed but since deleted. Skip rather than 500.
            continue
        matches = grouped.get(episode_id) or [_passage(representative[episode_id])]
        hits.append(
            {
                "episode": episode_brief(row),
                "matches": matches[:MAX_MATCHES_PER_EPISODE],
                "match_kind": partition_index(total_full_episodes, offset, position),
            }
        )

    return {
        "query": query,
        "hits": hits,
        "total_segments": total_segments,
        "total_episodes": total_episodes,
        "total_full_episodes": total_full_episodes,
        "word_count": len(content_tokens(query)),
        "limit": limit,
        "offset": offset,
        "available": True,
        "processing_ms": page.get("processing_time_ms"),
    }


# ---------------------------------------------------------------------------
# /search/suggest
# ---------------------------------------------------------------------------


@router.get("/search/suggest", response=list[str])
def suggest(request, q: str = Query(""), limit: int = Query(8, ge=1, le=20)):
    """Title completions for the search box, ranked by relevance.

    ⚡ Served by Meilisearch, which matters more here than anywhere else on the
    site: this endpoint fires on nearly every keystroke.

    🇧🇬 The Postgres path is `ILIKE '%q%'` - a sequential scan of every episode
    per keystroke, ordered by upload date rather than relevance, and with no
    typo tolerance at all. On a site whose entire premise is typo-tolerant
    Bulgarian search, the ONE surface where the user is still mid-word was the
    one surface that demanded a perfect prefix. `девствна` suggested nothing.

    Postgres remains the fallback so the box keeps working with Meilisearch
    down - degraded suggestions beat none, and Enter always searches regardless.
    """
    query = (q or "").strip()
    # Same rule as the two search endpoints: a query that tokenizes to nothing
    # is a placeholder search to Meilisearch, which would answer with the whole
    # catalogue's titles.
    if len(query) < 2 or not has_searchable_text(query):
        return []

    if _meilisearch_available():
        try:
            titles = _meilisearch_suggest(query, limit)
        except Exception:
            logger.exception("Meilisearch suggest failed, falling back to Postgres")
        else:
            # ⚠️ An empty or stale index answers every keystroke with nothing,
            # which is indistinguishable from "no such episode". Confirm against
            # Postgres before believing it - same reasoning as `/search`, and it
            # costs a query only when there was nothing to show anyway.
            if titles:
                return titles

    # 🚨 Word by word, for the same reason as `_postgres_search`: a two-word
    # query is never one literal substring of a title.
    queryset = Episode.objects.all()
    for term in content_tokens(query) or [query]:
        queryset = queryset.filter(title__icontains=term)
    return list(
        queryset.order_by("-upload_date").values_list("title", flat=True)[:limit]
    )


def _meilisearch_suggest(query: str, limit: int) -> list[str]:
    """Rank in Meilisearch, read the text from Postgres.

    🚨 Meilisearch supplies the ORDER and nothing else. The title is re-read
    from Postgres because Postgres is the source of truth and the index is
    eventually consistent: a document whose episode was renamed or deleted keeps
    answering with its old text until the next reindex, and a suggestion is a
    string the user is about to search for. Offering a title that no longer
    exists sends them straight to a zero-result page.

    This is the same rule `_meilisearch_search` follows for the same reason -
    it retrieves ids and re-reads every rendered field from `episode_list_queryset`.
    """
    from podcast.search.index import search as meili_search

    # ⚡ Only the id is retrieved. A document is 31 fields including a
    # description of up to 5,000 chars, and this endpoint renders one line.
    result = meili_search(query, limit=limit, attributes=("id",))
    if not result.get("available", True):
        return []

    hit_ids = [int(hit["id"]) for hit in result.get("hits", [])]
    if not hit_ids:
        return []

    titles = dict(
        Episode.objects.filter(id__in=hit_ids).values_list("id", "title")
    )
    # Meilisearch's order is the relevance ranking, so it is preserved here.
    # Ids missing from Postgres are dropped rather than 500ing: an indexed but
    # since-deleted episode is a stale document, not an error.
    return [titles[episode_id] for episode_id in hit_ids if episode_id in titles]
