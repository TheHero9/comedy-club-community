"""Season-grid ratings matrix (the IMDb / SeriesGraph style heatmap).

🎬 A podcast has no seasons, so **one calendar year = one season**. Columns are
years, rows are the episode's position within that year, oldest first - so reading
down a column walks the year in order, and reading across a row compares the same
point in different years.

The score BAND is computed here rather than in the frontend so web and a future
mobile app can never disagree about what "Great" means. The band is a semantic key;
mapping it to a colour is the component's job.
"""

from __future__ import annotations

from dataclasses import dataclass

from podcast.models import Episode

# Ordered high to low. First match wins.
# Thresholds are on the 1-10 scale and deliberately generous at the top: a 9+
# average from a real audience is rare and should feel rare.
SCORE_BANDS: tuple[tuple[float, str, str], ...] = (
    (9.5, "masterpiece", "Absolute cinema"),
    (8.5, "awesome", "Awesome"),
    (7.5, "great", "Great"),
    (6.5, "good", "Good"),
    (5.5, "regular", "Regular"),
    (4.0, "bad", "Bad"),
    (0.0, "garbage", "Garbage"),
)

# 🚨 A single enthusiastic 10 is not a masterpiece. Below this many ratings the cell
# still shows its score but is flagged provisional, so the grid cannot be gamed by
# one person rating one episode.
MIN_RATINGS_FOR_CONFIDENT_BAND = 3


def score_band(score: float | None) -> str | None:
    """Semantic band key for a score, or None when unrated.

    ⚠️ None is NOT zero. An unrated episode must never render as "garbage".
    """
    if score is None:
        return None
    for threshold, key, _label in SCORE_BANDS:
        if score >= threshold:
            return key
    return "garbage"


def band_label(key: str | None) -> str:
    if key is None:
        return "Not rated"
    for _threshold, band_key, label in SCORE_BANDS:
        if band_key == key:
            return label
    return "Not rated"


@dataclass
class GridCell:
    episode: Episode
    score: float | None
    count: int


def _cell(episode: Episode, score_kind: str) -> dict:
    if score_kind == "elite":
        score, count = episode.elite_score, episode.elite_rating_count
    else:
        score, count = episode.public_score, episode.rating_count

    band = score_band(score)
    return {
        "youtube_id": episode.youtube_id,
        "slug": episode.slug,
        "title": episode.title,
        "upload_date": episode.upload_date,
        "duration_sec": episode.duration_sec,
        "thumbnail_url": episode.thumbnail_url,
        "content_kind": episode.content_kind,
        "members_only": episode.members_only,
        # One decimal, IMDb style. Banding uses the FULL precision above, so a
        # 7.449 that displays as 7.4 is still banded on its true value.
        "score": round(score, 1) if score is not None else None,
        "rating_count": count,
        "band": band,
        # Shown but flagged: too few ratings to trust the band.
        "is_provisional": bool(
            score is not None and count < MIN_RATINGS_FOR_CONFIDENT_BAND
        ),
    }


def build_grid(channel, *, score_kind: str = "public") -> dict:
    """Build the full season grid for one channel.

    ONE query for every episode. Never call this per row.
    """
    if score_kind not in {"public", "elite"}:
        raise ValueError("score_kind must be 'public' or 'elite'")

    episodes = list(
        Episode.objects.filter(channel=channel)
        .exclude(upload_date=None)
        .order_by("upload_date", "id")
    )

    # Group by year, preserving chronological order within each year.
    by_year: dict[int, list[Episode]] = {}
    for episode in episodes:
        by_year.setdefault(episode.upload_date.year, []).append(episode)

    years = sorted(by_year)
    seasons = []
    for year in years:
        year_episodes = by_year[year]
        scores = [
            e.elite_score if score_kind == "elite" else e.public_score
            for e in year_episodes
        ]
        rated = [s for s in scores if s is not None]
        seasons.append(
            {
                "year": year,
                "label": str(year),
                "episode_count": len(year_episodes),
                "rated_count": len(rated),
                "average": round(sum(rated) / len(rated), 2) if rated else None,
            }
        )

    # Rows are positions within a season. The tallest season sets the row count;
    # shorter seasons get None cells, which the UI renders as empty, not as zero.
    height = max((len(by_year[year]) for year in years), default=0)
    rows = []
    for index in range(height):
        cells = []
        for year in years:
            year_episodes = by_year[year]
            cells.append(
                _cell(year_episodes[index], score_kind) if index < len(year_episodes) else None
            )
        rows.append({"index": index + 1, "cells": cells})

    all_scores = [
        e.elite_score if score_kind == "elite" else e.public_score for e in episodes
    ]
    rated_scores = [s for s in all_scores if s is not None]

    return {
        "channel_name": channel.name,
        "channel_slug": channel.slug,
        "score_kind": score_kind,
        "seasons": seasons,
        "rows": rows,
        "overall_average": (
            round(sum(rated_scores) / len(rated_scores), 2) if rated_scores else None
        ),
        "rated_count": len(rated_scores),
        "total_count": len(episodes),
        "bands": [
            {"key": key, "label": label, "min_score": threshold}
            for threshold, key, label in SCORE_BANDS
        ],
    }
