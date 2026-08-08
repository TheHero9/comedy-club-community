"""🎬 The season-ratings grid (IMDb / SeriesGraph style heatmap).

One calendar year = one season. Columns are years, rows are the episode's position
within that year.
"""

import datetime as dt

import pytest

from podcast.models import Episode
from podcast.services.grid import (
    MIN_RATINGS_FOR_CONFIDENT_BAND,
    band_label,
    build_grid,
    score_band,
)

pytestmark = pytest.mark.django_db

BASE = "/api"


def _episode(channel, youtube_id, title, year, month=1, day=1, **kwargs):
    return Episode.objects.create(
        channel=channel,
        youtube_id=youtube_id,
        title=title,
        upload_date=dt.date(year, month, day),
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Banding
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "score,expected",
    [
        (10.0, "masterpiece"),
        (9.5, "masterpiece"),
        (9.4, "awesome"),
        (8.5, "awesome"),
        (8.0, "great"),
        (7.5, "great"),
        (7.0, "good"),
        (6.5, "good"),
        (6.0, "regular"),
        (5.5, "regular"),
        (5.0, "bad"),
        (4.0, "bad"),
        (3.9, "garbage"),
        (1.0, "garbage"),
    ],
)
def test_score_bands(score, expected):
    assert score_band(score) == expected


def test_an_unrated_episode_has_no_band_and_is_not_garbage():
    """🚨 NULL is not zero. An unrated episode must not render as the worst band."""
    assert score_band(None) is None
    assert band_label(None) == "Not rated"


def test_band_labels_are_human_readable():
    assert band_label("masterpiece") == "Absolute cinema"
    assert band_label("great") == "Great"


# ---------------------------------------------------------------------------
# Layout
# ---------------------------------------------------------------------------


def test_years_become_seasons_in_chronological_order(channel):
    _episode(channel, "y2026aaaaaaa", "Нов", 2026)
    _episode(channel, "y2024aaaaaaa", "Стар", 2024)
    _episode(channel, "y2025aaaaaaa", "Среден", 2025)

    grid = build_grid(channel)

    assert [s["year"] for s in grid["seasons"]] == [2024, 2025, 2026]


def test_rows_are_positions_within_a_season_oldest_first(channel):
    _episode(channel, "a00000000001", "Първи", 2025, 1, 5)
    _episode(channel, "a00000000002", "Втори", 2025, 6, 5)
    _episode(channel, "a00000000003", "Трети", 2025, 12, 5)

    grid = build_grid(channel)

    titles = [row["cells"][0]["title"] for row in grid["rows"]]
    assert titles == ["Първи", "Втори", "Трети"]


def test_shorter_seasons_get_none_cells_not_zeros(channel):
    """🚨 A missing episode must render as EMPTY, never as a zero score."""
    _episode(channel, "s2024aaaaaaa", "2024 един", 2024)
    _episode(channel, "s2025aaaaaaa", "2025 един", 2025)
    _episode(channel, "s2025bbbbbbb", "2025 два", 2025, 6)

    grid = build_grid(channel)

    assert len(grid["rows"]) == 2  # tallest season sets the height
    assert grid["rows"][1]["cells"][0] is None  # 2024 has no second episode
    assert grid["rows"][1]["cells"][1]["title"] == "2025 два"


def test_grid_height_is_the_tallest_season(channel):
    for index in range(5):
        _episode(channel, f"h2025{index:07d}", f"Епизод {index}", 2025, index + 1)
    _episode(channel, "h2026aaaaaaa", "Само един", 2026)

    grid = build_grid(channel)

    assert len(grid["rows"]) == 5
    assert len(grid["rows"][0]["cells"]) == 2  # one cell per season


def test_episodes_without_an_upload_date_are_excluded(channel):
    """They cannot be placed in a season, and a fake year would be a lie."""
    _episode(channel, "d2025aaaaaaa", "С дата", 2025)
    Episode.objects.create(channel=channel, youtube_id="nodateaaaaaa", title="Без дата")

    grid = build_grid(channel)

    assert grid["total_count"] == 1


def test_an_empty_channel_produces_an_empty_grid_not_a_crash(channel):
    grid = build_grid(channel)

    assert grid["rows"] == []
    assert grid["seasons"] == []
    assert grid["overall_average"] is None


# ---------------------------------------------------------------------------
# Scores
# ---------------------------------------------------------------------------


def test_season_average_ignores_unrated_episodes(channel):
    _episode(channel, "v2025aaaaaaa", "Оценен", 2025, 1, public_score=8.0, rating_count=5)
    _episode(channel, "v2025bbbbbbb", "Неоценен", 2025, 2)

    grid = build_grid(channel)

    # 8.0, not 4.0 - the unrated episode is absent, not a zero.
    assert grid["seasons"][0]["average"] == 8.0
    assert grid["seasons"][0]["rated_count"] == 1
    assert grid["seasons"][0]["episode_count"] == 2


