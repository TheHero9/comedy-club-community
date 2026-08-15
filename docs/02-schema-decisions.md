# 🗄️ Schema Decisions

Every deviation from `docs/01-canonical-models.py`, with the reason.

> **Standing ruling (2026-08-08):** the canonical `models.py` is a **suggestion, not a frozen contract**. Adjust it with judgment. The obligation is to log the change here, not to stop and ask. Still raise anything that changes a model's *meaning* (e.g. splitting `Rating` into two models) before doing it.

---

## Approved 2026-08-08

### 1. `UserProfile.clerk_user_id`

```python
clerk_user_id = models.CharField(max_length=64, unique=True, db_index=True)
```

**Why:** Clerk is the identity provider. Django must map the JWT `sub` claim to a local user. Without this field Clerk cannot be wired at all.

**Notes:** Users are provisioned lazily via `get_or_create(clerk_user_id=sub)` on first authenticated request, plus Clerk webhooks for profile updates. Never trust a client-supplied user id.

---

### 2. `Episode.availability` + `Episode.members_only`

```python
class Availability(models.TextChoices):
    PUBLIC = "public", "Public"
    SUBSCRIBER_ONLY = "subscriber_only", "Members only"
    UNLISTED = "unlisted", "Unlisted"

availability = models.CharField(max_length=32, choices=Availability.choices, default=Availability.PUBLIC)
members_only = models.BooleanField(default=False, db_index=True)
```

**Why:** The metadata probe found **9 of 74** episodes on `@ivankirkov1` are members-only, and their full metadata resolves without any login (`ignore_no_formats_error`). These episodes must be listed, searched, rated and labelled like any other. Only the media is gated, and we never touch the media.

**Notes:** `members_only` is denormalized from `availability` purely so the UI can badge and filter without a string comparison in every query. `view_count` is **null** on these episodes.

**Source:** `tools/youtube-metadata/README.md` finding 2.

---

### 3. `Episode.content_kind`

```python
class ContentKind(models.TextChoices):
    VIDEO = "video", "Video"
    STREAM = "stream", "Live stream"

content_kind = models.CharField(max_length=16, choices=ContentKind.choices, default=ContentKind.VIDEO, db_index=True)
```

**Why:** A channel's episodes span three YouTube tabs. Past live streams **are episodes** for a podcast and must be ingested, but they behave differently (no chapters, different duration profile) and the UI should be able to distinguish them.

**Notes:** 🚨 **Shorts are never ingested** (owner decision). There is deliberately no `SHORT` member on this enum. `DEFAULT_TABS = ("videos", "streams")`.

**Source:** `tools/youtube-metadata/README.md` finding 1.

---

### 4. `Episode` denormalized scores

```python
public_score        = models.FloatField(null=True, blank=True, db_index=True)
elite_score         = models.FloatField(null=True, blank=True, db_index=True)
rating_count        = models.PositiveIntegerField(default=0)
elite_rating_count  = models.PositiveIntegerField(default=0)
```

**Why:** The brief explicitly recommends this ("denormalize aggregate scores onto `Episode` with periodic recompute before reaching for anything fancier"). Without it, every list page, leaderboard and sort recomputes two averages per episode across ~1,000 episodes.

**Notes:**
- 🚨 The **one `Rating` model, two derived numbers** design is unchanged. These are a cache, never a source of truth.
- Recomputed on rating write (targeted, single episode) plus a periodic Celery sweep (full, self-healing).
- Verification changing a user's elite standing is handled by the sweep, so no backfill is ever needed.
- The `public_score()` / `elite_score()` methods on the model stay as the correctness reference. `null` means "no ratings yet", not zero.

---

### 5. `Episode.language`

```python
language = models.CharField(max_length=8, blank=True)   # e.g. "bg"
```

**Why:** yt-dlp returns `language: "bg"` reliably. Meilisearch needs it for correct Cyrillic tokenization, and it future-proofs a channel that posts in English.

---

## Added 2026-08-08 (waves 5-13)

