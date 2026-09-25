# 26 - Keeping the catalogue current: the new-episode pipeline

**Status:** 📝 Analysis only, nothing built. Written 2026-09-25 after the owner asked
how new uploads on the seven channels get into the app without someone adding them
by hand, and whether "a loop on my computer" would do it.

**Short answer:** the loop has to run where the production database is (Railway),
not on the PC, because Postgres is private by design. Most of the pipeline already
exists as code; what is missing is one exclusion check, one env var, one Beat entry
and one probe. The one genuinely open question is whether yt-dlp works from Railway's
IP, and that decides whether transcripts ride along or need a Plan B.

---

## 1. How stale is production right now

Measured 2026-09-25 against `https://api.comedycommunity.club/api/channels`:

| Channel | Episodes | `last_synced_at` |
| ------- | -------- | ---------------- |
| every one of the seven | 1,862 total | **2026-08-15 10:01 UTC** |

That is the day the catalogue was restored into production. Nothing has pulled a new
upload since - 41 days. The only sync that ever ran on a schedule added one
`@ivankirkov1` episode on 2026-08-11 (locally) before the schedule was removed.

## 2. What "ingesting an episode" actually consists of

Read off the code, not the docs. Every step below has a working implementation.

| # | Step | Where it lives | Runs via | Needs |
| - | ---- | -------------- | -------- | ----- |
| 1 | List new ids on the `videos` + `streams` tabs (never shorts) | `ingestion/youtube_api.py` `uploads_playlists` + `playlist_video_ids` (`UULF`/`UULV` playlists) | Data API | `YOUTUBE_API_KEY`, ~2 units per channel |
| 2 | Full metadata for those ids: title, description, date, **duration**, views, likes | `youtube_api.video_details` (50 ids per unit) | Data API | 1 unit per 50 ids |
| 3 | Thumbnail: HEAD-probe `maxresdefault`, fall back to `hqdefault`, store the URL | `ingestion/thumbnails.best_thumbnail_url` (called only for NEW rows in `sync_channel_via_api`) | plain HTTP to Google | nothing |
| 4 | Upsert the row, keyed on `youtube_id`, with the absent-means-unknown guards | `services/ingestion.upsert_episode` | - | - |
| 5 | Chapters, if the description carries them | `upsert_episode` (opportunistic; yt-dlp path only, the API path passes none) | - | - |
| 6 | Reindex the channel into Meilisearch `episodes` | `services/indexing.schedule_channel_reindex` -> task `podcast.reindex_channel` | Celery | worker |
| 7 | **Availability** (members-only or public) | only the **yt-dlp** path states it (`repair_metadata --channel @handle`); the Data API cannot | yt-dlp | an IP YouTube tolerates |
| 8 | **Transcript**: fetch `bg-orig` captions, window into ~60s segments, store, index into `transcript_segments` | `services/transcripts.backfill_transcripts` -> task `podcast.backfill_transcripts` / `podcast.fetch_episode_transcript` | yt-dlp, serial, 1s delay | same |
| 9 | Topic labels | `export_topic_batches` -> human/LLM review -> `import_topic_labels` | manual | a person |
| 10 | Scores | `recompute-scores-hourly` already on Beat | Celery | nothing |

Steps 1-6 are what `sync_channel_via_api` does today in one function, and the Celery
task `podcast.sync_all_channels` fans it out per active channel. **It has never run in
production.**

### 2.1 The one piece the docs claim that does not exist

`CLAUDE.md` and `docs/STATUS.md` both say new episodes are pulled "deliberately with
`manage.py sync_channels`". There is **no such management command** -
`podcast/management/commands/` has `backfill_channel`, `repair_metadata`,
`backfill_transcripts`, `refresh_channel_meta`, `reindex`, `remove_episodes` and the
rest, but nothing named `sync_channels`. The only entry points to the sync are the two
Celery tasks. So the "pull it by hand" fallback the 08-15 decision relied on was never
actually available, which is part of why nothing has been pulled since.

## 3. Why it is unscheduled, and what has to be true before it is scheduled again

`config/celery.py` deliberately has no sync entry (owner decision 2026-08-15). The
reason is real and still holds: on 2026-08-15 a manual review removed **100 promo
clips** (ids in `podcast/data/removed-episodes.txt`), and ingestion is
`update_or_create(youtube_id=...)`, so any sync that lists them recreates them.

### 3.1 🚨 The sync does not read the exclusion list

Verified 2026-09-25: neither `sync_channel_via_api` nor `backfill_channel` nor
`upsert_episode` opens `removed-episodes.txt`. The file ships in the image, but the
only reader is `remove_episodes` itself. `podcast/data/__init__.py` explains why the
file lives there and then exposes nothing.

