"""Granting roles from the app, and the guard that keeps an admin in place."""

import pytest

from podcast.models import UserProfile

pytestmark = pytest.mark.django_db


class TestWhoCanSeeAndGrant:
    def test_only_an_admin_can_list_users(self, client, moderator, as_moderator):
        """🔒 A moderator who could see and set roles would simply promote
        themselves, which makes the two roles the same role."""
        assert client.get("/api/moderation/users", **as_moderator).status_code == 403

    def test_a_member_cannot(self, client, alice, as_alice):
        assert client.get("/api/moderation/users", **as_alice).status_code == 403

    def test_an_admin_can(self, client, admin_user, as_admin, alice):
        response = client.get("/api/moderation/users", **as_admin)
        assert response.status_code == 200, response.content
        usernames = {row["username"] for row in response.json()}
        assert {"boss", "alice"} <= usernames

    def test_the_listing_never_exposes_emails(self, client, admin_user, as_admin, alice):
        """The panel grants permissions; it does not need everyone's address."""
        body = client.get("/api/moderation/users", **as_admin).json()
        assert body, "fixture check: there must be users to inspect"
        for row in body:
            assert "email" not in row

    def test_search_narrows_the_list(self, client, admin_user, as_admin, alice, bob):
        body = client.get("/api/moderation/users?q=alic", **as_admin).json()
        assert [row["username"] for row in body] == ["alice"]


class TestGranting:
    def test_an_admin_promotes_a_member_to_moderator(
        self, client, admin_user, as_admin, alice
    ):
        response = client.patch(
            f"/api/moderation/users/{alice.id}",
            data={"role": "moderator"},
            content_type="application/json",
            **as_admin,
        )
        assert response.status_code == 200, response.content
        assert response.json()["role"] == "moderator"
        alice.profile.refresh_from_db()
        assert alice.profile.role == UserProfile.Role.MODERATOR

    def test_promoting_to_admin_also_opens_the_django_admin_site(
        self, client, admin_user, as_admin, alice
    ):
        """🔒 role and is_staff/is_superuser are separate switches. Setting one
        and not the other is what leaves an account half-privileged, failing in
        a confusing place."""
        client.patch(
            f"/api/moderation/users/{alice.id}",
            data={"role": "admin"},
            content_type="application/json",
            **as_admin,
        )
        alice.refresh_from_db()
        assert alice.is_staff is True
        assert alice.is_superuser is True

    def test_demoting_closes_it_again(self, client, admin_user, as_admin, alice):
        client.patch(
            f"/api/moderation/users/{alice.id}",
            data={"role": "admin"},
            content_type="application/json",
            **as_admin,
        )
        client.patch(
            f"/api/moderation/users/{alice.id}",
            data={"role": "member"},
            content_type="application/json",
            **as_admin,
        )
        alice.refresh_from_db()
        assert alice.is_staff is False
        assert alice.is_superuser is False
        assert alice.profile.role == UserProfile.Role.MEMBER

    def test_an_unknown_role_is_refused(self, client, admin_user, as_admin, alice):
        response = client.patch(
            f"/api/moderation/users/{alice.id}",
            data={"role": "superuser"},
            content_type="application/json",
            **as_admin,
        )
        assert response.status_code == 422
        alice.profile.refresh_from_db()
        assert alice.profile.role == UserProfile.Role.MEMBER

    def test_a_moderator_cannot_promote_anyone(
        self, client, moderator, as_moderator, alice
    ):
        response = client.patch(
            f"/api/moderation/users/{alice.id}",
            data={"role": "admin"},
            content_type="application/json",
            **as_moderator,
        )
        assert response.status_code == 403
        alice.profile.refresh_from_db()
        assert alice.profile.role == UserProfile.Role.MEMBER


class TestSelfLockout:
    def test_an_admin_cannot_change_their_own_role(
        self, client, admin_user, as_admin
    ):
        """🚨 The one guard that matters. Demoting yourself is unrecoverable
        from inside the app - it would need a shell on production Postgres."""
        response = client.patch(
            f"/api/moderation/users/{admin_user.id}",
            data={"role": "member"},
            content_type="application/json",
            **as_admin,
        )
        assert response.status_code == 409
        admin_user.profile.refresh_from_db()
        assert admin_user.profile.role == UserProfile.Role.ADMIN

    def test_the_guard_holds_even_when_setting_the_same_role(
        self, client, admin_user, as_admin
    ):
        """No "harmless" self-edit path: one exception is how the rule erodes."""
        response = client.patch(
            f"/api/moderation/users/{admin_user.id}",
            data={"role": "admin"},
            content_type="application/json",
            **as_admin,
        )
        assert response.status_code == 409

    def test_another_admin_can_still_demote_them(
        self, client, admin_user, as_admin, alice
    ):
        """The guard is about SELF, not about admins being untouchable - so a
        second admin is always a way out."""
        client.patch(
            f"/api/moderation/users/{alice.id}",
            data={"role": "admin"},
            content_type="application/json",
            **as_admin,
        )
        response = client.patch(
            f"/api/moderation/users/{admin_user.id}",
            data={"role": "member"},
            content_type="application/json",
            **{"HTTP_AUTHORIZATION": "Bearer dev:alice"},
        )
        assert response.status_code == 200, response.content
        admin_user.profile.refresh_from_db()
        assert admin_user.profile.role == UserProfile.Role.MEMBER