### 6. `Comment.is_hidden`

```python
is_hidden = models.BooleanField(default=False)
```

**Why:** Moderators must be able to remove a comment from public view **without destroying it**, or the report trail points at a row that no longer exists and moderation becomes unauditable. Authors deleting their own comment still get a real delete.

**Notes:** Every public read filters `is_hidden=False`. Pinned by `test_hidden_comments_are_not_returned`.

---

### 7. `Channel.is_active`

```python
is_active = models.BooleanField(default=True)
```

**Why:** A channel that goes dark, gets renamed, or is dropped from the community should stop being hit by the daily sync without deleting its ~100 episodes. `sync_all_channels` only queues `is_active=True`.

---

### 8. `Episode.updated_at`

```python
updated_at = models.DateTimeField(auto_now=True)
```

**Why:** The canonical file had `created_at` only. Sync freshness and search-index staleness both need to know when a row last changed.

---

### 9. Constraints the canonical file left to application code

| Constraint | Model | Why |
| ---------- | ----- | --- |
| `uniq_episode_slug_per_channel` | `Episode` | Slug is not globally unique (two channels may post the same title) but must be unique within a channel so `/channels/{slug}/{episode-slug}` resolves. |
| `rating_score_between_1_and_10` | `Rating` | The canonical file used only Django validators, which `Model.objects.create()` bypasses entirely. A DB `CheckConstraint` cannot be bypassed. |
| `topic_vote_is_plus_or_minus_one` | `EpisodeTopicVote` | Same reasoning: `value` must be +1 or -1, enforced by the database. |
| `uniq_chapter_start_per_episode` | `Chapter` | Makes chapter ingestion idempotent - re-running a sync updates rather than duplicating. |

🚨 Rule this reflects: **never trust application-level uniqueness or range checks.** Enforce at the database.

---

### 10. `Episode` sort indexes with an explicit `NULLS LAST` ordering

Added 2026-08-09 (migrations `0002_episode_ep_upload_desc_nl_idx_and_more`, `0003_episode_ep_duration_desc_nl_idx`). **Indexes only - no field, relation or meaning changed.**

```python
models.Index(F("upload_date").desc(nulls_last=True), F("id").desc(), name="ep_upload_desc_nl_idx")
models.Index(F("public_score").desc(nulls_last=True), F("id").desc(), name="ep_public_desc_nl_idx")
models.Index(F("elite_score").desc(nulls_last=True),  F("id").desc(), name="ep_elite_desc_nl_idx")
models.Index(F("duration_sec").desc(nulls_last=True), F("id").desc(), name="ep_duration_desc_nl_idx")
models.Index(F("rating_count").desc(),                F("id").desc(), name="ep_rating_count_desc_idx")
models.Index(F("channel_id"), F("upload_date").desc(nulls_last=True), F("id").desc(), name="ep_ch_upload_desc_nl_idx")
models.Index(F("channel_id"), F("public_score").desc(nulls_last=True), F("id").desc(), name="ep_ch_public_desc_nl_idx")
```

**Why:** `Index(fields=["-upload_date"])` compiles to `DESC NULLS FIRST`. Every list endpoint sorts `DESC NULLS LAST`, because NULL means "not rated yet" and an unrated episode must not sit at the top of "top rated" (`podcast/api/public.py::_ordering`). **Postgres cannot use a NULLS FIRST index to satisfy a NULLS LAST sort**, so `podcast_epi_upload__7a4f38_idx` and `podcast_epi_public__6b2d91_idx` were never used by `/api/episodes` - `pg_stat_user_indexes` reported `idx_scan = 0` for the public_score one. Every browse query was a full sequential scan plus a sort.

The trailing `id DESC` is the pagination tiebreak from `_ordering()`; without it in the index the sort still cannot be answered from the index.

**Evidence** (`EXPLAIN ANALYZE`, table grown to 8,352 rows inside a rolled-back transaction to model the target scale):

