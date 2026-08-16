"""Authenticated per-user endpoints: ratings, watch log, favorites, private tags,
profile and channel membership.

🔒 The actor is ALWAYS `request.auth`. A user id is never read from the request body
or a query parameter - that would let anyone act as anyone.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.db.models import Count, Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import File, Query, Router
from ninja.errors import HttpError
from ninja.files import UploadedFile

from podcast.auth import get_auth
from podcast.auth.backends import humanize
from podcast.data import avatar_icons
from podcast.models import (
    Channel,
    ChannelMembership,
    Episode,
    Favorite,
    Moment,
    ParticipantProposal,
    PersonalTag,
    Rating,
    UserProfile,
    WatchEvent,
)
from podcast.services import memberships as membership_math
from podcast.services import scoring
from podcast.services.display_names import DisplayNameError, clean_display_name
from podcast.services.handles import HandleError, clean_handle
from podcast.services.links import LinkError, clean_avatar_url

from .schemas import (
    AvatarIconOut,
    AvatarSelectionIn,
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


def _months_by_channel(memberships, today=None) -> dict[str, int]:
    """Months held per channel slug, for the icon unlock rules.

    🚨 Memberships do NOT pool. Seventeen months on one channel unlocks nothing
    on another - that is the entire point of the ladder, so this is keyed by
    slug and never summed.
    """
    today = today or timezone.localdate()
    out: dict[str, int] = {}
    for membership in memberships:
        if not (membership.renewal_day and membership.member_since):
            continue
        out[membership.channel.slug] = membership_math.months_held(
            membership.member_since, membership.renewal_day, today
        )
    return out


@router.get("/me", response=MeOut)
def get_me(request):
    user = request.auth
    profile = _profile(user)

    memberships = list(
        ChannelMembership.objects.filter(user=user)
        .select_related("channel")
        .order_by("channel__name")
    )

    # 🚨 `humanize` on BOTH, because the Django username IS the Clerk `sub` for
    # anyone provisioned from a default session token. Falling back to
    # `user.get_username()` unguarded is the bug this replaces.
    readable = humanize(profile.display_name, user.get_username())

    # A chosen icon wins over the profile's own avatar_url, but only while it is
    # still unlocked. `resolve_image` returns "" for an unknown, retired or
    # re-locked key, which falls through to whatever the account already had.
    chosen = avatar_icons.resolve_image(
        profile.avatar_key, _months_by_channel(memberships)
    )

    return {
        "id": user.id,
        "username": readable,
        "display_name": readable,
        "handle": profile.handle or None,
        "avatar_url": chosen or profile.avatar_url,
        "avatar_key": profile.avatar_key,
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

    if payload.bio is not None:
        profile.bio = payload.bio

    # 🔒 Both of these used to be written through unvalidated. `avatar_url` is a
    # `URLField`, but Django does not run field validators on `save()`, so any
    # 200-char string reached the column and then a public page; `display_name`
    # is published as `author_name` under every comment, so `Admin` was a name
    # anyone could take. See services/links.py and services/display_names.py.
    if payload.avatar_url is not None:
        try:
            profile.avatar_url = clean_avatar_url(payload.avatar_url)
        except LinkError as exc:
            raise HttpError(422, str(exc)) from exc

    if payload.display_name is not None:
        try:
            profile.display_name = clean_display_name(payload.display_name)
        except DisplayNameError as exc:
            raise HttpError(422, str(exc)) from exc
        # 🚨 THIS FLAG IS WHAT MAKES THE SAVE STICK. `provision_user` refreshes
        # display_name from Clerk on every authenticated request, so without it
        # the row below is reverted before the member gets back to the profile
        # page. See UserProfile.display_name_is_custom.
        #
        # Clearing the field un-sets it, so "" means "go back to my Google name"
        # rather than "leave me permanently nameless" - a member who wipes the
        # box by accident gets their name back instead of a dead end.
        #
        # Read off the CLEANED value, not the raw payload: `clean_display_name`
        # normalises whitespace, so a name of "   " is empty here and must
        # un-set the flag exactly like "" does.
        profile.display_name_is_custom = bool(profile.display_name)

    if payload.handle is not None:
        try:
            handle = clean_handle(payload.handle)
        except HandleError as exc:
            # 422 with the reason, so the form can show WHY rather than "invalid".
            raise HttpError(422, str(exc)) from exc

        # 🚨 Checked here AND caught below. The check is what produces a useful
        # message; the catch is what stops a race between two users claiming the
        # same handle from becoming a 500. Neither alone is enough.
        if handle is not None:
            taken = (
                UserProfile.objects.filter(handle=handle)
                .exclude(pk=profile.pk)
                .exists()
            )
            if taken:
                raise HttpError(409, "That handle is already taken.")
        profile.handle = handle

    # 🔒 `role` is deliberately not settable here. Escalation happens in the admin.
    try:
        profile.save()
    except IntegrityError as exc:
        raise HttpError(409, "That handle is already taken.") from exc
    return get_me(request)


# ---------------------------------------------------------------------------
# Profile icons (2026-08-16)
# ---------------------------------------------------------------------------


def _viewer_months(user) -> dict[str, int]:
    return _months_by_channel(
        ChannelMembership.objects.filter(user=user).select_related("channel")
    )


@router.get("/me/avatars", response=list[AvatarIconOut])
def list_avatars(request):
    """The icon catalogue, with each entry marked unlocked or not for this user.

    🚨 Locked icons are LISTED, not hidden. The ladder is the feature - seeing
    that eleven more months of a channel earns a particular icon is the whole
    reason it motivates anything. Hiding them would make the picker look like it
    only ever has the two icons you already have.

    ⚠️ The catalogue is nearly empty until the artwork lands; see
    podcast/data/avatar_icons.py. This endpoint needs no change when it fills.
    """
    profile = _profile(request.auth)
    months = _viewer_months(request.auth)

    # 🇧🇬 Channel NAMES come from the database, never from the catalogue - they
    # are content and are rendered untranslated. One query for the handful of
    # slugs the catalogue mentions, not one per icon.
    slugs = {icon.channel_slug for icon in avatar_icons.CATALOGUE if icon.channel_slug}
    names = dict(
        Channel.objects.filter(slug__in=slugs).values_list("slug", "name")
    )

    return [
        {
            "key": icon.key,
            "label": icon.label,
            "image_url": icon.image_url,
            "channel_slug": icon.channel_slug,
            # ⚠️ None for a channel-free icon, and also for a slug that matches
            # no channel - a typo in the catalogue makes an icon permanently
            # locked rather than 500ing the picker.
            "channel_name": names.get(icon.channel_slug) if icon.channel_slug else None,
            "min_months": icon.min_months,
            "unlocked": avatar_icons.unlocked_months(icon, months),
            "selected": profile.avatar_key == icon.key,
        }
        for icon in avatar_icons.CATALOGUE
    ]


@router.put("/me/avatar", response=MeOut)
def select_avatar(request, payload: AvatarSelectionIn):
    """Choose a profile icon, or pass "" to go back to the default.

    🔒 The unlock is enforced HERE, on the server, against the actor's own
    memberships. The picker greys locked icons out, but a hidden button is not
    an authorization check.
    """
    profile = _profile(request.auth)
    key = payload.avatar_key.strip()

    if key == "":
        profile.avatar_key = ""
        profile.save(update_fields=["avatar_key"])
        return get_me(request)

    icon = avatar_icons.get(key)
    if icon is None:
        raise HttpError(404, "No such profile icon")
    if not avatar_icons.unlocked_months(icon, _viewer_months(request.auth)):
        raise HttpError(403, "That icon is not unlocked yet")

    profile.avatar_key = key
    profile.save(update_fields=["avatar_key"])
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
        "my_moment_ids": list(
            Moment.objects.filter(user=user, episode=episode).values_list("id", flat=True)
        ),
        "my_proposal_ids": list(
            ParticipantProposal.objects.filter(
                proposed_by=user, episode=episode
            ).values_list("id", flat=True)
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


def _apply_membership_payload(membership, payload: MembershipIn) -> None:
    """Write a claim onto a membership row, converting months into an anchor.

    🚨 The user's "70 months, renews on the 6th" becomes ONE date. Nothing here
    stores the 70 - see podcast/services/memberships.py for why a stored count
    is wrong by the next morning.
    """
    membership.tier = payload.tier

    if payload.months is not None and payload.renewal_day is not None:
        try:
            membership.renewal_day = payload.renewal_day
            membership.member_since = membership_math.member_since_for(
                payload.months, payload.renewal_day, timezone.localdate()
            )
        except membership_math.MembershipMathError as exc:
            # 422 with the reason, so the form can say WHY rather than "invalid".
            raise HttpError(422, str(exc)) from exc
    elif payload.member_since is not None:
        # The pre-2026-08-16 shape: a bare date, no renewal day. Kept working
        # rather than 400ing, but it cannot produce a month count.
        membership.member_since = payload.member_since


@router.post("/me/memberships", response=MembershipOut)
def claim_membership(request, payload: MembershipIn):
    """Claim - or re-state - membership of a channel.

    🚨 An UPSERT, not a create. There is a unique constraint on (user, channel),
    so a second POST for the same channel used to be a silent no-op that
    returned the OLD row: a user correcting a typo in their month count got
    their original number back and no error, which reads as the form not
    working. Posting the same channel twice now means "this is my membership".

    🚨 Claiming does NOT verify. `is_verified` stays whatever an admin set it to
    and is the only thing that feeds the elite score. (Owner ruling, 2026-08-16:
    self-reported memberships earn the badge and the icons, not the vote.)
    """
    channel = get_object_or_404(Channel, id=payload.channel_id)

    with transaction.atomic():
        membership, _created = ChannelMembership.objects.select_for_update().get_or_create(
            user=request.auth, channel=channel
        )
        _apply_membership_payload(membership, payload)
        membership.save()

    membership.channel = channel
    return membership_out(membership)


@router.patch("/me/memberships/{membership_id}", response=MembershipOut)
def update_membership(request, membership_id: int, payload: MembershipIn):
    """Correct an existing claim - the month count, the renewal day or the tier.

    🔒 Scoped to `request.auth`, not just the id, so a membership id guessed off
    another user cannot be edited.

    ⚠️ `channel_id` in the body is IGNORED here. Moving a membership to a
    different channel would silently change which channel's elite score a
    verified user votes on; that is a delete and a new claim, not an edit.
    """
    membership = get_object_or_404(
        ChannelMembership.objects.select_related("channel"),
        id=membership_id,
        user=request.auth,
    )
    _apply_membership_payload(membership, payload)
    membership.save()
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
