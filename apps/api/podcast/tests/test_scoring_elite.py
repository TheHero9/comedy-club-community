"""Elite scoring and ingestion idempotency (test matrix sections 16 and 17).

🚨 The invariant these tests exist to protect:

    There is ONE `Rating` model and TWO derived numbers.
    Public score = Avg(score) over ALL ratings.
    Elite score  = Avg(score) over ratings by users with a VERIFIED
                   `ChannelMembership` for THAT EPISODE'S channel.

Verifying a member must therefore promote their EXISTING ratings with no data
migration, no backfill and no duplicate rows. If anyone ever "fixes" this by
adding an elite-vote table, these tests fail loudly.

Section 17 (ingestion idempotency) lives here rather than in test_ingestion.py
because this lane owns only its own files and must never edit an existing test.
"""

from __future__ import annotations

import pytest

from podcast.ingestion.yt_dlp_backfill import ChannelPayload, IngestionError, fetch_channel
from podcast.models import (
    Channel,
    ChannelMembership,
    Chapter,
    Episode,
    Favorite,
    PersonalTag,
    Rating,
    UserProfile,
    WatchEvent,
)
from podcast.services import ingestion as ingestion_service
from podcast.services import scoring

from .conftest import make_user

pytestmark = pytest.mark.django_db

BASE = "/api"

# Every table a "verification must not need a migration" claim could hide a write in.
COUNTED_MODELS = (
    Channel,
    ChannelMembership,
    Chapter,
    Episode,
    Favorite,
    PersonalTag,
    Rating,
    UserProfile,
    WatchEvent,
)


def _row_counts() -> dict[str, int]:
    return {model.__name__: model.objects.count() for model in COUNTED_MODELS}


def _rate(user, episode, score) -> Rating:
    """Write a rating the way the API does, then refresh the denormalized columns."""
    rating, _ = Rating.objects.update_or_create(
        user=user, episode=episode, defaults={"score": score}
    )
    scoring.recompute_episode(episode)
    return rating


# ---------------------------------------------------------------------------
# 16.1 - verification promotes existing ratings, with nothing else changing
# ---------------------------------------------------------------------------


def test_16_1_verifying_a_membership_changes_the_elite_score(
    episode, alice, verify_membership
):
    _rate(alice, episode, 9)
    episode.refresh_from_db()
    assert episode.elite_score is None, "an unverified rater must not count as elite"
    assert episode.public_score == 9.0

    # Claim first, so verification is a pure field flip and cannot be confused with
    # the row that a claim creates.
    ChannelMembership.objects.create(user=alice, channel=episode.channel)
    before = _row_counts()

    verify_membership(alice, episode.channel)
    scoring.recompute_episode(episode)

    episode.refresh_from_db()
    assert episode.elite_score == 9.0
    assert episode.elite_rating_count == 1
    # 🚨 No new rows ANYWHERE: no duplicated Rating, no shadow "elite vote" table.
    assert _row_counts() == before


def test_16_1_verification_needs_no_new_rating_row(episode, alice, bob, verify_membership):
    _rate(alice, episode, 10)
    _rate(bob, episode, 4)
    assert Rating.objects.count() == 2

    verify_membership(alice, episode.channel)
    scoring.recompute_episode(episode)

    episode.refresh_from_db()
    assert Rating.objects.count() == 2
    assert episode.public_score == 7.0  # both still count publicly
    assert episode.elite_score == 10.0  # only the verified one counts as elite


def test_16_1_revoking_verification_reverses_it_without_deleting_the_rating(
    episode, alice, verify_membership
):
    verify_membership(alice, episode.channel)
    _rate(alice, episode, 8)
    episode.refresh_from_db()
    assert episode.elite_score == 8.0

    verify_membership(alice, episode.channel, verified=False)
    scoring.recompute_episode(episode)

    episode.refresh_from_db()
    assert episode.elite_score is None
    assert episode.elite_rating_count == 0
    assert episode.public_score == 8.0
    assert Rating.objects.count() == 1


