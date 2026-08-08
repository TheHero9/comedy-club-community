"""Persisting fetched YouTube metadata.

The ONE place episodes are written. Both the management command and (from wave 5)
the Celery task call in here, so CLI and scheduler can never drift apart.

Idempotency is the contract: every write is `update_or_create` keyed on the external
`youtube_id`, so an interrupted run costs nothing and a repeat run changes no counts.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime

from django.db import transaction
from django.utils import timezone

from podcast.ingestion.yt_dlp_backfill import ChannelPayload, fetch_channel
from podcast.models import Channel, Chapter, Episode

logger = logging.getLogger("podcast")


@dataclass
class IngestionResult:
    channel: Channel | None = None
    created: int = 0
    updated: int = 0
    skipped: int = 0
    chapters_created: int = 0
    errors: list[dict] = field(default_factory=list)

    @property
    def total(self) -> int:
        return self.created + self.updated

    def summary(self) -> str:
        return (
            f"{self.total} episodes ({self.created} created, {self.updated} updated), "
            f"{self.chapters_created} chapters, {len(self.errors)} errors"
        )


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        logger.warning("Unparseable upload_date: %r", value)
        return None


def upsert_channel(payload: ChannelPayload) -> Channel:
    """Create or refresh the Channel row from a fetched payload."""
    if not payload.youtube_channel_id:
        raise ValueError("Channel payload has no youtube_channel_id")

    channel, created = Channel.objects.update_or_create(
        youtube_channel_id=payload.youtube_channel_id,
        defaults={
            "name": payload.name or payload.handle or payload.youtube_channel_id,
            "handle": payload.handle,
            "description": payload.description,
        },
    )
    logger.info("%s channel %s", "Created" if created else "Updated", channel.name)
    return channel


@transaction.atomic
def upsert_episode(channel: Channel, data: dict) -> tuple[Episode, bool, int]:
    """Create or update one episode plus its chapters.

    Returns (episode, was_created, chapters_created).
    """
    chapters = data.pop("chapters", [])

    defaults = {
        "channel": channel,
        "title": data.get("title") or "(untitled)",
        "description": data.get("description") or "",
        "upload_date": _parse_date(data.get("upload_date")),
        "duration_sec": data.get("duration_sec"),
        "thumbnail_url": data.get("thumbnail_url") or "",
        "url": data.get("url") or "",
        "content_kind": data.get("content_kind") or Episode.ContentKind.VIDEO,
        "availability": data.get("availability") or Episode.Availability.PUBLIC,
        "language": data.get("language") or "",
        "view_count": data.get("view_count"),
        "like_count": data.get("like_count"),
        "yt_comment_count": data.get("yt_comment_count"),
    }

    # An availability value yt-dlp reports but our enum does not model (e.g.
    # "needs_auth") must not blow up the run - fall back to public and log it.
    valid = {choice.value for choice in Episode.Availability}
    if defaults["availability"] not in valid:
        logger.info(
            "Unmapped availability %r on %s, storing as public",
            defaults["availability"], data.get("youtube_id"),
        )
        defaults["availability"] = Episode.Availability.PUBLIC

    episode, created = Episode.objects.update_or_create(
        youtube_id=data["youtube_id"], defaults=defaults
    )

    # ⚠️ Opportunistic only - the probe found 0 of 12 episodes with chapters.
    chapters_created = 0
    for chapter in chapters:
        _, made = Chapter.objects.update_or_create(
            episode=episode,
            start_sec=chapter["start_sec"],
            defaults={"title": chapter["title"][:300], "end_sec": chapter.get("end_sec")},
        )
        chapters_created += int(made)

    return episode, created, chapters_created


def backfill_channel(
    target: str,
    *,
    limit: int | None = None,
    dry_run: bool = False,
    verify_thumbnails: bool = True,
    progress=None,
) -> IngestionResult:
    """Fetch a channel with yt-dlp and persist every episode.

    Safe to re-run: `update_or_create` on youtube_id means a second pass changes no
    row counts.
    """
    payload = fetch_channel(
        target, limit=limit, verify_thumbnails=verify_thumbnails, progress=progress
    )
    result = IngestionResult(errors=list(payload.errors))

    if dry_run:
        result.skipped = len(payload.videos)
        logger.info("Dry run: would upsert %d episodes", len(payload.videos))
        return result

    channel = upsert_channel(payload)
    result.channel = channel

    for data in payload.videos:
        try:
            _, created, chapters = upsert_episode(channel, dict(data))
        except Exception as exc:
            # A single bad row must not abort a 1,000-episode backfill.
            logger.exception("Failed to persist %s", data.get("youtube_id"))
            result.errors.append({"youtube_id": data.get("youtube_id"), "error": str(exc)})
            continue
        result.created += int(created)
        result.updated += int(not created)
        result.chapters_created += chapters

    channel.last_synced_at = timezone.now()
    channel.save(update_fields=["last_synced_at"])

    # Newly ingested episodes are invisible to search until indexed.
    from podcast.services.indexing import schedule_channel_reindex

    schedule_channel_reindex(channel.pk)

    logger.info("Backfill of %s complete: %s", channel.name, result.summary())
    return result
