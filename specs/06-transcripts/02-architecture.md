# 06-transcripts / 02 - Transcript storage architecture

**Date:** 2026-08-09
**Status:** ✅ Built and verified end to end on 3 real episodes
**Probe that motivated it:** [`01-caption-probe.html`](01-caption-probe.html)

---

## What this adds

Free transcripts, stored and searchable, with **zero ASR spend**. YouTube already
publishes a Bulgarian ASR track (`bg-orig`) for part of the catalogue; yt-dlp
hands it over with no API key, no GPU and no per-minute billing.

The point is the half of search that community labels can never cover. Labels
answer *"which episodes are about X"*. Transcripts answer *"X was said at 45:12,
in these episodes"*.

---

## The shape

```
yt-dlp extract_info
   └─ automatic_captions["bg-orig"] → json3 URL (signed, short-lived)
        └─ ingestion/transcripts.py     parse events, drop rolling-window fillers
             └─ chunk into ~60s windows
                  └─ services/transcripts.py     Transcript + TranscriptSegment (Postgres)
                       └─ Celery: reindex_transcript
                            └─ Meilisearch index `transcript_segments`
                                 └─ GET /api/search/transcripts
```

| Layer | File |
| ----- | ---- |
| Fetch + parse + chunk | `podcast/ingestion/transcripts.py` |
| Persistence + backfill sweep | `podcast/services/transcripts.py` |
| Models | `podcast/models.py` (`Transcript`, `TranscriptSegment`) |
| Search document | `podcast/search/transcript_documents.py` |
| Search index | `podcast/search/transcript_index.py` |
| Celery tasks | `podcast/tasks.py` (4 new) |
| CLI | `manage.py backfill_transcripts`, `manage.py reindex --only transcripts` |
| API | `GET /api/search/transcripts` |
| Admin | read-only `TranscriptAdmin`, `TranscriptSegmentAdmin` |

---

## 🚨 The three decisions that matter

### 1. A separate Meilisearch index, never a field on the episode document

This is the one that would have quietly ruined search. An episode transcript is
~26,000 words. Dropped into the same document as a 60-character title it would:

- make almost every episode match almost every common Bulgarian word
- let a throwaway mention outrank an episode genuinely about the subject,
  because Meilisearch ranks per **document**, not per passage
- throw away the timestamp, which is the entire reason to store transcripts

Two indexes, two questions. The API presents them as one result page.

### 2. Windowed segments, not one text blob

A raw caption cue is ~2s and ~7 words - too granular to be a search result,
because a phrase spanning two cues would match neither. ~60s windows
(`TRANSCRIPT_SEGMENT_SECONDS`) trade timestamp precision for recall, and
`start_sec` is still an exact deep link.

⚠️ Changing the window invalidates existing windowing. Re-run with `--force`, or
old and new segments coexist at different granularities. The index write path
deletes **by filter**, not by computed id, precisely so a re-window cannot leave
orphans behind.

### 3. "No captions" is data, and only trustworthy from a complete response

The majority of the catalogue has no captions. Without a negative record, every
backfill would re-fetch every caption-less episode forever. So `status=unavailable`
is a real row with a `checked_at`.

🚨 **The trap:** the same soft-block that strips `duration` from a backfill also
strips the caption list. A throttled response looks *exactly* like "this episode
has no captions". Recording that would be permanent - nothing would ever
re-check it.

`fetch_transcript` refuses to answer "none" when `duration` is missing; it raises
`TranscriptThrottled`, writes nothing, and leaves the episode pending. Same rule
`services/metadata_repair.py` already follows. The backfill aborts after 10
consecutive throttles rather than deepening the block.

---

## 🔬 Bug found while building this: typo tolerance is measured in BYTES

Not a transcript bug - a **pre-existing episode-search bug** this work exposed.

`minWordSizeForTypos` counts **bytes**, not characters. Cyrillic is 2 bytes per
character in UTF-8, so every Bulgarian word crossed the thresholds at *half* the
intended word length.

