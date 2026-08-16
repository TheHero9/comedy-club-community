"""Community content: comments, canonical topics, votes, moments.

This is the actual product. Everything here is user-generated and PUBLIC, so:
🔒 Never trust a client-supplied author. The actor is always `request.auth`.
🔒 Bodies and labels are escaped on output by the JSON layer; the frontend must
   never render them as HTML.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Query, Router
from ninja.errors import HttpError

from podcast.auth import get_auth
from podcast.auth.permissions import (
    is_moderator,
    require_admin,
    require_moderator,
    require_self_or_moderator,
)
from podcast.models import (
    Comment,
    Episode,
    EpisodeParticipant,
    EpisodeTopic,
    EpisodeTopicVote,
    Moment,
    ParticipantProposal,
    Person,
)
from podcast.services import participants as participant_service
from podcast.services import topics as topic_service
from podcast.services.indexing import schedule_episode_reindex
from podcast.services.timestamps import TimestampError, resolve_timestamp
from podcast.slugs import bg_slugify

from .schemas import (
    CommentIn,
    CommentListOut,
    CommentOut,
    EpisodeCastOut,
    EpisodeTopicOut,
    MessageOut,
    MomentIn,
    MomentOut,
    ParticipantProposeIn,
    PersonIn,
    PersonOut,
    ProposalOut,
    ProposalQueueOut,
    ProposalReviewIn,
    TopicIn,
    VoteIn,
)
from .serializers import (
    comment_out,
    moment_out,
    paginated_meta,
    person_out,
    proposal_out,
    proposal_queue_out,
)

router = Router(tags=["community"], auth=get_auth())


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------


@router.get("/episodes/{youtube_id}/comments", response=CommentListOut, auth=None)
def list_comments(
    request,
    youtube_id: str,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Public read. Hidden comments are never returned."""
    episode = get_object_or_404(Episode, youtube_id=youtube_id)
    queryset = (
        episode.comments.filter(is_hidden=False)
        .select_related("user", "user__profile")
        .order_by("-created_at")
    )
    total = queryset.count()
    items = [comment_out(comment) for comment in queryset[offset : offset + limit]]
    return {"items": items, "meta": paginated_meta(total, limit, offset)}


@router.post("/episodes/{youtube_id}/comments", response=CommentOut)
def create_comment(request, youtube_id: str, payload: CommentIn):
    episode = get_object_or_404(Episode, youtube_id=youtube_id)
    body = payload.body.strip()
    if not body:
        raise HttpError(422, "Comment cannot be empty")

    comment = Comment.objects.create(
        user=request.auth, episode=episode, body=body, is_spoiler=payload.is_spoiler
    )
    comment.user = request.auth
    return comment_out(comment)


@router.patch("/comments/{comment_id}", response=CommentOut)
def edit_comment(request, comment_id: int, payload: CommentIn):
    comment = get_object_or_404(Comment.objects.select_related("user"), id=comment_id)
    require_self_or_moderator(request.auth, comment.user_id)

    body = payload.body.strip()
    if not body:
        # Same rule as create_comment: editing must not be a way to blank a comment.
        raise HttpError(422, "Comment cannot be empty")

    comment.body = body
    comment.is_spoiler = payload.is_spoiler
    comment.edited_at = timezone.now()
    comment.save(update_fields=["body", "is_spoiler", "edited_at"])
    return comment_out(comment)


@router.delete("/comments/{comment_id}", response=MessageOut)
def delete_comment(request, comment_id: int):
    comment = get_object_or_404(Comment, id=comment_id)
    require_self_or_moderator(request.auth, comment.user_id)

    if is_moderator(request.auth) and comment.user_id != request.auth.id:
        # Moderators hide rather than destroy, so the report trail survives.
        comment.is_hidden = True
        comment.save(update_fields=["is_hidden"])
        return {"detail": "Comment hidden"}

    comment.delete()
    return {"detail": "Comment deleted"}


