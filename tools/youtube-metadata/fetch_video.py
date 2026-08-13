#!/usr/bin/env python3
"""Fetch YouTube metadata for a single video or an entire channel, as JSON.

Usage:
    python fetch_video.py                                       # sample video
    python fetch_video.py "https://youtu.be/FP1P8XXYzvE"        # one video
    python fetch_video.py "https://www.youtube.com/@ivankirkov1"  # channel: videos + streams
    python fetch_video.py "<channel>" --tabs all                # add Shorts as well
    python fetch_video.py "<channel>" --fast                    # skip upload dates (much faster)
    python fetch_video.py "<channel>" --limit 10 -o videos.json

Requires yt-dlp (installed automatically on first run if missing).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

DEFAULT_URL = "https://www.youtube.com/watch?v=FP1P8XXYzvE"
THUMB_PATTERN = "https://img.youtube.com/vi/{id}/{quality}.jpg"
MAX_WORKERS = 8

# watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID, /live/ID, or a bare 11-char ID
VIDEO_ID_PATTERNS = [
    r"(?:v=|/shorts/|/embed/|/live/|/v/|youtu\.be/)([A-Za-z0-9_-]{11})",
    r"^([A-Za-z0-9_-]{11})$",
]

# @handle, /channel/UC..., /c/name, /user/name, or a bare @handle
CHANNEL_PATTERNS = [
    r"youtube\.com/(@[\w.-]+)",
    r"youtube\.com/(channel/UC[\w-]+)",
    r"youtube\.com/(c/[\w.-]+)",
    r"youtube\.com/(user/[\w.-]+)",
    r"^(@[\w.-]+)$",
]

# A channel's "N videos" badge counts all three tabs; /videos alone is only long-form.
ALL_TABS = ("videos", "shorts", "streams")
# Long-form content - members-only videos already live inside these two tabs.
DEFAULT_TABS = ("videos", "streams")


class FetchError(Exception):
    """Anything that should be reported to the user as a clean JSON error."""


class _NullLogger:
    """Swallows yt-dlp's internal logging so only our JSON reaches the console."""

    def debug(self, msg): pass
    def info(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): pass


# --------------------------------------------------------------------------
# URL parsing
# --------------------------------------------------------------------------

def classify_target(url: str) -> tuple[str, str, str | None]:
    """Return ("video", video_id, None) or ("channel", base_url, explicit_tab_or_None)."""
    url = url.strip()

    # Cyrillic handles arrive percent-encoded when copied from a browser and
    # "%" defeats every pattern below. A no-op for plain ASCII targets.
    if "%" in url:
        url = urllib.parse.unquote(url)

    for pattern in VIDEO_ID_PATTERNS:
        match = re.search(pattern, url)
        if match:
            return "video", match.group(1), None

    for pattern in CHANNEL_PATTERNS:
        match = re.search(pattern, url)
        if match:
            base = f"https://www.youtube.com/{match.group(1)}"
            tab_match = re.search(r"/(videos|shorts|streams|live)\b", url)
            tab = tab_match.group(1) if tab_match else None
            return "channel", base, ("streams" if tab == "live" else tab)

    raise FetchError(f"Could not recognise a YouTube video or channel URL: {url!r}")


def resolve_tabs(url_tab: str | None, requested: str | None) -> list[str]:
    """Long-form (videos + streams) by default; --tabs all adds Shorts. A /videos URL
    is usually just the page the user was on, so it does not narrow on its own."""
    if not requested:
        return list(DEFAULT_TABS)
    if requested.strip().lower() == "all":
        return list(ALL_TABS)
    if requested.strip().lower() == "url":
        return [url_tab] if url_tab else list(ALL_TABS)
    tabs = [t.strip().lower() for t in requested.split(",") if t.strip()]
    unknown = [t for t in tabs if t not in ALL_TABS]
    if unknown:
        raise FetchError(f"Unknown tab(s) {unknown}; valid: {', '.join(ALL_TABS)} or 'all'")
    return tabs


# --------------------------------------------------------------------------
# yt-dlp plumbing
# --------------------------------------------------------------------------

