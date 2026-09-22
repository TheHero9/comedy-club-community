"""Ratings, watch log, favorites, tags, membership and the derived scores."""

import pytest

from podcast.models import Favorite, Rating, WatchEvent

pytestmark = pytest.mark.django_db

BASE = "/api"


def _rate(client, episode, score, headers):
    return client.put(
        f"{BASE}/episodes/{episode.youtube_id}/rating",
        data={"score": score},
        content_type="application/json",
        **headers,
    )


# ---------------------------------------------------------------------------
# Ratings
# ---------------------------------------------------------------------------


def test_rating_updates_the_denormalized_public_score(client, episode, alice, as_alice):
    body = _rate(client, episode, 8, as_alice).json()
    assert body["public_score"] == 8.0
    assert body["rating_count"] == 1

    episode.refresh_from_db()
    assert episode.public_score == 8.0


def test_rating_twice_updates_rather_than_duplicating(client, episode, alice, as_alice):
    _rate(client, episode, 5, as_alice)
    body = _rate(client, episode, 9, as_alice).json()

    assert Rating.objects.count() == 1
    assert body["public_score"] == 9.0


def test_scores_outside_1_to_10_are_rejected(client, episode, alice, as_alice):
    assert _rate(client, episode, 0, as_alice).status_code == 422
    assert _rate(client, episode, 11, as_alice).status_code == 422


def test_clearing_a_rating_resets_the_score_to_null_not_zero(
    client, episode, alice, as_alice
):
    """🚨 An unrated episode must not look like a terrible one."""
    _rate(client, episode, 10, as_alice)
    client.delete(f"{BASE}/episodes/{episode.youtube_id}/rating", **as_alice)

    episode.refresh_from_db()
    assert episode.public_score is None
    assert episode.rating_count == 0


# ---------------------------------------------------------------------------
# Elite score - the core design
# ---------------------------------------------------------------------------


def test_elite_score_counts_only_verified_members(
    client, episode, alice, bob, as_alice, as_bob, verify_membership
):
    verify_membership(alice, episode.channel)

    _rate(client, episode, 10, as_alice)
    body = _rate(client, episode, 2, as_bob).json()

    assert body["public_score"] == 6.0
    assert body["elite_score"] == 10.0
    assert body["elite_rating_count"] == 1


def test_verification_promotes_an_existing_rating_with_no_new_rows(
    client, episode, alice, as_alice, verify_membership
):
    """🚨 The single most important behaviour in the scoring design."""
    _rate(client, episode, 9, as_alice)
    episode.refresh_from_db()
    assert episode.elite_score is None

    verify_membership(alice, episode.channel)
    from podcast.services import scoring

    scoring.recompute_episode(episode)

    episode.refresh_from_db()
    assert episode.elite_score == 9.0
    assert Rating.objects.count() == 1  # no duplicate "elite vote"


def test_verification_on_another_channel_grants_no_elite_standing(
    client, episode, other_channel, alice, as_alice, verify_membership
):
    verify_membership(alice, other_channel)
    body = _rate(client, episode, 10, as_alice).json()

    assert body["public_score"] == 10.0
    assert body["elite_score"] is None


# ---------------------------------------------------------------------------
# Watch log
# ---------------------------------------------------------------------------


def test_watching_is_a_log_not_a_flag(client, episode, alice, as_alice):
    """'Did I already watch this?' needs rewatch history, not a boolean."""
    for _ in range(3):
        response = client.post(
            f"{BASE}/episodes/{episode.youtube_id}/watch",
            data={},
            content_type="application/json",
            **as_alice,
        )
    body = response.json()
    assert body["watch_count"] == 3
    assert body["last_watched_on"] is not None
    assert WatchEvent.objects.count() == 3


def _log(client, episode, iso_day, headers):
    return client.post(
        f"{BASE}/episodes/{episode.youtube_id}/watch",
        data={"watched_on": iso_day},
        content_type="application/json",
        **headers,
    )


def test_watch_calendar_returns_one_year_with_episode_context(
    client, episode, alice, bob, as_alice
):
    """The profile calendar: a flat dated list, filtered to the asked year."""
    _log(client, episode, "2026-03-05", as_alice)
    _log(client, episode, "2026-03-05", as_alice)  # a rewatch on the same day is data
    _log(client, episode, "2025-12-31", as_alice)

    body = client.get(f"{BASE}/me/watch-days?year=2026", **as_alice).json()

    assert body["year"] == 2026
    assert body["total"] == 2
    assert body["years"] == [2025, 2026]
    assert [e["watched_on"] for e in body["events"]] == ["2026-03-05", "2026-03-05"]
    assert body["events"][0]["youtube_id"] == episode.youtube_id
    assert body["events"][0]["title"] == episode.title
    assert body["events"][0]["channel_name"] == episode.channel.name


def test_watch_calendar_defaults_to_the_current_year(client, episode, alice, as_alice):
    from django.utils import timezone

    today = timezone.localdate()
    _log(client, episode, str(today), as_alice)
    _log(client, episode, "2019-01-01", as_alice)

    body = client.get(f"{BASE}/me/watch-days", **as_alice).json()

    assert body["year"] == today.year
    assert body["total"] == 1
    assert body["events"][0]["watched_on"] == str(today)


