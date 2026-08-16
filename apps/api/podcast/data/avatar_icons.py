"""The profile-icon catalogue and its unlock rules.

🎯 WHAT THIS IS. Icons are earned by membership length, per channel: the owner
supplies the artwork and the thresholds, and this is where that data lands.
Adding, retiring or re-tiering an icon is a **data** change - no migration, no
backfill, no code anywhere else.

🚨 `min_months` IS COUNTED IN COMPLETED MONTHS, so the first rung is **0**.
`months_held` in `podcast/services/memberships.py` returns 0 for somebody who
joined this week - which is exactly what a YouTube loyalty badge shows - and 0
is the "starting / new member" tier every channel below opens with. A floor of 1
would make that tier unreachable and silently hand every new member the
one-month icon.

HOW TO ADD ICONS
----------------
Drop the file in `apps/web/public/avatars/` and append an `AvatarIcon`::

    AvatarIcon(
        key="ccp-5y",                        # stable, never reused, never renamed
        label="Comedy Club Podcast - 5 years",  # internal/admin name, not rendered
        image_url="/avatars/ccp-5y.png",
        channel_slug="комеди-клуб-подкаст-comedy-club-podcast",
        min_months=60,
    ),

🚨 `key` IS THE STORED VALUE (`UserProfile.avatar_key`). Renaming one silently
un-picks it for every user who chose it - they get no error, their avatar just
reverts to the default. Retire an icon by removing it and leaving its key
burned; never re-point an old key at different artwork.

🔒 `image_url` is rendered in an `<img>` on public profiles, so it must be a path
this app serves. It resolves against the WEB origin (Next's `public/`), never
the API's. Never accept one from a user.

⚠️ `label` is NOT what the picker renders. The UI composes the visible label
from `min_months` and the channel name so it can be bilingual - see
`copy.profile.iconTier`. This field is the catalogue's own name, for the admin
and the OpenAPI schema.
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
    #: COMPLETED months of membership on `channel_slug` required; 0 is the
    #: "new member" rung and is a real tier. Ignored when the icon has no
    #: channel.
    min_months: int = 0


# Slugs, spelled once. 🚨 These must match `Channel.slug` exactly - a typo here
# does not raise, it just makes every icon on that channel permanently locked.
# Four of the seven channels have artwork so far.
CCP = "комеди-клуб-подкаст-comedy-club-podcast"
IVAN_KIRKOV = "ivan-kirkov"
BFF_PEPI = "bff-с-пепи-кю"
DELO_404 = "дело-404-crime-podcast"


#: 🚨 Order is the picker's order: the free icon first, then each channel's
#: ladder from cheapest to dearest, so the grid reads as a ladder rather than as
#: a bag of pictures.
CATALOGUE: tuple[AvatarIcon, ...] = (
    # --- Available to everyone ------------------------------------------------
    AvatarIcon(
        key="club",
        label="Comedy Club",
        image_url="/avatars/club.jpeg",
    ),
    # --- Комеди Клуб Подкаст / Comedy Club Podcast ----------------------------
    # The full eight-rung ladder: starting, 1m, 2m, 6m, then a year at a time.
    AvatarIcon("ccp-starting", "Comedy Club Podcast - new member", "/avatars/ccp-starting.png", CCP, 0),
    AvatarIcon("ccp-1m", "Comedy Club Podcast - 1 month", "/avatars/ccp-1m.png", CCP, 1),
    AvatarIcon("ccp-2m", "Comedy Club Podcast - 2 months", "/avatars/ccp-2m.png", CCP, 2),
    AvatarIcon("ccp-6m", "Comedy Club Podcast - 6 months", "/avatars/ccp-6m.png", CCP, 6),
    AvatarIcon("ccp-1y", "Comedy Club Podcast - 1 year", "/avatars/ccp-1y.png", CCP, 12),
    AvatarIcon("ccp-2y", "Comedy Club Podcast - 2 years", "/avatars/ccp-2y.jpg", CCP, 24),
    AvatarIcon("ccp-3y", "Comedy Club Podcast - 3 years", "/avatars/ccp-3y.png", CCP, 36),
    AvatarIcon("ccp-4y", "Comedy Club Podcast - 4 years", "/avatars/ccp-4y.png", CCP, 48),
    # --- Ivan Kirkov ----------------------------------------------------------
    AvatarIcon("ik-starting", "Ivan Kirkov - new member", "/avatars/ik-starting.png", IVAN_KIRKOV, 0),
    AvatarIcon("ik-1m", "Ivan Kirkov - 1 month", "/avatars/ik-1m.png", IVAN_KIRKOV, 1),
    AvatarIcon("ik-2m", "Ivan Kirkov - 2 months", "/avatars/ik-2m.png", IVAN_KIRKOV, 2),
    # --- BFF с Пепи Кю --------------------------------------------------------
    # ⚠️ The 3-month and 6-month rungs reuse Ivan Kirkov's artwork (owner,
    # 2026-08-16: "this one which is the same for Ivan Kirkov but here it's 3m").
    # The files are COPIES (`pepi-3m.png`, `pepi-6m.png`) rather than references
    # to `ik-*`, so giving this channel its own art later is a file swap that
    # cannot accidentally change Ivan Kirkov's ladder too.
    AvatarIcon("pepi-starting", "BFF с Пепи Кю - new member", "/avatars/pepi-starting.jpg", BFF_PEPI, 0),
    AvatarIcon("pepi-1m", "BFF с Пепи Кю - 1 month", "/avatars/pepi-1m.jpg", BFF_PEPI, 1),
    AvatarIcon("pepi-3m", "BFF с Пепи Кю - 3 months", "/avatars/pepi-3m.png", BFF_PEPI, 3),
    AvatarIcon("pepi-6m", "BFF с Пепи Кю - 6 months", "/avatars/pepi-6m.png", BFF_PEPI, 6),
    # --- Дело 404 Crime Podcast -----------------------------------------------
    AvatarIcon("d404-starting", "Дело 404 - new member", "/avatars/d404-starting.png", DELO_404, 0),
    AvatarIcon("d404-1m", "Дело 404 - 1 month", "/avatars/d404-1m.png", DELO_404, 1),
    AvatarIcon("d404-2m", "Дело 404 - 2 months", "/avatars/d404-2m.png", DELO_404, 2),
    AvatarIcon("d404-6m", "Дело 404 - 6 months", "/avatars/d404-6m.png", DELO_404, 6),
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

    🚨 A channel-scoped icon needs a membership on THAT channel even at
    `min_months=0`: `.get(slug, 0) >= 0` would be true for everyone, so a
    "new member" icon would be free to people who have never joined. Absence is
    checked before the threshold.
    """
    if icon.channel_slug is None:
        return True
    if icon.channel_slug not in months_by_channel:
        return False
    return months_by_channel[icon.channel_slug] >= icon.min_months


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
