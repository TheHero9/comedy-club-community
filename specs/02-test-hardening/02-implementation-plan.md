# 🛠️ Test Hardening - Implementation Plan

**Read `01-analysis.md` first.** This file decides the tooling and splits the work into
**parallel lanes that never touch the same file**.

---

## 🧰 Tooling decisions (locked - do not substitute)

| Layer | Tool | Why |
|-------|------|-----|
| Frontend E2E | **Playwright** (`@playwright/test`) | Real browser. Only way to catch console errors, computed styles, viewport overflow, sticky positioning, hydration. |
| Frontend unit | **Vitest** | Native ESM + TypeScript, no transform config, fast. |
| Backend | **pytest + pytest-django** | Already wired, 208 tests passing. Extend, do not replace. |
| Contract | **Node script + Vitest assertion** | Regenerate types from live OpenAPI, diff against the committed snapshot. |
| A11y | **`@axe-core/playwright`** | Runs inside the existing Playwright pages, no separate runner. |

❌ **Never** add Jest, Cypress, Selenium, or Enzyme.
❌ **Never** add a component-level React testing library for Server Components - they are
covered by Playwright against a real server. Vitest is for **pure functions and the typed
client only**.

---

## 📁 Target layout

```
apps/web/
├── e2e/                          ← Playwright specs (NEW)
│   ├── fixtures.ts               ← shared fixture: console-error guard, viewports
│   ├── public-browse.spec.ts     ← lane A
│   ├── status-codes.spec.ts      ← lane A
│   ├── ratings-grid.spec.ts      ← lane B
│   ├── search.spec.ts            ← lane B
│   ├── resilience.spec.ts        ← lane E
│   ├── invisible-failures.spec.ts← lane E
│   └── a11y.spec.ts              ← lane E
├── tests/                        ← Vitest unit specs (NEW)
│   ├── api-client.spec.ts        ← lane C
│   ├── score-bands.spec.ts       ← lane C
│   ├── copy.spec.ts              ← lane C
│   └── mock-api.ts               ← lane C, shared HTTP mock
├── playwright.config.ts          ← NEW
└── vitest.config.ts              ← NEW

apps/api/podcast/tests/
├── test_authz_matrix.py          ← lane D (NEW)
├── test_rate_limits.py           ← lane D (NEW)
├── test_privacy.py               ← lane D (NEW)
└── test_scoring_elite.py         ← lane D (NEW)

scripts/
└── check-api-types-drift.mjs     ← lane C (NEW)
```

**Rule: one lane owns each file. Lanes never edit a file another lane owns.** The only
shared files are `apps/web/package.json` and the root `package.json`, which **lane A alone**
is allowed to touch (see sequencing).

---

## 🌊 Sequencing

**Phase 0 must complete before any other lane starts.** Everything after runs in parallel.

```
Phase 0 (lane A, alone)  ── installs deps, writes configs, adds scripts
        │
        ├── Lane A  public browse + status codes
        ├── Lane B  ratings grid + search
        ├── Lane C  unit tests + contract drift
        ├── Lane D  backend gaps
        └── Lane E  invisible failures + resilience + a11y
                    │
Phase 2 (lane A, alone) ── aggregate scripts, update docs/STATUS.md
```

---

## 🚦 Phase 0 - Foundation (must run first, alone)

Owner: **lane A**. No other lane may start until this is committed.

1. `npm install -D -w web @playwright/test @axe-core/playwright vitest`
2. `npx playwright install chromium` (Chromium only - do not install all browsers)
3. Write `apps/web/playwright.config.ts`:
   - `testDir: "./e2e"`
   - Two projects: `desktop` (1280x800) and `mobile` (390x844, `isMobile: true`)
   - `webServer`: run `npm run dev -- --port 3100`, `reuseExistingServer: true`,
     `timeout: 120_000`
   - `baseURL: "http://localhost:3100"`
   - `retries: 1` locally, `2` in CI
4. Write `apps/web/vitest.config.ts` with `environment: "node"` and the `@/*` alias
   resolved to the package root.
5. Write `apps/web/e2e/fixtures.ts` exporting a `test` that **fails any test whose page
   logged an unexpected console error** (see lane E for the allow-list).
6. Add scripts to `apps/web/package.json`:
   ```json
   "test": "npm run test:unit && npm run test:e2e",
   "test:unit": "vitest run",
   "test:e2e": "playwright test",
   "test:e2e:ui": "playwright test --ui"
   ```
7. Add to root `package.json`: `"test": "turbo test"`, and a `test` task in `turbo.json`
   with `"cache": false` and `"dependsOn": ["^build"]`.
