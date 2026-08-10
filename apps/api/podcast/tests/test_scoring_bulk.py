"""`scoring.recompute_many` must be indistinguishable from looping `recompute_episode`.

🚨 Why this file exists: there are now TWO code paths that write
`public_score` / `elite_score` / `rating_count` / `elite_rating_count`. That is
exactly the setup where a definition drifts - someone tunes the per-write path,
the bulk sweep keeps the old arithmetic, and the numbers disagree depending on
which one ran last. Every test here compares the two against each other rather
than against a hardcoded number, so neither can be "fixed" alone.

The elite definition is the part most likely to break under a set-based rewrite:
the verified membership has to be for THAT EPISODE'S channel. A bulk query that
drops the channel join still passes any single-channel test.
"""

from __future__ import annotations

import pytest

from podcast.models import Episode, Rating
from podcast.services import scoring

from .conftest import make_user

pytestmark = pytest.mark.django_db

SCORE_FIELDS = ("public_score", "rating_count", "elite_score", "elite_rating_count")


def _snapshot(episodes) -> dict[int, tuple]:
    fresh = Episode.objects.filter(pk__in=[e.pk for e in episodes])
    return {e.pk: tuple(getattr(e, f) for f in SCORE_FIELDS) for e in fresh}


def _reset(episodes) -> None:
    """Wipe the denormalized columns so a recompute has to do real work.

    Without this, a bulk path that wrote nothing at all would pass by inheriting
    whatever the per-episode path left behind.
    """
    Episode.objects.filter(pk__in=[e.pk for e in episodes]).update(
        public_score=-1, elite_score=-1, rating_count=999, elite_rating_count=999
    )


@pytest.fixture
def mixed_catalogue(channel, other_channel, verify_membership):
    """Every shape that scoring has to get right, on two channels.

    - `unrated`       no ratings at all -> both scores stay NULL
    - `public_only`   rated only by unverified users -> elite NULL, public set
    - `mixed`         rated by both -> the two numbers differ
    - `cross`         on the OTHER channel, rated by someone verified HERE only
    """
    unrated = Episode.objects.create(
        channel=channel, youtube_id="bulk_unrated", title="Без оценки"
    )
    public_only = Episode.objects.create(
        channel=channel, youtube_id="bulk_public", title="Само публични"
    )
    mixed = Episode.objects.create(
        channel=channel, youtube_id="bulk_mixed", title="Смесени оценки"
    )
    cross = Episode.objects.create(
        channel=other_channel, youtube_id="bulk_cross", title="Друг канал"
    )

    verified = make_user("bulk_verified")
    also_verified = make_user("bulk_verified_2")
    plain = make_user("bulk_plain")
    verify_membership(verified, channel)
    verify_membership(also_verified, channel)
    # Present but NOT verified: a membership row alone must never count.
    verify_membership(plain, channel, verified=False)

    Rating.objects.create(user=plain, episode=public_only, score=4)
    Rating.objects.create(user=plain, episode=mixed, score=2)
    Rating.objects.create(user=verified, episode=mixed, score=9)
    Rating.objects.create(user=also_verified, episode=mixed, score=10)
    # Verified on `channel`, rating an episode of `other_channel`.
    Rating.objects.create(user=verified, episode=cross, score=8)

    return {
        "episodes": [unrated, public_only, mixed, cross],
        "unrated": unrated,
        "public_only": public_only,
        "mixed": mixed,
        "cross": cross,
    }


def test_recompute_many_matches_per_episode(mixed_catalogue):
    episodes = mixed_catalogue["episodes"]

    for episode in episodes:
        scoring.recompute_episode(episode)
    one_at_a_time = _snapshot(episodes)

    _reset(episodes)
    scoring.recompute_many([e.pk for e in episodes], reindex=False)

    assert _snapshot(episodes) == one_at_a_time


def test_bulk_elite_requires_membership_of_that_episodes_channel(mixed_catalogue):
    """The cross-channel case the F() join exists for."""
    _reset(mixed_catalogue["episodes"])
    scoring.recompute_many(reindex=False)

    cross = Episode.objects.get(pk=mixed_catalogue["cross"].pk)
    assert cross.public_score == 8.0
    assert cross.rating_count == 1
    # The rater is verified on the OTHER channel, so this must not be elite.
    assert cross.elite_score is None
    assert cross.elite_rating_count == 0


def test_bulk_separates_public_from_elite(mixed_catalogue):
    _reset(mixed_catalogue["episodes"])
    scoring.recompute_many(reindex=False)

    mixed = Episode.objects.get(pk=mixed_catalogue["mixed"].pk)
    assert mixed.public_score == pytest.approx(7.0)  # (2 + 9 + 10) / 3
    assert mixed.rating_count == 3
    assert mixed.elite_score == pytest.approx(9.5)  # (9 + 10) / 2
    assert mixed.elite_rating_count == 2

    public_only = Episode.objects.get(pk=mixed_catalogue["public_only"].pk)
    assert public_only.public_score == 4.0
    assert public_only.elite_score is None
    assert public_only.elite_rating_count == 0


def test_bulk_writes_null_for_an_episode_with_no_ratings(mixed_catalogue):
    """NULL is not zero, and an unrated episode must be WRITTEN, not skipped."""
    _reset(mixed_catalogue["episodes"])
    scoring.recompute_many(reindex=False)

    unrated = Episode.objects.get(pk=mixed_catalogue["unrated"].pk)
    assert unrated.public_score is None
    assert unrated.elite_score is None
    assert unrated.rating_count == 0
    assert unrated.elite_rating_count == 0


def test_bulk_clears_scores_when_the_last_rating_is_deleted(mixed_catalogue):
    mixed = mixed_catalogue["mixed"]
    scoring.recompute_many([mixed.pk], reindex=False)
    assert Episode.objects.get(pk=mixed.pk).public_score is not None

    Rating.objects.filter(episode=mixed).delete()
    scoring.recompute_many([mixed.pk], reindex=False)

    refreshed = Episode.objects.get(pk=mixed.pk)
    assert refreshed.public_score is None
    assert refreshed.rating_count == 0


def test_bulk_reindex_false_queues_nothing(mixed_catalogue, monkeypatch):
    """A thousand-episode load must not queue a thousand single-document tasks."""
    calls: list[int] = []
    monkeypatch.setattr(
        "podcast.services.indexing.schedule_episode_reindex",
        lambda episode_or_id: calls.append(episode_or_id),
    )

    scoring.recompute_many(reindex=False)
    assert calls == []

    scoring.recompute_many([mixed_catalogue["mixed"].pk], reindex=True)
    assert calls == [mixed_catalogue["mixed"].pk]


def test_bulk_with_an_empty_id_list_is_a_no_op(mixed_catalogue):
    """An empty list means "no episodes", never "all episodes"."""
    scoring.recompute_many([m.pk for m in mixed_catalogue["episodes"]], reindex=False)
    before = _snapshot(mixed_catalogue["episodes"])

    assert scoring.recompute_many([], reindex=False) == 0
    assert _snapshot(mixed_catalogue["episodes"]) == before
