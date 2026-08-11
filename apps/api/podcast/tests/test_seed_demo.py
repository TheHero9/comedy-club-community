"""`seed_demo --clear` must be the EXACT inverse of `seed_demo`.

The command exists to make every page in the app show realistic Bulgarian data,
and its whole safety story is that a run is fully reversible. A row it creates
but does not remove is a permanent leak into a database that also holds the real
ingested episodes.

🚨 The dangerous one is `Report`. Its `reporter` is `on_delete=SET_NULL` and its
target is a `GenericForeignKey`, so NEITHER deleting the demo users NOR deleting
the reported comments removes a Report row. Left to the cascade, `--clear` would
strand every report as an ownerless row pointing at a primary key that no longer
exists - and the moderation queue renders those fine, because `_report_out`
never dereferences the target. The leak would stay invisible until the ids got
reused by unrelated rows, at which point the queue would show real moderators
real reports against the wrong content.
"""

from __future__ import annotations

import pytest
from django.contrib.auth.models import User
from django.core.management import call_command

from podcast.models import (
    Channel,
    ChannelMembership,
    Comment,
    Episode,
    EpisodeTopic,
    Favorite,
    Moment,
    Person,
    PersonalTag,
    Rating,
    Report,
    Topic,
    WatchEvent,
)

pytestmark = pytest.mark.django_db

# Everything the seeder writes. If a model is added to the command it must be
# added here too, or the round-trip test silently stops covering it.
SEEDED_MODELS = [
    Rating,
    Comment,
    Moment,
    Favorite,
    WatchEvent,
    ChannelMembership,
    PersonalTag,
    Report,
    EpisodeTopic,
    Topic,
    Person,
]


@pytest.fixture
def seedable(settings, channel):
    """A catalogue big enough for the seeder's random sampling to produce rows."""
    settings.DEBUG = True  # the command refuses to run otherwise
    for index in range(40):
        Episode.objects.create(
            channel=channel,
            youtube_id=f"seedvid{index:05d}",
            title=f"Епизод номер {index}",
            duration_sec=1800 + index,
        )
    return channel


def counts() -> dict:
    return {model.__name__: model.objects.count() for model in SEEDED_MODELS}


def test_seeding_populates_every_model_it_claims_to(seedable):
    call_command("seed_demo", "--seed", "7")

    after = counts()
    empty = [name for name, n in after.items() if n == 0]

    assert not empty, (
        f"seed_demo left these models empty: {empty}. A page backed by one of "
        f"them renders as if the feature does not exist."
    )


def test_personal_tags_are_seeded_and_belong_to_demo_users(seedable):
    """🔒 /me/tags had no data at all until 2026-08-11."""
    call_command("seed_demo", "--seed", "7")

    assert PersonalTag.objects.exists()
    assert not PersonalTag.objects.exclude(user__username__startswith="demo_").exists()


def test_reports_cover_every_reportable_type_and_status(seedable):
    """A queue seeded pending-only never exercises the resolved/dismissed filters."""
    call_command("seed_demo", "--seed", "7")

    statuses = set(Report.objects.values_list("status", flat=True))
    assert statuses == {"pending", "resolved", "dismissed"}, (
        f"seeded report statuses were {statuses}"
    )

    types = set(Report.objects.values_list("content_type__model", flat=True))
    assert types == {"comment", "moment", "episodetopic", "rating"}, (
        f"seeded report target types were {types}"
    )


def test_resolved_reports_carry_a_moderator_and_a_note(seedable):
    call_command("seed_demo", "--seed", "7")

    handled = Report.objects.exclude(status="pending")
    assert handled.exists()
    assert not handled.filter(resolved_by__isnull=True).exists()
    assert not handled.filter(resolution_note="").exists()
    assert not Report.objects.filter(status="pending").exclude(
        resolved_by__isnull=True
    ).exists(), "a pending report must not already have a resolver"


def test_clear_is_the_exact_inverse(seedable):
    before = counts()
    assert all(n == 0 for n in before.values()), "fixture is not clean"

    call_command("seed_demo", "--seed", "7")
    assert any(n > 0 for n in counts().values())

    call_command("seed_demo", "--clear")

    after = counts()
    leaked = {name: n for name, n in after.items() if n != 0}

    assert not leaked, f"--clear left rows behind: {leaked}"


def test_clear_leaves_no_orphaned_reports(seedable):
    """🚨 The specific bug: SET_NULL + GenericForeignKey means no cascade."""
    call_command("seed_demo", "--seed", "7")
    assert Report.objects.exists()

    call_command("seed_demo", "--clear")

    assert Report.objects.count() == 0
    assert not Report.objects.filter(reporter__isnull=True).exists()


def test_clear_does_not_touch_the_real_episodes(seedable):
    """Episodes come from the real backfill and are not the seeder's to delete."""
    episode_ids = set(Episode.objects.values_list("id", flat=True))
    channel_ids = set(Channel.objects.values_list("id", flat=True))

    call_command("seed_demo", "--seed", "7")
    call_command("seed_demo", "--clear")

    assert set(Episode.objects.values_list("id", flat=True)) == episode_ids
    assert set(Channel.objects.values_list("id", flat=True)) == channel_ids


def test_clear_resets_denormalized_scores(seedable):
    """Deleting every rating must reset the scores, not leave the last value."""
    call_command("seed_demo", "--seed", "7")
    assert Episode.objects.filter(public_score__isnull=False).exists()

    call_command("seed_demo", "--clear")

    assert not Episode.objects.filter(public_score__isnull=False).exists()
    assert not Episode.objects.filter(elite_score__isnull=False).exists()
    assert not Episode.objects.exclude(rating_count=0).exists()


def test_seeding_twice_is_idempotent(seedable):
    """A second run must add nothing, so re-seeding is safe."""
    call_command("seed_demo", "--seed", "7")
    first = counts()

    call_command("seed_demo", "--seed", "7")
    second = counts()

    assert second == first, (
        f"a second identical run changed the data: "
        f"{ {k: (first[k], second[k]) for k in first if first[k] != second[k]} }"
    )


def test_it_refuses_to_run_with_debug_off(settings, seedable):
    """DEV ONLY. This is the guard against seeding a production database."""
    from django.core.management.base import CommandError

    settings.DEBUG = False
    with pytest.raises(CommandError, match="DEV ONLY"):
        call_command("seed_demo")

    assert not User.objects.filter(username__startswith="demo_").exists()
