"""Slug helpers.

🇧🇬 Every slug in this project can originate from Bulgarian text. Django's default
`slugify` strips non-ASCII, which turns "Историята на Каспаров" into an EMPTY string.
Always go through `bg_slugify`, never `django.utils.text.slugify` directly.
"""

import uuid

from django.utils.text import slugify


def bg_slugify(value: str, max_length: int | None = None) -> str:
    """Unicode-preserving slug with a guaranteed non-empty result.

    Falls back to a short random suffix when the input slugifies to nothing at all
    (e.g. a title made entirely of emoji or punctuation), so a slug is never blank.
    """
    slug = slugify(value or "", allow_unicode=True)

    if not slug:
        slug = f"item-{uuid.uuid4().hex[:8]}"

    if max_length and len(slug) > max_length:
        slug = slug[:max_length].rstrip("-")

    return slug
