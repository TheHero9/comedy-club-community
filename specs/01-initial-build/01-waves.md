# 🌊 Initial Build - Wave Plan

**Status:** 🟢 Waves 1-4 and 6-13 complete. 5 and 8 partial, both awaiting owner API keys only. Updated 2026-08-08.
**Created:** 2026-08-08
**Owner ruling:** work runs autonomously wave by wave. Each wave is self-contained, ends in something verifiable, and updates `docs/STATUS.md` on completion.

---

## 🎯 How waves work

A **wave** is a chunk of work that can be completed end to end without stopping to ask anything. Each one has:

- 🎯 **Goal** - one sentence
- 📦 **Deliverables** - what files/systems exist afterward
- ✅ **Done when** - a concrete, checkable condition
- 🔗 **Needs** - which waves must land first
- 🔑 **Blocked by** - external things only the owner can supply

**The loop for every wave:**

1. Build it
2. Verify against "Done when" (run it, do not assume)
3. Update `docs/STATUS.md` - wave status, what runs, what surprised us
4. Log any schema change in `docs/02-schema-decisions.md`
5. Move to the next unblocked wave

**Never** start a wave whose "Needs" are not green. **Never** mark a wave done without running the verification.

---

## 📊 Wave map

| # | Wave | Phase | Needs | Blocked by | Status |
|---|------|-------|-------|-----------|--------|
| 1 | Monorepo + infra skeleton | 0 | - | - | ✅ |
| 2 | Django API foundation | 0 | 1 | - | ✅ |
| 3 | Domain models + admin | 1 | 2 | - | ✅ |
| 4 | Ingestion: yt-dlp backfill | 1 | 3 | - | ✅ |
| 5 | Celery + scheduled sync | 1 | 4 | 🔑 YouTube API key | 🟡 |
| 6 | Next.js foundation + typed client | 0 | 2 | - | ✅ |
| 7 | Public browse (SEO) | 2 | 3, 6 | - | ✅ |
| 8 | Clerk auth end to end | 0 | 2, 6 | 🔑 Clerk keys | 🟡 |
| 9 | Ratings, watch log, favorites | 2 | 7, 8 | - | ✅ |
| 10 | Membership + verification + scores | 3 | 9 | - | ✅ |
| 11 | Community content | 4 | 9 | - | ✅ |
| 12 | Meilisearch | 4 | 11 | - | ✅ |
| 13 | People, moderation, leaderboards | 5 | 10, 11 | - | ✅ |

**Waves 1-7 are the "initial build"** and need nothing from the owner. Waves 5 and 8 are the only externally blocked ones, and neither blocks the critical path: everything up to a fully browsable public site can ship without a single API key.

Legend: ⬜ not started · 🔵 in progress · 🟡 partial/blocked · ✅ done

---

## 🌊 Wave 1 - Monorepo + infra skeleton

🎯 **Goal:** `docker compose up` gives us Postgres, Redis and Meilisearch, inside a Turborepo that knows about both apps.

📦 **Deliverables**
- `package.json` (npm workspaces), `turbo.json`
- `docker-compose.yml`: `postgres:16`, `redis:7`, `meilisearch:v1.x`, named volumes, health checks
- `apps/web/` and `apps/api/` placeholders wired into the workspace
- `.env.example` for both apps, `.gitignore` covering `.env*`, `__pycache__`, `.venv`, `node_modules`, `media/`
- `README.md` with the 3-command local start

✅ **Done when:** `docker compose up -d` reports all three healthy, and `psql`, `redis-cli ping` and `curl localhost:7700/health` all respond.

🔗 **Needs:** nothing

---

## 🌊 Wave 2 - Django API foundation

🎯 **Goal:** a running Django-Ninja API with an OpenAPI schema, talking to the Docker Postgres.

