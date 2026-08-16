"""The identity a Clerk-provisioned user ends up with.

🚨 These pin the bug that shipped to production on 2026-08-15. Clerk's DEFAULT
session token carries only `sub`, `sid`, `iss`, `exp`, `iat`, `nbf`, `azp`,
`jti`, `v` - no name, no email, no username, no picture. `provision_user`
received empty strings for all of them, fell through to its last resort (the
Clerk `sub`), and the first real Google sign-in rendered:

    Иван Петров          <- expected
    user_33Kq...         <- actual, as the display name
    @user_33Kq...        <- and again, as the handle

Nothing caught it: the value is a legal string, the columns accept it, every
endpoint returned 200. Only a human looking at the page could see it was wrong.
"""

import pytest

from podcast.auth.backends import (
    ensure_profile,
    humanize,
    looks_like_external_id,
    provision_user,
)
from podcast.models import UserProfile


class TestLooksLikeExternalId:
    @pytest.mark.parametrize(
        "value",
        [
            "user_33KqZmNhY2tlZA",
            "user_2abc123",
            "org_9xYz",
            "dev_alice",
        ],
    )
    def test_identity_provider_ids_are_recognised(self, value):
        assert looks_like_external_id(value) is True

    @pytest.mark.parametrize(
        "value",
        [
            "Иван Петров",
            "ivan.petrov",
            "user",
            "",
            "userless_person",
            # A real person could plausibly be called this; the pattern is
            # anchored and requires the underscore, so it must not match.
            "user name",
        ],
    )
    def test_real_names_are_not_mistaken_for_ids(self, value):
        assert looks_like_external_id(value) is False


class TestHumanize:
    def test_prefers_the_first_usable_candidate(self):
        assert humanize("Иван Петров", "ivan", "ivan@example.com") == "Иван Петров"

    def test_skips_an_external_id_and_falls_through(self):
        assert humanize("user_33Kq", "Иван Петров") == "Иван Петров"

    def test_never_uses_an_email_at_all(self):
        """🔒 Reversed on 2026-08-15, and the reversal is the point.

        It used to reduce an address to its local part, on the theory that
        "ivan.petrov" is at least recognisable. In practice Clerk returned no
        name, and the owner's profile greeted them with what read as their own
        email. The same value is `author_name` on every public comment, so that
        fallback would have published the local part of real addresses
        site-wide.
        """
        assert humanize("", "", "ivan.petrov@gmail.com") == ""
        assert humanize("ivan@example.com", "Иван") == "Иван"

    def test_returns_empty_rather_than_an_id_when_nothing_is_usable(self):
        assert humanize("user_33Kq", "", None) == ""
        # Empty is the honest answer: we do not know this person's name. The UI
        # renders a neutral placeholder and invites them to set one.

    def test_truncates_to_the_column_width(self):
        # An unbounded provider value against a CharField(100) is a psycopg
        # DataError 500 on the very first authenticated request.
        assert len(humanize("x" * 500)) == 100


