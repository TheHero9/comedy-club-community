# Channel ingestion: `@comedyclubpodcast`

**Date:** 2026-08-09
**Command:** `python manage.py backfill_channel @comedyclubpodcast`
**Outcome:** ✅ 1,318 episodes ingested, all 1,036 degraded rows repaired, re-indexed. **Complete.**

---

## 1. What the channel actually contains

Channel ID `UCEf1BL_OqYKu2-CVuuMoE2Q` - "Комеди Клуб Подкаст / Comedy Club Podcast"

| Tab | Entries | Ingested |
| --- | ------- | -------- |
| `videos` | 979 | ✅ |
| `streams` | 339 | ✅ |
| `shorts` | 27 | ❌ never (owner decision 2026-08-08) |
| **Total ingested** | **1,318** | |

No overlap between tabs - the flat listings deduped to exactly 979 + 339, and a
duplicate-`youtube_id` check across the whole DB returned zero rows.

### 📈 The corpus is far bigger than the brief assumed

The build brief budgeted **~1,000 episodes across all 6-8 channels**. This *single*
channel is 1,318. With 4-6 channels still to come, plan for **5,000-10,000+**.

Affects: Meilisearch index sizing, pagination defaults, the daily Data API quota
(~10k units/day), and the runtime of any full re-index.

---

## 2. Run results

```
videos: 979
streams: 339
Fetching full metadata for 1318 videos...
1318 episodes (1318 created, 0 updated), 12 chapters, 0 errors in 861.0s
```

14m21s at 8 workers. Meilisearch reindex fired automatically via Celery
(`reindex_channel` -> `indexed: 1318`).

| Check | Result |
| ----- | ------ |
| Missing `upload_date` | 0 |
| Missing `thumbnail_url` | 0 |
| Empty `title` | 0 |
| Empty `description` | 17 |
| `maxresdefault` / `hqdefault` | 1,167 / 151 |
| Date range | 2016-11-04 → 2026-07-11 |
| Duplicate `youtube_id` | 0 |
| Chapters found | 12 |

Chapters remain vanishingly rare (12 across 1,318 episodes, ~0.9%), confirming the
Kirkov probe. **Community `Moment` labels are the primary timestamp source**; there is
no creator-supplied structure to lean on.

---

## 3. 🚨 The real finding: a silent throttle corrupts metadata

The run reported **`0 errors`**. It was not clean.

**1,036 of 1,318 rows (79%) have `duration_sec = NULL`.**

### What happens

Partway through a large run, YouTube starts soft-blocking the IP. **yt-dlp does not
raise.** It keeps returning a *reduced* payload:

| Field | Survives the block? |
| ----- | ------------------- |
| `id`, `title`, `description`, `upload_date` | ✅ yes |
| `duration` | ❌ becomes `None` |
| `availability` | ❌ becomes `None` |
| `view_count`, `like_count` | ❌ become `None` |
| `formats` | ❌ becomes `[]` |

So the backfill completes, counts every row as created, and reports zero errors -
while a fifth of the useful metadata is gone.

### 🚨 Why `availability` is the dangerous one

`shape_video` does:

```python
availability = info.get("availability") or "public"
```

A blocked response has no availability, so **a members-only episode is stored as
confidently `"public"`**. Missing duration is visibly wrong and self-reporting. A
wrong paywall flag is neither - it just looks like a fact.

Only 37 `subscriber_only` episodes were detected, and all 37 came from full responses.
The true count is higher; it cannot be known until the repair pass runs.

### Proof it is throttling, not absent data

`vawEZWFo4BA` was stored with `duration_sec = 10246` **during the run**. Re-fetched a
few minutes later:

```
vawEZWFo4BA | duration= None | formats= 0 | avail= None
```

Same video, same code, same options. Only IP reputation changed. Conclusive.

### How long it lasts

Hours, not minutes. A serial probe of 8 degraded videos with 2s gaps, run right after
the backfill, recovered **0/8**. A second probe through the repair command: **0/3**.
There is no "retry harder" - only wait.

