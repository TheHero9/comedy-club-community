# Channel ingestion run: @comedyclubsport7786 (Comedy Club Sport)

**Date:** 2026-08-13
**Result:** ✅ Metadata complete in one pass. ⏳ Transcripts pending (caption requests throttled).

## The channel

| | |
| - | - |
| Handle | `@comedyclubsport7786` |
| Channel ID | `UCqe-KdhynYVaIC5YA1Rl4IA` |
| Name | Comedy Club Sport |
| Content | Sports podcast (UFC/MMA heavy), Bulgarian |
| videos | 47 (ingested) |
| streams | 0 - channel has no streams tab |
| shorts | 0 - channel has no shorts tab |
| Subscribers | 1,880 |
| Banner | none on the channel (avatar stored fine) |

Probe dump saved: `tools/youtube-metadata/data/comedyclubsport7786-2026-08-13.json`.

## The run

```
backfill_channel @comedyclubsport7786 --probe   -> 47 episodes would be ingested
backfill_channel @comedyclubsport7786           -> 47 created, 0 updated, 0 errors,
                                                   0 degraded, 42.0s
                                                   "Metadata complete - no repair needed"
refresh_channel_meta @comedyclubsport7786       -> avatar stored, no banner, 1,880 subs
```

Celery worker picked up the reindex automatically (`indexed: 47`). No repair pass
was needed - at 47 episodes the run is far below the ~500-episode throttle
threshold, and default workers were fine.

## Verification (the count, not the command)

| Check | Result |
| ----- | ------ |
| episodes | 47 |
| degraded (`duration_sec IS NULL`) | **0** |
| missing upload_date / thumbnail / title | 0 / 0 / 0 |
| null view_count | 0 (no members-only on this channel) |
| duplicate youtube_id | 0 |
| availability | 47 public |

## ⏳ Transcripts: pending, NOT failed

`backfill_transcripts --channel @comedyclubsport7786 --probe 10` hit the soft-block:
**10/10 responses degraded** (no `duration`), the fetcher raised `TranscriptThrottled`
each time and correctly wrote **nothing** - so there are no false `unavailable`
records to poison later runs. All 47 episodes remain pending (`never checked: 47`).

The metadata backfill minutes earlier (47 full fetches at 8 workers) most likely
tipped the IP into the block; caption fetches are a second request per episode and
were the first to feel it.

**To finish:** wait a few hours, then

```bash
uv run python manage.py backfill_transcripts --channel @comedyclubsport7786 --probe 10
# and if the probe recovers:
uv run python manage.py backfill_transcripts --channel @comedyclubsport7786
```

Closes when `never checked` is 0 in the Step 7 snippet of the extract-channel skill.

## Notes for the next channel

- First channel ingested via the `/extract-channel` skill end-to-end, including the
  new transcript step. The skill's flow held; the transcript throttle-abort behaved
  exactly as designed (aborted after 10, wrote nothing).
- A small clean backfill can still leave the IP too warm for the caption pass right
  after. If transcripts matter same-day, consider running the caption probe BEFORE
  the metadata backfill, or budget the wait.
