"""Shared fixtures.

Auth in tests uses the `dev` backend: `Authorization: Bearer dev:<username>`.
Everything is written against the abstract "actor" contract, so the same tests pass
unchanged once AUTH_BACKEND flips to clerk.
"""

import pytest
from django.contrib.auth.models import User

from podcast.models import Channel, ChannelMembership, Episode, UserProfile


@pytest.fixture
def channel(db):
    return Channel.objects.create(
        youtube_channel_id="UCBy9yfnAqjC1gofLFJ8kMlw",
        name="Ivan Kirkov",
        handle="@ivankirkov1",
    )


@pytest.fixture
def other_channel(db):
    return Channel.objects.create(youtube_channel_id="UCother", name="Other Show")


@pytest.fixture
def episode(channel):
    return Episode.objects.create(
        channel=channel,
        youtube_id="KaZG3h2if_0",
        title="Историята на Каспаров",
        description="Дълъг разговор за шахмат",
        duration_sec=3935,
        language="bg",
    )


@pytest.fixture
def members_only_episode(channel):
    return Episode.objects.create(
        channel=channel,
        youtube_id="DOfxozuk_ck",
        title="Само за членове",
        availability=Episode.Availability.SUBSCRIBER_ONLY,
        duration_sec=1200,
    )


@pytest.fixture
def stream_episode(channel):
    return Episode.objects.create(
        channel=channel,
        youtube_id="streamAAAAAA",
        title="На живо",
        content_kind=Episode.ContentKind.STREAM,
        duration_sec=7200,
    )


def make_user(username: str, role: str = UserProfile.Role.MEMBER) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@dev.local")
    UserProfile.objects.create(
        user=user,
        clerk_user_id=f"dev_{username}",
        display_name=username,
        role=role,
    )
    return user


def auth_header(username: str) -> dict:
    """Header the dev auth backend accepts."""
    return {"HTTP_AUTHORIZATION": f"Bearer dev:{username}"}


@pytest.fixture
def alice(db):
    return make_user("alice")


@pytest.fixture
def bob(db):
    return make_user("bob")


@pytest.fixture
def moderator(db):
    return make_user("mod", role=UserProfile.Role.MODERATOR)


@pytest.fixture
def as_alice():
    return auth_header("alice")


@pytest.fixture
def as_bob():
    return auth_header("bob")


@pytest.fixture
def as_moderator():
    return auth_header("mod")


@pytest.fixture
def admin_user(db):
    """🔒 Distinct from `moderator`: some actions are admin-only on purpose.

    `require_moderator` passes for BOTH roles, so a test that only ever uses a
    moderator cannot tell an admin-only endpoint from a moderator one - it
    would pass either way and prove nothing.
    """
    return make_user("boss", role=UserProfile.Role.ADMIN)


@pytest.fixture
def as_admin():
    return auth_header("boss")


@pytest.fixture
def verify_membership():
    """Verify a user on a channel, the way the admin action does."""

    def _verify(user, channel, verified=True):
        from django.utils import timezone

        membership, _ = ChannelMembership.objects.get_or_create(user=user, channel=channel)
        membership.is_verified = verified
        membership.verified_at = timezone.now() if verified else None
        membership.save()
        return membership

    return _verify


@pytest.fixture(autouse=True)
def disable_search_indexing(settings):
    """⚠️ Tests must not need a running Meilisearch.

    Celery is eager in dev, so an un-stubbed reindex would run inline and, with
    retry_backoff, stall on any outage. The search module has its own dedicated
    tests in test_search.py.
    """
    settings.SEARCH_INDEXING_ENABLED = False
