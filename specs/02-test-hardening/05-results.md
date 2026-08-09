# 🧪 Test Hardening - Results

**Executed:** 2026-08-08
**Baseline:** `5c8270f` on `main` (208 backend tests, **zero** frontend tests)
**Outcome:** ✅ **666 automated tests**, all green from a cold start via `npm run test`

---

## 📊 Final counts

| Suite | Command | Before | After |
|-------|---------|--------|-------|
| Backend | `uv run pytest -q` | 208 | **317** |
| Frontend unit + contract | `npx vitest run` | 0 | **117** (684 assertions) |
| Frontend E2E | `npx playwright test` | 0 | **232** (116 tests x 2 viewports) |
| **Total** | `npm run test` | 208 | **666** |

Static gates stayed green throughout: `npx turbo typecheck lint build` = 4/4,
`ruff check .` clean.

**Cold-start verified.** The dev server was killed and `npm run test` run from
scratch; Playwright's `webServer` booted it, ran all 232 E2E tests, then pytest
ran 317. No manual setup step is required beyond `docker compose up -d` and the
Django server.

---

## ✅ Matrix coverage: 145 of 149 fully, 1 partial, 3 uncovered

| Section | Rows | Lane | Status |
|---------|------|------|--------|
| 1. Route rendering | 11 | A | ✅ 11/11 |
| 2. HTTP status codes | 6 | A | ✅ 6/6 |
| 3. Ratings grid | 17 | B | 🟡 16/17 (3.17 uncovered) |
| 4. Typed client | 43 | C | ✅ 43/43 |
| 5. Pure helpers | 8 | C | ✅ 8/8 |
| 6. Copy discipline | 4 | C | ✅ 4/4 |
| 7. Search | 7 | B | ✅ 7/7 |
| 8. Mobile + layout | 4 | E | ✅ 4/4 |
| 9. Theme + fonts | 5 | E | ✅ 5/5 |
| 10. Console cleanliness | 4 | E | ✅ 4/4 |
| 11. Resilience | 7 | E | 🟡 4/7 + 1 partial |
| 12. Accessibility | 7 | E | ✅ 7/7 |
| 13-19. Backend gaps | 21 | D | ✅ 21/21 |
| 20-21. Contract | 5 | C | ✅ 5/5 |

---

## 🐛 Bugs found and fixed

The campaign paid for itself here. **Five real defects**, none of which
`typecheck`, `lint` or `build` had anything to say about.

### 1. 🔒 Rate limiting did not exist (backend, SECURITY)

`CLAUDE.md` § Security requires "rate-limit every write endpoint". Nothing
implemented it, so all 23 write endpoints were unbounded.

**Fixed** by adding `apps/api/podcast/api/throttling.py` and attaching one
`WriteThrottle` to the whole `NinjaAPI`, so a new write endpoint cannot ship
unthrottled by omission. Keyed on `request.auth`, safe methods exempt, fails
open on a cache outage. No model change, no migration.

Verified over real HTTP, not just in pytest: 60 requests allowed, **first 429 at
request #61**; a second user was unaffected while the first was throttled; reads
answered 200 throughout.

### 2. ♿ Header logo had no accessible name below 640px (frontend, SERIOUS)

`SiteHeader.tsx` rendered `<Mic aria-hidden />` beside a wordmark hidden under
the `sm` breakpoint. On a phone the link was focusable with **nothing to
announce**. axe `link-name` (serious), on **every route**, mobile only - which
is why it went unnoticed: the desktop viewport is clean.

**Fixed** with `aria-label={copy.nav.homeLink}`. This failed 7 tests before the
fix; it is now green.

### 3. 🔍 Home page shipped zero Open Graph tags (frontend, SEO)

`app/layout.tsx` declared `title` and `description` but no `openGraph` block, and
Next does **not** synthesise OG tags from those. `grep -c 'og:'` on `/` returned
**0**. Every share of the site root rendered a bare link preview - on a site
whose entire purpose is discoverability.

**Fixed** by adding `openGraph` + `twitter` blocks. Now 8 tags render, confirmed
in both dev and a production build.

### 4. 📝 Two hardcoded user-facing strings (frontend)