| Query | Before | After |
| ----- | ------ | ----- |
| `sort=newest` limit 24 | Seq Scan + top-N sort, cost 1624, **23.4 ms** | Index Scan `ep_upload_desc_nl_idx`, cost 24, **0.23 ms** |
| `sort=top` | cost 1624, 21.6 ms | cost 29, 0.23 ms |
| `sort=most_rated` | cost 1624, 31.6 ms | cost 27, 0.23 ms |
| `sort=top_elite` | cost 1624, 22.2 ms | cost 28, 0.25 ms |
| `sort=longest` | cost 1624, 23.3 ms | cost 29, 0.24 ms |
| `channel=X&sort=newest` | cost 1396, 20.9 ms | cost 19.6, 0.22 ms |
| `channel=X&sort=top` | cost 1396, 20.7 ms | cost 19.7, 0.24 ms |

The two `channel_id`-leading indexes only pay off if the queryset filters on `channel_id`, not on `channel__slug` - a join stops the planner using them. `list_episodes` therefore resolves the slug to an id first.

The pre-existing `-upload_date` index is **kept**: `Episode.Meta.ordering` and the Postgres search fallback both sort `DESC NULLS FIRST`, and it serves `sort=oldest` as a backward scan.

---

## Also changed

- **`Episode.slug`** must use `slugify(..., allow_unicode=True)` or Bulgarian titles slugify to an empty string. This is a bug in the canonical file, not a deviation.
- **`Episode.view_count`** stays nullable and is **excluded** from "most-watched" sorting when null (members-only episodes never report it).
- **`Chapter`** ingestion is opportunistic only. The probe found **0 of 12** episodes with chapters, so nothing may depend on them existing.

---

## Deviation 6: `Transcript` + `TranscriptSegment` (added 2026-08-09)

**Canonical file:** neither model exists. The brief lists transcription as an explicit v1 non-goal.

**What changed:** two new models, both purely additive. No existing model, field or index was touched.

```python
class Transcript(models.Model):          # OneToOne -> Episode
    status      = "ok" | "unavailable"
    source      = "youtube_auto" | "youtube_manual" | "whisper" | "scribe"
    language, track_id
    segment_count, word_count, covered_sec      # denormalized
    checked_at                                   # last COMPLETE fetch attempt

class TranscriptSegment(models.Model):   # FK -> Transcript
    start_sec, end_sec, text
    UniqueConstraint(transcript, start_sec)
```

**Why this is not the deferred transcription work:** the non-goal was *paying to transcribe*. This ships **zero** ASR. YouTube already publishes a Bulgarian ASR track (`bg-orig`) for part of the catalogue and yt-dlp hands it over free. The `source` field is exactly the upgrade path the brief anticipated - re-transcribing later with Whisper replaces the segments and flips `source`, with no schema change.

**Why a `status=unavailable` row instead of an absent row:** the majority of the catalogue has no captions. Without a negative record every backfill would re-fetch every caption-less episode forever. `checked_at` makes the re-check deliberate: "no captions" is true on a date, not permanently, because YouTube does add captions to older videos.

🚨 **An `unavailable` row is only ever written from a COMPLETE response.** The same soft-block that strips `duration` from a backfill also strips the caption list, so absence proves nothing on a degraded response. `ingestion/transcripts.py` raises `TranscriptThrottled` rather than returning "none", and the service leaves the episode pending. Writing a false "none" would be permanent - nothing would re-check it.

**Why OneToOne and not a history:** nothing reads an older transcript tier. One transcript per episode, the current best one.

**Why segments and not one text blob:**

| | One `TextField` per episode | Windowed segments |
| --- | --- | --- |
| Deep link to the moment | ❌ impossible | ✅ `start_sec` |
| Search result granularity | whole 2h38m episode | ~60s passage |
| Meilisearch ranking | one 26k-word doc drowns every title | passage-level |

Window size is `settings.TRANSCRIPT_SEGMENT_SECONDS` (60). A raw caption cue is ~2s / ~7 words, too granular to be a result: a phrase spanning two cues would match neither.

