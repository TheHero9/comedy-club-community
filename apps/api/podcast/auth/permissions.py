"""Authorization helpers.

🔒 Authorization is ALWAYS checked here, on the API. Never rely on the frontend
hiding a button, and never trust a client-supplied user id - the actor is always
`request.auth`, which only an authentication backend can set.
"""

from ninja.errors import HttpError

from podcast.models import UserProfile

from .backends import ensure_profile


def profile_for(user) -> UserProfile:
    return ensure_profile(user)


def is_moderator(user) -> bool:
    return profile_for(user).is_staff_role


def require_moderator(user) -> UserProfile:
    """403 unless the actor is a moderator or admin."""
    profile = profile_for(user)
    if not profile.is_staff_role:
        raise HttpError(403, "Moderator role required")
    return profile


def require_admin(user) -> UserProfile:
    profile = profile_for(user)
    if profile.role != UserProfile.Role.ADMIN:
        raise HttpError(403, "Admin role required")
    return profile


def require_self_or_moderator(user, owner_id: int) -> UserProfile:
    """Allow acting on your own row, or on anyone's if you moderate."""
    profile = profile_for(user)
    if user.id != owner_id and not profile.is_staff_role:
        raise HttpError(403, "You can only modify your own content")
    return profile