def test_16_1_verification_through_the_api_flips_the_elite_score(
    client, episode, alice, as_alice, verify_membership
):
    """The same promotion, driven end to end through the rating endpoint."""
    body = client.put(
        f"{BASE}/episodes/{episode.youtube_id}/rating",
        data={"score": 7},
        content_type="application/json",
        **as_alice,
    ).json()
    assert body["elite_score"] is None

    verify_membership(alice, episode.channel)
    scoring.recompute_for_membership_change(alice.id, episode.channel_id)

    episode.refresh_from_db()
    assert episode.elite_score == 7.0
    assert Rating.objects.count() == 1


# ---------------------------------------------------------------------------
# 16.2 - unverified members are ignored
# ---------------------------------------------------------------------------


def test_16_2_an_unverified_membership_grants_no_elite_standing(
    episode, alice, verify_membership
):
    verify_membership(alice, episode.channel, verified=False)
    _rate(alice, episode, 10)

    episode.refresh_from_db()
    assert episode.public_score == 10.0
    assert episode.elite_score is None
    assert episode.elite_rating_count == 0


def test_16_2_a_claimed_but_unreviewed_membership_grants_no_elite_standing(
    client, channel, episode, alice, as_alice
):
    """A user can claim a membership themselves; claiming must never be enough."""
    response = client.post(
        f"{BASE}/me/memberships",
        data={"channel_id": channel.id, "tier": "Gold"},
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 200
    assert response.json()["is_verified"] is False

    _rate(alice, episode, 10)
    episode.refresh_from_db()
    assert episode.elite_score is None


def test_16_2_mixed_raters_average_only_the_verified_ones(
    episode, alice, bob, verify_membership
):
    carol = make_user("carol")
    verify_membership(alice, episode.channel)
    verify_membership(carol, episode.channel)
    verify_membership(bob, episode.channel, verified=False)

    _rate(alice, episode, 10)
    _rate(bob, episode, 1)
    _rate(carol, episode, 8)

    episode.refresh_from_db()
    assert episode.public_score == pytest.approx(6.333, abs=0.001)
    assert episode.elite_score == 9.0
    assert episode.elite_rating_count == 2
    assert episode.rating_count == 3


# ---------------------------------------------------------------------------
# 16.3 - elite standing is scoped to the episode's own channel
# ---------------------------------------------------------------------------


def test_16_3_membership_in_channel_a_does_not_affect_channel_b(
    channel, other_channel, episode, alice, verify_membership
):
    """Two real channels, one episode each. Verification must not travel."""
    episode_b = Episode.objects.create(
        channel=other_channel, youtube_id="otherEp0001", title="Друго предаване"
    )

    verify_membership(alice, channel)
    _rate(alice, episode, 9)
    _rate(alice, episode_b, 9)

    episode.refresh_from_db()
    episode_b.refresh_from_db()

    assert episode.elite_score == 9.0, "verified on this channel, so elite counts"
    assert episode_b.elite_score is None, "🚨 verification must not leak across channels"
    assert episode_b.public_score == 9.0
    assert episode_b.elite_rating_count == 0


def test_16_3_verifying_channel_b_leaves_channel_a_untouched(
    channel, other_channel, episode, alice, verify_membership
):
    episode_b = Episode.objects.create(
        channel=other_channel, youtube_id="otherEp0002", title="Второ предаване"
    )
    _rate(alice, episode, 6)
    _rate(alice, episode_b, 6)

    verify_membership(alice, other_channel)
    scoring.recompute_for_membership_change(alice.id, other_channel.id)

    episode.refresh_from_db()
    episode_b.refresh_from_db()
    assert episode_b.elite_score == 6.0
    assert episode.elite_score is None


def test_16_3_the_model_reference_method_agrees_with_the_service(
    channel, other_channel, episode, alice, verify_membership
):
    """Episode.compute_elite_score() is the documented correctness reference."""
    verify_membership(alice, other_channel)
    _rate(alice, episode, 10)

    assert episode.compute_elite_score() is None
    assert episode.compute_public_score() == 10.0


# ---------------------------------------------------------------------------
# 16.4 - the public score counts everyone
# ---------------------------------------------------------------------------


def test_16_4_public_score_counts_verified_unverified_and_staff_alike(
    episode, alice, bob, moderator, verify_membership
):
    verify_membership(alice, episode.channel)

    _rate(alice, episode, 10)
    _rate(bob, episode, 6)
    _rate(moderator, episode, 2)

    episode.refresh_from_db()
    assert episode.rating_count == 3
    assert episode.public_score == 6.0
    assert episode.compute_public_score() == pytest.approx(6.0)


def test_16_4_public_score_is_null_not_zero_with_no_ratings(episode):
    scoring.recompute_episode(episode)
    episode.refresh_from_db()
    assert episode.public_score is None
    assert episode.elite_score is None
    assert episode.rating_count == 0


# ---------------------------------------------------------------------------
# 16.5 - the denormalized columns are a self-healing cache
# ---------------------------------------------------------------------------


def test_16_5_a_sweep_repairs_drifted_denormalized_columns(
    episode, alice, bob, verify_membership
):
    """The columns are a CACHE over Rating. A missed signal must self-heal."""
    verify_membership(alice, episode.channel)
    _rate(alice, episode, 10)
    _rate(bob, episode, 4)

    # Simulate a dropped recompute: write nonsense straight to the columns.
    Episode.objects.filter(pk=episode.pk).update(
        public_score=1.0, elite_score=1.0, rating_count=99, elite_rating_count=99
    )

    scoring.recompute_all()

    episode.refresh_from_db()
    assert episode.public_score == 7.0
    assert episode.elite_score == 10.0
    assert episode.rating_count == 2
    assert episode.elite_rating_count == 1


def test_16_5_denormalized_columns_match_a_fresh_computation(
    channel, other_channel, episode, alice, bob, verify_membership
):
    episode_b = Episode.objects.create(
        channel=other_channel, youtube_id="otherEp0003", title="Трето предаване"
    )
    verify_membership(alice, channel)
    _rate(alice, episode, 9)
    _rate(bob, episode, 5)
    _rate(alice, episode_b, 3)

    for stored in Episode.objects.select_related("channel"):
        expected = scoring.compute_scores(stored)
        assert stored.public_score == expected["public_score"]
        assert stored.elite_score == expected["elite_score"]
        assert stored.rating_count == expected["rating_count"]
        assert stored.elite_rating_count == expected["elite_rating_count"]
        # And the service agrees with the model's reference methods.
        assert stored.public_score == (
            None
            if stored.compute_public_score() is None
            else pytest.approx(stored.compute_public_score(), abs=0.001)
        )


def test_16_5_a_membership_change_only_touches_that_channels_rated_episodes(
    channel, other_channel, episode, alice, verify_membership
):
    unrated = Episode.objects.create(
        channel=channel, youtube_id="unratedEp001", title="Неоценен"
    )
    Episode.objects.create(channel=other_channel, youtube_id="otherEp0004", title="Друг")
    _rate(alice, episode, 8)

    verify_membership(alice, channel)
    touched = scoring.recompute_for_membership_change(alice.id, channel.id)

    assert touched == 1, "only the rated episode on that channel needs recomputing"
    unrated.refresh_from_db()
    assert unrated.public_score is None


# ---------------------------------------------------------------------------
# 17.1 - re-running the backfill changes no row counts
# ---------------------------------------------------------------------------


def _fake_payload() -> ChannelPayload:
    """Three episodes shaped exactly as yt_dlp_backfill.shape_video returns them."""

    def video(youtube_id: str, title: str, **extra) -> dict:
        data = {
            "youtube_id": youtube_id,
            "title": title,
            "description": "описание",
            "upload_date": "2026-06-28",
            "duration_sec": 3935,
            "thumbnail_url": f"https://img.youtube.com/vi/{youtube_id}/maxresdefault.jpg",
            "url": f"https://www.youtube.com/watch?v={youtube_id}",
            "content_kind": "video",
            "availability": "public",
            "language": "bg",
            "view_count": 1234,
            "like_count": 56,
            "yt_comment_count": 7,
            "chapters": [],
        }
        data.update(extra)
        return data

    return ChannelPayload(
        youtube_channel_id="UCBy9yfnAqjC1gofLFJ8kMlw",
        name="Ivan Kirkov",
        handle="@ivankirkov1",
        videos=[
            video("aaaaaaaaaa1", "Историята на Каспаров"),
            video("aaaaaaaaaa2", "На живо", content_kind="stream"),
            video(
                "aaaaaaaaaa3",
                "Само за членове",
                availability="subscriber_only",
                view_count=None,
                chapters=[{"title": "Начало", "start_sec": 0, "end_sec": 60}],
            ),
        ],
    )


@pytest.fixture
def stub_fetch_channel(monkeypatch):
    """Replace the network call, keep every line of persistence real."""
    calls: list[dict] = []

    def _fetch(target, **kwargs):
        calls.append({"target": target, **kwargs})
        return _fake_payload()

    monkeypatch.setattr(ingestion_service, "fetch_channel", _fetch)
    return calls


def test_17_1_running_the_backfill_twice_changes_no_row_counts(stub_fetch_channel):
    first = ingestion_service.backfill_channel("@ivankirkov1", verify_thumbnails=False)
    assert first.created == 3
    assert first.updated == 0
    assert first.chapters_created == 1

    after_first = _row_counts()

    second = ingestion_service.backfill_channel("@ivankirkov1", verify_thumbnails=False)

    assert second.created == 0, "youtube_id is the external primary key"
    assert second.updated == 3
    assert second.chapters_created == 0
    assert _row_counts() == after_first
    assert Channel.objects.count() == 1
    assert Episode.objects.count() == 3
    assert Chapter.objects.count() == 1


def test_17_1_a_repeat_run_keeps_the_same_primary_keys(stub_fetch_channel):
    ingestion_service.backfill_channel("@ivankirkov1", verify_thumbnails=False)
    before = dict(Episode.objects.values_list("youtube_id", "id"))

    ingestion_service.backfill_channel("@ivankirkov1", verify_thumbnails=False)

    assert dict(Episode.objects.values_list("youtube_id", "id")) == before


def test_17_1_a_repeat_run_refreshes_changed_metadata(stub_fetch_channel, monkeypatch):
    ingestion_service.backfill_channel("@ivankirkov1", verify_thumbnails=False)

    def _renamed(target, **kwargs):
        payload = _fake_payload()
        payload.videos[0]["title"] = "Преименувано заглавие"
        return payload

    monkeypatch.setattr(ingestion_service, "fetch_channel", _renamed)
    result = ingestion_service.backfill_channel("@ivankirkov1", verify_thumbnails=False)

    assert result.created == 0
    assert Episode.objects.get(youtube_id="aaaaaaaaaa1").title == "Преименувано заглавие"
    assert Episode.objects.count() == 3


def test_17_1_a_dry_run_writes_nothing(stub_fetch_channel):
    result = ingestion_service.backfill_channel(
        "@ivankirkov1", dry_run=True, verify_thumbnails=False
    )
    assert result.skipped == 3
    assert Episode.objects.count() == 0
    assert Channel.objects.count() == 0


# ---------------------------------------------------------------------------
# 17.2 - Shorts are NEVER ingested
# ---------------------------------------------------------------------------


def test_17_2_the_configured_tabs_are_videos_and_streams_only(settings):
    """🚨 Owner decision 2026-08-08. Reversing this costs a full re-backfill."""
    assert tuple(settings.YOUTUBE_INGEST_TABS) == ("videos", "streams")


def test_17_2_asking_for_the_shorts_tab_is_rejected():
    with pytest.raises(IngestionError, match="Shorts are never ingested"):
        fetch_channel("@ivankirkov1", tabs=("videos", "shorts"))


def test_17_2_a_default_run_only_reads_the_videos_and_streams_tabs(monkeypatch):
    """Nothing may quietly widen the tab list at runtime."""
    from podcast.ingestion import yt_dlp_backfill

    requested: list[str] = []

    def _entries(base_url, tab, limit):
        requested.append(tab)
        return {"channel_id": "UCtest", "channel": "Test"}, []

    monkeypatch.setattr(yt_dlp_backfill, "fetch_tab_entries", _entries)
    payload = yt_dlp_backfill.fetch_channel("@ivankirkov1")

    assert requested == ["videos", "streams"]
    assert payload.videos == []


def test_17_2_the_content_kind_enum_has_no_short_member():
    values = {choice.value for choice in Episode.ContentKind}
    assert values == {"video", "stream"}
    assert "short" not in values


def test_17_2_an_unknown_tab_is_rejected_before_any_network_call():
    with pytest.raises(IngestionError, match="Unknown tab"):
        fetch_channel("@ivankirkov1", tabs=("videos", "playlists"))
