# 26.02 - `sync_new_episodes`: one command that brings the catalogue current

**Status:** ✅ Built and run 2026-10-30 (§8). Written the same day after the owner asked
for "a command that on execute syncs any new videos and does everything for them".
**Supersedes §4-§6 of `01-analysis.md` for as long as production is switched off.**

---

## 0. What changed since 01-analysis

`01-analysis.md` (2026-09-25) assumed production was live, so the sync had to run on
Railway next to the private database, and the open question was whether yt-dlp works
from a Railway IP at all. Production has been **switched off since 2026-10-13**
(`specs/10-deployment/03-switched-off.md`). That flips the answer:

- ✅ The PC is now the only place anything gets written, so it is the natural runner.
- ✅ The home IP is the one IP proven to work with yt-dlp, so **availability, chapters
  and transcripts ride along in the same run**. Plan B from 01 §5 is moot for now.
- ⚠️ Local becomes the master copy until production comes back (§5).

## 1. What one new episode needs (the full checklist)

| # | What | Comes from | Stored in |
| - | ---- | ---------- | --------- |
| 1 | Is it new? `videos` + `streams` tabs, **never shorts** | Data API `UULF` / `UULV` playlists | - |
| 2 | Not a purged promo clip | `podcast/data/removed-episodes.txt` (115 ids) | - |
| 3 | Title, description, upload date, duration, views, likes, comments | Data API `videos.list` | Postgres `Episode` |
| 4 | Members-only or public | **yt-dlp** (the Data API cannot see it) | `Episode.availability` |
| 5 | Chapters, when the description has them | yt-dlp | `Chapter` |
| 6 | Thumbnail | HEAD `maxresdefault`, fall back to `hqdefault` | `Episode.thumbnail_url` - a Google URL, **never mirrored** |
| 7 | Transcript: YouTube's free `bg-orig` captions, cut into ~60s windows | yt-dlp | `Transcript` + `TranscriptSegment` |
| 8 | Searchable by title / description / labels | - | Meilisearch `episodes` |
| 9 | Searchable by what was said | - | Meilisearch `transcript_segments` |
| 10 | Topic labels | transcript digest → LLM → review | `EpisodeTopic`, attributed to the auto-labeller user |
| 11 | Channel avatar, banner, subscriber count (per channel) | yt-dlp | `Channel` |
| - | Scores | nothing to do - no ratings yet, the hourly recompute covers it | - |

**Every row already has a working function.** What is missing is the command that
strings them together, plus the four guards in §2.

## 2. The four gaps

1. 🚨 **No sync reads the exclusion list** (01 §3.1, still true). Any purged promo clip
   inside the newest-50 window comes straight back. → `removed_episode_ids()` in
   `podcast/data/`, applied in `sync_channel_via_api` **and** `backfill_channel`.
2. 🚨 **`remove_episodes` does not append to the list.** It deletes from Postgres and
   both indexes, but `removed-episodes.txt` is only ever written by hand. So a promo clip
   removed after a future sync comes back on the sync after that. → append the removed
   ids (deduplicated) to the file.
3. 🚨 **A fresh upload has no captions yet, and today that costs it 90 days.** YouTube
   generates the ASR track hours to days after upload. `fetch_and_store` records
   `unavailable` the moment it finds none, and `pending_queryset` does not re-check an
   `unavailable` row for `TRANSCRIPT_RECHECK_DAYS` (90). An episode synced on its upload
   day would lose its transcript for three months. → an episode younger than a grace
   period (proposed 7 days) with no captions writes **nothing** and stays pending, so the
   next run picks it up. Not a schema change.
4. ⚠️ **New members-only uploads arrive flagged public.** `sync_channel_via_api` stamps
   every new row `public` and silently skips ids the API returns nothing for. → a yt-dlp
   fetch for the **new ids only** (serial, 1-2s delay, a handful per run, so it can never
   become the thing that trips the soft-block).

Plus a docs bug: `CLAUDE.md` § Quick Commands lists `manage.py sync_channels`, which has
never existed (01 §2.1).

