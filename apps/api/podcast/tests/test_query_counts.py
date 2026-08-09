"""Query-count regression guards.

🚨 The rule these enforce: **no endpoint's query count may scale with the number of
rows it returns.** Every test below runs the same endpoint twice, once over a small
dataset and once over a larger one, and asserts the count did not move.

That phrasing matters. Asserting an exact number is brittle and gets "fixed" by
bumping the constant, which is exactly how an N+1 gets re-introduced. Asserting
"same count, more rows" cannot be satisfied by a per-row query.

Real regressions this file would have caught (both live on 2026-08-09):
  - /api/search on the Postgres fallback issued 2 extra queries PER HIT while
    building `matched_topics` / `matched_moments`: 102 queries for a 50-hit page.
  - `episode_list_queryset()` now uses `.only()`. Reading any field outside
    `BRIEF_FIELDS` off a list row would silently become one lazy SELECT per row.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from podcast.models import Comment, Episode, Moment, Rating, WatchEvent
from podcast.services import topics as topic_service

from .conftest import auth_header, make_user

pytestmark = pytest.mark.django_db

BASE = "/api"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_episodes(channel, count: int, prefix: str = "ep") -> list[Episode]:
    return [
        Episode.objects.create(
            channel=channel,
            youtube_id=f"{prefix}{index:08d}",
            title=f"Епизод {prefix} {index}",
            description="Дълъг разговор за шахмат " * 8,
            duration_sec=1000 + index,
            public_score=float(index % 10) + 1,
            rating_count=index,
        )
        for index in range(count)
    ]


@pytest.fixture
def measure(client):
    """`measure(url)` -> query count for that GET, using the real connection."""
    from django.db import connection
    from django.test.utils import CaptureQueriesContext

    def _measure(url: str, headers: dict | None = None) -> int:
        client.get(url, **(headers or {}))  # warm any lazily-cached lookup
        with CaptureQueriesContext(connection) as ctx:
            response = client.get(url, **(headers or {}))
        assert response.status_code == 200, (url, response.status_code)
        return len(ctx.captured_queries)

    return _measure


@pytest.fixture
def no_meilisearch():
    """Force the Postgres fallback path, which is where the N+1 lived."""
    with patch("podcast.api.search._meilisearch_available", return_value=False):
        yield


# ---------------------------------------------------------------------------
# Episode lists
# ---------------------------------------------------------------------------


def test_episode_list_query_count_is_flat(measure, channel):
    make_episodes(channel, 3)
    few = measure(f"{BASE}/episodes?limit=50")

    make_episodes(channel, 30, prefix="more")
    many = measure(f"{BASE}/episodes?limit=50")

    assert many == few, f"episode list is N+1: {few} queries for 3 rows, {many} for 33"


@pytest.mark.parametrize("sort", ["newest", "oldest", "top", "top_elite", "most_rated", "longest"])
def test_every_sort_has_the_same_flat_query_count(measure, channel, sort):
    make_episodes(channel, 3)
    few = measure(f"{BASE}/episodes?limit=50&sort={sort}")

    make_episodes(channel, 30, prefix="more")
    assert measure(f"{BASE}/episodes?limit=50&sort={sort}") == few


def test_channel_filter_query_count_is_flat(measure, channel):
    make_episodes(channel, 3)
    few = measure(f"{BASE}/episodes?limit=50&channel={channel.slug}")

    make_episodes(channel, 30, prefix="more")
    assert measure(f"{BASE}/episodes?limit=50&channel={channel.slug}") == few


def test_unknown_channel_slug_still_returns_an_empty_page(client, channel):
    """The slug is resolved to an id before filtering - it must not start 404ing."""
    make_episodes(channel, 2)
    body = client.get(f"{BASE}/episodes?channel=no-such-channel").json()
    assert body["meta"]["total"] == 0
    assert body["items"] == []


def test_brief_serialization_touches_no_deferred_field(channel, django_assert_num_queries):
    """`episode_list_queryset()` defers everything outside BRIEF_FIELDS.

    Reading a deferred field would be one extra SELECT per row, which is the
    quietest N+1 there is - nothing in the response looks wrong.
    """
    from podcast.api.serializers import episode_brief, episode_list_queryset

    make_episodes(channel, 10)
    with django_assert_num_queries(1):
        for episode in episode_list_queryset():
            episode_brief(episode)


# ---------------------------------------------------------------------------
# Channels, topics, people
# ---------------------------------------------------------------------------


def test_channel_list_query_count_is_flat(measure, channel, other_channel):
    make_episodes(channel, 5)
    two = measure(f"{BASE}/channels")

    from podcast.models import Channel

    third = Channel.objects.create(youtube_channel_id="UCthird", name="Third Show")
    make_episodes(third, 5, prefix="third")
    assert measure(f"{BASE}/channels") == two, "episode_count is being counted per channel"


def test_person_detail_query_count_is_flat(measure, channel):
    from podcast.models import EpisodeParticipant, Person

    person = Person.objects.create(name="Иван Кирков")
    episodes = make_episodes(channel, 3)
    for episode in episodes:
        EpisodeParticipant.objects.create(episode=episode, person=person)
    few = measure(f"{BASE}/people/{person.slug}")

    for episode in make_episodes(channel, 20, prefix="more"):
        EpisodeParticipant.objects.create(episode=episode, person=person)
    assert measure(f"{BASE}/people/{person.slug}") == few


# ---------------------------------------------------------------------------
# Episode detail and its child collections
# ---------------------------------------------------------------------------


def test_episode_detail_query_count_is_flat(measure, episode, alice):
    for name in ("Шахмат", "Политика"):
        topic_service.add_topic_to_episode(episode, name, alice)
    few = measure(f"{BASE}/episodes/{episode.youtube_id}")

    for name in ("Спорт", "Музика", "История", "Наука"):
        topic_service.add_topic_to_episode(episode, name, alice)
    assert measure(f"{BASE}/episodes/{episode.youtube_id}") == few


def test_comment_list_query_count_is_flat(measure, episode, alice, bob):
    Comment.objects.create(user=alice, episode=episode, body="едно")
    few = measure(f"{BASE}/episodes/{episode.youtube_id}/comments")

    for index in range(20):
        Comment.objects.create(user=bob, episode=episode, body=f"коментар {index}")
    assert measure(f"{BASE}/episodes/{episode.youtube_id}/comments") == few, (
        "comment list loads the author per comment"
    )


def test_moment_list_query_count_is_flat(measure, episode, alice):
    Moment.objects.create(episode=episode, user=alice, timestamp_sec=10, label="начало")
    few = measure(f"{BASE}/episodes/{episode.youtube_id}/moments")

    for index in range(20):
        Moment.objects.create(
            episode=episode, user=alice, timestamp_sec=100 + index, label=f"момент {index}"
        )
    assert measure(f"{BASE}/episodes/{episode.youtube_id}/moments") == few


# ---------------------------------------------------------------------------
# Search  🚨 the endpoint that actually had the N+1
# ---------------------------------------------------------------------------


def test_postgres_search_query_count_is_flat(measure, channel, alice, no_meilisearch):
    """Was 2 + 2 per hit. A 50-hit page cost 102 queries and ~600ms."""
    episodes = make_episodes(channel, 3, prefix="sa")
    for episode in episodes:
        topic_service.add_topic_to_episode(episode, "Шахмат", alice)
        Moment.objects.create(
            episode=episode, user=alice, timestamp_sec=5, label="разговор за шахмат"
        )
    few = measure(f"{BASE}/search?q=разговор&limit=50")

    for episode in make_episodes(channel, 25, prefix="sb"):
        topic_service.add_topic_to_episode(episode, "Шахмат", alice)
        Moment.objects.create(
            episode=episode, user=alice, timestamp_sec=5, label="разговор за шахмат"
        )
    many = measure(f"{BASE}/search?q=разговор&limit=50")

    assert many == few, f"postgres search is N+1: {few} queries for 3 hits, {many} for 28"


def test_search_still_reports_why_each_episode_matched(client, channel, alice, no_meilisearch):
    """The prefetch must not change the answer, only the query count."""
    episode = make_episodes(channel, 1, prefix="sc")[0]
    topic_service.add_topic_to_episode(episode, "разговор за шахмат", alice)
    Moment.objects.create(
        episode=episode, user=alice, timestamp_sec=5, label="разговор започва"
    )

    hit = client.get(f"{BASE}/search?q=разговор").json()["hits"][0]
    assert "разговор за шахмат" in hit["matched_topics"]
    assert "разговор започва" in hit["matched_moments"]


# ---------------------------------------------------------------------------
# Leaderboards
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["top_rated", "top_elite", "most_rated"])
def test_leaderboard_query_count_is_flat(measure, channel, kind):
    for index, episode in enumerate(make_episodes(channel, 3, prefix="lb")):
        Episode.objects.filter(pk=episode.pk).update(
            public_score=9.0 - index, elite_score=8.0 - index,
            rating_count=5, elite_rating_count=5,
        )
    few = measure(f"{BASE}/leaderboards/{kind}")

    for episode in make_episodes(channel, 25, prefix="lc"):
        Episode.objects.filter(pk=episode.pk).update(
            public_score=7.0, elite_score=6.0, rating_count=5, elite_rating_count=5,
        )
    assert measure(f"{BASE}/leaderboards/{kind}") == few


# ---------------------------------------------------------------------------
# Authenticated lists
# ---------------------------------------------------------------------------


def test_my_lists_query_count_is_flat(measure, channel, db):
    user = make_user("counter")
    headers = auth_header("counter")

    for episode in make_episodes(channel, 3, prefix="ma"):
        Rating.objects.create(user=user, episode=episode, score=7)
        WatchEvent.objects.create(user=user, episode=episode)
    baseline = {
        path: measure(f"{BASE}/me/{path}?limit=50", headers)
        for path in ("ratings", "watched", "favorites")
    }

    for episode in make_episodes(channel, 25, prefix="mb"):
        Rating.objects.create(user=user, episode=episode, score=8)
        WatchEvent.objects.create(user=user, episode=episode)

    for path, expected in baseline.items():
        assert measure(f"{BASE}/me/{path}?limit=50", headers) == expected, path


def test_watch_history_query_count_is_flat(measure, episode, db):
    make_user("watcher")
    headers = auth_header("watcher")
    from django.contrib.auth.models import User

    user = User.objects.get(username="watcher")

    WatchEvent.objects.create(user=user, episode=episode)
    few = measure(f"{BASE}/episodes/{episode.youtube_id}/watch", headers)

    for _ in range(20):
        WatchEvent.objects.create(user=user, episode=episode)
    assert measure(f"{BASE}/episodes/{episode.youtube_id}/watch", headers) == few
