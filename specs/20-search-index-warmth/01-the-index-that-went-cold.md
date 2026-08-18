# The index that went cold, and the years that read backwards

**Date:** 2026-08-18
**Trigger:** the owner's end-to-end walkthrough of production, on a phone.
**Two findings, unrelated except in timing.**

---

## 1. "Transcript search is unavailable right now"

### What was reported

A live search on comedycommunity.club rendered the degraded banner:

> Transcript search is unavailable right now. Only title, topic and moment matches are shown.

### What it actually was

Not a bug in search, and not Meilisearch being slow. The API's log:

```
WARNING podcast Transcript multi-search failed for 'Царичина'
meilisearch.errors.MeilisearchTimeoutError: HTTPConnectionPool(
  host='meilisearch.railway.internal', port=7700): Read timed out. (read timeout=5)
```

Meilisearch's own log, for the **same request**:

```
POST /multi-search  status_code=200  time.busy=5.13ms  time.idle=14.5s
```

🚨 **Five milliseconds of work inside fourteen and a half seconds of waiting.**
Meilisearch searched instantly and then took 14.5s to get round to answering. The
API's 5s read timeout had fired nine seconds earlier, `search_transcripts`
returned `available: False`, and `/search` correctly degraded to label matches
rather than 500ing. Every layer behaved as designed. The stall was the anomaly.

### Why the transcript half and not the titles

Both halves of `/search` fire in one `Promise.all`. In that same second:

| Request | Index | Documents | Result |
| ------- | ----- | --------- | ------ |
| `/multi-search` | `episodes` | 1,862 | ✅ 14.6ms |
| `/multi-search` | `transcript_segments` | 61,452 | ❌ 14.5s stall |

Same container, same instant, same connection era. The small index was resident;
the big one - ~2 GB projected, on a Railway volume - had to be paged back in.

🚨 **The health check cannot see this.** `is_available()` had passed 30 seconds
earlier and would have passed again. **A healthy server and a resident index are
different claims**, and only one of them is what a search actually needs.

### Scope, measured rather than assumed

- **One** occurrence in two days of API logs. That one is the owner's query.
- Re-probed immediately after: `Царичина` → 0.42s end to end, 9 episodes,
  16 passages, `available: true`. Same for `пица` and `ергена`.
- Meilisearch CPU 0.5%, memory 2.17 GB, **same Railway region as the API**
  (`sfo`, 1 replica each). Nothing was overloaded and nothing was cross-region.

### The fix: keep it warm, do NOT raise the timeout

`podcast/search/warm.py` + `podcast.warm_search_indexes`, on Celery Beat every
4 minutes. One `multi_search` round trip, one exhaustive count per index.

- ✅ **`count_only=True` on both.** It walks the posting list - which is the
  paging-in we want - while retrieving a single document, which is the part we
  do not want to pay for. A `limit=20` search would hydrate 20 segments every
  four minutes AND only touch the top of the ranking, the part already most
  likely to be resident.
- 🇧🇬 **The warm query must not be a stop word.** A stop word is erased at index
  time, so it matches nothing and touches nothing - and the task would still
  return 200 and still log "ok". `test_the_warm_query_is_not_a_stop_word` is the
  single assertion that keeps this from being theatre. `много` was chosen for
  being common: a rare word reads a few pages and leaves the index as cold as it
  found it. Live locally: 739 episodes / 20,000 segments in 47ms.
- ✅ **It runs on the WORKER, not in a request.** The page cache it warms lives
  in the Meilisearch container, so it does not matter who asks.
- ✅ **It reports per-index `totalHits`,** so a warm-up against an *empty* index
  is distinguishable from a healthy one. "The call succeeded" is exactly what a
  wiped volume also produces - same lesson as "a reindex closes on COUNTS".
- ✅ **It times WALL CLOCK, not `processingTimeMs`.** The incident was 5ms of
  processing inside 14.5s of waiting, so a task that logged only the server's own
  number would have reported that exact request as healthy.
- ✅ **It never raises and never retries.** A warm-up that failed is a warm-up,
  not an outage; every real search path already surfaces an outage where a user
  can see it, and a retrying beat task would hammer a struggling search server.

❌ **Raising `MEILI_TIMEOUT` was rejected.** 5s is already generous for something
that measures in single-digit milliseconds, no reader should wait 14s, and a
longer timeout only converts a wrong answer into a wrong answer that also holds a
gunicorn worker. `DEFAULT_TIMEOUT_SECONDS = 5` stays.

### ⚠️ What this fix does not do

It does not make a cold index fast. It makes the index unlikely to *go* cold -
a probabilistic fix for a failure observed once in two days. **If the banner
reappears with this scheduled, and Meilisearch again reports a large `time.idle`
against a tiny `time.busy`, the next suspect is the container being descheduled**,
which is a hosting question and not a code one. That is written down here so the
next person does not re-derive the same log line.

---

## 2. The ratings grid stacked its years oldest-first

### What was reported

> maybe we should order the episodes based on the newest at the top [...]
> otherwise it's a bit strange every time to scroll at the bottom to see the
> current year

### The change

`flowSeasons()` in `apps/web/components/grid/grid-model.ts`. The flow grid now
stacks year blocks **newest first**; the flagship channel leads with 2026 instead
of 2016, eleven blocks down.

🚨 **Only the vertical stack is reversed. Three other places keep the API's
order, on purpose:**

| Surface | Axis | Order | Why |
| ------- | ---- | ----- | --- |
| Flow grid year blocks | vertical | **newest first** | oldest-first buried the current year under ~23 wrapped lines |
| Inside a year block | wrap order | oldest first | "episode 14 of 2024" means nothing in any other order |
| Mobile transposed table | horizontal (columns) | oldest first | a right-to-left time axis is the bug, and 4 years or fewer fits on one screen anyway |
| `YearSparkline` | horizontal | oldest first | same - it is a time chart |

### 🚨 The one way this breaks silently

`seasonCells(grid, seasonIndex)` and `row.cells[seasonIndex]` are both keyed by
the season's position in the API's own array. The obvious reversal -

```ts
grid.seasons.slice().reverse().map((season, i) => …)   // ❌
```

- renumbers as it goes, and hands **every block a different year's episodes**.
Nothing looks wrong: every cell still renders, every count under every header is
still plausible, and only the pairing is wrong. `flowSeasons` therefore carries
the ORIGINAL index alongside each season, and the unit test named
"keeps each season's ORIGINAL index, not its position after reversing" pins
exactly that.

### How it is tested

- **Unit** (`tests/grid-model.spec.ts`): descending order, preserved original
  index, no mutation of the API array (mobile and the sparkline still read it),
  and the empty-channel case.
- **E2E** (`e2e/ratings-grid.spec.ts` 3.1c): reads `data-year` out of the DOM and
  asserts a **strictly descending** run, then asserts the SET matches the API.
  Deliberately not compared against a derived list - that could only prove the
  two agree, where this proves the direction, which is the thing a stray
  `.reverse()` would flip back.
- The spec's `apiFlowSeasons` helper is **written a second time on purpose**
  rather than imported from `grid-model`, following the rule already stated on
  `apiSeasonCells`: importing the app's helper would make the suite reproduce the
  renumbering bug and agree with it.

Verified on the real flagship channel page:
`['2026','2025','2024','2023','2022','2021','2020','2019','2018','2017','2016']`.
