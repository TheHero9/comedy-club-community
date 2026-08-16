"""🔒 Guards on user input that ends up on a public page.

Pinned because every one of these is a check that is invisible when it works.
`avatar_url` and `display_name` were both written straight through until
2026-08-16, and nothing in the suite noticed - a `URLField` that Django never
validates on `save()` looks exactly like a validated one.
"""

from __future__ import annotations

import pytest

from podcast.services.display_names import DisplayNameError, clean_display_name
from podcast.services.links import LinkError, clean_avatar_url

BASE = "/api"


# ---------------------------------------------------------------------------
# Avatar URLs
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        "javascript:alert(1)",
        "data:text/html;base64,PHNjcmlwdD4=",
        "data:image/png;base64,iVBORw0KGgo=",
        "file:///etc/passwd",
        "//evil.example.com/pixel.gif",
        "not a url at all",
    ],
)
def test_only_http_urls_may_be_published(value):
    with pytest.raises(LinkError):
        clean_avatar_url(value)


@pytest.mark.parametrize(
    "value",
    [
        "https://yt3.googleusercontent.com/abc=s480-c-k-c0x00ffffff-no-rj",
        "http://example.com/a.png",
        # 🇧🇬 A Cyrillic path must survive - the audience is Bulgarian and a
        # guard that ate their URLs would be worse than no guard.
        "https://example.com/снимка.png",
    ],
)
def test_ordinary_image_urls_pass(value):
    assert clean_avatar_url(value) == value


def test_empty_avatar_is_valid_and_means_no_picture():
    assert clean_avatar_url("") == ""
    assert clean_avatar_url(None) == ""
    assert clean_avatar_url("   ") == ""


def test_avatar_url_longer_than_the_column_is_rejected_not_truncated():
    # Truncating would store a URL nobody chose, pointing somewhere real.
    with pytest.raises(LinkError):
        clean_avatar_url("https://example.com/" + "a" * 300)


# ---------------------------------------------------------------------------
# Display names
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        "admin", "Admin", "ADMIN", "  admin  ",
        "moderator", "Moderator", "staff", "support", "team", "owner",
        # 🇧🇬 The Bulgarian half matters as much as the English one: this UI is
        # bilingual and the audience reads these as authority.
        "админ", "Администратор", "модератор", "екип", "поддръжка",
        # NFKC: fullwidth renders identically to ASCII and must not slip past.
        "Ａdmin",
    ],
)
def test_names_that_claim_to_speak_for_the_site_are_rejected(value):
    with pytest.raises(DisplayNameError):
        clean_display_name(value)


@pytest.mark.parametrize(
    "value",
    [
        "Иван Петров",
        "Adminka",            # substring, not the reserved word
        "Модератора Петър",   # ditto - a real nickname
        "admin2",
        "Тонката",
    ],
)
def test_ordinary_names_are_untouched(value):
    assert clean_display_name(value) == value


def test_an_email_may_not_be_typed_in_as_a_name():
    # `humanize()` already refuses to DERIVE a name from an email, because the
    # same value is `author_name` on every public comment. Typing one by hand
    # publishes exactly the same thing.
    with pytest.raises(DisplayNameError):
        clean_display_name("ivan.petrov@gmail.com")


def test_a_clerk_id_may_not_be_typed_in_as_a_name():
    with pytest.raises(DisplayNameError):
        clean_display_name("user_33KqZabc123")


def test_empty_name_is_valid_and_means_use_my_provider_name():
    # 🚨 The sentinel that makes `display_name_is_custom` reversible.
    assert clean_display_name("") == ""
    assert clean_display_name("   ") == ""
    assert clean_display_name(None) == ""


def test_whitespace_is_collapsed_not_preserved():
    assert clean_display_name("  Иван    Петров  ") == "Иван Петров"


# ---------------------------------------------------------------------------
# End to end through the API
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_patch_me_rejects_a_reserved_name_with_422(client, alice, as_alice):
    response = client.patch(
        f"{BASE}/me",
        data={"display_name": "Админ"},
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 422, response.content


@pytest.mark.django_db
def test_patch_me_rejects_a_non_http_avatar_with_422(client, alice, as_alice):
    response = client.patch(
        f"{BASE}/me",
        data={"avatar_url": "javascript:alert(1)"},
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 422, response.content


@pytest.mark.django_db
def test_patch_me_still_accepts_an_ordinary_profile(client, alice, as_alice):
    response = client.patch(
        f"{BASE}/me",
        data={
            "display_name": "Иван Петров",
            "avatar_url": "https://example.com/ivan.png",
        },
        content_type="application/json",
        **as_alice,
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["display_name"] == "Иван Петров"
    assert body["avatar_url"] == "https://example.com/ivan.png"
