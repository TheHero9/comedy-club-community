"""YouTube Data API v3 client - the quota-based, never-soft-blocked path.

🎯 Why this exists (2026-08-13): yt-dlp scraping gets soft-blocked by IP
reputation, silently degrading responses for HOURS. The Data API has a
documented quota instead (10,000 units/day free; a `videos.list` batch of 50
costs 1 unit), so it can repair degraded rows and run the daily sync while the
scraping path is blocked.

⚠️ What the Data API CANNOT state: **availability.** Measured 2026-08-13 on all
1,961 rows: members-only videos ARE returned by `videos.list` (all 55 of ours
came back, durations intact) - but nothing in the response says they are
members-only. So:
- this module never writes `availability` - only yt-dlp states it explicitly;
- an id absent from a response means deleted/private, and callers treat
  absence as "unknown", never as data.

Uses stdlib urllib only - no new dependency for three GET endpoints.
"""

from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Iterable

from django.conf import settings

logger = logging.getLogger("podcast")

API_BASE = "https://www.googleapis.com/youtube/v3"

# videos.list accepts at most 50 ids per call.
BATCH_SIZE = 50

_DURATION_RE = re.compile(
    r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
)


class YouTubeAPIError(Exception):
    """A Data API failure worth surfacing (bad key, quota exhausted, network)."""


def parse_iso8601_duration(value: str | None) -> int | None:
    """`PT33M14S` -> 1994. Live/upcoming videos report `P0D` -> 0."""
    if not value:
        return None
    match = _DURATION_RE.match(value)
    if not match:
        logger.warning("Unparseable ISO8601 duration: %r", value)
        return None
    parts = {k: int(v or 0) for k, v in match.groupdict().items()}
    return (
        parts["days"] * 86400
        + parts["hours"] * 3600
        + parts["minutes"] * 60
        + parts["seconds"]
    )


def _get(endpoint: str, **params) -> dict:
    if not settings.YOUTUBE_API_KEY:
        raise YouTubeAPIError("YOUTUBE_API_KEY is not set")
    params["key"] = settings.YOUTUBE_API_KEY
    url = f"{API_BASE}/{endpoint}?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            detail = json.load(exc).get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001 - the error body is best-effort
            detail = ""
        raise YouTubeAPIError(f"{endpoint} HTTP {exc.code}: {detail or exc.reason}") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise YouTubeAPIError(f"{endpoint} failed: {exc}") from exc


def video_details(video_ids: Iterable[str]) -> dict[str, dict]:
    """Full metadata for many videos, keyed by id, in batches of 50.

    🚨 Ids absent from the result were not visible to the API: members-only,
    deleted, or private. The caller must treat absence as "unknown", never as
    data. Statistics YouTube hides (e.g. like counts) arrive as None.
    """
    ids = [v for v in dict.fromkeys(video_ids) if v]  # dedupe, keep order
    out: dict[str, dict] = {}

    for start in range(0, len(ids), BATCH_SIZE):
        batch = ids[start : start + BATCH_SIZE]
        data = _get(
            "videos",
            part="contentDetails,statistics,snippet,liveStreamingDetails",
            id=",".join(batch),
            maxResults=BATCH_SIZE,
        )
        for item in data.get("items", []):
            stats = item.get("statistics", {})
            snippet = item.get("snippet", {})
            published = (snippet.get("publishedAt") or "")[:10]  # 2026-08-13T...
            out[item["id"]] = {
                "youtube_id": item["id"],
                "title": snippet.get("title") or "",
                "description": snippet.get("description") or "",
                "upload_date": published or None,
                "duration_sec": parse_iso8601_duration(
                    item.get("contentDetails", {}).get("duration")
                ),
                "view_count": int(stats["viewCount"]) if "viewCount" in stats else None,
                "like_count": int(stats["likeCount"]) if "likeCount" in stats else None,
                "yt_comment_count": (
                    int(stats["commentCount"]) if "commentCount" in stats else None
                ),
                "is_stream": "liveStreamingDetails" in item,
            }
    return out


def uploads_playlists(youtube_channel_id: str) -> dict[str, str]:
    """The tab-equivalent playlists, derived from the channel id.

    A channel `UCxxxx` publishes derived playlists: `UULFxxxx` (long-form
    videos tab) and `UULVxxxx` (past live streams tab). Using these instead of
    the full uploads playlist (`UUxxxx`) is what keeps Shorts structurally
    excluded from the API sync path - same guarantee as yt-dlp's tab listing.
    """
    if not youtube_channel_id.startswith("UC"):
        raise YouTubeAPIError(f"Not a channel id: {youtube_channel_id!r}")
    suffix = youtube_channel_id[2:]
    return {"videos": f"UULF{suffix}", "streams": f"UULV{suffix}"}


def playlist_video_ids(playlist_id: str, *, limit: int | None = None) -> list[str]:
    """Newest-first video ids in a playlist. A missing playlist is empty, not
    an error - channels with no streams have no UULV playlist at all."""
    ids: list[str] = []
    page_token = ""

    while True:
        params = {
            "part": "contentDetails",
            "playlistId": playlist_id,
            "maxResults": min(BATCH_SIZE, limit or BATCH_SIZE),
        }
        if page_token:
            params["pageToken"] = page_token
        try:
            data = _get("playlistItems", **params)
        except YouTubeAPIError as exc:
            if "404" in str(exc):
                return []
            raise

        for item in data.get("items", []):
            video_id = item.get("contentDetails", {}).get("videoId")
            if video_id:
                ids.append(video_id)
                if limit and len(ids) >= limit:
                    return ids

        page_token = data.get("nextPageToken", "")
        if not page_token:
            return ids
