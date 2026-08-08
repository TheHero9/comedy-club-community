# 🤖 Test Hardening - Autonomous Agent Runbook

**This file is the entry point.** It assumes **zero conversation history**. Read it top to
bottom and execute. Do not ask questions - every decision you need has already been made.

---

## 🚀 TL;DR for the orchestrating agent

```
1. Read this file, then 01-analysis.md, 02-implementation-plan.md, 03-test-matrix.md
2. Bring up the environment (section "Environment bring-up") and CONFIRM it is green
3. Run Phase 0 yourself, alone, and verify it (section "Phase 0")
4. Spawn 5 parallel agents, one per lane (section "Spawning the lanes")
5. As each reports, verify its claims by RUNNING the tests yourself
6. Run Phase 2 (aggregation) yourself
7. Report. Do not commit unless the human says so.
```

**Golden rule: never trust a lane's report. Re-run the suite yourself before believing it.**

---

## 📚 Context you need (the conversation is gone)

- **Repo:** `C:\Users\dimib\Desktop\comedy-club-community`, monorepo, npm workspaces + Turborepo.
- **Baseline commit:** `e9dc0fe` on `main`. Everything below builds on it.
- **Stack:** Django 5 + Django-Ninja (`apps/api`), Next.js 16 App Router + Tailwind v4 +
  shadcn/ui (`apps/web`), types generated from OpenAPI (`packages/api-types`).
- **The app:** a searchable community hub for Bulgarian YouTube podcast channels. Content
  is Bulgarian, UI chrome is English.
- **Current state:** 208 backend tests pass. **Frontend has zero tests.** That is the gap
  this spec closes.

### Hard project rules (from `CLAUDE.md`, non-negotiable)

- 🚫 **No em-dash (U+2014) or en-dash (U+2013)** anywhere - code, comments, docs, UI copy.
  Use a plain hyphen.
- 🚫 **No emoji in rendered UI code** (JSX). Use `lucide-react`. Emoji in markdown docs and
  chat is fine.
- 🚫 **Never hand-write a TypeScript API type.** Generate into `packages/api-types`.
- 🚫 **shadcn/ui only.** Never MUI, Ant Design, Chakra, Mantine.
- 🚫 **Never hand-write a Django migration.** Use `makemigrations`.
- 🚫 **Never commit or push** unless the human explicitly says so.
- 🚫 **Never** run `DROP`, `TRUNCATE`, `flush`, or `migrate --fake`.
- ✅ **Never hardcode a user-facing string in a component.** It goes in `apps/web/lib/copy.ts`.
- ✅ Server Components for anything public and indexable; Client Components only for
  interactivity.

### Framework gotchas that already cost real time

- **shadcn's `base-nova` style is built on Base UI, not Radix.** Compose with
  `render={<Link/>}`, **not** `asChild`. When the rendered element is an anchor you must
  also pass `nativeButton={false}`, or Base UI logs an accessibility error that
  `typecheck`, `lint` and `build` all ignore.
- **Never put `loading.tsx` at the app root.** It converts every `notFound()` into a soft
  404 (status 200, blank body). Scope skeletons to routes that cannot 404.
- **Never pass an `Error` instance into a React component.** React's dev RSC debug channel
  cannot serialize a `cause` chain; it crashes and hangs the request. Convert to a plain
  `{ kind, status, message }` object.

---

## 🪟 Windows environment gotchas (this machine)

| Gotcha | What to do |
|--------|-----------|
| Postgres runs on **54320**, not 5432 | Two native Postgres services own 5432/5433. Connections to 5432 silently reach the wrong server. Never "fix" an auth error by changing the password. |
| Console cannot print Cyrillic | Prefix commands that print content: `PYTHONIOENCODING=utf-8 uv run python manage.py ...` |
| **`curl` from Git Bash destroys Cyrillic** | Never assert on Bulgarian text through a Git Bash `curl` pipeline. Use Node (`fetch`) or Playwright to read the response. |
| **Next 16 refuses a second `next dev` for the same directory** | If one is running, reuse it. Playwright's `reuseExistingServer: true` handles this. To kill: find the PID and stop it. |
| Port **3000 is occupied** by an unrelated app | Use **3100** for Playwright. Verify with `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100`. |
| Bash tool resets cwd between calls | Always use absolute paths. |

