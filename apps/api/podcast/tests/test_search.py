"""Meilisearch layer tests.

🚨 No live Meilisearch required. The client is mocked everywhere, because a test
suite that needs a search server is a test suite that gets skipped.

The two things most likely to be got wrong and therefore pinned hardest:
1. Document building must not N+1 - a 1,000 episode reindex would be 3,001
   queries.
2. Meilisearch being down must never raise into a web request.
"""

from datetime import date
from unittest.mock import MagicMock

import pytest
from django.contrib.auth.models import User
from meilisearch.errors import MeilisearchCommunicationError

from podcast.models import (
    Channel,
    Episode,
    EpisodeParticipant,
    EpisodeTopic,
    Moment,
    Person,
    Topic,
)
from podcast.search import client as search_client
from podcast.search import documents as search_documents
from podcast.search import index as search_index

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_search_client():
    """The client and its health flag are process-wide. Never leak between tests."""
    search_client.reset_client()
    yield
    search_client.reset_client()


@pytest.fixture
def channel():
    return Channel.objects.create(
        youtube_channel_id="UCBy9yfnAqjC1gofLFJ8kMlw",
        handle="@ivankirkov1",
        name="Иван Кирков",
    )


@pytest.fixture
def episode(channel):
    return Episode.objects.create(
        channel=channel,
        youtube_id="abc12345678",
        title="Интервю с известен български комик",
        description="Разговор за комедията в България.",
        upload_date=date(2026, 3, 14),
        duration_sec=5432,
        availability=Episode.Availability.SUBSCRIBER_ONLY,
        content_kind=Episode.ContentKind.STREAM,
        public_score=8.5,
        elite_score=9.0,
        rating_count=12,
        elite_rating_count=3,
        view_count=None,
        language="bg",
    )


@pytest.fixture
def labelled_episode(episode):
    """An episode carrying the community labels that are the point of the feature."""
    user = User.objects.create_user(username="labeller")
    topic = Topic.objects.create(name="Политика")
    EpisodeTopic.objects.create(episode=episode, topic=topic, added_by=user, score=5)
    Moment.objects.create(
        episode=episode, user=user, timestamp_sec=930, label="Разказва за първия си концерт"
    )
    person = Person.objects.create(name="Иван Кирков")
    EpisodeParticipant.objects.create(
        episode=episode, person=person, role=EpisodeParticipant.Role.HOST
    )
    return episode


def _mock_index(monkeypatch):
    """Swap the whole client for a mock and hand back the index mock."""
    index = MagicMock(name="index")
    client = MagicMock(name="client")
    client.index.return_value = index
    monkeypatch.setattr(search_client, "get_client", lambda: client)
    monkeypatch.setattr(search_client, "_health", None)
    return index


def _unreachable(monkeypatch):
    """Make every call behave as if Meilisearch is not running."""

    def boom(*args, **kwargs):
        raise MeilisearchCommunicationError("Connection refused")

    monkeypatch.setattr(search_client, "get_client", boom)


# ---------------------------------------------------------------------------
# Document building
# ---------------------------------------------------------------------------


def test_document_carries_every_searchable_source(labelled_episode):
    doc = search_documents.build_document(
        search_documents.episode_index_queryset().get(pk=labelled_episode.pk)
    )

    assert doc["id"] == labelled_episode.pk
    assert doc["title"] == "Интервю с известен български комик"
    assert doc["description"] == "Разговор за комедията в България."
    assert doc["channel_name"] == "Иван Кирков"
    assert doc["topics"] == ["Политика"]
    assert doc["moments"] == ["Разказва за първия си концерт"]
    assert doc["participants"] == ["Иван Кирков"]


def test_document_preserves_cyrillic_verbatim(labelled_episode):
    """🇧🇬 Nothing may lowercase, slugify or transliterate the indexed text."""
    doc = search_documents.build_document(
        search_documents.episode_index_queryset().get(pk=labelled_episode.pk)
    )

    for value in (doc["title"], doc["channel_name"], doc["topics"][0], doc["moments"][0]):
        assert value == value.strip()
        assert any("Ѐ" <= ch <= "ӿ" for ch in value), value
    # Capitals survive: "Интервю" must not come back as "интервю".
    assert doc["title"].startswith("И")
    assert doc["topics"] == ["Политика"]