def ensure_yt_dlp() -> None:
    """Import yt-dlp, installing it into the current interpreter if absent."""
    try:
        import yt_dlp  # noqa: F401
        return
    except ImportError:
        pass

    print("yt-dlp not found - installing...", file=sys.stderr)
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "yt-dlp"],
            check=True,
        )
    except (subprocess.CalledProcessError, OSError) as exc:
        raise FetchError(f"Failed to install yt-dlp: {exc}") from exc

    try:
        import yt_dlp  # noqa: F401
    except ImportError as exc:
        raise FetchError("yt-dlp installed but could not be imported") from exc


def _ydl_opts(**extra) -> dict:
    # Silence yt-dlp's own stderr output - we re-report failures ourselves.
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignoreerrors": False,
        # Members-only videos expose full metadata but no playable formats. Without
        # this, yt-dlp treats "no formats" as fatal and we lose title/date/duration.
        "ignore_no_formats_error": True,
        "logger": _NullLogger(),
    }
    opts.update(extra)
    return opts


def fetch_video_info(video_id: str) -> dict:
    """Primary path: yt-dlp Python API. Fallback: yt-dlp CLI via subprocess."""
    url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError
    except ImportError:
        return _fetch_video_info_cli(url)

    try:
        with YoutubeDL(_ydl_opts()) as ydl:
            return ydl.extract_info(url, download=False)
    except DownloadError as exc:
        raise FetchError(f"Video unavailable: {_clean_yt_dlp_error(str(exc))}") from exc


def _fetch_video_info_cli(url: str) -> dict:
    try:
        result = subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--dump-json", "--skip-download",
             "--ignore-no-formats-error", url],
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        raise FetchError(f"Could not run yt-dlp: {exc}") from exc

    if result.returncode != 0:
        raise FetchError(f"Video unavailable: {_clean_yt_dlp_error(result.stderr)}")

    try:
        return json.loads(result.stdout.splitlines()[0])
    except (ValueError, IndexError) as exc:
        raise FetchError("yt-dlp returned no parseable JSON") from exc


def fetch_tab_entries(base_url: str, tab: str, limit: int | None) -> tuple[dict | None, list[dict]]:
    """Flat playlist listing for one channel tab - cheap, no per-video cost."""
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    opts = _ydl_opts(extract_flat="in_playlist")
    if limit:
        opts["playlistend"] = limit

    try:
        with YoutubeDL(opts) as ydl:
            playlist = ydl.extract_info(f"{base_url}/{tab}", download=False)
    except DownloadError as exc:
        message = _clean_yt_dlp_error(str(exc))
        # An empty/absent tab is normal (not every channel posts Shorts or streams).
        if "does not have a" in message or "not found" in message.lower():
            return None, []
        raise FetchError(f"Channel tab '{tab}' unavailable: {message}") from exc

    if not playlist:
        return None, []

    entries = [e for e in (playlist.get("entries") or []) if e and e.get("id")]
    return playlist, entries


def fetch_channel_entries(base_url: str, tabs: list[str], limit: int | None) -> tuple[dict, list[dict]]:
    """Collect entries across the requested tabs, tagging and de-duplicating by id."""
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
        print(f"  {tab}: {len(fresh)}", file=sys.stderr)

    if not meta:
        raise FetchError(f"No data returned for channel: {base_url}")
    return meta, entries


def _clean_yt_dlp_error(message: str) -> str:
    for line in message.splitlines():
        line = line.strip()
        if line.startswith("ERROR:"):
            return line[len("ERROR:"):].strip()
    return message.strip().splitlines()[-1] if message.strip() else "unknown error"


# --------------------------------------------------------------------------
# Thumbnails
# --------------------------------------------------------------------------

def url_exists(url: str, timeout: float = 5.0) -> bool:
    request = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status == 200
    except (urllib.error.HTTPError, urllib.error.URLError, OSError):
        return False


def build_thumbnail_url(video_id: str) -> str:
    maxres = THUMB_PATTERN.format(id=video_id, quality="maxresdefault")
    if url_exists(maxres):
        return maxres
    return THUMB_PATTERN.format(id=video_id, quality="hqdefault")


# --------------------------------------------------------------------------
# Shaping
# --------------------------------------------------------------------------