`app/page.tsx` inlined `"1 channel"` / `"N channels"`, and
`app/channels/[slug]/page.tsx` inlined the literal `avg`. Both violate "never
hardcode a user-facing string inside a component", the one habit that keeps a
future BG/EN toggle a one-day job.

**Fixed** via a new `copy.channels.channelCount(n)` and the existing
`copy.grid.seasonAverage(...)`. The ratchet list in `tests/copy.spec.ts` is now
**empty** and must stay that way.

### 5. 🧰 Two defects in the Phase 0 harness itself

Found by Lane C and Lane E reviewing the orchestrator's own work:

- `e2e/fixtures.ts` failed `eslint` - `react-hooks/rules-of-hooks` reads
  Playwright's `use` fixture parameter as a React hook. It would have broken
  `turbo lint`. Fixed by renaming the parameter to `provide` (Playwright passes
  it positionally).
- The global console allow-list bundled `Encountered two children with the same
  key` into the next-themes pattern. That is a **genuine React error in our own
  code**, not library noise, and allow-listing it would have hidden real bugs
  forever. Removed, with a comment saying why.

---

## 🚫 Rows not covered, and why

Every one of these is an honest gap. No vacuous test was written to make the
scoreboard look better.

### 3.17 - empty grid (a channel with no dated episodes)

The database holds exactly one channel and all 74 of its episodes have an
`upload_date`, so no URL produces `seasons.length === 0`. The channel page is a
Server Component, so `page.route()` cannot stub its fetch.

**To close it:** seed a second channel with undated episodes, or cover the
`seasons.length === 0` branch as a Vitest component test.

### 11.1 / 11.2 - API unreachable and API degraded

**This is the most important limitation in the campaign, and the spec was wrong
about it.**

`02-implementation-plan.md` assumed Playwright route interception could simulate
a dead API on `/status`. It cannot. `/status` renders in a **Server Component**,
so `getHealthResult()` runs in Node inside the Next process and its fetch never
crosses the browser. A test that calls `page.route("**/api/health", ...)` and
then asserts on the server-rendered card **passes while intercepting nothing**.

Instead of faking it, Lane E wrote `11.1/11.2 DOCUMENTED LIMIT`, which installs
the route before `goto`, asserts the hit counter is still `0` after `/status`
renders, then clicks Recheck and asserts it moves to `1`. It documents the
boundary and **fails loudly** if `/status` is ever converted to a Client
Component - at which point these rows become writable for real.

The browser-side half of section 11 **is** fully covered: 11.3, 11.4, 11.5 and
11.6 all exercise the Recheck button's real fetch, each with a hit counter so a
vacuous pass is impossible.

### 11.7 - `build` succeeds with the API down (PARTIAL)

A real `next build` cannot run inside the E2E suite: the dev server under test
owns `.next/`. A browser assertion is worthless because `next dev` renders
everything dynamically regardless.

**Covered instead** by a source-level assertion that `app/status/page.tsx` still
exports `dynamic = "force-dynamic"` - the single declaration that makes the row
true. Independently confirmed against a real production build: `/status` is
listed as `ƒ (Dynamic)`, not prerendered.

### Invisible failure class 2 (RSC `Error`-instance crash) - PARTIAL at the E2E layer

Same root cause as 11.1/11.2: the crash only fires on the health **error** path,
which is that same un-interceptable server-side fetch. The E2E test asserts the
observable half (no 60s hang, no `enqueueModel` pageerror). The real guard is
**row 4.43 in Vitest**, which asserts the error summary is a plain object:
`Object.getPrototypeOf(x) === Object.prototype`, not `instanceof Error`, no
`cause`/`stack` keys, and a lossless `JSON.parse(JSON.stringify(x))` round trip.

---

## 🔬 Techniques worth keeping

- **The spec's 9.4 was not testable as written.** Comparing computed
  `font-family` on a Bulgarian title vs an English heading is **identical
  whether or not the Cyrillic subset was requested** - `subsets: ["latin"]`
  changes the `@font-face` `unicode-range`, not the cascade, so the browser
  falls back per glyph and the computed string never changes. Lane E added a
  second test that inspects `document.fonts` and requires a `Geist` face whose
  `unicode-range` covers U+0400-U+045F **and** whose `status === "loaded"`,
  which only happens when the browser actually needed it to paint.
