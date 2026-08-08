"""Ingestion: shaping, persistence and the rules that must never regress."""

import pytest

from podcast.ingestion.yt_dlp_backfill import (
    IngestionError,
    extract_video_id,
    normalize_channel_target,
    shape_video,
)
from podcast.models import Channel, Chapter, Episode
from podcast.services.ingestion import upsert_episode

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# URL parsing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        "@ivankirkov1",
        "ivankirkov1",
        "https://www.youtube.com/@ivankirkov1",
        "https://www.youtube.com/@ivankirkov1/featured",
        "https://www.youtube.com/@ivankirkov1/videos",
    ],
)
def test_channel_targets_normalize_to_one_url(value):
    assert normalize_channel_target(value) == "https://www.youtube.com/@ivankirkov1"


@pytest.mark.parametrize(
    "value",
    [
        "https://www.youtube.com/watch?v=FP1P8XXYzvE",
        "https://youtu.be/FP1P8XXYzvE",
        "https://www.youtube.com/shorts/FP1P8XXYzvE",
        "FP1P8XXYzvE",
    ],
)
def test_video_ids_are_extracted(value):
    assert extract_video_id(value) == "FP1P8XXYzvE"


def test_unrecognisable_channel_raises():
    with pytest.raises(IngestionError):
        normalize_channel_target("https://example.com/not-youtube")


# ---------------------------------------------------------------------------
# Shaping
# ---------------------------------------------------------------------------


def _raw(**overrides):
    raw = {
        "id": "KaZG3h2if_0",
        "title": "Историята на Каспаров",
        "description": "кратко описание",
        "upload_date": "20260628",
        "duration": 3935,
        "availability": "public",
        "language": "bg",
        "view_count": 12345,
        "chapters": [],
    }
    raw.update(overrides)
    return raw


def test_upload_date_is_normalized_from_yyyymmdd():
    assert shape_video(_raw(), "KaZG3h2if_0", "videos", verify_thumbnail=False)[
        "upload_date"
    ] == "2026-06-28"


def test_missing_upload_date_becomes_none_not_a_bad_string():
    shaped = shape_video(_raw(upload_date=None), "x", "videos", verify_thumbnail=False)
    assert shaped["upload_date"] is None


def test_streams_tab_maps_to_stream_content_kind():
    shaped = shape_video(_raw(), "KaZG3h2if_0", "streams", verify_thumbnail=False)
    assert shaped["content_kind"] == "stream"


def test_videos_tab_maps_to_video_content_kind():
    shaped = shape_video(_raw(), "KaZG3h2if_0", "videos", verify_thumbnail=False)
    assert shaped["content_kind"] == "video"


def test_members_only_view_count_stays_none_not_zero():
    """⚠️ YouTube omits view_count on members-only videos. None != 0."""
    raw = _raw(availability="subscriber_only")
    raw.pop("view_count")
    shaped = shape_video(raw, "x", "videos", verify_thumbnail=False)
    assert shaped["view_count"] is None
    assert shaped["availability"] == "subscriber_only"


def test_chapters_are_shaped_when_present():
    raw = _raw(chapters=[{"title": "Intro", "start_time": 0.0, "end_time": 62.5}])
    shaped = shape_video(raw, "x", "videos", verify_thumbnail=False)
    assert shaped["chapters"] == [{"title": "Intro", "start_sec": 0, "end_sec": 62}]


def test_absent_chapters_yield_an_empty_list_not_a_crash():
    """The probe found 0 of 12 episodes with chapters - this is the normal case."""
    raw = _raw()
    raw.pop("chapters")
    assert shape_video(raw, "x", "videos", verify_thumbnail=False)["chapters"] == []


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


@pytest.fixture
def channel(db):
    return Channel.objects.create(
        youtube_channel_id="UCBy9yfnAqjC1gofLFJ8kMlw", name="Ivan Kirkov", handle="@ivankirkov1"
    )


def _payload(**overrides):
    data = shape_video(_raw(), "KaZG3h2if_0", "videos", verify_thumbnail=False)
    data.update(overrides)
    return data


def test_upsert_creates_then_updates_never_duplicates(channel):
    """Idempotency is the backfill's core contract."""
    episode, created, _ = upsert_episode(channel, _payload())
    assert created is True

    episode2, created2, _ = upsert_episode(channel, _payload(title="Нова версия"))
    assert created2 is False
    assert episode2.pk == episode.pk
    assert Episode.objects.count() == 1
    assert episode2.title == "Нова версия"


def test_bulgarian_title_produces_a_usable_slug(channel):
    episode, _, _ = upsert_episode(channel, _payload())
    assert episode.slug == "историята-на-каспаров"


def test_members_only_flag_is_derived_from_availability(channel):
    episode, _, _ = upsert_episode(channel, _payload(availability="subscriber_only"))
    assert episode.members_only is True


def test_public_episode_is_not_flagged_members_only(channel):
    episode, _, _ = upsert_episode(channel, _payload(availability="public"))
    assert episode.members_only is False


def test_unknown_availability_falls_back_to_public_instead_of_crashing(channel):
    """yt-dlp may report a value our enum does not model; a run must not die."""
    episode, _, _ = upsert_episode(channel, _payload(availability="needs_auth"))
    assert episode.availability == Episode.Availability.PUBLIC
    assert episode.members_only is False


def test_chapters_are_persisted_and_deduplicated(channel):
    payload = _payload(chapters=[{"title": "Intro", "start_sec": 0, "end_sec": 60}])
    _, _, made = upsert_episode(channel, dict(payload))
    assert made == 1

    _, _, made_again = upsert_episode(channel, dict(payload))
    assert made_again == 0
    assert Chapter.objects.count() == 1


def test_two_channels_may_share_an_episode_slug(channel):
    """Episode slugs are unique per channel, not globally."""
    other = Channel.objects.create(youtube_channel_id="UCother", name="Other Show")
    upsert_episode(channel, _payload())
    upsert_episode(other, _payload(youtube_id="different123"))
    assert Episode.objects.filter(slug="историята-на-каспаров").count() == 2
