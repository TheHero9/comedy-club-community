"""Comments, canonical topics, votes, moments, reports and leaderboards."""

import pytest

from podcast.models import Comment, EpisodeTopic, Moment, Report, Topic
from podcast.services import topics as topic_service

pytestmark = pytest.mark.django_db

BASE = "/api"


# ---------------------------------------------------------------------------
# 🚨 Canonical topics - the feature that rots first if this breaks
# ---------------------------------------------------------------------------


def test_differently_cased_bulgarian_input_resolves_to_one_topic(db):
    """'Политика', 'политика' and '  ПОЛИТИКА  ' must be ONE row, or
    'find every episode about X' quietly stops working."""
    first = topic_service.resolve_topic("Политика")
    second = topic_service.resolve_topic("политика")
    third = topic_service.resolve_topic("  ПОЛИТИКА  ")

    assert first.pk == second.pk == third.pk
    assert Topic.objects.count() == 1


def test_two_users_typing_the_same_topic_land_on_one_row(
    client, episode, alice, bob, as_alice, as_bob
):
    for headers in (as_alice, as_bob):
        client.post(
            f"{BASE}/episodes/{episode.youtube_id}/topics",
            data={"name": "Шахмат"},
            content_type="application/json",
            **headers,
        )
    assert Topic.objects.count() == 1
    assert EpisodeTopic.objects.count() == 1


def test_topic_slug_preserves_cyrillic(db):
    assert topic_service.resolve_topic("Политика").slug == "политика"


def test_empty_topic_is_rejected(db):
    with pytest.raises(topic_service.TopicError):
        topic_service.resolve_topic("   ")


def test_adding_a_topic_records_an_implicit_upvote(client, episode, alice, as_alice):
    response = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/topics",
        data={"name": "Шахмат"},
        content_type="application/json",
        **as_alice,
    )
    body = response.json()
    assert body["score"] == 1
    assert body["my_vote"] == 1


def test_downvoting_lowers_the_denormalized_score(
    client, episode, alice, bob, as_alice, as_bob
):
    created = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/topics",
        data={"name": "Оф-топик"},
        content_type="application/json",
        **as_alice,
    ).json()

    response = client.post(
        f"{BASE}/episode-topics/{created['id']}/vote",
        data={"value": -1},
        content_type="application/json",
        **as_bob,
    )
    assert response.json()["score"] == 0  # +1 from alice, -1 from bob


def test_a_user_cannot_vote_twice(client, episode, alice, bob, as_alice, as_bob):
    created = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/topics",
        data={"name": "Тема"},
        content_type="application/json",
        **as_alice,
    ).json()

    for _ in range(3):
        client.post(
            f"{BASE}/episode-topics/{created['id']}/vote",
            data={"value": -1},
            content_type="application/json",
            **as_bob,
        )
    assert EpisodeTopic.objects.get(id=created["id"]).score == 0


def test_topic_filter_finds_every_episode_carrying_it(client, episode, alice, as_alice):
    client.post(
        f"{BASE}/episodes/{episode.youtube_id}/topics",
        data={"name": "Шахмат"},
        content_type="application/json",
        **as_alice,
    )
    response = client.get(f"{BASE}/episodes?topic=шахмат")
    assert response.json()["meta"]["total"] == 1


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


def test_comment_requires_auth(client, episode):
    response = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/comments",
        data={"body": "здравей"},
        content_type="application/json",
    )
    assert response.status_code == 401


def test_creating_and_reading_a_comment(client, episode, alice, as_alice):
    client.post(
        f"{BASE}/episodes/{episode.youtube_id}/comments",
        data={"body": "Страхотен епизод", "is_spoiler": True},
        content_type="application/json",
        **as_alice,
    )
    items = client.get(f"{BASE}/episodes/{episode.youtube_id}/comments").json()["items"]
    assert items[0]["body"] == "Страхотен епизод"
    assert items[0]["is_spoiler"] is True
    assert items[0]["author_name"] == "alice"


def test_empty_comment_is_rejected(client, episode, alice, as_alice):
    response = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/comments",
        data={"body": "   "},
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 422


def test_html_in_a_comment_is_stored_as_inert_text(client, episode, alice, as_alice):
    """Markup is stored VERBATIM and served as JSON, never as HTML.

    JSON does not escape `<`, and it does not need to: the response is
    application/json, so a browser never parses it as markup. The real protection
    is that the frontend must never pass a comment body to dangerouslySetInnerHTML.
    That rule lives in CLAUDE.md; this test pins the API half of the contract.
    """
    payload = "<script>alert('xss')</script>"
    client.post(
        f"{BASE}/episodes/{episode.youtube_id}/comments",
        data={"body": payload},
        content_type="application/json",
        **as_alice,
    )

    # Stored exactly as typed - no silent mangling of user content.
    assert Comment.objects.get().body == payload

    response = client.get(f"{BASE}/episodes/{episode.youtube_id}/comments")
    assert response["Content-Type"].startswith("application/json")
    assert response.json()["items"][0]["body"] == payload


