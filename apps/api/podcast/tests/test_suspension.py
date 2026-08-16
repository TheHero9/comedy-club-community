"""🔒 Account suspension.

Until 2026-08-16 there was no way to stop a bad actor at all: a moderator could
hide a comment but not stop the person writing the next one, and deleting the
account in Clerk did nothing here because Django keeps its own row and an
unexpired session token keeps working against it.

The load-bearing property is that the check lives in the AUTH BACKEND, so it
covers every endpoint at once. A per-endpoint check would leave the next
endpoint added reachable by a banned account through nothing but forgetfulness -
the same reasoning as the API-wide throttle and the NUL-byte middleware.
"""

from __future__ import annotations

import pytest

from podcast.models import Comment, Rating

BASE = "/api"


@pytest.fixture
def suspend(client, as_admin):
    def _suspend(user_id: int):
        return client.post(
            f"{BASE}/moderation/users/{user_id}/suspend",
            content_type="application/json",
            **as_admin,
        )

    return _suspend


# ---------------------------------------------------------------------------
# The gate itself
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_a_suspended_account_cannot_authenticate_anywhere(
    client, alice, as_alice, admin_user, suspend, episode
):
    # Acting normally first, so the 401 below is the suspension and not a
    # broken fixture.
    before = client.get(f"{BASE}/me", **as_alice)
    assert before.status_code == 200

    assert suspend(alice.id).status_code == 200

    # 🚨 EVERY endpoint, not just the one that was patched. This is what the
    # backend-level check buys.
    assert client.get(f"{BASE}/me", **as_alice).status_code == 401
    assert client.get(f"{BASE}/me/favorites", **as_alice).status_code == 401
    assert (
        client.post(
            f"{BASE}/episodes/{episode.youtube_id}/comments",
            data={"body": "пак съм тук", "is_spoiler": False},
            content_type="application/json",
            **as_alice,
        ).status_code
        == 401
    )
    assert (
        client.put(
            f"{BASE}/episodes/{episode.youtube_id}/rating",
            data={"score": 10},
            content_type="application/json",
            **as_alice,
        ).status_code
        == 401
    )


@pytest.mark.django_db
def test_suspension_keeps_the_content_and_the_account(
    client, alice, as_alice, admin_user, suspend, episode
):
    # 🚨 Deliberately NOT a delete. The moderation record is the point, and the
    # rest of this codebase hides rather than destroys (Comment.is_hidden, a
    # rejected proposal that stays as the audit trail).
    Comment.objects.create(user=alice, episode=episode, body="коментар")
    Rating.objects.create(user=alice, episode=episode, score=8)

    suspend(alice.id)

    alice.refresh_from_db()
    assert alice.is_active is False
    assert Comment.objects.filter(user=alice).count() == 1
    assert Rating.objects.filter(user=alice).count() == 1

    # The comment is still PUBLIC - suspending the author is not the same
    # decision as taking down what they wrote, and conflating the two would
    # make every ban a silent mass deletion.
    listed = client.get(f"{BASE}/episodes/{episode.youtube_id}/comments")
    assert listed.status_code == 200
    assert listed.json()["meta"]["total"] == 1


@pytest.mark.django_db
def test_restoring_lets_them_back_in(
    client, alice, as_alice, admin_user, as_admin, suspend
):
    suspend(alice.id)
    assert client.get(f"{BASE}/me", **as_alice).status_code == 401

    restored = client.post(
        f"{BASE}/moderation/users/{alice.id}/restore",
        content_type="application/json",
        **as_admin,
    )
    assert restored.status_code == 200
    assert restored.json()["is_active"] is True

    # 🚨 Straight back in, with no rebuild. Nothing was deleted, so nothing has
    # to be restored - the same property that lets verifying a membership
    # promote a user's EXISTING ratings.
    assert client.get(f"{BASE}/me", **as_alice).status_code == 200


# ---------------------------------------------------------------------------
# Who may do it
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_a_member_cannot_suspend_anyone(client, alice, bob, as_bob):
    response = client.post(
        f"{BASE}/moderation/users/{alice.id}/suspend",
        content_type="application/json",
        **as_bob,
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_a_moderator_cannot_suspend_anyone(client, alice, moderator, as_moderator):
    # 🚨 Admin-only, same reasoning as role granting: a moderator who could
    # suspend accounts could suspend the admins.
    response = client.post(
        f"{BASE}/moderation/users/{alice.id}/suspend",
        content_type="application/json",
        **as_moderator,
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_an_admin_cannot_suspend_themselves(client, admin_user, as_admin, suspend):
    # 🚨 Worse than the role self-lockout it mirrors: suspending yourself
    # revokes your own token on the very next request, so there is no undo from
    # inside the app at all.
    response = suspend(admin_user.id)
    assert response.status_code == 409

    admin_user.refresh_from_db()
    assert admin_user.is_active is True


@pytest.mark.django_db
def test_suspending_is_idempotent(client, alice, admin_user, suspend):
    assert suspend(alice.id).status_code == 200
    second = suspend(alice.id)
    assert second.status_code == 200
    assert second.json()["is_active"] is False