**Measured cost** (this box, 2026-08-09):

| | Whole catalogue (1,392 eps / 1,914 h) | Per hour of audio |
| --- | --- | --- |
| Postgres text | ~56 MB compressed | ~30 KB |
| Meilisearch | ~2.0-2.5 GB | ~1.2 MB |
| Segment rows | ~115,000 | ~60 |

Postgres is a non-issue. **Meilisearch is the real cost** - budget host RAM against that number.

**Index N+1:** `segment_index_queryset()` uses `select_related("transcript__episode__channel")`. Measured: 1 query for 400 segments, versus 151 queries for 50 without it.

---

## Deviation 12: `Channel.display_order`

`PositiveIntegerField(default=100, db_index=True)`, and `Channel.Meta.ordering`
moves from `["name"]` to `["display_order", "name"]`.

**Why stored and not derived** (owner ruling, 2026-08-15). The requested order is:

| # | Channel | Episodes |
| - | ------- | -------- |
| 1 | `@comedyclubpodcast` | 1,318 |
| 2 | `@ivankirkov1` | 75 |
| 3 | `@BFFPepiQ` | 80 |
| 4 | `@delo404podcast` | 57 |
| 5 | `@ComedyClubNews` | 245 |
| 6 | `@КомедиКлубКлюкиПодкаст` | 139 |
| 7 | `@comedyclubsport7786` | 47 |

That is **not** episode count (which would give 1, 5, 6, 3, 2, 4, 7), not
alphabetical, and not subscriber count. It is editorial - the flagship leads and
the barely-active channel trails - so there is nothing to compute it from.

Values are set by `manage.py set_channel_order`, which steps by 10 so a channel
can be slotted between two without a renumber. A new channel keeps the default
100 and therefore sorts after everything curated, which is the correct place for
a channel nobody has placed yet. `/api/channels` orders explicitly rather than
relying on `Meta.ordering`, so the intent is visible at the query.

---

## Deviation 13: `UserProfile.handle`

`CharField(max_length=100, blank=True, null=True, unique=True, db_index=True)`.

**This is the user's YOUTUBE handle**, not a second display name and not the
Django username. It exists so a `ChannelMembership` can eventually be tied to a
real subscriber account. It is assigned by us (admin), never free-form user
input - a self-chosen handle would be worthless for that linkage.

**The bug that motivated it.** Clerk's default session token carries only
`sub`, `sid`, `iss`, `exp`, `iat`, `nbf`, `azp`, `jti`, `v` - no name, no email,
no username, no picture. `provision_user` therefore received empty strings for
all of them and fell through to its last resort, the Clerk `sub`. The first real
Google sign-in on production rendered:

```
    Иван Петров          <- expected
    user_33Kq...         <- actual, as the display name
    @user_33Kq...        <- and again, as the handle
```

Three fixes, all needed:

1. `podcast/auth/clerk_api.py` reads the real identity from Clerk's Backend API
   when the token has none. Fails soft - the token was already verified, so a
   Clerk outage must degrade the name, never block sign-in.
2. `humanize()` in `podcast/auth/backends.py` refuses to let an
   identity-provider id become anything user-visible, and REPAIRS a profile
   already storing one on the next authenticated request.
3. `handle` is `NULL` until known, and the UI prints "no YouTube handle linked
   yet" rather than falling back to the username.

`author_name` on public comments goes through `humanize()` too - without it, a
raw Clerk id would have been published site-wide under every comment.

---

## Deferred

| Idea | Why not now |
| ---- | ----------- |
| R2 thumbnail mirroring | Thumbnails are a free Google CDN URL derived from the video id. Mirroring adds cost and staleness for zero gain. |
| ~~i18n / `next-intl`~~ | ✅ **Done 2026-08-15**, without `next-intl`. Two dictionaries in `lib/copy.ts`, a cookie, and `getCopy()` / `useCopy()`. See `specs/11-ux-feedback/01-backlog.md`. |
