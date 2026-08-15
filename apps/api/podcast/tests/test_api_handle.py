"""PATCH /api/me and the self-chosen public handle.

Owner ruling 2026-08-15: the handle is user-editable ("users can and will edit
it, it's their name basically"). That makes it public user input, so it gets
the same treatment as any other: normalised once, validated, and a taken name
must be a clean 4xx rather than a 500 out of the unique constraint.
"""

import pytest
from django.test import Client

from podcast.models import UserProfile
from podcast.tests.conftest import auth_header


@pytest.fixture
def client():
    return Client()


@pytest.mark.django_db
class TestHandleUpdate:
    def test_a_user_can_set_their_handle(self, client, alice):
        response = client.patch(
            "/api/me",
            data={"handle": "@Ivan_Petrov"},
            content_type="application/json",
            **auth_header("alice"),
        )
        assert response.status_code == 200
        assert response.json()["handle"] == "ivan_petrov"

    def test_omitting_the_field_leaves_the_handle_alone(self, client, alice):
        client.patch(
            "/api/me",
            data={"handle": "ivan"},
            content_type="application/json",
            **auth_header("alice"),
        )
        response = client.patch(
            "/api/me",
            data={"display_name": "Иван"},
            content_type="application/json",
            **auth_header("alice"),
        )
        assert response.json()["handle"] == "ivan"

    def test_an_empty_string_clears_it_to_null(self, client, alice):
        client.patch(
            "/api/me",
            data={"handle": "ivan"},
            content_type="application/json",
            **auth_header("alice"),
        )
        response = client.patch(
            "/api/me",
            data={"handle": ""},
            content_type="application/json",
            **auth_header("alice"),
        )
        assert response.status_code == 200
        assert response.json()["handle"] is None
        # 🚨 NULL, not "". The column is unique and "" is a value in Postgres,
        # so a second user clearing theirs would collide.
        assert UserProfile.objects.get(user=alice).handle is None

    def test_two_users_can_both_have_no_handle(self, client, alice, bob):
        for who in ("alice", "bob"):
            response = client.patch(
                "/api/me",
                data={"handle": ""},
                content_type="application/json",
                **auth_header(who),
            )
            assert response.status_code == 200

    def test_a_taken_handle_is_a_409_not_a_500(self, client, alice, bob):
        client.patch(
            "/api/me",
            data={"handle": "ivan"},
            content_type="application/json",
            **auth_header("alice"),
        )
        response = client.patch(
            "/api/me",
            data={"handle": "ivan"},
            content_type="application/json",
            **auth_header("bob"),
        )
        assert response.status_code == 409

    def test_case_differences_do_not_dodge_uniqueness(self, client, alice, bob):
        client.patch(
            "/api/me",
            data={"handle": "ivan"},
            content_type="application/json",
            **auth_header("alice"),
        )
        response = client.patch(
            "/api/me",
            data={"handle": "IVAN"},
            content_type="application/json",
            **auth_header("bob"),
        )
        assert response.status_code == 409

    def test_keeping_your_own_handle_is_not_a_conflict(self, client, alice):
        for _ in range(2):
            response = client.patch(
                "/api/me",
                data={"handle": "ivan"},
                content_type="application/json",
                **auth_header("alice"),
            )
            assert response.status_code == 200

    @pytest.mark.parametrize("bad", ["ab", "ivan petrov", "iv@n", "_ivan", "iva\x00n"])
    def test_an_invalid_handle_is_a_422_with_a_reason(self, client, alice, bad):
        response = client.patch(
            "/api/me",
            data={"handle": bad},
            content_type="application/json",
            **auth_header("alice"),
        )
        assert response.status_code == 422

    def test_cyrillic_is_accepted(self, client, alice):
        response = client.patch(
            "/api/me",
            data={"handle": "иван_петров"},
            content_type="application/json",
            **auth_header("alice"),
        )
        assert response.status_code == 200
        assert response.json()["handle"] == "иван_петров"


@pytest.mark.django_db
class TestNoEmailLeak:
    def test_the_display_name_is_never_an_email(self, client, alice):
        """🔒 `author_name` on every public comment comes from the same value."""
        profile = UserProfile.objects.get(user=alice)
        profile.display_name = ""
        profile.save(update_fields=["display_name"])
        alice.username = "user_33KqZmNhY2tlZA"
        alice.email = "ivan.petrov@gmail.com"
        alice.save(update_fields=["username", "email"])

        response = client.get("/api/me", **auth_header("alice"))
        # The dev backend re-provisions on the token, so read the field itself.
        name = response.json()["display_name"]
        assert "@" not in name
        assert "ivan.petrov" not in name
