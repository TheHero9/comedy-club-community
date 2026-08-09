"""Persisting transcripts.

The ONE place Transcript and TranscriptSegment rows are written, so the
management command, the Celery task and any future re-transcription tier all
share a single code path.

Idempotency is the contract, same as episode ingestion: a re-run replaces an
episode's segments wholesale inside one transaction. There is no partial state -
either the new transcript is in place or the old one is untouched.

🚨 Deliberately SERIAL with a delay. Speed is what got the 1,318-episode
backfill soft-blocked on 2026-08-09, and a caption fetch is a SECOND request per
episode on top of the metadata one. This job has no deadline; it can run for an
hour in the background. See services/metadata_repair.py for the same reasoning.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from podcast.ingestion.transcripts import (
    DEFAULT_SEGMENT_SECONDS,
    TranscriptPayload,
    TranscriptThrottled,
    TranscriptUnavailable,
    chunk_cues,
    fetch_transcript,
)
from podcast.ingestion.yt_dlp_backfill import IngestionError
from podcast.models import Episode, Transcript, TranscriptSegment

logger = logging.getLogger("podcast")

# Rows per bulk_create. One episode is ~150 segments, so this batches a whole
# episode in a single round trip.
SEGMENT_BATCH_SIZE = 500


@dataclass
class TranscriptBackfillResult:
    attempted: int = 0
    stored: int = 0
    unavailable: int = 0
    segments_created: int = 0
    words: int = 0
    errors: list[dict] = field(default_factory=list)

    # 🚨 Throttled attempts wrote NOTHING. They are not "no captions" and must
    # never be counted as such - the episode stays pending for a later run.
    throttled: int = 0
    aborted: bool = False

    def summary(self) -> str:
        return (
            f"{self.stored} stored ({self.segments_created} segments, {self.words:,} words), "
            f"{self.unavailable} without captions, {self.throttled} throttled, "
            f"{len(self.errors)} errors (of {self.attempted} attempted)"
        )


def _segment_seconds() -> int:
    return int(getattr(settings, "TRANSCRIPT_SEGMENT_SECONDS", DEFAULT_SEGMENT_SECONDS))


def _recheck_days() -> int:
    return int(getattr(settings, "TRANSCRIPT_RECHECK_DAYS", 90))


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


@transaction.atomic
def store_transcript(
    episode: Episode, payload: TranscriptPayload, *, window_sec: int | None = None
) -> Transcript:
    """Replace an episode's transcript with a freshly fetched one."""
    segments = chunk_cues(payload.cues, window_sec=window_sec or _segment_seconds())
    if not segments:
        raise TranscriptUnavailable(f"{payload.youtube_id} produced zero segments")

    transcript, _ = Transcript.objects.update_or_create(
        episode=episode,
        defaults={
            "status": Transcript.Status.OK,
            "source": payload.source,
            "language": payload.language,
            "track_id": payload.track_id,
            "segment_count": len(segments),
            "word_count": payload.word_count,
            "covered_sec": int(segments[-1].end_sec),
            "checked_at": timezone.now(),
        },
    )

    # Wholesale replacement. A partial overwrite would leave stale segments from
    # a previous, differently-windowed run interleaved with the new ones.
    transcript.segments.all().delete()
    TranscriptSegment.objects.bulk_create(
        [
            TranscriptSegment(
                transcript=transcript,
                start_sec=int(segment.start_sec),
                end_sec=int(segment.end_sec),
                text=segment.text,
            )
            for segment in segments
        ],
        batch_size=SEGMENT_BATCH_SIZE,
    )

    logger.info(
        "Stored transcript for %s: %d segments, %d words, %s",
        episode.youtube_id, len(segments), payload.word_count, payload.track_id,
    )
    return transcript


@transaction.atomic
def mark_unavailable(episode: Episode) -> Transcript:
    """Record that this episode has no captions.

    🚨 Only ever call this after a COMPLETE response. A throttled response omits
    the caption list, and writing "none" from one would permanently stop this
    episode from being re-checked.
    """
    transcript, _ = Transcript.objects.update_or_create(
        episode=episode,
        defaults={
            "status": Transcript.Status.UNAVAILABLE,
            "source": "",
            "segment_count": 0,
            "word_count": 0,
            "covered_sec": 0,
            "checked_at": timezone.now(),
        },
    )
    transcript.segments.all().delete()
    return transcript


