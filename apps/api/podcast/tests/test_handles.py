"""Validation for the self-chosen public handle.

🇧🇬 Cyrillic must pass. An ASCII-only rule would tell most of this audience
that their own name is invalid.
"""

import pytest

from podcast.services.handles import HandleError, clean_handle, normalize_handle


class TestNormalize:
    def test_strips_the_at_sign_and_whitespace(self):
        assert normalize_handle("  @Ivan_Petrov ") == "ivan_petrov"

    def test_casefolds_so_two_users_cannot_hold_the_same_name(self):
        assert normalize_handle("IVAN") == normalize_handle("ivan")

    def test_empty_becomes_none_not_empty_string(self):
        # 🚨 The column is unique. Postgres treats every NULL as distinct but
        # "" as a value, so a second user clearing their handle would collide.
        assert normalize_handle("") is None
        assert normalize_handle("   ") is None
        assert normalize_handle("@") is None
        assert normalize_handle(None) is None

    def test_normalises_fullwidth_lookalikes(self):
        # Without NFKC these are different rows that render identically.
        assert normalize_handle("ｉｖａｎ") == "ivan"


class TestValidate:
    @pytest.mark.parametrize(
        "value", ["ivan", "ivan_petrov", "ivan-petrov", "ivan.petrov", "иван", "иван_петров", "abc", "a1b2"]
    )
    def test_accepts_reasonable_handles(self, value):
        assert clean_handle(value) == value.casefold()

    @pytest.mark.parametrize("value", ["ab", "@ab"])
    def test_rejects_too_short(self, value):
        with pytest.raises(HandleError):
            clean_handle(value)

    def test_rejects_too_long(self):
        with pytest.raises(HandleError):
            clean_handle("i" * 31)

    @pytest.mark.parametrize("value", ["ivan petrov", "ivan!", "ivan/petrov", "iv@n", "ivan<script>"])
    def test_rejects_unsafe_characters(self, value):
        with pytest.raises(HandleError):
            clean_handle(value)

    @pytest.mark.parametrize("value", ["_ivan", "ivan_", ".ivan", "ivan-"])
    def test_rejects_leading_or_trailing_punctuation(self, value):
        with pytest.raises(HandleError):
            clean_handle(value)

    def test_rejects_a_nul_byte(self):
        # Legal in JSON, passes every length check, 500s inside psycopg.
        with pytest.raises(HandleError):
            clean_handle("iva\x00n")
