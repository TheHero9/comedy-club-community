"""Write-endpoint rate limiting (matrix section 15).

🔒 CLAUDE.md § Security: "Rate-limit every write endpoint (ratings, comments,
topics, moments, reports). ~1k users can still spam."

The limiter is `podcast/api/throttling.WriteThrottle`, attached once to the whole
`NinjaAPI` in `config/api.py`, so a newly added write endpoint is covered by
default rather than by remembering to decorate it.

Two invariants are worth more than the counting itself:
  - the bucket is keyed on the ACTOR, so two users never share a limit (15.2)
  - reads are never throttled - this is a content site whose read traffic is
    the product
"""

from __future__ import annotations

import pytest
from django.core.cache import cache

from podcast.api.throttling import WriteThrottle
from podcast.models import Comment, Moment, PersonalTag, Rating, WatchEvent

from .conftest import auth_header

pytestmark = pytest.mark.django_db

BASE = "/api"

# Small enough to exhaust in a test, large enough that a real user never sees it.
LIMIT = 3


@pytest.fixture(autouse=True)
def throttled(settings):
    """A local, per-test cache so buckets cannot leak between tests or runs."""
    settings.CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "rate-limit-tests",
        }
    }
    settings.API_WRITE_RATE_LIMIT = f"{LIMIT}/min"
    cache.clear()
    yield
    cache.clear()


# ---------------------------------------------------------------------------
# 15.1 - the Nth request in the window is refused
# ---------------------------------------------------------------------------


def _write_calls(client, episode, channel, headers) -> dict:
    """One callable per write endpoint, all runnable repeatedly with the same args."""
    yt = episode.youtube_id
    return {
        "rating": lambda: client.put(
            f"{BASE}/episodes/{yt}/rating",
            data={"score": 7},
            content_type="application/json",
            **headers,
        ),
        "favorite": lambda: client.put(f"{BASE}/episodes/{yt}/favorite", **headers),
        "watch": lambda: client.post(
            f"{BASE}/episodes/{yt}/watch",
            data={},
            content_type="application/json",
            **headers,
        ),
        "personal_tag": lambda: client.post(
            f"{BASE}/episodes/{yt}/tags",
            data={"text": "смешно"},
            content_type="application/json",
            **headers,
        ),
        "comment": lambda: client.post(
            f"{BASE}/episodes/{yt}/comments",
            data={"body": "коментар", "is_spoiler": False},
            content_type="application/json",
            **headers,
        ),
        "moment": lambda: client.post(
            f"{BASE}/episodes/{yt}/moments",
            data={"timestamp_sec": 30, "label": "момент"},
            content_type="application/json",
            **headers,
        ),
        "topic": lambda: client.post(
            f"{BASE}/episodes/{yt}/topics",
            data={"name": "шахмат"},
            content_type="application/json",
            **headers,
        ),
        "membership": lambda: client.post(
            f"{BASE}/me/memberships",
            data={"channel_id": channel.id},
            content_type="application/json",
            **headers,
        ),
        "profile": lambda: client.patch(
            f"{BASE}/me",
            data={"display_name": "Иван"},
            content_type="application/json",
            **headers,
        ),
        "report": lambda: client.post(
            f"{BASE}/reports",
            data={"target_type": "comment", "target_id": 1, "reason": "спам"},
            content_type="application/json",
            **headers,
        ),
    }


ENDPOINTS = [
    "rating",
    "favorite",
    "watch",
    "personal_tag",
    "comment",
    "moment",
    "topic",
    "membership",
    "profile",
    "report",
]


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_15_1_each_write_endpoint_returns_429_once_the_window_is_full(
    client, episode, channel, endpoint
):
    # A fresh actor per endpoint: one shared bucket per user is the design, so
    # reusing a user across endpoints would exhaust it before the test starts.
    headers = auth_header(f"rl-{endpoint}")
    call = _write_calls(client, episode, channel, headers)[endpoint]

    allowed = [call() for _ in range(LIMIT)]
    refused = call()

    for response in allowed:
        assert response.status_code != 429, (endpoint, response.content)
    assert refused.status_code == 429, endpoint


def test_15_1_a_throttled_request_never_reaches_the_view(client, episode, alice, as_alice):
    """429 must be refusal, not a failed write - nothing may be persisted."""
    for _ in range(LIMIT):
        client.post(
            f"{BASE}/episodes/{episode.youtube_id}/comments",
            data={"body": "коментар", "is_spoiler": False},
            content_type="application/json",
            **as_alice,
        )
    assert Comment.objects.count() == LIMIT

    refused = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/comments",
        data={"body": "четвърти", "is_spoiler": False},
        content_type="application/json",
        **as_alice,
    )

    assert refused.status_code == 429
    assert Comment.objects.count() == LIMIT
    assert not Comment.objects.filter(body="четвърти").exists()


