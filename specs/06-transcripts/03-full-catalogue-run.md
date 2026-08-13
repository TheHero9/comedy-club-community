# Full-catalogue transcript run (2026-08-13/14, overnight via /loop)

**Result:** ✅ 1,959 of 1,961 episodes have a verdict. 578 transcripts stored
(**61,448 searchable segments**, Postgres == Meilisearch exactly), 1,381 recorded
caption-less, 2 pending on a caption-endpoint 429.

## Coverage by channel (the date-dependence hypothesis, now measured)

| Channel | With captions | None | Coverage |
| ------- | ------------- | ---- | -------- |
| @BFFPepiQ | 79/80 | 1 | **99%** |
| @ivankirkov1 | 66/75 | 9 | **88%** |
| @delo404podcast | 49/57 | 8 | **86%** |
| @comedyclubpodcast | 368/1,318 | 949 | 28% |
| @ComedyClubNews | 14/245 | 230 | 6% |
| @КомедиКлубКлюкиПодкаст | 2/139 | 137 | 1% |
| @comedyclubsport7786 | 0/47 | 47 | 0% |

The spread confirms and sharpens the 02-architecture sampling: coverage tracks
YouTube's ASR rollout, not our pipeline. Newer/active channels are near-total;
older or niche ones near-zero. **Transcript search is a long-tail bonus, never an
exhaustive layer** - the UI copy must keep saying so.

## Operational findings (new throttle shapes)

1. **A caption download can hang indefinitely.** The batch runner sat 18 minutes on
   one socket with zero writes. Detection: `Transcript.checked_at` stops advancing
   while the process lives. Fix: kill, then run stragglers individually via
   `fetch_and_store` under `timeout 120`.
2. **The caption endpoint rate-limits separately (explicit HTTP 429)** after ~570
   downloads in one evening - distinct from the metadata soft-block (which returns
   degraded payloads, not errors). Backoff of ~25 min cleared it twice; a subsequent
   570-fetch metadata re-backfill re-warmed it. Neither shape can poison data:
   `TranscriptThrottled` writes nothing.
3. **Batch indexing is end-of-run by design** (`services/transcripts.py` defers
   `schedule_transcript_reindex` until the loop finishes). Mid-run, Postgres fills
   while Meilisearch stays stale - looks alarming, is correct. An interim
   `reindex --only transcripts` is safe to run concurrently.

## The 2 stragglers

`MoMnxWU9zq8` (@ComedyClubNews) and `dfrZOLgSlTM` (@comedyclubpodcast) - both
public, both still 429/degraded at close. They remain in `pending_queryset`, so any
future `backfill_transcripts` run (or the next scheduled sweep) collects them.
Nothing false was recorded.

## Verification evidence

- `TranscriptSegment.objects.count()` == Meilisearch `numberOfDocuments` == 61,448.
- Live Bulgarian queries through `/api/search/transcripts`: "Ким Кардашиян" → 89
  segment hits, "ресторант" → 1,010, each with an exact `start_sec` deep link.
- Availability re-confirmed the same night by a full yt-dlp re-backfill of all 5 new
  channels: 0 degraded, distribution identical (55 members-only), +89 chapters on
  Клюки. See `specs/04-channel-ingestion/05-data-api-path.md`.
