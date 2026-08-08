"""Builds the Meilisearch document for an Episode.

Document = title + description + channel name + topic labels + moment labels +
participant names, plus the attributes the /search page filters and sorts on.

🇧🇬 Cyrillic is stored VERBATIM. Nothing here lowercases, slugifies or
transliterates the text - Meilisearch does its own normalisation internally and
the raw value is what gets displayed back to the user.

⚡ Always build from `episode_index_queryset()`. Reading topics, moments and
participants off a plain queryset is 3 extra queries PER EPISODE, which turns a
1,000 episode reindex into 3,001 queries. `test_search.py` pins the query count.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime, time
from typing import Any

from django.db.models import Prefetch, QuerySet

from podcast.models import Episode, EpisodeParticipant, EpisodeTopic, Moment

# Descriptions are ~118 chars on average on the probed channel, but YouTube
# allows 5,000. Cap it so one pathological description cannot bloat the index.
MAX_DESCRIPTION_CHARS = 5_000

# Long tails of low-signal community labels add noise and payload without
# helping recall. Keep the best-scored ones.
MAX_TOPICS = 40
MAX_MOMENTS = 200
MAX_PARTICIPANTS = 40


def episode_index_queryset(base: QuerySet[Episode] | None = None) -> QuerySet[Episode]:
    """An Episode queryset that can build documents without an N+1.

    One query for the episodes (channel joined in) plus one per prefetched
    relation, regardless of how many episodes come back.
    """
    queryset = Episode.objects.all() if base is None else base
    if getattr(queryset, "_prefetch_related_lookups", ()):
        # Already prepared. Applying the same Prefetch twice makes Django raise
        # "lookup was already seen with a different queryset" at evaluation.
        return queryset
    return queryset.select_related("channel").prefetch_related(
        Prefetch(
            "topics",
            queryset=EpisodeTopic.objects.select_related("topic").order_by("-score", "-created_at"),
        ),
        Prefetch("moments", queryset=Moment.objects.order_by("-score", "timestamp_sec")),
        Prefetch(
            "participants",
            queryset=EpisodeParticipant.objects.select_related("person").order_by("role", "id"),
        ),
    )


def to_unix_timestamp(value: Any) -> int | None:
    """A DateField -> unix seconds, so Meilisearch can sort and range-filter it.

    Meilisearch has no date type: dates must be numbers to be sortable. Midnight
    UTC is used consistently so the ordering is stable and reversible.
    """
    if value is None:
        return None
    return int(datetime.combine(value, time.min, tzinfo=UTC).timestamp())


def build_document(episode: Episode) -> dict[str, Any]:
    """The searchable document for one episode."""
    channel = episode.channel

    topics = list(episode.topics.all())[:MAX_TOPICS]
    moments = list(episode.moments.all())[:MAX_MOMENTS]
    participants = list(episode.participants.all())[:MAX_PARTICIPANTS]

    upload_date = episode.upload_date

    return {
        # --- identity ---------------------------------------------------
        "id": episode.pk,
        "youtube_id": episode.youtube_id,
        "slug": episode.slug,
        "url": episode.watch_url,
        "thumbnail_url": episode.thumbnail_url,
        # --- searchable text (Cyrillic kept verbatim) --------------------
        "title": episode.title,
        "description": (episode.description or "")[:MAX_DESCRIPTION_CHARS],
        "channel_name": channel.name,
        "topics": [et.topic.name for et in topics],
        "moments": [moment.label for moment in moments],
        "participants": [participant.person.name for participant in participants],
        # --- facet / filter keys ----------------------------------------
        "channel_id": episode.channel_id,
        "channel_slug": channel.slug,
        "channel_handle": channel.handle,
        "topic_slugs": [et.topic.slug for et in topics],
        "participant_slugs": [p.person.slug for p in participants],
        "content_kind": episode.content_kind,
        "availability": episode.availability,
        "members_only": episode.members_only,
        "language": episode.language,
        # --- sortable numbers -------------------------------------------
        # upload_date is a unix timestamp; upload_date_iso is for display only.
        "upload_date": to_unix_timestamp(upload_date),
        "upload_date_iso": upload_date.isoformat() if upload_date else None,
        "upload_year": upload_date.year if upload_date else None,
        "duration_sec": episode.duration_sec,
        "public_score": episode.public_score,
        "elite_score": episode.elite_score,
        "rating_count": episode.rating_count,
        "elite_rating_count": episode.elite_rating_count,
        # ⚠️ NULL on members-only episodes - YouTube does not report it.
        "view_count": episode.view_count,
        "topic_count": len(topics),
        "moment_count": len(moments),
    }


def build_documents(episodes: Iterable[Episode]) -> list[dict[str, Any]]:
    """Documents for many episodes. Feed it `episode_index_queryset()`."""
    return [build_document(episode) for episode in episodes]
