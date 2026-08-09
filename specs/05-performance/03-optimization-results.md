# ⚡ Performance Optimization - Results

**Executed:** 2026-08-09
**Trigger:** the database grew from 74 to **1,392 episodes across 2 channels**
(one channel has 1,318), and `/channels/{big}` was serving **2.27 MB of HTML**.
**Method:** 5 parallel agent lanes, every claim re-measured by the orchestrator
on a clean production build.

---

## 📊 Measured results

Production build, median of 7 runs after 2 warmups, via `npm run benchmark`.
Sizes are **decoded** KB. `gzip` is the same body compressed.

### API

| Endpoint | Before | After | Change |
|---|---|---|---|
| `/api/channels` | 5.1 KB | **2.3 KB** | **-55%** |
| `/api/episodes?limit=24` | 22.0 KB | **13.8 KB** | **-37%** |
| `/api/search?q=Каспаров` | 1.7 KB | **0.9 KB** | **-47%** |
| `/api/leaderboards/top_rated` | 17.5 KB | **11.7 KB** | **-33%** |
| `/api/channels/ivan-kirkov` | 0.9 KB | **0.5 KB** | -44% |
| `/api/channels/ivan-kirkov/grid` | 54.9 KB | **18.3 KB** | **-67%** |
| **`/api/channels/{big}/grid`** | **1,044.8 KB** | **320.0 KB** | 🎯 **-69%** |

### Pages

| Page | Before | After | Change |
|---|---|---|---|
| `/` | 87.0 KB | **67.4 KB** | -23% |
| `/channels` | 22.6 KB | 22.6 KB | 0% |
| `/episodes` | 172.7 KB | **123.2 KB** | **-29%** |
| `/search?q=` | 32.7 KB | 30.9 KB | -6% |
| `/status` | 35.4 KB | 35.4 KB | 0% |
| `/channels/ivan-kirkov` | 233.6 KB | **210.8 KB** | -10% |
| **`/channels/{big}`** | **2,271.2 KB** | **1,317.2 KB** | 🎯 **-42%** |
| `/e/{id}` | 36.9 KB | 36.1 KB | -2% |

### Query performance (Django test client, same dataset)

| Endpoint | Before | After |
|---|---|---|
| `/api/episodes?limit=24&sort=newest` | 25.7 ms | **10.0 ms** |
| `/api/episodes?limit=100` | 43.9 ms | **16.3 ms** |
| `/api/leaderboards/top_rated` | 15.8 ms | **7.8 ms** |
| `/api/people/{slug}` | 12.2 ms (SQL) | **4.3 ms** |
| `/api/search` postgres fallback, 50 hits | 597 ms / **102 queries** | **171 ms / 4 queries** |

---

## 🔑 The five findings that mattered

### 1. `ensure_ascii` was inflating every Bulgarian payload by ~40%

Django-Ninja's default JSON renderer escapes non-ASCII as `\uXXXX`. On a
Bulgarian API that is not a rounding error: the channel grid alone expanded
**103,968 Cyrillic characters into 406 KB of pure escape overhead on one
response**.

Fixed globally with a `CompactUnicodeJSONRenderer` on the `NinjaAPI` instance
(`config/api.py`), so every endpoint benefits, not just the grid. Bodies are
already `charset=utf-8`, so real UTF-8 is exactly what a client expects.

### 2. The sort indexes were dead

`models.Index(fields=["-public_score"])` compiles to `DESC NULLS FIRST`. Every
list endpoint sorts `DESC NULLS LAST`, so unrated episodes do not top "top
rated". **Postgres cannot use one index to satisfy the other.**
`pg_stat_user_indexes` showed `idx_scan = 0`, and **every browse query was a
full sequential scan plus sort**.

Proven with `EXPLAIN ANALYZE` against a table inflated to 8,352 rows inside a
rolled-back transaction:

| Query | Before | After |
|---|---|---|
| `sort=newest` | Seq Scan, cost 1624, 23.4 ms | Index Scan, cost 24, **0.23 ms** |
| `sort=top` | cost 1624, 21.6 ms | cost 29, **0.23 ms** |
| `channel=X&sort=top` | cost 1396, 20.7 ms | cost 19.7, **0.24 ms** |

7 expression indexes added across two generated migrations. Nothing speculative:
`members_only`, `content_kind` and `channel_id` already had usable indexes.

### 3. An N+1 in the search fallback

`_postgres_search` built `matched_topics` / `matched_moments` per hit without
prefetching: **102 queries for 50 hits**. Worse, it is the **degraded-mode** path
and it also runs on **every Meilisearch query returning zero hits**, because the
zero result is deliberately double-checked against Postgres.

Now **4 queries, flat**. A subtle trap was involved: calling `.select_related()`
on a related manager inside the loop builds a *new* queryset and silently
bypasses the prefetch cache.

### 4. Compression was off

`GZipMiddleware` was not in `MIDDLEWARE`. Bulgarian JSON compresses
extraordinarily well - Cyrillic is 2 bytes per character in UTF-8 and the keys
repeat per row. `/api/episodes?limit=50`: **47,038 B to 4,894 B (-90%)**.

BREACH was assessed rather than waved through: the API has no secret in any
response body (schemas checked), sessions live in cookies, and Django already
masks the admin CSRF token per response as its own BREACH mitigation. The
reasoning is recorded in `settings/base.py`.

