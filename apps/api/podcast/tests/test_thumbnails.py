"""Thumbnail URL derivation.

🚨 Thumbnails are never uploaded or mirrored - they are a deterministic Google CDN
URL built from the video id.
"""

from unittest.mock import patch

from podcast.ingestion.channel_images import avatar_url, banner_url
from podcast.ingestion.thumbnails import best_thumbnail_url, thumbnail_url


def test_builds_maxres_url():
    assert thumbnail_url("FP1P8XXYzvE") == (
        "https://img.youtube.com/vi/FP1P8XXYzvE/maxresdefault.jpg"
    )


def test_prefers_maxres_when_present():
    with patch("podcast.ingestion.thumbnails._url_exists", return_value=True):
        assert "maxresdefault" in best_thumbnail_url("FP1P8XXYzvE")


def test_falls_back_to_hqdefault_when_maxres_missing():
    """hqdefault is the only quality YouTube guarantees exists."""
    with patch("podcast.ingestion.thumbnails._url_exists", return_value=False):
        assert "hqdefault" in best_thumbnail_url("FP1P8XXYzvE")


def test_verify_false_skips_the_network_entirely():
    with patch("podcast.ingestion.thumbnails._url_exists") as probe:
        assert "maxresdefault" in best_thumbnail_url("FP1P8XXYzvE", verify=False)
        probe.assert_not_called()


def test_empty_video_id_yields_empty_url():
    assert best_thumbnail_url("") == ""


# ---------------------------------------------------------------------------
# Channel avatars and banners
#
# 🚨 These are the opposite rule from the thumbnails above: the URL is an opaque
# content hash, so it cannot be derived and MUST be stored. Still never mirrored.
# See podcast/ingestion/channel_images.py.
# ---------------------------------------------------------------------------

AVATAR_HASH = "https://yt3.googleusercontent.com/vxV5E97pcJ7t-CstaIj95qMTK"
BANNER_HASH = "https://yt3.googleusercontent.com/UHCaRCeKitXzTrbljvQIci_yI6"

# Shaped like a real yt-dlp channel payload: banners carry numeric ids, the
# originals are labelled *_uncropped and report no width/height.
CHANNEL_THUMBNAILS = [
    {"id": "0", "width": 1060, "height": 175, "url": f"{BANNER_HASH}=w1060"},
    {"id": "5", "width": 2560, "height": 424, "url": f"{BANNER_HASH}=w2560"},
    {"id": "banner_uncropped", "url": f"{BANNER_HASH}=s0"},
    {"id": "7", "width": 900, "height": 900, "url": f"{AVATAR_HASH}=s900"},
    {"id": "avatar_uncropped", "url": f"{AVATAR_HASH}=s0"},
]


def test_avatar_is_picked_and_resized_to_a_square():
    url = avatar_url(CHANNEL_THUMBNAILS)
    assert url == f"{AVATAR_HASH}=s480-c-k-c0x00ffffff-no-rj"


def test_avatar_never_returns_the_banner():
    assert avatar_url(CHANNEL_THUMBNAILS).startswith(AVATAR_HASH)


def test_banner_never_returns_the_avatar():
    assert banner_url(CHANNEL_THUMBNAILS).startswith(BANNER_HASH)


def test_avatar_falls_back_to_the_largest_square_when_uncropped_is_absent():
    """Not every channel payload carries the *_uncropped labels."""
    without_label = [t for t in CHANNEL_THUMBNAILS if t["id"] != "avatar_uncropped"]
    assert avatar_url(without_label) == f"{AVATAR_HASH}=s480-c-k-c0x00ffffff-no-rj"


def test_requested_size_is_honoured():
    assert avatar_url(CHANNEL_THUMBNAILS, size=176).endswith("=s176-c-k-c0x00ffffff-no-rj")


def test_missing_thumbnails_yield_empty_strings_not_a_crash():
    """A channel with no images must not abort a sync; the UI has a fallback."""
    assert avatar_url([]) == ""
    assert avatar_url(None) == ""
    assert banner_url([]) == ""
