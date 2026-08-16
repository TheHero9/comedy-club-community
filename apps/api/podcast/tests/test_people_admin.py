"""Curating personas from the app instead of Django Admin.

🚨 The asymmetry under test: a MEMBER's typed name never becomes a `Person`,
but a moderator can mint one deliberately. That is the whole defence against
Тонката / Тони / Донката ending up as three separate people.
"""

import pytest

from podcast.models import EpisodeParticipant, ParticipantProposal, Person
from podcast.services import participants as participant_service

pytestmark = pytest.mark.django_db


class TestCreating:
    def test_a_moderator_can_mint_a_persona(self, client, moderator, as_moderator):
        response = client.post(
            "/api/moderation/people",
            data={"name": "Тонката", "bio": "Комик"},
            content_type="application/json",
            **as_moderator,
        )
        assert response.status_code == 200, response.content
        body = response.json()
        assert body["name"] == "Тонката"
        # 🇧🇬 The slug must stay readable Cyrillic, not be stripped to "".
        assert body["slug"] == "тонката"

    def test_a_plain_member_cannot(self, client, alice, as_alice):
        response = client.post(
            "/api/moderation/people",
            data={"name": "Тонката"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 403
        assert not Person.objects.exists()

    def test_anonymous_cannot(self, client):
        response = client.post(
            "/api/moderation/people",
            data={"name": "Тонката"},
            content_type="application/json",
        )
        assert response.status_code in (401, 403)

    def test_a_duplicate_slug_is_refused(self, client, moderator, as_moderator):
        Person.objects.create(name="Тонката")
        response = client.post(
            "/api/moderation/people",
            # Different spacing, same slug - exactly the collision this guards.
            data={"name": "  Тонката  "},
            content_type="application/json",
            **as_moderator,
        )
        assert response.status_code == 409
        assert Person.objects.count() == 1

    def test_an_empty_name_is_refused(self, client, moderator, as_moderator):
        response = client.post(
            "/api/moderation/people",
            data={"name": "   "},
            content_type="application/json",
            **as_moderator,
        )
        assert response.status_code == 422


class TestEditing:
    def test_renaming_keeps_the_slug(self, client, moderator, as_moderator):
        """🚨 The slug is in /episodes?person=, in participant_slugs and in every
        link already shared. Fixing a typo must not break those."""
        person = Person.objects.create(name="Тонкта")
        original_slug = person.slug

        response = client.patch(
            f"/api/moderation/people/{original_slug}",
            data={"name": "Тонката", "bio": "", "avatar_url": ""},
            content_type="application/json",
            **as_moderator,
        )
        assert response.status_code == 200, response.content
        person.refresh_from_db()
        assert person.name == "Тонката"
        assert person.slug == original_slug

    def test_a_plain_member_cannot_edit(self, client, alice, as_alice):
        person = Person.objects.create(name="Тонката")
        response = client.patch(
            f"/api/moderation/people/{person.slug}",
            data={"name": "Hacked", "bio": "", "avatar_url": ""},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 403
        person.refresh_from_db()
        assert person.name == "Тонката"


class TestDeleting:
    def test_deleting_needs_ADMIN_not_just_moderator(
        self, client, moderator, as_moderator
    ):
        """Stricter than creating: a wrong persona is a typo, a deleted one
        rewrites the cast of every episode they were in."""
        person = Person.objects.create(name="Тонката")
        response = client.delete(
            f"/api/moderation/people/{person.slug}", **as_moderator
        )
        assert response.status_code == 403
        assert Person.objects.filter(pk=person.pk).exists()

    def test_an_admin_can_delete_and_the_cascade_is_reported(
        self, client, episode, alice, admin_user, as_admin
    ):
        person = Person.objects.create(name="Тонката")
        EpisodeParticipant.objects.create(episode=episode, person=person, role="guest")

        response = client.delete(f"/api/moderation/people/{person.slug}", **as_admin)
        assert response.status_code == 200, response.content
        assert "1 appearance" in response.json()["detail"]
        assert not Person.objects.filter(pk=person.pk).exists()
        assert not EpisodeParticipant.objects.filter(episode=episode).exists()


class TestTheWholeOwnerWorkflow:
    def test_typed_name_to_new_persona_to_approved_participant(
        self, client, episode, alice, admin_user, as_admin
    ):
        """The end-to-end path the owner described, without Django Admin.

        A member types a name we have never seen; the admin mints the persona
        from their own profile, then approves the proposal ONTO it.
        """
        proposal = participant_service.propose(
            episode=episode, user=alice, name="Донката", role="guest"
        )
        assert Person.objects.count() == 0, "a typed name must not mint a persona"

        created = client.post(
            "/api/moderation/people",
            data={"name": "Тонката"},
            content_type="application/json",
            **as_admin,
        ).json()

        approved = client.post(
            f"/api/moderation/participant-proposals/{proposal.id}/approve",
            data={"person_slug": created["slug"]},
            content_type="application/json",
            **as_admin,
        )
        assert approved.status_code == 200, approved.content

        assert Person.objects.count() == 1
        proposal.refresh_from_db()
        assert proposal.status == ParticipantProposal.Status.APPROVED
        assert proposal.person.slug == created["slug"]
        assert EpisodeParticipant.objects.filter(
            episode=episode, person__slug=created["slug"]
        ).exists()


@pytest.mark.django_db
class TestPeoplePaging:
    """🚨 `limit` alone is a CAP, not pagination.

    Past it the remaining personas were simply unreachable, and every caller
    rendered whichever slice it happened to receive as though it were the whole
    catalogue. The owner named the ceiling before it arrived: "the people
    section will have multiple people there ... you have 1000, I can't render
    1000 people."
    """

    def test_offset_reaches_past_the_first_page(self, client):
        for index in range(7):
            Person.objects.create(name=f"Човек {index:02d}")

        first = client.get("/api/people?limit=3").json()
        second = client.get("/api/people?limit=3&offset=3").json()

        assert len(first) == 3
        assert len(second) == 3
        # 🚨 Disjoint. An unstable sort under offset paging silently drops and
        # duplicates rows between pages, which is why the ordering carries `id`
        # as a final tiebreaker - every one of these personas has the same
        # appearance count.
        assert {row["slug"] for row in first}.isdisjoint({row["slug"] for row in second})

    def test_search_narrows_the_list(self, client):
        Person.objects.create(name="Иван Кирков")
        Person.objects.create(name="Пепи Хикс")

        results = client.get("/api/people", {"q": "Кирков"}).json()

        assert [row["name"] for row in results] == ["Иван Кирков"]

    def test_search_is_case_insensitive_in_cyrillic(self, client):
        """🇧🇬 Verified with real Cyrillic, never with English test data."""
        Person.objects.create(name="Пепи Хикс")

        assert len(client.get("/api/people", {"q": "пепи"}).json()) == 1
