# 📊 STATUS

**Updated:** 2026-08-08
**Overall:** 🟢 **Waves 1-13 built.** 39 API endpoints, 208 backend tests, and a live Next.js frontend with the IMDb-style ratings grid.

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

Legend: ⬜ not started · 🔵 in progress · 🟡 partial/blocked · ✅ done

---

## ✅ Verification evidence

Everything below was **run**, not assumed.

| Check | Result |
|-------|--------|
| `pytest` | **208 passed** |
| `ruff check .` | All checks passed |
| `makemigrations --check` | No drift |
| Fresh-DB `migrate` | Clean, 27 tables |
| API endpoints registered | **39** |
| Celery tasks registered | **9**, 3 beat schedules |
| Celery worker (Docker) | Live, executed real tasks through Redis |
| Score sweep via broker | `{'episodes': 74}` |
| Reindex via broker | `74 indexed, 15 stale removed, 1.36s` |
| Backfill idempotency | 2nd run: 0 created, 74 updated |
| `npx turbo typecheck lint build` | **4/4 successful** |
| Frontend pages rendering | 7/7 return 200 with expected content |
| Ratings grid | **71 cells**, 3 year rows x 37 episode columns, **0 mismatches vs API** |
| Grid sticky year column | Holds at the container edge across 2263px of horizontal scroll |
| HTTP status codes | 6 real routes 200, 3 dead routes **404** (no soft 404s) |
| API client suite | **54 runtime assertions + 5 compile-time rejections** |
| Type pipeline reproducibility | Regenerated from live OpenAPI: **byte-identical** |
| Hand-written API types in `apps/web` | **zero** (grepped) |
| Degraded path (Redis stopped) | API `status: degraded`, `/status` renders Down; full recovery + Celery reconnect |
| 390px viewport | Zero horizontal overflow |

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
| Remaining 5-7 channel URLs | Full backfill | 🟢 Low |
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