Concretely: the API sync lists the newest 50 per tab. Any purged clip that is still
inside that window on its channel comes back on the first run, with a fresh
`created` count that looks like good news. The older ones come back the day someone
raises `limit`. **This is the single blocker**, and it is a small one: load the list
once, skip those ids in the sync loop, pin it with a test that feeds a removed id
through the listing and asserts no row.

### 3.2 🚨 Production has no `YOUTUBE_API_KEY`

Read back from Railway on 2026-09-25: `celery-worker` and `api` both carry
`CLERK_*`, `DATABASE_URL`, `MEILI_*`, `REDIS_URL` - and no `YOUTUBE_API_KEY`. The
key exists only in the local `.env`. `docs/STATUS.md` row 5 still says "Data API path
awaits `YOUTUBE_API_KEY`", and it is right.

Without the key the task falls back to yt-dlp scraping (capped at 25 newest per
tab). For a scheduled job that is the wrong failure mode for two reasons: it is the
exact path that degraded 1,171 rows on 2026-08-13, and it is silent - a `WARNING` in
the worker log and nothing else. **The scheduled task should refuse to run keyless**
rather than scrape. The keyless fallback can stay for the CLI, where a person is
watching.

### 3.3 The Data API path is the right one for the recurring job

- Quota: per run, ~2 `playlistItems` calls per channel + 1 `videos.list` per 50 ids.
  Seven channels is roughly **25 units per run** against 10,000 per day. Hourly would
  still be under 1% of quota; daily is nowhere near a limit.
- Immune to the yt-dlp soft-block, which is the failure every ingestion incident on
  this project traces back to.
- Structurally excludes shorts (`UULF`/`UULV` playlists).
- Also refreshes views/likes/comment counts on the newest 50 of each channel as a side
  effect, which is the only thing keeping those numbers from being frozen at 08-15.

What it cannot do: **state availability** (a new members-only episode lands flagged
public until a yt-dlp pass says otherwise) and **fetch captions**. Both need yt-dlp.

## 4. Where the loop runs - and why not the PC

The owner's instinct was a scheduled loop on the dev machine. It cannot do the job by
itself:

- The production database is on Railway's **private network only**
  (`Postgres.railway.internal`). The TCP proxy is enabled for a restore and disabled
  again immediately; it is not meant to be left open for a nightly job from a home IP.
  Same for Redis and Meilisearch.
- Production now holds community data that local does not (ratings, moments,
  memberships, comments, watch log). A "sync locally, `pg_restore` to prod" cycle -
  which is how the catalogue got there on 08-15 - would now overwrite real members'
  writes. That door is closed for good.

So metadata sync runs **on Railway**, where the code, the worker, Beat and the DB
already are. Three ways to trigger it, one recommended:

| Option | Verdict |
| ------ | ------- |
| **Celery Beat entry** on the existing `celery-beat` service | ✅ Recommended. Zero new infrastructure; the task, the worker and the retry already exist. |
| Railway cron service running `manage.py` on a schedule | Works, but a second runner for the same code. Only worth it if Beat ever goes. |
| Windows Task Scheduler on the PC | ❌ For metadata - no path to the DB. See §6 for the one role the PC might keep. |
| GitHub Actions cron | ❌ Same problem: no path to the DB. |

⚠️ Beat fires an overdue job the moment it starts. With the exclusion list in place
and the Data API path, an unexpected run is harmless - that is the property that makes
scheduling safe, and it is why §3.1 comes first.

## 5. Transcripts and availability: the open question

Both depend on yt-dlp, and yt-dlp depends on YouTube tolerating the caller's IP. Every
transcript this project has was fetched from the owner's home connection. **Nobody
has ever run yt-dlp from a Railway container.** Datacenter ranges are exactly where
YouTube most often answers with a sign-in wall or the reduced payload this codebase
calls "degraded".

This is a measurement, not a debate, and it is cheap:

```
preDeployCommand on celery-worker:
  python manage.py backfill_transcripts --probe 3 --channel @ivankirkov1
```

One command, one deployment, read the deploy log, clear it. Three outcomes:

- **`stored` for a 2024+ episode** -> Railway's IP works today. Schedule step 8 too.
- **`TranscriptThrottled` x3** -> blocked. The fetcher writes nothing on a throttled
  response (it refuses to record "no captions" without a duration), so the probe
  cannot poison data. Go to Plan B.
- **`unavailable`** on an episode known to have captions locally -> also blocked, but
  in a way the guard did not catch. Treat as blocked and check the guard.

⏳ Note the block is stateful per IP and lasts hours; "works once" is not "works
nightly". If it works, the nightly job must stay small (20-30 pending episodes,
serial, 1s delay - `backfill_transcripts` already aborts after 10 consecutive
throttles) so that it never becomes the thing that trips the block.

