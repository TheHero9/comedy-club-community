"""The daily sync's routing: Data API when keyed, capped yt-dlp when not.

🚨 Regression guard for 2026-08-13: with no YOUTUBE_API_KEY the fallback
re-scraped a 1,318-video catalogue, tripped YouTube's soft-block partway and
(on a stale worker image without the upsert downgrade protection) overwrote
1,171 previously-complete rows. A daily sync picks up NEW uploads; it must
never walk a whole back catalogue.
"""

from unittest import mock

import pytest

from podcast.models import Channel
from podcast.services.ingestion import IngestionResult
from podcast.tasks import sync_channel

pytestmark = pytest.mark.django_db


def _make_channel():
    return Channel.objects.create(
        youtube_channel_id="UCsomechannel0000000000",
        name="Some Channel",
        handle="@somechannel",
    )


def _run_backfill(settings, *, limit=None):
    with mock.patch(
        "podcast.services.ingestion.backfill_channel",
        return_value=IngestionResult(),
    ) as backfill:
        sync_channel.apply(args=("@somechannel",), kwargs={"limit": limit}).get()
    return backfill.call_args


def test_keyless_sync_is_capped(settings):
    settings.YOUTUBE_API_KEY = ""
    call = _run_backfill(settings)
    assert call.kwargs["limit"] == settings.YOUTUBE_SYNC_FALLBACK_LIMIT


def test_keyless_sync_respects_explicit_limit(settings):
    settings.YOUTUBE_API_KEY = ""
    call = _run_backfill(settings, limit=3)
    assert call.kwargs["limit"] == 3


def test_keyed_sync_of_known_channel_uses_the_data_api(settings):
    settings.YOUTUBE_API_KEY = "real-key"
    channel = _make_channel()
    with mock.patch(
        "podcast.services.ingestion.sync_channel_via_api",
        return_value=IngestionResult(channel=channel),
    ) as api_sync, mock.patch(
        "podcast.services.ingestion.backfill_channel"
    ) as backfill:
        sync_channel.apply(args=("@somechannel",)).get()
    assert api_sync.call_args.args == (channel,)
    backfill.assert_not_called()


def test_keyed_sync_of_unknown_channel_falls_back_to_backfill(settings):
    settings.YOUTUBE_API_KEY = "real-key"
    with mock.patch(
        "podcast.services.ingestion.backfill_channel",
        return_value=IngestionResult(),
    ) as backfill:
        sync_channel.apply(args=("@not-in-db",)).get()
    backfill.assert_called_once()
