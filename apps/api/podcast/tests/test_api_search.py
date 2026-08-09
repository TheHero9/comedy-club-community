"""The /search endpoint and its Postgres fallback.

These tests never touch a live Meilisearch - `_meilisearch_available` is patched.
The search module's own behaviour is covered in test_search.py.
"""

import json
from unittest.mock import patch

import pytest

from podcast.models import Comment, Episode, Moment
from podcast.services import topics as topic_service

pytestmark = pytest.mark.django_db

BASE = "/api"


@pytest.fixture
def no_meilisearch():
    """Force the Postgres fallback path."""
    with patch("podcast.api.search._meilisearch_available", return_value=False):
        yield


# ---------------------------------------------------------------------------
# Basics
# ---------------------------------------------------------------------------


def test_search_is_public(client, episode, no_meilisearch):
    assert client.get(f"{BASE}/search?q=test").status_code == 200


def test_empty_query_returns_empty_without_scanning(client, episode, no_meilisearch):
    body = client.get(f"{BASE}/search?q=").json()
    assert body["total"] == 0
    assert body["hits"] == []


def test_whitespace_only_query_is_treated_as_empty(client, episode, no_meilisearch):
    assert client.get(f"{BASE}/search?q=%20%20").json()["total"] == 0


def test_response_names_the_backend_that_answered(client, episode, no_meilisearch):
    """A degraded search must be visible, not silently worse."""
    assert client.get(f"{BASE}/search?q=Каспаров").json()["backend"] == "postgres"


# ---------------------------------------------------------------------------
# 🇧🇬 Cyrillic
# ---------------------------------------------------------------------------


def test_cyrillic_title_search_works_in_postgres(client, episode, no_meilisearch):
    body = client.get(f"{BASE}/search?q=Каспаров").json()
    assert body["total"] == 1
    assert body["hits"][0]["episode"]["youtube_id"] == episode.youtube_id


def test_cyrillic_search_is_case_insensitive(client, episode, no_meilisearch):
    assert client.get(f"{BASE}/search?q=каспаров").json()["total"] == 1
    assert client.get(f"{BASE}/search?q=КАСПАРОВ").json()["total"] == 1


def test_search_finds_by_description(client, episode, no_meilisearch):
    assert client.get(f"{BASE}/search?q=шахмат").json()["total"] == 1


# ---------------------------------------------------------------------------
# 🎯 The point of the product: community labels make episodes findable
# ---------------------------------------------------------------------------


def test_search_finds_an_episode_by_a_community_topic_label(
    client, episode, alice, no_meilisearch
):
    """The label text appears NOWHERE in the title or description.

    This is what stands in for transcription: these channels have no chapters and
    near-empty descriptions.
    """
    topic_service.add_topic_to_episode(episode, "Кулинария", alice)

    body = client.get(f"{BASE}/search?q=Кулинария").json()

    assert body["total"] == 1
    assert body["hits"][0]["matched_topics"] == ["Кулинария"]


def test_search_finds_an_episode_by_a_community_moment_label(
    client, episode, alice, no_meilisearch
):
    Moment.objects.create(
        episode=episode, user=alice, timestamp_sec=1200, label="Счупеният хладилник"
    )

    body = client.get(f"{BASE}/search?q=хладилник").json()

    assert body["total"] == 1
    assert body["hits"][0]["matched_moments"] == ["Счупеният хладилник"]


def test_search_finds_by_channel_name(client, episode, no_meilisearch):
    assert client.get(f"{BASE}/search?q=Ivan").json()["total"] == 1


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------


def test_members_only_filter_applies_to_search(
    client, episode, members_only_episode, no_meilisearch
):
    all_hits = client.get(f"{BASE}/search?q=Ivan").json()["total"]
    filtered = client.get(f"{BASE}/search?q=Ivan&members_only=true").json()["total"]
    assert filtered < all_hits
    assert filtered == 1


def test_kind_filter_applies_to_search(client, episode, stream_episode, no_meilisearch):
    assert client.get(f"{BASE}/search?q=Ivan&kind=stream").json()["total"] == 1


