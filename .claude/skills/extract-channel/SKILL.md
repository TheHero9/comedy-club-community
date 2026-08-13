---
name: extract-channel
description: Ingest a YouTube channel's full back catalogue (videos + streams, never shorts) into the database, including its free YouTube captions as searchable transcript segments, with the throttle-detection and repair steps that a large backfill requires. Use when adding a new podcast channel, re-running a backfill, or when episodes are missing duration/availability/transcripts.
---

# Extracting a channel

Ingest every video and past live stream from a YouTube channel into Postgres, then
verify the metadata actually landed.

🚨 **The single most important rule on this page:** a backfill that reports
**`0 errors` is not necessarily complete.** YouTube soft-blocks large runs and yt-dlp
keeps returning reduced metadata *without raising*. Judge a run by its **degraded
count**, never its error count.

---

## Step 0 - Probe the raw metadata with the standalone tool

📺 **`tools/youtube-metadata/` is the research tool this whole pipeline was built from.**
It is standalone: no Django, no database, no migrations - it just asks YouTube what it
will give us and dumps JSON. Reach for it **before** touching the database when adding
a channel you have never ingested.

```bash
cd tools/youtube-metadata

python fetch_video.py "@handle"                      # videos + streams
python fetch_video.py "@handle" --fast               # listing only, no upload dates
python fetch_video.py "@handle" --limit 10 -o out.json
python fetch_video.py "https://youtu.be/VIDEO_ID"    # one video, full raw shape
```

It installs `yt-dlp` on first run if missing, and accepts `@handle`, `/channel/UC...`,
`/c/...`, `/user/...`, `watch?v=`, `youtu.be/`, `/shorts/`, or a bare 11-char id.

**Save the dump** next to the existing one so each channel's real shape is on record:

```bash
python fetch_video.py "@handle" -o "data/<handle>-$(date +%Y-%m-%d).json"
```

Existing reference dump: `data/ivankirkov1-2026-08-08.json` (74 episodes).

⚠️ **Every rule in this skill came from that tool's findings, and they came from ONE
channel.** Chapter availability, description quality and the shorts/streams ratio will
differ per channel. Read `tools/youtube-metadata/README.md` - it is the source document
for the three-tab rule, the members-only fix and the thumbnail strategy.

Use it when you want to answer: *what does this channel actually look like, and does
anything here break my assumptions?* Then use Step 1 for the go/no-go number.

## Step 1 - Probe sizing before you ingest

Never start a backfill without knowing the channel's size. One cheap request per tab,
straight from the real ingestion code path (so it counts exactly what will be written):

```bash
cd apps/api
uv run python manage.py backfill_channel @handle --probe
```

Expect output like:

```
  videos  : 979  (ingested)
  streams : 339  (ingested)
  shorts  :  27  (NEVER ingested)
  => 1318 episodes would be ingested
```

- 🚨 **A channel's catalogue spans three tabs.** `/videos` alone silently loses past
  live streams, which for a podcast **are episodes**.
- 🚨 **Shorts are never ingested** (owner decision 2026-08-08). They are promo clips.
  Reversing this costs a full re-backfill.
- ⚠️ If the probe reports **more than ~500 episodes**, drop the worker count for the
  run (see step 2). 8 workers tripped YouTube's throttle at ~1,300.

## Step 2 - Run the backfill

```bash
uv run python manage.py backfill_channel @handle
```

For a large channel, go slower on purpose. The repair pass costs far more time than
the parallelism saves:

```bash
YOUTUBE_INGEST_WORKERS=4 uv run python manage.py backfill_channel @handle
```

Useful flags: `--limit N` (smoke test), `--dry-run` (write nothing),
`--skip-thumbnail-check` (skip one HEAD per video).

Notes:
- Members-only episodes ingest fine with no login - `ignore_no_formats_error` is
  already wired. Paywalled episodes must be listed, searched and rated like any other.
  **We never touch the media.**
- Re-running is safe: `update_or_create` on `youtube_id`, and a throttled re-run can no
  longer downgrade rows that are already correct.
