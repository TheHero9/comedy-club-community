"""yt-dlp channel backfill.

Promoted from tools/youtube-metadata/fetch_video.py, keeping every behaviour that
probe proved on @ivankirkov1 (74 episodes, 0 errors, 2026-08-08):

- `ignore_no_formats_error` so members-only episodes yield full metadata (65/74 -> 74/74)
- tabs ("videos", "streams") only; 🚨 Shorts are NEVER ingested
- 8 parallel workers, ~0.56s per episode
- one dead video never sinks the run

⚠️ This is SCRAPING. Correct for the one-time bulk backfill, never for the daily
sync - the YouTube Data API owns that path (wave 5).

This module returns plain dicts and touches no Django models. Persistence is the
job of podcast.services.ingestion.
"""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from urllib.parse import unquote

from django.conf import settings

from .channel_images import avatar_url as pick_avatar_url
from .channel_images import banner_url as pick_banner_url
from .thumbnails import best_thumbnail_url

logger = logging.getLogger("podcast")

ALL_TABS = ("videos", "shorts", "streams")

# watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID, /live/ID, or a bare 11-char id
VIDEO_ID_PATTERNS = (
    r"(?:v=|/shorts/|/embed/|/live/|/v/|youtu\.be/)([A-Za-z0-9_-]{11})",
    r"^([A-Za-z0-9_-]{11})$",
)

CHANNEL_PATTERNS = (
    r"youtube\.com/(@[\w.-]+)",
    r"youtube\.com/(channel/UC[\w-]+)",
    r"youtube\.com/(c/[\w.-]+)",
    r"youtube\.com/(user/[\w.-]+)",
    r"^(@[\w.-]+)$",
)


class IngestionError(Exception):
    """A failure worth surfacing to the caller."""


class _NullLogger:
    """Swallows yt-dlp's internal chatter; we do our own reporting."""

    def debug(self, msg): pass
    def info(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): pass


@dataclass
class ChannelPayload:
    """Everything a backfill run produces for one channel."""

    youtube_channel_id: str
    name: str
    handle: str = ""
    channel_url: str = ""
    description: str = ""
    # 🚨 Stored, not derived - the avatar hash is opaque. See ingestion/channel_images.py.
    avatar_url: str = ""
    banner_url: str = ""
    subscriber_count: int | None = None
    videos: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# URL parsing
# ---------------------------------------------------------------------------


def normalize_channel_target(value: str) -> str:
    """Accept an @handle, a bare handle, or any channel URL; return a canonical URL."""
    value = (value or "").strip()
    if not value:
        raise IngestionError("No channel given")

    # Cyrillic handles arrive percent-encoded when copied from a browser
    # (youtube.com/@%D0%9A... for youtube.com/@КомедиКлуб...), and "%" defeats
    # every pattern below. Decoding is safe for the ASCII forms too - they
    # contain no escapes, so unquote is a no-op on them.
    if "%" in value:
        value = unquote(value)

    for pattern in CHANNEL_PATTERNS:
        match = re.search(pattern, value)
        if match:
            return f"https://www.youtube.com/{match.group(1)}"

    # A bare handle without the @, e.g. "ivankirkov1"
    if re.fullmatch(r"[\w.-]+", value):
        return f"https://www.youtube.com/@{value}"

    raise IngestionError(f"Could not recognise a YouTube channel: {value!r}")


def extract_video_id(value: str) -> str:
    value = (value or "").strip()
    for pattern in VIDEO_ID_PATTERNS:
        match = re.search(pattern, value)
        if match:
            return match.group(1)
    raise IngestionError(f"Could not recognise a YouTube video: {value!r}")


# ---------------------------------------------------------------------------
# yt-dlp plumbing
# ---------------------------------------------------------------------------


def _ydl_opts(**extra) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignoreerrors": False,
        # 🔓 Members-only videos expose full metadata but no playable formats.
        # Without this, yt-dlp treats "no formats" as fatal and we lose the episode.
        "ignore_no_formats_error": True,
        "logger": _NullLogger(),
    }
    opts.update(extra)
    return opts


def _clean_error(message: str) -> str:
    for line in message.splitlines():
        line = line.strip()
        if line.startswith("ERROR:"):
            return line[len("ERROR:"):].strip()
    stripped = message.strip()
    return stripped.splitlines()[-1] if stripped else "unknown error"


def fetch_video_info(video_id: str) -> dict:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        with YoutubeDL(_ydl_opts()) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as exc:
        raise IngestionError(f"Video unavailable: {_clean_error(str(exc))}") from exc
    if not info:
        raise IngestionError(f"yt-dlp returned nothing for {video_id}")
    return info


def fetch_tab_entries(base_url: str, tab: str, limit: int | None) -> tuple[dict | None, list[dict]]:
    """Flat listing for one channel tab. Cheap: one request per page, no per-video cost.

    ⚠️ Flat entries carry NO upload_date (`timestamp` is null). Dates require a full
    per-video extraction, which is where all the wall-clock time goes.
    """
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    opts = _ydl_opts(extract_flat="in_playlist")
    if limit:
        opts["playlistend"] = limit

    try:
        with YoutubeDL(opts) as ydl:
            playlist = ydl.extract_info(f"{base_url}/{tab}", download=False)
    except DownloadError as exc:
        message = _clean_error(str(exc))
        # An absent tab is normal - not every channel posts streams.
        if "does not have a" in message or "not found" in message.lower():
            logger.info("Channel has no '%s' tab", tab)
            return None, []
        raise IngestionError(f"Channel tab '{tab}' unavailable: {message}") from exc

    if not playlist:
        return None, []

    entries = [e for e in (playlist.get("entries") or []) if e and e.get("id")]
    return playlist, entries