The episodes index was set to `{oneTypo: 4, twoTypos: 8}` in the documented
belief that those were characters. They meant **2 and 4 characters**. A
two-letter Bulgarian word got a typo; a four-letter one got two.

**Measured, on the live index:**

| Query | Before | After |
| ----- | ------ | ----- |
| `пица` | 100 hits, **95 of them false** (`пича`, `пичаги`, `пичове`) | 5 hits, all literal |
| `бургер` | 15 hits | 3 hits |
| `пари` | 309 hits | 65 hits |

Confirmed by sweeping the threshold: the false matches persisted at every value
up to 8 and stopped dead at **9** - exactly the byte length of `пица`.

**Fix:** thresholds are now written as `N * BYTES_PER_CYRILLIC_CHAR`, so the
intent stays stated in characters and the conversion is explicit. The regression
test asserts the character-level invariant, not the raw number.

⚠️ The old test asserted `oneTypo <= 4` and passed the entire time. It encoded
the misunderstanding rather than the behaviour.

---

## Coverage reality

⚠️ **Partial and date-dependent. Never present transcript search as exhaustive.**

| Sample | Captions present |
| ------ | ---------------- |
| 2024-2026 | 9 / 9 |
| 2023 | mixed |
| 2019-2022 | 0 / 12 |
| Members-only | 0 / 5 |

An episode absent from transcript results has **not** been ruled out - it may
simply have no transcript. The UI needs a "transcript available" signal or users
will read silence as an answer.

`--since 2024-01-01` gets almost all of the value for a fraction of the requests.

---

## Measured cost

| | Whole catalogue (1,392 eps / 1,914 h) | Per hour of audio |
| --- | --- | --- |
| 🐘 Postgres text | ~56 MB compressed | ~30 KB |
| 🔍 Meilisearch | ~2.0-2.5 GB | ~1.2 MB |
| 📄 Segment rows | ~115,000 | ~60 |
| ⏱️ Index time | ~15 min one pass | ~0.25 s |

Postgres is a non-issue. **Meilisearch is the real cost** - size the host against
it. At 10,000 episodes it projects to ~15-18 GB.

Verified on 3 real episodes: 523 segments, 86,870 words, 0.9 s to index.

---

## Commands

```bash
# Is it worth it on this channel? Writes only the N it tests.
uv run python manage.py backfill_transcripts --probe 10

# What tracks does one video actually have?
uv run python manage.py backfill_transcripts --tracks AXnI79sQd3Q

# The productive run: newest episodes, where the captions actually are
uv run python manage.py backfill_transcripts --since 2024-01-01

# Rebuild search from Postgres (both indexes, or just one)
uv run python manage.py reindex
uv run python manage.py reindex --only transcripts
```

---

## Verified

| Check | Result |
| ----- | ------ |
| `manage.py migrate` on the live DB | ✅ clean |
| `manage.py check` | ✅ 0 issues |
| Backfill on 3 real episodes | ✅ 523 segments, 86,870 words, 0 errors |
| Celery auto-index on store | ✅ fired inline (eager), 3 tasks succeeded |
| Bulgarian transcript search | ✅ `пица` → 5 passages + deep links, 4 ms |
| Episode-scoped search | ✅ 100 segments in one episode |
| Transcript text absent from `episodes` index | ✅ `/api/search` unchanged at 148 hits |
| Document build N+1 | ✅ 1 query for 400 segments (151 for 50 without) |
| `uv run pytest` | ✅ 350 passed |
| `ruff check` | ✅ clean |

---

## Not done

- **No frontend.** The API endpoint exists; no page consumes it yet.
- **No "transcript available" badge**, which the coverage gap above makes
  necessary before this is user-facing.
- **No automated tests for the new modules.** Per the standing "tests only when
  requested" rule. The parsing, chunking, throttle-refusal and byte-threshold
  paths are the ones worth pinning if that changes.
- **The `episodes` index has the same latent "created without settings" hole**
  the transcript index just had fixed (`ensure_index_once`). It has not bitten
  because `reindex` is always run first, but a wiped Meilisearch plus a Celery
  write would recreate it with default settings.
