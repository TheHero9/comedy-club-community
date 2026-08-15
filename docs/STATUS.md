# 📊 STATUS

**Updated:** 2026-08-15
**Overall:** 🚀 **LIVE IN PRODUCTION at https://comedycommunity.club** (2026-08-15). Web on Vercel, API + Celery + Postgres + Redis + Meilisearch on Railway, Clerk production auth, 7 channels / 1,962 episodes / 579 transcripts served. Launch smoke test 13/13. Full topology and the six deployment gotchas: [`specs/10-deployment/`](../specs/10-deployment/01-production-setup.md).

> ⚠️ Still deferred before the membership-verification flow is used by real users:
> R2 + signed URLs for verification screenshots (`NEXT_TIME.md` § Security).

> 🆕 **2026-08-11 hardening sweep:** 7 real bugs found and fixed, including the
> root cause of the "unexplained flaky E2E" recorded below on 2026-08-10 - it was
> **Postgres connection exhaustion**, disguised as a data mismatch by Next's
> stale fetch cache. Full write-up: [`specs/09-edge-case-hardening/`](../specs/09-edge-case-hardening/01-findings.md).

> Wave definitions live in [`specs/01-initial-build/01-waves.md`](../specs/01-initial-build/01-waves.md).

---

## Wave board

| # | Wave | Status | Notes |
|---|------|--------|-------|
| 1 | Monorepo + infra skeleton | ✅ | Postgres/Redis/Meili healthy |
| 2 | Django API foundation | ✅ | Ninja + OpenAPI + health |
| 3 | Domain models + admin | ✅ | 17 models, 27 tables |
| 4 | Ingestion: yt-dlp backfill | ✅ | 74 episodes, 0 errors |
| 5 | Celery + scheduled sync | 🟡 | Worker + beat + 9 tasks LIVE. Data API path awaits `YOUTUBE_API_KEY`; yt-dlp fallback active. |
| 6 | Next.js foundation + typed client | ✅ | Next 16 App Router + Tailwind v4 + shadcn/ui + `@ccc/api-types` generated from OpenAPI. `typecheck`/`lint`/`build` green, home page renders live `/api/health`. |
| 7 | Public browse (SEO) | ✅ | Home, channels, channel + **ratings grid**, episode detail, browse, search. All Server Components. |
| 8 | Clerk auth end to end | ✅ | **Complete 2026-08-15.** Clerk production instance on comedycommunity.club; frontend via pluggable ViewerAuthProvider (keyless builds keep the dev identity, so the suite runs unchanged). |
| 9 | Ratings, watch log, favorites | ✅ | |
| 10 | Membership + verification + scores | ✅ | |
| 11 | Community content | ✅ | |
| 12 | Meilisearch | ✅ | Bulgarian typo tolerance verified |
| 13 | People, moderation, leaderboards | ✅ | |
| 14 | **Visual redesign** | ✅ | Whole frontend rebuilt from `Designs/design_handoff_podcast_index/`. All 10 routes, dark + light, Bulgarian copy, transposed mobile ratings grid. See [`specs/07-visual-redesign/`](../specs/07-visual-redesign/01-implementation.md). |
| 15 | **Post-launch UX pass** | ✅ | **2026-08-15.** The owner's first full walkthrough of the live site, turned into 31 tracked items and all 31 built - including EN/BG i18n with **English as the new default**, a curated channel order, a title-first search split with working pagination, and the Clerk identity bug that showed a raw `user_...` id as both name and handle. See [`specs/11-ux-feedback/`](../specs/11-ux-feedback/01-backlog.md). |

Legend: ⬜ not started · 🔵 in progress · 🟡 partial/blocked · ✅ done

---

## ✅ Verification evidence

**Every claim below is a committed, re-runnable test.** Run them all with
`npm run test` from the repo root.

Before 2026-08-08 this section listed manual, throwaway checks. They were real
checks, but nothing in the repo could repeat them, so the next change silently
un-verified the app. `specs/02-test-hardening/` replaced them with automated
suites; the counts here come from actual runs.

### Automated suites

| Suite | Command | Result |
|-------|---------|--------|
| Backend | `cd apps/api && uv run pytest -q` | **423 passed** |
| Frontend unit + contract | `cd apps/web && npx vitest run` | **166 passed** (19 of them the perf budgets, which skip if no server is up) |
| Frontend E2E | `cd apps/web && npx playwright test` | **369 passed** (desktop 1280x800 + mobile 390x844, against a production build) |
| Everything, cold start | `npm run test` | **958 passed** |
| Performance | `npm run benchmark` | See `specs/05-performance/` |
| Static gates | `npx turbo typecheck lint build` | **4/4 successful** |
| Python lint | `cd apps/api && uv run ruff check .` | All checks passed |

### What the suites actually pin down

