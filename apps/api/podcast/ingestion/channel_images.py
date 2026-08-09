"""Channel avatar and banner URLs.

🚨 **These are the one image type we DO store a URL for**, and the reason is worth
stating because it looks like it contradicts the thumbnail rule.

An episode thumbnail is *derivable*: `img.youtube.com/vi/{video_id}/maxresdefault.jpg`.
We store the 11-character video id and build the URL at render time, so there is
nothing to go stale.

A channel avatar is **not derivable**. It lives at an opaque content hash:

    https://yt3.googleusercontent.com/vxV5E97pcJ7t-Cst...KDBmA=s480-c-k-c0x00ffffff-no-rj

Nothing in the channel id, handle or name produces that hash. The only way to know it
is to ask YouTube, so the URL itself is the data and must be persisted.

What stays the same as thumbnails: ❌ **we still never mirror the image to R2.** Google's
CDN serves it free, and `upsert_channel` refreshes the URL on every sync, so a channel
that changes its picture self-heals on the next run.

⚠️ The hash changes when the owner changes their avatar, so a stored URL can 404 if a
channel goes un-synced for a long time. The UI must therefore always keep a fallback for
a missing or broken avatar - never assume the image loads.

Size is a suffix after `=`, which we re-derive rather than trusting whatever size
yt-dlp happened to list. Verified live against @ivankirkov1 (2026-08-09):

    =s176-c-k-c0x00ffffff-no-rj ->  13 KB
    =s480-c-k-c0x00ffffff-no-rj ->  81 KB
    =s900-c-k-c0x00ffffff-no-rj -> 184 KB
    =s0                         -> 277 KB (uncropped original)
"""

from __future__ import annotations

import logging

logger = logging.getLogger("podcast")

# `c` crops to a square, which is how YouTube itself renders an avatar.
AVATAR_SPEC = "s{size}-c-k-c0x00ffffff-no-rj"

# 480 is deliberate: the avatar renders at 44-88 CSS px, so 480 covers even a 3x
# display with room to spare while staying under 100 KB. next/image downscales it.
DEFAULT_AVATAR_SIZE = 480

# A banner is a wide crop, not a square, so it gets no `-c`.
BANNER_SPEC = "w{width}-no-rj"
DEFAULT_BANNER_WIDTH = 1707


def _base_url(url: str) -> str:
    """Strip Google's size/crop suffix, leaving the immutable content hash URL."""
    return (url or "").split("=", 1)[0]


def _is_square(thumbnail: dict) -> bool:
    width, height = thumbnail.get("width"), thumbnail.get("height")
    return bool(width and height and width == height)


def _is_wide(thumbnail: dict) -> bool:
    width, height = thumbnail.get("width"), thumbnail.get("height")
    return bool(width and height and width >= height * 2)


def _largest(thumbnails: list[dict]) -> dict | None:
    sized = [t for t in thumbnails if t.get("width")]
    return max(sized, key=lambda t: t["width"]) if sized else None


def avatar_url(thumbnails: list[dict] | None, *, size: int = DEFAULT_AVATAR_SIZE) -> str:
    """Pick the channel avatar and normalize it to a square of `size` px.

    yt-dlp labels the original `avatar_uncropped`. That entry carries no width/height,
    so the squareness test is the fallback for channels where the label is absent.
    """
    thumbnails = thumbnails or []

    chosen = next((t for t in thumbnails if t.get("id") == "avatar_uncropped"), None)
    if chosen is None:
        chosen = _largest([t for t in thumbnails if _is_square(t)])
    if chosen is None or not chosen.get("url"):
        logger.info("No channel avatar found among %d thumbnails", len(thumbnails))
        return ""

    return f"{_base_url(chosen['url'])}={AVATAR_SPEC.format(size=size)}"


def banner_url(thumbnails: list[dict] | None, *, width: int = DEFAULT_BANNER_WIDTH) -> str:
    """Pick the channel banner and normalize it to `width` px."""
    thumbnails = thumbnails or []

    chosen = next((t for t in thumbnails if t.get("id") == "banner_uncropped"), None)
    if chosen is None:
        chosen = _largest([t for t in thumbnails if _is_wide(t)])
    if chosen is None or not chosen.get("url"):
        logger.info("No channel banner found among %d thumbnails", len(thumbnails))
        return ""

    return f"{_base_url(chosen['url'])}={BANNER_SPEC.format(width=width)}"
