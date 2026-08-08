"""YouTube thumbnail URLs.

🚨 Thumbnails are NEVER uploaded or mirrored. They live at a deterministic Google
CDN URL derived from the 11-character video id: zero API calls, zero rate limits,
zero storage cost. Mirroring them to R2 would add cost and staleness for no gain.

Probe result (@ivankirkov1, 2026-08-08): maxresdefault existed for 74/74 episodes,
so the hqdefault fallback never fired. Keep the fallback anyway - older uploads on
other channels will need it.
"""

import logging
import urllib.error
import urllib.request

logger = logging.getLogger("podcast")

THUMB_PATTERN = "https://img.youtube.com/vi/{video_id}/{quality}.jpg"

MAXRES = "maxresdefault"  # 1280x720, not present on every video
HQDEFAULT = "hqdefault"  # 480x360, guaranteed to exist


def thumbnail_url(video_id: str, quality: str = MAXRES) -> str:
    return THUMB_PATTERN.format(video_id=video_id, quality=quality)


def _url_exists(url: str, timeout: float = 5.0) -> bool:
    request = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status == 200
    except (urllib.error.HTTPError, urllib.error.URLError, OSError):
        return False


def best_thumbnail_url(video_id: str, *, verify: bool = True) -> str:
    """Best available thumbnail URL for a video.

    A HEAD request is enough to test presence - never download the image. Pass
    verify=False to skip the network call and optimistically assume maxresdefault
    (useful in tests and bulk dry-runs).
    """
    if not video_id:
        return ""
    if not verify:
        return thumbnail_url(video_id, MAXRES)
    if _url_exists(thumbnail_url(video_id, MAXRES)):
        return thumbnail_url(video_id, MAXRES)
    logger.debug("No maxresdefault for %s, falling back to hqdefault", video_id)
    return thumbnail_url(video_id, HQDEFAULT)