def test_scores_are_rounded_to_one_decimal_for_display(channel):
    _episode(channel, "r2025aaaaaaa", "Точен", 2025, public_score=7.14285, rating_count=7)

    cell = build_grid(channel)["rows"][0]["cells"][0]

    assert cell["score"] == 7.1


def test_banding_uses_full_precision_not_the_rounded_display(channel):
    """7.449 displays as 7.4 but must band on its true value, not on 7.5."""
    _episode(channel, "p2025aaaaaaa", "Гранично", 2025, public_score=7.449, rating_count=9)

    cell = build_grid(channel)["rows"][0]["cells"][0]

    assert cell["score"] == 7.4
    assert cell["band"] == "good"  # not "great"


def test_elite_mode_uses_the_elite_score(channel):
    _episode(
        channel, "e2025aaaaaaa", "Двойно", 2025,
        public_score=6.0, rating_count=10, elite_score=9.0, elite_rating_count=4,
    )

    public = build_grid(channel, score_kind="public")["rows"][0]["cells"][0]
    elite = build_grid(channel, score_kind="elite")["rows"][0]["cells"][0]

    assert public["score"] == 6.0 and public["band"] == "regular"
    assert elite["score"] == 9.0 and elite["band"] == "awesome"


def test_an_invalid_score_kind_is_rejected(channel):
    with pytest.raises(ValueError):
        build_grid(channel, score_kind="nonsense")


# ---------------------------------------------------------------------------
# Provisional flag
# ---------------------------------------------------------------------------


def test_a_thinly_rated_episode_is_flagged_provisional(channel):
    """🚨 One enthusiastic 10 must not silently read as a masterpiece."""
    _episode(
        channel, "t2025aaaaaaa", "Една оценка", 2025,
        public_score=10.0, rating_count=1,
    )

    cell = build_grid(channel)["rows"][0]["cells"][0]

    assert cell["band"] == "masterpiece"
    assert cell["is_provisional"] is True


def test_a_well_rated_episode_is_not_provisional(channel):
    _episode(
        channel, "w2025aaaaaaa", "Много оценки", 2025,
        public_score=8.0, rating_count=MIN_RATINGS_FOR_CONFIDENT_BAND,
    )

    assert build_grid(channel)["rows"][0]["cells"][0]["is_provisional"] is False


def test_an_unrated_cell_is_not_provisional(channel):
    _episode(channel, "u2025aaaaaaa", "Неоценен", 2025)

    cell = build_grid(channel)["rows"][0]["cells"][0]

    assert cell["score"] is None
    assert cell["is_provisional"] is False


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


def test_grid_endpoint_is_public(client, channel):
    _episode(channel, "g2025aaaaaaa", "Публичен", 2025, public_score=7.0, rating_count=4)
    assert client.get(f"{BASE}/channels/{channel.slug}/grid").status_code == 200


def test_grid_route_is_not_shadowed_by_the_channel_slug_route(client, channel):
    """🚨 Regression: /channels/{slug} declared first would resolve
    /channels/x/grid as slug='x' plus a stray segment."""
    _episode(channel, "g2025bbbbbbb", "Тест", 2025)
    response = client.get(f"{BASE}/channels/{channel.slug}/grid")

    assert response.status_code == 200
    assert "seasons" in response.json()


def test_grid_endpoint_supports_elite_mode(client, channel):
    _episode(
        channel, "g2025cccccc1", "Елит", 2025,
        public_score=5.0, rating_count=8, elite_score=9.0, elite_rating_count=3,
    )
    body = client.get(f"{BASE}/channels/{channel.slug}/grid?score=elite").json()

    assert body["score_kind"] == "elite"
    assert body["rows"][0]["cells"][0]["score"] == 9.0


def test_grid_endpoint_rejects_a_bad_score_kind(client, channel):
    _episode(channel, "g2025ddddddd", "Тест", 2025)
    assert client.get(f"{BASE}/channels/{channel.slug}/grid?score=xxx").status_code == 422


def test_grid_endpoint_404s_for_an_unknown_channel(client, db):
    assert client.get(f"{BASE}/channels/nope/grid").status_code == 404


def test_grid_ships_the_band_legend(client, channel):
    """The frontend maps band keys to colours; it must not hardcode thresholds."""
    _episode(channel, "g2025eeeeeee", "Тест", 2025)
    bands = client.get(f"{BASE}/channels/{channel.slug}/grid").json()["bands"]

    assert [b["key"] for b in bands][0] == "masterpiece"
    assert len(bands) == 7


def test_grid_is_one_query_regardless_of_size(client, channel, django_assert_max_num_queries):
    for index in range(30):
        _episode(
            channel, f"q2025{index:07d}", f"Епизод {index}", 2025,
            (index % 12) + 1, public_score=7.0, rating_count=3,
        )

    with django_assert_max_num_queries(3):
        client.get(f"{BASE}/channels/{channel.slug}/grid")
