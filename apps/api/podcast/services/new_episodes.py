"""Everything a new episode needs that the Data API cannot give it, and the closing checks.

`manage.py sync_new_episodes` lists and writes new uploads through the Data API
(`services/ingestion.list_channel_uploads` + `persist_uploads`), then calls in
here for the yt-dlp half, the search indexes and the counts that close a run.
Write-up: specs/26-new-episode-pipeline/02-implementation-plan.md.

🎯 ONE yt-dlp request per episode answers three questions at once: whether it is
members-only (the Data API cannot say), its chapters, and which caption track
exists. The caption download is the only second request.

🚨 Serial and slow on purpose, like every other yt-dlp path in this codebase.
Parallel requests are what soft-blocked the 1,318-episode backfill on 2026-08-09,
and the block lasts hours. A run stops itself after a few throttled responses
in a row and writes nothing for them.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from django.conf import settings

from podcast.ingestion.transcripts import TranscriptThrottled
from podcast.ingestion.yt_dlp_backfill import IngestionError, fetch_video_info, shape_chapters
from podcast.models import Channel, Episode, Transcript, TranscriptSegment
from podcast.services.ingestion import upsert_chapters
from podcast.services.metadata_repair import apply_full_response, degraded_queryset
from podcast.services.transcripts import fetch_and_store

logger = logging.getLogger("podcast")

DEFAULT_ABORT_AFTER_THROTTLES = 5


@dataclass
class EnrichResult:
    attempted: int = 0
    availability_changed: int = 0
    chapters_created: int = 0
    transcripts_stored: int = 0
    segments_created: int = 0
    # No captions yet on a fresh upload; nothing written, asked again next run.
    transcripts_waiting: int = 0
    transcripts_unavailable: int = 0
    # 🚨 A degraded or rejected response. Nothing was written for the part it
    # covered, and the episode stays in `enrich_queryset` for the next run.
    throttled: list[str] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    aborted: bool = False
    stored_episode_ids: list[int] = field(default_factory=list)


def enrich_queryset(channels: Iterable[Channel] | None = None):
    """Episodes still missing the yt-dlp half: no transcript row at all.

    That is every episode created since the last run plus any upload that was
    too fresh for captions last time. Never-checked rows ONLY - the 90-day
    re-check of caption-less episodes stays with `backfill_transcripts`, where
    it is run on purpose. Folded in here it would turn one sync into ~1,400
    requests the day those records come due.
    """
    queryset = Episode.objects.filter(transcript__isnull=True)
    if channels is not None:
        queryset = queryset.filter(channel__in=list(channels))
    return queryset.select_related("channel").order_by("-upload_date", "-id")


def enrich_episode(episode: Episode, result: EnrichResult) -> str:
    """Availability, chapters and transcript for one episode. Returns the transcript outcome.

    Raises `TranscriptThrottled` when YouTube answers with a reduced response
    or rejects the caption download; `IngestionError` for a dead video.
    """
    info = fetch_video_info(episode.youtube_id)
    applied, availability_changed = apply_full_response(episode, info)
    if not applied:
        # Same marker the repair path trusts: no duration means YouTube did not
        # tell us, and nothing about availability or captions can be believed.
        raise TranscriptThrottled(f"Degraded response for {episode.youtube_id} (no duration)")

    result.availability_changed += int(availability_changed)
    result.chapters_created += upsert_chapters(episode, shape_chapters(info))

    transcript, outcome = fetch_and_store(episode, info=info)
    if outcome == "stored":
        result.transcripts_stored += 1
        result.segments_created += transcript.segment_count
        result.stored_episode_ids.append(episode.pk)
    elif outcome == "waiting":
        result.transcripts_waiting += 1
    else:
        result.transcripts_unavailable += 1
    return outcome


def enrich_episodes(
    episodes: list[Episode],
    *,
    delay: float | None = None,
    abort_after_consecutive_throttles: int | None = DEFAULT_ABORT_AFTER_THROTTLES,
    progress: Callable[[str], None] | None = None,
) -> EnrichResult:
    """Run `enrich_episode` over a list, serially, stopping once YouTube is clearly blocking."""
    delay = settings.TRANSCRIPT_FETCH_DELAY if delay is None else delay
    result = EnrichResult(attempted=len(episodes))
    consecutive_throttles = 0

    for index, episode in enumerate(episodes, start=1):
        try:
            outcome = enrich_episode(episode, result)
        except TranscriptThrottled as exc:
            result.throttled.append(episode.youtube_id)
            consecutive_throttles += 1
            outcome = "throttled"
            logger.warning("Throttled on %s: %s", episode.youtube_id, exc)
            if (
                abort_after_consecutive_throttles
                and consecutive_throttles >= abort_after_consecutive_throttles
            ):
                result.aborted = True
                if progress:
                    progress(
                        f"  stopping after {consecutive_throttles} throttled responses in a "
                        "row - YouTube is blocking this IP; the rest stay pending"
                    )
                break
        except IngestionError as exc:
            # A deleted or private video must never stop the run.
            result.errors.append({"youtube_id": episode.youtube_id, "error": str(exc)})
            consecutive_throttles = 0
            outcome = "error"
        except Exception as exc:  # noqa: BLE001 - one bad row never aborts the run
            logger.exception("Unexpected enrich failure for %s", episode.youtube_id)
            result.errors.append({"youtube_id": episode.youtube_id, "error": str(exc)})
            consecutive_throttles = 0
            outcome = "error"
        else:
            consecutive_throttles = 0

        if progress:
            progress(f"  {index}/{len(episodes)}  {episode.youtube_id}  {outcome}")
        if delay and index < len(episodes):
            time.sleep(delay)

    return result


def index_synced(channel_ids: list[int], transcript_episode_ids: list[int]) -> tuple[int, int]:
    """Push this run's writes into both indexes. Returns (episode docs, segment docs).

    🚨 Synchronously and strictly, not through Celery - same reason as
    `remove_episodes`: the worker may be stale or not running, and an index
    task that never executes leaves new episodes that nothing can find. A
    Meilisearch failure raises here instead of passing as a quiet warning.
    """
    from podcast.search.index import index_episodes
    from podcast.search.transcript_index import index_transcript

    episode_docs = index_episodes(
        Episode.objects.filter(channel_id__in=channel_ids), strict=True, wait=True
    )
    segment_docs = sum(
        index_transcript(episode_id, strict=True, wait=True)
        for episode_id in transcript_episode_ids
    )
    return episode_docs, segment_docs


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


def catalogue_checks() -> list[Check]:
    """What closes a sync: COUNTS, never the command exiting.

    Same lesson as every backfill here - "0 errors" proves nothing about what
    was written, and a healthy Meilisearch says nothing about a resident index.
    """
    from podcast.data import removed_episode_ids
    from podcast.search import index as episode_index
    from podcast.search import transcript_index

    checks = []

    degraded = degraded_queryset().count()
    checks.append(Check(
        "no degraded rows", degraded == 0, f"{degraded} episode(s) without a duration"
    ))

    returned = Episode.objects.filter(youtube_id__in=removed_episode_ids()).count()
    checks.append(Check(
        "no excluded video is back", returned == 0, f"{returned} excluded id(s) in the catalogue"
    ))

    episodes = Episode.objects.count()
    indexed = (episode_index.stats() or {}).get("number_of_documents")
    checks.append(Check(
        "episodes index == Postgres",
        indexed == episodes,
        f"{indexed} indexed, {episodes} in Postgres",
    ))

    segments = TranscriptSegment.objects.filter(
        transcript__status=Transcript.Status.OK
    ).count()
    segments_indexed = (transcript_index.stats() or {}).get("number_of_documents")
    checks.append(Check(
        "transcript index == Postgres",
        segments_indexed == segments,
        f"{segments_indexed} indexed, {segments} in Postgres",
    ))
    return checks
