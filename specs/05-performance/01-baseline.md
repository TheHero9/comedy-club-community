# ⚡ Performance Baseline and Budgets

**Captured:** 2026-08-09
**Harness:** `scripts/benchmark.mjs`
**Budgets:** `scripts/perf-budgets.json`
**Enforcement:** `apps/web/tests/perf-budget.spec.ts` (Vitest)
**Machine:** Windows 11, node v24.16.0, win32 x64. All servers local.

> This document is the record of what the app cost **before** the optimisation
> campaign, and the instructions for proving whether anything actually improved.
> It measures. It does not change application code.

---

## 🎯 What is being measured, and why those two numbers

| Column | Meaning |
| ------ | ------- |
| `median ms` | Wall clock from issuing the request to having the **entire body** in hand. Median of N timed runs after warmup. |
| `min-max ms` | The observed spread across those runs. Printed so noise is visible instead of hidden behind an average. |
| `KB` | **Decoded** payload. What the browser parses and keeps in memory. Deterministic to the byte. |
| `gzip KB` | The same body gzipped locally. An **estimate** of the 4G wire cost. Informational only. |

**Budgets are enforced on decoded KB and on median ms.** They are not enforced on
`gzip KB`, because the compressor and level at a real edge are not ours to pin
down, and claiming a wire number we did not observe would be dishonest.

### Why a median of at least 5 runs

A single warm sample on a developer laptop is an anecdote. Measured spread on
this machine, back to back with no code change in between:

| Route | run A median | run B median | delta |
| ----- | ------------ | ------------ | ----- |
| `/` | 12.5 ms | 13.3 ms | +6.4% |
| `/status` | 55.8 ms | 62.0 ms | +11.1% |
| `/search?q=Каспаров` | 63.3 ms | 54.5 ms | -13.9% |
| `/e/utcF7etPyyk` | 33.6 ms | 28.5 ms | -15.2% |
| `/channels/комеди-...` | 387.1 ms | 422.6 ms | +9.2% |

**Payload was byte-identical (+0.0%) on every route across the same two runs.**

That is the whole argument for the budget design: **size is the reliable signal,
time is the noisy one.** Payload budgets are set tight. Time budgets are set
loose enough that only a route roughly doubling will trip them, and the
`--compare` regression threshold defaults to 20%.

### Warmup

Two discarded requests per route, plus three process-level warmup round trips
before the first route is touched. Without the process-level pass the first
route measured absorbs connection-pool setup and lazy server imports and reports
a median 2-3x everyone else's - `/api/health` measured **45 ms as the first
route and 12 ms once pre-warmed**. That is a harness artefact, not a finding.

### Cyrillic safety

Every URL is built in node with `encodeURIComponent` and `URLSearchParams`.
The Bulgarian search term and the Cyrillic channel slug never touch a shell
argument. Git Bash mangles non-ASCII argv into `????`, which tokenises to
nothing and makes `/api/search` return **every document** - a fake relevance bug
that has already cost this project real debugging time. The channel slug
`комеди-клуб-подкаст-comedy-club-podcast` is discovered from `GET /api/channels`
at runtime, never hardcoded, so newly ingested channels are picked up
automatically.

---

## 📊 Baseline table

Full green run, 9 timed runs per route after 2 warmup requests. API on `:8000`,
**production** web build on `:3200`. 2 channels, 1392 episodes.

```
route                                                       median ms   min-max ms      KB  gzip KB  status
----------------------------------------------------------  ---------  -----------  ------  -------  ------
[API]
/api/health                                                      33.2      30-48.1     0.1      0.1     200
/api/channels                                                    14.4    13.4-18.4     5.1      1.1     200
/api/episodes?limit=24&sort=newest                                 26    25.1-30.2      22      2.7     200
/api/episodes?limit=24&sort=top_rated                              25    23.9-29.2      22      2.7     200
/api/search?q=Каспаров                                           33.7    28.8-47.2     1.7      0.6     200
/api/leaderboards/top_rated                                      19.6    18.6-20.3    17.5      2.4     200
/api/channels/ivan-kirkov                                        11.5    11.1-12.9     0.9      0.4     200
/api/channels/ivan-kirkov/grid                                     30    27.4-31.9    54.9      6.6     200
/api/channels/комеди-клуб-подкаст-comedy-club-podcast            16.5    15.5-18.7     4.2        1     200
/api/channels/комеди-клуб-подкаст-comedy-club-podcast/grid      261.2  247.9-280.4  1044.8    101.4     200
[WEB]
/                                                                16.7    14.1-18.6      87     11.2     200
/channels                                                        10.8     8.2-23.3    22.6      4.9     200
/episodes                                                        74.5    70.6-84.2   172.7     13.9     200
/search?q=Каспаров                                               61.8    56.6-75.1    32.7      6.8     200
/status                                                          66.2    62.2-78.2    35.4      7.1     200
/channels/ivan-kirkov                                            87.8   76.8-105.8   233.6     23.2     200
/channels/комеди-клуб-подкаст-comedy-club-podcast               463.9  413.3-516.3  2271.2    166.2     200
/e/utcF7etPyyk                                                     42      30.4-62    36.9      7.1     200
```