📦 **Deliverables**
- `apps/api/pyproject.toml` (uv), Python 3.12
- `config/settings/` split `base.py` / `dev.py` / `prod.py`, reading `DATABASE_URL` via `dj-database-url`
- `config/urls.py` mounting the Ninja `api` at `/api/`
- `podcast/` app registered, `django.contrib.contenttypes` enabled (needed for `Report`)
- `GET /api/health` returning DB + Redis reachability
- CORS configured for `localhost:3000`
- `Dockerfile` for the API
- pytest + `pytest-django` wired, one passing smoke test

✅ **Done when:** `uv run python manage.py runserver` starts clean, `/api/health` returns 200 with both dependencies up, `/api/docs` renders the OpenAPI UI, and `uv run pytest` passes.

🔗 **Needs:** Wave 1

---

## 🌊 Wave 3 - Domain models + admin

🎯 **Goal:** the full schema exists in Postgres and every model is manageable in Django Admin.

📦 **Deliverables**
- `podcast/models.py` from `docs/01-canonical-models.py` **plus the 5 approved deviations** (see `docs/02-schema-decisions.md`)
- `slugify(..., allow_unicode=True)` everywhere a slug comes from Bulgarian text 🇧🇬
- Generated migrations (via `makemigrations`, never hand-written)
- `podcast/admin.py`: list displays, search fields, filters, `raw_id_fields` on the hot FKs, read-only computed columns
- Factories/fixtures for tests

✅ **Done when:** `migrate` runs clean on an **empty** database, `createsuperuser` works, every model is visible and editable at `/admin/`, and a Bulgarian-titled `Episode` produces a non-empty slug.

🔗 **Needs:** Wave 2

⚠️ **Watch:** `Episode.slug` is not unique in the canonical file while `Channel.slug` is. Decide and log it. Composite `(channel, slug)` uniqueness is the likely answer.

---

## 🌊 Wave 4 - Ingestion: yt-dlp backfill

🎯 **Goal:** `@ivankirkov1`'s 74 episodes are in Postgres and browsable in the admin.

📦 **Deliverables**
- `podcast/ingestion/yt_dlp_backfill.py` - promoted from `tools/youtube-metadata/fetch_video.py`, keeping its proven behaviour:
  - `ignore_no_formats_error: True` so members-only episodes resolve 🔓
  - tabs `("videos", "streams")` only, **never shorts** 🚫
  - `ThreadPoolExecutor(max_workers=8)`
  - per-video failure is logged and skipped, never fatal
- `podcast/services/ingestion.py` - `upsert_episode()` via `update_or_create(youtube_id=...)`
- `thumbnails.py` - `HEAD` on `maxresdefault`, fall back to `hqdefault`, **no upload, no mirroring**
- `chapters.py` - opportunistic only, must tolerate zero chapters
- `manage.py backfill_channel <handle|url>` with `--limit` and `--dry-run`

✅ **Done when:** `backfill_channel @ivankirkov1` inserts **74 episodes, 0 errors**, 9 flagged `members_only`, 2 flagged `content_kind="stream"`, and every episode has a working thumbnail URL. **Running it twice changes no row counts** (idempotency).

🔗 **Needs:** Wave 3

---

## 🌊 Wave 5 - Celery + scheduled sync

🎯 **Goal:** new episodes appear on their own, without yt-dlp.

📦 **Deliverables**
- `config/celery.py`, worker + beat services in `docker-compose.yml`
- `podcast/ingestion/youtube_api_sync.py` - Data API v3, quota-aware, batched 50 ids per `videos.list`
- `podcast/tasks.py` - thin wrappers over `services/`
- Beat schedule: daily channel sync, periodic score recompute sweep
- `Channel.last_synced_at` updated per run; per-run summary logged

✅ **Done when:** the worker picks up a manually queued sync, a new upload appears in Postgres without yt-dlp, and quota use per run is logged.

🔗 **Needs:** Wave 4
🔑 **Blocked by:** `YOUTUBE_API_KEY`. Until it arrives, build the task plumbing and score sweep, and let the sync task fall back to yt-dlp behind a feature flag.

---

## 🌊 Wave 6 - Next.js foundation + typed client

🎯 **Goal:** a Next.js app that can call the API with generated types.

