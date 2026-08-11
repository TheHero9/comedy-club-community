# Edge-case hardening sweep

**Run:** 2026-08-11
**Trigger:** "fill every page with data, then test everything - performance, edge cases, no bugs"
**Result:** 7 real bugs found and fixed. **753 -> 958 automated tests.**

---

## 📋 What was actually done

1. Filled the two models the seeder never touched, so `/me/tags` and the
   moderation queue stopped rendering as if the features did not exist.
2. Swept every route with hostile input (malformed query strings, NUL bytes,
   SQL-looking slugs, path traversal, 3 KB values, emoji, Cyrillic).
3. Chased the flaky E2E test that `STATUS.md` had recorded as "unexplained" on
   2026-08-10, and found it was not a test problem at all.
4. Re-measured every performance budget and cut the worst route by 17%.

---

## 🐛 The seven bugs

### 1. 🚨 Postgres connection exhaustion under parallel load

**The one that mattered.** `base.py` sets `conn_max_age=600`, which is correct
for production - gunicorn has a fixed worker count, so open connections are
bounded at `workers x threads`.

`manage.py runserver` has no such bound. It spawns a **new thread per request**
and Django keeps one connection per thread, so every concurrent request pinned a
connection for ten minutes against Postgres' default `max_connections = 100`.

Measured before the fix:

| Concurrency | Result |
| ----------- | ------ |
| 8 simultaneous requests | **14 of 32 responses were 500** |
| after load stopped | **65 connections still idle** |
| three consecutive E2E runs | **1 -> 4 -> 10** failures, accumulating |

```
django.db.utils.OperationalError: connection failed:
FATAL: sorry, too many clients already
```

After `CONN_MAX_AGE = 0` in `dev.py`: **48 concurrent -> 192/192 OK, 1
connection held.**

> 🔍 **Why it hid for a whole session.** Next.js serves the **stale** entry from
> its fetch cache when a revalidation request fails. The API 500 therefore never
> reached the browser - the page rendered plausible-but-outdated scores, and the
> failure surfaced as a ratings-grid *data mismatch*. That is exactly the
> "unexplained flaky E2E" in `STATUS.md`. A test comparing the rendered page
> against a live API call is the only thing that noticed.

Pinned by `podcast/tests/test_db_connection_policy.py`.

---

### 2. 🚨 A NUL byte 500ed ten endpoints

`U+0000` is legal in a URL (`%00`) and legal in a JSON string (`\u0000`), so it
arrives as an ordinary Python `str` and satisfies **every** Pydantic constraint
the API declares. It fails only at the bottom, inside psycopg.

Confirmed 500s from a single unauthenticated request:

```
GET  /api/episodes?channel=a%00b     (also person, topic, q, kind)
GET  /api/search/suggest?q=a%00b
GET  /api/episodes/a%00b             (path segment)
POST /api/episodes/{id}/comments     {"body": "a\u0000b"}
POST /api/episodes/{id}/tags         {"text": "a\u0000b"}
POST /api/episodes/{id}/moments      {"label": "a\u0000b"}
POST /api/episodes/{id}/topics       {"name": "a\u0000b"}
```

Fixed with **one** choke point, `podcast/middleware.RejectNullBytesMiddleware`,
in the same spirit as the single `WriteThrottle` on the whole `NinjaAPI`: a new
endpoint cannot ship NUL-vulnerable by omission. It checks the path, every query
parameter, and JSON bodies (recursively).

SQL injection and path traversal were already handled correctly - both 404.

---

### 3. 🚨 `/search?q=???` returned the entire catalogue

`"???"` is non-empty after `.strip()`, so it reached Meilisearch - which
tokenizes it to nothing, treats that as a **placeholder search**, and matches
every document. The endpoint reported **1,393 episodes as matches for `???`**.

Returning everything is the worst failure mode a search box has, because it
looks like a working feature. It is also precisely the symptom `CLAUDE.md`
documents for Cyrillic mangled by a shell (every letter becomes `?`), so an API
that answers it honestly is what keeps that diagnosis readable.

The endpoint always held that an *empty* query returns 0 hits rather than
everything. `has_searchable_text()` extends the same rule to a query that is
empty as far as a tokenizer is concerned, and both `/search` and
`/search/transcripts` now use it.

---

### 4. 🚨 The eleventh click on "Зареди още" served a 500

`readFilters` clamped `limit` to **200**. The API declares
`Query(24, ge=1, le=MAX_LIMIT)` with `MAX_LIMIT = 100`. Anything above 100 was
forwarded verbatim, rejected with a 422, and thrown out of a Server Component as
an error page.

This was **not** only reachable by hand-editing a URL. "Зареди още" adds
`PAGE_SIZE` (9) to `limit` on every click, so on a 1,393-episode catalogue the
eleventh click (9 -> 108) crossed the ceiling.

`?limit=2.5` was the same bug by another route: `Number("2.5")` is finite and
positive, so a float reached an `int` parameter.

Fixed by clamping to a `MAX_API_LIMIT` that `tests/filter-model.spec.ts` parses
out of the Python source, flooring to an integer, and hiding the load-more
control once the ceiling is reached.

> ⚠️ **Known limitation, not fixed here:** `/episodes` still cannot page past
> 100 episodes, because "load more" grows `limit` rather than using `offset`.
> Previously that was a 500; it is now a button that stops appearing. Making the
> browse page reach all 1,393 episodes is a pagination change and is left as an
> explicit decision rather than done silently.

---

