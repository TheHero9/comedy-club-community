# 📊 Redesign - Data Reality

**What the API actually returns, and how much of it is actually populated.**

> 🚨 **Read this before designing any page.** The single most common way a
> prototype becomes unbuildable is designing for data that does not exist. This
> file is measured from the live database on 2026-08-08, not assumed.

---

## 1. How much content exists right now

One channel is ingested. Five to seven more are coming, so multiply episode
counts but **not** the shape.

| Thing | Count | Design implication |
|-------|-------|--------------------|
| Channels | **1** | `/channels` currently renders a single card. It must not look broken with 1, and must still work with 8. |
| Episodes | **74** | ~1,000 at full scale. |
| Users | **9** | ~1,000 at full scale. Avatars are mostly empty strings today. |
| Ratings | **267** | |
| Episodes with at least one rating | **58 / 74** | 🚨 **22% of episodes are unrated.** The unrated state is common, not an edge case. |
| Episodes with an elite score | **54 / 74** | |
| Topics (canonical) | **15** | Small vocabulary. A topic cloud will look sparse. |
| Episode-topic links | **190** | ~2.6 topics per episode on average. |
| Moments (timestamp + label) | **119** | ~1.6 per episode, very unevenly spread. |
| Comments | **120** | |
| People | **3** | 🚨 Only three. A "people" page will look extremely thin. |
| Participant links | **95** | |
| Watch events | **131** | |
| Favourites | **64** | |
| Personal tags | **0** | 🚨 **Nobody has ever created one.** Feature exists in the API, has no UI. |
| Reports | **0** | |
| Memberships | **7** (4 verified) | |

### 🚨 The two findings that should shape the whole design

**1. Zero episodes have chapters.** `Chapter` count is **0 out of 74**. Creators
do not add chapter markers to these videos. **Do not design a chapter rail, a
chapter sidebar, or a chapter-based navigation as a primary element.** Community
**moments** are the only timestamp structure that exists. If you design anything
for chapters, it must degrade to nothing without leaving a hole.

**2. Descriptions are tiny.** Average length is **109 characters**, and 7 of 74
episodes have **none at all**. That is one short sentence, not a synopsis.
**Do not design a layout that needs a paragraph of description text.** The
current episode page puts the description in its own section at the bottom, which
is roughly right - it is a footnote, not content.

### Other population facts worth knowing

| Field | Populated | Note |
|-------|-----------|------|
| `thumbnail_url` | **74 / 74** | ✅ Always present, always 16:9, always 1280x720. Lean on it. |
| `duration_sec` | **74 / 74** | ✅ Always present. |
| `upload_date` | **74 / 74** | ✅ Always present. Drives the grid's year grouping. |
| `view_count` | **65 / 74** | ⚠️ **Missing on members-only episodes.** Must render as absent, never as `0`. |
| `members_only` | **9 / 74** | Paywalled on YouTube. We still list, search and rate them; we never touch the media. |
| `content_kind = "stream"` | **2 / 74** | Past live streams. **These are episodes**, not a separate category. |
| `description` | **67 / 74** | Avg 109 chars. |
| Shorts | **never ingested** | Deliberate. They are promo clips, not episodes. Do not design a Shorts surface. |

---

## 2. Field-by-field API inventory

These are the exact payloads. Field names are what the frontend receives.
`?` means the field may be absent; `|null` means it can be null.

### `EpisodeBriefOut` - the card everywhere

Used in every list, grid, search result and leaderboard.

```
id, youtube_id, title, slug,
channel_id, channel_name, channel_slug,
upload_date|null, duration_sec|null, thumbnail_url,
content_kind ("video" | "stream"), members_only (bool),
public_score|null, elite_score|null,
rating_count, elite_rating_count,
band|null, elite_band|null
```

`band` is the semantic key (`masterpiece` ... `garbage`). The design maps key to
colour. **Never derive a colour from the number yourself** - the API owns the
thresholds.

### `EpisodeOut` - the episode detail page

Everything in `EpisodeBriefOut`, plus:

```
description (avg 109 chars, sometimes ""),
url, watch_url (YouTube links),
availability, language,
view_count|null, like_count|null,
topics[]      -> TopicBriefOut { id, name, slug, score? }
chapters[]    -> ChapterOut { id, title, start_sec, end_sec|null }   ← ALWAYS EMPTY
participants[]-> PersonBriefOut { id, name, slug, avatar_url, role? }
moment_count, comment_count
```

### `ChannelOut`

```
id, youtube_channel_id, name, slug, handle,
description, avatar_url, banner_url,
subscriber_count|null, episode_count, last_synced_at|null
```

⚠️ `avatar_url` and `banner_url` exist in the schema but are **not reliably
populated**. Design the channel header to work **without** a banner image.

### `ChannelGridOut` - the ratings grid