# ---------------------------------------------------------------------------
# Topics
# ---------------------------------------------------------------------------


# NOTE: topic suggestion lives in public.py, declared before /topics/{slug}.
# Putting it here shadowed it behind the {slug} route and returned 404.


@router.post("/episodes/{youtube_id}/topics", response=EpisodeTopicOut)
def add_topic(request, youtube_id: str, payload: TopicIn):
    """Attach a topic. Free text resolves to a CANONICAL Topic by unicode slug, so
    'Политика' and 'политика' land on the same row."""
    episode = get_object_or_404(Episode, youtube_id=youtube_id)
    try:
        episode_topic, _ = topic_service.add_topic_to_episode(
            episode, payload.name, request.auth
        )
    except topic_service.TopicError as exc:
        raise HttpError(422, str(exc)) from exc

    # Topic labels are indexed text - a new label changes what this episode matches.
    schedule_episode_reindex(episode.pk)
    return _episode_topic_out(episode_topic, request.auth)


@router.post("/episode-topics/{episode_topic_id}/vote", response=EpisodeTopicOut)
def vote_topic(request, episode_topic_id: int, payload: VoteIn):
    episode_topic = get_object_or_404(
        EpisodeTopic.objects.select_related("topic"), id=episode_topic_id
    )
    try:
        topic_service.vote_on_topic(episode_topic, request.auth, payload.value)
    except topic_service.TopicError as exc:
        raise HttpError(422, str(exc)) from exc

    episode_topic.refresh_from_db()
    return _episode_topic_out(episode_topic, request.auth)


@router.delete("/episode-topics/{episode_topic_id}", response=MessageOut)
def remove_topic(request, episode_topic_id: int):
    episode_topic = get_object_or_404(EpisodeTopic, id=episode_topic_id)
    # A label with community votes should be voted down, not unilaterally removed.
    require_self_or_moderator(request.auth, episode_topic.added_by_id or -1)
    episode_id = episode_topic.episode_id
    episode_topic.delete()
    # The label was indexed text - removing it changes what this episode matches,
    # exactly like adding it did.
    schedule_episode_reindex(episode_id)
    return {"detail": "Topic removed from episode"}


def _episode_topic_out(episode_topic: EpisodeTopic, user) -> dict:
    vote = EpisodeTopicVote.objects.filter(
        episode_topic=episode_topic, user=user
    ).first()
    return {
        "id": episode_topic.id,
        "topic": {
            "id": episode_topic.topic.id,
            "name": episode_topic.topic.name,
            "slug": episode_topic.topic.slug,
            "episode_count": 0,
        },
        "score": episode_topic.score,
        "created_at": episode_topic.created_at,
        "my_vote": vote.value if vote else None,
    }


# ---------------------------------------------------------------------------
# Moments
# ---------------------------------------------------------------------------


@router.get("/episodes/{youtube_id}/moments", response=list[MomentOut], auth=None)
def list_moments(request, youtube_id: str):
    """Public read. With no creator chapters on these channels, this IS the
    in-episode structure."""
    episode = get_object_or_404(Episode, youtube_id=youtube_id)
    # `nulls_last` stated explicitly rather than relying on Postgres' ASC
    # default: timestamp-less moments are notes about the episode and belong
    # after the timeline, and the client renders them as a separate group. If
    # they sorted first the two lists would interleave.
    moments = episode.moments.select_related("user", "user__profile").order_by(
        F("timestamp_sec").asc(nulls_last=True), "id"
    )
    # Public and cached, so there is no actor here and `is_mine` is always
    # false. The signed-in view gets `my_moment_ids` from
    # GET /episodes/{id}/me and marks its own rows from that.
    return [moment_out(moment) for moment in moments]