| Area | Guarded by |
|------|-----------|
| 7 routes render with live data | `e2e/public-browse.spec.ts` |
| Dead channel + episode URLs return a **hard 404** | `e2e/status-codes.spec.ts`, incl. a structural guard that no `app/loading.tsx` exists |
| Ratings grid matches the API cell for cell | `e2e/ratings-grid.spec.ts` - walks every cell, pins identity by `href` + `aria-label` |
| Bulgarian search, incl. typo tolerance and mojibake | `e2e/search.spec.ts` |
| Typed client: every status, timeout, abort, parse, verb, Cyrillic round trip | `tests/api-client.spec.ts` |
| Score bands agree with `podcast/services/grid.py` | `tests/score-bands.spec.ts` - parses the Python thresholds |
| No hardcoded UI strings, no em-dash, no emoji in JSX | `tests/copy.spec.ts` (exact-match ratchet, currently empty) |
| Committed `generated.ts` matches live OpenAPI | `tests/contract.spec.ts` + `scripts/check-api-types-drift.mjs` |
| Dark theme on first paint; **all three** families loaded with Cyrillic coverage | `e2e/invisible-failures.spec.ts` |
| Both ratings-grid orientations match the API cell for cell | `e2e/ratings-grid.spec.ts` 3.1-3.4 |
| The mobile transpose keeps its promises: no page scroll, no grid scroll, 44px cells | `e2e/ratings-grid.spec.ts` 3.10 |
| Every episode of a channel is a crawlable link on its grid page | `e2e/public-browse.spec.ts` 1.4c |
| No unexpected browser console errors on any route | `e2e/fixtures.ts` console guard, on by default |
| No horizontal page overflow at 390px | `e2e/invisible-failures.spec.ts` |
| Recheck-button toasts: healthy / degraded / unreachable / slow | `e2e/resilience.spec.ts` |
| axe: zero critical or serious violations, 7 routes x 2 viewports | `e2e/a11y.spec.ts` |
| Hostile query strings, NUL bytes, SQLi, traversal, emoji, 3 KB values on every route | `e2e/edge-cases.spec.ts` (55 cases x 2 viewports) |
| A NUL byte is a 400 everywhere, incl. a sweep over every parameterless GET | `podcast/tests/test_null_bytes.py` |
| A query that tokenizes to nothing returns 0 hits, not the catalogue | `podcast/tests/test_search_unsearchable_queries.py` |
| `CONN_MAX_AGE` stays 0 in dev and 600 in prod | `podcast/tests/test_db_connection_policy.py` |
| `seed_demo` is idempotent and `--clear` is its exact inverse | `podcast/tests/test_seed_demo.py` |
| The web `limit` clamp equals the API's `MAX_LIMIT` (parsed from the Python) | `tests/filter-model.spec.ts` |
| The four `/me/*` lists render; an unknown list is a hard 404 | `e2e/edge-cases.spec.ts` |
| Auth rejection, role matrix, rate limits, privacy, elite scoring | `podcast/tests/test_authz_matrix.py`, `test_rate_limits.py`, `test_privacy.py`, `test_scoring_elite.py` |

### Still verified manually (infrastructure, not app logic)

| Check | Result |
|-------|--------|
| `makemigrations --check` | No drift |
| Fresh-DB `migrate` | Clean, 27 tables |
| API endpoints registered | **39 paths / 48 operations** |
| Celery tasks registered | **9**, 3 beat schedules |
| Celery worker (Docker) | Live, executed real tasks through Redis |
| Reindex via broker | `74 indexed, 15 stale removed, 1.36s` |
| Degraded path (Redis stopped) | API `status: degraded`, `/status` renders Down; full recovery + Celery reconnect |

### 🎯 The product thesis, proven end to end

A community-contributed label makes an episode findable by words that appear **nowhere** in its title or description:

| Query | Total | Found target |
|-------|-------|--------------|
| `Смешни истории` (topic label) | 3 | ✅ |
| `смешни истори` (misspelled) | 3 | ✅ |
| `счупения хладилник` (moment label) | 1 | ✅ |
| `счупениа хладилнк` (misspelled) | 1 | ✅ |

This is exactly what the brief said should stand in for transcription. Demo data was removed afterwards; the DB is back to 74 episodes, 0 topics, 0 moments, 0 comments, 0 ratings.

### Search relevance (74 real episodes)

| Query | Backend | Hits | Top result |
|-------|---------|------|-----------|
| `Каспаров` | meilisearch | 1 | Историята на Каспаров... |
| `Каспарв` (dropped letter) | meilisearch | 1 | same ✅ |
| `евровизия` | meilisearch | 3 | Евровизия е постоянен скандал... |
| `еврвизия` (misspelled) | meilisearch | 3 | same ✅ |
| `zzznothing` | meilisearch | 0 | - |

---

## 🐛 Problems hit and fixed

### 1. 🚨 Postgres port collision (wave 1)

Two **native** PostgreSQL Windows services (16 and 18) already owned 5432/5433. Docker reported healthy, but host connections silently reached the *native* server: `password authentication failed`. Moved container Postgres to **54320**.

### 2. 🇧🇬 Cyrillic slugs would have collapsed (wave 3)

The canonical `models.py` used Django's default `slugify`, which strips non-ASCII and returns `""`. All 74 Bulgarian titles would have had empty slugs and collided on the unique constraint. Fixed with `bg_slugify(allow_unicode=True)`.

### 3. 🚨 Route collisions produced 404s and 405s (waves 7/11)

**Two instances of one root cause:** a path may only be owned by ONE router, and routes match in declaration order.

- `/topics/{slug}` was declared before `/topics/suggest`, so suggest resolved as `slug="suggest"` → **404**.
- `GET /episodes/{id}/comments` lived in `public.py` while `POST` lived in `community.py`. Django matched the first router, which only knew GET → **405** on every comment and moment POST.

Fixed by consolidating each path into one router, with `auth=None` per-operation on public reads. Both pinned by regression tests.

### 4. 🚨 `curl` from Git Bash silently destroys Cyrillic (wave 12)

**The most deceptive bug of the session.** Git Bash mangles non-ASCII argv before native `curl.exe` sees it, so `q=Каспаров` arrived as `q=????????`. `?` is a Meilisearch separator, so the query tokenized to nothing, became an empty search, and returned **every document**. It looked exactly like a catastrophic search-relevance failure. ASCII queries worked fine, which made it look Cyrillic-specific and therefore like an application bug. It was the shell. Documented in `CLAUDE.md`.