---

## 4. The fix: `manage.py repair_metadata`

New: `podcast/services/metadata_repair.py` + `podcast/management/commands/repair_metadata.py`.

**Detection:** `duration_sec IS NULL` marks a degraded row. A full response always
carries a duration.

**Safety properties** (these are the point of the design):

- ✅ **Only writes from a full response** (`duration is not None`). Running it while
  still blocked is a **no-op**, not a second round of data loss. It can never
  overwrite good data with nulls.
- ✅ **Serial with a delay.** Parallelism caused the problem; this job has no deadline.
- ✅ **Aborts after 25 consecutive degraded responses** rather than wasting an hour and
  deepening the block.
- ✅ **Never downgrades a known availability.** Only overwrites when YouTube states one.
- ✅ **Fully resumable and idempotent** - a repaired row leaves the degraded queryset.
- ✅ **One bad row never aborts the sweep** - dead/removed videos are logged and skipped.

### Usage

```bash
# Has the block lifted? Writes nothing beyond the N tested.
uv run python manage.py repair_metadata --probe 10

# Repair everything for one channel, gently
uv run python manage.py repair_metadata --channel @comedyclubpodcast --delay 2
```

---

## 5. ✅ Repair completed (same day)

The block lifted after roughly an hour. A probe recovered 6/6, then the sweep ran.

| # | Task | Result |
| - | ---- | ------ |
| 1 | Wait for the block to lift | ✅ ~1 hour |
| 2 | `repair_metadata --probe 6` | ✅ 6/6 recovered |
| 3 | Repair sweep of the remaining 1,030 | ✅ 964 before the run was interrupted, 72 on the resume |
| 4 | Confirm the real `subscriber_only` count | ✅ **still 37 - zero corrections** |
| 5 | Re-index | ✅ 1,392 docs in 4.30s |

**Final state: 0 degraded rows across the entire database.**

| Field | Missing (of 1,318) |
| ----- | ------------------ |
| `duration_sec` | 0 |
| `upload_date` | 0 |
| `thumbnail_url` | 0 |
| `view_count` | 37 - exactly the members-only set, as expected |

Duration stats: min 12s, max 42,678s (11h51m), mean 4,796s (80 min).
**1,756 hours of content** on this channel alone.

### 🎯 The availability scare did not materialise

`availability_corrected` came back **0 across all 1,036 repairs**. Every degraded row
that was stored as `public` really was public, and the members-only count held at 37.

This was the outcome worth checking, not the one worth assuming - the coercion in
`shape_video` *could* have hidden dozens of paywalled episodes, and only the repair
pass could tell us either way. The 37 members-only episodes are also exactly the 37
with a null `view_count`, which independently corroborates the figure against the
documented members-only behaviour.

⚠️ **This does not make the coercion safe.** It came out clean here; a future channel
throttled at a different moment could hide real members-only episodes. The underlying
`availability or "public"` issue is still logged in `NEXT_TIME.md`.

### 🔁 The resume path was exercised for real

The first sweep was interrupted at 964/1,036. Re-running the identical command picked
up exactly the remaining 72 and finished 72/72 with 0 errors - no duplicates, no
re-fetching of repaired rows, no lost work. The `duration_sec IS NULL` queryset is what
makes that free.

---

## 6. 📌 Rules this run established

1. ❌ **Never judge a backfill by its error count.** `0 errors` means nothing threw an
   exception. It says nothing about completeness. Check `duration_sec IS NULL`.
2. ✅ **Always run `repair_metadata --probe 10` after any backfill over ~100 episodes.**
3. ⚠️ **Consider lowering `YOUTUBE_INGEST_WORKERS` (currently 8) for the remaining
   channels**, or adding a delay to the backfill itself. 8 workers is what tripped the
   block at ~1,300 videos; it was fine at 74. The trade is wall-clock against a repair
   pass, and the repair pass is far slower than the time saved.
4. 🚨 **Re-probe every new channel before backfilling** (`fetch_tab_entries` flat listing
   is nearly free) so its size is known in advance.
