"""Clerk Backend API lookup for the identity a session token does not carry.

🚨 Why this exists (2026-08-15): Clerk's DEFAULT session token contains only
`sub`, `sid`, `iss`, `exp`, `iat`, `nbf`, `azp`, `jti`, `v`. It carries no name,
no username, no email and no picture unless someone customises the JWT template
in the Clerk dashboard.

So `provision_user` received empty strings for all of them and fell through to
its last resort - the Clerk `sub` - which is how the live site greeted the first
real Google sign-in with `user_33Kq...` as BOTH the display name and the handle.

Fixing that in the dashboard would work, but it is invisible config that a
cloned or re-created Clerk instance silently loses. Reading it from the Backend
API instead makes correct provisioning a property of the code.

- Uses `CLERK_SECRET_KEY`, which is already configured for the webhook path.
- stdlib urllib only, matching `podcast/ingestion/youtube_api.py`.
- 🔒 Fails SOFT. A Clerk API outage must degrade the display name, never block
  sign-in: the token itself was already cryptographically verified, so the user
  is authentic regardless of whether this call succeeds.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings

logger = logging.getLogger("podcast")

API_BASE = "https://api.clerk.com/v1"

TIMEOUT_SECONDS = 5


def _full_name(first: str, last: str) -> str:
    return " ".join(part for part in (first.strip(), last.strip()) if part)


def _primary_email(payload: dict) -> str:
    """The address Clerk marks primary, falling back to the first verified one."""
    addresses = payload.get("email_addresses") or []
    primary_id = payload.get("primary_email_address_id")
    for address in addresses:
        if address.get("id") == primary_id:
            return address.get("email_address") or ""
    for address in addresses:
        if (address.get("verification") or {}).get("status") == "verified":
            return address.get("email_address") or ""
    return (addresses[0].get("email_address") or "") if addresses else ""


def _clerk_error_reason(exc: Exception) -> str:
    """Clerk's own explanation for a failed call, from the ERROR body.

    🔒 The success body is never logged - it is account data. An error body is
    not: it is `{"errors":[{"code","message"}], "clerk_trace_id"}`, and the
    `code` is the only thing that separates causes with opposite remedies.
    Without it a 403 could be a key from another application, a restricted key
    missing `users:read`, or an id that instance has never seen - and we spent
    two deploys guessing between them on 2026-08-16.

    Only `code` and `message` are read; the raw body is never logged, and this
    never raises, because a diagnostic that can break the caller is worse than
    no diagnostic.
    """
    reader = getattr(exc, "read", None)
    if reader is None:
        return ""
    try:
        body = json.loads(reader() or b"{}")
        errors = body.get("errors") or []
        parts = [
            f"{error.get('code') or '?'}: {error.get('message') or ''}".strip()
            for error in errors[:2]
        ]
        return f" - {'; '.join(parts)}" if parts else ""
    except Exception:  # pragma: no cover - diagnostics must never throw
        return ""


def fetch_user(clerk_user_id: str) -> dict | None:
    """Identity fields for one Clerk user, or None if we cannot get them.

    Returns a dict shaped for `provision_user`: `display_name`, `avatar_url`,
    `username`, `email`. Never raises.
    """
    secret = getattr(settings, "CLERK_SECRET_KEY", "") or ""
    if not secret or not clerk_user_id:
        return None

    # The id is path-interpolated, so it is quoted even though Clerk ids are
    # already URL-safe. A `sub` claim is attacker-influenced in principle.
    url = f"{API_BASE}/users/{urllib.parse.quote(clerk_user_id, safe='')}"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {secret}",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        # 🔒 Deliberately not the response body: it echoes account data.
        #
        # The HTTP STATUS is safe and load-bearing, though. Without it the log
        # said only "HTTPError", which cannot distinguish a rejected key (401)
        # from an id that belongs to a different Clerk instance (404) - and the
        # remedies are opposite. Cost a diagnostic round trip on 2026-08-16.
        status = getattr(exc, "code", None)
        logger.warning(
            "Clerk user lookup failed for %s: %s%s%s",
            clerk_user_id,
            type(exc).__name__,
            f" (HTTP {status})" if status else "",
            _clerk_error_reason(exc),
        )
        return None

    if not isinstance(payload, dict):
        return None

    name = _full_name(payload.get("first_name") or "", payload.get("last_name") or "")
    email = _primary_email(payload)

    return {
        "display_name": name or payload.get("username") or "",
        "avatar_url": payload.get("image_url") or "",
        "username": payload.get("username") or "",
        "email": email,
    }
