"""Validation for user-supplied URLs that end up on a public page.

🚨 Django does NOT run a field's validators on `save()`. `UserProfile.avatar_url`
and `Person.avatar_url` are both `URLField`s, and both are written straight from
a request body, so "it's a URLField" was never a check - any 200-character
string reached the column and then the page.

It is not XSS: both render through a plain `<img src>` (never `next/image`,
deliberately - see components/shared/PersonAvatar.tsx), and `javascript:` in an
`img` src does not execute. The real problem is quieter. An arbitrary third-party
URL on a public profile or an episode's cast list is a beacon: every visitor's
browser fetches it, handing the URL's owner their IP and User-Agent. A `data:`
URL is the other shape - a way to store arbitrary bytes in a text column and
have every viewer render them.

So: http(s) only, a real host, and a length the column can hold.
"""

from __future__ import annotations

from urllib.parse import urlsplit

#: Mirrors `URLField`'s default `max_length`, which is what the column is.
MAX_URL_LENGTH = 200

ALLOWED_SCHEMES = {"http", "https"}


class LinkError(ValueError):
    """A URL we will not publish, with a reason worth showing the user."""


def clean_avatar_url(raw: str | None) -> str:
    """Normalise an avatar URL, or raise `LinkError`.

    Empty input is valid and means "no picture" - the UI layers an initials tile
    behind every avatar precisely so an absent or dead URL degrades quietly.
    """
    value = (raw or "").strip()
    if not value:
        return ""

    if len(value) > MAX_URL_LENGTH:
        raise LinkError(f"Image URL must be at most {MAX_URL_LENGTH} characters.")

    try:
        parts = urlsplit(value)
    except ValueError as exc:
        raise LinkError("That does not look like a valid image URL.") from exc

    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        # Named explicitly rather than "invalid": a member pasting a `data:` URL
        # out of an image editor has made an understandable mistake, and the
        # message should say what shape is wanted.
        raise LinkError("Image URL must start with http:// or https://")

    if not parts.netloc:
        raise LinkError("Image URL must include a domain.")

    return value
