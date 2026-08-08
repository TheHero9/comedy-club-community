"""Model invariants, especially the scoring design.

🚨 The most important thing in this file: ONE Rating model, TWO derived numbers.
Verifying a user must make their EXISTING ratings count toward the elite score with
no data migration and no duplicate rows.
"""

import pytest
from django.contrib.auth.models import User
from django.db import IntegrityError

from podcast.models import Channel, ChannelMembership, Episode, Rating

pytestmark = pytest.mark.django_db


@pytest.fixture
def channel():
    return Channel.objects.create(youtube_channel_id="UCtest", name="Ivan Kirkov")


@pytest.fixture
def episode(channel):
    return Episode.objects.create(
        channel=channel, youtube_id="abc12345678", title="Тестов епизод"
    )


def _user(name):
    return User.objects.create_user(username=name)


def _verify(user, channel, verified=True):
    return ChannelMembership.objects.create(
        user=user, channel=channel, is_verified=verified
    )


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def test_scores_are_none_not_zero_when_unrated(episode):
    """NULL means 'no ratings yet'. Zero would rank an unrated episode as terrible."""
    assert episode.compute_public_score() is None
    assert episode.compute_elite_score() is None


def test_public_score_averages_every_rating(episode):
    for index, score in enumerate([10, 8, 6]):
        Rating.objects.create(user=_user(f"u{index}"), episode=episode, score=score)
    assert episode.compute_public_score() == pytest.approx(8.0)


def test_elite_score_counts_only_verified_members_of_that_channel(episode, channel):
    verified = _user("verified")
    _verify(verified, channel)
    Rating.objects.create(user=verified, episode=episode, score=10)

    outsider = _user("outsider")
    Rating.objects.create(user=outsider, episode=episode, score=2)

    assert episode.compute_public_score() == pytest.approx(6.0)
    assert episode.compute_elite_score() == pytest.approx(10.0)


def test_unverified_membership_does_not_count_toward_elite(episode, channel):
    user = _user("pending")
    _verify(user, channel, verified=False)
    Rating.objects.create(user=user, episode=episode, score=9)

    assert episode.compute_public_score() == pytest.approx(9.0)
    assert episode.compute_elite_score() is None


def test_membership_of_a_different_channel_does_not_count(episode):
    """Elite is per-channel: being verified elsewhere must not grant elite status here."""
    other = Channel.objects.create(youtube_channel_id="UCother", name="Other Show")
    user = _user("elsewhere")
    _verify(user, other)
    Rating.objects.create(user=user, episode=episode, score=10)

    assert episode.compute_elite_score() is None


def test_verifying_an_existing_rater_promotes_their_rating_with_no_migration(episode, channel):
    """🚨 The single most important behaviour in the scoring design."""
    user = _user("later_verified")
    Rating.objects.create(user=user, episode=episode, score=10)
    membership = _verify(user, channel, verified=False)

    assert episode.compute_elite_score() is None

    membership.is_verified = True
    membership.save()

    assert episode.compute_elite_score() == pytest.approx(10.0)
    assert Rating.objects.count() == 1  # no duplicate "elite vote" row


# ---------------------------------------------------------------------------
# Constraints
# ---------------------------------------------------------------------------


def test_a_user_cannot_rate_the_same_episode_twice(episode):
    user = _user("dup")
    Rating.objects.create(user=user, episode=episode, score=5)
    with pytest.raises(IntegrityError):
        Rating.objects.create(user=user, episode=episode, score=9)


def test_score_outside_1_to_10_is_rejected_at_the_database(episode):
    with pytest.raises(IntegrityError):
        Rating.objects.create(user=_user("bad"), episode=episode, score=11)


def test_a_user_cannot_join_the_same_channel_twice(channel):
    user = _user("joiner")
    ChannelMembership.objects.create(user=user, channel=channel)
    with pytest.raises(IntegrityError):
        ChannelMembership.objects.create(user=user, channel=channel)


def test_episode_slug_is_unique_within_a_channel(channel):
    Episode.objects.create(channel=channel, youtube_id="aaa11111111", title="Същото име")
    with pytest.raises(IntegrityError):
        Episode.objects.create(channel=channel, youtube_id="bbb22222222", title="Същото име")


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------


def test_members_only_stays_in_sync_with_availability(episode):
    episode.availability = Episode.Availability.SUBSCRIBER_ONLY
    episode.save()
    episode.refresh_from_db()
    assert episode.members_only is True

    episode.availability = Episode.Availability.PUBLIC
    episode.save()
    episode.refresh_from_db()
    assert episode.members_only is False


def test_watch_url_is_derived_when_url_is_blank(episode):
    assert episode.watch_url == "https://www.youtube.com/watch?v=abc12345678"
