"""The Data API path: duration parsing, playlist derivation, API repair rules.

The load-bearing invariants:
- the API repair NEVER writes availability (the API cannot see members-only);
- ids absent from an API response stay degraded (absence is a signal, not data);
- the derived UULF/UULV playlists are what keep Shorts out of the API sync;
- upsert keeps stored availability/thumbnail when a payload omits them.
"""

from unittest import mock

import pytest

from podcast.ingestion.youtube_api import (
    YouTubeAPIError,
    parse_iso8601_duration,
    uploads_playlists,
)
from podcast.models import Channel, Episode
from podcast.services.ingestion import upsert_episode
from podcast.services.metadata_repair import repair_degraded_via_api

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("PT33M14S", 1994),
        ("PT1H2M3S", 3723),
        ("PT45S", 45),
        ("PT2H", 7200),
        ("P1DT1S", 86401),
        ("P0D", 0),  # live/upcoming videos report this
        (None, None),
        ("garbage", None),
    ],
)
def test_parse_iso8601_duration(value, expected):
    assert parse_iso8601_duration(value) == expected


def test_uploads_playlists_derivation():
    playlists = uploads_playlists("UCBy9yfnAqjC1gofLFJ8kMlw")
    assert playlists == {
        "videos": "UULFBy9yfnAqjC1gofLFJ8kMlw",
        "streams": "UULVBy9yfnAqjC1gofLFJ8kMlw",
    }


def test_uploads_playlists_rejects_non_channel_ids():
    with pytest.raises(YouTubeAPIError):
        uploads_playlists("@ivankirkov1")


# ---------------------------------------------------------------------------
# API repair
# ---------------------------------------------------------------------------


def _channel():
    return Channel.objects.create(
        youtube_channel_id="UCapitest00000000000000",
        name="API Test",
        handle="@apitest",
    )


def _degraded_episode(channel, youtube_id, **overrides):
    fields = {
        "channel": channel,
        "youtube_id": youtube_id,
        "title": f"Episode {youtube_id}",
        "duration_sec": None,
        "availability": Episode.Availability.PUBLIC,
    }
    fields.update(overrides)
    return Episode.objects.create(**fields)


def test_api_repair_fixes_visible_rows_and_skips_invisible_ones():
    channel = _channel()
    visible = _degraded_episode(channel, "vvvvvvvvvv1")
    invisible = _degraded_episode(channel, "mmmmmmmmmm1")

    details = {
        "vvvvvvvvvv1": {
            "youtube_id": "vvvvvvvvvv1",
            "title": "t", "description": "", "upload_date": "2026-01-01",
            "duration_sec": 1994, "view_count": 100, "like_count": 5,
            "yt_comment_count": 2, "is_stream": False,
        }
        # invisible id: absent from the response entirely
    }
    with mock.patch(
        "podcast.ingestion.youtube_api.video_details", return_value=details
    ):
        result = repair_degraded_via_api(channel)

    visible.refresh_from_db()
    invisible.refresh_from_db()
    assert (result.repaired, result.still_degraded) == (1, 1)
    assert visible.duration_sec == 1994
    assert visible.view_count == 100
    assert invisible.duration_sec is None  # stays degraded for the yt-dlp sweep


def test_api_repair_never_touches_availability():
    channel = _channel()
    episode = _degraded_episode(
        channel, "ssssssssss1", availability=Episode.Availability.SUBSCRIBER_ONLY
    )
    details = {
        "ssssssssss1": {
            "youtube_id": "ssssssssss1",
            "title": "t", "description": "", "upload_date": "2026-01-01",
            "duration_sec": 60, "view_count": None, "like_count": None,
            "yt_comment_count": None, "is_stream": False,
        }
    }
    with mock.patch(
        "podcast.ingestion.youtube_api.video_details", return_value=details
    ):
        repair_degraded_via_api(channel)

    episode.refresh_from_db()
    assert episode.duration_sec == 60
    assert episode.availability == Episode.Availability.SUBSCRIBER_ONLY


# ---------------------------------------------------------------------------
# upsert guards the API sync path relies on
# ---------------------------------------------------------------------------


def test_upsert_without_availability_keeps_stored_value():
    channel = _channel()
    Episode.objects.create(
        channel=channel,
        youtube_id="abcdefghij1",
        title="Members episode",
        duration_sec=100,
        availability=Episode.Availability.SUBSCRIBER_ONLY,
        thumbnail_url="https://img.youtube.com/vi/abcdefghij1/maxresdefault.jpg",
    )

    episode, created, _ = upsert_episode(
        channel,
        {
            "youtube_id": "abcdefghij1",
            "title": "Members episode (updated)",
            "duration_sec": 120,
            # availability and thumbnail_url deliberately absent
        },
    )

    assert not created
    assert episode.availability == Episode.Availability.SUBSCRIBER_ONLY
    assert episode.members_only is True
    assert episode.thumbnail_url.endswith("maxresdefault.jpg")
    assert episode.duration_sec == 120
