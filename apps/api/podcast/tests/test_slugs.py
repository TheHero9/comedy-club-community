"""🇧🇬 Slug behaviour.

The canonical models.py used django.utils.text.slugify, which STRIPS Cyrillic and
returns "" for every Bulgarian title. That would have collapsed the per-channel slug
uniqueness constraint on the very first backfill. These tests pin the fix.
"""

import pytest

from podcast.slugs import bg_slugify


def test_bulgarian_title_survives_slugify():
    slug = bg_slugify("Историята на Каспаров срещу най-големия му противник")
    assert slug == "историята-на-каспаров-срещу-най-големия-му-противник"


def test_bulgarian_title_is_not_empty():
    """The exact failure mode of the default slugify."""
    assert bg_slugify("Мъж или жена професионален") != ""


def test_ascii_title_still_works():
    assert bg_slugify("The Best Episode Ever") == "the-best-episode-ever"


def test_mixed_script_title():
    assert bg_slugify("Podcast с Иван") == "podcast-с-иван"


@pytest.mark.parametrize("value", ["", "   ", "!!!", "???", "---"])
def test_unsluggable_input_still_yields_something(value):
    """A slug is never blank - blank slugs would collide under the unique constraint."""
    slug = bg_slugify(value)
    assert slug
    assert slug.startswith("item-")


def test_max_length_is_respected_and_not_left_dangling():
    slug = bg_slugify("Историята на Каспаров срещу най-големия му противник", max_length=20)
    assert len(slug) <= 20
    assert not slug.endswith("-")