def fetch_and_store(episode: Episode, *, window_sec: int | None = None) -> tuple[Transcript, str]:
    """Fetch one episode's captions and persist the outcome.

    Returns (transcript, outcome) where outcome is "stored" or "unavailable".
    Raises `TranscriptThrottled` untouched so the caller can back off - that
    case writes nothing at all.
    """
    try:
        payload = fetch_transcript(episode.youtube_id)
    except TranscriptUnavailable:
        return mark_unavailable(episode), "unavailable"

    return store_transcript(episode, payload, window_sec=window_sec), "stored"


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


def pending_queryset(channel=None, *, since=None, recheck_days: int | None = None, force=False):
    """Episodes whose transcript still needs a fetch.

    Newest first: caption coverage is strongly date-dependent (2024+ sampled
    9/9, 2019-2022 sampled 0/12), so the productive work happens first and an
    interrupted run has already banked the useful part.
    """
    queryset = Episode.objects.all()
    if channel is not None:
        queryset = queryset.filter(channel=channel)
    if since is not None:
        queryset = queryset.filter(upload_date__gte=since)

    if not force:
        cutoff = timezone.now() - timedelta(days=recheck_days or _recheck_days())
        # Never checked, or recorded as caption-less long enough ago that YouTube
        # may have added them since. A STORED transcript is never re-fetched
        # without --force; re-transcription is a deliberate act, not a sweep.
        queryset = queryset.filter(
            Q(transcript__isnull=True)
            | Q(
                transcript__status=Transcript.Status.UNAVAILABLE,
                transcript__checked_at__lt=cutoff,
            )
        )

    return queryset.order_by("-upload_date", "-id")


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------


def backfill_transcripts(
    channel=None,
    *,
    since=None,
    limit: int | None = None,
    delay: float | None = None,
    force: bool = False,
    window_sec: int | None = None,
    abort_after_consecutive_throttles: int | None = 10,
    reindex: bool = True,
    progress=None,
) -> TranscriptBackfillResult:
    """Fetch captions for every pending episode, serially.

    Fully resumable: a stored or recorded-unavailable episode leaves the pending
    queryset, so re-running picks up exactly where this stopped.

    `abort_after_consecutive_throttles` stops the run once YouTube is clearly
    blocking, rather than burning an hour and deepening the block. The block
    lasts HOURS, not minutes - there is no retry-harder here.
    """
    delay = settings.TRANSCRIPT_FETCH_DELAY if delay is None else delay
    episodes = list(pending_queryset(channel, since=since, force=force)[: limit or None])
    result = TranscriptBackfillResult(attempted=len(episodes))
    consecutive_throttles = 0
    touched: list[int] = []

    for index, episode in enumerate(episodes, start=1):
        try:
            transcript, outcome = fetch_and_store(episode, window_sec=window_sec)
        except TranscriptThrottled as exc:
            # Wrote nothing. The episode stays pending for a later run.
            result.throttled += 1
            consecutive_throttles += 1
            logger.warning("Throttled on %s: %s", episode.youtube_id, exc)
            if (
                abort_after_consecutive_throttles
                and consecutive_throttles >= abort_after_consecutive_throttles
            ):
                message = (
                    f"Aborting after {consecutive_throttles} consecutive throttled responses - "
                    "YouTube is blocking this IP. Nothing was written for them. Retry in a "
                    "few hours."
                )
                logger.warning(message)
                if progress:
                    progress(message)
                result.aborted = True
                break
            if delay:
                time.sleep(delay)
            continue
        except IngestionError as exc:
            # A dead or private video must never stop the sweep.
            logger.warning("Transcript fetch failed for %s: %s", episode.youtube_id, exc)
            result.errors.append({"youtube_id": episode.youtube_id, "error": str(exc)})
            consecutive_throttles = 0
        except Exception as exc:  # noqa: BLE001 - one bad row never aborts the sweep
            logger.exception("Unexpected transcript failure for %s", episode.youtube_id)
            result.errors.append({"youtube_id": episode.youtube_id, "error": str(exc)})
            consecutive_throttles = 0
        else:
            consecutive_throttles = 0
            if outcome == "stored":
                result.stored += 1
                result.segments_created += transcript.segment_count
                result.words += transcript.word_count
                touched.append(episode.pk)
            else:
                result.unavailable += 1

        if progress and index % 10 == 0:
            progress(
                f"  {index}/{len(episodes)} - {result.stored} stored, "
                f"{result.unavailable} without captions"
            )

        if delay:
            time.sleep(delay)

    if reindex and touched:
        from podcast.services.indexing import schedule_transcript_reindex

        for episode_id in touched:
            schedule_transcript_reindex(episode_id)

    logger.info("Transcript backfill complete: %s", result.summary())
    return result
