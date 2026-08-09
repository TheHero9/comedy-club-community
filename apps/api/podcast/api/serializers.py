"""Model -> schema mapping.

⚠️ Every function here assumes the queryset was built by the matching `*_queryset`
helper. Those apply select_related / prefetch_related so a list of 50 episodes is a
handful of queries, not 200. Never map a raw queryset.
"""

from __future__ import annotations

from django.db.models import Count, IntegerField, OuterRef, Prefetch, Q, QuerySet, Subquery
from django.db.models.functions import Coalesce

from podcast.models import Channel, Episode, EpisodeParticipant, EpisodeTopic
from podcast.services.grid import score_band

# ---------------------------------------------------------------------------
# Querysets
# ---------------------------------------------------------------------------


# Exactly the columns `episode_brief` reads. Anything not listed here is deferred,
# so a list page never drags Episode.description (avg 545 chars, max 2860) or the
# channel's description/banner through the sort, the DISTINCT or the wire.
# ⚠️ Touching a field outside this tuple on a list-queryset instance triggers a
# per-row lazy SELECT. Add the field here rather than dropping the `only()`.
BRIEF_FIELDS = (
    "id",
    "youtube_id",
    "title",
    "slug",
    "channel_id",
    "upload_date",
    "duration_sec",
    "thumbnail_url",
    "content_kind",
    "members_only",
    "public_score",
    "elite_score",
    "rating_count",
    "elite_rating_count",
    "channel__id",
    "channel__name",
    "channel__slug",
)


def episode_list_queryset() -> QuerySet[Episode]:
    """Everything EpisodeBriefOut needs, in one join, and nothing else."""
    return Episode.objects.select_related("channel").only(*BRIEF_FIELDS)


def channel_list_queryset() -> QuerySet[Channel]:
    """Channels with their episode_count.

    ⚡ A correlated Subquery, not `annotate(Count("episodes"))`. The JOIN + GROUP BY
    form reads every episode row to count a handful of channels; the subquery does
    one index-only scan per channel on `podcast_episode(channel_id)`. Measured on a
    simulated 7,992-episode / 8-channel table: 10.6ms -> 4.4ms.
    """
    episode_count = (
        Episode.objects.filter(channel=OuterRef("pk"))
        .order_by()
        .values("channel")
        .annotate(n=Count("*"))
        .values("n")
    )
    return Channel.objects.annotate(
        _episode_count=Coalesce(
            Subquery(episode_count, output_field=IntegerField()), 0
        )
    )


def episode_detail_queryset() -> QuerySet[Episode]:
    """Everything EpisodeOut needs, without N+1 on topics/chapters/participants."""
    return (
        Episode.objects.select_related("channel")
        .prefetch_related(
            Prefetch(
                "topics",
                queryset=EpisodeTopic.objects.select_related("topic").order_by("-score"),
            ),
            "chapters",
            Prefetch(
                "participants",
                queryset=EpisodeParticipant.objects.select_related("person"),
            ),
        )
        .annotate(
            _moment_count=Count("moments", distinct=True),
            _comment_count=Count("comments", filter=Q(comments__is_hidden=False), distinct=True),
        )
    )


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------


def episode_brief(episode: Episode) -> dict:
    return {
        "id": episode.id,
        "youtube_id": episode.youtube_id,
        "title": episode.title,
        "slug": episode.slug,
        "channel_id": episode.channel_id,
        "channel_name": episode.channel.name,
        "channel_slug": episode.channel.slug,
        "upload_date": episode.upload_date,
        "duration_sec": episode.duration_sec,
        "thumbnail_url": episode.thumbnail_url,
        "content_kind": episode.content_kind,
        "members_only": episode.members_only,
        "public_score": episode.public_score,
        "elite_score": episode.elite_score,
        "rating_count": episode.rating_count,
        "elite_rating_count": episode.elite_rating_count,
        "band": score_band(episode.public_score),
        "elite_band": score_band(episode.elite_score),
    }


def episode_detail(episode: Episode) -> dict:
    data = episode_brief(episode)
    data.update(
        {
            "description": episode.description,
            "url": episode.url,
            "watch_url": episode.watch_url,
            "availability": episode.availability,
            "language": episode.language,
            "view_count": episode.view_count,
            "like_count": episode.like_count,
            "topics": [
                {
                    "id": et.topic.id,
                    "name": et.topic.name,
                    "slug": et.topic.slug,
                    "score": et.score,
                }
                for et in episode.topics.all()
            ],
            "chapters": [
                {
                    "id": c.id,
                    "title": c.title,
                    "start_sec": c.start_sec,
                    "end_sec": c.end_sec,
                }
                for c in episode.chapters.all()
            ],
            "participants": [
                {
                    "id": p.person.id,
                    "name": p.person.name,
                    "slug": p.person.slug,
                    "avatar_url": p.person.avatar_url,
                    "role": p.role,
                }
                for p in episode.participants.all()
            ],
            "moment_count": getattr(episode, "_moment_count", 0),
            "comment_count": getattr(episode, "_comment_count", 0),
        }
    )
    return data


def channel_out(channel) -> dict:
    return {
        "id": channel.id,
        "youtube_channel_id": channel.youtube_channel_id,
        "name": channel.name,
        "slug": channel.slug,
        "handle": channel.handle,
        "description": channel.description,
        "avatar_url": channel.avatar_url,
        "banner_url": channel.banner_url,
        "subscriber_count": channel.subscriber_count,
        "episode_count": getattr(channel, "_episode_count", 0),
        "last_synced_at": channel.last_synced_at,
    }


def comment_out(comment) -> dict:
    profile = getattr(comment.user, "profile", None)
    return {
        "id": comment.id,
        "episode_id": comment.episode_id,
        "body": comment.body,
        "is_spoiler": comment.is_spoiler,
        "created_at": comment.created_at,
        "edited_at": comment.edited_at,
        "author_id": comment.user_id,
        "author_name": (profile.display_name if profile else "") or comment.user.get_username(),
        "author_avatar": profile.avatar_url if profile else "",
    }


def moment_out(moment) -> dict:
    profile = getattr(moment.user, "profile", None) if moment.user else None
    return {
        "id": moment.id,
        "timestamp_sec": moment.timestamp_sec,
        "label": moment.label,
        "score": moment.score,
        "created_at": moment.created_at,
        "author": (profile.display_name if profile else None),
    }


def person_out(person) -> dict:
    return {
        "id": person.id,
        "name": person.name,
        "slug": person.slug,
        "bio": person.bio,
        "avatar_url": person.avatar_url,
        "socials": person.socials or {},
        "appearance_count": getattr(person, "_appearance_count", 0),
    }


def membership_out(membership) -> dict:
    return {
        "id": membership.id,
        "channel_id": membership.channel_id,
        "channel_name": membership.channel.name,
        "channel_slug": membership.channel.slug,
        "tier": membership.tier,
        "member_since": membership.member_since,
        "is_verified": membership.is_verified,
        # 🔒 Only whether a screenshot exists, NEVER its URL. It is private proof
        # of a paid membership and is admin-only.
        "has_screenshot": bool(membership.verification_screenshot),
        "verified_at": membership.verified_at,
    }


def paginated_meta(total: int, limit: int, offset: int) -> dict:
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + limit < total,
    }
