"""Public endpoints: browsable logged out, no private data, no N+1."""

import pytest

from podcast.models import Episode

pytestmark = pytest.mark.django_db

BASE = "/api"


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


def test_episodes_are_browsable_without_auth(client, episode):
    """This is a content site. Anonymous access is the whole point."""
    response = client.get(f"{BASE}/episodes")
    assert response.status_code == 200
    assert response.json()["meta"]["total"] == 1


def test_channels_are_browsable_without_auth(client, channel):
    assert client.get(f"{BASE}/channels").status_code == 200


def test_episode_detail_is_public(client, episode):
    response = client.get(f"{BASE}/episodes/{episode.youtube_id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Историята на Каспаров"


def test_unknown_episode_404s(client, db):
    assert client.get(f"{BASE}/episodes/doesnotexist").status_code == 404


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------


def test_members_only_filter(client, episode, members_only_episode):
    response = client.get(f"{BASE}/episodes?members_only=true")
    assert response.json()["meta"]["total"] == 1


def test_kind_filter_separates_streams(client, episode, stream_episode):
    assert client.get(f"{BASE}/episodes?kind=stream").json()["meta"]["total"] == 1
    assert client.get(f"{BASE}/episodes?kind=video").json()["meta"]["total"] == 1


def test_channel_filter(client, episode, other_channel):
    Episode.objects.create(
        channel=other_channel, youtube_id="other0000001", title="Друго"
    )
    response = client.get(f"{BASE}/episodes?channel={episode.channel.slug}")
    assert response.json()["meta"]["total"] == 1


def test_cyrillic_text_filter(client, episode):
    """🇧🇬 Filtering must work in Bulgarian, not just ASCII."""
    assert client.get(f"{BASE}/episodes?q=Каспаров").json()["meta"]["total"] == 1


# ---------------------------------------------------------------------------
# Sorting - the NULL trap
# ---------------------------------------------------------------------------


def test_unrated_episodes_sort_last_not_first_on_top_rated(client, channel):
    """🚨 NULL score means 'unrated', not 'terrible'.

    Postgres sorts NULLs FIRST on DESC, so without nulls_last the 'top rated' board
    would be led by episodes nobody has rated.
    """
    rated = Episode.objects.create(
        channel=channel, youtube_id="rated0000001", title="Оценен", public_score=7.5
    )
    Episode.objects.create(channel=channel, youtube_id="unrated00001", title="Неоценен")

    items = client.get(f"{BASE}/episodes?sort=top").json()["items"]
    assert items[0]["youtube_id"] == rated.youtube_id


def test_pagination_is_stable_and_reports_has_more(client, channel):
    for index in range(5):
        Episode.objects.create(
            channel=channel, youtube_id=f"ep{index:011d}", title=f"Епизод {index}"
        )

    first = client.get(f"{BASE}/episodes?limit=2&offset=0").json()
    second = client.get(f"{BASE}/episodes?limit=2&offset=2").json()

    assert first["meta"]["has_more"] is True
    assert first["meta"]["total"] == 5
    first_ids = {item["id"] for item in first["items"]}
    second_ids = {item["id"] for item in second["items"]}
    assert not (first_ids & second_ids), "pages must not overlap"


def test_limit_is_capped(client, episode):
    """An uncapped limit is a free denial-of-service."""
    assert client.get(f"{BASE}/episodes?limit=100000").status_code == 422


# ---------------------------------------------------------------------------
# Route ordering regression
# ---------------------------------------------------------------------------


def test_topics_suggest_is_not_shadowed_by_the_slug_route(client, db):
    """🚨 Regression: /topics/{slug} was declared first and swallowed
    /topics/suggest, resolving it as slug='suggest' and returning 404."""
    response = client.get(f"{BASE}/topics/suggest?q=пол")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


# ---------------------------------------------------------------------------
# Query efficiency
# ---------------------------------------------------------------------------


def test_episode_list_does_not_n_plus_one(client, channel, django_assert_max_num_queries):
    """20 episodes must not mean 20 channel lookups."""
    for index in range(20):
        Episode.objects.create(
            channel=channel, youtube_id=f"nq{index:010d}", title=f"Епизод {index}"
        )

    with django_assert_max_num_queries(4):
        response = client.get(f"{BASE}/episodes?limit=20")
    assert len(response.json()["items"]) == 20


def test_episode_detail_does_not_n_plus_one(client, episode, django_assert_max_num_queries):
    with django_assert_max_num_queries(6):
        client.get(f"{BASE}/episodes/{episode.youtube_id}")


# ---------------------------------------------------------------------------
# Privacy
# ---------------------------------------------------------------------------


def test_public_episode_payload_leaks_no_private_fields(client, episode, alice):
    """🔒 Personal tags are private. They must never appear on a public endpoint."""
    from podcast.models import PersonalTag

    PersonalTag.objects.create(user=alice, episode=episode, text="секретен-етикет")

    body = client.get(f"{BASE}/episodes/{episode.youtube_id}").content.decode()
    assert "секретен-етикет" not in body


def test_hidden_comments_are_not_returned(client, episode, alice):
    from podcast.models import Comment

    Comment.objects.create(user=alice, episode=episode, body="скрит", is_hidden=True)
    Comment.objects.create(user=alice, episode=episode, body="видим")

    items = client.get(f"{BASE}/episodes/{episode.youtube_id}/comments").json()["items"]
    assert len(items) == 1
    assert items[0]["body"] == "видим"