def test_upload_date_is_a_unix_timestamp_for_sorting(episode):
    doc = search_documents.build_document(episode)

    # Meilisearch has no date type - sortable dates have to be numbers.
    assert doc["upload_date"] == 1_773_446_400  # 2026-03-14T00:00:00Z
    assert isinstance(doc["upload_date"], int)
    assert doc["upload_date_iso"] == "2026-03-14"
    assert doc["upload_year"] == 2026


def test_missing_upload_date_does_not_break_the_document(channel):
    naked = Episode.objects.create(channel=channel, youtube_id="no_date_01", title="Без дата")

    doc = search_documents.build_document(naked)

    assert doc["upload_date"] is None
    assert doc["upload_date_iso"] is None
    assert doc["topics"] == []
    assert doc["moments"] == []
    assert doc["participants"] == []


def test_document_exposes_the_facet_and_sort_attributes(episode):
    doc = search_documents.build_document(episode)

    assert doc["channel_slug"] == episode.channel.slug
    assert doc["content_kind"] == "stream"
    assert doc["members_only"] is True
    assert doc["duration_sec"] == 5432
    assert doc["public_score"] == 8.5
    assert doc["elite_score"] == 9.0
    # ⚠️ NULL on members-only episodes. Must survive as None, not become 0.
    assert doc["view_count"] is None


def test_every_declared_filterable_and_sortable_attribute_exists(labelled_episode):
    doc = search_documents.build_document(labelled_episode)

    missing = [f for f in search_index.FILTERABLE_ATTRIBUTES if f not in doc]
    assert missing == [], f"filterable attributes absent from the document: {missing}"

    missing = [f for f in search_index.SORTABLE_ATTRIBUTES if f not in doc]
    assert missing == [], f"sortable attributes absent from the document: {missing}"

    missing = [f for f in search_index.SEARCHABLE_ATTRIBUTES if f not in doc]
    assert missing == [], f"searchable attributes absent from the document: {missing}"


def test_building_documents_does_not_n_plus_one(channel, django_assert_num_queries):
    """⚡ The one that matters: query count must not grow with episode count."""
    user = User.objects.create_user(username="labeller")
    for i in range(5):
        ep = Episode.objects.create(channel=channel, youtube_id=f"yt{i:09d}", title=f"Епизод {i}")
        topic = Topic.objects.create(name=f"Тема {i}")
        EpisodeTopic.objects.create(episode=ep, topic=topic, added_by=user)
        Moment.objects.create(episode=ep, user=user, timestamp_sec=60, label=f"Момент {i}")
        person = Person.objects.create(name=f"Гост {i}")
        EpisodeParticipant.objects.create(episode=ep, person=person)

    queryset = search_documents.episode_index_queryset()

    # 1 for the episodes (channel is select_related) + 1 per prefetched relation.
    with django_assert_num_queries(4):
        docs = search_documents.build_documents(queryset)

    assert len(docs) == 5
    assert all(doc["topics"] and doc["moments"] and doc["participants"] for doc in docs)


# ---------------------------------------------------------------------------
# Index settings
# ---------------------------------------------------------------------------


def test_searchable_attributes_are_in_priority_order():
    searchable = search_index.SEARCHABLE_ATTRIBUTES

    assert searchable[0] == "title"
    # Community labels beat the raw YouTube description - that is the feature.
    assert searchable.index("topics") < searchable.index("description")
    assert searchable.index("moments") < searchable.index("description")
    assert searchable[-1] == "description"


