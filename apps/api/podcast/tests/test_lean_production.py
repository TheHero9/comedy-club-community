"""Production without a Celery worker or Beat (2026-10-30, specs/27-lean-production/).

🚨 What these pin:

1. Production runs tasks INLINE. If prod.py ever flips back to a queue with no
   worker deployed, every index update is queued into Redis and nothing reads it:
   new ratings, moments and labels silently stop reaching search.
2. Inline, a Meilisearch outage costs ONE attempt and never reaches the member.
   Measured on Celery 5.6: an eager `retry_backoff` task does not re-run - its
   `self.retry()` raises `Retry` straight out of `.delay()`, and the
   `services/indexing.py` helpers swallow it. Without that catch, every rating
   written during a search outage would be a 500.
3. Keep-warm still exists without Beat, and only where it is switched on.
"""

import os
from unittest import mock

import pytest

from podcast.search.client import SEARCH_ERRORS
from podcast.services import indexing
from podcast.tests.test_api_auth import _import_prod_settings

pytestmark = pytest.mark.django_db


def test_production_runs_tasks_inline_and_keeps_search_warm(monkeypatch):
    for name, value in {
        "AUTH_BACKEND": "clerk",
        "DJANGO_SECRET_KEY": "x" * 50,
        "DJANGO_ALLOWED_HOSTS": "example.com",
        "CLERK_JWKS_URL": "https://clerk.example/jwks",
        "CLERK_ISSUER": "https://clerk.example",
    }.items():
        monkeypatch.setitem(os.environ, name, value)

    prod = _import_prod_settings()

    assert prod.CELERY_TASK_ALWAYS_EAGER is True
    assert prod.SEARCH_KEEP_WARM_SECONDS > 0


@pytest.mark.parametrize(
    "helper, strict_target",
    [
        ("schedule_episode_reindex", "podcast.search.index._index_episode_strict"),
        (
            "schedule_transcript_reindex",
            "podcast.search.transcript_index._index_transcript_strict",
        ),
    ],
)
def test_a_search_outage_costs_one_attempt_and_never_reaches_the_member(
    settings, episode, helper, strict_target
):
    settings.SEARCH_INDEXING_ENABLED = True
    settings.CELERY_TASK_ALWAYS_EAGER = True
    outage = SEARCH_ERRORS[-1]("Meilisearch is down")

    with mock.patch(strict_target, side_effect=outage) as attempt:
        getattr(indexing, helper)(episode.pk)  # must not raise

    assert attempt.call_count == 1


def test_keep_warm_is_off_unless_configured(settings):
    from podcast.search import warm

    settings.SEARCH_KEEP_WARM_SECONDS = 0
    with mock.patch.object(warm.threading, "Thread") as thread:
        assert warm.start_keep_warm_thread() is False
    thread.assert_not_called()


def test_keep_warm_runs_on_a_daemon_thread(settings):
    """A daemon thread, so it can never hold a gunicorn worker open on shutdown."""
    from podcast.search import warm

    settings.SEARCH_KEEP_WARM_SECONDS = 240
    with mock.patch.object(warm.threading, "Thread") as thread:
        assert warm.start_keep_warm_thread() is True

    assert thread.call_args.kwargs["daemon"] is True
    thread.return_value.start.assert_called_once()


def test_reindex_timeout_is_raised_for_the_command_only(settings):
    """A busy production Meilisearch killed a rebuild at 5s on 2026-10-30.

    `--timeout` lengthens it for the rebuild process; the reader's default stays 5s.
    """
    from django.core.management import call_command
    from django.core.management.base import CommandError

    from podcast.search import client as search_client

    settings.MEILI_TIMEOUT = search_client.DEFAULT_TIMEOUT_SECONDS
    with mock.patch.object(search_client, "is_available", return_value=False):
        with pytest.raises(CommandError, match="unreachable"):
            call_command("reindex", "--only", "transcripts", "--timeout", "60")

    assert settings.MEILI_TIMEOUT == 60
    assert search_client.DEFAULT_TIMEOUT_SECONDS == 5
