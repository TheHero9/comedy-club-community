"""The daily sync's keyless yt-dlp fallback must stay capped.

🚨 Regression guard for 2026-08-13: with no YOUTUBE_API_KEY the fallback
re-scraped a 1,318-video catalogue, tripped YouTube's soft-block partway and
(on a stale worker image without the upsert downgrade protection) overwrote
1,171 previously-complete rows. A daily sync picks up NEW uploads; it must
never walk a whole back catalogue.
"""

from unittest import mock

import pytest

from podcast.services.ingestion import IngestionResult
from podcast.tasks import sync_channel

pytestmark = pytest.mark.django_db


def _run(settings, *, limit=None):
    with mock.patch(
        "podcast.services.ingestion.backfill_channel",
        return_value=IngestionResult(),
    ) as backfill:
        sync_channel.apply(args=("@somechannel",), kwargs={"limit": limit}).get()
    return backfill.call_args


def test_keyless_sync_is_capped(settings):
    settings.YOUTUBE_API_KEY = ""
    call = _run(settings)
    assert call.kwargs["limit"] == settings.YOUTUBE_SYNC_FALLBACK_LIMIT


def test_keyless_sync_respects_explicit_limit(settings):
    settings.YOUTUBE_API_KEY = ""
    call = _run(settings, limit=3)
    assert call.kwargs["limit"] == 3


def test_keyed_sync_is_not_capped(settings):
    settings.YOUTUBE_API_KEY = "real-key"
    call = _run(settings)
    assert call.kwargs["limit"] is None