- **Cross-stack threshold test.** `tests/score-bands.spec.ts` parses
  `SCORE_BANDS` out of `apps/api/podcast/services/grid.py` and asserts every
  score 0.0-10.0 maps to the same band on both sides. Editing either alone fails.
- **Compile-time probes.** Row 21.2 compiles 6 fixtures through generated
  tsconfigs in an OS temp dir (never inside the repo, so `npm run typecheck`
  cannot see the deliberately broken code), including a **control that must
  compile cleanly** so a failure means something.
- **Allow-list blind-spot closure.** Chrome logs `Failed to load resource: ...
  404` for the document itself on a deliberate 404, which has to be allowed.
  Lane A pinned the **count** of those messages to the number of deliberate bad
  navigations, so a genuinely broken stylesheet on the 404 page still fails.
- **Mutation testing.** Lanes A and B deliberately broke their own
  regression-critical assertions (flipped 2.1 to expect 200; inverted the grid
  index direction), confirmed real failures, then reverted. That is the only way
  to know an assertion bites rather than passing by symmetry.

---

## ⚠️ Known issues logged, not fixed

| Issue | Severity | Note |
|-------|----------|------|
| Nested `<main>` landmarks | moderate | `app/layout.tsx` wraps children in `<main>`, and `status/page.tsx`, `not-found.tsx`, `status/loading.tsx` each render their own. Trips `landmark-no-duplicate-main`, `landmark-unique`, `landmark-main-is-top-level`. |
| Heading order skips h1 -> h3 | moderate | `EpisodeCard.tsx` uses `<h3>` directly under the page `<h1>` on `/episodes` and `/search`. |
| `<Button render={<Link/>} nativeButton={false}>` announces as `role="button"` | minor | The comment in `not-found.tsx` claims it "keeps link semantics". It does not. Screen-reader users get button semantics on a real navigation. |
| Verification screenshots served unsigned under `DEBUG=True` | ⚠️ latent | Correct for local dev, a real hole if `DEBUG` ever ships true. Signed URLs land with R2. |
| `WriteThrottle` instance is shared across requests | minor | `SimpleRateThrottle` keeps per-request state on `self`. This is django-ninja's own documented pattern, but under a threaded WSGI worker two concurrent writes could interleave. Impact is mis-counting, not a bypass. |
| 404 body ships as RSC flight data, not server HTML | informational | True in production too. Harmless: the **status is a real 404**, so crawlers never index it regardless of body. |
| 2 high-severity npm advisories | pre-existing | `js-yaml` under `openapi-typescript`. Dev-only tooling, never shipped. |

---

## 🧭 What changed in the repo

**New test infrastructure**

```
apps/web/playwright.config.ts        desktop 1280x800 + mobile 390x844, port 3100
apps/web/vitest.config.mts           node env, tests/ only, e2e/ excluded
apps/web/e2e/fixtures.ts             console-error guard (on by default) + apiJson helper
apps/web/e2e/smoke.spec.ts           proves the harness itself works
scripts/check-api-types-drift.mjs    regenerates types and diffs against the snapshot
```

**New tests**

```
apps/web/e2e/         public-browse, status-codes, ratings-grid, search,
                      invisible-failures, resilience, a11y
apps/web/tests/       api-client, score-bands, copy, contract, mock-api
apps/api/podcast/tests/  test_authz_matrix, test_rate_limits, test_privacy,
                         test_scoring_elite
```

**App fixes**

```
apps/api/podcast/api/throttling.py        NEW - write rate limiting
apps/api/config/api.py                    attach the throttle
apps/api/config/settings/base.py          API_WRITE_RATE_LIMIT
apps/web/components/shared/SiteHeader.tsx aria-label on the logo link
apps/web/app/layout.tsx                   openGraph + twitter metadata
apps/web/app/page.tsx                     copy.channels.channelCount
apps/web/app/channels/[slug]/page.tsx     copy.grid.seasonAverage
apps/web/lib/copy.ts                      channelCount + nav.homeLink
```
