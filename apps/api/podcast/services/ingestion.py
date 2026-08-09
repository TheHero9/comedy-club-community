"""Persisting fetched YouTube metadata.

The ONE place episodes are written. Both the management command and (from wave 5)
the Celery task call in here, so CLI and scheduler can never drift apart.

Idempotency is the contract: every write is `update_or_create` keyed on the external
`youtube_id`, so an interrupted run costs nothing and a repeat run changes no counts.
"""

from __future__ import annotations

import logging
import re
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

    # 🚨 Rows written from a throttled, reduced YouTube response. NOT errors - the run
    # succeeded and yt-dlp never raised. Counting these is the only honest completeness
    # signal a backfill has; `len(errors)` says nothing. See services/metadata_repair.py.
    degraded: int = 0

    @property
    def total(self) -> int:
        return self.created + self.updated

    @property
    def is_complete(self) -> bool:
        return self.degraded == 0 and not self.errors

    def summary(self) -> str:
        return (
            f"{self.total} episodes ({self.created} created, {self.updated} updated), "
            f"{self.chapters_created} chapters, {len(self.errors)} errors, "
            f"{self.degraded} degraded"
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

    defaults = {
        "name": payload.name or payload.handle or payload.youtube_channel_id,
        "handle": payload.handle,
        "description": payload.description,
    }

    # 🚨 Only write images/subscribers when we actually got them. A throttled or
    # partial response yields empty strings, and blanking a good avatar because one
    # sync came back thin is exactly the failure the 2026-08-09 backfill taught us
    # to design against. Absent means "unknown", never "clear it".
    if payload.avatar_url:
        defaults["avatar_url"] = payload.avatar_url
    if payload.banner_url:
        defaults["banner_url"] = payload.banner_url
    if payload.subscriber_count is not None:
        defaults["subscriber_count"] = payload.subscriber_count

    channel, created = Channel.objects.update_or_create(
        youtube_channel_id=payload.youtube_channel_id, defaults=defaults
    )
    logger.info("%s channel %s", "Created" if created else "Updated", channel.name)
    return channel


def refresh_channel_metadata(target: str) -> Channel:
    """Update one channel's name, avatar, banner and subscriber count. No episodes.

    Costs a single flat listing request (`playlistend=1`), so it is cheap enough to run
    often - unlike `backfill_channel`, which re-extracts every video.

    Use it to populate avatars for channels that were ingested before avatar support
    existed, and to refresh an avatar after a channel changes its picture (the URL is
    an opaque hash, so a changed picture means a changed URL - see
    ingestion/channel_images.py).
    """
    from podcast.ingestion.channel_images import avatar_url as pick_avatar_url
    from podcast.ingestion.channel_images import banner_url as pick_banner_url
    from podcast.ingestion.yt_dlp_backfill import (
        IngestionError,
        fetch_tab_entries,
        normalize_channel_target,
    )

    base_url = normalize_channel_target(target)
    meta, _ = fetch_tab_entries(base_url, "videos", 1)
    if not meta:
        raise IngestionError(f"No channel metadata returned for {base_url}")

    handle = ""
    match = re.search(r"@([\w.-]+)", meta.get("uploader_url") or base_url)
    if match:
        handle = f"@{match.group(1)}"

    thumbnails = meta.get("thumbnails") or []
    payload = ChannelPayload(
        youtube_channel_id=(
            meta.get("channel_id") or meta.get("uploader_id") or meta.get("id") or ""
        ),
        name=meta.get("channel") or meta.get("uploader") or meta.get("title") or handle,
        handle=handle,
        channel_url=meta.get("channel_url") or base_url,
        description=meta.get("description") or "",
        avatar_url=pick_avatar_url(thumbnails),
        banner_url=pick_banner_url(thumbnails),
        subscriber_count=meta.get("channel_follower_count"),
    )
    return upsert_channel(payload)


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

    # 🚨 Never let a throttled response DOWNGRADE a row we already got right.
    #
    # A reduced response carries no duration, and `availability` silently falls back to
    # "public" above. Writing that over an existing good row would turn a re-run - or
    # the daily sync - into data loss: a members-only episode would flip to public and
    # its duration would vanish. `update_or_create` alone is idempotent in row COUNT,
    # not in row QUALITY.
    #
    # A brand new episode still gets written as-is; `IngestionResult.degraded` counts it
    # and the command tells the operator to run `repair_metadata`.
    existing = Episode.objects.filter(youtube_id=data["youtube_id"]).first()
    if existing and data.get("duration_sec") is None:
        for volatile in ("duration_sec", "availability", "view_count", "like_count",
                         "yt_comment_count"):
            defaults.pop(volatile, None)
        logger.info(
            "Throttled response for existing %s - keeping stored metadata",
            data["youtube_id"],
        )

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

    # 🚨 The completeness check the 2026-08-09 backfill did not have. A throttled run
    # finishes with 0 errors while silently dropping duration/availability, so the run
    # MUST measure what it actually wrote rather than trusting its own error count.
    from podcast.services.metadata_repair import degraded_queryset

    result.degraded = degraded_queryset(channel).count()

    channel.last_synced_at = timezone.now()
    channel.save(update_fields=["last_synced_at"])

    # Newly ingested episodes are invisible to search until indexed.
    from podcast.services.indexing import schedule_channel_reindex

    schedule_channel_reindex(channel.pk)

    logger.info("Backfill of %s complete: %s", channel.name, result.summary())
    return result
