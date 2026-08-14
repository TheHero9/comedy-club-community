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

from django.db.models import Avg, Count, F

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
    episode_ids = list(
        Episode.objects.filter(channel_id=channel_id).values_list("pk", flat=True)
    )
    count = recompute_many(episode_ids)
    logger.info("Recomputed scores for %d episodes on channel %s", count, channel_id)
    return count


def recompute_all(batch_size: int = 500) -> int:
    """Full self-healing sweep across every episode.

    Runs on a Celery Beat schedule. Because it recomputes from Rating rather than
    adjusting in place, any drift from a missed signal is corrected automatically.

    ⚡ Set-based via `recompute_many`: two aggregates plus batched bulk_updates,
    instead of ~4 queries, one UPDATE and one queued Meilisearch reindex task PER
    EPISODE PER HOUR. `reindex=False` because rating writes already reindex their
    episode inline, and the nightly `rebuild_search_index` sweep repairs the rare
    drift this catches - re-queuing the whole catalogue hourly repaired nothing.
    """
    count = recompute_many(None, reindex=False, batch_size=batch_size)
    logger.info("Score sweep complete: %d episodes", count)
    return count


def recompute_many(
    episode_ids: list[int] | None = None,
    *,
    reindex: bool = True,
    batch_size: int = 1000,
) -> int:
    """Set-based form of `recompute_episode` for backfills and bulk seeding.

    Two aggregate queries and one bulk UPDATE, instead of four queries and one
    UPDATE per episode. The DEFINITIONS are identical to `compute_scores` - this
    is the same arithmetic expressed over a set, and `test_recompute_many_matches_
    per_episode` pins that equivalence so the two can never drift.

    🚨 An episode with no ratings must still be written, otherwise deleting the
    last rating would leave a stale score behind. So the aggregate maps are
    lookups with a null default, not the iteration source.

    `reindex=False` skips queuing a re-index task per episode. Use it for a bulk
    load and then run `manage.py reindex` once - a thousand queued tasks to
    rebuild a thousand documents one at a time is strictly worse.
    """
    episodes = Episode.objects.all()
    if episode_ids is not None:
        if not episode_ids:
            return 0
        episodes = episodes.filter(pk__in=episode_ids)

    scope = Rating.objects.filter(episode__in=episodes.values("pk"))

    public = {
        row["episode_id"]: row
        for row in scope.values("episode_id").annotate(avg=Avg("score"), n=Count("id"))
    }
    elite = {
        row["episode_id"]: row
        for row in scope.filter(
            # The membership must be for THIS episode's channel. Without the F()
            # join condition any verified membership anywhere would count, which
            # is the single easiest way to get the elite score wrong.
            user__channel_memberships__is_verified=True,
            user__channel_memberships__channel=F("episode__channel"),
        )
        .values("episode_id")
        .annotate(avg=Avg("score"), n=Count("id", distinct=True))
    }

    pending: list[Episode] = []
    count = 0
    fields = ["public_score", "rating_count", "elite_score", "elite_rating_count"]

    for episode in episodes.only("id").iterator(chunk_size=batch_size):
        p = public.get(episode.pk)
        e = elite.get(episode.pk)
        episode.public_score = round(p["avg"], 3) if p and p["avg"] is not None else None
        episode.rating_count = p["n"] if p else 0
        episode.elite_score = round(e["avg"], 3) if e and e["avg"] is not None else None
        episode.elite_rating_count = e["n"] if e else 0
        pending.append(episode)

        if len(pending) >= batch_size:
            Episode.objects.bulk_update(pending, fields)
            count += len(pending)
            pending = []

    if pending:
        Episode.objects.bulk_update(pending, fields)
        count += len(pending)

    if reindex:
        from podcast.services.indexing import schedule_episode_reindex

        for episode_id in episodes.values_list("pk", flat=True):
            schedule_episode_reindex(episode_id)

    logger.info("Bulk score recompute: %d episodes (reindex=%s)", count, reindex)
    return count


def recompute_for_membership_change(user_id: int, channel_id: int) -> int:
    """Called when a membership is verified or revoked.

    Only that channel's episodes can be affected, and only ones the user rated.
    """
    episode_ids = list(
        Rating.objects.filter(
            user_id=user_id, episode__channel_id=channel_id
        ).values_list("episode_id", flat=True)
    )

    # Set-based: two aggregates + one bulk_update, however many episodes they
    # rated. The per-episode loop made verifying one heavy rater hundreds of
    # sequential query cycles inside the admin request.
    count = recompute_many(episode_ids)
    logger.info(
        "Verification change for user %s on channel %s touched %d episodes",
        user_id, channel_id, count,
    )
    return count
