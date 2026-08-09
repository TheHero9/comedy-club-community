"""Search-index invalidation helpers.

🚨 The ONE place application code asks for a re-index. Call sites use these instead
of touching podcast.search directly, so:

  - indexing always goes through Celery, never inline in a web request
  - a Meilisearch outage can never break a rating, a comment or an ingestion run
  - CELERY_TASK_ALWAYS_EAGER=True in dev still exercises the same code path

⚠️ Never call podcast.search.index_episode() from a view.
"""

from __future__ import annotations

import logging

from django.conf import settings

logger = logging.getLogger("podcast")


def indexing_enabled() -> bool:
    """⚠️ Off in tests.

    CELERY_TASK_ALWAYS_EAGER is True in dev, so a queued task runs INLINE. With
    retry_backoff and max_retries=5, a Meilisearch outage would otherwise stall
    every rating write for ~30s inside the request. Unit tests must also not need a
    running search engine.
    """
    return getattr(settings, "SEARCH_INDEXING_ENABLED", True)


def schedule_episode_reindex(episode_or_id) -> None:
    """Queue a re-index for one episode. Never raises into the caller."""
    if not indexing_enabled():
        return

    episode_id = getattr(episode_or_id, "pk", episode_or_id)
    if not episode_id:
        return

    try:
        from podcast.tasks import reindex_episode

        reindex_episode.delay(episode_id)
    except Exception:
        # Search freshness is never worth failing a user's write for. The nightly
        # rebuild_search_index sweep repairs whatever a dropped task missed.
        logger.warning("Could not queue reindex for episode %s", episode_id, exc_info=True)


def schedule_episode_removal(episode_id: int) -> None:
    if not indexing_enabled():
        return
    try:
        from podcast.tasks import remove_episode_from_index

        remove_episode_from_index.delay(episode_id)
    except Exception:
        logger.warning("Could not queue index removal for %s", episode_id, exc_info=True)


def schedule_channel_reindex(channel_id: int) -> None:
    if not indexing_enabled():
        return
    try:
        from podcast.tasks import reindex_channel

        reindex_channel.delay(channel_id)
    except Exception:
        logger.warning("Could not queue reindex for channel %s", channel_id, exc_info=True)


def schedule_transcript_reindex(episode_id: int) -> None:
    """Queue a re-index of one episode's transcript segments.

    Separate from `schedule_episode_reindex` because they write to different
    indexes: storing a transcript changes nothing in the `episodes` document.
    """
    if not indexing_enabled():
        return
    try:
        from podcast.tasks import reindex_transcript

        reindex_transcript.delay(episode_id)
    except Exception:
        logger.warning("Could not queue transcript reindex for %s", episode_id, exc_info=True)


def schedule_transcript_removal(episode_id: int) -> None:
    if not indexing_enabled():
        return
    try:
        from podcast.tasks import remove_transcript_from_index

        remove_transcript_from_index.delay(episode_id)
    except Exception:
        logger.warning("Could not queue transcript removal for %s", episode_id, exc_info=True)
