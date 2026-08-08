"""Celery tasks.

🚨 Every task here is a THIN WRAPPER over podcast/services/. No business logic lives
in a task body - that is what keeps the CLI and the scheduler from drifting apart.

⚠️ Indexing must NEVER happen inline in a web request. Call these tasks instead.
"""

from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger("podcast")


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------


@shared_task(name="podcast.sync_channel", bind=True, max_retries=3)
def sync_channel(self, channel_target: str, limit: int | None = None) -> dict:
    """Sync one channel.

    Uses the YouTube Data API when a key is configured, otherwise falls back to
    yt-dlp. yt-dlp is scraping and WILL break on YouTube changes, so this fallback
    is a stopgap until YOUTUBE_API_KEY is set, not the intended steady state.
    """
    from django.conf import settings

    from podcast.services.ingestion import backfill_channel

    if not settings.YOUTUBE_API_KEY:
        logger.warning(
            "YOUTUBE_API_KEY is not set - syncing %s via yt-dlp. This is scraping "
            "and is not safe as a recurring job.",
            channel_target,
        )

    try:
        result = backfill_channel(channel_target, limit=limit)
    except Exception as exc:
        logger.exception("Sync failed for %s", channel_target)
        raise self.retry(exc=exc, countdown=300) from exc

    if result.channel:
        reindex_channel.delay(result.channel.id)

    return {
        "channel": result.channel.name if result.channel else None,
        "created": result.created,
        "updated": result.updated,
        "errors": len(result.errors),
    }


@shared_task(name="podcast.sync_all_channels")
def sync_all_channels() -> dict:
    """Daily sync of every active channel."""
    from podcast.models import Channel

    targets = Channel.objects.filter(is_active=True).values_list("handle", "youtube_channel_id")
    queued = 0
    for handle, channel_id in targets:
        sync_channel.delay(handle or channel_id)
        queued += 1

    logger.info("Queued sync for %d channels", queued)
    return {"queued": queued}


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


@shared_task(name="podcast.recompute_episode_score")
def recompute_episode_score(episode_id: int) -> dict:
    from podcast.services import scoring

    episode = scoring.recompute_episode(episode_id)
    return {
        "episode_id": episode.id,
        "public_score": episode.public_score,
        "elite_score": episode.elite_score,
    }


@shared_task(name="podcast.recompute_all_scores")
def recompute_all_scores() -> dict:
    """Self-healing sweep. Recomputes from Rating, so drift corrects itself."""
    from podcast.services import scoring

    return {"episodes": scoring.recompute_all()}


@shared_task(name="podcast.recompute_membership_scores")
def recompute_membership_scores(user_id: int, channel_id: int) -> dict:
    """Run after a membership is verified or revoked.

    Verifying a user promotes their EXISTING ratings into the elite average, so the
    affected episodes must be recomputed. No data migration, no duplicate rows.
    """
    from podcast.services import scoring

    return {"episodes": scoring.recompute_for_membership_change(user_id, channel_id)}


# ---------------------------------------------------------------------------
# Search indexing
# ---------------------------------------------------------------------------


@shared_task(
    name="podcast.reindex_episode", bind=True, retry_backoff=True, max_retries=5
)
def reindex_episode(self, episode_id: int) -> bool:
    """Index one episode.

    strict=True so a transient Meilisearch outage raises and Celery retries. The
    web request path must NEVER call this synchronously - always `.delay()`.
    """
    from podcast.search import index_episode
    from podcast.search.client import SEARCH_ERRORS

    try:
        return index_episode(episode_id, strict=True)
    except SEARCH_ERRORS as exc:
        raise self.retry(exc=exc) from exc


@shared_task(
    name="podcast.remove_episode_from_index", bind=True, retry_backoff=True, max_retries=5
)
def remove_episode_from_index(self, episode_id: int) -> bool:
    from podcast.search import remove_episode
    from podcast.search.client import SEARCH_ERRORS

    try:
        return remove_episode(episode_id, strict=True)
    except SEARCH_ERRORS as exc:
        raise self.retry(exc=exc) from exc


@shared_task(name="podcast.reindex_channel")
def reindex_channel(channel_id: int) -> dict:
    try:
        from podcast.models import Episode
        from podcast.search.index import index_episodes

        queryset = Episode.objects.filter(channel_id=channel_id)
        count = index_episodes(queryset)
        return {"channel_id": channel_id, "indexed": count}
    except Exception:
        logger.exception("Failed to index channel %s", channel_id)
        return {"channel_id": channel_id, "indexed": 0}


@shared_task(name="podcast.rebuild_search_index")
def rebuild_search_index(drop: bool = False) -> dict:
    """Full rebuild from Postgres, which is the source of truth.

    Runs nightly as a self-healing sweep so a lost indexing task cannot leave the
    index permanently stale.
    """
    try:
        from podcast.search.index import rebuild_all

        return rebuild_all(drop=drop)
    except Exception:
        logger.exception("Search index rebuild failed")
        return {"documents_indexed": 0}
