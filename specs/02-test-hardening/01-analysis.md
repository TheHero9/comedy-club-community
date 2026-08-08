# 🔍 Test Hardening - Coverage Gap Analysis

**Created:** 2026-08-08
**Status:** 📋 Planned
**Baseline commit:** `e9dc0fe` (initial build, waves 1-13)

> **Read this file first.** It is written to be understood with **zero prior conversation
> context**. Everything an agent needs is here or in the sibling files.

---

## 🎯 Why this spec exists

The initial build shipped with **208 backend tests and zero frontend tests**. Every
frontend verification done during the build was **manual and throwaway** - ad-hoc scripts
in a scratch directory that were deleted, never committed, and cannot be re-run.

That is the actual problem. The app "was verified" but nothing in the repo proves it, so
the next change silently un-verifies it.

Worse: during the build, **three real bugs shipped and were caught only by accident**.
All three passed `typecheck`, `lint` and `build` cleanly. See "Invisible failure classes"
below. A test suite that does not specifically hunt those classes will not catch the next
one.

**Goal of this spec:** every piece of logic in the repo is covered by an automated,
committed, re-runnable test - and the suite specifically targets the failure classes that
static gates cannot see.

---

## 📦 What exists (the inventory to be covered)

### Backend `apps/api` - Django 5 + Django-Ninja

**39 paths / 48 operations** across 7 tags (verified against the live
`/api/openapi.json`; `docs/STATUS.md` counts paths, this counts methods):

| Tag | Ops | Endpoints |
|-----|-----|-----------|
| `me` | 20 | profile get/patch, rating put/delete, favorite put/delete, watch post/list/delete, tags post/list/delete, memberships post/list/delete/screenshot, per-episode state |
| `public` | 10 | channels (list/detail/grid), episodes (list/detail), people (list/detail), topics (list/detail/suggest) |
| `community` | 10 | comments (list/post/patch/delete), moments (list/post/delete), topics (post), episode-topic vote/delete |
| `moderation` | 4 | reports list/post/resolve/delete |
| `search` | 2 | search, suggest |
| `leaderboards` | 1 | leaderboards by kind |
| `system` | 1 | health |

**17 domain models / 27 tables.** Key invariants:
- `Episode.youtube_id` is the external primary key; all ingestion is
  `update_or_create(youtube_id=...)` so re-running a sync is idempotent.
- **One `Rating` model, two derived numbers.** Public score = `Avg(score)` over all
  ratings. Elite score = `Avg(score)` over ratings by users with a **verified**
  `ChannelMembership` for that episode's channel. Verifying a member must change the
  elite score with **no data migration and no duplicate rows**.
- Uniqueness enforced at the DB level (`UniqueConstraint`) on `Rating`, `Favorite`,
  `EpisodeTopic`, `ChannelMembership`, `PersonalTag`, `EpisodeTopicVote`,
  `EpisodeParticipant`.
- Slugs from Bulgarian text use `slugify(..., allow_unicode=True)`.

**Existing backend tests: 184 test functions, 208 collected**

| File | Tests | Covers |
|------|-------|--------|
| `podcast/tests/test_search.py` | 25 | Meilisearch client, documents, index |
| `podcast/tests/test_grid.py` | 24 | Grid service, seasons, bands, provisional |
| `podcast/tests/test_api_community.py` | 23 | Comments, moments, topics, votes |
| `podcast/tests/test_api_search.py` | 21 | Search endpoints |
| `podcast/tests/test_ingestion.py` | 17 | yt-dlp backfill, upsert |
| `podcast/tests/test_api_public.py` | 16 | Public browse endpoints |
| `podcast/tests/test_api_auth.py` | 15 | Auth backend, permissions |
| `podcast/tests/test_api_engagement.py` | 15 | Ratings, watch, favorites |
| `podcast/tests/test_models.py` | 12 | Model constraints |
| `podcast/tests/test_slugs.py` | 6 | Cyrillic slugs |
| `podcast/tests/test_thumbnails.py` | 5 | maxres/hq fallback |
| `config/tests/test_health.py` | 5 | Health endpoint |

### Frontend `apps/web` - Next.js 16 App Router

**Test infrastructure: NONE.** No Playwright, no Vitest, no Jest, no test files.

**7 routes:**

| Route | Rendering | Can 404? |
|-------|-----------|----------|
| `/` | Static, `revalidate = 60` | No |
| `/channels` | Static, `revalidate = 60` | No |
| `/channels/[slug]` | Dynamic | **Yes** (`notFound()`) |
| `/e/[youtubeId]` | Dynamic | **Yes** (`notFound()`) |
| `/episodes` | Dynamic | No |
| `/search` | Dynamic | No |
| `/status` | `force-dynamic` | No |

**15 source files** (excluding `components/ui/` shadcn primitives):

