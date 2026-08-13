# Channel ingestion run: four-channel batch of 2026-08-13

**Result:** ✅ 521 episodes created, searchable, avatars stored. ⚠️ **509 degraded -
`repair_metadata` owed on all four.** Transcripts deliberately not started.

## Context: this batch was knowingly run during an active soft-block

Earlier the same day, the `@comedyclubsport7786` run ended with a 10/10-throttled
caption probe. Before this batch, the block was verified to affect full metadata too:
`8MhDHHZE5x0` - ingested with `duration=10246` twenty minutes earlier - re-fetched as
`duration: None`. The owner chose to proceed anyway (a repair + transcripts session
was already planned), so the batch traded completeness now for a known, resumable
repair later. Flat listings (probes, dumps) were unaffected throughout; only the
player-response fields degrade.

Workers were reduced to 4 (`YOUTUBE_INGEST_WORKERS=4`) to avoid deepening the block.

## The channels

| Handle | Channel ID | Name | Probe | Created | Degraded |
| ------ | ---------- | ---- | ----- | ------- | -------- |
| `@КомедиКлубКлюкиПодкаст` | `UCi6J4WBZMHtZ2YIAqfDyoww` | Комеди Клуб Клюки Подкаст | 138 videos + 1 stream | 139 | **137 (99%)** |
| `@ComedyClubNews` | `UCQ-cZDkcZUYG5Hb9IeHz4Dw` | Comedy Club News Podcast / Подкаст Новини | 236 videos + 9 streams | 245 | **243 (99%)** |
| `@BFFPepiQ` | `UClo9PMxg3fLWOAMBE6ggl1w` | BFF с Пепи Кю | 79 videos + 1 stream | 80 | **80 (100%)** |
| `@delo404podcast` | `UCu3iYvciVyiwRKysLHA_wFg` | Дело 404 Crime Podcast | 57 videos, 0 streams, **17 shorts excluded** | 57 | **49 (86%)** |

Probe dumps saved in `tools/youtube-metadata/data/`:
`komediklubklyuki-2026-08-13.json`, `comedyclubnews-2026-08-13.json`,
`bffpepiq-2026-08-13.json`, `delo404podcast-2026-08-13.json`.

## What IS complete despite the block

- ✅ Titles, upload dates, youtube_ids, thumbnails: 0 missing across all 521.
- ✅ 0 duplicate ids, 0 errors, all runs finished.
- ✅ Meilisearch `episodes` index: 1,961 documents - every episode searchable.
- ✅ Avatars + banners + subscriber counts for all 7 channels
  (Sport has no banner on the channel itself).
- ✅ The few non-degraded rows carried real availability: 1 `subscriber_only` on
  Клюки, 8 on Дело 404 - so both channels DO have members-only content, which is
  exactly why the availability-defaults-to-public debt below matters.

## What is NOT complete (the debt)

- ❌ `duration_sec IS NULL` on 509 of 521 rows.
- ❌ `availability` defaulted to `"public"` on those rows - degraded members-only
  episodes are currently mis-flagged as public.
- ❌ `view_count`/`like_count` missing on degraded rows.
- ❌ Transcripts: not started for any of the four (owner directive), and still
  pending for `@comedyclubsport7786`.

## Close-out (one session, when the block lifts - hours, not minutes)

```bash
uv run python manage.py repair_metadata --probe 10          # block lifted?
uv run python manage.py repair_metadata --channel @КомедиКлубКлюкиПодкаст --delay 2
uv run python manage.py repair_metadata --channel @ComedyClubNews --delay 2
uv run python manage.py repair_metadata --channel @BFFPepiQ --delay 2
uv run python manage.py repair_metadata --channel @delo404podcast --delay 2
uv run python manage.py repair_metadata --channel @comedyclubpodcast --delay 2   # re-degraded by the sync incident, see below
# then transcripts for all five new channels, then:
uv run python manage.py seed_demo --clear   # owner directive: only real YouTube data stays
uv run python manage.py reindex
```

Closes ONLY on the counts: per-channel `degraded_queryset(ch).count() == 0`.

## 🚨 Postscript, same evening: the sync incident

While verifying this batch, the corpus-wide degraded count read **1,680**, not 509.
The daily sync (fired by Beat on container start, keyless yt-dlp fallback, running a
**stale 2026-08-08 worker image** without the upsert downgrade protection) had
re-scraped `@comedyclubpodcast`, tripped the soft-block that then hit this whole
evening, and overwritten **1,171 rows** the 2026-08-10 repair had closed. Fixes:
fallback capped (`YOUTUBE_SYNC_FALLBACK_LIMIT`), images rebuilt, gotcha documented.
Full detail in `docs/STATUS.md` 2026-08-13 entries.

## 🐛 Side find: percent-encoded Cyrillic URLs were unparseable

`https://www.youtube.com/@%D0%9A...` (how a browser copies a Cyrillic handle) failed
`normalize_channel_target` - `%` defeats every `CHANNEL_PATTERNS` regex. The decoded
form can't be passed through Git Bash either (argv mangles Cyrillic to `?`), so the
encoded URL is the only shell-safe spelling. Both the ingestion module and
`tools/youtube-metadata/fetch_video.py` now `unquote` the target first.
Regression test: `test_cyrillic_channel_handles_normalize` in `test_ingestion.py`.

## Also noticed

- The daily Celery Beat sync is live: it had added 1 new `@ivankirkov1` episode on
  2026-08-11 with full metadata (the Data API path is immune to the yt-dlp block).
  This is what corrected the day's corpus arithmetic from 1,439 to 1,440 pre-batch.