### ⚠️ Honesty note: this baseline was captured against a moving target

Four other lanes were editing the API and the web app during this capture. Two
things were observed and are recorded here rather than smoothed over:

1. **`/api/channels/{slug}/grid` payload halved mid-session.** The big channel
   measured **1044.8 KB** in the runs above and **545.1 KB** roughly twenty
   minutes later, with `ivan-kirkov` moving 54.9 KB to 29.5 KB in the same
   window. Another lane's change landed between the two runs. The table above is
   the earlier, fully green state.
2. **Both grid endpoints then started returning HTTP 500** (see Findings below).
   The 9-run table above is the last capture in which every route answered 200.

The web-tier numbers were stable throughout: `/channels/комеди-...` measured
2271 KB on every single run, from first capture to last.

### 🕒 State at hand-off (last run of the session, 9 runs, all 200)

Recorded separately from the baseline because it is already an "after" for one
lane's work, and because the machine was noticeably noisier by then (four agents
active - note the 391-1001 ms spread on the last row, which is why the ms budgets
are loose and why KB is the number to trust).

| Route | baseline KB | hand-off KB | change |
| ----- | ----------- | ----------- | ------ |
| `/api/channels/ivan-kirkov/grid` | 54.9 | **18.3** | -67% |
| `/api/channels/комеди-.../grid` | 1044.8 | **320.0** | -69% |
| `/channels/комеди-...` (page) | 2271.2 | **2271.5** | unchanged |

Every other route was byte-identical to the baseline. The API grid payload
problem is largely solved; **the 2.2 MB channel page is not**, and it remains the
headline number.

Waiver ceilings were tightened to the hand-off state (`api:channel-grid` now
ratchets at 600 KB / 550 ms instead of the original 1100 KB / 400 ms) so the
recovered ground cannot be quietly given back.

---

## 💰 The budgets

Set at what is **acceptable for a phone on 4G** (~1.5-4 Mbps usable, ~100 ms
RTT), not at what is current. Full justification per route lives in the `why`
field of every entry in `scripts/perf-budgets.json`; the summary is here.

| Budget key | KB | ms | Observed | Verdict | Reasoning |
| ---------- | -- | -- | -------- | ------- | --------- |
| `api:health` | 5 | 150 | 0.1 KB / 33 ms | ✅ | Trivial body, but it fans out to Postgres, Redis and Meilisearch, so it is legitimately the slowest cheap endpoint. |
| `api:channels` | 25 | 100 | 5.1 KB / 14 ms | ✅ | ~2.5 KB per channel including a long Bulgarian description. 6-8 channels lands near 20 KB. Past 25 KB, descriptions belong on the detail endpoint. |
| `api:episodes-list` | 40 | 120 | 22 KB / 26 ms | ✅ | 22 KB for 24 cards is ~900 B per DTO, already generous. Room for a field or two, not for doubling. |
| `api:search` | 40 | 250 | 1.7 KB / 34 ms | ✅ | Sample query is narrow; a broad Bulgarian term fills a page, so the ceiling is sized like a listing. 250 ms covers Meilisearch plus Postgres hydration. |
| `api:leaderboard` | 30 | 120 | 17.5 KB / 20 ms | ✅ | Bounded top-N. Must never grow with the corpus. |
| `api:channel-detail` | 25 | 100 | 0.9-4.2 KB / 11-17 ms | ✅ | Must stay O(1) in episode count. Approaching 25 KB means episodes have leaked in. |
| `api:channel-grid` | **200** | **150** | **1044.8 KB / 261 ms** | 🚨 **breach, waived** | A cell needs an id, a score, a band and a position: ~100 B. 1318 real cells is ~130 KB. 200 KB is achievable and still demands a **5x cut**. |
| `web:home` | 150 | 200 | 87 KB / 17 ms | ✅ | Prerendered, `x-nextjs-cache: HIT`. The most-shared URL on the site; it must stay the cheapest. |
| `web:channels` | 120 | 200 | 22.6 KB / 11 ms | ✅ | 8 channels stays well under 100 KB. The ceiling catches a listing that starts embedding data it does not render. |
| `web:episodes` | 200 | 300 | 172.7 KB / 75 ms | ✅ | 172.7 KB decoded is only 13.9 KB gzipped, which is a fine 4G cost. The ceiling stops 24 cards silently becoming 48. |
| `web:search` | 120 | 300 | 32.7 KB / 62 ms | ✅ | Sized like a listing, not like the narrow sample query. |
| `web:status` | 120 | 400 | 35.4 KB / 66 ms | ✅ | `force-dynamic` and deliberately performs live dependency checks per request. Loosest latency budget on the site, and it is an operator page. |
| `web:channel-page` | **600** | **300** | **2271.2 KB / 464 ms** | 🚨 **breach, waived** | 600 KB decoded is ~45 KB gzipped: about a second of 4G transfer and a DOM a phone can still hold. Demands a **~3.8x reduction**. |
| `web:episode-page` | 150 | 300 | 36.9 KB / 42 ms | ✅ | O(1) in corpus size and the main SEO landing page. 150 KB is room for comments, moments and topics with a cap. |