def test_index_settings_are_bulgarian_aware():
    settings_payload = search_index.INDEX_SETTINGS

    assert settings_payload["localizedAttributes"] == [
        {"attributePatterns": ["*"], "locales": ["bul"]}
    ]
    assert all(any("Ѐ" <= ch <= "ӿ" for ch in word) for word in settings_payload["stopWords"])
    assert "и" in settings_payload["stopWords"]
    assert "подкаст" in settings_payload["synonyms"]["podcast"]
    # Overriding separator tokens would split "по-добър" wrongly. Stay default.
    assert "separatorTokens" not in settings_payload
    assert "nonSeparatorTokens" not in settings_payload


def test_typo_tolerance_thresholds_are_expressed_in_bytes():
    """🚨 `minWordSizeForTypos` counts BYTES, and Cyrillic is 2 bytes per char.

    This test previously asserted `oneTypo <= 4` believing the unit was
    characters. It was passing while the index actually allowed one typo from 2
    Bulgarian characters and two typos from 4 - which made the query "пица"
    (8 bytes) match "пича", "пичаги" and "пичове". Measured 2026-08-09: 95 of
    100 hits were false, and the behaviour flipped exactly at a threshold of 9,
    the query's byte length.

    The invariant is therefore stated in characters and converted, so a future
    edit cannot silently reintroduce the character/byte confusion.
    """
    typo = search_index.TYPO_TOLERANCE
    one = typo["minWordSizeForTypos"]["oneTypo"]
    two = typo["minWordSizeForTypos"]["twoTypos"]

    assert typo["enabled"] is True
    assert one < two

    one_chars = one / search_index.BYTES_PER_CYRILLIC_CHAR
    two_chars = two / search_index.BYTES_PER_CYRILLIC_CHAR

    # Still looser than Meilisearch's English-tuned default of 5/9 CHARACTERS...
    assert one_chars <= 4, "Bulgarian needs typo tolerance below the 5-character default"
    # ...but not so loose that a short word reaches an unrelated one.
    assert one_chars >= 3, (
        "One typo on a word shorter than 3 characters matches unrelated words - "
        "this is the bug that made 'пица' match 'пичове'"
    )
    assert two_chars >= 6, "Two typos below 6 characters is not a typo, it is a different word"

    # An id or a slug must never be typo-corrected into a different record.
    assert "youtube_id" in typo["disableOnAttributes"]


def test_ranking_rules_keep_the_defaults_and_add_tie_breakers():
    rules = search_index.RANKING_RULES

    assert rules[:6] == ["words", "typo", "proximity", "attribute", "sort", "exactness"]
    assert rules[6:] == ["public_score:desc", "upload_date:desc"]
    for custom in rules[6:]:
        assert custom.split(":")[0] in search_index.SORTABLE_ATTRIBUTES


def test_filter_values_are_escaped():
    assert search_index.escape_filter_value("иван") == '"иван"'
    assert search_index.escape_filter_value(True) == "true"
    assert search_index.escape_filter_value(7) == "7"
    # 🔒 A quote in user input must not close the filter expression.
    assert search_index.escape_filter_value('a" OR members_only = true') == (
        '"a\\" OR members_only = true"'
    )


def test_build_filter_combines_facets():
    filters = search_index.build_filter(
        channel_slug=["иван-кирков", "друг"],
        content_kind="stream",
        members_only=False,
        min_public_score=7.0,
        uploaded_after=1_700_000_000,
    )

    assert ['channel_slug = "иван-кирков"', 'channel_slug = "друг"'] in filters
    assert 'content_kind = "stream"' in filters
    assert "members_only = false" in filters
    assert "public_score >= 7.0" in filters
    assert "upload_date >= 1700000000" in filters
    assert search_index.build_filter() == []


# ---------------------------------------------------------------------------
# Writes against a mocked client
# ---------------------------------------------------------------------------


def test_index_episode_sends_the_document(monkeypatch, labelled_episode):
    index = _mock_index(monkeypatch)

    assert search_index.index_episode(labelled_episode) is True

    (documents,) = index.add_documents.call_args.args
    assert documents[0]["id"] == labelled_episode.pk
    assert documents[0]["topics"] == ["Политика"]
    assert index.add_documents.call_args.kwargs["primary_key"] == "id"


