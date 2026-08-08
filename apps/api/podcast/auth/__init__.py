"""Authentication for the API.

🚨 DESIGN DECISION (2026-08-08, see docs/03-auth-decisions.md)

Clerk keys are not available yet, but waves 9-13 all need an authenticated actor.
Rather than block, the auth layer is PLUGGABLE:

    AUTH_BACKEND=dev     local only - trusts an X-Dev-User header
    AUTH_BACKEND=clerk   production - verifies a Clerk JWT against JWKS

Both resolve to the same thing: a Django User plus its UserProfile. Every router,
permission check and test is written against that contract, so switching to Clerk
is one environment variable and changes no business logic.

🔒 The dev backend is IMPOSSIBLE to enable in production: config/settings/prod.py
raises at import time if AUTH_BACKEND != "clerk". There is no code path that lets a
deployed instance trust a header.
"""

from .backends import ClerkAuth, DevAuth, get_auth
from .permissions import require_moderator, require_self_or_moderator

__all__ = [
    "ClerkAuth",
    "DevAuth",
    "get_auth",
    "require_moderator",
    "require_self_or_moderator",
]
