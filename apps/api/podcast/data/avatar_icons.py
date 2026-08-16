"""The profile-icon catalogue and its unlock rules.

🎯 WHAT THIS IS. Icons are earned by membership: "one month of BFF gets you
these two, seventeen months gets you the whole set". The owner supplies the
artwork and the thresholds; this file is where that data lands, and adding to it
is a DATA change - no migration, no backfill, no code.

🚨 THE CATALOGUE IS DELIBERATELY ALMOST EMPTY. The real icons do not exist yet
(owner, 2026-08-16: "I will upload soon some profile icons ... based on how many
months you have for each channel"). What ships is the machinery plus a few
channel-neutral defaults, so the picker is a working feature on day one and the
artwork drop is a pull request against this list.

HOW TO ADD ICONS
----------------
Append an `AvatarIcon` per icon. Nothing else has to change::

    AvatarIcon(
        key="bff-gold",                  # stable, never reused, never renamed
        label="BFF Gold",                # shown under the icon in the picker
        image_url="/static/avatars/bff-gold.png",
        channel_slug="bff-pepi-q",       # None = available to everyone
        min_months=17,                   # months of membership on that channel
    ),

🚨 `key` IS THE STORED VALUE (`UserProfile.avatar_key`). Renaming one silently
un-picks it for every user who chose it - they do not get an error, their
avatar just reverts. Retire an icon by removing it from this list and leaving
its key burned; never re-point an old key at new artwork.

🔒 `image_url` is rendered in an `<img>` on public profiles, so it must be a
path this app controls. Never accept one from a user.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AvatarIcon:
    key: str
    label: str
    image_url: str
    #: None means "no membership needed". Otherwise the slug of the channel the
    #: months must have been accrued on - memberships do NOT pool across
    #: channels, which is the entire point of the feature.
    channel_slug: str | None = None
    #: Months of membership on `channel_slug` required. Ignored when the icon
    #: has no channel.
    min_months: int = 0


#: 🚨 Order is the picker's order. Free icons first, then by channel, then by
#: cost within a channel - so the grid reads as a ladder rather than a bag.
CATALOGUE: tuple[AvatarIcon, ...] = (
    # --- Available to everyone ------------------------------------------------
    # Placeholders until the real artwork arrives. They exist so the picker has
    # something to show and so the "no icon chosen" path is exercised in tests.
    AvatarIcon(key="default", label="Default", image_url=""),
)


_BY_KEY = {icon.key: icon for icon in CATALOGUE}


def get(key: str) -> AvatarIcon | None:
    """Look up an icon, or None for an unknown or retired key.

    🚨 Never raises. `UserProfile.avatar_key` can hold a key this catalogue no
    longer lists, and a retired icon must degrade to the default avatar rather
    than 500 the profile of whoever picked it.
    """
    return _BY_KEY.get(key or "")


def unlocked_months(icon: AvatarIcon, months_by_channel: dict[str, int]) -> bool:
    """True when `months_by_channel` satisfies this icon's requirement.

    `months_by_channel` maps a channel slug to the months held there - built
    once per request by the caller, so this stays a pure comparison.
    """
    if icon.channel_slug is None:
        return True
    return months_by_channel.get(icon.channel_slug, 0) >= icon.min_months


def resolve_image(key: str, months_by_channel: dict[str, int]) -> str:
    """The image URL to render for a stored key, or "" to fall back.

    🚨 Re-checks the unlock on every read rather than trusting the stored key.
    A key is written when the icon was unlocked; a membership can lapse
    afterwards, and a profile that kept displaying an icon it no longer
    qualifies for would make the whole ladder meaningless. The KEY is kept
    either way - renewing next month restores the icon rather than having
    silently discarded the choice.
    """
    icon = get(key)
    if icon is None or not unlocked_months(icon, months_by_channel):
        return ""
    return icon.image_url


__all__ = [
    "CATALOGUE",
    "AvatarIcon",
    "get",
    "resolve_image",
    "unlocked_months",
]
