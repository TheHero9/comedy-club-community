"""Authentication, the role matrix and actor derivation (matrix sections 13, 14, 19).

🔒 These are the rules that, if broken, let someone act as someone else.

Rows 13.2 and 13.3 are tested against the **Clerk** backend, because that is the
one that runs in production. The dev backend is a local convenience that prod.py
refuses to boot with, so testing forgery against it would prove nothing.

Rate limiting is switched off for this module: hammering a table of endpoints as
one actor is exactly what the limiter is designed to stop, and it has its own
dedicated file (test_rate_limits.py).
"""

from __future__ import annotations

import datetime as dt

import jwt
import pytest
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from ninja.errors import HttpError

from podcast.auth.backends import ClerkAuth
from podcast.auth.permissions import require_admin, require_moderator
from podcast.models import (
    Comment,
    EpisodeTopic,
    Moment,
    PersonalTag,
    Rating,
    Report,
    Topic,
    UserProfile,
)

from .conftest import auth_header, make_user

pytestmark = pytest.mark.django_db

BASE = "/api"
CLERK_ISSUER = "https://clerk.example"


@pytest.fixture(autouse=True)
def no_rate_limit(settings):
    """These tables make many writes as one actor on purpose."""
    settings.API_WRITE_RATE_LIMIT = ""


# ===========================================================================
# 13. Authentication
# ===========================================================================


def _protected_operations() -> list[tuple[str, str]]:
    """Every operation the OpenAPI schema marks as requiring auth.

    Derived from the schema rather than hand-listed, so a new protected endpoint
    is covered by row 13.1 the moment it is added.
    """
    from config.api import api

    schema = api.get_openapi_schema()
    return [
        (method.upper(), path)
        for path, operations in schema["paths"].items()
        for method, operation in operations.items()
        if "security" in operation
    ]


def _fill_path(path: str, youtube_id: str) -> str:
    return (
        path.replace("{youtube_id}", youtube_id)
        .replace("{membership_id}", "1")
        .replace("{comment_id}", "1")
        .replace("{episode_topic_id}", "1")
        .replace("{moment_id}", "1")
        .replace("{report_id}", "1")
        .replace("{event_id}", "1")
        .replace("{tag_id}", "1")
    )


def test_13_1_the_schema_declares_a_meaningful_number_of_protected_operations():
    """Guard: if the extraction ever silently returns [], row 13.1 would pass vacuously."""
    operations = _protected_operations()
    assert len(operations) >= 30, operations
    assert ("GET", "/api/me") in operations


def test_13_1_every_protected_operation_rejects_an_anonymous_caller(client, episode):
    failures = []
    for method, path in _protected_operations():
        response = client.generic(
            method, _fill_path(path, episode.youtube_id), content_type="application/json"
        )
        if response.status_code != 401:
            failures.append(f"{method} {path} -> {response.status_code}")
    assert not failures, f"protected endpoints that did not 401: {failures}"


def test_13_1_public_reads_stay_open_to_anonymous_callers(client, episode):
    """The complement: authentication must not creep onto indexable pages."""
    for path in (
        "/channels",
        f"/channels/{episode.channel.slug}",
        f"/channels/{episode.channel.slug}/grid",
        "/episodes",
        f"/episodes/{episode.youtube_id}",
        f"/episodes/{episode.youtube_id}/comments",
        f"/episodes/{episode.youtube_id}/moments",
        "/topics",
        "/topics/suggest?q=по",
        "/people",
        "/search?q=Каспаров",
        "/search/suggest?q=Ка",
        "/leaderboards/top_rated",
        "/health",
    ):
        assert client.get(f"{BASE}{path}").status_code == 200, path


def test_13_1_a_malformed_authorization_header_is_not_a_free_pass(client):
    for header in ("", "Bearer", "Basic dXNlcjpwYXNz", "dev:alice", "Bearer  "):
        response = client.get(f"{BASE}/me", HTTP_AUTHORIZATION=header)
        assert response.status_code == 401, header