## 3. The command

```bash
uv run python manage.py sync_new_episodes                    # every active channel
uv run python manage.py sync_new_episodes --dry-run          # list what is new, write nothing
uv run python manage.py sync_new_episodes --channel @ivankirkov1
uv run python manage.py sync_new_episodes --limit 200        # look further back than the newest 50
uv run python manage.py sync_new_episodes --no-transcripts
```

Per channel:

1. List the newest N ids per tab through the Data API (~25 quota units for all seven
   channels, against 10,000/day).
2. Subtract ids already in the DB and ids on the exclusion list.
3. **Review gate** for promo clips (decision pending, see §7).
4. Data API details + thumbnail probe + upsert - the existing `sync_channel_via_api`,
   which also refreshes views/likes on the newest 50 for free.
5. yt-dlp per **new** id: availability + chapters.
6. Transcripts for the new ids, honouring the grace period, plus any older episode still
   pending from a previous run.
7. Reindex `episodes` and `transcript_segments` (inline locally, since
   `CELERY_TASK_ALWAYS_EAGER` is on in dev).
8. `last_synced_at`.
9. Report and verify (§4).

The work lives in a service function, `sync_new_episodes(channel, ...)` in
`services/ingestion.py`, so the command and any future Celery task run the same code.

- 🔒 **Refuses to run without `YOUTUBE_API_KEY`.** No silent fallback to scraping - that
  is the path that degraded 1,171 rows on 2026-08-13.
- 🚨 **Fails loudly if Meilisearch is down**, instead of finishing with new episodes that
  nothing can find.
