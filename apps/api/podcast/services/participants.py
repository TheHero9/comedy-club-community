"""Proposing and verifying who took part in an episode.

Business logic lives here as plain functions; the router does validation + auth
and calls in, and any future Celery task would call the same functions.

🚨 THE INVARIANT THIS MODULE EXISTS TO PROTECT: a `Person` is only ever created
by an admin, by hand. A member's free text becomes a `ParticipantProposal`, and
approving one means MAPPING that text onto a persona that already exists. Never
`Person.objects.create(name=whatever_they_typed)`.

Why it matters concretely: the Bulgarian auto-captions mishear `Тонката` as
`Донката`, and the same performer is also called `Тони`. Three spellings, one
person. If typed names became personas, `/episodes?person=` would split one
filmography across three near-empty pages and the Meilisearch
`participant_slugs` facet would be permanently polluted - and merging them back
is manual work that grows with every proposal.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from podcast.models import (
    Episode,
    EpisodeParticipant,
    ParticipantProposal,
    Person,
)
from podcast.services.indexing import schedule_episode_reindex


class ProposalError(Exception):
    """Something about the proposal itself is wrong. Routers map this to a 4xx."""


def _checked_role(role: str | None, *, fallback: str) -> str:
    """A role from the model's own choices, or a ProposalError.

    🚨 Django does NOT enforce `choices` at the database level, so an unchecked
    string reaches the column intact and the web renders the raw key as the
    person's role. The propose endpoint always validated; approve did not, and
    approve is the one a moderator drives - so the gap was on the privileged
    path. Derived from the model rather than restated, so adding a role in one
    place is the whole change.
    """
    if role is None or role == "":
        return fallback
    valid = {choice[0] for choice in EpisodeParticipant.Role.choices}
    if role not in valid:
        raise ProposalError(f"Role must be one of {sorted(valid)}")
    return role


def propose(
    *,
    episode: Episode,
    user,
    person: Person | None = None,
    name: str = "",
    role: str = EpisodeParticipant.Role.REGULAR,
) -> ParticipantProposal:
    """Record a member's suggestion. Creates NO Person and NO participant."""
    role = _checked_role(role, fallback=EpisodeParticipant.Role.REGULAR)
    name = " ".join((name or "").split())
    if person is None and not name:
        raise ProposalError("Pick a person or type a name")
    if person is not None and name:
        # Both would be ambiguous at review time: does the text override the
        # pick, or annotate it? Refuse rather than guess.
        raise ProposalError("Pick a person OR type a name, not both")

    if person is not None and EpisodeParticipant.objects.filter(
        episode=episode, person=person
    ).exists():
        raise ProposalError("That person is already listed on this episode")

    existing = ParticipantProposal.objects.filter(
        episode=episode,
        proposed_by=user,
        status=ParticipantProposal.Status.PENDING,
    )
    if person is not None:
        if existing.filter(person=person).exists():
            raise ProposalError("You have already suggested that person for this episode")
    elif existing.filter(proposed_name__iexact=name).exists():
        raise ProposalError("You have already suggested that name for this episode")

    return ParticipantProposal.objects.create(
        episode=episode,
        person=person,
        proposed_name="" if person is not None else name[:200],
        role=role,
        proposed_by=user,
    )


@transaction.atomic
def approve(
    *,
    proposal: ParticipantProposal,
    moderator,
    person: Person | None = None,
    role: str | None = None,
    note: str = "",
) -> EpisodeParticipant:
    """Confirm a proposal, mapping it onto a real persona.

    `person` is the moderator's correction - "this IS in the episode, but under
    the right name". It is REQUIRED when the proposal only carries typed text,
    because that text is not a persona and must never become one.
    """
    if proposal.status != ParticipantProposal.Status.PENDING:
        raise ProposalError(f"This proposal is already {proposal.get_status_display().lower()}")

    role = _checked_role(role, fallback=proposal.role)

    target = person or proposal.person
    if target is None:
        raise ProposalError(
            "This proposal is a typed name. Create the persona in the admin first, "
            "then approve it onto that person."
        )

    # get_or_create, so two members proposing the same person for the same
    # episode resolve to ONE participant row and two closed proposals.
    participant, _created = EpisodeParticipant.objects.get_or_create(
        episode=proposal.episode,
        person=target,
        defaults={"role": role or proposal.role, "added_by": moderator},
    )

    proposal.status = ParticipantProposal.Status.APPROVED
    proposal.person = target
    proposal.verified_by = moderator
    proposal.verified_at = timezone.now()
    if note:
        proposal.note = note[:280]
    elif proposal.proposed_name and target.name != proposal.proposed_name:
        # Record the mapping without the moderator having to type it. This is
        # the audit answer to "why does the approved name differ from mine?".
        proposal.note = f"Mapped '{proposal.proposed_name}' to {target.name}"[:280]
    proposal.save(
        update_fields=["status", "person", "verified_by", "verified_at", "note"]
    )

    # Only NOW does this cast member become searchable - approved participants
    # are in EpisodeParticipant, which is what the document builder reads.
    transaction.on_commit(lambda: schedule_episode_reindex(proposal.episode_id))
    return participant


@transaction.atomic
def reject(*, proposal: ParticipantProposal, moderator, note: str = "") -> ParticipantProposal:
    """Turn a proposal down. The row STAYS - it is the audit trail, and the
    member who filed it is shown the note."""
    if proposal.status != ParticipantProposal.Status.PENDING:
        raise ProposalError(f"This proposal is already {proposal.get_status_display().lower()}")

    proposal.status = ParticipantProposal.Status.REJECTED
    proposal.verified_by = moderator
    proposal.verified_at = timezone.now()
    proposal.note = (note or "")[:280]
    proposal.save(update_fields=["status", "verified_by", "verified_at", "note"])
    return proposal


def episode_cast(episode: Episode):
    """Confirmed participants plus this episode's still-open proposals.

    Returned separately, never merged: the confirmed list is what search and
    `?person=` agree with, and a pending row must stay visibly distinct from it.
    """
    confirmed = list(
        episode.participants.select_related("person").order_by("person__name")
    )
    pending = list(
        episode.participant_proposals.filter(status=ParticipantProposal.Status.PENDING)
        .select_related("person", "proposed_by", "proposed_by__profile")
        .order_by("created_at")
    )
    return confirmed, pending