8. Commit. Only then fan out.

---

## 🛣️ Lane definitions

Each lane is a **separate agent**. Each is autonomous: it has its own files, its own
acceptance criteria, and never needs to ask a question.

### Lane A - Public browse + status codes
**Owns:** `e2e/public-browse.spec.ts`, `e2e/status-codes.spec.ts`, Phase 0 + Phase 2 files.
**Covers:** matrix sections 1, 2, 6.
Every route renders with real data; correct status codes; `/channels/does-not-exist` and
`/e/BADIDBADID` return **404**; the 404 page renders real content; metadata and OG tags.

### Lane B - Ratings grid + search
**Owns:** `e2e/ratings-grid.spec.ts`, `e2e/search.spec.ts`.
**Covers:** matrix sections 3, 7.
Grid orientation (years as rows), every cell value cross-checked **against the live API
response**, sticky year column under horizontal scroll, band colours, provisional /
members-only / stream markers, Public vs Elite toggle, cell links. Bulgarian search
including misspellings, zero-result state, Cyrillic integrity.

### Lane C - Unit tests + contract drift
**Owns:** `tests/*.spec.ts`, `tests/mock-api.ts`, `scripts/check-api-types-drift.mjs`.
**Covers:** matrix sections 4, 5, 20, 21.
The typed client against a local mock (every status, timeout, abort, parse failure, query
serialization, Cyrillic, all verbs, the bearer-token seam), `score-bands` pure functions,
copy discipline, and a contract test that regenerates types from the live OpenAPI and
fails on drift.

> ⚠️ A previous throwaway version of the client suite reached **54 assertions**. Treat that
> as the floor, not the target. `03-test-matrix.md` section 4 lists the cases.

### Lane D - Backend gaps
**Owns:** `apps/api/podcast/tests/test_authz_matrix.py`, `test_rate_limits.py`,
`test_privacy.py`, `test_scoring_elite.py`.
**Covers:** matrix sections 13-19.
Auth rejection of forged/absent tokens, the role matrix across every write endpoint, rate
limits, elite score recompute on verification, backfill idempotency, and the privacy
invariants (`PersonalTag` never public, screenshots never unsigned, actor never taken from
the request body).

### Lane E - Invisible failures + resilience + a11y
**Owns:** `e2e/invisible-failures.spec.ts`, `e2e/resilience.spec.ts`, `e2e/a11y.spec.ts`.
**Covers:** matrix sections 8-12, and a **named regression test for every bug in
"Invisible failure classes"**.
Console-error guard, computed font family (Cyrillic + no serif fallback), dark theme on
first paint, 390px overflow on every route, API down / degraded / slow via Playwright
route interception, and axe scans.

---

## 🔒 Guardrails for every lane

- ❌ **Never** weaken a test to make it pass. If the app is wrong, **fix the app** and say
  so in the report.
- ❌ **Never** edit `apps/api/` from lanes A, B, C or E.
- ❌ **Never** commit. Report what changed and let the human decide.
- ❌ **Never** `git push`, force-push, or rewrite history.
- ✅ **Always** use `data-testid` sparingly - prefer role/label/text selectors so tests
  double as accessibility checks.
- ✅ **Always** assert **against the live API response**, not hardcoded numbers. Ratings
  change; the invariant is "the grid matches the API".
- ✅ **Always** keep tests independent - no test may depend on another's ordering.
- ✅ If a lane finishes early, it picks up unclaimed rows from `03-test-matrix.md` and
  records the claim in its report.

---

## 🧪 Test data strategy

The database already holds **74 real episodes for `@ivankirkov1`** and seeded ratings.
There is a `seed_demo` management command at
`apps/api/podcast/management/commands/seed_demo.py`.

- **E2E tests run against the live dev stack** and must be **read-only** for public routes.
- Any test that writes must create its own fixture data and clean up, or run inside the
  pytest transaction (backend only).
- ❌ **Never** truncate, flush, or drop the dev database. ❌ Never run `migrate --fake`.
- Tests must **not** assume a specific score value. Derive expectations from the API.

---

## ✅ Phase 2 - Aggregation (lane A, alone, after all lanes land)

1. Verify `npm run test` at the repo root runs unit + e2e + pytest and is green.
2. Record real counts in `docs/STATUS.md` under "Verification evidence" - replace the
   manual claims with suite names and counts.
3. Add a `## 🧪 Testing` section to `CLAUDE.md` with the commands and the
   "never weaken a test" rule.
4. Write `specs/02-test-hardening/05-results.md`: what was found, what was fixed, and any
   matrix row deliberately left uncovered with the reason.