### 5. The grid shipped four fields nobody read

`GridCellOut` carried `slug`, `upload_date`, `duration_sec` and `thumbnail_url`
for every cell - **47% of the payload, zero consumers**. `RatingsGrid.tsx` never
read one of them, and `thumbnail_url` violated the project's own "store the video
id, derive the URL at render time" rule.

⚠️ **A briefing assumption was wrong and measurement corrected it.** The lane was
told "over 90% of cells are empty holes". Holes are **34.9%**, and the 706 JSON
`null`s are **3.4 KB, 0.3% of the payload**. A sparse representation was measured
and *rejected* as not worth the schema churn.

---

## 🔒 A security-test defect found by accident

Switching off `ensure_ascii` broke three privacy tests. Investigating them
revealed something worse than a broken test:

```python
assert PRIVATE_TAG not in response.content.decode("utf-8")   # PRIVATE_TAG is Bulgarian
```

Under the old renderer the body contained `ли...`, so a raw substring
search for Bulgarian text **could never match** - whether or not the tag actually
leaked. Demonstrated directly:

| Body genuinely containing the private tag | `TAG in body` |
|---|---|
| old renderer (`ensure_ascii=True`) | **False** |
| new renderer (`ensure_ascii=False`) | **True** |

Since every string in this product is Bulgarian, **the personal-tag leak
detection was non-functional across the board**. It has never caught anything and
could not have.

The three tests now assert against parsed JSON with the query echo excluded (the
caller's own input handed back is not a leak), and they work for the first time.

---

## 🐛 Regressions caught during verification and fixed

Both were introduced by the optimization work itself and caught by the existing
suite, not by inspection.

1. **Pagination's disabled control failed colour contrast** (axe, serious).
   `opacity-40` on the foreground token drops text far below 4.5:1. Being
   `aria-hidden` does not help - the problem is sighted legibility. Replaced with
   `text-muted-foreground`.
2. **A test selector collided.** Episode cards now render their elite score as
   the text `Elite 8.7`, which lands in the card link's accessible name.
   Playwright's `name` option is a case-insensitive **substring** match by
   default, so `getByRole("link", { name: "Elite" })` resolved to the toggle plus
   8 cards. Pinned with `exact: true`; the assertion is unchanged.

---

## ✅ Verification

All run by the orchestrator on a clean production build, not taken from lane
reports.

| Suite | Result |
|---|---|
| `uv run pytest -q` | **339 passed** (317 before + 22 new query-count guards) |
| `npx vitest run` | **137 passed** |
| `npx playwright test` | **236 passed**, 0 flaky |
| **Total** | **712 automated tests** |
| `npx turbo typecheck lint build` | **4/4 successful** |
| `makemigrations --check` | no pending changes |

**No test was weakened.** Two were made stronger (the privacy assertions), one
selector was made precise, and 22 new query-count regression guards were added
that assert the query count **does not move** as row count grows 10x - never an
absolute number, because an absolute number gets "fixed" by bumping the constant.

---

## 🚧 Still outstanding

### The big channel page is 1,317 KB and still over budget

The 600 KB budget in `perf-budgets.json` is deliberately below what 1,318
fully-rendered cells can reach. Next ships the tree **twice** (HTML + RSC flight
payload), so meeting it requires one of:

- **Year windowing** (`?years=2024`), each slice its own indexable URL. Cheapest
  remaining win, but it changes what the page shows by default - a **product
  decision**, not a performance one.
- Not emitting elements for holes at all (706 `<td>` on this channel).
- Client-side column virtualization, which costs the no-JavaScript guarantee.

The waiver in `apps/web/tests/perf-budget.spec.ts` is a ratchet: it fails if the
page regresses, and **also** fails with `STALE WAIVER` once it comes back inside
budget, forcing the exemption to be deleted.

### Compact grid mode has no automated coverage

The e2e fixture channel is `ivan-kirkov` at 37 columns, below the
`COMPACT_ABOVE_COLUMNS = 48` threshold, so all 16 grid tests exercise only the
comfortable path. An e2e case against the big channel is worth adding.

### `description__icontains` is the slowest query in the API

`title` alone is 5.5 ms; `title OR description` is **38-44 ms** on 1,392 rows and
roughly 230 ms at 8,000. Sequential scan by construction - no B-tree serves
`%needle%`. The only real fix is a `pg_trgm` GIN index, which is a Postgres
extension and is **forbidden by the portability rule**. Meilisearch is the
sanctioned answer and already owns this path. **Needs an owner decision if
`/api/episodes?q=` is meant to be a first-class filter.**

### Zero-hit searches cost 2x a hit

239 ms versus ~105 ms, because every miss runs the Postgres confirmation scan (a
6-way join with `DISTINCT` plus `COUNT`). Reads are deliberately unthrottled, so
repeated gibberish is a cheap way to load the database. Deliberately left alone:
that fallback is a safety net with a test pinning it. The safe fix is to gate it
on the index document count actually being low, rather than on any zero result.

### Other

- `/search` has no pagination but now honestly reports 1,371 results while
  rendering 24. Invisible at 74 episodes, obvious at 1,392.
- `/channels/[slug]` renders an episode list with no pagination. `<Pagination>`
  is generic and drops straight in.
- TanStack Query ships to every public page (~17 KB gzipped) for a single button
  on `/status`, which is `robots: noindex`.