def test_15_1_the_bucket_spans_endpoints_for_one_actor(client, episode, alice, as_alice):
    """A spammer must not get a fresh allowance per endpoint."""
    client.put(
        f"{BASE}/episodes/{episode.youtube_id}/rating",
        data={"score": 5},
        content_type="application/json",
        **as_alice,
    )
    client.put(f"{BASE}/episodes/{episode.youtube_id}/favorite", **as_alice)
    client.post(
        f"{BASE}/episodes/{episode.youtube_id}/watch",
        data={},
        content_type="application/json",
        **as_alice,
    )

    refused = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/moments",
        data={"timestamp_sec": 5, "label": "момент"},
        content_type="application/json",
        **as_alice,
    )
    assert refused.status_code == 429
    assert Moment.objects.count() == 0


def test_15_1_a_429_says_so_in_the_body(client, episode, alice, as_alice):
    for _ in range(LIMIT + 1):
        response = client.put(
            f"{BASE}/episodes/{episode.youtube_id}/favorite", **as_alice
        )
    assert response.status_code == 429
    assert "too many" in response.json()["detail"].lower()


def test_15_1_deletes_are_throttled_too(client, episode, alice, as_alice):
    """DELETE is a write. An unbounded delete loop is still abuse."""
    for _ in range(LIMIT):
        client.delete(f"{BASE}/episodes/{episode.youtube_id}/favorite", **as_alice)

    refused = client.delete(f"{BASE}/episodes/{episode.youtube_id}/favorite", **as_alice)
    assert refused.status_code == 429


# ---------------------------------------------------------------------------
# 15.2 - the bucket is per actor, never global
# ---------------------------------------------------------------------------


def test_15_2_two_users_do_not_share_a_bucket(client, episode, alice, bob, as_alice, as_bob):
    for _ in range(LIMIT + 1):
        exhausted = client.put(
            f"{BASE}/episodes/{episode.youtube_id}/rating",
            data={"score": 8},
            content_type="application/json",
            **as_alice,
        )
    assert exhausted.status_code == 429

    still_fine = client.put(
        f"{BASE}/episodes/{episode.youtube_id}/rating",
        data={"score": 4},
        content_type="application/json",
        **as_bob,
    )
    assert still_fine.status_code == 200
    assert Rating.objects.filter(user=bob).count() == 1


def test_15_2_the_cache_key_is_the_actor_not_the_client_ip(client, episode, alice, bob):
    """Everyone in this test suite shares 127.0.0.1, so an IP key would collide."""
    throttle = WriteThrottle()

    class _Request:
        method = "POST"
        META = {"REMOTE_ADDR": "127.0.0.1"}

    request_a, request_b = _Request(), _Request()
    request_a.auth, request_b.auth = alice, bob

    assert throttle.get_cache_key(request_a) != throttle.get_cache_key(request_b)
    assert str(alice.pk) in throttle.get_cache_key(request_a)


def test_15_2_an_anonymous_write_is_rejected_by_auth_before_the_limiter(client, episode):
    """The limiter must never mask a 401 - authentication runs first."""
    for _ in range(LIMIT + 2):
        response = client.put(
            f"{BASE}/episodes/{episode.youtube_id}/rating",
            data={"score": 8},
            content_type="application/json",
        )
        assert response.status_code == 401


# ---------------------------------------------------------------------------
# Reads are free, and the knob works
# ---------------------------------------------------------------------------


def test_public_reads_are_never_throttled(client, episode):
    for _ in range(LIMIT * 4):
        assert client.get(f"{BASE}/episodes").status_code == 200
        assert client.get(f"{BASE}/episodes/{episode.youtube_id}").status_code == 200


def test_authenticated_reads_are_never_throttled(client, episode, alice, as_alice):
    for _ in range(LIMIT * 4):
        assert client.get(f"{BASE}/me", **as_alice).status_code == 200
        assert client.get(f"{BASE}/me/tags", **as_alice).status_code == 200


def test_the_limiter_can_be_switched_off_by_configuration(
    settings, client, episode, alice, as_alice
):
    settings.API_WRITE_RATE_LIMIT = ""
    for _ in range(LIMIT * 3):
        response = client.post(
            f"{BASE}/episodes/{episode.youtube_id}/watch",
            data={},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200
    assert WatchEvent.objects.count() == LIMIT * 3


def test_the_configured_rate_is_read_per_request_not_frozen_at_import(
    settings, client, episode, alice, as_alice
):
    """The rate has to be a live setting, otherwise it is untestable and unops-able."""
    settings.API_WRITE_RATE_LIMIT = "1/min"
    first = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/tags",
        data={"text": "едно"},
        content_type="application/json",
        **as_alice,
    )
    second = client.post(
        f"{BASE}/episodes/{episode.youtube_id}/tags",
        data={"text": "две"},
        content_type="application/json",
        **as_alice,
    )
    assert first.status_code == 200
    assert second.status_code == 429
    assert PersonalTag.objects.count() == 1


def test_a_cache_outage_fails_open_rather_than_freezing_all_writes(
    settings, client, episode, alice, as_alice, monkeypatch
):
    """⚠️ A Redis outage must not turn the site read-only. It is logged instead."""
    from django.core.cache.backends.locmem import LocMemCache

    def _explode(self, *args, **kwargs):
        raise ConnectionError("cache is down")

    monkeypatch.setattr(LocMemCache, "get", _explode)

    for _ in range(LIMIT + 2):
        response = client.put(
            f"{BASE}/episodes/{episode.youtube_id}/rating",
            data={"score": 6},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200