### Plan B if Railway is blocked

The PC is the only IP proven to work, and it cannot reach the DB. The honest options:

1. **Accept metadata-only in production, transcripts on demand.** New episodes are
   browsable, ratable and searchable by title within a day. Captions for new
   episodes are fetched in batches from the PC and moved to prod... by what path? There
   is none today. This is where it stops being free.
2. **A push endpoint.** `POST /api/admin/episodes/{youtube_id}/transcript` taking the
   windowed segments (the shape `store_transcript` already receives), admin-only,
   throttled, plus the same for availability. The PC runs the yt-dlp half and posts
   the result. New write surface, needs auth and tests, but it is the shape that keeps
   Postgres private and lets the PC do the one thing only it can.
3. **Cookies / a residential proxy for the container.** Rejected: it is the "retry
   harder" this project has already learned does not exist, and it puts the owner's
   Google session into a Railway variable.

Recommendation: run the probe first. Decide between 1 and 2 only if it fails.

## 6. The proposed pipeline, end to end

One service function, called by one management command and one Celery task, so CLI
and scheduler cannot drift (the existing rule).

```
sync_new_episodes(channel)                       # services/ingestion.py
  1. ids  = Data API newest N per tab            # N = 50 default
  2. ids -= removed_episode_ids()                # 🚨 the missing step
  3. details = video_details(ids)
  4. for each id: upsert_episode (+thumbnail probe for NEW rows)
  5. schedule_channel_reindex(channel)
  6. return IngestionResult (created / updated / skipped_removed / degraded)

manage.py sync_new_episodes [--channel @handle] [--limit N] [--dry-run]
podcast.sync_new_episodes  (Beat, daily)  -> refuses to run without YOUTUBE_API_KEY
podcast.backfill_transcripts (Beat, nightly, limit=25)   -> ONLY if the §5 probe passes
```

Beat schedule proposal:

| Entry | When (UTC) | Why |
| ----- | ---------- | --- |
| `sync-new-episodes-daily` | 03:30 | Before the 05:00 index rebuild, so a new episode is in the freshly built index. Podcasts upload weekly-ish; a day of lag is invisible. Hourly would be quota-cheap but pointless, and each run queues a per-channel reindex. |
| `fetch-new-transcripts-nightly` | 03:45, `limit=25` | Conditional on §5. Pending set is "new rows + caption-less rows older than 90 days", newest first, so new uploads go first. |

Things that stay manual, on purpose:

- **Availability of a new episode** - a yt-dlp pass (`repair_metadata --channel`) from
  the PC when a members-only upload is suspected. The API path cannot see it and must
  not guess. Today's 55 members-only rows are safe: the guards keep stored values.
- **Topic labels** - `export_topic_batches` -> review -> `import_topic_labels`. That is
  a review step by design; a scheduled job cannot do it. Run it every few weeks over
  episodes with a stored transcript and no labels.
- **Channel avatars** (`refresh_channel_meta`) - could be a monthly Beat entry; also a
  yt-dlp call, so it inherits the §5 answer.

## 7. What closes it (counts, never the command exiting)

- `/api/channels` shows `last_synced_at` within 24h for all seven.
- `created` > 0 on the first production run (the channels have uploaded since 08-15).
- Every id in `removed-episodes.txt` absent from `/api/episodes` after the run.
- `degraded_queryset().count()` unchanged (the API path always carries a duration).
- `/search` finds a post-08-15 episode by title the morning after.
- If transcripts are scheduled: `Transcript.objects.filter(status="ok")` growing,
  and the worker log showing zero `Throttled` lines on a normal night.

## 8. Build list, in order

1. `removed_episode_ids()` in `podcast/data/` (reuse `remove_episodes.parse_ids`),
   applied in `sync_channel_via_api` **and** `backfill_channel`. Test: a listed id in
   the playlist -> no row, `skipped_removed == 1`.
2. `manage.py sync_new_episodes` - the command the docs already describe.
3. Scheduled task refuses to run without `YOUTUBE_API_KEY` (raise, do not scrape).
4. Set `YOUTUBE_API_KEY` on `celery-worker` in Railway (only the worker executes
   tasks; `api` and `celery-beat` do not need it). Read it back.
5. Beat entry `sync-new-episodes-daily`; rebuild the worker and beat images (they
   bake code - the 08-13 lesson); deploy `api` -> `celery-worker` -> `celery-beat`.
6. First run: read the worker log for the seven `API sync of ... complete` lines and
   check §7.
7. yt-dlp probe from Railway (§5). Then either the transcript Beat entry or Plan B.
8. Fix `CLAUDE.md` / `STATUS.md`: the command name, the schedule, the key.

Nothing here is a schema change.
