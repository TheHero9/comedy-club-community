# 📊 STATUS

**Updated:** 2026-08-10
**Overall:** 🟢 **Waves 1-13 built and test-hardened, and the full visual redesign is shipped.** 41 API paths, all ten designed routes live in Bulgarian across two themes, and **746 automated tests** (350 pytest + 137 Vitest + 259 Playwright) that all run from `npm run test`.

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
| 8 | Clerk auth end to end | 🟡 | **Architecture done + pluggable.** Clerk backend written but unverified (no keys). Dev backend unblocks waves 9-13. |
| 9 | Ratings, watch log, favorites | ✅ | |
| 10 | Membership + verification + scores | ✅ | |
| 11 | Community content | ✅ | |
| 12 | Meilisearch | ✅ | Bulgarian typo tolerance verified |
| 13 | People, moderation, leaderboards | ✅ | |
| 14 | **Visual redesign** | ✅ | Whole frontend rebuilt from `Designs/design_handoff_podcast_index/`. All 10 routes, dark + light, Bulgarian copy, transposed mobile ratings grid. See [`specs/07-visual-redesign/`](../specs/07-visual-redesign/01-implementation.md). |

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
| Backend | `cd apps/api && uv run pytest -q` | **350 passed** |
| Frontend unit + contract | `cd apps/web && npx vitest run` | **137 passed** |
| Frontend E2E | `cd apps/web && npx playwright test` | **259 passed** (desktop 1280x800 + mobile 390x844, against a production build) |
| Everything, cold start | `npm run test` | **746 passed** |
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
| 2026-08-09 | ✅ **Repair completed: all 1,036 degraded rows recovered, 0 remaining, re-indexed (1,392 docs).** `availability_corrected` was **0** - the members-only count held at 37, so no episode was wrongly flagged public. The sweep was interrupted at 964 and resumed cleanly for the last 72, proving the resume path. |
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
