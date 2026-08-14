"""Community content: comments, canonical topics, votes, moments.

This is the actual product. Everything here is user-generated and PUBLIC, so:
🔒 Never trust a client-supplied author. The actor is always `request.auth`.
🔒 Bodies and labels are escaped on output by the JSON layer; the frontend must
   never render them as HTML.
"""

from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Query, Router
from ninja.errors import HttpError

from podcast.auth import get_auth
from podcast.auth.permissions import is_moderator, require_self_or_moderator
from podcast.models import Comment, Episode, EpisodeTopic, EpisodeTopicVote, Moment
from podcast.services import topics as topic_service
from podcast.services.indexing import schedule_episode_reindex

from .schemas import (
    CommentIn,
    CommentListOut,
    CommentOut,
    EpisodeTopicOut,
    MessageOut,
    MomentIn,
    MomentOut,
    TopicIn,
    VoteIn,
)
from .serializers import comment_out, moment_out, paginated_meta

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
    moments = episode.moments.select_related("user", "user__profile").order_by("timestamp_sec")
    return [moment_out(moment) for moment in moments]


@router.post("/episodes/{youtube_id}/moments", response=MomentOut)
def add_moment(request, youtube_id: str, payload: MomentIn):
    """A community timestamp. With no creator chapters on these channels, moments
    are the PRIMARY searchable structure inside an episode."""
    episode = get_object_or_404(Episode, youtube_id=youtube_id)

    if episode.duration_sec and payload.timestamp_sec > episode.duration_sec:
        raise HttpError(
            422,
            f"Timestamp {payload.timestamp_sec}s is past the end of this episode "
            f"({episode.duration_sec}s)",
        )

    label = payload.label.strip()
    if not label:
        raise HttpError(422, "Moment label cannot be empty")

    with transaction.atomic():
        moment = Moment.objects.create(
            episode=episode,
            user=request.auth,
            timestamp_sec=payload.timestamp_sec,
            label=label,
        )
    # Moment labels are indexed text - with no creator chapters, they ARE the
    # in-episode searchable structure.
    schedule_episode_reindex(episode.pk)

    moment.user = request.auth
    return moment_out(moment)


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