def test_13_2_a_jwt_shaped_token_is_rejected_by_the_active_backend(client, rsa_key):
    """A real, correctly signed Clerk token is still not a dev token."""
    token = _clerk_token(rsa_key)
    assert client.get(f"{BASE}/me", HTTP_AUTHORIZATION=f"Bearer {token}").status_code == 401


# ---------------------------------------------------------------------------
# 13.2 / 13.3 - the Clerk path
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def rsa_key():
    """A throwaway signing key. Module-scoped: RSA generation is not free."""
    from cryptography.hazmat.primitives.asymmetric import rsa

    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def other_rsa_key():
    """A key Clerk never published - the attacker's key."""
    from cryptography.hazmat.primitives.asymmetric import rsa

    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _clerk_token(key, *, lifetime_sec: int = 3600, **claims) -> str:
    now = dt.datetime.now(dt.UTC)
    payload = {
        "sub": "user_2abcDEF",
        "iss": CLERK_ISSUER,
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(seconds=lifetime_sec)).timestamp()),
    }
    payload.update(claims)
    return jwt.encode(payload, key, algorithm="RS256")


@pytest.fixture
def clerk(monkeypatch, settings, rsa_key):
    """A ClerkAuth wired to a local JWKS holding only our public key."""
    settings.AUTH_BACKEND = "clerk"
    settings.CLERK_ISSUER = CLERK_ISSUER
    settings.CLERK_JWKS_URL = f"{CLERK_ISSUER}/.well-known/jwks.json"

    class _SigningKey:
        key = rsa_key.public_key()

    class _JwksClient:
        def get_signing_key_from_jwt(self, token):
            return _SigningKey()

    monkeypatch.setattr(ClerkAuth, "_jwks_client", None, raising=False)
    monkeypatch.setattr(ClerkAuth, "_get_jwks_client", classmethod(lambda cls: _JwksClient()))
    return ClerkAuth()


def _request():
    from django.test import RequestFactory

    return RequestFactory().get("/api/me")


def test_13_2_a_correctly_signed_clerk_token_authenticates(clerk, rsa_key, db):
    user = clerk.authenticate(_request(), _clerk_token(rsa_key))
    assert isinstance(user, User)
    assert user.profile.clerk_user_id == "user_2abcDEF"


def test_13_2_a_token_signed_with_the_wrong_key_is_rejected(clerk, other_rsa_key, db):
    """🔒 Forgery. The signature is checked against Clerk's JWKS, always."""
    assert clerk.authenticate(_request(), _clerk_token(other_rsa_key)) is None
    assert User.objects.count() == 0


def test_13_2_a_tampered_payload_is_rejected(clerk, rsa_key, db):
    """🔒 Elevating `sub` after signing must invalidate the signature."""
    header, payload, signature = _clerk_token(rsa_key).split(".")
    import base64
    import json

    decoded = json.loads(base64.urlsafe_b64decode(payload + "=="))
    decoded["sub"] = "user_SOMEONE_ELSE"
    forged = base64.urlsafe_b64encode(json.dumps(decoded).encode()).decode().rstrip("=")

    assert clerk.authenticate(_request(), f"{header}.{forged}.{signature}") is None
    assert User.objects.count() == 0


def test_13_2_an_unsigned_alg_none_token_is_rejected(clerk, db):
    """🔒 The classic JWT bypass: drop the signature and claim alg=none."""
    now = dt.datetime.now(dt.UTC)
    token = jwt.encode(
        {
            "sub": "user_2abcDEF",
            "iss": CLERK_ISSUER,
            "exp": int((now + dt.timedelta(hours=1)).timestamp()),
        },
        key="",
        algorithm="none",
    )
    assert clerk.authenticate(_request(), token) is None
    assert User.objects.count() == 0


