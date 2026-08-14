"""Pluggable authentication backends.

Both backends resolve a request to `request.auth = User` with a `.profile`. Routers
never care which one is active.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from ninja.security import HttpBearer

from podcast.models import UserProfile

logger = logging.getLogger("podcast")

User = get_user_model()


# ---------------------------------------------------------------------------
# Shared provisioning
# ---------------------------------------------------------------------------


@transaction.atomic
def provision_user(
    *,
    external_id: str,
    email: str = "",
    username: str = "",
    display_name: str = "",
    avatar_url: str = "",
) -> User:
    """Find or create the local User + UserProfile for an external identity.

    Keyed on `UserProfile.clerk_user_id`, never on email - an email can change and
    is not a stable identity. Idempotent: repeated calls return the same row.
    """
    # ⚠️ Identity-provider values are unbounded; the columns are not. An 120-char
    # display name from Clerk must become a truncated profile, not a DataError 500
    # on the very first authenticated request.
    display_name = (display_name or "")[:100]
    avatar_url = (avatar_url or "")[:200]

    profile = UserProfile.objects.select_related("user").filter(
        clerk_user_id=external_id
    ).first()

    if profile:
        # Refresh mutable fields the identity provider owns.
        changed = []
        if display_name and profile.display_name != display_name:
            profile.display_name = display_name
            changed.append("display_name")
        if avatar_url and profile.avatar_url != avatar_url:
            profile.avatar_url = avatar_url
            changed.append("avatar_url")
        if changed:
            profile.save(update_fields=changed)
        return profile.user

    base_username = (username or email.split("@")[0] or external_id)[:140]
    candidate = base_username
    suffix = 1
    while User.objects.filter(username=candidate).exists():
        suffix += 1
        candidate = f"{base_username[:140 - len(str(suffix)) - 1]}-{suffix}"

    try:
        with transaction.atomic():
            user = User.objects.create_user(username=candidate, email=email)
            UserProfile.objects.create(
                user=user,
                clerk_user_id=external_id,
                display_name=display_name or candidate,
                avatar_url=avatar_url,
            )
    except IntegrityError:
        # Two first-requests raced (a fresh SPA session fires parallel API calls
        # with the same brand-new token). The unique constraint on clerk_user_id
        # did its job - read the winner instead of 500ing the loser.
        profile = UserProfile.objects.select_related("user").filter(
            clerk_user_id=external_id
        ).first()
        if profile:
            return profile.user
        raise
    logger.info("Provisioned user %s for external id %s", candidate, external_id)
    return user


def ensure_profile(user: User) -> UserProfile:
    """Every authenticated user must have a profile.

    Covers the Django superuser created by `createsuperuser`, which never went
    through provision_user.
    """
    profile = getattr(user, "profile", None)
    if profile:
        return profile
    return UserProfile.objects.create(
        user=user,
        display_name=user.get_username(),
        role=UserProfile.Role.ADMIN if user.is_superuser else UserProfile.Role.MEMBER,
    )


# ---------------------------------------------------------------------------
# Dev backend
# ---------------------------------------------------------------------------


class DevAuth(HttpBearer):
    """🔒 LOCAL DEVELOPMENT ONLY.

    Accepts `Authorization: Bearer dev:<username>` and provisions that user on the
    fly. Exists so waves 9-13 can be built and tested before Clerk keys arrive.

    prod.py refuses to boot with this backend selected.
    """

    def authenticate(self, request, token: str):
        if not settings.DEBUG and settings.AUTH_BACKEND != "dev":
            return None

        if not token or not token.startswith("dev:"):
            return None

        username = token[4:].strip()
        if not username:
            return None

        user = provision_user(
            external_id=f"dev_{username}",
            username=username,
            email=f"{username}@dev.local",
            display_name=username,
        )
        ensure_profile(user)
        return user


# ---------------------------------------------------------------------------
# Clerk backend
# ---------------------------------------------------------------------------


class ClerkAuth(HttpBearer):
    """Verifies a Clerk-issued JWT against Clerk's JWKS.

    🔒 Signature, issuer and expiry are ALL verified. Never decode without
    verification, and never trust a `sub` that did not survive that check.
    """

    _jwks_client = None

    @classmethod
    def _get_jwks_client(cls):
        # Cached across requests: PyJWKClient does its own key caching, so this
        # is one network call per key rotation, not one per request.
        if cls._jwks_client is None:
            from jwt import PyJWKClient

            if not settings.CLERK_JWKS_URL:
                raise RuntimeError("CLERK_JWKS_URL is not configured")
            cls._jwks_client = PyJWKClient(settings.CLERK_JWKS_URL, cache_keys=True)
        return cls._jwks_client

    def authenticate(self, request, token: str):
        import jwt

        if not token:
            return None

        try:
            signing_key = self._get_jwks_client().get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                issuer=settings.CLERK_ISSUER or None,
                options={
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_iss": bool(settings.CLERK_ISSUER),
                },
            )
        except Exception as exc:
            # Never leak why a token failed - it helps an attacker calibrate.
            logger.info("Rejected token: %s", type(exc).__name__)
            return None

        subject = claims.get("sub")
        if not subject:
            return None

        user = provision_user(
            external_id=subject,
            email=claims.get("email", "") or "",
            username=claims.get("username", "") or "",
            display_name=claims.get("name", "") or claims.get("username", "") or "",
            avatar_url=claims.get("picture", "") or "",
        )
        ensure_profile(user)
        return user


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------

_BACKENDS = {"dev": DevAuth, "clerk": ClerkAuth}


def get_auth():
    """The auth instance every protected router uses."""
    backend = _BACKENDS.get(settings.AUTH_BACKEND)
    if backend is None:
        raise RuntimeError(
            f"Unknown AUTH_BACKEND {settings.AUTH_BACKEND!r}; "
            f"expected one of {sorted(_BACKENDS)}"
        )
    return backend()