📦 **Deliverables**
- `apps/web` - Next.js App Router, TypeScript strict, Tailwind, shadcn/ui init, `lucide-react`
- `packages/api-types` - **generated** from the API's OpenAPI schema, plus an `npm run generate:types` script
- `lib/api/client.ts` - typed fetch wrapper, base URL from `NEXT_PUBLIC_API_URL`, one error shape
- TanStack Query provider, `sonner` toaster, dark theme tokens
- `lib/copy.ts` - all user-facing English strings in one place (i18n insurance) 🇬🇧

✅ **Done when:** `npm run dev` serves a page that fetches `/api/health` through the typed client and renders the result. `npm run typecheck` and `npm run lint` pass. Hand-written API types: zero.

🔗 **Needs:** Wave 2

---

## 🌊 Wave 7 - Public browse (SEO)

🎯 **Goal:** anyone, logged out, can browse every episode. This is the first real milestone.

📦 **Deliverables**
- API: `GET /api/channels`, `/api/channels/{slug}`, `/api/episodes` (paginated, filterable, sortable), `/api/episodes/{id}`
- Pages, all **Server Components**:
  - `/` - latest across all channels
  - `/channels` and `/channels/[slug]`
  - `/e/[youtube_id]/[slug]` - episode detail
- Episode card: thumbnail, title, channel, date, duration, members-only badge, stream badge (all `lucide-react`, no emoji) 🎨
- `generateMetadata` per page, Open Graph using the YouTube thumbnail, `sitemap.ts`, `robots.ts`
- Mobile-first layout, verified at 390px 📱
- Loading skeletons and empty states

✅ **Done when:** all 74 episodes are browsable logged out, episode pages return correct OG tags in view-source, list queries show **no N+1** (`select_related("channel")`), and it looks right on a 390px viewport.

🔗 **Needs:** Waves 3, 6

---

## 🌊 Wave 8 - Clerk auth end to end

🎯 **Goal:** a signed-in identity reaches Django and maps to a `UserProfile`.

📦 **Deliverables**
- `@clerk/nextjs` middleware, sign-in/sign-up routes, session token attached by the API client
- `podcast/auth/clerk.py` - JWKS verification with a cached key set, `ClerkAuth` Ninja auth class
- `get_or_create(clerk_user_id=sub)` lazy provisioning + `UserProfile`
- Clerk webhook endpoint (signature-verified) for profile updates and deletion
- `GET /api/me`, role checks (`member` / `moderator` / `admin`)

✅ **Done when:** signing in on the web produces a Django `User` + `UserProfile`, `/api/me` returns it, an unauthenticated call to a protected route returns 401, and a **forged** token is rejected. 🔒

🔗 **Needs:** Waves 2, 6
🔑 **Blocked by:** Clerk publishable + secret key

---

## 🌊 Wave 9 - Ratings, watch log, favorites

🎯 **Goal:** the core personal loop works.

📦 **Deliverables**
- API: `PUT /api/episodes/{id}/rating`, `DELETE`, `POST /api/episodes/{id}/watch`, watch history, `PUT/DELETE /api/episodes/{id}/favorite`
- Actor always derived from the verified token, **never** from the request body 🔒
- Rate limiting on every write
- Score recompute triggered on rating write
- UI: 1-10 rating widget, watch button showing "watched 3x, last on 12 Mar", favorite toggle, optimistic updates
- `/me` profile with rating history, watch log, favorites

✅ **Done when:** a user rates, sees the public score move, marks watched twice and sees rewatch history. Rating the same episode twice **updates** rather than duplicating (unique constraint holds).

🔗 **Needs:** Waves 7, 8

---

## 🌊 Wave 10 - Membership + verification + scores

🎯 **Goal:** the elite score works, and verification is a real admin workflow.

📦 **Deliverables**
- API: claim membership, upload verification screenshot (Django `ImageField`, **private storage**) 🔒
- Admin verification queue: view screenshot via short-lived signed URL, approve/reject, stamps `verified_by` + `verified_at`
- `services/scoring.py` - both scores, single source of truth
- Celery sweep recomputing all denormalized scores (self-healing)
- UI: elite vs public score display, membership badges, verification status