def test_an_author_can_delete_their_own_comment(client, episode, alice, as_alice):
    comment = Comment.objects.create(user=alice, episode=episode, body="моят")
    assert client.delete(f"{BASE}/comments/{comment.id}", **as_alice).status_code == 200
    assert not Comment.objects.filter(id=comment.id).exists()


# ---------------------------------------------------------------------------
# Moments
# ---------------------------------------------------------------------------


def test_adding_a_moment(client, episode, alice, as_alice):
    response = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/moments",
        data={"timestamp_sec": 2052, "label": "Смешен момент"},
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 200
    assert response.json()["timestamp_sec"] == 2052


def test_a_moment_past_the_end_of_the_episode_is_rejected(
    client, episode, alice, as_alice
):
    response = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/moments",
        data={"timestamp_sec": episode.duration_sec + 500, "label": "невъзможно"},
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 422


def test_moment_deep_link_carries_the_timestamp(episode, alice):
    moment = Moment.objects.create(
        episode=episode, user=alice, timestamp_sec=2052, label="тук"
    )
    assert moment.deep_link.endswith("&t=2052")
    assert episode.youtube_id in moment.deep_link


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


def test_reporting_a_comment_creates_a_pending_report(
    client, episode, alice, bob, as_bob
):
    comment = Comment.objects.create(user=alice, episode=episode, body="лошо")
    response = client.post(
        f"{BASE}/reports",
        data={"target_type": "comment", "target_id": comment.id, "reason": "обидно"},
        content_type="application/json",
        **as_bob,
    )
    assert response.status_code == 200
    assert response.json()["status"] == Report.Status.PENDING


def test_reporting_an_unreportable_type_is_rejected(client, alice, as_alice):
    """An open-ended content type would let anyone point a report at any table."""
    response = client.post(
        f"{BASE}/reports",
        data={"target_type": "user", "target_id": 1, "reason": "х"},
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 422


def test_double_reporting_the_same_item_is_rejected(
    client, episode, alice, bob, as_bob
):
    comment = Comment.objects.create(user=alice, episode=episode, body="лошо")
    payload = {"target_type": "comment", "target_id": comment.id, "reason": "спам"}
    for _ in range(1):
        client.post(f"{BASE}/reports", data=payload, content_type="application/json", **as_bob)
    second = client.post(
        f"{BASE}/reports", data=payload, content_type="application/json", **as_bob
    )
    assert second.status_code == 409


def test_a_moderator_can_resolve_a_report(
    client, episode, alice, bob, moderator, as_bob, as_moderator
):
    comment = Comment.objects.create(user=alice, episode=episode, body="лошо")
    report = client.post(
        f"{BASE}/reports",
        data={"target_type": "comment", "target_id": comment.id, "reason": "спам"},
        content_type="application/json",
        **as_bob,
    ).json()

    response = client.post(
        f"{BASE}/reports/{report['id']}/resolve",
        data={"status": "resolved", "resolution_note": "изтрит"},
        content_type="application/json",
        **as_moderator,
    )
    assert response.json()["status"] == "resolved"


# ---------------------------------------------------------------------------
# Leaderboards
# ---------------------------------------------------------------------------


def test_leaderboard_requires_a_minimum_number_of_ratings(client, channel, alice):
    """One enthusiastic 10 is not 'the best episode of all time'."""
    from podcast.models import Episode

    thin = Episode.objects.create(
        channel=channel, youtube_id="thin00000001", title="Малко оценки",
        public_score=10.0, rating_count=1,
    )
    solid = Episode.objects.create(
        channel=channel, youtube_id="solid0000001", title="Достатъчно оценки",
        public_score=8.0, rating_count=12,
    )

    items = client.get(f"{BASE}/leaderboards/top_rated").json()["items"]
    ids = [item["episode"]["youtube_id"] for item in items]

    assert solid.youtube_id in ids
    assert thin.youtube_id not in ids


def test_unknown_leaderboard_404s(client, db):
    assert client.get(f"{BASE}/leaderboards/nonsense").status_code == 404


def test_leaderboards_are_public(client, db):
    assert client.get(f"{BASE}/leaderboards/top_rated").status_code == 200
