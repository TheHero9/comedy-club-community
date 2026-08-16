"""Community-proposed participants: lifecycle, permissions and the leak invariant.

🚨 The most important test in this file is
`TestPendingNeverLeaks::test_a_pending_proposal_is_invisible_to_search_and_filters`.
The whole reason proposals live in their own table is that a pending one must be
structurally incapable of reaching search, `?person=` or the person page. If
that test ever fails, the design has been undone.
"""

import pytest

from podcast.models import (
    EpisodeParticipant,
    ParticipantProposal,
    Person,
)
from podcast.search.documents import build_document, episode_index_queryset
from podcast.services import participants as participant_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def tonkata(db):
    return Person.objects.create(name="Тонката")


@pytest.fixture
def kirkov(db):
    return Person.objects.create(name="Иван Кирков")


class TestProposing:
    def test_a_member_can_propose_an_existing_person(self, client, episode, alice, as_alice, kirkov):
        response = client.post(
            f"/api/episodes/{episode.youtube_id}/participants",
            data={"person_slug": kirkov.slug, "role": "host"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200, response.content
        body = response.json()
        assert body["display_name"] == "Иван Кирков"
        assert body["status"] == "pending"
        assert body["is_mine"] is True

    def test_a_typed_name_creates_a_proposal_but_NEVER_a_person(
        self, client, episode, alice, as_alice
    ):
        """The core ruling: user input must not become a canonical persona."""
        before = Person.objects.count()
        response = client.post(
            f"/api/episodes/{episode.youtube_id}/participants",
            data={"name": "Донката", "role": "guest"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200, response.content
        assert response.json()["display_name"] == "Донката"
        assert Person.objects.count() == before, "a typed name must not create a Person"
        assert ParticipantProposal.objects.filter(proposed_name="Донката").exists()

    def test_proposing_nobody_is_refused(self, client, episode, alice, as_alice):
        response = client.post(
            f"/api/episodes/{episode.youtube_id}/participants",
            data={"role": "guest"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 422

    def test_proposing_both_a_person_and_a_name_is_refused(
        self, client, episode, alice, as_alice, kirkov
    ):
        """Ambiguous at review time - does the text override the pick, or annotate it?"""
        response = client.post(
            f"/api/episodes/{episode.youtube_id}/participants",
            data={"person_slug": kirkov.slug, "name": "someone else"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 422

    def test_the_same_member_cannot_propose_the_same_person_twice(
        self, client, episode, alice, as_alice, kirkov
    ):
        payload = {"person_slug": kirkov.slug, "role": "host"}
        first = client.post(
            f"/api/episodes/{episode.youtube_id}/participants",
            data=payload,
            content_type="application/json",
            **as_alice,
        )
        assert first.status_code == 200
        second = client.post(
            f"/api/episodes/{episode.youtube_id}/participants",
            data=payload,
            content_type="application/json",
            **as_alice,
        )
        assert second.status_code == 422

    def test_anonymous_cannot_propose(self, client, episode, kirkov):
        response = client.post(
            f"/api/episodes/{episode.youtube_id}/participants",
            data={"person_slug": kirkov.slug},
            content_type="application/json",
        )
        assert response.status_code in (401, 403)


class TestReview:
    def test_a_member_cannot_approve_their_own_proposal(
        self, client, episode, alice, as_alice, kirkov
    ):
        proposal = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        response = client.post(
            f"/api/moderation/participant-proposals/{proposal.id}/approve",
            data={},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 403

    def test_approving_creates_the_participant_and_closes_the_proposal(
        self, client, episode, alice, moderator, as_moderator, kirkov
    ):
        proposal = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        response = client.post(
            f"/api/moderation/participant-proposals/{proposal.id}/approve",
            data={},
            content_type="application/json",
            **as_moderator,
        )
        assert response.status_code == 200, response.content

        proposal.refresh_from_db()
        assert proposal.status == ParticipantProposal.Status.APPROVED
        assert proposal.verified_by == moderator
        assert proposal.verified_at is not None
        assert EpisodeParticipant.objects.filter(episode=episode, person=kirkov).exists()

    def test_a_typed_name_cannot_be_approved_without_choosing_a_person(
        self, client, episode, alice, moderator, as_moderator
    ):
        """The guard that stops free text becoming a persona by the back door."""
        proposal = participant_service.propose(
            episode=episode, user=alice, name="Донката", role="guest"
        )
        response = client.post(
            f"/api/moderation/participant-proposals/{proposal.id}/approve",
            data={},
            content_type="application/json",
            **as_moderator,
        )
        assert response.status_code == 422
        assert not EpisodeParticipant.objects.filter(episode=episode).exists()

    def test_approve_as_maps_a_misheard_name_onto_the_right_person(
        self, client, episode, alice, moderator, as_moderator, tonkata
    ):
        """The owner's workflow: 'this person IS in it, but not under that name'.

        This is the case the whole design exists for - the auto-captions write
        Донката for Тонката, and approving must resolve onto the real persona
        instead of minting a second one.
        """
        proposal = participant_service.propose(
            episode=episode, user=alice, name="Донката", role="guest"
        )
        before = Person.objects.count()

        response = client.post(
            f"/api/moderation/participant-proposals/{proposal.id}/approve",
            data={"person_slug": tonkata.slug},
            content_type="application/json",
            **as_moderator,
        )
        assert response.status_code == 200, response.content

        assert Person.objects.count() == before, "approving must not mint a persona"
        assert EpisodeParticipant.objects.filter(episode=episode, person=tonkata).exists()
        proposal.refresh_from_db()
        assert proposal.person == tonkata
        assert "Донката" in proposal.note and "Тонката" in proposal.note

    def test_two_members_proposing_the_same_person_collapse_to_one_participant(
        self, client, episode, alice, bob, moderator, kirkov
    ):
        first = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        second = participant_service.propose(
            episode=episode, user=bob, person=kirkov, role="host"
        )
        participant_service.approve(proposal=first, moderator=moderator)
        participant_service.approve(proposal=second, moderator=moderator)

        assert EpisodeParticipant.objects.filter(episode=episode, person=kirkov).count() == 1

    def test_rejecting_keeps_the_row_and_its_note_for_the_proposer(
        self, client, episode, alice, moderator, as_moderator, kirkov
    ):
        proposal = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        response = client.post(
            f"/api/moderation/participant-proposals/{proposal.id}/reject",
            data={"note": "He is not in this one"},
            content_type="application/json",
            **as_moderator,
        )
        assert response.status_code == 200

        proposal.refresh_from_db()
        assert proposal.status == ParticipantProposal.Status.REJECTED
        assert proposal.note == "He is not in this one"
        assert not EpisodeParticipant.objects.filter(episode=episode).exists()

    def test_a_rejected_proposal_can_be_proposed_again(self, episode, alice, moderator, kirkov):
        """The pending-scoped unique constraint must not lock a member out forever."""
        first = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        participant_service.reject(proposal=first, moderator=moderator, note="no")

        again = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        assert again.pk != first.pk

    def test_a_proposal_cannot_be_reviewed_twice(self, episode, alice, moderator, kirkov):
        proposal = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        participant_service.approve(proposal=proposal, moderator=moderator)
        with pytest.raises(participant_service.ProposalError):
            participant_service.approve(proposal=proposal, moderator=moderator)

    def test_the_queue_is_moderators_only(self, client, as_alice):
        assert client.get("/api/moderation/participant-proposals", **as_alice).status_code == 403


class TestPendingNeverLeaks:
    """🚨 The invariant the separate table exists to guarantee."""

    def test_a_pending_proposal_is_invisible_to_search_and_filters(
        self, client, episode, alice, kirkov
    ):
        participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )

        # 1. The Meilisearch document is built from EpisodeParticipant only.
        document = build_document(episode_index_queryset().get(pk=episode.pk))
        assert kirkov.name not in document["participants"]
        assert kirkov.slug not in document["participant_slugs"]

        # 2. The ?person= filter finds nothing.
        listing = client.get(f"/api/episodes?person={kirkov.slug}")
        assert listing.status_code == 200
        assert listing.json()["items"] == []

        # 3. The person's own page lists no episodes.
        detail = client.get(f"/api/people/{kirkov.slug}")
        assert detail.status_code == 200
        assert detail.json()["episodes"] == []

    def test_approving_makes_it_visible_everywhere(self, client, episode, alice, moderator, kirkov):
        proposal = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        participant_service.approve(proposal=proposal, moderator=moderator)

        document = build_document(episode_index_queryset().get(pk=episode.pk))
        assert kirkov.name in document["participants"]
        assert kirkov.slug in document["participant_slugs"]

        listing = client.get(f"/api/episodes?person={kirkov.slug}")
        assert [item["youtube_id"] for item in listing.json()["items"]] == [episode.youtube_id]

    def test_the_cast_endpoint_keeps_the_two_lists_separate(
        self, client, episode, alice, moderator, kirkov, tonkata
    ):
        approved = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        participant_service.approve(proposal=approved, moderator=moderator)
        participant_service.propose(episode=episode, user=alice, person=tonkata, role="guest")

        body = client.get(f"/api/episodes/{episode.youtube_id}/participants").json()
        assert [person["slug"] for person in body["confirmed"]] == [kirkov.slug]
        assert [proposal["display_name"] for proposal in body["pending"]] == [tonkata.name]


class TestWithdraw:
    def test_a_member_can_withdraw_their_own_pending_proposal(
        self, client, episode, alice, as_alice, kirkov
    ):
        proposal = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        response = client.delete(f"/api/participant-proposals/{proposal.id}", **as_alice)
        assert response.status_code == 200
        assert not ParticipantProposal.objects.filter(id=proposal.id).exists()

    def test_a_member_cannot_withdraw_someone_elses(
        self, client, episode, alice, as_bob, bob, kirkov
    ):
        proposal = participant_service.propose(
            episode=episode, user=alice, person=kirkov, role="host"
        )
        response = client.delete(f"/api/participant-proposals/{proposal.id}", **as_bob)
        assert response.status_code == 403
        assert ParticipantProposal.objects.filter(id=proposal.id).exists()