@router.post("/episodes/{youtube_id}/moments", response=MomentOut)
def add_moment(request, youtube_id: str, payload: MomentIn):
    """A community timestamp. With no creator chapters on these channels, moments
    are the PRIMARY searchable structure inside an episode."""
    episode = get_object_or_404(Episode, youtube_id=youtube_id)

    # 🚨 Parsed HERE, from what the member typed. The web form parses the same
    # grammar for instant feedback, but a client is never an authority on its
    # own input - same rule as never trusting a client-supplied user id.
    #
    # `required=False`: leaving the field blank is a supported choice here, and
    # means "a note about this episode" rather than a point inside it. A
    # MALFORMED value is still a 422 - the two are not the same input.
    try:
        timestamp_sec = resolve_timestamp(
            timestamp=payload.timestamp,
            timestamp_sec=payload.timestamp_sec,
            required=False,
        )
    except TimestampError as exc:
        raise HttpError(422, str(exc)) from exc

    if timestamp_sec is not None and episode.duration_sec and timestamp_sec > episode.duration_sec:
        raise HttpError(
            422,
            f"Timestamp {timestamp_sec}s is past the end of this episode "
            f"({episode.duration_sec}s)",
        )

    label = payload.label.strip()
    if not label:
        raise HttpError(422, "Moment label cannot be empty")

    with transaction.atomic():
        moment = Moment.objects.create(
            episode=episode,
            user=request.auth,
            timestamp_sec=timestamp_sec,
            label=label,
        )
    # Moment labels are indexed text - with no creator chapters, they ARE the
    # in-episode searchable structure.
    schedule_episode_reindex(episode.pk)

    moment.user = request.auth
    return moment_out(moment, viewer=request.auth)


@router.delete("/moments/{moment_id}", response=MessageOut)
def delete_moment(request, moment_id: int):
    moment = get_object_or_404(Moment, id=moment_id)
    require_self_or_moderator(request.auth, moment.user_id or -1)
    episode_id = moment.episode_id
    moment.delete()
    # Moment labels are indexed text - a deleted (possibly moderated-away) label
    # must stop matching, not linger until the nightly rebuild.
    schedule_episode_reindex(episode_id)
    return {"detail": "Moment deleted"}


# ---------------------------------------------------------------------------
# Participants (spec 14)
# ---------------------------------------------------------------------------


@router.get("/episodes/{youtube_id}/participants", response=EpisodeCastOut, auth=None)
def list_cast(request, youtube_id: str):
    """Confirmed cast plus this episode's open proposals, as SEPARATE lists.

    Never merged: only `confirmed` exists in EpisodeParticipant, so only
    `confirmed` is what Meilisearch and `?person=` agree with. A caller handed
    one blended list would inevitably render a pending guess as fact.
    """
    episode = get_object_or_404(Episode, youtube_id=youtube_id)
    confirmed, pending = participant_service.episode_cast(episode)
    return {
        "confirmed": [
            {
                "id": link.person.id,
                "name": link.person.name,
                "slug": link.person.slug,
                "avatar_url": link.person.avatar_url,
                "role": link.role,
            }
            for link in confirmed
        ],
        "pending": [proposal_out(proposal) for proposal in pending],
    }


@router.post("/episodes/{youtube_id}/participants", response=ProposalOut)
def propose_participant(request, youtube_id: str, payload: ParticipantProposeIn):
    """Suggest someone. Creates a PROPOSAL - never a Person, never a participant.

    🚨 `name` is free text and stays free text until a moderator maps it onto a
    persona. See services/participants.py for why letting it become a `Person`
    would wreck the cast index.
    """
    episode = get_object_or_404(Episode, youtube_id=youtube_id)

    person = None
    if payload.person_slug:
        person = get_object_or_404(Person, slug=payload.person_slug)

    valid_roles = {choice[0] for choice in ParticipantProposal._meta.get_field("role").choices}
    if payload.role not in valid_roles:
        raise HttpError(422, f"Role must be one of {sorted(valid_roles)}")

    try:
        proposal = participant_service.propose(
            episode=episode,
            user=request.auth,
            person=person,
            name=payload.name or "",
            role=payload.role,
        )
    except participant_service.ProposalError as exc:
        raise HttpError(422, str(exc)) from exc

    return proposal_out(proposal, viewer=request.auth)


