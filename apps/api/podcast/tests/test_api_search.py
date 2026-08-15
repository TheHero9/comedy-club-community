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


def test_suggest_returns_matching_titles(client, episode, no_meilisearch):
    """The Postgres fallback path, which is what runs with the index down."""
    assert "Историята на Каспаров" in client.get(f"{BASE}/search/suggest?q=Каспаров").json()


def test_suggest_rejects_a_query_that_tokenizes_to_nothing(client, episode):
    """🚨 `???` is a placeholder search to Meilisearch - it would answer with the
    whole catalogue's titles. Same rule the two search endpoints apply."""
    assert client.get(f"{BASE}/search/suggest?q=???").json() == []


def _meili_hits(*episode_ids):
    return {"available": True, "hits": [{"id": eid} for eid in episode_ids]}


def test_suggest_reads_titles_from_postgres_not_the_index(client, episode):
    """🚨 Meilisearch supplies the ORDER; Postgres supplies the text.

    The index is eventually consistent, so a renamed episode keeps answering
    with its old title until the next reindex. A suggestion is a string the user
    is about to search for, and a stale one sends them to a zero-result page.
    """
    with patch("podcast.api.search._meilisearch_available", return_value=True), patch(
        "podcast.search.index.search",
        return_value={
            "available": True,
            # The stale title the index would have handed back on its own.
            "hits": [{"id": episode.id, "title": "Старо заглавие"}],
        },
    ):
        body = client.get(f"{BASE}/search/suggest?q=Каспаров").json()

    assert body == [episode.title]
    assert "Старо заглавие" not in body


def test_suggest_preserves_meilisearch_relevance_order(client, episode, stream_episode):
    """Postgres is read with `id__in`, whose row order is arbitrary. The ranking
    has to survive that re-read or the best completion stops being first.

    🚨 The ranking asked for is deliberately the REVERSE of the order Postgres
    hands back for the same ids. Asserting an order Postgres would have produced
    anyway proves nothing - an earlier version of this test did exactly that and
    still passed against code that dropped the ranking entirely.
    """
    ids = [episode.id, stream_episode.id]
    natural = list(Episode.objects.filter(id__in=ids).values_list("id", flat=True))
    ranked = list(reversed(natural))
    assert ranked != natural, "fixture ids collided - the test cannot discriminate"

    by_id = {episode.id: episode.title, stream_episode.id: stream_episode.title}

    with patch("podcast.api.search._meilisearch_available", return_value=True), patch(
        "podcast.search.index.search", return_value=_meili_hits(*ranked)
    ):
        body = client.get(f"{BASE}/search/suggest?q=подкаст").json()

    assert body == [by_id[episode_id] for episode_id in ranked]
    assert body != [by_id[episode_id] for episode_id in natural]


def test_suggest_drops_an_indexed_but_deleted_episode(client, episode):
    """A stale document is not a 500 and not a suggestion - it is dropped."""
    missing = episode.id + 10_000
    with patch("podcast.api.search._meilisearch_available", return_value=True), patch(
        "podcast.search.index.search",
        return_value=_meili_hits(missing, episode.id),
    ):
        assert client.get(f"{BASE}/search/suggest?q=Каспаров").json() == [episode.title]


def test_suggest_falls_back_to_postgres_when_the_index_is_empty(client, episode):
    """An empty or stale index answers every keystroke with nothing, which reads
    as "no such episode". Confirm against Postgres before believing it."""
    with patch("podcast.api.search._meilisearch_available", return_value=True), patch(
        "podcast.search.index.search", return_value=_meili_hits()
    ):
        assert client.get(f"{BASE}/search/suggest?q=Каспаров").json() == [episode.title]


def test_suggest_falls_back_to_postgres_when_meilisearch_raises(client, episode):
    with patch("podcast.api.search._meilisearch_available", return_value=True), patch(
        "podcast.search.index.search", side_effect=RuntimeError("boom")
    ):
        assert client.get(f"{BASE}/search/suggest?q=Каспаров").json() == [episode.title]