- ⚠️ **If all N ids on a tab were new, the report says so** ("there may be more, re-run
  with `--limit 200`"). Relevant for the first run: the catalogue has not moved since
  2026-08-15.
- **Topic labels stay a separate step.** The command ends by printing the exact
  `export_topic_batches --skip-labelled --since <date>` line for the new episodes; the
  labelling and `import_topic_labels` follow. Automating the LLM step is optional (§7).

## 4. A run closes on COUNTS, not on the exit code

The final report, per channel: new, skipped (excluded), members-only, transcripts
stored / waiting (too fresh) / none, degraded. Then:

- `degraded_queryset().count() == 0` (the Data API path always carries a duration)
- Meilisearch `episodes` count == Postgres `Episode` count, and the same for segments
- no id from `removed-episodes.txt` present in `Episode`
- one new title found through `/search` in the local app (manual)

## 5. Local is the master copy while production is off

🚨 **Step 0, once, before the first sync.** What production held on 2026-10-13 (8 users,
6 profiles, 6 ratings, 23 moments, memberships, comments) exists **only** in
`comedy-prod-2026-10-13.dump` on the owner's machine. The local DB may not have it.
Back up local, `pg_restore --clean --if-exists --no-owner --no-privileges` the dump into
local, `reindex`, and check: 1,862 episodes, 1,861 transcripts, 61,333 segments.

After that, sync locally as often as wanted. **Turning production back on then means
restoring the local dump into production**, not redeploying the stale volumes. That is
safe for one reason only: production cannot take a write while it is off. Once it is
back on, that door closes again (01 §4) and the Railway path from 01 (Beat entry, key on
the worker, yt-dlp probe) is the one to build - on top of the same service function.
`03-switched-off.md` gets a note when this lands.

## 6. Build order

| # | Step | Test |
| - | ---- | ---- |
| 0 | Restore the 10-13 dump into local (overwrites the local DB - confirm first) | counts in §5 |
| 1 | `removed_episode_ids()` + guard in both sync paths | a listed id in the playlist → no row, `skipped_removed == 1` |
| 2 | `remove_episodes` appends to the list | removing an id leaves it in the file exactly once |
| 3 | Transcript grace period for fresh uploads | a 2-day-old caption-less episode writes nothing and stays pending |
| 4 | `sync_new_episodes` service + command, incl. the yt-dlp step for new ids | - |
| 5 | First real run: `--dry-run`, then for real, then the §4 checks | counts |
| 6 | Docs: `CLAUDE.md` quick commands, `docs/STATUS.md`, pointer from 01 | - |

Nothing here is a schema change.

## 7. Decisions

- ✅ **Promo-clip gate: ask about the short ones** (owner, 2026-10-30). The command lists
  every new candidate with its duration and asks yes/no for the short ones; `--yes`
  accepts all. A "no" goes onto the exclusion list so it never comes back. Duration is a
  hint, not a rule (100 of 1,962 past episodes were promo clips, and a 1:45 news
  bulletin was real), which is why a person answers.
- ✅ **Topic labels: the same way as the existing 2,565** - Claude in a Claude Code
  session reads the `export_topic_batches` output and writes the label JSON, then
  `import_topic_labels`. No Anthropic API is wired into this project and none is added.
- ✅ **Step 0: restored, by swapping databases rather than overwriting** (owner go-ahead
  2026-10-30, after the comparison in §8). The dump stays on the owner's machine,
  outside the repo.

## 8. What was built, and the first run (2026-10-30)

**Step 0 - compared before touching anything.** The 10-13 dump was restored into a
scratch database next to local (a Postgres 18 client container, since the dump is
format 1.16 and local runs 16; the only restore error was the PG18-only
`SET transaction_timeout`, harmless). Table by table, the catalogue was identical
(1,862 episodes, 61,333 segments, 2,565 topic links) and local was missing every
community row production held: 6 ratings, 23 moments, 17 people, 24 cast entries,
26 cast suggestions, 7 watch-log entries, 1 membership, 1 report, 2 accounts. Local's
only extras were dev residue (a `probeuser` account, one watch event by `demo`).
So the databases were **swapped by renaming**, not overwritten: the old local DB is
`podcast_local_20261030`, the restored dump is `podcast`. `migrate --check` clean,
episodes index rebuilt (1,862 = 1,862).

**Code.**

| Piece | Where |
| ----- | ----- |
| Exclusion list reader/writer | `podcast/data/__init__.py` (`removed_episode_ids`, `add_removed_episodes`) |
| List vs write split of the API sync | `services/ingestion.py` (`list_channel_uploads`, `persist_uploads`, `finish_channel_sync`); `sync_channel_via_api` is now those three |
| Exclusion in the yt-dlp path | `services/ingestion.backfill_channel` |
| `remove_episodes` appends | `management/commands/remove_episodes.py` |
| Fresh-upload grace | `services/transcripts.is_fresh_upload`, `TRANSCRIPT_FRESH_UPLOAD_DAYS = 7` |
| Premieres held back | `youtube_api.video_details` now returns `live_status`; `UploadCandidate.is_unfinished` |
| yt-dlp half, indexing, checks | `services/new_episodes.py` |
| The command | `management/commands/sync_new_episodes.py` |
| Tests | `tests/test_new_episodes.py` (12); with the guards removed, 4 of them fail |

**First run.** Dry run: 24 new on the channels, none under 15 minutes, 3 held as
unfinished (one stream scheduled for that evening, two stale "upcoming" streams from
2024 and 2025). Real run:

| | |
| - | - |
| New episodes | **21** (9 Kirkov, 7 Comedy Club Podcast, 5 Дело 404) |
| Transcripts | **20 stored**, +2,760 segments |
| Throttled | 2, nothing written, both still pending: `M-p3t22hpOw` (caption read timeout) and `MoMnxWU9zq8` (HTTP 429, the same episode pending since August) |
| Members-only among the new | 0 |
| Checks | 0 degraded; 0 excluded ids back; episodes 1,883 = 1,883; segments 64,093 = 64,093 |
| Search | `Тед Бънди` → the new Ted Bundy episode first; `Фрида Кало` → passages from the new Frida Kahlo episode |

Full backend suite: 1,876 passed, 0 failed.

⚠️ **170 episodes have a transcript and no topic label, not 20.** The other 150 predate
this work: the labelling round never covered most of BFF (~78) and Дело 404 (~55),
plus a few on the other channels. `export_topic_batches --skip-labelled` picks up all
of them in one pass.
