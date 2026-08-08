"""Authentication and authorization.

🔒 The rules being pinned here are the ones that, if broken, let a user act as
someone else or read someone else's private data.
"""

import pytest
from django.contrib.auth.models import User

from podcast.models import PersonalTag, Rating, UserProfile

pytestmark = pytest.mark.django_db

BASE = "/api"


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


def test_protected_endpoint_rejects_anonymous(client, db):
    assert client.get(f"{BASE}/me").status_code == 401


def test_protected_endpoint_rejects_a_garbage_token(client, db):
    response = client.get(f"{BASE}/me", HTTP_AUTHORIZATION="Bearer totally-made-up")
    assert response.status_code == 401


def test_protected_endpoint_accepts_a_valid_actor(client, alice, as_alice):
    response = client.get(f"{BASE}/me", **as_alice)
    assert response.status_code == 200
    assert response.json()["username"] == "alice"


def test_first_request_provisions_a_user_and_profile(client, db):
    assert not User.objects.filter(username="brandnew").exists()

    response = client.get(f"{BASE}/me", HTTP_AUTHORIZATION="Bearer dev:brandnew")

    assert response.status_code == 200
    user = User.objects.get(username="brandnew")
    assert UserProfile.objects.get(user=user).clerk_user_id == "dev_brandnew"


def test_provisioning_is_idempotent(client, db):
    for _ in range(3):
        client.get(f"{BASE}/me", HTTP_AUTHORIZATION="Bearer dev:repeat")
    assert User.objects.filter(username="repeat").count() == 1


# ---------------------------------------------------------------------------
# 🔒 Production guard
# ---------------------------------------------------------------------------


def _import_prod_settings():
    """Import config.settings.prod fresh.

    It must NOT be imported at module scope: prod.py raises at import time by
    design, so a top-level import would blow up before pytest.raises could catch it.
    """
    import importlib
    import sys

    sys.modules.pop("config.settings.prod", None)
    try:
        return importlib.import_module("config.settings.prod")
    finally:
        # Never leave a half-initialised settings module behind for other tests.
        sys.modules.pop("config.settings.prod", None)


def test_production_settings_refuse_the_dev_auth_backend(monkeypatch):
    """🚨 The dev backend trusts an unverified header. If it could be enabled in
    production, anyone could impersonate anyone. Booting must fail instead."""
    import os

    monkeypatch.setitem(os.environ, "AUTH_BACKEND", "dev")
    monkeypatch.setitem(os.environ, "DJANGO_SECRET_KEY", "x" * 50)
    monkeypatch.setitem(os.environ, "DJANGO_ALLOWED_HOSTS", "example.com")
    # Fully configured Clerk, so the ONLY thing that can fail is the backend guard.
    monkeypatch.setitem(os.environ, "CLERK_JWKS_URL", "https://clerk.example/jwks")
    monkeypatch.setitem(os.environ, "CLERK_ISSUER", "https://clerk.example")

    with pytest.raises(RuntimeError, match="not permitted in production"):
        _import_prod_settings()


def test_production_settings_require_clerk_configuration(monkeypatch):
    import os

    monkeypatch.setitem(os.environ, "AUTH_BACKEND", "clerk")
    monkeypatch.setitem(os.environ, "DJANGO_SECRET_KEY", "x" * 50)
    monkeypatch.setitem(os.environ, "DJANGO_ALLOWED_HOSTS", "example.com")
    monkeypatch.setitem(os.environ, "CLERK_JWKS_URL", "")

    with pytest.raises(RuntimeError, match="CLERK_JWKS_URL"):
        _import_prod_settings()


def test_production_settings_boot_when_properly_configured(monkeypatch):
    """The guards must not be so eager that a correct production config fails."""
    import os

    monkeypatch.setitem(os.environ, "AUTH_BACKEND", "clerk")
    monkeypatch.setitem(os.environ, "DJANGO_SECRET_KEY", "x" * 50)
    monkeypatch.setitem(os.environ, "DJANGO_ALLOWED_HOSTS", "example.com")
    monkeypatch.setitem(os.environ, "CLERK_JWKS_URL", "https://clerk.example/jwks")
    monkeypatch.setitem(os.environ, "CLERK_ISSUER", "https://clerk.example")

    settings_module = _import_prod_settings()

    assert settings_module.DEBUG is False
    assert settings_module.AUTH_BACKEND == "clerk"
    assert settings_module.SESSION_COOKIE_SECURE is True


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


def test_a_user_cannot_edit_another_users_comment(client, episode, alice, bob, as_bob):
    from podcast.models import Comment

    comment = Comment.objects.create(user=alice, episode=episode, body="на Алиса")

    response = client.patch(
        f"{BASE}/comments/{comment.id}",
        data={"body": "подменено", "is_spoiler": False},
        content_type="application/json",
        **as_bob,
    )
    assert response.status_code == 403
    comment.refresh_from_db()
    assert comment.body == "на Алиса"


def test_a_moderator_can_hide_another_users_comment(
    client, episode, alice, moderator, as_moderator
):
    from podcast.models import Comment

    comment = Comment.objects.create(user=alice, episode=episode, body="лошо")

    response = client.delete(f"{BASE}/comments/{comment.id}", **as_moderator)

    assert response.status_code == 200
    comment.refresh_from_db()
    # Hidden, not destroyed - the moderation trail must survive.
    assert comment.is_hidden is True


def test_a_plain_member_cannot_read_the_report_queue(client, alice, as_alice):
    assert client.get(f"{BASE}/reports", **as_alice).status_code == 403


def test_a_moderator_can_read_the_report_queue(client, moderator, as_moderator):
    assert client.get(f"{BASE}/reports", **as_moderator).status_code == 200


def test_a_user_cannot_delete_another_users_personal_tag(
    client, episode, alice, bob, as_bob
):
    """🔒 Personal tags are private per user."""
    tag = PersonalTag.objects.create(user=alice, episode=episode, text="моят")

    assert client.delete(f"{BASE}/tags/{tag.id}", **as_bob).status_code == 404
    assert PersonalTag.objects.filter(id=tag.id).exists()


def test_a_user_cannot_promote_themselves_via_the_profile_endpoint(
    client, alice, as_alice
):
    """🔒 Role escalation must be impossible from the public API."""
    client.patch(
        f"{BASE}/me",
        data={"display_name": "Alice", "role": "admin"},
        content_type="application/json",
        **as_alice,
    )
    alice.profile.refresh_from_db()
    assert alice.profile.role == UserProfile.Role.MEMBER


def test_the_actor_comes_from_the_token_not_the_request_body(
    client, episode, alice, bob, as_bob
):
    """🔒 A client-supplied user id must never decide who acted."""
    client.put(
        f"{BASE}/episodes/{episode.youtube_id}/rating",
        data={"score": 10, "user": alice.id, "user_id": alice.id},
        content_type="application/json",
        **as_bob,
    )
    assert Rating.objects.filter(user=bob).count() == 1
    assert Rating.objects.filter(user=alice).count() == 0
