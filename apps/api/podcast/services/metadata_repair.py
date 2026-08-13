"""Repairing episodes that were ingested from a degraded YouTube response.

🚨 Why this exists (2026-08-09, @comedyclubpodcast backfill of 1,318 episodes):

A large backfill at 8 parallel workers gets soft-blocked by YouTube partway through.
yt-dlp does not error - it keeps returning a *reduced* metadata payload. Core fields
(title, description, upload_date, id) still arrive, so the run reports 0 errors and
looks clean. What silently goes missing is everything derived from the player
response: `duration`, `availability`, `view_count`, `like_count`.

That second one is the dangerous one. `shape_video` coerces a missing availability to
"public", so a members-only episode caught by the block is stored as a public episode
with full confidence. 1,036 of 1,318 rows came back degraded on that run.

Detection: a degraded row is `duration_sec IS NULL`. A full response always carries a
duration; the same video id re-fetched while blocked returns None and while unblocked
returns the real value. That was verified directly - vawEZWFo4BA returned 10246 during
the run and None minutes later.

The repair is deliberately slow: low concurrency plus a delay, because speed is what
caused the problem. Only a *full* response is allowed to write, so running this while
still blocked changes nothing rather than overwriting good data with nulls.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from podcast.ingestion.yt_dlp_backfill import IngestionError, fetch_video_info
from podcast.models import Episode

logger = logging.getLogger("podcast")

# Fields that only ever arrive on a full player response.
REPAIRABLE_FIELDS = ("duration_sec", "availability", "view_count", "like_count", "yt_comment_count")


@dataclass
class RepairResult:
    attempted: int = 0
    repaired: int = 0
    still_degraded: int = 0
    availability_corrected: int = 0
    errors: list[dict] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"{self.repaired} repaired, {self.still_degraded} still degraded, "
            f"{self.availability_corrected} availability corrections, "
            f"{len(self.errors)} errors (of {self.attempted} attempted)"
        )


def degraded_queryset(channel=None):
    """Episodes whose metadata came from a reduced response.

    `duration_sec IS NULL` is the marker - see the module docstring.
    """
    qs = Episode.objects.filter(duration_sec__isnull=True)
    if channel is not None:
        qs = qs.filter(channel=channel)
    return qs.order_by("youtube_id")


def is_full_response(info: dict) -> bool:
    """A response we trust enough to write from."""
    return info.get("duration") is not None


def repair_episode(episode: Episode) -> tuple[bool, bool]:
    """Re-fetch one episode and write only if the response is full.

    Returns (repaired, availability_changed).
    """
    info = fetch_video_info(episode.youtube_id)

    if not is_full_response(info):
        return False, False

    updates: dict = {"duration_sec": int(info["duration"])}

    # Only overwrite availability when YouTube actually stated one. A degraded
    # response omits it, and the original ingest already defaulted it to "public".
    availability_changed = False
    availability = info.get("availability")
    valid = {choice.value for choice in Episode.Availability}
    if availability in valid and availability != episode.availability:
        updates["availability"] = availability
        # .update() bypasses save(), which is where this flag is normally
        # denormalized - keep it in lockstep here or badges/filters go stale.
        updates["members_only"] = availability == Episode.Availability.SUBSCRIBER_ONLY
        availability_changed = True
    elif availability and availability not in valid:
        logger.info(
            "Unmapped availability %r on %s, leaving %r",
            availability, episode.youtube_id, episode.availability,
        )

    for source, target in (
        ("view_count", "view_count"),
        ("like_count", "like_count"),
        ("comment_count", "yt_comment_count"),
    ):
        value = info.get(source)
        if value is not None:
            updates[target] = value

    Episode.objects.filter(pk=episode.pk).update(**updates)
    return True, availability_changed


def repair_degraded_via_api(
    channel=None,
    *,
    limit: int | None = None,
    progress=None,
) -> RepairResult:
    """Repair degraded rows through the YouTube Data API - immune to the soft-block.

    Batches of 50 ids per quota unit, so the entire catalogue costs a few dozen
    units of the 10,000/day free quota, and it works WHILE yt-dlp is blocked.

    ⚠️ Two deliberate limits versus the yt-dlp repair:
    - `availability` is never written. The API returns members-only videos but
      nothing in the response SAYS they are members-only (measured 2026-08-13),
      so this repair cannot make availability corrections - only yt-dlp can.
    - Ids the API does not return (deleted/private) are left degraded on
      purpose: they stay in `degraded_queryset` and the yt-dlp sweep picks
      them up once the block lifts. Absence is "unknown", never data.
    """
    from podcast.ingestion.youtube_api import YouTubeAPIError, video_details

    episodes = list(degraded_queryset(channel)[: limit or None])
    result = RepairResult(attempted=len(episodes))
    if not episodes:
        return result

    try:
        details = video_details([e.youtube_id for e in episodes])
    except YouTubeAPIError as exc:
        logger.warning("Data API repair failed: %s", exc)
        result.errors.append({"youtube_id": "*", "error": str(exc)})
        result.still_degraded = len(episodes)
        return result

    for index, episode in enumerate(episodes, start=1):
        info = details.get(episode.youtube_id)
        if not info or info.get("duration_sec") is None:
            # Invisible to the API: members-only or deleted. Stays degraded for
            # the yt-dlp sweep, which can also state its real availability.
            result.still_degraded += 1
            continue

        updates: dict = {"duration_sec": info["duration_sec"]}
        for field_name in ("view_count", "like_count", "yt_comment_count"):
            if info.get(field_name) is not None:
                updates[field_name] = info[field_name]
        Episode.objects.filter(pk=episode.pk).update(**updates)
        result.repaired += 1

        if progress and index % 200 == 0:
            progress(f"  {index}/{len(episodes)} - {result.repaired} repaired")

    logger.info("Data API metadata repair complete: %s", result.summary())
    return result


def repair_degraded_metadata(
    channel=None,
    *,
    limit: int | None = None,
    delay: float = 1.0,
    abort_after_consecutive_failures: int | None = 25,
    progress=None,
) -> RepairResult:
    """Re-fetch degraded episodes serially, newest damage first.

    Serial by design. Parallelism is what triggered the block in the first place, and
    this job has no deadline - it can run for an hour in the background.

    `abort_after_consecutive_failures` stops the run early when YouTube is clearly
    still blocking us, so we neither waste an hour nor deepen the block. Pass None to
    disable. The job is fully resumable: a repaired row leaves the degraded queryset.
    """
    episodes = list(degraded_queryset(channel)[: limit or None])
    result = RepairResult(attempted=len(episodes))
    consecutive_failures = 0

    for index, episode in enumerate(episodes, start=1):
        try:
            repaired, availability_changed = repair_episode(episode)
        except IngestionError as exc:
            # A dead or removed video must not stop the sweep.
            logger.warning("Repair failed for %s: %s", episode.youtube_id, exc)
            result.errors.append({"youtube_id": episode.youtube_id, "error": str(exc)})
            repaired = availability_changed = False
        except Exception as exc:  # noqa: BLE001 - one bad row never aborts the sweep
            logger.exception("Unexpected repair failure for %s", episode.youtube_id)
            result.errors.append({"youtube_id": episode.youtube_id, "error": str(exc)})
            repaired = availability_changed = False

        if repaired:
            result.repaired += 1
            result.availability_corrected += int(availability_changed)
            consecutive_failures = 0
        else:
            result.still_degraded += 1
            consecutive_failures += 1

        if progress and index % 25 == 0:
            progress(f"  {index}/{len(episodes)} - {result.repaired} repaired")

        if (
            abort_after_consecutive_failures
            and consecutive_failures >= abort_after_consecutive_failures
        ):
            message = (
                f"Aborting after {consecutive_failures} consecutive degraded responses - "
                "YouTube is still throttling this IP. Nothing was written. Retry later."
            )
            logger.warning(message)
            if progress:
                progress(message)
            break

        if delay:
            time.sleep(delay)

    logger.info("Metadata repair complete: %s", result.summary())
    return result