# ---------------------------------------------------------------------------
# Shaping
# ---------------------------------------------------------------------------


def _parse_upload_date(raw) -> str | None:
    """yt-dlp gives YYYYMMDD; normalize to YYYY-MM-DD."""
    raw = str(raw) if raw else ""
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
    return None


def _content_kind(tab: str) -> str:
    return "stream" if tab == "streams" else "video"


def shape_video(info: dict, video_id: str, tab: str, *, verify_thumbnail: bool = True) -> dict:
    """Map raw yt-dlp metadata onto the Episode field names."""
    duration = info.get("duration")
    availability = info.get("availability") or "public"

    return {
        "youtube_id": info.get("id") or video_id,
        "title": (info.get("title") or "").strip(),
        "description": info.get("description") or "",
        "upload_date": _parse_upload_date(info.get("upload_date")),
        "duration_sec": int(duration) if duration is not None else None,
        "thumbnail_url": best_thumbnail_url(
            info.get("id") or video_id, verify=verify_thumbnail
        ),
        "url": f"https://www.youtube.com/watch?v={info.get('id') or video_id}",
        "content_kind": _content_kind(tab),
        "availability": availability,
        "language": (info.get("language") or "")[:8],
        # ⚠️ view_count is absent on members-only videos. Stays None, never 0.
        "view_count": info.get("view_count"),
        "like_count": info.get("like_count"),
        "yt_comment_count": info.get("comment_count"),
        "chapters": [
            {
                "title": (chapter.get("title") or "").strip(),
                "start_sec": int(chapter.get("start_time") or 0),
                "end_sec": int(chapter["end_time"]) if chapter.get("end_time") else None,
            }
            for chapter in (info.get("chapters") or [])
            if chapter.get("title")
        ],
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def fetch_channel(
    target: str,
    *,
    tabs: tuple[str, ...] | None = None,
    limit: int | None = None,
    workers: int | None = None,
    verify_thumbnails: bool = True,
    progress=None,
) -> ChannelPayload:
    """Fetch a channel's long-form episodes across the configured tabs.

    🚨 Defaults to settings.YOUTUBE_INGEST_TABS = ("videos", "streams"). Shorts are
    never included, and passing them explicitly is rejected.
    """
    base_url = normalize_channel_target(target)
    tabs = tuple(tabs or settings.YOUTUBE_INGEST_TABS)
    workers = workers or settings.YOUTUBE_INGEST_WORKERS

    unknown = [t for t in tabs if t not in ALL_TABS]
    if unknown:
        raise IngestionError(f"Unknown tab(s) {unknown}; valid: {', '.join(ALL_TABS)}")
    if "shorts" in tabs:
        raise IngestionError(
            "Shorts are never ingested (owner decision 2026-08-08). "
            "See CLAUDE.md § Ingestion."
        )

    meta: dict = {}
    entries: list[dict] = []
    seen: set[str] = set()

    for tab in tabs:
        playlist, tab_entries = fetch_tab_entries(base_url, tab, limit)
        if playlist and not meta:
            meta = playlist
        fresh = [e for e in tab_entries if e["id"] not in seen]
        seen.update(e["id"] for e in fresh)
        for entry in fresh:
            entry["_tab"] = tab
        entries.extend(fresh)
        logger.info("Tab %s: %d entries", tab, len(fresh))
        if progress:
            progress(f"  {tab}: {len(fresh)}")

    if not meta:
        raise IngestionError(f"No data returned for channel: {base_url}")

    errors: list[dict] = []

    def build_one(entry: dict) -> dict | None:
        video_id = entry["id"]
        tab = entry.get("_tab", "videos")
        try:
            return shape_video(
                fetch_video_info(video_id), video_id, tab,
                verify_thumbnail=verify_thumbnails,
            )
        except IngestionError as exc:
            # One dead video must never sink the whole run.
            logger.warning("Skipped %s: %s", video_id, exc)
            errors.append({"youtube_id": video_id, "error": str(exc)})
            return None

    if progress:
        progress(f"Fetching full metadata for {len(entries)} videos...")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        videos = [video for video in pool.map(build_one, entries) if video]

    channel_id = meta.get("channel_id") or meta.get("uploader_id") or meta.get("id") or ""
    handle = ""
    match = re.search(r"@([\w.-]+)", meta.get("uploader_url") or base_url)
    if match:
        handle = f"@{match.group(1)}"

    thumbnails = meta.get("thumbnails") or []

    return ChannelPayload(
        youtube_channel_id=channel_id,
        name=meta.get("channel") or meta.get("uploader") or meta.get("title") or handle,
        handle=handle,
        channel_url=meta.get("channel_url") or base_url,
        description=meta.get("description") or "",
        avatar_url=pick_avatar_url(thumbnails),
        banner_url=pick_banner_url(thumbnails),
        subscriber_count=meta.get("channel_follower_count"),
        videos=videos,
        errors=errors,
    )