def test_channel_filter_applies_to_search(client, episode, other_channel, no_meilisearch):
    Episode.objects.create(channel=other_channel, youtube_id="oth000000001", title="Ivan Друго")
    body = client.get(f"{BASE}/search?q=Ivan&channel={episode.channel.slug}").json()
    assert body["total"] == 1


def test_results_are_deduplicated_across_joins(client, episode, alice, no_meilisearch):
    """Matching on several joined rows must not return the episode several times."""
    for label in ("Тест едно", "Тест две", "Тест три"):
        Moment.objects.create(episode=episode, user=alice, timestamp_sec=10, label=label)

    body = client.get(f"{BASE}/search?q=Тест").json()
    assert body["total"] == 1
    assert len(body["hits"]) == 1


# ---------------------------------------------------------------------------
# Fallback behaviour
# ---------------------------------------------------------------------------


def test_falls_back_to_postgres_when_meilisearch_raises(client, episode):
    """A search backend failure must degrade, never 500."""
    with patch("podcast.api.search._meilisearch_available", return_value=True), patch(
        "podcast.api.search._meilisearch_search", side_effect=RuntimeError("boom")
    ):
        body = client.get(f"{BASE}/search?q=Каспаров").json()

    assert body["backend"] == "postgres"
    assert body["total"] == 1


def test_an_empty_index_does_not_hide_results_that_postgres_can_find(client, episode):
    """🚨 A reachable but EMPTY index answers everything with zero, which looks
    identical to 'nothing matches' and makes search appear broken."""
    empty = {
        "query": "Каспаров", "hits": [], "total": 0, "limit": 20, "offset": 0,
        "backend": "meilisearch", "processing_ms": 1,
    }
    with patch("podcast.api.search._meilisearch_available", return_value=True), patch(
        "podcast.api.search._meilisearch_search", return_value=empty
    ):
        body = client.get(f"{BASE}/search?q=Каспаров").json()

    assert body["backend"] == "postgres"
    assert body["total"] == 1


def test_a_genuine_no_match_stays_a_no_match(client, episode):
    """The fallback must not invent results when nothing matches anywhere."""
    empty = {
        "query": "zzz", "hits": [], "total": 0, "limit": 20, "offset": 0,
        "backend": "meilisearch", "processing_ms": 1,
    }
    with patch("podcast.api.search._meilisearch_available", return_value=True), patch(
        "podcast.api.search._meilisearch_search", return_value=empty
    ):
        body = client.get(f"{BASE}/search?q=zzzznothing").json()

    assert body["total"] == 0
    assert body["backend"] == "meilisearch"


# ---------------------------------------------------------------------------
# Privacy
# ---------------------------------------------------------------------------


def test_search_never_matches_a_private_personal_tag(
    client, episode, alice, no_meilisearch
):
    """🔒 Personal tags are private. They must not be searchable by anyone else,
    and must not leak into a public response."""
    from podcast.models import PersonalTag

    PersonalTag.objects.create(user=alice, episode=episode, text="таенетикет")

    response = client.get(f"{BASE}/search?q=таенетикет")
    payload = response.json()
    assert payload["total"] == 0
    assert payload["hits"] == []

    # The tag must not appear ANYWHERE except the query echo, which is just the
    # caller's own input handed back and reveals nothing they did not send.
    #
    # This used to assert against the raw body. That was weaker than it looked:
    # the API escaped Cyrillic as \uXXXX, so a raw substring check for Bulgarian
    # text could never match and the assertion was vacuously true. The API now
    # emits real UTF-8, so this check finally bites.
    payload.pop("query")
    assert "таенетикет" not in json.dumps(payload, ensure_ascii=False)


def test_search_does_not_match_hidden_comment_text(client, episode, alice, no_meilisearch):
    Comment.objects.create(
        user=alice, episode=episode, body="скритоключово", is_hidden=True
    )
    assert client.get(f"{BASE}/search?q=скритоключово").json()["total"] == 0


# ---------------------------------------------------------------------------
# Suggest
# ---------------------------------------------------------------------------


def test_suggest_needs_at_least_two_characters(client, episode):
    assert client.get(f"{BASE}/search/suggest?q=a").json() == []


def test_suggest_returns_matching_titles(client, episode):
    assert "Историята на Каспаров" in client.get(f"{BASE}/search/suggest?q=Каспаров").json()
