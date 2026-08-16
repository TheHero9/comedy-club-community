"""Validation for a member's self-chosen display name.

🚨 `display_name` is published as `author_name` on every public comment, as
`author` on every moment, and as `proposed_by` in the moderation queue. It is
accepted from `PATCH /api/me` as free text, so until now nothing stopped a
member calling themselves `Admin`, `Модератор`, or `Support` - and a moderator
reading a report queue has no other signal about who wrote a row.

This is impersonation of the SITE, which is the case worth blocking. It does not
attempt to stop impersonation of another MEMBER: display names are not unique by
design (two people called Иван is normal and fine), so a uniqueness rule would
reject honest names far more often than dishonest ones. `handle` is the unique
field, and it has its own validation in `handles.py`.

🇧🇬 The reserved list is bilingual because the UI is. A Bulgarian-speaking
audience reads `Администратор` as authority exactly the way an English one reads
`Admin`, so blocking only the English half would block nothing that matters.

⚠️ Applied ONLY to the name a member types, never to the one Clerk supplies.
A Google account whose real name happens to collide is at least backed by an
identity provider; silently rejecting it would break sign-in for that person.
"""

from __future__ import annotations

import unicodedata

from podcast.auth.backends import looks_like_external_id

MAX_LENGTH = 100

#: Words that claim to speak for the site. Compared against the whole
#: normalised name, not as substrings - "Adminka" and "Модератора Петър" are
#: ordinary nicknames, and a substring rule would reject both.
RESERVED_NAMES = {
    # English
    "admin", "admins", "administrator", "moderator", "mod", "mods",
    "staff", "support", "system", "official", "team", "owner", "root",
    "comedy club", "comedy club community",
    # 🇧🇬 Bulgarian
    "админ", "админи", "администратор", "администратори",
    "модератор", "модератори", "модерация",
    "екип", "поддръжка", "система", "официален", "официално", "собственик",
}


class DisplayNameError(ValueError):
    """A display name we will not publish, with a reason worth showing."""


def clean_display_name(raw: str | None) -> str:
    """Normalise a typed display name, or raise `DisplayNameError`.

    Empty is valid and means "go back to my identity provider's name" - the
    same sentinel `handle` uses, and what makes `display_name_is_custom`
    reversible.
    """
    if raw is None:
        return ""

    # NFKC for the same reason handles use it: fullwidth and compatibility
    # forms render identically to plain ASCII, so without this `Ａdmin` walks
    # straight past the reserved list looking exactly like `Admin`.
    value = unicodedata.normalize("NFKC", raw)
    value = " ".join(value.split())

    if not value:
        return ""

    if len(value) > MAX_LENGTH:
        raise DisplayNameError(f"Name must be at most {MAX_LENGTH} characters.")

    if value.casefold() in RESERVED_NAMES:
        raise DisplayNameError("That name is reserved. Please choose another.")

    # Both of these are things `humanize()` already refuses to DERIVE a name
    # from; there is no reason to let someone type one in by hand either.
    if "@" in value:
        raise DisplayNameError("Name cannot contain @. Set a handle instead.")

    if looks_like_external_id(value):
        raise DisplayNameError("That name is not available.")

    return value