- Meilisearch reindex fires automatically via Celery at the end.

## Step 3 - Read the completeness verdict, not the error count

The command now ends with one of two verdicts. **Do not skip this.**

✅ Good:
```
Metadata complete - no repair needed
```

🚨 Bad:
```
🚨 INCOMPLETE: 1036 of 1318 episodes (79%) were written from a THROTTLED response.
```

If you see the second one, the run **succeeded but is not finished**. The rows exist
and are searchable, but they have no duration, and their `availability` defaulted to
`"public"` - so a members-only episode may be wrongly flagged public.

## Step 4 - Repair, if needed

⚡ **First choice since 2026-08-13: the Data API repair.** It is immune to the
soft-block (quota-based, 50 rows per unit) and recovered 1,680 rows in one pass the
day it was built. Needs `YOUTUBE_API_KEY` in `apps/api/.env`:

```bash
uv run python manage.py repair_metadata --api                    # all channels
uv run python manage.py repair_metadata --api --channel @handle
```

- ⚠️ It repairs duration/view/like/comment counts but **never availability** - the
  API returns members-only videos without saying so. Rows it cannot see
  (deleted/private) stay degraded on purpose.
- 🔒 A members-only flag can only be set/corrected by the yt-dlp path below.

**yt-dlp fallback** (no key, or to state availability):

⏳ **Wait first.** The block lasts **hours, not minutes.** Probing immediately after a
throttled run recovered 0/8. There is no "retry harder".

```bash
# Has the block lifted? Writes nothing beyond the N tested.
uv run python manage.py repair_metadata --probe 10

# Then the full sweep. Serial and slow on purpose.
uv run python manage.py repair_metadata --channel @handle --delay 2
```

- The repair **only writes from a full response**, so running it too early is a no-op,
  never a second round of data loss.
- It aborts after 25 consecutive degraded responses instead of wasting an hour.
- It is fully resumable - if it stops at 964/1036, just run it again for the rest.

## Step 5 - Channel avatar, banner, subscriber count

Not part of the episode backfill. One cheap request per channel:

```bash
uv run python manage.py refresh_channel_meta @handle    # or omit for all channels
```

🚨 Unlike thumbnails, an avatar URL is an **opaque hash** that nothing predicts, so it
is stored - and it changes when the owner changes their picture. Re-run this
periodically. Still never mirrored to R2.

## Step 6 - Transcripts: fetch the channel's free captions

Every ingested channel also gets its transcripts extracted. YouTube already holds a
Bulgarian auto-caption track (`bg-orig`) for part of the catalogue - free, no ASR, no
API key. They land in **separate tables built for search**: `Transcript` (one status
row per episode) + `TranscriptSegment` (~60s windows, `start_sec` = exact YouTube deep
link), indexed into the **second Meilisearch index** `transcript_segments`. Transcript
text never enters the `episodes` index - two indexes, two questions: `episodes` =
"which episodes are ABOUT this", `transcript_segments` = "where was this SAID".

⏳ **Do not run this right after a throttled backfill.** A caption fetch is a second
request per episode, and a degraded response looks *exactly* like "no captions". The
fetcher refuses to record "none" without a `duration` (raises `TranscriptThrottled`,
writes nothing), so running while blocked wastes time but never poisons data.

```bash
# 1. Probe coverage first - is this channel worth a long run?
uv run python manage.py backfill_transcripts --channel @handle --probe 10

# 2. Full channel run. Serial and slow on purpose; resumable; aborts itself
#    after 10 consecutive throttled responses.
uv run python manage.py backfill_transcripts --channel @handle
```

- ✅ **Run it for the whole channel, not just recent uploads.** "No captions" is stored
  as `status="unavailable"` with a `checked_at`, so old caption-less episodes are
  checked once, not re-fetched forever (re-checked after `TRANSCRIPT_RECHECK_DAYS`).
  `--since 2024-01-01` is only for a quick first pass - coverage sampled 2024-2026 was
  9/9, 2019-2022 was 0/12.
