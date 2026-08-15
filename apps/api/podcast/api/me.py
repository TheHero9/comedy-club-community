"""Authenticated per-user endpoints: ratings, watch log, favorites, private tags,
profile and channel membership.

🔒 The actor is ALWAYS `request.auth`. A user id is never read from the request body
or a query parameter - that would let anyone act as anyone.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import Count, Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import File, Query, Router
from ninja.errors import HttpError
from ninja.files import UploadedFile

from podcast.auth import get_auth
from podcast.auth.backends import humanize
from podcast.models import (
    Channel,
    ChannelMembership,
    Episode,
    Favorite,
    PersonalTag,
    Rating,
    UserProfile,
    WatchEvent,
)
from podcast.services import scoring

from .schemas import (
    EpisodeListOut,
    FavoriteOut,
    MembershipIn,
    MembershipOut,
    MeOut,
    MessageOut,
    PersonalTagIn,
    PersonalTagOut,
    ProfileIn,
    RatingIn,
    RatingOut,
    ViewerStateOut,
    WatchIn,
    WatchSummaryOut,
)
from .serializers import episode_brief, episode_list_queryset, membership_out, paginated_meta

router = Router(tags=["me"], auth=get_auth())

# 🔒 A verification screenshot is a phone screenshot, not a photo library. Anything
# larger than this is either a mistake or an attempt to fill the disk.
MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024
ALLOWED_SCREENSHOT_TYPES = {"image/png", "image/jpeg", "image/webp"}


def _profile(user) -> UserProfile:
    from podcast.auth.backends import ensure_profile

    return ensure_profile(user)


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------


@router.get("/me", response=MeOut)
def get_me(request):
    user = request.auth
    profile = _profile(user)

    memberships = (
        ChannelMembership.objects.filter(user=user)
        .select_related("channel")
        .order_by("channel__name")
    )

    # 🚨 `humanize` on BOTH, because the Django username IS the Clerk `sub` for
    # anyone provisioned from a default session token. Falling back to
    # `user.get_username()` unguarded is the bug this replaces.
    readable = humanize(profile.display_name, user.get_username(), user.email)

    return {
        "id": user.id,
        "username": readable,
        "display_name": readable,
        "handle": profile.handle or None,
        "avatar_url": profile.avatar_url,
        "bio": profile.bio,
        "role": profile.role,
        "memberships": [membership_out(m) for m in memberships],
        "rating_count": Rating.objects.filter(user=user).count(),
        "watched_count": WatchEvent.objects.filter(user=user)
        .values("episode_id")
        .distinct()
        .count(),
        "favorite_count": Favorite.objects.filter(user=user).count(),
    }


@router.patch("/me", response=MeOut)
def update_me(request, payload: ProfileIn):
    profile = _profile(request.auth)
    for field in ("display_name", "bio", "avatar_url"):
        value = getattr(payload, field)
        if value is not None:
            setattr(profile, field, value)
    # 🔒 `role` is deliberately not settable here. Escalation happens in the admin.
    profile.save()
    return get_me(request)


# ---------------------------------------------------------------------------
# Viewer state for one episode
# ---------------------------------------------------------------------------


@router.get("/episodes/{youtube_id}/me", response=ViewerStateOut)
def get_viewer_state(request, youtube_id: str):
    """Everything the signed-in user has done with this episode, in one call."""
    user = request.auth
    episode = get_object_or_404(Episode, youtube_id=youtube_id)

    rating = Rating.objects.filter(user=user, episode=episode).first()
    watch = WatchEvent.objects.filter(user=user, episode=episode).aggregate(
        n=Count("id"), last=Max("watched_on")
    )

    return {
        "rating": rating.score if rating else None,
        "is_favorite": Favorite.objects.filter(user=user, episode=episode).exists(),
        "watch_count": watch["n"] or 0,
        "last_watched_on": watch["last"],
        "personal_tags": list(
            PersonalTag.objects.filter(user=user, episode=episode).values_list(
                "text", flat=True
            )
        ),
    }


# ---------------------------------------------------------------------------
# Ratings
# ---------------------------------------------------------------------------


@router.put("/episodes/{youtube_id}/rating", response=RatingOut)
def set_rating(request, youtube_id: str, payload: RatingIn):
    """Create or update this user's rating. Rating twice updates, never duplicates."""
    user = request.auth
    episode = get_object_or_404(Episode.objects.select_related("channel"), youtube_id=youtube_id)

    with transaction.atomic():
        rating, _ = Rating.objects.update_or_create(
            user=user, episode=episode, defaults={"score": payload.score}
        )
        scoring.recompute_episode(episode)

    episode.refresh_from_db()
    return {
        "score": rating.score,
        "episode_id": episode.id,
        "public_score": episode.public_score,
        "elite_score": episode.elite_score,
        "rating_count": episode.rating_count,
        "elite_rating_count": episode.elite_rating_count,
    }


