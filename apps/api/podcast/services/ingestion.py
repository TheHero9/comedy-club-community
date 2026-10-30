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

    # Listed on the channel but on `podcast/data/removed-episodes.txt`, so not written.
    excluded: int = 0

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
            f"{self.degraded} degraded, {self.excluded} excluded"
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

    # Absent means "unknown", never "reset to default" - same rule as
    # upsert_channel's avatar. The Data API sync path cannot see availability at
    # all, and letting its absence fall through to the "public" default would
    # flip a stored members-only episode to public on every nightly sync.
    if existing:
        if not data.get("availability"):
            defaults.pop("availability", None)
        if not data.get("thumbnail_url"):
            defaults.pop("thumbnail_url", None)

    episode, created = Episode.objects.update_or_create(
        youtube_id=data["youtube_id"], defaults=defaults
    )

    return episode, created, upsert_chapters(episode, chapters)


def upsert_chapters(episode: Episode, chapters: list[dict]) -> int:
    """Write chapters keyed on their start second. Returns how many are new.

    ⚠️ Opportunistic only - the probe found 0 of 12 episodes with chapters.
    """
    chapters_created = 0
    for chapter in chapters:
        _, made = Chapter.objects.update_or_create(
            episode=episode,
            start_sec=chapter["start_sec"],
            defaults={"title": chapter["title"][:300], "end_sec": chapter.get("end_sec")},
        )
        chapters_created += int(made)
    return chapters_created


@dataclass
class UploadCandidate:
    """One video the Data API listed on a channel's videos or streams tab."""

    youtube_id: str
    kind: str
    details: dict  # one `youtube_api.video_details` entry
    is_new: bool

    @property
    def title(self) -> str:
        return self.details.get("title") or ""

    @property
    def duration_sec(self) -> int | None:
        return self.details.get("duration_sec")

    @property
    def upload_date(self) -> str | None:
        return self.details.get("upload_date")

    @property
    def is_unfinished(self) -> bool:
        """A scheduled premiere or a stream that is live right now: listed, not an episode yet."""
        return self.details.get("live_status") in ("upcoming", "live")


@dataclass
class UploadListing:
    """What a channel's tabs hold right now, before anything is written."""

    channel: Channel
    candidates: list[UploadCandidate] = field(default_factory=list)
    # On the exclusion list - never written, and never asked about again.
    excluded: list[str] = field(default_factory=list)
    # Listed in the playlist but absent from `videos.list`: deleted or private.
    invisible: list[str] = field(default_factory=list)
    # Tabs where EVERY listed id was new, so older uploads may sit past `limit`.
    window_full: list[str] = field(default_factory=list)

    @property
    def new(self) -> list[UploadCandidate]:
        return [candidate for candidate in self.candidates if candidate.is_new]


def list_channel_uploads(channel: Channel, *, limit: int | None = 50) -> UploadListing:
    """List the newest uploads of one KNOWN channel through the Data API. Writes nothing.

    Uses the derived `UULF` (videos tab) / `UULV` (streams tab) playlists, so
    Shorts stay structurally excluded - same guarantee as yt-dlp's tab listing.
    Costs ~1 quota unit per playlist page plus 1 per 50 ids.
    """
    from podcast.data import removed_episode_ids
    from podcast.ingestion.youtube_api import (
        playlist_video_ids,
        uploads_playlists,
        video_details,
    )

    listing = UploadListing(channel=channel)
    playlists = uploads_playlists(channel.youtube_channel_id)

    kind_by_id: dict[str, str] = {}
    listed_by_kind: dict[str, list[str]] = {}
    for kind, playlist_id in (
        (Episode.ContentKind.VIDEO, playlists["videos"]),
        (Episode.ContentKind.STREAM, playlists["streams"]),
    ):
        listed = playlist_video_ids(playlist_id, limit=limit)
        listed_by_kind[kind] = listed
        for video_id in listed:
            kind_by_id.setdefault(video_id, kind)

    excluded = removed_episode_ids()
    listing.excluded = [video_id for video_id in kind_by_id if video_id in excluded]
    for video_id in listing.excluded:
        del kind_by_id[video_id]

    details = video_details(kind_by_id)
    known_ids = set(
        Episode.objects.filter(youtube_id__in=kind_by_id).values_list(
            "youtube_id", flat=True
        )
    )

    for video_id, kind in kind_by_id.items():
        info = details.get(video_id)
        if not info:
            listing.invisible.append(video_id)  # deleted/private - never guess
            continue
        listing.candidates.append(
            UploadCandidate(
                youtube_id=video_id, kind=kind, details=info, is_new=video_id not in known_ids
            )
        )

    for kind, listed in listed_by_kind.items():
        if limit and len(listed) >= limit and not known_ids.intersection(listed):
            listing.window_full.append(kind)

    return listing


