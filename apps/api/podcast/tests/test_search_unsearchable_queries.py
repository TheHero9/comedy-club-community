"""🚨 A query that TOKENIZES to nothing must not return the whole catalogue.

Found 2026-08-11. `/search?q=???` was non-empty after `.strip()`, so it reached
Meilisearch - which tokenizes "???" to nothing, treats that as a PLACEHOLDER
search, and answers with every document. The endpoint reported **1,393 episodes
as matches for "???"**.

Returning everything is the worst possible failure mode for a search box,
because it looks like a working feature rather than a broken one. It is also
exactly the symptom CLAUDE.md documents for Cyrillic mangled by a shell (every
letter becomes "?"), so an API that answers it honestly is what keeps that
diagnosis readable.

The endpoint has always held that an EMPTY query returns 0 hits rather than
everything. `has_searchable_text` extends that same rule to a query that is
empty as far as a tokenizer is concerned.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from podcast.api.search import has_searchable_text

pytestmark = pytest.mark.django_db

BASE = "/api"


@pytest.fixture
def no_meilisearch():
    with patch("podcast.api.search._meilisearch_available", return_value=False):
        yield


# ---------------------------------------------------------------------------
# The predicate
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "query",
    [
        "???",
        "...",
        "!!!",
        "---",
        "   ",
        "",
        "?!.,;:",
        # Escaped rather than literal: `tests/copy.spec.ts` fails the build on a
        # U+2014 or U+2013 anywhere in the repo, and this file is in the repo.
        "\u2014\u2013",  # em dash + en dash
        "***",
    ],
)
def test_queries_with_no_alphanumeric_content_are_unsearchable(query):
    assert has_searchable_text(query) is False, f"{query!r} should be unsearchable"


@pytest.mark.parametrize(
    "query",
    [
        "Каспаров",  # 🇧🇬 Cyrillic must count as searchable
        "пица",
        "евровизия?",  # punctuation ALONGSIDE text is still a real query
        "2024",  # a bare number is a legitimate search
        "C++",
        "a",
        "подкаст!!!",
        "Иван Кирков",
    ],
)
def test_queries_containing_any_alphanumeric_are_searchable(query):
    assert has_searchable_text(query) is True, f"{query!r} should be searchable"


# ---------------------------------------------------------------------------
# The endpoints
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("query", ["???", "...", "!!!", "?!.,"])
def test_punctuation_only_search_returns_nothing_not_everything(
    client, episode, stream_episode, members_only_episode, no_meilisearch, query
):
    body = client.get(f"{BASE}/search", {"q": query}).json()

    assert body["total"] == 0, (
        f"q={query!r} returned {body['total']} hits. A query that tokenizes to "
        f"nothing must not be answered with the catalogue."
    )
    assert body["hits"] == []


def test_the_episodes_that_would_have_been_returned_do_exist(
    client, episode, stream_episode, members_only_episode, no_meilisearch
):
    """🚨 Guards the test above against passing vacuously.

    If the fixtures were empty, "q=??? returns 0 hits" would pass while proving
    nothing at all. A real query must find something first.
    """
    body = client.get(f"{BASE}/search", {"q": "Каспаров"}).json()
    assert body["total"] > 0, "fixture episodes are not searchable - the guard is blind"


@pytest.mark.parametrize("query", ["???", "..."])
def test_the_query_is_echoed_back_verbatim(client, episode, no_meilisearch, query):
    """The caller must be able to see WHAT was searched for.

    Echoing the query is how the "Cyrillic became ????????" diagnosis in
    CLAUDE.md is made. Silently rewriting it to "" would hide that.
    """
    assert client.get(f"{BASE}/search", {"q": query}).json()["query"] == query


@pytest.mark.parametrize("query", ["???", "...", "!!!"])
def test_transcript_search_applies_the_same_rule(client, episode, query):
    """Two search endpoints must not disagree about what unsearchable means."""
    body = client.get(f"{BASE}/search/transcripts", {"q": query}).json()

    assert body["total_segments"] == 0
    assert body["hits"] == []


def test_a_real_query_still_reaches_the_backend(client, episode, no_meilisearch):
    """The guard must not short-circuit legitimate searches."""
    body = client.get(f"{BASE}/search", {"q": "Каспаров"}).json()

    assert body["total"] >= 1
    assert body["backend"] == "postgres"