---

## 🏗️ Environment bring-up (do this first, verify each step)

```bash
# 1. Infra - Postgres, Redis, Meilisearch
cd /c/Users/dimib/Desktop/comedy-club-community
docker compose up -d
docker compose ps            # all must be Up / healthy

# 2. API on :8000  (leave running)
cd apps/api
uv run python manage.py migrate
uv run python manage.py runserver

# 3. Verify the API is actually answering
curl -s http://localhost:8000/api/health
# EXPECT: {"status": "ok", "database": {"ok": true, ...}, "redis": {"ok": true, ...}}

# 4. Web deps
cd /c/Users/dimib/Desktop/comedy-club-community
npm install

# 5. Static gates must be green BEFORE writing any test
npx turbo typecheck lint build     # expect 4/4 successful
cd apps/api && uv run pytest -q    # expect 208 passed
```

🚨 **If any step fails, fix it before writing tests.** A red baseline makes every later
result meaningless.

### Known-good fixtures in the dev database

| Thing | Value |
|-------|-------|
| Channel slug | `ivan-kirkov` (handle `@ivankirkov1`) |
| Episodes | 74 total, 58 rated |
| Grid shape | 3 seasons (2024, 2025, 2026), 37 rows |
| A real episode id | `utcF7etPyyk` |
| Bulgarian queries that hit | `Каспаров`, `евровизия` |
| Misspelled queries that must still hit | `Каспарв`, `еврвизия` |
| Query that must return zero | `zzznothingzzz` |
| Seeder | `apps/api/podcast/management/commands/seed_demo.py` |

⚠️ **Do not hardcode score values.** Ratings change. Assert the UI matches
`GET /api/channels/ivan-kirkov/grid`, not a number you copied.

---

## 1️⃣ Phase 0 - Foundation (orchestrator does this ALONE)

No lane may start until this is done and verified. Full steps in
`02-implementation-plan.md` under "Phase 0". Summary:

```bash
cd /c/Users/dimib/Desktop/comedy-club-community
npm install -D -w web @playwright/test @axe-core/playwright vitest
cd apps/web && npx playwright install chromium
```

Then write `playwright.config.ts`, `vitest.config.ts`, `e2e/fixtures.ts`, and the
`test` / `test:unit` / `test:e2e` scripts.

**Verify Phase 0 before fanning out:**

```bash
cd /c/Users/dimib/Desktop/comedy-club-community/apps/web
npx playwright test --list     # must list the config without error
npx vitest run --reporter=dot  # must run (0 tests is fine at this point)
```

### The console-error fixture (write this carefully - lane E depends on it)

`e2e/fixtures.ts` exports a `test` that collects `console` events of type `error` plus
page errors, and **fails the test at teardown** if any are unexpected.

Allow-list, as narrow as possible, each entry justified by a comment:

```
"Encountered a script tag while rendering React component"  // next-themes inline theme script, library-owned, dev-only
"Download the React DevTools"                               // informational
```

Everything else is a failure.

---

## 2️⃣ Spawning the lanes (5 parallel agents)

Spawn **all five in a single message** so they run concurrently. Each lane owns disjoint
files, so they cannot conflict.

| Lane | Owns | Matrix sections |
|------|------|-----------------|
| **A** | `e2e/public-browse.spec.ts`, `e2e/status-codes.spec.ts` | 1, 2 |
| **B** | `e2e/ratings-grid.spec.ts`, `e2e/search.spec.ts` | 3, 7 |
| **C** | `tests/*.spec.ts`, `tests/mock-api.ts`, `scripts/check-api-types-drift.mjs` | 4, 5, 6, 20, 21 |
| **D** | `apps/api/podcast/tests/test_authz_matrix.py`, `test_rate_limits.py`, `test_privacy.py`, `test_scoring_elite.py` | 13-19 |
| **E** | `e2e/invisible-failures.spec.ts`, `e2e/resilience.spec.ts`, `e2e/a11y.spec.ts` | 8, 9, 10, 11, 12 |

### Prompt template for each lane

Give every lane agent this preamble verbatim, then its own lane row:

```
You are Lane <X> of an autonomous test-hardening campaign.

READ FIRST, in this order:
  specs/02-test-hardening/04-agent-runbook.md   (environment, gotchas, project rules)
  specs/02-test-hardening/01-analysis.md        (what exists and why this matters)
  specs/02-test-hardening/02-implementation-plan.md (tooling, your lane definition)
  specs/02-test-hardening/03-test-matrix.md     (your exact rows)

YOUR SCOPE: matrix sections <N>. You own ONLY these files: <files>.
NEVER edit a file owned by another lane. NEVER edit apps/api unless you are Lane D.

The environment is already up: API on :8000, Playwright configured, deps installed.
Phase 0 is DONE - do not redo it.

RULES:
- Never weaken a test to make it pass. If the app is wrong, FIX THE APP and say so.
- Never commit, never push, never run a destructive DB command.
- Assert against the live API response, not hardcoded numbers.
- Tests must be independent and re-runnable.
- Obey every rule in the runbook's "Hard project rules" section.

VERIFY BEFORE REPORTING DONE - actually run these:
  cd apps/web && npx playwright test e2e/<your-spec>.ts     (or npx vitest run, or uv run pytest <file>)
  Report the real pass/fail counts. If something fails, say so explicitly.

REPORT BACK: files created, matrix rows now covered, any app bug found and how you fixed
it, and any row you could not cover with the reason.
```

---

## 3️⃣ Verifying lane reports (orchestrator, mandatory)

A lane saying "19 passed" is a claim, not evidence. For each returned lane:

```bash
cd /c/Users/dimib/Desktop/comedy-club-community/apps/web
npx playwright test            # full e2e suite
npx vitest run                 # full unit suite
cd ../api && uv run pytest -q  # full backend suite
```

Then:
1. **Read the test bodies the lane wrote.** Look for tests that assert nothing, tests
   wrapped in `try/catch` that swallow failures, `test.skip`, `expect(true).toBe(true)`,
   or assertions loosened to match broken behaviour.
2. **Confirm each claimed matrix row is genuinely covered**, not just named.
3. If a lane says it fixed an app bug, **read the diff** and confirm the fix is real.
4. Tick rows in the `03-test-matrix.md` scoreboard yourself.

🚨 **A lane that weakened a test to get green has made things worse than no test.** Send it
back via `SendMessage` with the specific problem.

---

## 4️⃣ Phase 2 - Aggregation (orchestrator, alone, at the end)

1. Root `npm run test` runs unit + e2e + pytest, and is green.
2. Cold-start check: stop the dev server, run the whole suite from scratch, confirm
   Playwright's `webServer` boots it.
3. Update `docs/STATUS.md` "Verification evidence" with **real suite names and counts**,
   replacing manual claims.
4. Add a `## 🧪 Testing` section to `CLAUDE.md` with the commands and the "never weaken a
   test" rule.
5. Write `specs/02-test-hardening/05-results.md`: rows covered, bugs found and fixed, rows
   deliberately skipped with reasons, and the final counts.
6. Update `specs/00-index.md` status for this folder.

---

## ✅ Definition of done

- [ ] `npm run test` from the repo root is green from a cold start
- [ ] All 149 matrix rows either covered or explicitly waived with a written reason
- [ ] Every "Invisible failure class" from `01-analysis.md` has a named regression test
- [ ] Playwright runs at both 1280x800 and 390x844
- [ ] No test was weakened to achieve green
- [ ] `docs/STATUS.md`, `CLAUDE.md` and `05-results.md` updated
- [ ] Nothing committed unless the human asked

---

## 🧯 If you get stuck

| Symptom | Fix |
|---------|-----|
| `next dev` says another server is running | Reuse it, or stop that PID. Do not start a second one for the same directory. |
| Playwright cannot reach the app | Check port 3100, not 3000. Port 3000 is taken by an unrelated app. |
| API returns connection refused | The Django server is not running. Restart it, see "Environment bring-up". |
| Cyrillic looks like `????` in terminal output | That is the Windows console or Git Bash `curl`, not the data. Read the value in Node or Playwright instead. |
| A test is flaky on first load | The dev server compiles on demand. Wait for `networkidle` or use Playwright's auto-waiting locators, not fixed sleeps. |
| `typecheck` fails on a route type you did not touch | Stale `.next/types`. Run `npm run build` once to regenerate, then re-run. |
| Two lanes edited the same file | Stop, resolve manually, and re-read the lane ownership table. |
