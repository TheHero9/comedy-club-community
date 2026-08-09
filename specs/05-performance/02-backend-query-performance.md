# 🗄️ Backend Query Performance

**Date:** 2026-08-09
**Scope:** Django API only (`apps/api`). No frontend, no grid vertical.
**Dataset:** 1,392 episodes across 2 channels (one holds 1,318). Target scale ~8,000.
**Method:** `CaptureQueriesContext` for query counts, `EXPLAIN (ANALYZE, BUFFERS)` for
plans, and a **rolled-back transaction that inflates the table to 8,352 rows** so the
plans are the ones the app will actually get, not the ones a 1,392-row toy table gets.

> ⚠️ HTTP-level wall clock on this machine is not a usable signal for DB work.
> `/api/health` issues **one** query and still costs 82 ms over HTTP, so ~80 ms is
> fixed `runserver` + DEBUG + Windows loopback overhead. Every number below is
> measured at the SQL or Django-test-client layer, where the work is visible.

---

## 🔍 N+1 hunt

Query counts were captured per endpoint at two dataset sizes. Any endpoint whose
count moves with the row count is a bug.

| Endpoint | Queries before | Queries after |
| -------- | -------------- | ------------- |
| `/api/episodes` (any sort, any limit) | 2 | 2 |
| `/api/episodes/{id}` | 4 | 4 |
| `/api/episodes/{id}/comments` | 3 | 3 |
| `/api/episodes/{id}/moments` | 2 | 2 |
| `/api/channels`, `/api/topics`, `/api/people` | 1 | 1 |
| `/api/leaderboards/*` | 1 | 1 |
| `/api/me/*` | 4-7 | 4-7 |
| **`/api/search` (Postgres fallback), 20 hits** | **42** | **4** |
| **`/api/search` (Postgres fallback), 50 hits** | **102** | **4** |
| `/api/episodes/{id}/watch` | 5 | 3 |

### 🚨 The one real N+1: `_postgres_search`

`podcast/api/search.py` builds a `matched_topics` / `matched_moments` explanation per
hit by reading `episode.topics` and `episode.moments`. Neither was prefetched, so the
loop cost **two extra queries per hit**.

```
before   50 hits -> 102 queries, 530-597 ms
after    50 hits ->   4 queries, 171-288 ms
```

Two things made this worse than it looks:

1. It is the **degraded-mode** path. It runs whenever Meilisearch is down - exactly
   when the system is least able to absorb a 100-query storm.
2. It also runs on **every Meilisearch query that returns zero hits**, because
   `search()` deliberately double-checks a zero result against Postgres to catch a
   stale index. A user typing a word with no matches paid the full N+1.

The fix is a `Prefetch` on the queryset plus changing `episode.topics.select_related("topic")`
to `episode.topics.all()` in the loop - calling `.select_related()` on the related
manager builds a **new** queryset and silently bypasses the prefetch cache.

### `_watch_summary` (minor)

Ran `count()`, `exists()`, `first()` and a slice - four queries for two facts.
Now one page SELECT plus one aggregate.

---

## 🗂️ Index audit

Full detail and the migration names are in `docs/02-schema-decisions.md` § 10.

**The finding:** `models.Index(fields=["-public_score"])` compiles to `DESC NULLS
FIRST`. Every list endpoint sorts `DESC NULLS **LAST**` (an unrated episode must not
top "top rated"). Postgres cannot use one to satisfy the other, so those indexes were
dead weight - `pg_stat_user_indexes` showed `idx_scan = 0` on `podcast_epi_public__6b2d91_idx`
- and **every browse query was a full sequential scan plus a sort**.

Seven expression indexes now mirror the exact `ORDER BY` the API emits, tiebreak
column included. At 8,352 rows: cost 1624 -> 24-29, execution **21-31 ms -> ~0.23 ms**.

Indexes were **not** added speculatively:
- `members_only`, `content_kind`, `channel_id` already had usable indexes and the
  plans confirm they are used.
- `sort=oldest` needs `ASC NULLS LAST`; the existing `-upload_date` index already
  serves it as a backward scan, so nothing was added.
- No index helps `q=`/search ILIKE. See below.

---

## ⚡ `select_related` / `only`