@router.delete("/episodes/{youtube_id}/rating", response=RatingOut)
def clear_rating(request, youtube_id: str):
    user = request.auth
    episode = get_object_or_404(Episode.objects.select_related("channel"), youtube_id=youtube_id)

    with transaction.atomic():
        Rating.objects.filter(user=user, episode=episode).delete()
        scoring.recompute_episode(episode)

    episode.refresh_from_db()
    return {
        "score": 0,
        "episode_id": episode.id,
        "public_score": episode.public_score,
        "elite_score": episode.elite_score,
        "rating_count": episode.rating_count,
        "elite_rating_count": episode.elite_rating_count,
    }


# ---------------------------------------------------------------------------
# Watch log
# ---------------------------------------------------------------------------


@router.post("/episodes/{youtube_id}/watch", response=WatchSummaryOut)
def log_watch(request, youtube_id: str, payload: WatchIn = None):
    """Append a watch event. A LOG, not a flag - rewatches are the point."""
    user = request.auth
    episode = get_object_or_404(Episode, youtube_id=youtube_id)
    payload = payload or WatchIn()

    WatchEvent.objects.create(
        user=user,
        episode=episode,
        watched_on=payload.watched_on or timezone.localdate(),
        note=payload.note or "",
    )
    return _watch_summary(user, episode)


@router.get("/episodes/{youtube_id}/watch", response=WatchSummaryOut)
def get_watch_history(request, youtube_id: str):
    episode = get_object_or_404(Episode, youtube_id=youtube_id)
    return _watch_summary(request.auth, episode)


@router.delete("/watch/{event_id}", response=MessageOut)
def delete_watch_event(request, event_id: int):
    deleted, _ = WatchEvent.objects.filter(id=event_id, user=request.auth).delete()
    if not deleted:
        raise HttpError(404, "Watch event not found")
    return {"detail": "Watch event removed"}


WATCH_HISTORY_LIMIT = 50


def _watch_summary(user, episode) -> dict:
    """One SELECT for the page plus one aggregate.

    ⚠️ This used to run four queries (`count()`, `exists()`, `first()` and the
    slice) for what is two facts. `count()` still has to be a separate aggregate
    because the page is capped at WATCH_HISTORY_LIMIT.
    """
    events = list(
        WatchEvent.objects.filter(user=user, episode=episode)
        .order_by("-watched_on", "-id")[:WATCH_HISTORY_LIMIT]
    )
    total = WatchEvent.objects.filter(user=user, episode=episode).count()

    return {
        "episode_id": episode.id,
        "watch_count": total,
        "last_watched_on": events[0].watched_on if events else None,
        "events": [
            {
                "id": event.id,
                "episode_id": event.episode_id,
                "watched_on": event.watched_on,
                "note": event.note,
            }
            for event in events
        ],
    }


# ---------------------------------------------------------------------------
# Favorites
# ---------------------------------------------------------------------------


@router.put("/episodes/{youtube_id}/favorite", response=FavoriteOut)
def add_favorite(request, youtube_id: str):
    episode = get_object_or_404(Episode, youtube_id=youtube_id)
    Favorite.objects.get_or_create(user=request.auth, episode=episode)
    return {"episode_id": episode.id, "is_favorite": True}


@router.delete("/episodes/{youtube_id}/favorite", response=FavoriteOut)
def remove_favorite(request, youtube_id: str):
    episode = get_object_or_404(Episode, youtube_id=youtube_id)
    Favorite.objects.filter(user=request.auth, episode=episode).delete()
    return {"episode_id": episode.id, "is_favorite": False}


@router.get("/me/favorites", response=EpisodeListOut)
def list_favorites(request, limit: int = Query(24, ge=1, le=100), offset: int = Query(0, ge=0)):
    queryset = episode_list_queryset().filter(favorited_by__user=request.auth).order_by(
        "-favorited_by__created_at"
    )
    total = queryset.count()
    return {
        "items": [episode_brief(e) for e in queryset[offset : offset + limit]],
        "meta": paginated_meta(total, limit, offset),
    }


@router.get("/me/watched", response=EpisodeListOut)
def list_watched(request, limit: int = Query(24, ge=1, le=100), offset: int = Query(0, ge=0)):
    queryset = (
        episode_list_queryset()
        .filter(watch_events__user=request.auth)
        .annotate(_last=Max("watch_events__watched_on"))
        .order_by("-_last")
        .distinct()
    )
    total = queryset.count()
    return {
        "items": [episode_brief(e) for e in queryset[offset : offset + limit]],
        "meta": paginated_meta(total, limit, offset),
    }