@pytest.mark.django_db
class TestProvisionIdentity:
    def test_a_bare_token_never_stores_the_subject_as_a_display_name(self):
        """The exact production failure: only `sub` is known."""
        user = provision_user(external_id="user_33KqZmNhY2tlZA")
        profile = UserProfile.objects.get(user=user)

        assert profile.display_name != "user_33KqZmNhY2tlZA"
        assert not looks_like_external_id(profile.display_name)

    def test_the_handle_is_null_not_a_copy_of_the_username(self):
        """`handle` is the YouTube handle and is unknown at provisioning.

        Defaulting it to the username is what printed the same junk id twice.
        """
        user = provision_user(external_id="user_33KqZmNhY2tlZA")
        profile = UserProfile.objects.get(user=user)

        assert profile.handle is None

    def test_a_full_identity_is_stored_as_given(self):
        user = provision_user(
            external_id="user_abc",
            email="ivan@example.com",
            username="ivanp",
            display_name="Иван Петров",
            avatar_url="https://img.example.com/a.jpg",
        )
        profile = UserProfile.objects.get(user=user)

        assert profile.display_name == "Иван Петров"
        assert profile.avatar_url == "https://img.example.com/a.jpg"

    def test_a_profile_already_holding_a_raw_id_is_repaired(self):
        """The fix has to heal rows written before it existed.

        Real accounts were already provisioned with the `sub` in
        `display_name`. Without this, the first clause of the refresh only
        overwrites a value that DIFFERS, so a wrong-but-stable value would sit
        there forever.
        """
        user = provision_user(external_id="user_33KqZmNhY2tlZA")
        profile = UserProfile.objects.get(user=user)
        profile.display_name = "user_33KqZmNhY2tlZA"
        profile.save(update_fields=["display_name"])

        provision_user(
            external_id="user_33KqZmNhY2tlZA",
            display_name="Иван Петров",
        )

        profile.refresh_from_db()
        assert profile.display_name == "Иван Петров"

    def test_provisioning_is_idempotent(self):
        first = provision_user(external_id="user_same", display_name="Иван")
        second = provision_user(external_id="user_same", display_name="Иван")

        assert first.pk == second.pk
        assert UserProfile.objects.filter(clerk_user_id="user_same").count() == 1

    def test_ensure_profile_does_not_name_a_superuser_after_an_id(self):
        from django.contrib.auth import get_user_model

        user = get_user_model().objects.create_superuser(
            username="admin", email="admin@example.com", password="x"
        )
        profile = ensure_profile(user)

        assert profile.role == UserProfile.Role.ADMIN
        assert not looks_like_external_id(profile.display_name)


class TestACustomDisplayNameSurvivesTheNextRequest:
    """🚨 The 2026-08-16 report: "I edit my display name, I click save, I get
    'profile saved', then I go back and it's the same one that it was before."

    `provision_user` runs on EVERY authenticated request and refreshes the
    fields "the identity provider owns". Google supplies a real name through
    Clerk, so that refresh always had something to write - and it silently
    reverted the member's own edit within a second of them making it. The save
    worked; the very next request undid it.

    These tests are about ownership, not about the write path: the API endpoint
    is covered elsewhere, and what could not be seen from there is that a
    perfectly successful PATCH is erased by an unrelated GET.
    """

    def test_provisioning_again_does_not_overwrite_a_chosen_name(self, db):
        provision_user(external_id="user_custom1", display_name="Demetrios Vlassis")

        profile = UserProfile.objects.get(clerk_user_id="user_custom1")
        profile.display_name = "Митко"
        profile.display_name_is_custom = True
        profile.save(update_fields=["display_name", "display_name_is_custom"])

        # The next authenticated request, with Clerk still reporting the Google
        # name. This is the line that used to undo the edit.
        provision_user(external_id="user_custom1", display_name="Demetrios Vlassis")

        profile.refresh_from_db()
        assert profile.display_name == "Митко"

    def test_a_provider_name_still_lands_when_the_member_has_not_chosen_one(self, db):
        """The flag is a member's claim on the field, not a freeze on it.

        Without this, "stop overwriting" would quietly become "never update",
        and a member who changes their name at Google would be stuck with the
        old one forever.
        """
        provision_user(external_id="user_custom2", display_name="Ivan Petrov")
        provision_user(external_id="user_custom2", display_name="Иван Петров")

        profile = UserProfile.objects.get(clerk_user_id="user_custom2")
        assert profile.display_name == "Иван Петров"
        assert profile.display_name_is_custom is False

    def test_a_repairable_external_id_name_is_left_alone_once_chosen(self, db):
        """The external-id repair branch must not be a back door.

        `provision_user` repairs a profile whose display_name is a raw Clerk
        `sub`. That repair is checked AFTER the ownership flag, so it cannot be
        used to reach a name the member typed - otherwise a member who chose a
        name matching the id pattern would have it rewritten under them.
        """
        provision_user(external_id="user_custom3", display_name="Ivan")

        profile = UserProfile.objects.get(clerk_user_id="user_custom3")
        profile.display_name = "user_33KqZmNhY2tlZA"
        profile.display_name_is_custom = True
        profile.save(update_fields=["display_name", "display_name_is_custom"])

        provision_user(external_id="user_custom3", display_name="Ivan")

        profile.refresh_from_db()
        assert profile.display_name == "user_33KqZmNhY2tlZA"