- 🔒 **Members-only episodes have NO captions** (0 of 5 checked). Expect them all in
  the `no captions` count - that is correct, not a failure. We never touch the media.
- ✅ Indexing queues via Celery automatically; if no worker is running, finish with
  `uv run python manage.py reindex --only transcripts`.
- ⚠️ Never present transcript search as exhaustive - coverage is partial and
  date-dependent by nature.

## Step 7 - Verify what actually landed

```bash
uv run python manage.py reindex     # only if the repair changed anything
```

Then check field completeness, not row counts:

```bash
PYTHONIOENCODING=utf-8 uv run python manage.py shell -c "
from podcast.models import Channel, Episode, Transcript, TranscriptSegment
from podcast.services.metadata_repair import degraded_queryset
from django.db.models import Count
ch = Channel.objects.get(handle='@handle')
qs = Episode.objects.filter(channel=ch)
tr = Transcript.objects.filter(episode__channel=ch)
print('episodes :', qs.count())
print('degraded :', degraded_queryset(ch).count())
print('no date  :', qs.filter(upload_date__isnull=True).count())
print('no thumb :', qs.filter(thumbnail_url='').count())
for r in qs.values('availability').annotate(n=Count('id')): print(' ', r)
print('transcripts stored :', tr.filter(status=Transcript.Status.OK).count())
print('known caption-less :', tr.filter(status=Transcript.Status.UNAVAILABLE).count())
print('never checked      :', qs.exclude(id__in=tr.values('episode_id')).count())
print('segments           :', TranscriptSegment.objects.filter(transcript__episode__channel=ch).count())
"
```

| Check | Expected |
| ----- | -------- |
| `degraded` | **0** |
| missing `upload_date` / `thumbnail_url` / `title` | 0 |
| null `view_count` | equals the `subscriber_only` count (members-only omit it) |
| duplicate `youtube_id` | 0 |
| transcripts `never checked` | **0** - every episode has a `stored` or `unavailable` verdict |
| members-only with a stored transcript | 0 (they have no captions) |

---

## Then update the docs

1. Add the channel to the table in `CLAUDE.md` § Channels.
2. Add a run write-up to `specs/04-channel-ingestion/`.
3. Log it in the `docs/STATUS.md` decisions table.

---

## 🪟 Windows gotchas that will bite

- **Prefix anything that prints Bulgarian** with `PYTHONIOENCODING=utf-8`. The console
  is cp1252 and dies on Cyrillic. It is an output failure only - the data is fine.
- **Never test a Cyrillic endpoint with `curl` from Git Bash.** It mangles non-ASCII
  argv to `?`, which tokenizes to nothing and makes search return *everything*. Use
  Python or the Django test client.
- **Postgres is on 54320**, not 5432. Two native Windows Postgres services own
  5432/5433.
- Prefer `127.0.0.1:8000` over `localhost:8000` - the latter stalls ~2.1s per request.

---

## Reference

- 📺 **Probe tool + original findings: `tools/youtube-metadata/README.md`** - read this
  first for any channel you have not ingested before. `fetch_video.py` is the standalone
  prober; `data/` holds the per-channel dumps.
- Full post-mortem: `specs/04-channel-ingestion/01-comedyclubpodcast-run.md`
- Avatars: `specs/04-channel-ingestion/02-channel-avatars.md`
- Transcripts: `specs/06-transcripts/02-architecture.md` (two-index design, windowing,
  throttle-vs-no-captions distinction)
- Code: `podcast/ingestion/`, `podcast/services/ingestion.py`,
  `podcast/services/metadata_repair.py`, `podcast/services/transcripts.py`,
  `podcast/ingestion/transcripts.py`, `podcast/search/transcript_index.py`
- Regression tests: `podcast/tests/test_ingestion.py` (throttled-response protection);
  transcript search behaviour is covered in `podcast/tests/test_api_search.py` and
  `podcast/tests/test_search_unsearchable_queries.py`