| File | What it does | Test status |
|------|--------------|-------------|
| `lib/api/client.ts` | Typed fetch wrapper, one error shape, auth seam | ❌ none committed |
| `lib/api/podcast.ts` | Endpoint bindings for browse/search | ❌ none |
| `lib/api/health.ts` | Health binding + non-throwing result | ❌ none committed |
| `lib/copy.ts` | All user-facing English strings | ❌ none |
| `lib/score-bands.ts` | Band to colour, score/duration/date formatting | ❌ none |
| `lib/utils.ts` | `cn()` class merge | ❌ none |
| `components/grid/RatingsGrid.tsx` | IMDb-style heatmap, transposes API payload | ❌ none |
| `components/episode/EpisodeCard.tsx` | Card with badges | ❌ none |
| `components/health/ApiHealthCard.tsx` | Health render, 3 states | ❌ none |
| `components/health/HealthRecheckButton.tsx` | Client, TanStack Query + toast | ❌ none |
| `components/shared/SiteHeader.tsx` | Nav | ❌ none |
| `app/providers.tsx` | Query client, theme | ❌ none |
| `app/layout.tsx` | Root shell, dark default, fonts | ❌ none |
| `app/not-found.tsx` | 404 page | ❌ none |
| `app/status/loading.tsx` | Skeleton, deliberately scoped | ❌ none |

### Shared `packages/api-types`

TypeScript types **generated** from the API's OpenAPI schema by `openapi-typescript`.
`src/generated.ts` is a committed snapshot so builds work offline.

**Zero hand-written API types is a hard project rule.** Nothing currently enforces that
the committed snapshot still matches the live API. Drift is silent until something breaks
at runtime.

---

## 🚨 Invisible failure classes (the reason this spec is not optional)

Three bugs shipped during the build. **All three passed `typecheck`, `lint` and `build`.**
Any suite that only runs static gates would have shipped all three again.

### 1. Soft 404 - a root `loading.tsx` swallowed every `notFound()`

A root `app/loading.tsx` wraps every page in a Suspense boundary. Next then flushes the
HTML shell with a **200** before the page resolves, so `notFound()` could no longer set
the status. `/channels/does-not-exist` and `/e/BADID` returned **200 with a blank body**.

On a site whose entire purpose is being indexed, crawlers would have treated every dead
episode link as a real page.

- **Detectable only by asserting the HTTP status code of a deliberately bad URL.**
- Fixed by scoping the skeleton to `app/status/loading.tsx`. Rule recorded in `CLAUDE.md`.

### 2. RSC serialization crash from an `Error` instance in the render tree

Passing an `ApiError` class instance (carrying a `cause` chain of native errors) into a
component broke React's dev-mode RSC debug channel:
`chunk.reason.enqueueModel is not a function`, then a 60-second hang.

- **Only reproducible on the error path**, which no happy-path test touches.
- Fixed by returning a plain serializable `{ kind, status, message }` summary.
- **Rule: never hand an `Error` instance to a React component.**

### 3. Latin-only font subset silently killed Bulgarian

`Geist({ subsets: ["latin"] })` does not include Cyrillic. Every episode title and
community label would have rendered in a system fallback font while the English chrome
used Geist. Nothing errors. It just looks subtly wrong.

A related one: shadcn's init wrote a **circular CSS variable**
(`--font-sans: var(--font-sans)`), so the sans font silently fell back to serif
everywhere.

- **Detectable only by asserting computed styles or by visual regression.**

### 4. Console-only errors that no gate reports

Base UI logs an accessibility error when a `<Button render={<Link/>}>` omits
`nativeButton={false}`. It is a **console error only** - `typecheck`, `lint` and `build`
all pass.

- **Rule: E2E tests must fail on unexpected browser console errors.**

---

## 🕳️ The gap list

Everything below is currently **unproven by any committed test**.

### Frontend - total gap

1. Every route renders (7 routes) with real data
2. Correct HTTP status codes, especially **404 on dead channel/episode**
3. Ratings grid: orientation, cell values match the API, sticky year column, bands,
   provisional/members-only/stream markers, Public vs Elite toggle
4. Typed client: error mapping for every status, timeout, abort, parse failure, query
   serialization, Cyrillic round trip, all verbs, the bearer-token auth seam
5. `lib/score-bands.ts` pure functions: band thresholds, score/duration/date formatting,
   null handling
6. Copy discipline: no user-facing string hardcoded in a component
7. Cyrillic renders correctly (font subset + no mojibake)
8. Mobile 390px: no horizontal page overflow on any route
9. Dark theme applied on first paint with no light flash
10. No unexpected browser console errors on any route
11. Accessibility: landmarks, labels on the grid, focus order, keyboard nav
12. Resilience: API down, API degraded (one dependency down), API slow

### Backend - partial gaps

13. **Auth is architecturally done but unverified** - no Clerk keys. A forged token must be
    rejected; an unauthenticated call to a protected route must 401.
14. Authorization matrix: `member` / `moderator` / `admin` against every write endpoint
15. Rate limiting on every write endpoint
16. Elite score recompute on membership verification, with no duplicate rows
17. Idempotency: re-running backfill changes no row counts
18. Private data must never leak: `PersonalTag` on any public endpoint, verification
    screenshots without a signed URL
19. Actor is always derived from the token, never from a client-supplied `user_id`

### Contract - total gap

20. Committed `packages/api-types/src/generated.ts` still matches the live OpenAPI schema
21. Frontend never hand-writes an API type

---

## ✅ Definition of done for this spec

- `npm run test` at the repo root runs **everything** and is green
- Frontend E2E suite exists, committed, and covers all 7 routes
- Typed client and pure helpers have unit tests
- A contract test fails when the API schema drifts from the committed snapshot
- Every bug class in "Invisible failure classes" has a **named regression test**
- CI-ready: the whole suite runs from a cold start with documented commands
- `docs/STATUS.md` updated with real, re-runnable evidence

Work breakdown is in `02-implementation-plan.md`.
The exhaustive case list is in `03-test-matrix.md`.
**Autonomous execution instructions are in `04-agent-runbook.md`.**