### 5. Meilisearch response keys are snake_case

My API wrapper read `estimatedTotalHits` (raw Meili camelCase) instead of the module's `estimated_total_hits`, silently falling back to `len(hits)` and reporting the **page size as the total**.

### 6. An empty search index answered every query with zero

A reachable-but-empty index looks identical to "nothing matches". Now, if Meilisearch returns 0 hits, the API confirms against Postgres before believing it, logs a warning naming `manage.py reindex`, and serves the Postgres results.

### 7. 🚨 A root `loading.tsx` turned every 404 into a soft 200

The Suspense boundary let Next flush the HTML shell with a 200 before pages resolved, so every `notFound()` became **200 + a blank page**. `/channels/does-not-exist` and `/e/BADID` both looked "fine" while being invisible failures. For a content site built to be indexed, crawlers would have treated every dead link as a real page. Fixed by scoping the skeleton to `app/status/`. Rule recorded in `CLAUDE.md`.

### 8. 🇧🇬 Fonts were latin-only, so every Bulgarian title would fall back

`Geist({ subsets: ["latin"] })` does not include Cyrillic. Every episode title and community label would have silently rendered in a system fallback font while the English chrome used Geist. Fixed to `["latin", "cyrillic"]`.

### 9. Eager Celery could have stalled every rating write

Dev runs `CELERY_TASK_ALWAYS_EAGER=True`, so a queued reindex runs **inline**. With `retry_backoff` and `max_retries=5`, a Meilisearch outage would have added ~30s to each rating write. Added `SEARCH_INDEXING_ENABLED`, off in tests, so the suite never needs a running search engine.

---

## 🏗️ What exists

```
apps/web/                              ← Next.js 16, all Server Components
├── app/
│   ├── page.tsx                       home: leaderboard + latest + channels
│   ├── channels/                      list + [slug] with the RATINGS GRID
│   ├── e/[youtubeId]/                 episode detail, OG tags, moments, comments
│   ├── episodes/                      browse: filters, sorts, pagination
│   ├── search/                        GET-form search, shareable URLs
│   └── status/                        API health
├── components/  grid/RatingsGrid · episode/EpisodeCard · shared/SiteHeader
└── lib/         api/client · api/podcast · score-bands · copy
packages/api-types/                    ← GENERATED from OpenAPI, never hand-written

apps/api/                              ← Django + Ninja, 39 endpoints
├── config/
│   ├── settings/  base | dev | prod | env
│   ├── api.py     ← single NinjaAPI, all routers registered here
│   ├── celery.py  ← 3 beat schedules
│   └── Dockerfile
├── podcast/
│   ├── models.py            17 models
│   ├── admin.py             full moderation backend
│   ├── slugs.py             🇧🇬 bg_slugify
│   ├── auth/                pluggable: dev | clerk + permissions
│   ├── api/                 public · me · community · moderation · search
│   ├── services/            ingestion · scoring · topics · indexing
│   ├── search/              client · documents · index  (Meilisearch)
│   ├── ingestion/           yt_dlp_backfill · thumbnails
│   ├── tasks.py             9 Celery tasks
│   ├── management/commands/ backfill_channel · reindex
│   └── tests/               208 tests
docs/    brief · canonical-models · schema-decisions · auth-decisions · STATUS
specs/   00-index · 01-initial-build/01-waves
tools/   youtube-metadata research probe
```

### API surface (38 endpoints)

| Group | Endpoints |
|-------|-----------|
| Public browse | channels, episodes (filter/sort/paginate), topics, people |
| Search | `/search` (Meili + Postgres fallback), `/search/suggest` |
| Leaderboards | top_rated, top_elite, most_rated, most_watched, most_commented |
| Me | profile, ratings, watch log, favorites, private tags, memberships |
| Community | comments, topics + votes, moments |
| Moderation | reports queue, resolve |

---

## ⚙️ Running it

```bash
docker compose up -d                       # postgres + redis + meilisearch
cd apps/api && uv run python manage.py runserver
```

| URL | What |
|-----|------|
| http://localhost:8000/admin/ | Moderation backend (create your own: `manage.py createsuperuser`) |
| http://localhost:8000/api/docs | All 38 endpoints, interactive |
| http://localhost:8000/api/health | Dependency check |

**Frontend:**
```bash
cd apps/web && npm run dev      # ⚠️ falls forward to :3001, port 3000 is taken
```

| URL | What |
|-----|------|
| http://localhost:3001/ | Home |
| http://localhost:3001/channels/ivan-kirkov | 🎬 **The ratings grid** |
| http://localhost:3001/search?q=Каспаров | Search |

**Demo data:** `manage.py seed_demo` adds 267 ratings, 190 topic labels, 119 moments, 120 comments across 7 Bulgarian demo users (4 verified, so elite scores differ from public). `--clear` removes it.

**Celery** (optional, dev runs tasks eagerly):
```bash
docker compose --profile workers up -d     # worker + beat
docker compose --profile workers down      # stop them
```

**Ports:** Postgres **54320**, Redis 6379, Meilisearch 7700, API 8000.

**Dev auth:** `Authorization: Bearer dev:<username>` provisions and authenticates that user. Local only - `prod.py` refuses to boot with it.

---

## 🔑 Awaiting from owner

