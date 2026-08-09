"""Builds the Meilisearch document for a TranscriptSegment.

🇧🇬 Cyrillic is stored VERBATIM, same rule as the episode documents. Nothing
here lowercases, slugifies or transliterates - Meilisearch normalises internally
and the raw passage is what gets shown back to the user.

⚡ Always build from `segment_index_queryset()`. A segment needs its episode and
that episode's channel to carry the filter keys, and reading them off a plain
queryset is 2 extra queries PER SEGMENT - which on a 115,000-segment rebuild is
230,000 queries instead of one.

⚠️ Keep this document SMALL. Every field is multiplied by ~115,000 rows at full
catalogue scale, so anything that can be re-read from Postgres at render time
does not belong here. The episode's title, thumbnail and scores are deliberately
absent: the API re-reads those from Postgres for the handful of episodes on the
current page.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from django.db.models import QuerySet

from podcast.models import TranscriptSegment

from .documents import to_unix_timestamp


def segment_index_queryset(
    base: QuerySet[TranscriptSegment] | None = None,
) -> QuerySet[TranscriptSegment]:
    """A segment queryset that can build documents without an N+1."""
    queryset = TranscriptSegment.objects.all() if base is None else base
    return queryset.select_related("transcript__episode__channel")


def build_segment_document(segment: TranscriptSegment) -> dict[str, Any]:
    """The searchable document for one transcript segment."""
    episode = segment.transcript.episode
    channel = episode.channel
    upload_date = episode.upload_date

    return {
        # 🚨 Composite id, not the row pk. It stays stable when a transcript is
        # re-stored with the same windowing, so a re-index upserts in place
        # instead of accumulating a second copy under new pks.
        "id": f"{episode.pk}-{segment.start_sec}",
        "episode_id": episode.pk,
        "youtube_id": episode.youtube_id,
        # --- the passage (Cyrillic verbatim) -----------------------------
        "text": segment.text,
        "start_sec": segment.start_sec,
        "end_sec": segment.end_sec,
        # --- filter keys --------------------------------------------------
        "channel_id": episode.channel_id,
        "channel_slug": channel.slug,
        "content_kind": episode.content_kind,
        "members_only": episode.members_only,
        "language": segment.transcript.language,
        "upload_date": to_unix_timestamp(upload_date),
        "upload_year": upload_date.year if upload_date else None,
    }


def build_segment_documents(segments: Iterable[TranscriptSegment]) -> list[dict[str, Any]]:
    """Documents for many segments. Feed it `segment_index_queryset()`."""
    return [build_segment_document(segment) for segment in segments]