@router.delete("/participant-proposals/{proposal_id}", response=MessageOut)
def withdraw_proposal(request, proposal_id: int):
    """Take back your own suggestion, while it is still pending."""
    proposal = get_object_or_404(ParticipantProposal, id=proposal_id)
    require_self_or_moderator(request.auth, proposal.proposed_by_id or -1)
    if proposal.status != ParticipantProposal.Status.PENDING:
        raise HttpError(409, "Only a pending proposal can be withdrawn")
    proposal.delete()
    return {"detail": "Proposal withdrawn"}


@router.get("/moderation/participant-proposals", response=list[ProposalQueueOut])
def list_proposals(
    request,
    status: str = Query("pending"),
    limit: int = Query(50, ge=1, le=200),
):
    """🔒 Moderators only. The review queue, and the record of what was decided.

    `status` also drives the ORDER, because the two questions are different.
    Pending is a work list - oldest submission first would be fairer, but newest
    first matches how the queue is actually read. Anything already reviewed is a
    HISTORY, and a history is ordered by when the DECISION happened, not by when
    the suggestion arrived: sorting a month of approvals by `created_at` puts a
    proposal decided this morning below one filed yesterday and decided never.
    """
    require_moderator(request.auth)

    queryset = ParticipantProposal.objects.select_related(
        "episode",
        "person",
        "proposed_by",
        "proposed_by__profile",
        # Without this the history view is one query per row to name the
        # moderator - the exact N+1 shape that cost this project a 102-query
        # search fallback.
        "verified_by",
        "verified_by__profile",
    )
    if status == "all":
        queryset = queryset.order_by("-created_at")
    elif status == ParticipantProposal.Status.PENDING:
        queryset = queryset.filter(status=status).order_by("-created_at")
    else:
        queryset = queryset.filter(status=status).order_by(
            F("verified_at").desc(nulls_last=True), "-created_at"
        )
    return [proposal_queue_out(proposal) for proposal in queryset[:limit]]


@router.get("/moderation/participant-proposals/reviewed", response=list[ProposalQueueOut])
def list_reviewed_proposals(request, limit: int = Query(30, ge=1, le=200)):
    """🔒 Moderators only. Approved AND rejected in one list, newest decision first.

    A separate endpoint rather than `?status=approved|rejected` twice: the
    history is one timeline, and merging two client-side pages of thirty would
    interleave them wrongly at the boundary.
    """
    require_moderator(request.auth)

    queryset = (
        ParticipantProposal.objects.exclude(status=ParticipantProposal.Status.PENDING)
        .select_related(
            "episode",
            "person",
            "proposed_by",
            "proposed_by__profile",
            "verified_by",
            "verified_by__profile",
        )
        .order_by(F("verified_at").desc(nulls_last=True), "-created_at")
    )
    return [proposal_queue_out(proposal) for proposal in queryset[:limit]]


@router.post("/moderation/participant-proposals/{proposal_id}/approve", response=ProposalOut)
def approve_proposal(request, proposal_id: int, payload: ProposalReviewIn):
    """🔒 Moderators only. `person_slug` is the correction - "yes, but under the
    right name" - and is REQUIRED when the proposal is only typed text."""
    moderator = require_moderator(request.auth)
    proposal = get_object_or_404(
        ParticipantProposal.objects.select_related("episode", "person"), id=proposal_id
    )

    person = None
    if payload.person_slug:
        person = get_object_or_404(Person, slug=payload.person_slug)

    try:
        participant_service.approve(
            proposal=proposal,
            moderator=moderator.user,
            person=person,
            role=payload.role,
            note=payload.note,
        )
    except participant_service.ProposalError as exc:
        raise HttpError(422, str(exc)) from exc

    proposal.refresh_from_db()
    return proposal_out(proposal, viewer=request.auth)


