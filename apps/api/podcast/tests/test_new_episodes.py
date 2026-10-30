"""Bringing the catalogue current without undoing a past decision.

Pins the four gaps found before `sync_new_episodes` was built
(specs/26-new-episode-pipeline/02-implementation-plan.md):

1. 🚨 A sync must never recreate a video on the exclusion list - ingestion is
   `update_or_create`, so it would come back as a confident `created`.
2. 🚨 `remove_episodes` must ADD to that list, or the next sync undoes it.
3. 🚨 A fresh upload with no captions yet must not be recorded as caption-less,
   or it is not looked at again for 90 days.
4. ⚠️ The yt-dlp step writes availability only from a FULL response.
"""

from datetime import timedelta
from unittest import mock

import pytest
from django.core.management import call_command
from django.utils import timezone

from podcast import data as exclusion
from podcast.ingestion.transcripts import TranscriptUnavailable
from podcast.models import Episode, Transcript
from podcast.services.ingestion import (
    IngestionResult,
    backfill_channel,
    list_channel_uploads,
    sync_channel_via_api,
)
from podcast.services.new_episodes import EnrichResult, enrich_episode, enrich_queryset
from podcast.services.transcripts import fetch_and_store, pending_queryset

pytestmark = pytest.mark.django_db

KEPT = "keptVideo01"
PURGED = "purgedClip1"


@pytest.fixture(autouse=True)
def exclusion_file(tmp_path, monkeypatch):
    """Never the real list - tests write to it."""
    path = tmp_path / "removed-episodes.txt"
    path.write_text(f"# header\n{PURGED}  # some-channel | 1:59 | a promo clip\n", encoding="utf-8")
    monkeypatch.setattr(exclusion, "REMOVED_EPISODES_FILE", path)
    return path


def _details(video_id, *, duration=3600, live_status="none"):
    return {
        "youtube_id": video_id,
        "title": f"Title {video_id}",
        "description": "",
        "upload_date": "2026-10-01",
        "duration_sec": duration,
        "view_count": 10,
        "like_count": 1,
        "yt_comment_count": 0,
        "is_stream": False,
        "live_status": live_status,
    }


def _mock_api(videos, *, streams=(), details=None):
    """Patch the Data API: `videos`/`streams` are what each tab lists, newest first."""
    listed = {"videos": list(videos), "streams": list(streams)}
    details = details or {vid: _details(vid) for vid in [*videos, *streams]}

    def playlist_video_ids(playlist_id, *, limit=None):
        ids = listed["videos" if playlist_id.startswith("UULF") else "streams"]
        return ids[:limit] if limit else ids

    def video_details(ids):
        return {vid: details[vid] for vid in ids if vid in details}

    return [
        mock.patch(
            "podcast.ingestion.youtube_api.playlist_video_ids", side_effect=playlist_video_ids
        ),
        mock.patch("podcast.ingestion.youtube_api.video_details", side_effect=video_details),
        mock.patch("podcast.ingestion.thumbnails.best_thumbnail_url", return_value=""),
    ]


def _run(patches, fn):
    for patch in patches:
        patch.start()
    try:
        return fn()
    finally:
        for patch in patches:
            patch.stop()


# ---------------------------------------------------------------------------
# 1. The exclusion list is honoured by every ingestion path
# ---------------------------------------------------------------------------


def test_api_sync_never_recreates_an_excluded_video(channel):
    result = _run(_mock_api([KEPT, PURGED]), lambda: sync_channel_via_api(channel))

    assert Episode.objects.filter(youtube_id=KEPT).exists()
    assert not Episode.objects.filter(youtube_id=PURGED).exists()
    assert result.created == 1
    assert result.excluded == 1


def test_yt_dlp_backfill_never_recreates_an_excluded_video(channel):
    from podcast.ingestion.yt_dlp_backfill import ChannelPayload

    payload = ChannelPayload(
        youtube_channel_id=channel.youtube_channel_id,
        name=channel.name,
        handle=channel.handle,
        videos=[
            {"youtube_id": vid, "title": vid, "duration_sec": 3600, "upload_date": "2026-10-01"}
            for vid in (KEPT, PURGED)
        ],
    )
    with mock.patch("podcast.services.ingestion.fetch_channel", return_value=payload):
        result = backfill_channel(channel.handle)

    assert Episode.objects.filter(youtube_id=KEPT).exists()
    assert not Episode.objects.filter(youtube_id=PURGED).exists()
    assert result.excluded == 1


def test_listing_separates_new_known_and_excluded(channel, episode):
    listing = _run(
        _mock_api(["brandNew001", episode.youtube_id, PURGED]),
        lambda: list_channel_uploads(channel),
    )

    assert [c.youtube_id for c in listing.new] == ["brandNew001"]
    assert {c.youtube_id for c in listing.candidates} == {"brandNew001", episode.youtube_id}
    assert listing.excluded == [PURGED]
    assert Episode.objects.count() == 1  # listing writes nothing


def test_a_full_window_of_new_uploads_is_flagged(channel, episode):
    """If every listed id is new, older new uploads may sit past `limit`."""
    all_new = _run(_mock_api(["new1", "new2"]), lambda: list_channel_uploads(channel, limit=2))
    reaches_known = _run(
        _mock_api(["new1", episode.youtube_id]), lambda: list_channel_uploads(channel, limit=2)
    )

    assert all_new.window_full == [Episode.ContentKind.VIDEO]
    assert reaches_known.window_full == []


