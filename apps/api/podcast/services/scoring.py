"""Episode score computation.

🚨 THE single source of truth for both scores. Nothing else may write
Episode.public_score / elite_score / rating_count / elite_rating_count.

The design in one sentence: ONE Rating model, TWO derived numbers. The elite score
is the average of ratings cast by users with a VERIFIED membership of that episode's
channel - so verifying a user promotes their existing ratings with no data migration
and no duplicate rows.

NULL means "no ratings yet", which is NOT zero. An unrated episode must never sort
as though everyone hated it.
"""

from __future__ import annotations

import logging

from django.db.models import Avg, Count

from podcast.models import Episode, Rating

logger = logging.getLogger("podcast")


def compute_scores(episode: Episode) -> dict:
    """Compute both scores for one episode. Pure - writes nothing."""
    public = Rating.objects.filter(episode=episode).aggregate(
        avg=Avg("score"), n=Count("id")
    )
    elite = Rating.objects.filter(
        episode=episode,
        user__channel_memberships__channel=episode.channel_id,
        user__channel_memberships__is_verified=True,
    ).aggregate(avg=Avg("score"), n=Count("id", distinct=True))

    return {
        "public_score": round(public["avg"], 3) if public["avg"] is not None else None,
        "rating_count": public["n"] or 0,
        "elite_score": round(elite["avg"], 3) if elite["avg"] is not None else None,
        "elite_rating_count": elite["n"] or 0,
    }


def recompute_episode(episode: Episode | int) -> Episode:
    """Refresh the denormalized score columns for one episode."""
    if isinstance(episode, int):
        episode = Episode.objects.select_related("channel").get(pk=episode)

    scores = compute_scores(episode)
    for field, value in scores.items():
        setattr(episode, field, value)

    # update_fields keeps this a targeted UPDATE and avoids re-running the slug and
    # members_only logic in Episode.save().
    Episode.objects.filter(pk=episode.pk).update(**scores)

    # public_score is a sortable attribute in the search index, so a score change
    # makes the indexed document stale.
    from podcast.services.indexing import schedule_episode_reindex

    schedule_episode_reindex(episode.pk)
    return episode


def recompute_for_rating(rating: Rating) -> Episode:
    return recompute_episode(rating.episode)


def recompute_channel(channel_id: int) -> int:
    """Refresh every episode of one channel. Used after a verification changes."""
    count = 0
    for episode in Episode.objects.filter(channel_id=channel_id).select_related("channel"):
        recompute_episode(episode)
        count += 1
    logger.info("Recomputed scores for %d episodes on channel %s", count, channel_id)
    return count


def recompute_all(batch_size: int = 500) -> int:
    """Full self-healing sweep across every episode.

    Runs on a Celery Beat schedule. Because it recomputes from Rating rather than
    adjusting in place, any drift from a missed signal is corrected automatically.
    """
    count = 0
    queryset = Episode.objects.select_related("channel").only("id", "channel_id")
    for episode in queryset.iterator(chunk_size=batch_size):
        recompute_episode(episode)
        count += 1
    logger.info("Score sweep complete: %d episodes", count)
    return count


def recompute_for_membership_change(user_id: int, channel_id: int) -> int:
    """Called when a membership is verified or revoked.

    Only that channel's episodes can be affected, and only ones the user rated.
    """
    episode_ids = Rating.objects.filter(
        user_id=user_id, episode__channel_id=channel_id
    ).values_list("episode_id", flat=True)

    count = 0
    for episode in Episode.objects.filter(pk__in=list(episode_ids)).select_related("channel"):
        recompute_episode(episode)
        count += 1
    logger.info(
        "Verification change for user %s on channel %s touched %d episodes",
        user_id, channel_id, count,
    )
    return count