def persist_uploads(
    channel: Channel, candidates: list[UploadCandidate], result: IngestionResult
) -> list[Episode]:
    """Upsert listed uploads into `result`. Returns the episodes CREATED.

    ⚠️ The API never STATES availability (it returns members-only videos but
    nothing in the response says so - measured 2026-08-13). Existing rows keep
    their stored availability via `upsert_episode`'s absent-means-unknown
    guards; a brand-new members-only episode lands flagged public until a
    yt-dlp pass states otherwise (`services/new_episodes.enrich_episode`).
    """
    from podcast.ingestion.thumbnails import best_thumbnail_url

    created_episodes: list[Episode] = []
    for candidate in candidates:
        info = candidate.details
        data = {
            "youtube_id": candidate.youtube_id,
            "title": info["title"],
            "description": info["description"],
            "upload_date": info["upload_date"],
            "duration_sec": info["duration_sec"],
            "url": f"https://www.youtube.com/watch?v={candidate.youtube_id}",
            "content_kind": candidate.kind,
            "view_count": info["view_count"],
            "like_count": info["like_count"],
            "yt_comment_count": info["yt_comment_count"],
            # availability deliberately absent for existing rows - the API cannot
            # see it, and upsert_episode keeps the stored value.
        }
        if candidate.is_new:
            data["availability"] = Episode.Availability.PUBLIC
            data["thumbnail_url"] = best_thumbnail_url(candidate.youtube_id)

        try:
            episode, created, chapters = upsert_episode(channel, data)
        except Exception as exc:
            logger.exception("Sync failed to persist %s", candidate.youtube_id)
            result.errors.append({"youtube_id": candidate.youtube_id, "error": str(exc)})
            continue
        result.created += int(created)
        result.updated += int(not created)
        result.chapters_created += chapters
        if created:
            created_episodes.append(episode)
    return created_episodes


def finish_channel_sync(channel: Channel, result: IngestionResult) -> None:
    """Measure what was written, and stamp the channel as synced."""
    from podcast.services.metadata_repair import degraded_queryset

    result.degraded = degraded_queryset(channel).count()
    channel.last_synced_at = timezone.now()
    channel.save(update_fields=["last_synced_at"])


def sync_channel_via_api(channel: Channel, *, limit: int | None = 50) -> IngestionResult:
    """Daily sync of one KNOWN channel through the YouTube Data API.

    🎯 The intended steady state for the recurring sync: quota-based (a few
    units per channel per day), immune to the yt-dlp soft-block, and TOS-blessed.
    The yt-dlp path remains for one-time backfills and metadata repair.

    Writes every listed upload except excluded ones, with no review step. A
    person reviewing new uploads first uses `manage.py sync_new_episodes`.
    """
    listing = list_channel_uploads(channel, limit=limit)
    result = IngestionResult(channel=channel, excluded=len(listing.excluded))
    # A premiere still counting down would land with a duration of 0. The run
    # after it airs picks it up as an ordinary new upload.
    ready = [c for c in listing.candidates if not (c.is_new and c.is_unfinished)]
    persist_uploads(channel, ready, result)
    finish_channel_sync(channel, result)

    from podcast.services.indexing import schedule_channel_reindex

    schedule_channel_reindex(channel.pk)

    logger.info("API sync of %s complete: %s", channel.name, result.summary())
    return result


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
    from podcast.data import removed_episode_ids

    payload = fetch_channel(
        target, limit=limit, verify_thumbnails=verify_thumbnails, progress=progress
    )
    result = IngestionResult(errors=list(payload.errors))

    # 🚨 Same guard as the Data API path: a purged promo clip still sits on its
    # channel's videos tab, and this loop would otherwise recreate it.
    excluded = removed_episode_ids()
    videos = [data for data in payload.videos if data.get("youtube_id") not in excluded]
    result.excluded = len(payload.videos) - len(videos)

    if dry_run:
        result.skipped = len(videos)
        logger.info("Dry run: would upsert %d episodes", len(videos))
        return result

    channel = upsert_channel(payload)
    result.channel = channel

    for data in videos:
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
    finish_channel_sync(channel, result)

    # Newly ingested episodes are invisible to search until indexed.
    from podcast.services.indexing import schedule_channel_reindex

    schedule_channel_reindex(channel.pk)

    logger.info("Backfill of %s complete: %s", channel.name, result.summary())
    return result