def _format_date(raw) -> str | None:
    """yt-dlp gives YYYYMMDD - normalize to YYYY-MM-DD."""
    raw = str(raw) if raw else None
    if raw and len(raw) == 8 and raw.isdigit():
        return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
    return raw


def shape_video(info: dict, video_id: str | None = None, channel_fallback: str | None = None,
                tab: str | None = None) -> dict:
    duration = info.get("duration")
    shaped = {
        "id": info.get("id") or video_id,
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader") or channel_fallback,
        "duration_sec": int(duration) if duration is not None else None,
        "upload_date": _format_date(info.get("upload_date")),
        "thumbnail_url": build_thumbnail_url(info.get("id") or video_id),
    }
    if tab:
        shaped["tab"] = tab
    availability = info.get("availability")
    if availability:
        shaped["availability"] = availability          # public | subscriber_only | unlisted | ...
        shaped["members_only"] = availability == "subscriber_only"
    return shaped


def build_video_payload(video_id: str) -> dict:
    return shape_video(fetch_video_info(video_id), video_id)


def build_channel_payload(base_url: str, tabs: list[str], limit: int | None, fast: bool) -> dict:
    print(f"Listing tabs: {', '.join(tabs)}", file=sys.stderr)
    playlist, entries = fetch_channel_entries(base_url, tabs, limit)
    channel_name = playlist.get("channel") or playlist.get("uploader") or playlist.get("title")

    mode = "flat listing (no upload dates)" if fast else "full metadata"
    print(f"Found {len(entries)} videos - fetching {mode}...", file=sys.stderr)

    def build_one(entry: dict) -> dict:
        video_id = entry["id"]
        tab = entry.get("_tab")
        if fast:
            # Flat entries already carry title + duration; upload_date is not exposed.
            return shape_video(entry, video_id, channel_name, tab)
        try:
            return shape_video(fetch_video_info(video_id), video_id, channel_name, tab)
        except FetchError as exc:
            # One dead video must not sink the whole channel dump.
            print(f"  ! skipped {video_id}: {exc}", file=sys.stderr)
            return {
                "id": video_id,
                "title": entry.get("title"),
                "channel": channel_name,
                "duration_sec": None,
                "upload_date": None,
                "thumbnail_url": build_thumbnail_url(video_id),
                "tab": tab,
                "error": str(exc),
            }

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        videos = list(pool.map(build_one, entries))

    counts = {tab: sum(1 for v in videos if v.get("tab") == tab) for tab in tabs}
    return {
        "channel": channel_name,
        "channel_id": playlist.get("channel_id") or playlist.get("id"),
        "channel_url": playlist.get("channel_url") or base_url,
        "tabs": tabs,
        "counts_by_tab": counts,
        "video_count": len(videos),
        "videos": videos,
    }


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch YouTube metadata for a video or a whole channel as JSON."
    )
    parser.add_argument("url", nargs="?", default=DEFAULT_URL,
                        help="Video URL/ID or channel URL/@handle")
    parser.add_argument("--fast", action="store_true",
                        help="Channel mode: skip per-video lookups (no upload_date, much faster)")
    parser.add_argument("--limit", type=int, default=None,
                        help="Channel mode: only the N most recent entries per tab")
    parser.add_argument("--tabs", default=None,
                        help="Channel mode: comma list of videos,shorts,streams (or 'all'). "
                             "Default: videos,streams (long-form, members-only included)")
    parser.add_argument("-o", "--out", default=None,
                        help="Write JSON to this file instead of stdout")
    return parser.parse_args(argv[1:])


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    try:
        kind, target, url_tab = classify_target(args.url)
        ensure_yt_dlp()
        if kind == "video":
            payload = build_video_payload(target)
        else:
            tabs = resolve_tabs(url_tab, args.tabs)
            payload = build_channel_payload(target, tabs, args.limit, args.fast)
    except FetchError as exc:
        json.dump({"error": str(exc)}, sys.stdout, indent=2)
        print()
        return 1
    except KeyboardInterrupt:
        print("Aborted.", file=sys.stderr)
        return 130

    text = json.dumps(payload, indent=2, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