def test_13_2_a_token_from_the_wrong_issuer_is_rejected(clerk, rsa_key, db):
    token = _clerk_token(rsa_key, iss="https://evil.example")
    assert clerk.authenticate(_request(), token) is None


def test_13_2_a_token_without_a_subject_is_rejected(clerk, rsa_key, db):
    token = _clerk_token(rsa_key, sub="")
    assert clerk.authenticate(_request(), token) is None
    assert User.objects.count() == 0


@pytest.mark.parametrize("token", ["", "not-a-jwt", "a.b.c", "Bearer x"])
def test_13_2_garbage_tokens_are_rejected(clerk, token, db):
    assert clerk.authenticate(_request(), token) is None


def test_13_3_an_expired_token_is_rejected(clerk, rsa_key, db):
    """🔒 Signature alone is not enough - `exp` is verified too."""
    token = _clerk_token(rsa_key, lifetime_sec=-60)
    assert clerk.authenticate(_request(), token) is None
    assert User.objects.count() == 0


def test_13_3_a_token_that_expires_in_a_second_still_works_now(clerk, rsa_key, db):
    """The expiry check must not be so eager that live tokens fail."""
    assert clerk.authenticate(_request(), _clerk_token(rsa_key, lifetime_sec=30)) is not None


def test_13_4_a_valid_token_provisions_exactly_one_user_and_profile(clerk, rsa_key, db):
    token = _clerk_token(rsa_key, name="Иван", username="ivan")
    first = clerk.authenticate(_request(), token)

    assert User.objects.count() == 1
    assert UserProfile.objects.count() == 1
    assert first.profile.display_name == "Иван"
    assert first.profile.role == UserProfile.Role.MEMBER


def test_13_4_provisioning_is_idempotent_across_repeat_calls(clerk, rsa_key, db):
    for _ in range(3):
        clerk.authenticate(_request(), _clerk_token(rsa_key))

    assert User.objects.filter(profile__clerk_user_id="user_2abcDEF").count() == 1
    assert UserProfile.objects.count() == 1


def test_13_4_identity_is_keyed_on_sub_not_email(clerk, rsa_key, db):
    """🔒 An email can change hands; the Clerk subject cannot."""
    clerk.authenticate(_request(), _clerk_token(rsa_key, email="a@example.com"))
    clerk.authenticate(_request(), _clerk_token(rsa_key, email="b@example.com"))
    clerk.authenticate(_request(), _clerk_token(rsa_key, sub="user_OTHER"))

    assert User.objects.count() == 2


def test_13_4_a_new_subject_never_reuses_an_existing_username(clerk, rsa_key, db):
    clerk.authenticate(_request(), _clerk_token(rsa_key, username="ivan"))
    clerk.authenticate(_request(), _clerk_token(rsa_key, sub="user_OTHER", username="ivan"))

    usernames = set(User.objects.values_list("username", flat=True))
    assert len(usernames) == 2


# ===========================================================================
# 14. Role matrix
# ===========================================================================


@pytest.fixture
def admin(db):
    return make_user("adminuser", role=UserProfile.Role.ADMIN)


@pytest.fixture
def as_admin():
    return auth_header("adminuser")


# --- 14.1 member on moderator routes ---------------------------------------


def test_14_1_a_member_cannot_read_the_report_queue(client, alice, as_alice):
    assert client.get(f"{BASE}/reports", **as_alice).status_code == 403


