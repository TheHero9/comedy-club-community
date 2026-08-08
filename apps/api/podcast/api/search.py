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

from django.db.models import Q
from ninja import Query, Router

from podcast.models import Episode

from .schemas import SearchOut
from .serializers import episode_brief, episode_list_queryset

logger = logging.getLogger("podcast")

router = Router(tags=["search"], auth=None)

MAX_LIMIT = 50


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
    if not query:
        return {
            "query": "",
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

    result = meili_search(query, filters=filters or None, limit=limit, offset=offset)

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
                "matched_topics": hit.get("topics", [])[:5],
                "matched_moments": hit.get("moments", [])[:5],
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
                "matched_topics": [
                    et.topic.name
                    for et in episode.topics.select_related("topic")
                    if lowered in et.topic.name.lower()
                ][:5],
                "matched_moments": [
                    moment.label
                    for moment in episode.moments.all()
                    if lowered in moment.label.lower()
                ][:5],
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


@router.get("/search/suggest", response=list[str])
def suggest(request, q: str = Query(""), limit: int = Query(8, ge=1, le=20)):
    """Lightweight title/topic completions for a search box."""
    query = (q or "").strip()
    if len(query) < 2:
        return []

    titles = list(
        Episode.objects.filter(title__icontains=query)
        .order_by("-upload_date")
        .values_list("title", flat=True)[:limit]
    )
    return titles