`episode_list_queryset()` selected all 23 Episode columns plus all 12 Channel columns
to render a 16-field card. `Episode.description` averages 545 chars (max 2,860) and
was being carried through the sort, through `DISTINCT`, and off the wire.

`.only(BRIEF_FIELDS)` cuts the row from 1,166 to 306 bytes:

| Query | Before | After |
| ----- | ------ | ----- |
| `sort=newest` limit 100 | 11.3 ms | 4.7 ms |
| `/api/people/{slug}` (DISTINCT, 100 rows) | 12.2 ms | 4.3 ms |
| `?topic=X` (DISTINCT) | 5.9 ms | 3.8 ms |
| Full-scan sort at 8,352 rows | 23.4 ms | 15.3 ms |

`DISTINCT` benefits most: without `only()`, Postgres sorts on **every** column
including both description fields.

🚨 The trap this creates is recorded in `podcast/api/serializers.py`: reading a field
outside `BRIEF_FIELDS` off a list row is one lazy SELECT **per row** and nothing in
the response looks wrong. `test_brief_serialization_touches_no_deferred_field` guards it.

---

## 📉 Denormalised columns

`public_score`, `elite_score`, `rating_count`, `elite_rating_count` are read straight
off `Episode` everywhere in the read path. Nothing recomputes them per row -
`compute_public_score()` / `compute_elite_score()` are called only from
`services/scoring.py`. No change needed.

---

## 🔎 `/api/channels` - the 84 ms question

It was not the count. The query is **2.3 ms** for 2 channels; the 84 ms was fixed
per-request overhead (`/api/health`, one query, costs 82 ms on the same server).

It was still doing the wrong thing at scale: `annotate(Count("episodes"))` is a
LEFT JOIN + GROUP BY that reads every episode row. Replaced with a correlated
subquery, which is one index-only scan per channel.

| | 2 channels / 1,392 episodes | 8 channels / 7,992 episodes |
| - | - | - |
| `Count(join)` | 1.63 ms | 10.6 ms |
| `Subquery` | 0.94 ms | **4.4 ms** |

---

## 🧪 Regression guard

`apps/api/podcast/tests/test_query_counts.py` (22 tests). Each runs an endpoint over a
small dataset and again over a ~10x larger one and asserts the **query count did not
move**. It never asserts an absolute number - an absolute number gets "fixed" by
bumping the constant, which is how an N+1 comes back.

Both guards were verified to fail when the fix is reverted:
- removing the search prefetch: `11 queries for 3 hits, 86 for 28` ❌
- reading a deferred field in `episode_brief`: `Expected 1 query, 11 were done` ❌

---

## 🚧 Known, measured, NOT fixed

### 1. ⚠️ `description__icontains` is the slowest query in the API

`/api/episodes?q=` and the Postgres search fallback both ILIKE `description`.

```
title ILIKE only          5.5 ms
title OR description     38-44 ms      <- 7x, on 1,392 rows
```

It is a sequential scan by construction: no B-tree can serve `%needle%`. At 8,000
episodes this is ~230 ms, and the 6-way OR + `DISTINCT` in `_postgres_search` makes it
worse (47 ms today).

**Why it was not fixed:** the only real fix is a `pg_trgm` GIN index, and `pg_trgm` is
a Postgres extension. CLAUDE.md forbids vendor-specific extensions so the database
stays movable, and enabling one needs a hand-authored `TrigramExtension` migration,
which is also forbidden. **Meilisearch is the sanctioned answer and already handles
this path** - the ILIKE route only runs when Meilisearch is down. Worth an explicit
owner decision if `/api/episodes?q=` is meant to be a first-class filter rather than a
convenience.

### 2. ℹ️ `queryset.count()` on every list page

Each list endpoint runs a `COUNT(*)` for `meta.total`. At 8,352 rows that is ~5 ms and
it does **not** benefit from the new sort indexes. Options if it ever matters: cache
the unfiltered total, or switch to keyset pagination and drop `total`. Not worth doing
at 1,392 rows.

### 3. ℹ️ `sort=oldest` cannot use a NULLS-LAST index

It needs `ASC NULLS LAST`, served today by a backward scan of the `DESC NULLS FIRST`
index (cost 80). Fine. Only worth its own index if `oldest` becomes a hot sort.