@router.post("/moderation/participant-proposals/{proposal_id}/reject", response=ProposalOut)
def reject_proposal(request, proposal_id: int, payload: ProposalReviewIn):
    """🔒 Moderators only. The row stays - it is the audit trail, and the member
    who filed it is shown the note."""
    moderator = require_moderator(request.auth)
    proposal = get_object_or_404(ParticipantProposal, id=proposal_id)

    try:
        participant_service.reject(
            proposal=proposal, moderator=moderator.user, note=payload.note
        )
    except participant_service.ProposalError as exc:
        raise HttpError(422, str(exc)) from exc

    return proposal_out(proposal, viewer=request.auth)


# ---------------------------------------------------------------------------
# Persona curation (spec 14) - the in-app replacement for Django Admin
# ---------------------------------------------------------------------------


@router.post("/moderation/people", response=PersonOut)
def create_person(request, payload: PersonIn):
    """🔒 Moderators and admins. Mint a canonical persona.

    🚨 This is the ONLY way a `Person` comes into existence from the app. A
    member's typed name never reaches here - it stays free text on a proposal
    until someone with this permission maps it onto a persona. That asymmetry
    is the entire defence against Тонката / Тони / Донката becoming three
    people.
    """
    require_moderator(request.auth)

    name = " ".join(payload.name.split())
    if not name:
        raise HttpError(422, "A name is required")

    slug = bg_slugify(name, max_length=220)
    if Person.objects.filter(slug=slug).exists():
        # By SLUG, not name: that is what collapses casing and spacing variants,
        # the same rule topics follow. Refusing here is the point - a duplicate
        # persona is the failure this whole feature exists to prevent.
        raise HttpError(409, f"A person with the slug {slug!r} already exists")

    person = Person.objects.create(
        name=name, bio=payload.bio.strip(), avatar_url=payload.avatar_url.strip()
    )
    person._appearance_count = 0
    return person_out(person)


@router.patch("/moderation/people/{slug}", response=PersonOut)
def update_person(request, slug: str, payload: PersonIn):
    """🔒 Moderators and admins.

    ⚠️ The SLUG DOES NOT CHANGE when the name does. `Person.save` only assigns
    a slug when there is none, and that is deliberate: the slug is in
    `/episodes?person=`, in the Meilisearch `participant_slugs` facet and in
    every link already shared. Renaming a typo should not break those.
    """
    require_moderator(request.auth)
    person = get_object_or_404(Person, slug=slug)

    name = " ".join(payload.name.split())
    if not name:
        raise HttpError(422, "A name is required")

    person.name = name
    person.bio = payload.bio.strip()
    person.avatar_url = payload.avatar_url.strip()
    person.save(update_fields=["name", "bio", "avatar_url"])

    # Their name is in the search document of every episode they appear in.
    for episode_id in EpisodeParticipant.objects.filter(person=person).values_list(
        "episode_id", flat=True
    ):
        schedule_episode_reindex(episode_id)

    person._appearance_count = person.appearances.count()
    return person_out(person)


@router.delete("/moderation/people/{slug}", response=MessageOut)
def delete_person(request, slug: str):
    """🔒 ADMINS ONLY - stricter than creating one, because this cascades.

    Deleting a persona removes every `EpisodeParticipant` row for them and
    every proposal that resolved onto them. Creating a wrong persona is a typo;
    deleting a real one silently rewrites history on every episode they were in.
    """
    require_admin(request.auth)
    person = get_object_or_404(Person, slug=slug)

    episode_ids = list(
        EpisodeParticipant.objects.filter(person=person).values_list(
            "episode_id", flat=True
        )
    )
    name = person.name
    person.delete()

    # Those episodes just lost a cast member; their documents must stop
    # matching on the name rather than wait for the nightly rebuild.
    for episode_id in episode_ids:
        schedule_episode_reindex(episode_id)

    return {"detail": f"Deleted {name} and {len(episode_ids)} appearance(s)"}
