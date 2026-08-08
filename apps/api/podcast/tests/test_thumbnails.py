"""Thumbnail URL derivation.

🚨 Thumbnails are never uploaded or mirrored - they are a deterministic Google CDN
URL built from the video id.
"""

from unittest.mock import patch

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
