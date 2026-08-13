# The YouTube Data API path (built 2026-08-13)

**Result:** the deferred wave-5 piece exists. With `YOUTUBE_API_KEY` set, the daily
sync and metadata repair run on the quota-based Data API - immune to the yt-dlp
soft-block that shaped every incident this week. Built, tested (17 new tests, 443
total), and used the same evening to repair 1,680 degraded rows in one pass.

## Why

The yt-dlp soft-block is IP-reputation-based, silent, and lasts hours. The Data API
has a documented free quota instead: 10,000 units/day, where one `videos.list` call
covers 50 videos for 1 unit. The entire 1,961-episode catalogue costs ~40 units to
re-verify. The two paths are complementary:

| | yt-dlp (scraping) | Data API (quota) |
| - | - | - |
| One-time backfills | ✅ the right tool | not built for discovery at that shape |
| Daily sync | fallback only, capped | ✅ steady state |
| Repair duration/views | slow, serial, blockable | ✅ 50 rows/unit, block-immune |
| **State availability** | ✅ **the ONLY source** | ❌ never (see blind spot) |
| Transcripts/captions | ✅ the only free source | ❌ captions.download needs OAuth |

## What was built

- `podcast/ingestion/youtube_api.py` - stdlib-only client: `video_details` (batched
  50/call), `playlist_video_ids` (paginated), `uploads_playlists`,
  `parse_iso8601_duration`.
- `repair_metadata --api` → `repair_degraded_via_api`: repairs
  duration/view/like/comment counts; never writes availability; leaves API-absent
  ids (deleted/private) degraded for the yt-dlp sweep.
- `sync_channel_via_api`: the Celery daily sync's keyed path. Uses the derived
  playlists `UULF<id>` (videos tab) and `UULV<id>` (streams tab), so **Shorts stay
  structurally excluded** - the same guarantee as yt-dlp's tab listing. A missing
  `UULV` playlist (channel never streamed) reads as empty, not an error.
- `upsert_episode` grew **absent-means-unknown guards**: a payload without
  `availability`/`thumbnail_url` keeps the stored values on existing rows. This is
  what makes the nightly API sync unable to flip a members-only row to public.
- Bug fix en route: `repair_episode`'s availability correction now updates the
  denormalized `members_only` in the same `.update()` (it bypasses `save()`).

## 🔍 The measured blind spot

Sweep of all 1,961 rows, 2026-08-13: **`videos.list` returns members-only videos
(all 55 of ours, durations intact) but nothing in the response marks them as
members-only.** Consequences, encoded in the code:

- The API paths never write `availability`. Only yt-dlp states it.
- A brand-new members-only episode arriving via the API sync lands flagged public
  until the next yt-dlp pass corrects it.
- Absence from a response means deleted/private - treated as "unknown", never data.

## Verification (all counts, 2026-08-13)

- `repair_metadata --api`: 1,680 repaired, 0 still degraded, 0 errors.
- Full-corpus sweep: 1,961/1,961 returned; 0 missing duration/date/title/thumbnail;
  0 duration mismatches (>2s tolerance).
- Availability flags match every known members-only count (37+9+8+1 = 55), and the
  batch's members-only rows were exactly the rows that returned FULL during the
  block - evidence the degraded-row "public" defaults were genuinely public.
- 443 backend tests pass; worker/beat images rebuilt with this code and the key
  wired via root `.env` → docker-compose → containers.

## Still owed (yt-dlp block, hours)

- Transcripts for the 5 new channels (captions are yt-dlp-only).
- Optional: a yt-dlp availability sweep over the 5 new channels as belt-and-braces.
