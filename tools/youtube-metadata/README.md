# 📺 YouTube Metadata Probe

A standalone `yt-dlp` spike used to answer one question before Phase 1 ingestion is built:
**what can we actually get out of a Bulgarian podcast channel, and what will bite us?**

It is a throwaway research tool, not production code. The findings below are the real
deliverable - they should shape `podcast/ingestion/yt_dlp_backfill.py`.

Probed against `@ivankirkov1` (74 long-form episodes) on 2026-08-08.

---

## ⚡ Usage

```bash
python fetch_video.py                                          # sample video
python fetch_video.py "https://youtu.be/FP1P8XXYzvE"           # one video
python fetch_video.py "@ivankirkov1"                           # channel: videos + streams
python fetch_video.py "@ivankirkov1" --tabs all                # add Shorts too
python fetch_video.py "@ivankirkov1" --fast                    # listing only, no upload dates
python fetch_video.py "@ivankirkov1" --limit 10 -o out.json
```

Installs `yt-dlp` on first run if missing. Accepts `@handle`, `/channel/UC...`, `/c/...`,
`/user/...`, `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, or a bare 11-char video id.

Output per video:

```json
{
  "id": "KaZG3h2if_0",
  "title": "Историята на Каспаров срещу най-големия му противник...",
  "channel": "Ivan Kirkov",
  "duration_sec": 3935,
  "upload_date": "2026-06-28",
  "thumbnail_url": "https://img.youtube.com/vi/KaZG3h2if_0/maxresdefault.jpg",
  "tab": "videos",
  "availability": "subscriber_only",
  "members_only": true
}
```

Sample dump: `data/ivankirkov1-2026-08-08.json` (74 episodes, 100% complete metadata).

---

## 🔍 Findings

### 1. 🚨 A channel's episode count is spread across three tabs

The channel page said **89 videos**. Scraping `/videos` returned **72**. Nothing was
blocked or rate-limited - YouTube's badge counts three separate tabs:

| Tab | `@ivankirkov1` | What it holds |
| --- | --- | --- |
| `/videos` | 72 | Long-form uploads |
| `/shorts` | 15 | Shorts |
| `/streams` | 2 | Past live streams |
| **Total** | **89** | = the number on the channel page |

**Implication for ingestion:** a backfill that reads only `/videos` silently loses every
past live stream. For a podcast channel those streams *are* episodes. `backfill_channel`
must iterate tabs explicitly and record which tab each episode came from.

**Recommendation:** ingest `videos` + `streams` as `Episode`. Shorts are promo clips, not
episodes - either skip them or flag them so they can be excluded from browse and scoring.
This tool defaults to `videos,streams` for that reason; `--tabs all` includes Shorts.

### 2. 🔓 Members-only videos give up full metadata without any login

9 of 74 episodes are members-only. yt-dlp fails them by default:

```
ERROR: Join this channel to get access to members-only content like this video
```

That error is about **playable formats, not metadata**. One option turns it into a warning
and the full metadata comes through:

```python
"ignore_no_formats_error": True    # CLI: --ignore-no-formats-error
```

No cookies, no login, no paid membership. Title, duration, upload date, description and
`availability` all resolve normally. Coverage on the test channel went from 65/74 to
**74/74 with zero errors**.

**Implication:** paywalled episodes can be listed, searched, rated and labelled like any
other. Only the media itself is gated, and we never touch the media.

**Recommendation:** store `availability` on `Episode` (`public` / `subscriber_only` /
`unlisted`) so the UI can badge members-only episodes instead of pretending they do not
exist. Note this is a schema deviation from `docs/01-canonical-models.py` - **ask before
adding the field.**

### 3. 🖼️ Thumbnails need no API call (confirms the brief)

`https://img.youtube.com/vi/{ID}/maxresdefault.jpg` existed for **74/74** episodes, so the
`hqdefault.jpg` fallback never fired. Still keep the fallback - older uploads on other
channels will need it. A `HEAD` request is enough to test presence, no download required.

