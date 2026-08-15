"""Normalisation and validation for `UserProfile.handle`.

The handle is a self-chosen public nickname (owner ruling, 2026-08-15: "users
can and will edit it, it's their name basically"). It is rendered publicly as
`@handle`, so it is user input on a public surface and gets the same treatment
as any other: normalised once, validated against an allow-list, never a
free-for-all.

🇧🇬 Cyrillic is explicitly allowed. The audience is Bulgarian, and an
ASCII-only rule would tell most of them their own name is invalid. The check is
therefore "is this a letter/digit" by Unicode category, not a byte range.
"""

from __future__ import annotations

import unicodedata

MIN_LENGTH = 3
MAX_LENGTH = 30

# Punctuation a handle may contain, but never start or end with.
INNER_PUNCTUATION = {"_", "-", "."}


class HandleError(ValueError):
    """A handle the user may not have, with a reason worth showing them."""


def normalize_handle(raw: str | None) -> str | None:
    """`" @Ivan_Petrov "` -> `"ivan_petrov"`. Empty input means "no handle".

    🚨 Returns None, never "". The column is unique, and Postgres treats every
    NULL as distinct while it treats "" as a value - so a second user clearing
    their handle would collide with the first.
    """
    if raw is None:
        return None

    # NFKC first: without it "ｉｖａｎ" (fullwidth) and "ivan" are different
    # rows that render identically, which is an impersonation vector.
    value = unicodedata.normalize("NFKC", raw).strip()
    value = value.lstrip("@").strip()
    if not value:
        return None
    return value.casefold()


def validate_handle(value: str) -> str:
    """Return the handle, or raise `HandleError` explaining what is wrong."""
    if len(value) < MIN_LENGTH:
        raise HandleError(f"Handle must be at least {MIN_LENGTH} characters.")
    if len(value) > MAX_LENGTH:
        raise HandleError(f"Handle must be at most {MAX_LENGTH} characters.")

    for char in value:
        if char in INNER_PUNCTUATION:
            continue
        # `isalnum()` is Unicode-aware, so Cyrillic letters pass.
        if not char.isalnum():
            raise HandleError(
                "Handle may only contain letters, digits, and . _ -"
            )
        # A category check on top of isalnum: combining marks and symbols can
        # slip through isalnum on some inputs and render as invisible noise.
        if unicodedata.category(char).startswith(("M", "C")):
            raise HandleError("Handle contains an unsupported character.")

    if value[0] in INNER_PUNCTUATION or value[-1] in INNER_PUNCTUATION:
        raise HandleError("Handle cannot start or end with . _ or -")

    return value


def clean_handle(raw: str | None) -> str | None:
    """Normalise then validate. None passes through as "clear my handle"."""
    value = normalize_handle(raw)
    if value is None:
        return None
    return validate_handle(value)