def test_index_episode_accepts_a_primary_key(monkeypatch, labelled_episode):
    index = _mock_index(monkeypatch)

    assert search_index.index_episode(labelled_episode.pk) is True

    (documents,) = index.add_documents.call_args.args
    assert documents[0]["youtube_id"] == labelled_episode.youtube_id


def test_index_episode_removes_a_deleted_episode(monkeypatch, channel):
    """A Celery task can fire after the row is gone. Delete, do not explode."""
    index = _mock_index(monkeypatch)

    assert search_index.index_episode(999_999) is True

    index.delete_document.assert_called_once_with(999_999)
    index.add_documents.assert_not_called()


def test_index_episodes_batches(monkeypatch, channel):
    index = _mock_index(monkeypatch)
    for i in range(5):
        Episode.objects.create(channel=channel, youtube_id=f"batch{i:06d}", title=f"Епизод {i}")

    sent = search_index.index_episodes(Episode.objects.all(), batch_size=2)

    assert sent == 5
    assert index.add_documents.call_count == 3  # 2 + 2 + 1


def test_remove_episode_deletes_the_document(monkeypatch):
    index = _mock_index(monkeypatch)

    assert search_index.remove_episode(42) is True

    index.delete_document.assert_called_once_with(42)


def test_search_normalises_the_meilisearch_response(monkeypatch):
    index = _mock_index(monkeypatch)
    index.search.return_value = {
        "hits": [{"id": 1, "title": "Епизод"}],
        "query": "комик",
        "processingTimeMs": 3,
        "limit": 20,
        "offset": 0,
        "estimatedTotalHits": 1,
        "facetDistribution": {"channel_slug": {"иван-кирков": 1}},
    }

    result = search_index.search("комик", facets=["channel_slug"], limit=20)

    assert result["available"] is True
    assert result["hits"][0]["title"] == "Епизод"
    assert result["estimated_total_hits"] == 1
    assert result["processing_time_ms"] == 3
    assert result["facet_distribution"] == {"channel_slug": {"иван-кирков": 1}}
    passed_query, passed_params = index.search.call_args.args
    assert passed_query == "комик"
    assert passed_params["facets"] == ["channel_slug"]


# ---------------------------------------------------------------------------
# Graceful degradation - Meilisearch is down
# ---------------------------------------------------------------------------


def test_is_available_is_false_when_meilisearch_is_down(monkeypatch):
    _unreachable(monkeypatch)

    assert search_client.is_available() is False


def test_is_available_caches_the_health_check(monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(search_client, "get_client", lambda: client)

    assert search_client.is_available() is True
    assert search_client.is_available() is True

    client.health.assert_called_once()


def test_writes_no_op_when_meilisearch_is_down(monkeypatch, labelled_episode):
    """🚨 A search outage must never become a 500."""
    _unreachable(monkeypatch)

    assert search_index.index_episode(labelled_episode) is False
    assert search_index.index_episodes(Episode.objects.all()) == 0
    assert search_index.remove_episode(labelled_episode.pk) is False


def test_search_returns_an_empty_unavailable_result_when_down(monkeypatch):
    _unreachable(monkeypatch)

    result = search_index.search("комик", limit=10, offset=5)

    assert result["hits"] == []
    assert result["estimated_total_hits"] == 0
    assert result["limit"] == 10
    assert result["offset"] == 5
    # The API layer reads this flag to fall back to Postgres full-text search.
    assert result["available"] is False


def test_strict_mode_raises_so_a_celery_task_can_retry(monkeypatch, labelled_episode):
    _unreachable(monkeypatch)

    with pytest.raises(MeilisearchCommunicationError):
        search_index.index_episode(labelled_episode, strict=True)

    with pytest.raises(MeilisearchCommunicationError):
        search_index.rebuild_all()


def test_stats_returns_none_when_down(monkeypatch):
    _unreachable(monkeypatch)

    assert search_index.stats() is None