### Why the two big budgets are set *below* what the current architecture can reach

`web:channel-page` at 600 KB is not reachable by rendering 1318 grid cells as
full elements, and that is deliberate. The grid is **11 seasons x 184 columns =
2024 cells, of which over 90% are empty holes**, and Next ships the tree twice
(server HTML plus the RSC flight payload), so every wasted element is paid for
twice. A budget that 2 MB of HTML could satisfy would not be a budget. Meeting
600 KB requires empty holes to stop being elements, or the grid to paginate by
season. Both are correct fixes.

The same logic applies to `api:channel-grid`: the template key is shared by
every channel, so a future channel too large to fit 200 KB is telling you the
endpoint needs pagination, not that the number needs raising.

---

## 🔒 How the budgets are enforced

`apps/web/tests/perf-budget.spec.ts` runs `scripts/benchmark.mjs --json
--budgets --runs 5` and asserts one test per discovered route.

- **It skips gracefully when the servers are down** (verified: 936 ms, 1 skipped,
  0 failed). The unit suite must work offline.
- **It does not skip when they are up.** Reachability is probed directly with
  `fetch`, never inferred from the benchmark's exit code, because a non-zero exit
  is also exactly what a real breach looks like.
- A failure names the route, the budget, the measured value and the spread:

  ```
  route:    /api/channels/ivan-kirkov/grid
  budget:   200 KB / 150 ms
  measured: 0.5 KB / 55 ms median (49.3-61.4 ms over 5 runs)
  status:   500
    api:channel-grid:ivan-kirkov (/api/channels/ivan-kirkov/grid): request failed - status 500
  ```

- There is a floor assertion (`results.length >= 10`) so that a route-discovery
  failure cannot make every per-route test vacuously pass.

### Waivers are ratchets, not exemptions

The two known breaches are listed under `waivers` in `perf-budgets.json` so the
suite is not permanently red while the payload work is in flight. A waiver is
**not** an opt-out:

| Situation | Result |
| --------- | ------ |
| Waived route stays over budget but within its recorded ceiling | `waived` - passes |
| Waived route gets **worse** than its recorded ceiling | ❌ **fails** - "WORSE than the waived ceiling" |
| Waived route comes **back inside budget** | ❌ **fails** - "STALE WAIVER, delete it" |

That last row is the important one. It is the same ratchet pattern as the
now-empty hardcoded-copy list in `tests/copy.spec.ts`: once the problem is
fixed, the test forces the exemption to be deleted, so the budget starts being
enforced for real instead of quietly staying disabled forever.

**Consequence for this campaign:** when the optimisation lanes land, this test
will fail with `STALE WAIVER`. That failure is the success signal. Delete the
waiver entry and re-run.

---

## ▶️ How to re-run

Both servers must already be up. **Do not start a `next build`/`next dev` while
other work is in flight** - a concurrent build corrupts `.next`.

```bash
# API
cd apps/api && uv run python manage.py runserver

# web, PRODUCTION build on port 3200 (a dev server compiles on demand and its
# timings are meaningless)
cd apps/web && npm run build && npm run start -- --port 3200
```

Then, from the repo root:

```bash
npm run benchmark                                  # table, 7 runs per route
npm run benchmark -- --runs 9                      # tighter median
npm run benchmark -- --budgets                     # table + verdicts, exit 1 on breach
npm run benchmark -- --json                        # machine readable
npm run benchmark -- --save perf-before.json       # capture a baseline
npm run benchmark -- --compare perf-before.json    # before/after with % deltas
npm run benchmark -- --only web:channel-page       # one route family
```

Enforce as a test:

```bash
cd apps/web && npx vitest run tests/perf-budget.spec.ts
```

Options and environment:

| Flag | Env | Default |
| ---- | --- | ------- |
| `--api-url` | `BENCH_API_URL` | `http://localhost:8000` |
| `--web-url` | `BENCH_WEB_URL` | `http://localhost:3200` |
| `--runs` | `BENCH_RUNS` | 7 (minimum 5) |
| `--warmup` | `BENCH_WARMUP` | 2 |
| `--timeout` | `BENCH_TIMEOUT` | 30000 ms |
| `--threshold` | - | 20 (% regression for `--compare`) |

Exit codes: `0` ok, `1` budget breach or comparison regression, `2` a server was
unreachable, `3` a route failed.

### Before/after protocol for the campaign

```bash
npm run benchmark -- --runs 9 --save perf-before.json   # captured in this doc
# ... optimisation lands ...
npm run benchmark -- --runs 9 --compare perf-before.json
```

`--compare` reports a per-route percentage delta on both median ms and KB and
flags anything more than 20% worse. Treat the KB column as the verdict and the
ms column as corroboration - see the noise table at the top.

---

## 🐛 Findings: performance problems observed, not fixed

Lane 4 does not modify application code. These are reports.

### 1. 🚨 Both `/api/channels/{slug}/grid` endpoints returned HTTP 500 during this session

Not a performance issue - a live breakage introduced by concurrent work while
the baseline was being captured. Recorded because the harness caught it and
because it must not ship:

```
GET /api/channels/ivan-kirkov/grid  ->  500
NameError: name 'HttpResponse' is not defined
  apps/api/podcast/api/public.py, line 115, in get_channel_grid
```

The traceback showed the name being referenced from inside what had become a
comment block. The Vitest budget spec failed on it, correctly, with
`status: 500`. **It was fixed by the owning lane before the end of the session**
and both grid routes answered 200 on the final run. Kept here because it is the
proof that the harness bites on a broken route rather than quietly reporting a
0.5 KB error body as a fast, small response.

### 2. 🚨 The channel page is over 90% empty grid cells

`/channels/комеди-клуб-подкаст-comedy-club-podcast` ships **2271 KB of HTML**
against 233.6 KB for the 74-episode channel. The grid is 11 seasons x 184
columns = 2024 cells for 1318 episodes, so **more than 700 cells are holes** and
the column count is driven by the single busiest season. Rendering a hole as a
full element costs DOM nodes, HTML bytes and RSC flight bytes - the last two
twice over, since Next serialises the tree alongside the HTML.

Cheapest wins, in order: stop emitting elements for holes, cap the column count
per season row, or paginate the grid by season.

### 3. ⚠️ `/api/leaderboards/top_rated` is 4x larger than the campaign brief recorded

Brief: 4.2 KB. Measured here: **17.5 KB**, stable across every run. A leaderboard
is a bounded top-N list and has no business growing with the corpus, so this is
worth a look: either the row DTO is carrying full episode detail, or the result
set is not actually capped. Budgeted at 30 KB, so it passes today, but it should
not have moved.

### 4. ℹ️ `/api/health` is the slowest trivial endpoint on the API

33 ms median for a 0.1 KB body, against 11-14 ms for `/api/channels`. Expected -
it fans out to Postgres, Redis and Meilisearch - but it sets the floor for
`/status` (66 ms) and is the reason that page has the loosest latency budget on
the site. Not a bug, just the thing to remember before "optimising" `/status`.

### 5. ℹ️ `/episodes` is 172.7 KB decoded but only 13.9 KB gzipped

A 12.4x compression ratio, which means the page is highly repetitive markup
rather than genuine content weight. Fine on 4G today. Worth knowing that the
decoded number overstates the network cost on every listing page on this site,
which is why decoded KB is budgeted as a **parse and memory** proxy and the
gzipped figure is reported next to it.

---

## 🚧 Limits of this harness

Stated plainly so nobody over-reads the numbers.

- **Server-side only.** It measures time to full response body. It says nothing
  about LCP, CLS, INP, hydration cost or JavaScript bundle size. A page can pass
  every budget here and still feel slow on a phone.
- **Localhost, no network emulation.** Zero RTT and effectively infinite
  bandwidth. The `gzip KB` column exists to reason about 4G; the `ms` column is
  server work, not user-perceived load time.
- **One machine, one run.** Timings are Windows 11 on this developer laptop with
  four other agents active. Absolute milliseconds are not portable; the
  before/after **delta** on the same machine is what carries meaning.
- **`gzip KB` is computed locally at node's default level.** It is an estimate of
  wire cost, not an observation of it.
- **Cold starts are excluded by design.** Everything here is the warm path.
- Adding Lighthouse or a Playwright-driven Web Vitals capture would close the
  first two gaps. Deferred, not done.
