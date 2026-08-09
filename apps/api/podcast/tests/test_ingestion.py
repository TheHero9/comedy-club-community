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


# ---------------------------------------------------------------------------
# 🚨 Throttled-response protection
#
# Regressions for the 2026-08-09 @comedyclubpodcast backfill, where YouTube
# soft-blocked the run partway through and yt-dlp kept returning a REDUCED payload
# without ever raising. The run reported "1318 created, 0 errors" while 1,036 rows
# silently lost duration and availability.
#
# See specs/04-channel-ingestion/01-comedyclubpodcast-run.md
# ---------------------------------------------------------------------------


def _throttled_payload(**overrides):
    """What a soft-blocked yt-dlp response shapes into.

    Core fields survive; everything from the player response is gone. Note
    `availability` arrives as "public" because shape_video coerces the missing
    value - which is exactly what makes this dangerous rather than obvious.
    """
    return _payload(
        duration_sec=None,
        availability="public",
        view_count=None,
        like_count=None,
        yt_comment_count=None,
        **overrides,
    )


def test_throttled_response_never_downgrades_an_existing_episode(channel):
    """A re-run while throttled must not destroy metadata we already got right.

    This is the daily sync's safety property: update_or_create is idempotent in row
    COUNT, but without this guard it is not idempotent in row QUALITY.
    """
    upsert_episode(channel, _payload(duration_sec=3935, availability="subscriber_only",
                                     view_count=12345))

    upsert_episode(channel, _throttled_payload())

    episode = Episode.objects.get(youtube_id="KaZG3h2if_0")
    assert episode.duration_sec == 3935, "throttled re-run wiped a good duration"
    assert episode.availability == Episode.Availability.SUBSCRIBER_ONLY, (
        "throttled re-run flipped a members-only episode to public"
    )
    assert episode.view_count == 12345


def test_throttled_response_still_updates_safe_fields(channel):
    """Only the player-response fields are protected - a retitle must still land."""
    upsert_episode(channel, _payload(duration_sec=3935))
    upsert_episode(channel, _throttled_payload(title="Преименуван епизод"))

    episode = Episode.objects.get(youtube_id="KaZG3h2if_0")
    assert episode.title == "Преименуван епизод"
    assert episode.duration_sec == 3935


def test_a_brand_new_episode_from_a_throttled_response_is_still_written(channel):
    """Never drop the episode - a listed episode beats a missing one.

    It is written with the gaps and counted as degraded, so repair_metadata can
    finish the job later.
    """
    episode, created, _ = upsert_episode(channel, _throttled_payload())
    assert created is True
    assert episode.duration_sec is None


def test_degraded_rows_are_detectable(channel):
    """`duration_sec IS NULL` is the marker the repair pass keys on."""
    from podcast.services.metadata_repair import degraded_queryset

    upsert_episode(channel, _payload(duration_sec=3935))
    # A distinct title: slugs are unique per channel, so reusing one collides.
    upsert_episode(
        channel, _throttled_payload(youtube_id="throttled123", title="Друг епизод")
    )

    degraded = list(degraded_queryset(channel).values_list("youtube_id", flat=True))
    assert degraded == ["throttled123"]


def test_repair_refuses_to_write_from_a_degraded_response():
    """Running the repair while still blocked must be a no-op, never data loss."""
    from podcast.services.metadata_repair import is_full_response

    assert is_full_response({"duration": 3935}) is True
    assert is_full_response({"duration": None, "availability": None}) is False
    assert is_full_response({}) is False