def test_a_scheduled_premiere_is_not_written_yet(channel):
    details = {
        KEPT: _details(KEPT),
        "premiere001": _details("premiere001", duration=0, live_status="upcoming"),
    }
    _run(_mock_api([KEPT, "premiere001"], details=details), lambda: sync_channel_via_api(channel))

    assert Episode.objects.filter(youtube_id=KEPT).exists()
    assert not Episode.objects.filter(youtube_id="premiere001").exists()


# ---------------------------------------------------------------------------
# 2. Removing an episode keeps it removed
# ---------------------------------------------------------------------------


def test_remove_episodes_adds_the_id_to_the_exclusion_list(channel, episode, tmp_path):
    ids_file = tmp_path / "to-remove.txt"
    ids_file.write_text(f"{episode.youtube_id}\n", encoding="utf-8")

    call_command(
        "remove_episodes", str(ids_file), "--yes", "--no-search",
        "--backup", str(tmp_path / "backup.json"),
    )

    assert not Episode.objects.filter(youtube_id=episode.youtube_id).exists()
    assert episode.youtube_id in exclusion.removed_episode_ids()


def test_adding_an_id_twice_writes_it_once(exclusion_file):
    first = exclusion.add_removed_episodes([("clipAAAAAAA", "note")], reason="test")
    second = exclusion.add_removed_episodes(
        [("clipAAAAAAA", "note"), (PURGED, "already listed")], reason="test"
    )

    assert first == ["clipAAAAAAA"]
    assert second == []
    assert exclusion_file.read_text(encoding="utf-8").count("clipAAAAAAA") == 1


# ---------------------------------------------------------------------------
# 3. A fresh upload is not caption-less yet
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "days_old, outcome, has_row",
    [(2, "waiting", False), (30, "unavailable", True)],
)
def test_no_captions_is_only_a_fact_once_the_upload_has_aged(episode, days_old, outcome, has_row):
    episode.upload_date = timezone.localdate() - timedelta(days=days_old)
    episode.save()

    with mock.patch(
        "podcast.services.transcripts.fetch_transcript",
        side_effect=TranscriptUnavailable("no bg track"),
    ):
        transcript, got = fetch_and_store(episode)

    assert got == outcome
    assert Transcript.objects.filter(episode=episode).exists() is has_row
    # A waiting episode stays in the queue the next run reads from.
    assert pending_queryset().filter(pk=episode.pk).exists() is not has_row


# ---------------------------------------------------------------------------
# 4. The yt-dlp step writes only from a full response
# ---------------------------------------------------------------------------


def test_enrich_flags_a_members_only_upload(episode):
    info = {"duration": 3935, "availability": "subscriber_only", "chapters": []}
    with mock.patch(
        "podcast.services.new_episodes.fetch_video_info", return_value=info
    ), mock.patch(
        "podcast.services.new_episodes.fetch_and_store", return_value=(None, "unavailable")
    ):
        result = EnrichResult()
        enrich_episode(episode, result)

    episode.refresh_from_db()
    assert episode.members_only is True
    assert result.availability_changed == 1


def test_enrich_writes_nothing_from_a_degraded_response(episode):
    from podcast.ingestion.transcripts import TranscriptThrottled

    info = {"duration": None, "availability": "subscriber_only"}
    with mock.patch(
        "podcast.services.new_episodes.fetch_video_info", return_value=info
    ), mock.patch("podcast.services.new_episodes.fetch_and_store") as fetch:
        with pytest.raises(TranscriptThrottled):
            enrich_episode(episode, EnrichResult())

    episode.refresh_from_db()
    assert episode.members_only is False
    fetch.assert_not_called()
    assert enrich_queryset().filter(pk=episode.pk).exists()


def test_result_summary_reports_exclusions():
    assert "2 excluded" in IngestionResult(excluded=2).summary()


# ---------------------------------------------------------------------------
# The review gate: short videos are asked about, never added silently
# ---------------------------------------------------------------------------


def test_short_videos_follow_the_answers_given_up_front(channel, monkeypatch):
    """With no terminal to ask in (the skill runs it), `--add` / `--exclude` are the answers.

    A short video with no answer is held for the next run - never added by default.
    """
    from podcast.management.commands.sync_new_episodes import ADD, EXCLUDE, LATER, Command
    from podcast.services.ingestion import UploadCandidate, UploadListing

    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    listing = UploadListing(channel=channel, candidates=[
        UploadCandidate("longEpisode", "video", _details("longEpisode", duration=7200), True),
        UploadCandidate("shortYes001", "video", _details("shortYes001", duration=300), True),
        UploadCandidate("shortNo0001", "video", _details("shortNo0001", duration=90), True),
        UploadCandidate("shortUnsure", "video", _details("shortUnsure", duration=400), True),
        UploadCandidate(
            "premiere001", "stream", _details("premiere001", duration=0, live_status="upcoming"),
            True,
        ),
    ])
    options = {
        "ask_under": 15, "yes": False, "add": ["shortYes001"], "exclude": ["shortNo0001"],
    }

    decisions = Command()._decide([listing], options)

    assert decisions == {
        "longEpisode": ADD,
        "shortYes001": ADD,
        "shortNo0001": EXCLUDE,
        "shortUnsure": LATER,
        "premiere001": LATER,
    }
