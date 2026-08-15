"""Search endpoint.

🎯 This is the reason the app exists: YouTube's own search across these channels is
bad, and with no transcripts and near-empty descriptions, community topics and
moments are what make episodes findable.

Two backends behind ONE endpoint:
  - meilisearch: typo-tolerant, Cyrillic-aware, ranks across topics and moments
  - postgres:    always available fallback (ILIKE across the same joined text)

The response says which backend answered, so a degraded search is visible rather
than silently worse.
"""

from __future__ import annotations

import logging

from django.db.models import Prefetch, Q
from ninja import Query, Router

from podcast.models import Episode, EpisodeTopic

from .schemas import SearchOut, TranscriptSearchOut
from .serializers import episode_brief, episode_list_queryset

logger = logging.getLogger("podcast")

router = Router(tags=["search"], auth=None)

MAX_LIMIT = 50

# Segment-level page size. Higher than MAX_LIMIT because several segments
# routinely collapse into one episode after grouping.
MAX_TRANSCRIPT_LIMIT = 100

# Timestamps shown per episode before the UI would need a "show more".
MAX_MATCHES_PER_EPISODE = 5

# The only fields `_meilisearch_search` reads off a hit. Everything the response
# actually renders is re-read from Postgres (the source of truth) by
# `episode_list_queryset`, so pulling the rest of the document is dead weight.
MEILI_HIT_FIELDS = ("id", "topics", "moments")

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
    from podcast.search.index import build_filter
    from podcast.search.index import search as meili_search

    # 🔒 Filters are built from query-string input. build_filter escapes values, so
    # never hand-interpolate a slug into a filter expression.
    filters = build_filter(
        channel_slug=channel or None,
        content_kind=kind or None,
        members_only=members_only,
    )

    # ⚡ Only the three fields this function actually reads. Meilisearch documents
    # carry 31 fields (including a description of up to 5,000 chars) and Postgres
    # is re-read below for everything the response renders, so retrieving the full
    # document was pure waste: 50,378B -> 1,126B for "подкаст" at limit=24.
    result = meili_search(
        query,
        filters=filters or None,
        limit=limit,
        offset=offset,
        attributes=MEILI_HIT_FIELDS,
    )

    if not result.get("available", True):
        raise RuntimeError("Meilisearch reported itself unavailable")

    hit_ids = [int(hit["id"]) for hit in result.get("hits", [])]
    episodes = {
        episode.id: episode
        for episode in episode_list_queryset().filter(id__in=hit_ids)
    }

    hits = []
    for hit in result.get("hits", []):
        episode = episodes.get(int(hit["id"]))
        if not episode:
            # Indexed but since deleted. Skip rather than 500.
            continue
        hits.append(
            {
                "episode": episode_brief(episode),
                "matched_topics": hit.get("topics", [])[:MAX_MATCHED_LABELS],
                "matched_moments": hit.get("moments", [])[:MAX_MATCHED_LABELS],
            }
        )

    return {
        "query": query,
        "hits": hits,
        # ⚠️ snake_case. Reading the raw Meilisearch camelCase key here silently fell
        # back to len(hits), which reported the page size as the total (2026-08-08).
        "total": result.get("estimated_total_hits", len(hits)),
        "limit": limit,
        "offset": offset,
        "backend": "meilisearch",
        "processing_ms": result.get("processing_time_ms"),
    }


def _postgres_search(query, channel, kind, members_only, limit, offset) -> dict:
    """Fallback. Searches the same joined text Meilisearch indexes.

    🇧🇬 `icontains` maps to ILIKE, which is Unicode-safe in a UTF-8 database, so
    Cyrillic works. It is NOT typo-tolerant - that is what Meilisearch adds.
    """
    import time

    started = time.monotonic()

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
        .filter(
            Q(title__icontains=query)
            | Q(description__icontains=query)
            | Q(topics__topic__name__icontains=query)
            | Q(moments__label__icontains=query)
            | Q(participants__person__name__icontains=query)
            | Q(channel__name__icontains=query)
        )
        .distinct()
    )

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
    lowered = query.lower()
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
                    if lowered in et.topic.name.lower()
                ][:MAX_MATCHED_LABELS],
                "matched_moments": [
                    moment.label
                    for moment in episode.moments.all()
                    if lowered in moment.label.lower()
                ][:MAX_MATCHED_LABELS],
            }
        )

    return {
        "query": query,
        "hits": hits,
        "total": total,
        "limit": limit,
        "offset": offset,
        "backend": "postgres",
        "processing_ms": int((time.monotonic() - started) * 1000),
    }