```
channel_name, channel_slug,
score_kind ("public" | "elite"),
seasons[] -> GridSeasonOut { year, label, episode_count, rated_count, average|null }
rows[]    -> GridRowOut    { index, cells[] }
overall_average|null, rated_count, total_count,
bands[]   -> GridBandOut   { key, label, min_score }
```

🚨 **The payload is EPISODE-MAJOR and the UI transposes it.**
`rows[episodeIndex].cells[seasonIndex]`. Rendered rows are **seasons**; rendered
columns are **rows**. Get this backwards and the grid is silently wrong.

`GridCellOut`:
```
youtube_id, slug, title, upload_date|null, duration_sec|null,
thumbnail_url, content_kind, members_only,
score|null, rating_count, band|null, is_provisional
```

A `null` cell (not a null `score`, an absent cell) is a **hole** - render nothing.

### `SearchOut` - the search results page

```
query, hits[], total, limit, offset,
backend ("meilisearch" | "postgres"),
processing_ms|null
```

`SearchHitOut`:
```
episode -> EpisodeBriefOut
matched_topics[]  (string labels)
matched_moments[] (string labels)
```

🎯 **`matched_topics` and `matched_moments` are the product's whole argument.**
They are why a result matched when the words appear nowhere in the title. They
are currently rendered as tiny grey outline badges. **Make them prominent.**

### `MomentOut` - community timestamps

```
id, timestamp_sec, label, score, created_at, author|null
```

The timestamp links out to YouTube at that second:
`https://www.youtube.com/watch?v={id}&t={sec}`.

### `CommentOut`

```
id, episode_id, body, is_spoiler (bool), created_at, edited_at|null,
author_id, author_name, author_avatar
```

⚠️ `is_spoiler` needs a real reveal interaction. Currently a CSS blur that clears
on hover - which does not work on touch. **Design a proper tap-to-reveal.**

### `MeOut` - the signed-in user (no UI exists yet)

```
id, username, display_name, avatar_url, bio, role,
memberships[] -> MembershipOut,
rating_count, watched_count, favorite_count
```

### `ViewerStateOut` - this user's relationship to one episode (no UI exists yet)

```
rating|null, is_favorite, watch_count, last_watched_on|null, personal_tags[]
```

🎯 This is the payload behind the rating widget, watch button and favourite
button on the episode page. **None of it is designed yet.**

### `MembershipOut`

```
id, channel_id, channel_name, channel_slug, tier,
member_since|null, is_verified (bool), has_screenshot (bool), verified_at|null
```

🔒 Note it exposes `has_screenshot` as a **boolean only**. The screenshot itself
is never returned by any API. Do not design a screenshot preview.

### Others

- `TopicOut` - `id, name, slug, episode_count`
- `PersonOut` / `PersonDetailOut` - `id, name, slug, bio, avatar_url, socials{}, appearance_count, episodes[]`
- `LeaderboardOut` - `kind, items[] -> { episode, value|null, rank }`
- `WatchSummaryOut` - `episode_id, watch_count, last_watched_on|null, events[]`
- `PersonalTagOut` - `id, episode_id, text` 🔒 **private to its author**
- `HealthOut` - `status, database{ok,detail}, redis{ok,detail}`
- `PaginatedMeta` - `total, limit, offset, has_more` (drives every list's paging)

---

## 3. The two scores, explained

This trips people up, so it is spelled out.

There is **one `Rating` model** and **two derived numbers**:

- **Public score** = average of **all** ratings for the episode.
- **Elite score** = average of ratings by users who hold a **verified paid
  membership of that episode's channel**.

There is no separate "elite vote". When a user's membership is verified, their
**existing** ratings start counting toward the elite score automatically.

**Design implication:** the two numbers sit side by side and need visual
distinction without implying one is "the real score". The elite score is "what
the people who pay for this channel think" - it is a **different lens**, not a
better one. It is also frequently `null` (20 of 74 episodes) and must degrade
cleanly.

**Provisional:** fewer than **3** ratings means the band is not trustworthy. The
cell keeps its colour but carries a marker. Design that marker properly - it is
currently a 10x10px triangle in the corner.

---

## 4. Where the data comes from

Worth knowing, because it constrains what can ever be shown.

- Episodes are ingested from YouTube via **yt-dlp** (bulk backfill) and the
  **YouTube Data API** (daily sync).
- **Thumbnails are never uploaded or mirrored.** The URL is derived from the
  video id. This is why the image is guaranteed and free.
- **The only real upload in the entire product** is a membership verification
  screenshot, which is private and admin-only.
- **Search** runs on Meilisearch with Bulgarian typo tolerance. The searchable
  document is: episode title + description + channel name + **topic labels** +
  **moment labels** + participant names. That is why community labels make
  episodes findable.