@router.get("/me/ratings", response=EpisodeListOut)
def list_rated(request, limit: int = Query(24, ge=1, le=100), offset: int = Query(0, ge=0)):
    queryset = episode_list_queryset().filter(ratings__user=request.auth).order_by(
        "-ratings__updated_at"
    )
    total = queryset.count()
    return {
        "items": [episode_brief(e) for e in queryset[offset : offset + limit]],
        "meta": paginated_meta(total, limit, offset),
    }


# ---------------------------------------------------------------------------
# Personal tags  🔒 PRIVATE
# ---------------------------------------------------------------------------


@router.post("/episodes/{youtube_id}/tags", response=PersonalTagOut)
def add_personal_tag(request, youtube_id: str, payload: PersonalTagIn):
    """🔒 Private to this user. Never surfaced on any public endpoint."""
    episode = get_object_or_404(Episode, youtube_id=youtube_id)
    text = " ".join(payload.text.split())
    if not text:
        raise HttpError(422, "Tag cannot be empty")

    tag, _ = PersonalTag.objects.get_or_create(
        user=request.auth, episode=episode, text=text
    )
    return {"id": tag.id, "episode_id": episode.id, "text": tag.text}


@router.delete("/tags/{tag_id}", response=MessageOut)
def delete_personal_tag(request, tag_id: int):
    deleted, _ = PersonalTag.objects.filter(id=tag_id, user=request.auth).delete()
    if not deleted:
        raise HttpError(404, "Tag not found")
    return {"detail": "Tag removed"}


@router.get("/me/tags", response=list[PersonalTagOut])
def list_my_tags(request, q: str | None = Query(None)):
    queryset = PersonalTag.objects.filter(user=request.auth)
    if q:
        queryset = queryset.filter(text__icontains=q)
    return [
        {"id": t.id, "episode_id": t.episode_id, "text": t.text}
        for t in queryset.order_by("text")[:500]
    ]


# ---------------------------------------------------------------------------
# Channel membership (wave 10)
# ---------------------------------------------------------------------------


@router.post("/me/memberships", response=MembershipOut)
def claim_membership(request, payload: MembershipIn):
    """Claim membership of a channel. Unverified until an admin reviews it."""
    channel = get_object_or_404(Channel, id=payload.channel_id)
    membership, _ = ChannelMembership.objects.get_or_create(
        user=request.auth,
        channel=channel,
        defaults={"tier": payload.tier, "member_since": payload.member_since},
    )
    membership.channel = channel
    return membership_out(membership)


@router.post("/me/memberships/{membership_id}/screenshot", response=MembershipOut)
def upload_verification_screenshot(
    request, membership_id: int, file: UploadedFile = File(...)  # noqa: B008
):
    """🔒 Upload proof of membership.

    The image is PRIVATE: only admins see it, and only via the admin. It is never
    returned by any API endpoint - `has_screenshot` is the only thing exposed.
    """
    membership = get_object_or_404(
        ChannelMembership.objects.select_related("channel"),
        id=membership_id,
        user=request.auth,  # 🔒 scoped to the actor, not just the id
    )

    if file.size and file.size > MAX_SCREENSHOT_BYTES:
        raise HttpError(413, "Screenshot must be 8MB or smaller")
    if file.content_type not in ALLOWED_SCREENSHOT_TYPES:
        raise HttpError(415, "Screenshot must be a PNG, JPEG or WebP image")

    was_verified = membership.is_verified

    membership.verification_screenshot = file
    # Re-uploading resets verification: the new evidence has not been reviewed.
    membership.is_verified = False
    membership.verified_at = None
    membership.verified_by = None
    membership.save()

    # Losing verification changes the elite score of every episode they rated on
    # this channel - same rule as delete_membership below. Without this the stale
    # elite average survives until the hourly sweep.
    if was_verified:
        scoring.recompute_for_membership_change(membership.user_id, membership.channel_id)

    return membership_out(membership)


@router.get("/me/memberships", response=list[MembershipOut])
def list_my_memberships(request):
    memberships = (
        ChannelMembership.objects.filter(user=request.auth)
        .select_related("channel")
        .order_by("channel__name")
    )
    return [membership_out(m) for m in memberships]


@router.delete("/me/memberships/{membership_id}", response=MessageOut)
def delete_membership(request, membership_id: int):
    membership = ChannelMembership.objects.filter(
        id=membership_id, user=request.auth
    ).first()
    if not membership:
        raise HttpError(404, "Membership not found")

    channel_id, user_id = membership.channel_id, membership.user_id
    was_verified = membership.is_verified
    membership.delete()

    # Losing verification changes the elite score of every episode they rated.
    if was_verified:
        scoring.recompute_for_membership_change(user_id, channel_id)

    return {"detail": "Membership removed"}