✅ **Done when:** verifying a member makes an episode's elite score change **with no data migration and no duplicate rows**, and a screenshot is unreachable without a signed URL.

🔗 **Needs:** Wave 9

---

## 🌊 Wave 11 - Community content

🎯 **Goal:** the community can describe what happened. This is the actual product.

📦 **Deliverables**
- Comments with spoiler flag (blurred until revealed)
- Canonical `Topic` resolution: free text → `slugify(allow_unicode=True)` → `get_or_create`, with fuzzy suggestion so 50 spellings of one tag never happen 🇧🇬
- `EpisodeTopic` + up/down votes, denormalized `score` for sorting
- `Moment` timestamps with a clickable YouTube deep link (`?t=`)
- Private `PersonalTag` - **never** exposed on any public endpoint 🔒
- Rate limiting and report buttons throughout
- Output escaping everywhere. No `dangerouslySetInnerHTML` on user content.

✅ **Done when:** two users independently typing the same Bulgarian topic land on **one** `Topic` row, and `/t/[slug]` lists every episode carrying it.

🔗 **Needs:** Wave 9

---

## 🌊 Wave 12 - Meilisearch

🎯 **Goal:** the reason this app exists - search that beats YouTube's.

📦 **Deliverables**
- `podcast/search/` - client, document builder, index settings
- Document = title + description + channel + topic labels + moment labels + participant names
- Bulgarian tokenization, typo tolerance, synonyms, ranking rules 🇧🇬
- Indexing in **Celery tasks only**, never inline in a request
- `manage.py reindex` - full rebuild from Postgres
- `GET /api/search` + a `/search` page with facets (channel, date, score, members-only)

✅ **Done when:** a misspelled Bulgarian query finds an episode by a community label, `reindex` rebuilds from empty, and results return in under 50ms.

🔗 **Needs:** Wave 11

⚠️ Postgres full-text is the acceptable fallback **behind the same endpoint** if Meilisearch misbehaves on Cyrillic.

---

## 🌊 Wave 13 - People, moderation, leaderboards

🎯 **Goal:** close the loop on the remaining brief features.

📦 **Deliverables**
- `Person` personas + `EpisodeParticipant` admin, `/p/[slug]` showing every appearance
- Generic `Report` queue in Django Admin, pending/resolved/dismissed, resolution notes
- Leaderboards: top-rated, top elite, most-watched, most-commented (denormalized, cached)
- Moderator role gating on destructive actions 🔒

✅ **Done when:** a reported comment reaches the admin queue and can be resolved, and leaderboards render from cached aggregates with no per-request recompute.

🔗 **Needs:** Waves 10, 11

---

## 🚧 Standing blockers

| Item | Needed for | Impact if late |
|------|-----------|----------------|
| 🔑 Remaining 5-7 channel URLs | Wave 4 (full backfill) | None on the critical path. `@ivankirkov1` alone proves every wave through 13. |
| 🔑 Clerk publishable + secret key | Wave 8 | Blocks waves 9-13. Waves 1-7 are unaffected. |
| 🔑 `YOUTUBE_API_KEY` | Wave 5 | Daily sync falls back to yt-dlp behind a flag. Not fatal. |
| 🔑 R2 credentials | Wave 10 | Local `MEDIA_ROOT` covers dev entirely. |

---

## 📌 Rules that hold across every wave

- 🚫 **Never** commit or push without the owner explicitly saying so
- 🚫 **Never** hand-write a migration - `makemigrations` only
- 🚫 **Never** ingest Shorts
- 🚫 **Never** mirror thumbnails to R2
- 🚫 **Never** put an emoji in rendered UI - `lucide-react` only
- ✅ **Always** log a schema change in `docs/02-schema-decisions.md`
- ✅ **Always** update `docs/STATUS.md` when a wave completes
- ✅ **Always** run the verification before marking done
- ✅ **Always** `slugify(..., allow_unicode=True)` on Bulgarian text