### 4. ⚠️ No chapters, and descriptions are nearly empty

The brief expects yt-dlp to supply structured `chapters`. On this channel it does not:

| Signal | Result across a 12-episode sample |
| --- | --- |
| Episodes with `chapters` | **0 of 12** |
| Description length | avg **118 chars**, min **0**, max 556 |

**Implication:** this is the strongest possible argument *for* the community-labelling
model. There is no creator-supplied structure to lean on - no chapter titles, no show
notes. Search built on `title + description` alone would be almost useless here, because
the description is often one line or blank.

**Recommendation:** do not build the `Chapter` ingestion path assuming chapters will
arrive. Populate `Chapter` opportunistically when present, and treat community `Moment`
labels as the primary timestamp source. Verify chapter availability per channel before
counting on it for the other 5-7 channels.

### 5. ⏱️ Backfill cost

74 episodes in **41.7s** with 8 parallel workers, roughly **0.56s per episode** wall clock.

| Scale | Estimated time |
| --- | --- |
| 74 episodes (one channel) | ~42s |
| ~1,000 episodes (full backfill) | **~10 minutes** |

The flat channel listing is nearly free (one request per page, ~2s for 89 entries) but
returns **no upload date** - `timestamp` is `null` on flat entries. Dates require one full
extraction per video, which is where all the time goes. Hence the two modes here
(`--fast` vs default).

**Recommendation:** the backfill is cheap enough to run in one pass. Keep it resumable
anyway (`update_or_create(youtube_id=...)`) so a mid-run failure costs nothing.

### 6. 📋 Fields available per episode

| Field | Present? | Notes |
| --- | --- | --- |
| `id`, `title`, `duration`, `upload_date` | ✅ always | Date is `YYYYMMDD`, normalize it |
| `channel`, `channel_id` | ✅ always | `channel_id` is the stable `UC...` key |
| `availability` | ✅ always | `public` / `subscriber_only` |
| `language` | ✅ `bg` | Useful for Meilisearch tokenization |
| `categories` | ✅ `Comedy` | Low value |
| `description` | ⚠️ thin | avg 118 chars, sometimes empty |
| `view_count` | ⚠️ | **Missing on members-only videos** |
| `tags` | ⚠️ | 0-4 tags, mostly empty |
| `chapters` | ❌ never | See finding 4 |

### 7. 🧨 Fragility

yt-dlp now warns that extraction without a JavaScript runtime is deprecated:

```
WARNING: No supported JavaScript runtime could be found. Only deno is enabled by default
```

Metadata-only extraction works fine without it, since the JS runtime is needed to decipher
**formats**, which we never request. If anyone later adds downloading, Deno becomes a
dependency.

This reinforces the rule already in `CLAUDE.md`: **yt-dlp is scraping and will break.**
Correct as the one-time backfill, never as the daily sync. YouTube Data API v3 owns the
recurring path.

---

## 🔗 Relevance to Phase 1

| Finding | Affects |
| --- | --- |
| Three tabs, not one | `backfill_channel` command - iterate `videos` + `streams` |
| Members-only metadata is free | `Episode.availability` (schema deviation - ask first) |
| No chapters, thin descriptions | `Chapter` ingestion priority, Meilisearch document design |
| Thumbnails derivable | Confirms the no-API-call thumbnail rule in the brief |
| ~10 min for 1,000 episodes | Backfill can be a single foreground run |

## ⚠️ Caveats

- Findings come from **one channel**. Chapter availability, description quality and
  Shorts/streams ratios will differ across the other 5-7 channels. Re-probe each one
  before finalising ingestion assumptions.
- This tool fetches **metadata only**. It does not download video or audio, and
  members-only *content* remains inaccessible without a real paid membership.
- Not wired into the Django app. It is a research spike with no dependency on `apps/api`.