| Item | Blocks | Severity |
|------|--------|----------|
| Clerk keys | Real auth (arch is done, one env var to swap) | 🟡 Medium |
| `YOUTUBE_API_KEY` | Data API sync (yt-dlp fallback works) | 🟢 Low |
| Remaining 4-6 channel URLs | Full backfill | 🟢 Low |
| R2 credentials | Screenshot storage (local disk works) | 🟢 Low |

---

## 📋 Decisions log

| Date | Decision |
|------|----------|
| 2026-08-08 | `models.py` is a suggestion, not a contract. Log deviations in `docs/02-schema-decisions.md`. |
| 2026-08-08 | 9 schema deviations implemented and logged. |
| 2026-08-08 | Shorts are **never** ingested. |
| 2026-08-08 | UI copy is **English** for now. |
| 2026-08-08 | Thumbnails are **never** uploaded or mirrored. |
| 2026-08-08 | Local Docker now, managed later via one env var each. No vendor-specific features. |
| 2026-08-08 | Episode slug unique **per channel**, not globally. |
| 2026-08-08 | Container Postgres on **54320**. |
| 2026-08-08 | **Auth is pluggable** (`dev` / `clerk`) so waves 9-13 were not blocked on keys. `prod.py` raises if the dev backend is selected. See `docs/03-auth-decisions.md`. |
| 2026-08-08 | Postgres is the search fallback behind the same `/search` endpoint; the response names the backend that answered. |
| 2026-08-08 | Moderators **hide** comments; authors **delete** them. Preserves the report trail. |
| 2026-08-08 | Leaderboards require ≥3 ratings so one enthusiastic vote cannot top the board. |
| 2026-08-08 | Indexing always goes through Celery via `services/indexing.py`. Never inline in a request. |
| 2026-08-08 | 🎬 **Ratings grid: one calendar year = one season.** (Orientation was later flipped - see the YEARS-as-rows entry below.) |
| 2026-08-08 | Score **bands** are computed by the API (`services/grid.py`) and returned as semantic keys; the component maps key to colour. Web and mobile can never disagree on what "Great" means. |
| 2026-08-08 | Cells with fewer than 3 ratings render but are flagged `is_provisional`, so one enthusiastic 10 cannot fake a masterpiece. |
| 2026-08-08 | Filters and search are plain links / a GET form, so every view is a shareable, indexable URL. |
| 2026-08-08 | 🎬 **Grid orientation: YEARS as rows, episodes as columns** (owner decision). Deviates from the IMDb reference image on purpose: 3 short rows beat a 37-row tower on a phone, and the year label + its average stay sticky while episodes scroll sideways. |
| 2026-08-08 | Never place `loading.tsx` at the app root - it converts every `notFound()` into a soft 404. |
| 2026-08-08 | `app/not-found.tsx` exists so a dead link renders a real 404 page instead of a bare header. |
| 2026-08-08 | shadcn's `base-nova` style is built on **Base UI**, not Radix: compose with `render={<Link/>}`, not `asChild`, and pass `nativeButton={false}` when the rendered element is an anchor. |
| 2026-08-09 | 📥 **`@comedyclubpodcast` backfilled: 1,318 episodes** (979 videos + 339 streams, 27 shorts excluded). Corpus is now 1,392 across 2 channels. |
| 2026-08-09 | 🚨 **A big backfill gets soft-blocked and yt-dlp does not error** - it returns reduced metadata, so the run reported "0 errors" while 1,036 rows lost `duration`/`availability`. **`0 errors` is not a completeness check; `duration_sec IS NULL` is.** |
| 2026-08-09 | 🔧 Added `manage.py repair_metadata` - serial, delayed re-fetch that **only writes from a full response**, so running it while blocked is a no-op rather than data loss. Run it after every backfill over ~100 episodes. |
| 2026-08-09 | ~~✅ **Repair completed: all 1,036 degraded rows recovered, 0 remaining.** `availability_corrected` was **0**...~~ 🚨 **THIS ENTRY WAS WRONG - see 2026-08-10.** It was written from the command's intent, not from a count taken afterwards. |
| 2026-08-09 | 📈 Corpus estimate revised: one channel alone is 1,318 episodes, so plan for **5,000-10,000+**, not the brief's ~1,000. |
| 2026-08-09 | 🎨 **Channel avatars/banners/subscriber counts populated and rendered.** Unlike thumbnails these URLs are **stored, not derived** - the avatar is an opaque hash nothing predicts - but still never mirrored to R2. `manage.py refresh_channel_meta` refreshes them in one cheap request per channel. See `specs/04-channel-ingestion/02-channel-avatars.md`. |
| 2026-08-09 | 🗂️ **A `-column` index is `DESC NULLS FIRST`; every list endpoint sorts `DESC NULLS LAST`.** Postgres cannot use one for the other, so the `Episode` sort indexes were dead and every browse query was a seq scan + sort. Seven expression indexes now mirror the real `ORDER BY`, tiebreak included. See `docs/02-schema-decisions.md` § 10. |
| 2026-08-09 | ⚡ `episode_list_queryset()` uses `.only(BRIEF_FIELDS)`. Reading any other field off a list row is one lazy SELECT **per row** - add the field to `BRIEF_FIELDS`, never drop the `only()`. |
| 2026-08-09 | 🐛 The Postgres search fallback was N+1 (102 queries for a 50-hit page). Calling `.select_related()` on a related manager builds a **new** queryset and bypasses the prefetch cache - use `.all()`. Guarded by `podcast/tests/test_query_counts.py`. |
| 2026-08-09 | 📝 **Transcripts stored, with zero ASR spend.** YouTube publishes a Bulgarian `bg-orig` ASR track for part of the catalogue; yt-dlp fetches it free. New `Transcript` + `TranscriptSegment` models, `manage.py backfill_transcripts`, and a **second** Meilisearch index. Verified on 3 real episodes: 523 segments, 86,870 words, Bulgarian search returning deep links in 4 ms. See `specs/06-transcripts/02-architecture.md`. |
| 2026-08-09 | 🚨 **Transcript text must NEVER enter the `episodes` index.** 26,000 words next to a 60-character title makes every episode match every common Bulgarian word and lets a passing mention outrank an episode actually about the subject. Two indexes: `episodes` = "ABOUT this", `transcript_segments` = "SAID here". |
| 2026-08-09 | 🚨 **A throttled response is indistinguishable from "no captions"** - the same soft-block strips both `duration` and the caption list. `fetch_transcript` refuses to answer "none" without a duration and writes nothing, because a false "none" would be permanent. |
| 2026-08-09 | 🐛 **`minWordSizeForTypos` counts BYTES, not characters.** Cyrillic is 2 bytes/char, so the episodes index's `{4, 8}` actually meant **2 and 4 characters**: `пица` returned 100 hits of which **95 were false** (`пича`, `пичове`). Thresholds are now `N * BYTES_PER_CYRILLIC_CHAR`. The old test asserted `oneTypo <= 4` and passed the whole time - it encoded the misunderstanding, not the behaviour. |
| 2026-08-09 | ⚠️ **Transcript coverage is partial and date-dependent** (2024-2026: 9/9; 2019-2022: 0/12; members-only: 0/5). Transcript search is never exhaustive - an absent episode may simply have no captions, and the UI needs to say so. |
| 2026-08-10 | 🌱 **`seed_demo` reworked and run across both channels** - 8,081 ratings, 2,935 topic links, 1,748 watch events on all 1,392 real episodes. Fully reversible with `--clear`; every row hangs off a `demo_`-prefixed user. It previously seeded memberships on only the FIRST channel, so the 1,318-episode channel had no elite score at all. |
| 2026-08-10 | 🚨 **The 2026-08-09 "metadata complete" entry above was HALF false.** `@comedyclubpodcast` still had **1,076 of 1,318 rows with `duration_sec IS NULL`**, so "0 remaining" was wrong - the claim had been recorded from the command's intent instead of from a count. The re-run recovered all 1,076 with **0 availability corrections**, so the `availability_corrected: 0` half of that entry was right and no episode had been mis-served as public. **A backfill closes on `Episode.objects.filter(duration_sec__isnull=True).count() == 0`, nothing else.** |
| 2026-08-10 | ⚠️ **A "9 episodes reclassified" claim made during that investigation was itself wrong** - it came from comparing a corpus-wide `members_only` count (46 = 9 + 37 across both channels) against a per-channel figure (37). Read the `availability_corrected` number `repair_metadata` prints; do not reconstruct it from a filter with a different scope. |
| 2026-08-10 | 🔍 **The demo seeder is a data-completeness probe.** This was caught because it produced 365 `Moment` rows where ~1,700 were expected - moments need a `duration_sec`, so a quarter-sized output was the tell. Nobody was looking for a metadata bug. |
| 2026-08-10 | ⚡ **`scoring.recompute_many`** - set-based recompute (two aggregates + one `bulk_update`) so a bulk load does not queue one Celery reindex task per episode. `scoring.py` now has TWO writers of the denormalized columns, and `test_scoring_bulk.py` compares them **against each other**, never against hardcoded numbers, so neither can drift alone. |
| 2026-08-10 | ~~⚠️ **One unexplained flaky E2E** (`3.8` grid public/elite toggle)... `/channels/[slug]` is `revalidate = 60`, so a test can compare a minute-old ISR render against a fresh API fetch - that is where to look if it recurs.~~ ✅ **EXPLAINED 2026-08-11 - see below.** The instinct about the cache was right; the reason the cache was stale was not staleness. |
| 2026-08-11 | 🚨 **The flake was Postgres connection exhaustion.** `conn_max_age=600` is correct for production but wrong under `runserver`, which spawns an unbounded thread per request and holds one connection per thread. **8 concurrent requests produced 14 failures of 32**, 65 connections stayed idle after the load, and E2E failures accumulated across runs (1 -> 4 -> 10). `CONN_MAX_AGE = 0` in `dev.py`: 48 concurrent -> 192/192 OK. |
| 2026-08-11 | 🔍 **Why it read as a data mismatch rather than an outage: Next serves the STALE fetch-cache entry when a revalidation request fails.** The API 500 never reached the browser, so the page rendered plausible-but-outdated scores. When a test says the page and the API disagree, check whether the API was erroring. |
| 2026-08-11 | 🔒 **A NUL byte 500ed ten endpoints.** Legal in a URL and in JSON, passes every Pydantic constraint, fails inside psycopg. Fixed once in `podcast/middleware.RejectNullBytesMiddleware` so a new endpoint cannot ship vulnerable by omission. SQLi and path traversal were already handled correctly. |
| 2026-08-11 | 🚨 **`/search?q=???` returned all 1,393 episodes as matches.** Non-empty after `strip()`, so it reached Meilisearch, which read it as a placeholder search. `has_searchable_text()` now guards both search endpoints. |
| 2026-08-11 | 🚨 **The ELEVENTH click on "Зареди още" served a 500.** The web clamp was 200 against the API's `MAX_LIMIT = 100`, and load-more grows `limit` by 9 per click. `tests/filter-model.spec.ts` now parses the Python constant so the two cannot drift. ⚠️ `/episodes` still cannot page past 100 - left as an explicit pagination decision, not silently changed. |
| 2026-08-11 | 🐛 **`seed_demo --seed` was never reproducible.** Unordered queries plus six `random.*` calls made *inside* existence checks, so a second run wrote a whole new generation of rows (201 -> 342 ratings) while printing a normal summary. Every draw now happens before the check. |
| 2026-08-11 | 🚨 **`--clear` would have stranded every `Report`.** `SET_NULL` reporter + `GenericForeignKey` target means no cascade reaches it, and the queue renders orphans happily because `_report_out` never dereferences the target. |
| 2026-08-11 | ⚡ **Big channel page 2076.3 KB -> 1724.1 KB.** Every cell carried `aria-label` and `title` set to the same string; the RSC flight payload (56% of the page) then serialized it again. `GridInteraction` already renders a real hover preview, so the native tooltip was firing *alongside* it. **Ceiling NOT raised** - demo seeding alone ate three quarters of the ratchet's headroom, so the structural fix is now due. |
| 2026-08-10 | ⚡ **The redesign's dense grid paid for itself: `/channels/<big>` went 2271.2 KB -> 1355.2 KB and 464 ms -> 65 ms, WHILE that channel went from 0 to 1,043 rated cells.** The grid API held at 322.3 KB (up just 2.3 KB for 1,043 newly-populated cells), which says the remaining bulk is empty holes, not data. Both waiver ratchets re-measured and tightened; the page ceiling drops 2400 KB -> 1800 KB. |
| 2026-08-10 | ✅ **Metadata repair genuinely closed: 1,066 rows repaired, `duration_sec IS NULL` is now 0 across all 1,392 episodes, 0 availability corrections, 0 errors.** Re-indexed. This time the closing evidence is the count, not the command. |
| 2026-08-13 | 🎯 **Third channel ingested: `@comedyclubsport7786` (Comedy Club Sport, 47 videos, no streams/shorts tabs).** First run of the `/extract-channel` skill end-to-end, now including the transcript step. Metadata complete in one pass (0 degraded, all counts verified), avatar + 1,880 subs stored, indexed by the worker. ~~Corpus is now 1,439 episodes across 3 channels.~~ ⚠️ **Corrected same day: 1,440.** The daily sync had added one `@ivankirkov1` episode on 2026-08-11; the 1,439 figure was computed from the stale 74, not counted. See `specs/04-channel-ingestion/03-comedyclubsport-run.md`. |
| 2026-08-13 | ⏳ **Its transcripts are PENDING, not failed: the caption probe hit the soft-block 10/10** (likely warmed by the metadata backfill minutes earlier - a caption fetch is a second request per episode). `TranscriptThrottled` wrote nothing, so no false "unavailable" rows exist; all 47 remain `never checked`. Re-run `backfill_transcripts --channel @comedyclubsport7786` after a few hours; closes when `never checked` = 0. |
| 2026-08-13 | 🎯 **Four more channels ingested in one batch - corpus now 1,961 episodes across 7 channels, all in Meilisearch:** `@КомедиКлубКлюкиПодкаст` (139), `@ComedyClubNews` (245), `@BFFPepiQ` (80), `@delo404podcast` (57, +17 shorts excluded). Avatars/banners/subs stored for all. **Knowingly run during an active soft-block** (verified first: a re-fetch of an episode ingested clean 20 min earlier returned `duration: None`), so **509 of 521 rows are degraded and `repair_metadata` is owed per channel** - titles/dates/ids/thumbnails are complete, durations and true availability are not. Transcripts deliberately skipped for the whole batch (owner directive; one rerun session later covers repair + transcripts for all five new channels). See `specs/04-channel-ingestion/04-four-channel-batch.md`. |
| 2026-08-13 | 🐛 **A percent-encoded Cyrillic channel URL was rejected by ingestion.** Browsers copy `youtube.com/@КомедиКлуб...` as `youtube.com/@%D0%9A...`, and `%` defeats every `CHANNEL_PATTERNS` regex (`\w` matches Cyrillic fine - the encoding was the blocker, and Git Bash argv-mangles the decoded form, so the encoded URL is the ONLY shell-safe way to pass one). `normalize_channel_target` and the standalone `fetch_video.py` now `unquote` first; covered by `test_cyrillic_channel_handles_normalize`. |
| 2026-08-13 | 🚨 **`@comedyclubpodcast` lost 1,171 durations AGAIN - the daily sync undid the 08-10 repair.** Chain of three: (1) `docker compose up` started Beat, which fired the overdue `sync-channels-daily` immediately; (2) no `YOUTUBE_API_KEY`, so the sync fell back to yt-dlp and re-scraped all 1,318 videos, tripping the soft-block partway (this block then hit everything else that evening); (3) the worker container ran a **stale image built 2026-08-08**, one day before `upsert_episode`'s downgrade protection existed, so throttled responses overwrote good rows. The current code would have kept every row - the protection was in the repo but not in the container. |
| 2026-08-13 | 🔧 **Fixes shipped for all three links:** keyless fallback sync is now capped at `YOUTUBE_SYNC_FALLBACK_LIMIT` (25) newest per tab - a daily sync picks up new uploads, it never walks a back catalogue (`test_tasks_sync.py`); worker+beat images rebuilt from current code; the bake-code-into-image gotcha documented in CLAUDE.md. Data recovery (now 1,680 degraded total: 509 batch + 1,171 sync) waits on the block lifting - `repair_metadata --probe 10` still returns 0/10. |
| 2026-08-13 | 📋 **Owner directive: once metadata is verified complete, ALL demo/mockup community data gets deleted** (`seed_demo --clear`, the seeder's exact inverse - episodes untouched). Only real extracted YouTube data remains. Sequenced as the close-out checklist in CLAUDE.md § Channels. |
| 2026-08-13 | 🎯 **The YouTube Data API path is BUILT (the deferred wave-5 piece), and it repaired everything the same evening.** `ingestion/youtube_api.py` (stdlib-only client), `repair_metadata --api` (50 rows per quota unit, immune to the yt-dlp soft-block), and `sync_channel_via_api` - the daily sync now uses the Data API whenever `YOUTUBE_API_KEY` is set, via the derived `UULF`/`UULV` playlists so Shorts stay structurally excluded. Key wired through root `.env` -> docker-compose -> worker/beat; images rebuilt. |
| 2026-08-13 | ✅ **All 1,680 degraded rows repaired in ONE Data API pass** (~34 quota units): 1,680 repaired, 0 still degraded, 0 errors. Then a full-corpus verification sweep of ALL 1,961 rows: 0 missing durations/dates/titles/thumbnails, 1,961/1,961 returned by the API, 0 duration mismatches (>2s). **Metadata is complete and verified for every channel.** |
| 2026-08-13 | 🔍 **Measured API blind spot: `videos.list` RETURNS members-only videos but nothing in the response says they are members-only.** So the API repair/sync never write `availability` - only yt-dlp states it. `upsert_episode` grew absent-means-unknown guards (availability, thumbnail) so the nightly API sync can never flip a stored members-only row to public. Availability flags currently match all known members-only counts (55 total: 37+9+8+1); the members-only rows were exactly the rows that returned FULL during the block, so no mislabeling is expected. |
| 2026-08-13 | 🐛 **`repair_episode` wrote availability corrections via `.update()`, bypassing `save()` where `members_only` is denormalized** - a corrected row would have kept a stale badge/filter flag. Fixed: the update now sets `members_only` in lockstep. Latent until now (all prior runs had 0 availability corrections). |
| 2026-08-13 | 🧹 **Demo data cleared per the owner directive: 14 demo users, 12,997 ratings, 3,471 watch events, 3,465 comments, 877 moments, 5,684 topic links - all deleted via `seed_demo --clear`.** 1,961 real episodes untouched, scores recomputed (all now unrated - correct), both Meilisearch indexes rebuilt (episodes: 1,961; transcript_segments: 523 real caption segments). **The database now contains ONLY extracted YouTube data.** Still owed when the yt-dlp block lifts: transcripts for the 5 new channels + an optional yt-dlp availability sweep. |
| 2026-08-14 | 📝 **Full-catalogue transcript sweep complete: 578 of 1,961 episodes (29.5%) have transcripts - 61,448 segments, Postgres == Meilisearch exactly.** 1,381 episodes recorded as caption-less (data, not absence - they are never re-fetched until `TRANSCRIPT_RECHECK_DAYS`). The soft-block lifted ~22:00 and the whole sweep ran overnight via the /loop. Coverage is drastically channel-dependent: BFF 99%, Kirkov 88%, Дело 404 86%, CCP 28%, News 6%, Клюки 1%, Sport 0% - transcript search must never be presented as exhaustive. **2 episodes pending** on a caption-endpoint HTTP 429 (`MoMnxWU9zq8`, `dfrZOLgSlTM`); they remain in the pending queryset and any later `backfill_transcripts` run collects them. |
| 2026-08-14 | 🔒 **Availability CONFIRMED corpus-wide: full yt-dlp re-backfill of all 5 new channels returned 0 degraded and exactly the inferred distribution (55 members-only: 37 CCP + 9 Kirkov + 8 Дело + 1 Клюки).** No degraded-era row was ever mislabeled public. Bonus: the full responses yielded 89 chapters on Клюки that the throttled run had lost. The 2026-08-13 close-out checklist is now fully executed except the 2 pending transcripts above. |
| 2026-08-14 | ⚠️ **The transcript run's tail found two more throttle shapes:** a caption download can hang indefinitely (the batch runner stalled 18 min on one fetch - killed and finished the stragglers individually with `timeout 120`), and the caption endpoint rate-limits separately with an explicit HTTP 429 after ~570 downloads in one evening. Both are per-request; neither poisons data (`TranscriptThrottled` writes nothing). |
| 2026-08-14 | 🧪 **Full deep-test sweep on the real dataset: 369 E2E + 186 unit + 443 backend, ALL green on the prod build; budgets exit 0.** Two E2E tests met an all-unrated catalogue for the first time and encoded stale premises (an English "Not rated" literal in a never-run branch; an elite≠public assertion that is a property of the data) - both fixed honestly, no assertions weakened. See `specs/05-performance/04-real-data-deep-test.md`. |
| 2026-08-14 | 🔍 **Two high-effort code reviews: 11 backend bugs + 6 web bugs found, all fixed and verified.** Backend headline: a transient network failure during a caption download recorded a PERMANENT false "no captions" (and under `--force` deleted a stored transcript); first-login could 500 on a request race or an over-length Clerk display name; Meilisearch writes could self-create an index with nothing filterable. 🚨 **The backend review also shipped its own deadlock** - its `ensure_index_once` guard held a non-reentrant lock that `ensure_index` re-acquired, freezing the first index write of any process; it surfaced as a hung test suite (26 min) and was traced to `test_index_episode_sends_the_document`. **A subagent's fixes are not verified until you run them yourself.** |
| 2026-08-14 | 🐛 **The web review turned on THE SAME NIGHT'S payload fix and found it lossy.** The title recovery stripped marker words from titles that merely ended in them ("На живо от клуба - Стрийм" lost its last word), and double-stripped real streams. Now exact: suffixes are popped in reverse append order, at most once each, gated on the cell's own flags (`data-flags`, omitted on the ~97% of cells that are neither members-only nor stream, +13.2 KB). Also caught: `positionLabel` rendering "епизод NaN", a NaN `data-count` disabling the strip, an ARIA-reflection read that would blank the preview title on Firefox <119 / Safari <16.4 (**Playwright is Chromium-only and structurally cannot catch that**), and a vacuous branch I had written in test 3.8 that re-asserted an already-passed line. |
| 2026-08-14 | ⚡ **The big channel page had regressed OVER its 1,800 KB waiver (1,826.9 KB) and the ratchet caught it: every grid cell shipped `data-title` (135.5 KB duplicating aria-label) + a localized `data-position` sentence (49.2 KB), each serialized again in the RSC flight.** The preview now derives both client-side (`titleFromCellLabel` round-trip-tested). **1,826.9 → 1,506.6 KB (-17.5%)**, every channel page shrank, waiver ratcheted 1800 → 1600. `web:channels` recalibrated 120 → 240 KB - the old ceiling predates the sparkline redesign and the 7-channel roster. |
| 2026-08-14 | ⚡ **Then two more passes took the big channel page to 916.2 KB - under 1 MB, and 50% down from where the day started (1,826.9).** (a) Every cell data attribute is now omitted when it carries its default (`data-provisional=""` alone was 24.5 KB; an unrated episode is 71% of the catalogue) - the reader already defaulted to exactly those values, so absence and default mean the same thing. (b) The dense cell's 105-character className was IDENTICAL on all 1,318 anchors, so size, radius, the unrated treatment and all seven band colours moved into `globals.css` descendant rules keyed on `data-band`, referencing the same tokens so bands stay declared once. **Proven visually identical by diffing `getComputedStyle` on a cell, its td and a hole in BOTH colour schemes** - not eyeballed. Ceiling ratcheted 1800 → 1000 across the day. 🚨 **Not one byte came from showing less** - every pass removed a repeat, and each was charged twice because the RSC flight serializes the tree again. The remaining 170 KB of `aria-label` is genuine content and the only copy of the title, so the next lever is structural (holes stop being elements, or season pagination) at 1.5x the real 600 KB budget. |
| 2026-08-15 | 🚨 **The search bar never searched transcripts. 61,452 indexed caption segments were unreachable from the UI.** `/api/search/transcripts` had been built and indexed on 08-09, but `apps/web` contained **zero** references to it - `/search` only ever called `/api/search` (titles, descriptions, community labels). With community labelling barely started, that made the site's central promise mostly inoperative: **`баница` - a query printed as an example on the search page itself - rendered "Нищо не съвпада" while 173 passages said the word out loud across 33 episodes.** Found while looking for a specific discussion the owner remembered and could not locate. |
| 2026-08-15 | 🎯 **`/search` now answers both questions, on one wait.** `Promise.all` fires `/api/search` and `/api/search/transcripts` together (the transcript half `.catch`es to null, because a throw inside a Server Component is a 500 page, not a degraded search). Episodes matching both collapse onto ONE card; episodes matching only in speech get their own region below, each passage rendered as a **timestamp badge that deep-links to that second of the video**. Coverage is ~30% and channel-dependent, so the partial-coverage caveat renders whenever spoken results do - never presented as exhaustive. |
| 2026-08-15 | ⚡ **`/api/search/suggest` moved from `ILIKE '%q%'` to Meilisearch.** It fired a sequential scan per keystroke, ordered by upload date rather than relevance, with no typo tolerance - on the one surface where the user is still mid-word, on a site whose whole premise is typo-tolerant Bulgarian search. `девствна` suggested nothing; it now returns the right three. 🚨 **Meilisearch supplies the ORDER only - titles are re-read from Postgres**, the same rule `_meilisearch_search` follows: the index is eventually consistent, and suggesting a renamed episode's old title sends the user to a zero-result page. Caught by an existing test that started returning a live-index title against a fixture DB. Postgres remains the fallback. |
| 2026-08-15 | 🚨 **The perf budget passed while the route regressed 101 → 208 KB, because the benchmark only ever sampled `Каспаров` - a query matching ONE episode.** A budget is worth what its worst sampled case is worth. Added `web:search-broad` (`ергена`, which fills the page) so the full page is measured from now on. Trimmed what was trimmable - caption crop 30 → 20 words, one passage on a label card vs two on a spoken-only card, 6 transcript-only cards - which took it 208 → 158.5 KB. The rest is **card COUNT**: a result card costs ~5 KB of HTML plus the RSC flight tree that duplicates it, so 26 cards cannot fit a ceiling set for 20. `web:search-broad` is budgeted at 180 KB with that reasoning written down; past it, /search needs pagination, not a bigger number. |
| 2026-08-15 | 🧪 **Two false-confidence traps hit while verifying this, both self-inflicted.** (1) A "payload optimisation" that sliced passages before passing them as props changed the response by **zero bytes** - `SearchResultCard` is a Server Component, so its props never cross the wire, only its output does. Reverted rather than left in behind a wrong rationale. (2) A new ordering test passed against deliberately broken code: it asserted an order Postgres would have returned anyway. Rewritten to demand the REVERSE of the natural `id__in` order, then re-run against the mutation to confirm it fails. **Byte-identical measurements after a change mean the change did nothing - check that before believing it.** |