### 5. A 400 from the API is still a 500 from the page

Fixing the API moved the NUL error one layer up rather than removing it: a 400
raised inside a Server Component is an unhandled throw, which Next renders as a
500. `lib/sanitize.ts` now strips C0/C1 control characters where the query
string is first read, in both `/episodes` and `/search`.

🇧🇬 The range is control characters **only** - Cyrillic passes through
untouched, and `tests/filter-model.spec.ts` pins both directions, because a
sanitiser that ate Bulgarian would break every real slug while still passing a
NUL-byte test.

---

### 6. `seed_demo --seed` never meant what it said

The command advertises `--seed` as "RNG seed for repeatability" and it was not
reproducible. Two causes:

- **Unordered queries.** `Episode.objects.filter(...)` with no `ORDER BY`, and
  four `[:400]` pool slices, so the same RNG sequence landed on different rows.
- **Conditional draws.** Six sites called `random.*` *inside* the "does this row
  already exist?" branch. A draw that only happens for new rows makes the stream
  diverge the instant anything exists, so a second run wrote a whole new
  generation of rows instead of being a no-op: **201 -> 342 ratings, 72 -> 142
  reports**, while printing a normal-looking summary.

Every draw now happens before the existence check, and the topic-vote loop walks
the full candidate list rather than the filtered one. `--seed 7` twice is now a
byte-for-byte no-op.

---

### 7. `--clear` would have stranded every report

`Report.reporter` is `on_delete=SET_NULL` and its target is a
`GenericForeignKey`, so **neither** deleting the demo users **nor** deleting the
reported comments removes a Report row. Left to the cascade, `--clear` would
have left every report as an ownerless row pointing at a primary key that no
longer exists - and the moderation queue renders those perfectly happily,
because `_report_out` never dereferences the target. The leak would have stayed
invisible until the ids were reused by unrelated rows.

---

## 🧪 Two flaky tests, diagnosed rather than retried

| Test | Real cause |
| ---- | ---------- |
| `ratings-grid 3.8` public/elite toggle | Finding #1. Stale fetch-cache entry served while the API was 500ing on connection exhaustion. Also hardened against a soft-navigation race by asserting `aria-current` before reading the grid. |
| `a11y 12.4 /status has exactly one h1` | React streaming SSR stages late content in a hidden container before moving it, so **two h1s genuinely exist** for an instant. `toHaveCount(1)` passed in the gap and `toBeVisible()` then hit a strict-mode violation. `expectSingleVisibleH1()` retries both conditions together - same guarantee, one instant. |

Neither was weakened. `3.8` gained an assertion; `12.4` still requires exactly
one visible `h1`.

---

## 🌱 Data gaps filled

`PersonalTag` and `Report` were both **0 rows**, so `/me/tags` and the
moderation queue looked like unbuilt features.

| Model | Before | After |
| ----- | ------ | ----- |
| `PersonalTag` | 0 | 669 (private, ~18% of episodes, deliberately sparse) |
| `Report` | 0 | 72 across **all four** reportable types and **all three** statuses |

> 🚨 The queue is deliberately not seeded pending-only. A queue containing
> nothing but `pending` never exercises the resolved/dismissed filters, so a
> broken `status=all` branch would render identically to the default.

Authorization verified against the seeded data: moderator 200, member **403**,
anonymous **401**, and per-user tag scoping (46 rows vs 33 for a different user).

---

## ⚡ Performance

`/channels/комеди-клуб-подкаст-comedy-club-podcast`: **2076.3 KB -> 1724.1 KB
(-17%)**.

Every cell carried `aria-label` and `title` set to the **same** string, plus
`data-title` - the episode title three times per cell, across 2,024 cells, and
then again because the RSC flight payload serializes the whole tree (measured at
**56% of the page**).

The `title` was not buying anything: `GridInteraction` renders a real hover
preview from the `data-*` attributes, so the native tooltip fired *alongside*
that card rather than instead of it. Removing it changes no accessible name.

**All 19 budgets pass.** The waiver ceiling was **not** raised.

> 🚨 The direction of travel is the finding. Demo seeding alone took this route
> from 1355.2 KB to 2076.3 KB, because a rated cell carries a score, band and
> count where a null hole carries nothing. Ordinary data growth ate three
> quarters of the ratchet's headroom in a single run. There is ~76 KB left and
> the route is still **2.9x** over its real 600 KB budget, so the structural fix
> - empty holes must stop being elements, or the grid paginates by season - is
> no longer deferrable.

---

## ✅ Suite totals

| Suite | Before | After |
| ----- | ------ | ----- |
| pytest | 357 | **423** |
| Vitest | 137 | **166** |
| Playwright | 259 | **369** |
| **Total** | **753** | **958** |

New files:

```
apps/api/podcast/middleware.py                        NUL-byte guard
apps/api/podcast/tests/test_null_bytes.py             incl. a sweep over every GET
apps/api/podcast/tests/test_search_unsearchable_queries.py
apps/api/podcast/tests/test_db_connection_policy.py
apps/api/podcast/tests/test_seed_demo.py              round-trip + idempotency
apps/web/lib/sanitize.ts
apps/web/tests/filter-model.spec.ts                   parses MAX_LIMIT from Python
apps/web/e2e/edge-cases.spec.ts                       55 hostile-input cases x 2 viewports
```

Verified green: `turbo typecheck lint build` 4/4, `ruff check` clean,
423 pytest, 166 Vitest, 369 Playwright, 19/19 performance budgets.