def test_watch_calendar_is_scoped_to_the_actor(
    client, episode, alice, bob, as_alice, as_bob
):
    """🔒 Bob's calendar must never show Alice's viewings."""
    _log(client, episode, "2026-02-02", as_alice)

    body = client.get(f"{BASE}/me/watch-days?year=2026", **as_bob).json()

    assert body["total"] == 0
    assert body["events"] == []
    assert body["years"] == []


def test_viewer_state_reports_everything_in_one_call(client, episode, alice, as_alice):
    _rate(client, episode, 7, as_alice)
    client.post(
        f"{BASE}/episodes/{episode.youtube_id}/watch",
        data={},
        content_type="application/json",
        **as_alice,
    )
    client.put(f"{BASE}/episodes/{episode.youtube_id}/favorite", **as_alice)
    client.post(
        f"{BASE}/episodes/{episode.youtube_id}/tags",
        data={"text": "смешно"},
        content_type="application/json",
        **as_alice,
    )

    state = client.get(f"{BASE}/episodes/{episode.youtube_id}/me", **as_alice).json()

    assert state["rating"] == 7
    assert state["is_favorite"] is True
    assert state["watch_count"] == 1
    assert state["personal_tags"] == ["смешно"]


# ---------------------------------------------------------------------------
# Favorites
# ---------------------------------------------------------------------------


def test_favorite_is_idempotent(client, episode, alice, as_alice):
    client.put(f"{BASE}/episodes/{episode.youtube_id}/favorite", **as_alice)
    client.put(f"{BASE}/episodes/{episode.youtube_id}/favorite", **as_alice)
    assert Favorite.objects.count() == 1


def test_unfavorite_works_and_is_safe_when_absent(client, episode, alice, as_alice):
    response = client.delete(f"{BASE}/episodes/{episode.youtube_id}/favorite", **as_alice)
    assert response.status_code == 200
    assert response.json()["is_favorite"] is False


def test_my_favorites_lists_only_my_own(client, episode, alice, bob, as_alice):
    Favorite.objects.create(user=bob, episode=episode)
    assert client.get(f"{BASE}/me/favorites", **as_alice).json()["meta"]["total"] == 0


# ---------------------------------------------------------------------------
# Membership
# ---------------------------------------------------------------------------


def test_claiming_a_membership_starts_unverified(client, channel, alice, as_alice):
    """A self-claimed membership must never grant elite standing on its own."""
    response = client.post(
        f"{BASE}/me/memberships",
        data={"channel_id": channel.id, "tier": "Gold"},
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 200
    assert response.json()["is_verified"] is False


def test_membership_response_never_exposes_the_screenshot_url(
    client, channel, alice, as_alice, verify_membership
):
    """🔒 The screenshot is private proof of a paid membership."""
    membership = verify_membership(alice, channel)
    membership.verification_screenshot = "verifications/proof.png"
    membership.save()

    response = client.get(f"{BASE}/me/memberships", **as_alice)

    # The security assertion: the storage path never crosses the wire.
    assert "proof.png" not in response.content.decode()

    # The contract assertion, made against PARSED json rather than formatted
    # text. Asserting on `'"has_screenshot": true'` coupled this test to the
    # renderer's whitespace, so it broke when the API switched to compact
    # separators - a formatting change with no security meaning.
    memberships = response.json()
    assert memberships, "the fixture must return a membership to assert against"
    assert memberships[0]["has_screenshot"] is True


def test_removing_a_verified_membership_recomputes_elite_scores(
    client, episode, alice, as_alice, verify_membership
):
    membership = verify_membership(alice, episode.channel)
    _rate(client, episode, 10, as_alice)

    episode.refresh_from_db()
    assert episode.elite_score == 10.0

    client.delete(f"{BASE}/me/memberships/{membership.id}", **as_alice)

    episode.refresh_from_db()
    assert episode.elite_score is None
    assert episode.public_score == 10.0  # public standing is unaffected


def test_watch_history_carries_every_logged_date_newest_first(
    client, episode, alice, as_alice
):
    """The history page has to SAY when: one card, all of its dates."""
    _log(client, episode, "2025-12-30", as_alice)
    _log(client, episode, "2026-03-05", as_alice)
    _log(client, episode, "2026-03-05", as_alice)  # a same-day rewatch is data

    body = client.get(f"{BASE}/me/watched", **as_alice).json()

    assert body["meta"]["total"] == 1
    assert len(body["items"]) == 1
    card = body["items"][0]
    assert card["youtube_id"] == episode.youtube_id
    assert card["watch_count"] == 3
    assert card["watched_on"] == ["2026-03-05", "2026-03-05", "2025-12-30"]


def test_watch_history_dates_are_scoped_to_the_actor(
    client, episode, alice, bob, as_alice, as_bob
):
    """🔒 Bob's viewing of the same episode must not appear on Alice's card."""
    _log(client, episode, "2026-01-10", as_alice)
    _log(client, episode, "2026-02-20", as_bob)

    body = client.get(f"{BASE}/me/watched", **as_alice).json()

    assert body["items"][0]["watched_on"] == ["2026-01-10"]
    assert body["items"][0]["watch_count"] == 1