def test_14_1_a_member_cannot_resolve_a_report(client, episode, alice, bob, as_alice):
    comment = Comment.objects.create(user=bob, episode=episode, body="спам")
    report = _report(bob, comment)

    response = client.post(
        f"{BASE}/reports/{report.id}/resolve",
        data={"status": "resolved", "resolution_note": ""},
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 403
    report.refresh_from_db()
    assert report.status == Report.Status.PENDING


def test_14_1_a_member_cannot_touch_another_members_content(
    client, episode, alice, bob, as_bob
):
    comment = Comment.objects.create(user=alice, episode=episode, body="на Алиса")
    moment = Moment.objects.create(user=alice, episode=episode, timestamp_sec=5, label="тук")
    topic = Topic.objects.create(name="политика")
    episode_topic = EpisodeTopic.objects.create(episode=episode, topic=topic, added_by=alice)

    assert client.delete(f"{BASE}/comments/{comment.id}", **as_bob).status_code == 403
    assert client.delete(f"{BASE}/moments/{moment.id}", **as_bob).status_code == 403
    assert (
        client.delete(f"{BASE}/episode-topics/{episode_topic.id}", **as_bob).status_code == 403
    )

    assert Comment.objects.filter(id=comment.id, is_hidden=False).exists()
    assert Moment.objects.filter(id=moment.id).exists()
    assert EpisodeTopic.objects.filter(id=episode_topic.id).exists()


# --- 14.2 moderator on admin-only actions ----------------------------------


def test_14_2_require_admin_rejects_a_moderator(moderator):
    """🔒 Moderator is not admin. No API router exposes an admin-only action today,
    so the guard itself is pinned - the day one appears, it already behaves."""
    with pytest.raises(HttpError) as exc:
        require_admin(moderator)
    assert exc.value.status_code == 403


def test_14_2_require_admin_accepts_an_admin(admin):
    assert require_admin(admin).role == UserProfile.Role.ADMIN


def test_14_2_require_moderator_accepts_both_staff_roles(moderator, admin, alice):
    assert require_moderator(moderator).is_staff_role is True
    assert require_moderator(admin).is_staff_role is True
    with pytest.raises(HttpError) as exc:
        require_moderator(alice)
    assert exc.value.status_code == 403


def test_14_2_a_moderator_cannot_promote_themselves_to_admin(
    client, moderator, as_moderator
):
    """🔒 Role escalation happens in the Django admin, never over the API."""
    client.patch(
        f"{BASE}/me",
        data={"display_name": "Mod", "role": "admin"},
        content_type="application/json",
        **as_moderator,
    )
    moderator.profile.refresh_from_db()
    assert moderator.profile.role == UserProfile.Role.MODERATOR


# --- 14.3 table-driven: every write endpoint x every role -------------------


def _report(user, target) -> Report:
    from django.contrib.contenttypes.models import ContentType

    return Report.objects.create(
        reporter=user,
        reason="спам",
        content_type=ContentType.objects.get_for_model(type(target)),
        object_id=target.id,
    )


@pytest.fixture
def roles(db, alice, moderator, admin):
    return {
        "member": (alice, auth_header("alice")),
        "moderator": (moderator, auth_header("mod")),
        "admin": (admin, auth_header("adminuser")),
    }


def test_14_3_ordinary_write_endpoints_are_open_to_every_role(
    client, episode, channel, roles
):
    """Rating, watching, favouriting, tagging, commenting, labelling: all roles."""
    for role, (_user, headers) in roles.items():
        calls = [
            client.put(
                f"{BASE}/episodes/{episode.youtube_id}/rating",
                data={"score": 7},
                content_type="application/json",
                **headers,
            ),
            client.post(
                f"{BASE}/episodes/{episode.youtube_id}/watch",
                data={},
                content_type="application/json",
                **headers,
            ),
            client.put(f"{BASE}/episodes/{episode.youtube_id}/favorite", **headers),
            client.post(
                f"{BASE}/episodes/{episode.youtube_id}/tags",
                data={"text": "смешно"},
                content_type="application/json",
                **headers,
            ),
            client.post(
                f"{BASE}/episodes/{episode.youtube_id}/comments",
                data={"body": "коментар", "is_spoiler": False},
                content_type="application/json",
                **headers,
            ),
            client.post(
                f"{BASE}/episodes/{episode.youtube_id}/moments",
                data={"timestamp_sec": 12, "label": "момент"},
                content_type="application/json",
                **headers,
            ),
            client.post(
                f"{BASE}/episodes/{episode.youtube_id}/topics",
                data={"name": "шахмат"},
                content_type="application/json",
                **headers,
            ),
            client.post(
                f"{BASE}/me/memberships",
                data={"channel_id": channel.id},
                content_type="application/json",
                **headers,
            ),
            client.patch(
                f"{BASE}/me",
                # 🚨 NOT `role`, which is what this used to send. Two of the
                # three role names ("moderator", "admin") are now reserved
                # display names - see services/display_names.py - so the loop
                # was asserting a 200 on a payload the API is supposed to
                # reject. The role was only ever an arbitrary string in scope;
                # this test is about whether every role may WRITE, not about
                # what a name may contain, so it uses an ordinary name and
                # keeps asserting exactly what it always did.
                data={"display_name": f"Иван {role}ов"},
                content_type="application/json",
                **headers,
            ),
        ]
        for response in calls:
            assert response.status_code == 200, (role, response.status_code, response.content)


def test_14_3_moderator_only_endpoints_reject_members_and_accept_staff(
    client, episode, roles
):
    owner, _ = roles["member"]
    comment = Comment.objects.create(user=owner, episode=episode, body="докладвано")
    expected = {"member": 403, "moderator": 200, "admin": 200}

    for role, (_user, headers) in roles.items():
        listed = client.get(f"{BASE}/reports", **headers)
        assert listed.status_code == expected[role], role

        report = _report(owner, comment)
        resolved = client.post(
            f"{BASE}/reports/{report.id}/resolve",
            data={"status": "resolved", "resolution_note": "ok"},
            content_type="application/json",
            **headers,
        )
        assert resolved.status_code == expected[role], role
        report.delete()


def test_14_3_moderating_another_users_content_is_staff_only(client, episode, roles):
    # A third party, so "member" is never the owner and the 403 is about role.
    owner = make_user("contentowner")
    expected = {"member": 403, "moderator": 200, "admin": 200}

    for role, (_user, headers) in roles.items():
        comment = Comment.objects.create(user=owner, episode=episode, body="лошо")
        moment = Moment.objects.create(
            user=owner, episode=episode, timestamp_sec=9, label="лошо"
        )

        assert client.delete(f"{BASE}/comments/{comment.id}", **headers).status_code == (
            expected[role]
        ), role
        assert client.delete(f"{BASE}/moments/{moment.id}", **headers).status_code == (
            expected[role]
        ), role

        comment.delete()
        Moment.objects.filter(id=moment.id).delete()


def test_14_3_a_moderator_hides_rather_than_destroys(client, episode, alice, as_moderator, moderator):
    """The moderation trail has to survive the moderation."""
    comment = Comment.objects.create(user=alice, episode=episode, body="лошо")

    assert client.delete(f"{BASE}/comments/{comment.id}", **as_moderator).status_code == 200

    comment.refresh_from_db()
    assert comment.is_hidden is True


def test_14_3_owners_may_always_edit_their_own_content(client, episode, alice, as_alice):
    comment = Comment.objects.create(user=alice, episode=episode, body="мое")
    response = client.patch(
        f"{BASE}/comments/{comment.id}",
        data={"body": "поправено", "is_spoiler": False},
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 200
    comment.refresh_from_db()
    assert comment.body == "поправено"
    assert comment.is_hidden is False  # deleting your own is a real delete, not a hide


# ===========================================================================
# 19. The actor always comes from the token
# ===========================================================================


def test_19_1_a_user_id_in_a_rating_body_is_ignored(client, episode, alice, bob, as_bob):
    client.put(
        f"{BASE}/episodes/{episode.youtube_id}/rating",
        data={"score": 10, "user_id": alice.id, "user": alice.id},
        content_type="application/json",
        **as_bob,
    )
    assert Rating.objects.filter(user=bob).count() == 1
    assert Rating.objects.filter(user=alice).count() == 0


def test_19_1_a_user_id_in_a_comment_body_is_ignored(client, episode, alice, bob, as_bob):
    response = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/comments",
        data={"body": "чуждо", "is_spoiler": False, "user_id": alice.id, "author_id": alice.id},
        content_type="application/json",
        **as_bob,
    )
    assert response.status_code == 200
    assert response.json()["author_id"] == bob.id
    assert Comment.objects.get().user_id == bob.id


def test_19_1_a_user_id_in_a_moment_body_is_ignored(client, episode, alice, bob, as_bob):
    client.post(
        f"{BASE}/episodes/{episode.youtube_id}/moments",
        data={"timestamp_sec": 10, "label": "чуждо", "user_id": alice.id},
        content_type="application/json",
        **as_bob,
    )
    assert Moment.objects.get().user_id == bob.id


def test_19_1_a_user_id_in_a_personal_tag_body_is_ignored(
    client, episode, alice, bob, as_bob
):
    """🔒 Writing a private tag onto someone else's account would be a data leak."""
    client.post(
        f"{BASE}/episodes/{episode.youtube_id}/tags",
        data={"text": "чуждо", "user_id": alice.id},
        content_type="application/json",
        **as_bob,
    )
    assert PersonalTag.objects.get().user_id == bob.id


def test_19_1_a_reporter_cannot_be_spoofed(client, episode, alice, bob, as_bob):
    comment = Comment.objects.create(user=alice, episode=episode, body="нещо")
    client.post(
        f"{BASE}/reports",
        data={
            "target_type": "comment",
            "target_id": comment.id,
            "reason": "спам",
            "reporter": alice.id,
            "reporter_id": alice.id,
        },
        content_type="application/json",
        **as_bob,
    )
    assert Report.objects.get().reporter_id == bob.id


def test_19_1_a_topic_label_records_the_token_actor(client, episode, alice, bob, as_bob):
    client.post(
        f"{BASE}/episodes/{episode.youtube_id}/topics",
        data={"name": "шахмат", "added_by": alice.id, "user_id": alice.id},
        content_type="application/json",
        **as_bob,
    )
    assert EpisodeTopic.objects.get().added_by_id == bob.id


def test_19_1_a_membership_claim_records_the_token_actor(
    client, channel, alice, bob, as_bob
):
    from podcast.models import ChannelMembership

    client.post(
        f"{BASE}/me/memberships",
        data={"channel_id": channel.id, "user_id": alice.id, "is_verified": True},
        content_type="application/json",
        **as_bob,
    )
    membership = ChannelMembership.objects.get()
    assert membership.user_id == bob.id
    assert membership.is_verified is False, "🔒 self-verification must be impossible"


def test_19_1_listing_private_data_is_scoped_to_the_token_actor(
    client, episode, alice, bob, as_bob
):
    PersonalTag.objects.create(user=alice, episode=episode, text="на Алиса")
    Rating.objects.create(user=alice, episode=episode, score=9)

    assert client.get(f"{BASE}/me/tags", **as_bob).json() == []
    assert client.get(f"{BASE}/me/ratings", **as_bob).json()["meta"]["total"] == 0
    assert client.get(f"{BASE}/me", **as_bob).json()["username"] == "bob"


def test_19_2_rating_the_same_episode_twice_updates_rather_than_duplicates(
    client, episode, alice, as_alice
):
    for score in (3, 7, 10):
        client.put(
            f"{BASE}/episodes/{episode.youtube_id}/rating",
            data={"score": score},
            content_type="application/json",
            **as_alice,
        )

    assert Rating.objects.filter(user=alice, episode=episode).count() == 1
    assert Rating.objects.get(user=alice, episode=episode).score == 10


def test_19_2_the_unique_constraint_is_enforced_by_the_database(episode, alice):
    """🔒 Uniqueness lives in the DB, never in application code alone."""
    Rating.objects.create(user=alice, episode=episode, score=5)
    with pytest.raises(IntegrityError), transaction.atomic():
        Rating.objects.create(user=alice, episode=episode, score=6)