@router.get("/search/transcripts", response=TranscriptSearchOut)
def search_transcripts(
    request,
    q: str = Query("", description="Query text. Bulgarian and typos are expected."),
    channel: str | None = Query(None, description="Channel slug"),
    episode: int | None = Query(None, description="Restrict to one episode id"),
    members_only: bool | None = Query(None),
    limit: int = Query(20, ge=1, le=MAX_TRANSCRIPT_LIMIT),
    offset: int = Query(0, ge=0),
):
    """Find where a phrase was SPOKEN, with a timestamp.

    🎯 The half of search community labels cannot cover. Labels answer "which
    episodes are about X"; this answers "X was said at 45:12 in these episodes".

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
        "limit": limit,
        "offset": offset,
        "available": True,
        "processing_ms": 0,
    }
    # Same rule as `/search`: a query with nothing alphanumeric in it tokenizes
    # to a placeholder search, which would return every indexed segment.
    if not has_searchable_text(query):
        return empty

    from podcast.search.transcript_index import build_filter
    from podcast.search.transcript_index import search as transcript_search

    # 🔒 Escaped by build_filter. Never hand-interpolate a slug into a filter.
    filters = build_filter(
        episode_id=episode,
        channel_slug=channel or None,
        members_only=members_only,
    )

    result = transcript_search(
        query, filters=filters or None, limit=limit, offset=offset, highlight=True
    )
    if not result.get("available", True):
        # Meilisearch is down. Say so rather than silently returning "no matches",
        # which would read as "this was never said".
        return {**empty, "available": False}

    raw_hits = result.get("hits", [])
    episode_ids = list(dict.fromkeys(int(hit["episode_id"]) for hit in raw_hits))
    if not episode_ids:
        return {**empty, "processing_ms": result.get("processing_time_ms")}

    # Postgres is the source of truth for everything rendered, so the documents
    # deliberately carry no title/thumbnail/score to re-read here.
    episodes = {
        row.id: row for row in episode_list_queryset().filter(id__in=episode_ids)
    }

    grouped: dict[int, list[dict]] = {}
    for hit in raw_hits:
        episode_id = int(hit["episode_id"])
        if episode_id not in episodes:
            # Indexed but since deleted. Skip rather than 500.
            continue
        formatted = hit.get("_formatted") or {}
        grouped.setdefault(episode_id, []).append(
            {
                "start_sec": hit["start_sec"],
                "end_sec": hit["end_sec"],
                # `_formatted` carries the cropped, <mark>-wrapped passage.
                "text": formatted.get("text") or hit.get("text", ""),
                "deep_link": (
                    f"https://www.youtube.com/watch?v={hit['youtube_id']}&t={hit['start_sec']}"
                ),
            }
        )

    hits = [
        {
            "episode": episode_brief(episodes[episode_id]),
            "matches": matches[:MAX_MATCHES_PER_EPISODE],
        }
        # dict preserves insertion order, so episodes stay in relevance order.
        for episode_id, matches in grouped.items()
    ]

    return {
        "query": query,
        "hits": hits,
        "total_segments": result.get("estimated_total_hits", len(raw_hits)),
        "limit": limit,
        "offset": offset,
        "available": True,
        "processing_ms": result.get("processing_time_ms"),
    }


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

    return list(
        Episode.objects.filter(title__icontains=query)
        .order_by("-upload_date")
        .values_list("title", flat=True)[:limit]
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
