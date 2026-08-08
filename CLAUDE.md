# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 📖 **Read these first for full context:**
>
> - `docs/00-build-brief.html` - the original product brief (single source of truth for scope)
> - `docs/01-canonical-models.py` - the canonical Django schema handed over with the brief
> - `tools/youtube-metadata/README.md` - **real ingestion findings from a live probe. Read before touching Phase 1.**
> - `docs/STATUS.md` - what is actually built right now (create it at Phase 0)
> - `specs/00-index.md` - index of all feature specs

---

## 🎯 Project Overview

**Podcast Community Platform** - a searchable community hub for a group of **Bulgarian YouTube podcast channels** (~6-8 channels, ~1,000 episodes). Users browse every episode across all channels, rate them 1-10, log what they've watched, label what happened in each episode, and search across it all far better than YouTube's own search.

- **Audience:** ~1,000+ users. Small data, low traffic. Bulgarian-language content and UI.
- **Core value:** searchability. YouTube search across these channels is bad. Community labels + timestamps + canonical topics fix that.
- **Status:** 🔴 **Pre-scaffolding** (Phase 0 not started)

### 🚫 Explicit Non-Goals for v1

- ❌ **No transcription.** Searchability comes from community topic labels and moments. A `Transcript` model can attach to `Episode` later without reworking anything.
- ❌ **No mobile app yet.** The API is built API-first so React Native/Expo can be added later without a backend rewrite.
- ❌ **No microservices, no Kubernetes, no NoSQL.** This is a small app. Cache reads and denormalize aggregates before reaching for anything fancier.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  🟦 Next.js (App Router) + TypeScript          apps/web      │
│  - Server Components for SEO (this is a content site)        │
│  - Tailwind CSS + shadcn/ui + lucide-react                   │
│  - Clerk auth (session token forwarded to the API)           │
└──────────────────────────────────────────────────────────────┘
                    ↓ HTTP/JSON (Clerk JWT in Authorization)
┌──────────────────────────────────────────────────────────────┐
│  🐍 Django + Django-Ninja                      apps/api      │
│  - API-first: web today, mobile later, ONE backend           │
│  - Django Admin = the entire moderation backend for free     │
│  - Celery + Celery Beat: YouTube sync, Meilisearch indexing, │
│    score recomputation                                       │
└──────────────────────────────────────────────────────────────┘
        ↓                    ↓                    ↓
┌───────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ 🐘 PostgreSQL │   │ 🔴 Redis        │   │ 🔍 Meilisearch   │
│ source of     │   │ cache + Celery  │   │ typo-tolerant,   │
│ truth         │   │ broker          │   │ Bulgarian-ready  │
└───────────────┘   └─────────────────┘   └──────────────────┘
                             ↓
                 ☁️ Cloudflare R2 (mirrored thumbnails,
                    verification screenshots)
```

**Boundary contract:** Next.js never talks to Postgres, Redis, or Meilisearch directly. **Every** read and write goes through the Django-Ninja API. That is what keeps the future mobile app free.

---

## 🛠️ Tech Stack (LOCKED - do not substitute)

### Frontend (`apps/web`)

| Layer            | Technology                                  |
| ---------------- | ------------------------------------------- |
| Framework        | **Next.js (App Router) + TypeScript strict** |
| Styling          | **Tailwind CSS**                            |
| UI components    | **shadcn/ui** (see note below)              |
| Icons            | **`lucide-react`**                          |
| Auth             | **Clerk** (`@clerk/nextjs`)                 |
| Server state     | **TanStack Query** (client components only) |
| UI state         | **Zustand** (only if a store is genuinely needed) |
| Forms/validation | `react-hook-form` + `zod`                   |
| Toasts           | `sonner`                                    |
| Hosting          | Vercel (or Fly.io alongside the API)        |

### Backend (`apps/api`)

| Layer            | Technology                                  |
| ---------------- | ------------------------------------------- |
| Runtime          | **Python 3.12+**                            |
| Framework        | **Django 5.x**                              |
| API              | **Django-Ninja** (Pydantic schemas, auto OpenAPI) |
| Admin            | **Django Admin** (moderation, verification, personas, reports) |
| ORM/DB           | **PostgreSQL**                              |
| Jobs             | **Celery + Celery Beat**, Redis broker      |
| Search           | **Meilisearch**                             |
| Ingestion        | **yt-dlp** (backfill) + **YouTube Data API v3** (daily sync) |
| Storage          | **Cloudflare R2** (S3-compatible, via `boto3`/`django-storages`) |
| Package manager  | **uv**                                      |
| Hosting          | Fly.io or Railway (Docker)                  |

### Shared

| Layer       | Technology                                            |
| ----------- | ----------------------------------------------------- |
| Monorepo    | **Turborepo** (npm workspaces)                        |
| Types       | TS types **generated from Django-Ninja's OpenAPI** into `packages/api-types` |
| Local dev   | **Docker Compose** (Postgres, Redis, Meilisearch)     |
| Errors      | **Sentry** (both sides)                               |
| Analytics   | **PostHog** (web only)                                |
| CDN/DDoS    | **Cloudflare** in front                               |

---

## 🚨 Critical Stack Rules (NON-NEGOTIABLE)

### Architecture

- ❌ **NEVER** query Postgres/Redis/Meilisearch from Next.js. Everything goes through the Django-Ninja API.
- ❌ **NEVER** use Django REST Framework. Django-Ninja only, so the OpenAPI schema stays clean and TS types stay generated.
- ❌ **NEVER** hand-write a TypeScript API type. Generate `packages/api-types` from the API's OpenAPI schema and import it.
- ❌ **NEVER** install MUI, Ant Design, Chakra, Mantine. **shadcn/ui only.**
- ❌ **NEVER** put an emoji in rendered UI code. Use `lucide-react`. Data shapes store semantic keys; the component maps key → icon.
- ✅ **ALWAYS** use Server Components for public, indexable pages (episode, channel, topic, person). Client Components only for interactive bits (rating widget, watch button, comment form).

### shadcn/ui note (verified 2026-08-08)

shadcn's current default style is **`base-nova`**, which installs **`@base-ui/react`**, not Radix. It is still shadcn/ui installed via the official CLI, and components still live in `components/ui/` as plain TypeScript you own. The "Radix + Tailwind" description elsewhere is now historical.

- ✅ Keep using the shadcn CLI. Components are yours to edit.
- ❌ Still never install MUI, Ant Design, Chakra or Mantine.

**Base UI composes differently from Radix.** This costs time every single occurrence:

- ✅ `<Button render={<Link href="/" />} nativeButton={false}>` - Base UI uses a `render` prop.
- ❌ `<Button asChild><Link href="/" /></Button>` - `asChild` is Radix and does nothing here.
- 🚨 Omitting `nativeButton={false}` when the rendered element is an `<a>` logs a Base UI accessibility error about fake button semantics. It is a **console-only** error, so it passes `typecheck`, `lint` and `build` - the dev overlay's issue counter is the only place it shows up. Check it after adding a link-styled button.

### 🚨 NEVER put `loading.tsx` at the app root

A root `app/loading.tsx` wraps EVERY page in a Suspense boundary. Next then flushes the HTML shell with a **200** before the page resolves, so every `notFound()` on the site silently becomes a **soft 404**: status 200 with a blank body.

This bit us on 2026-08-08. `/channels/does-not-exist` and `/e/BADID` both returned **200 + an empty page**. The pages were calling `notFound()` correctly the entire time - the loading boundary was swallowing it. On a site whose whole point is being indexable, Google would have crawled every dead episode link as a real page.

- ✅ Scope skeletons to routes that **cannot** 404 (e.g. `app/status/loading.tsx`).
- ❌ Never `app/loading.tsx`.
- 🧪 Whenever you add a Suspense boundary or a loading file, **curl a deliberately bad URL and assert the status is 404**, not just that "the page looks right".

### UI language

- ✅ **UI copy is ENGLISH for now** (owner decision, 2026-08-08). Episode content, titles and community labels are Bulgarian; the chrome around them is English.
- ✅ **Never hardcode a user-facing string inside a component.** Put copy in a module-level `const` or a small `lib/copy.ts` map. Bulgarian or a BG/EN toggle is a likely v2, and this one habit is the difference between a one-day i18n retrofit and a two-week one.
- ❌ Do not install `next-intl` or any i18n library yet. Deferred to `NEXT_TIME.md`.

### Database & schema

- ✅ **`docs/01-canonical-models.py` is a strong starting point, NOT a frozen contract.** (Owner ruling, 2026-08-08: "this model is just a suggestion, of course you can adjust it.") Add fields, add indexes, fix relations using judgment. The obligation is to **document the deviation in `docs/02-schema-decisions.md`**, not to stop and ask. Still flag anything that changes the *meaning* of a model (e.g. splitting `Rating`) before doing it.
- ❌ **NEVER hand-write a migration file.** Always `python manage.py makemigrations`. Review the generated file, never author it.
- ❌ **NEVER** run destructive operations (`DROP`, `TRUNCATE`, `migrate --fake`, `flush`) without explicit confirmation.
- ✅ **ALWAYS** index every foreign key that gets filtered on, and every hot sort column.
- ✅ **ALWAYS** enforce uniqueness at the DB level (`UniqueConstraint`), never in application code alone. Already true for `Rating`, `Favorite`, `EpisodeTopic`, `ChannelMembership`, `PersonalTag`, `EpisodeTopicVote`, `EpisodeParticipant`.
- ✅ **`Episode.youtube_id` is the external primary key.** All ingestion is `update_or_create(youtube_id=...)` so re-running a sync is idempotent.

### Database portability (local now, managed later)

- ✅ **Postgres runs in Docker Compose locally and moves to a managed host later with a `DATABASE_URL` change and nothing else.** This is a config swap, not a migration project.
- ❌ **NEVER use a Postgres-vendor-specific extension or a hosting-provider SDK in application code.** No `pgvector`, no provider client libraries, no raw SQL that only one host accepts. Plain Django ORM against plain Postgres keeps every host on the table (Neon, Supabase, Fly Postgres, Railway, RDS).
- ✅ **Read the DB config from `DATABASE_URL`** via `dj-database-url`. Never hardcode host/port/credentials in `settings.py`.
- ✅ Going live is then: provision managed Postgres → `pg_dump` local → `pg_restore` remote → set `DATABASE_URL` → `migrate`. Migrations are the portable contract, so **never** edit an applied migration.
- ✅ Same rule for Redis (`REDIS_URL`) and Meilisearch (`MEILI_URL`). All three are Docker locally, managed later, one env var each.

### Storage & uploads (deliberately minimal)

- 🚨 **Thumbnails are NOT uploads.** They are a derived Google CDN URL. There is no upload pipeline for them and there must never be one. See the Ingestion rules.
- ✅ **The only real upload in this app is the membership verification screenshot** (Phase 3): one small private image per user per channel, posted to **Django**, not to Next.js.
- ✅ Handle it with Django's native `ImageField` + `django-storages[s3]` pointed at R2. That is a settings block, not a subsystem. Do **not** port a presigned-PUT / multipart uploader from another project: those exist for large browser-to-R2 media transfers and are the wrong shape and the wrong language here.
- 🔒 **Verification screenshots are PRIVATE.** Non-public bucket or prefix, served only through short-lived signed URLs to admins/moderators. These are real people proving a paid membership. Never a public URL, never in a Meilisearch document, never in an analytics property.
- ✅ Local dev writes to `MEDIA_ROOT` on disk. R2 is wired at Phase 3, not at Phase 0.

### Scores (the thing most likely to be got wrong)

- 🚨 **There is ONE `Rating` model and TWO derived numbers.** There is no separate "elite vote".
  - **Public score** = `Avg(score)` over all ratings.
  - **Elite score** = `Avg(score)` over ratings by users with a **verified** `ChannelMembership` for **that episode's channel**.
- ✅ When a user gets verified, their existing ratings automatically start counting toward elite. Never backfill or duplicate rows to make this work.
- ❌ **NEVER** call `episode.public_score()` / `elite_score()` in a loop. Those are convenience methods only. For list pages, **annotate the queryset** or read the denormalized columns.
- ✅ Denormalize `public_score`, `elite_score`, `rating_count`, `elite_rating_count` onto `Episode` and recompute them on rating write plus a periodic Celery sweep. Ask before adding those columns (schema deviation, see above).

### Ingestion

> 🔬 **Validated against `@ivankirkov1` (74 episodes, 2026-08-08).** Full findings in `tools/youtube-metadata/README.md`. The rules below are what that probe proved, not guesses.

- 🚨 **A channel's episode count spans THREE tabs, not one.** `/videos` alone silently loses past live streams, which for a podcast **are episodes**. On the test channel: 72 videos + 2 streams + 15 shorts = the 89 on the channel badge.
- 🚨 **Ingest `videos` + `streams` ONLY. Shorts are NEVER ingested** (owner decision, 2026-08-08). They are promo clips, not episodes. `DEFAULT_TABS = ("videos", "streams")` is the permanent setting. If this is ever reversed, it costs a full re-backfill.
- 🚨 **Members-only videos give up full metadata with no login.** Pass `ignore_no_formats_error: True` to yt-dlp. That error is about playable *formats*, not metadata. Coverage went 65/74 → **74/74, zero errors**. Paywalled episodes must be listed, searched, rated and labelled like any other. We never touch the media.
- ✅ **Thumbnails need no API call and NO upload.** Build from the video id:
  - `https://img.youtube.com/vi/{VIDEO_ID}/maxresdefault.jpg` (1280x720, best)
  - `https://img.youtube.com/vi/{VIDEO_ID}/hqdefault.jpg` (480x360, **guaranteed** present)
  - Try `maxresdefault` with a `HEAD` request, fall back to `hqdefault`. **Store the video id, derive the URL at render time.** ❌ **Do NOT mirror thumbnails to R2.** Google's CDN serves them free and forever; mirroring adds cost, a sync job, and staleness for zero gain. (74/74 had `maxresdefault` on the test channel.)
- ⚠️ **Do NOT build `Chapter` ingestion assuming chapters arrive.** The probe found **0 of 12** episodes with `chapters`, and descriptions averaged **118 chars** (min 0). Populate `Chapter` opportunistically when present. Community `Moment` labels are the **primary** timestamp source. This is the strongest argument for the community-labelling model: there is no creator-supplied structure to lean on.
- ⚠️ **`view_count` is missing on members-only videos.** Never assume it is present. Nullable, and excluded from "most-watched" sorting when null.
- ✅ **yt-dlp for the one-time bulk backfill.** ~0.56s per episode with 8 parallel workers, so ~1,000 episodes ≈ **10 minutes**. Cheap enough to run in one foreground pass. Keep it resumable anyway via `update_or_create(youtube_id=...)`.
- ✅ **YouTube Data API v3 for the ongoing daily sync** (stable, TOS-blessed, ~10k units/day free quota).
- ✅ The flat channel listing is nearly free but returns **no upload date** (`timestamp` is null on flat entries). Dates require one full extraction per video. Budget accordingly.
- ✅ Sync is a **management command** with the actual work in a reusable service function, so Celery Beat and the CLI share one code path.
- ✅ Every sync run must be **idempotent and resumable**. Rate-limit, back off, and log per-video failures without aborting the run (see `build_one` error handling in the probe tool).
- ⚠️ yt-dlp is scraping and **will** break on YouTube changes. It already warns about the missing JavaScript runtime (only needed for format decipher, which we never request). Never make the daily sync depend on it.
- ⚠️ **Findings come from ONE channel.** Chapter availability, description quality and shorts/streams ratios will differ. **Re-probe each new channel** with `tools/youtube-metadata/fetch_video.py` before assuming its shape.

### Channels

| Handle | Channel ID | Episodes | Status |
| ------ | ---------- | -------- | ------ |
| `@ivankirkov1` | `UCBy9yfnAqjC1gofLFJ8kMlw` | 72 videos + 2 streams | ✅ Probed 2026-08-08 |
| _(5-7 more TBD)_ | | | ⏳ Awaiting list |

### Search

- ✅ Meilisearch index updates happen in **Celery tasks**, never inline in a request.
- ✅ **Postgres is the source of truth.** A wiped Meilisearch index must be fully rebuildable from Postgres with one command (`manage.py reindex`).
- ✅ Searchable document = episode title + description + channel name + topic labels + moment labels + participant names.
- 🇧🇬 **Bulgarian content.** Verify Cyrillic tokenization and typo tolerance with real Bulgarian queries, not English test data. Never lowercase/slugify Cyrillic in a way that destroys it (`slugify` needs `allow_unicode=True` where slugs must stay readable).
- ✅ Postgres full-text search is an acceptable v1 fallback if Meilisearch is not up yet, behind the same API endpoint.

### Auth (Clerk)

- ✅ Clerk is the identity provider. Django **verifies the Clerk JWT** (JWKS, cached) and maps `sub` → a local Django `User` + `UserProfile`.
- ❌ **NEVER** hand-roll JWT issuance, password hashing, or session handling. That is the whole reason Clerk is here.
- ✅ Users are provisioned lazily on first authenticated request (get_or_create on the Clerk `sub`) and/or via Clerk webhooks. Store the Clerk user id on `UserProfile`. **Ask before adding that field** (schema deviation).
- 🔒 **Authorization is checked on the API, always.** Never rely on the frontend hiding a button. Moderator/admin actions check `UserProfile.role`.
- 🔒 Verification screenshots are **private** (signed URLs / admin-only). They are proof-of-membership images from real people.

### Security

- 🔒 Rate-limit every write endpoint (ratings, comments, topics, moments, reports). ~1k users can still spam.
- 🔒 Comments, topic labels, and moment labels are **user input rendered publicly**. Escape on output, never `dangerouslySetInnerHTML` them.
- 🔒 Never trust a client-supplied `user_id`. Derive the actor from the verified token, always.
- 🔒 `.env` files are never committed. `.env.example` is.

---

## 📦 Repository Structure (Target)

```
/
├── apps/
│   ├── web/                        ← Next.js App Router
│   │   ├── app/
│   │   │   ├── (public)/           ← SEO pages: /, /channels, /e/[slug], /t/[topic], /p/[person]
│   │   │   ├── (app)/              ← Authed: /me, /me/watchlist, /me/tags
│   │   │   ├── search/
│   │   │   └── api/                ← Route Handlers ONLY where a server secret is needed
│   │   ├── components/
│   │   │   ├── ui/                 ← shadcn primitives
│   │   │   ├── episode/            ← rating widget, watch button, moment list
│   │   │   └── shared/
│   │   ├── lib/api/                ← typed fetch wrapper around the Django API
│   │   └── queries/                ← TanStack Query hooks
│   └── api/                        ← Django project
│       ├── config/                 ← settings/, urls.py, celery.py, asgi/wsgi
│       ├── podcast/                ← THE domain app (canonical models live here)
│       │   ├── models.py           ← copied verbatim from docs/01-canonical-models.py
│       │   ├── admin.py            ← moderation backend
│       │   ├── api/                ← Django-Ninja routers + schemas
│       │   ├── services/           ← business logic (scores, topic resolution, verification)
│       │   ├── ingestion/          ← yt_dlp_backfill.py, youtube_api_sync.py, chapters.py
│       │   ├── search/             ← meilisearch client, document builders, reindex
│       │   ├── tasks.py            ← Celery tasks (thin wrappers over services/)
│       │   └── management/commands/
│       ├── pyproject.toml          ← uv project
│       └── Dockerfile
├── packages/
│   └── api-types/                  ← TS types GENERATED from the API OpenAPI schema
├── docs/                           ← brief, canonical models, STATUS.md
├── specs/                          ← living feature specs (see rules below)
├── docker-compose.yml              ← postgres + redis + meilisearch (+ api, worker)
├── turbo.json
└── package.json
```

**Rule:** Business logic lives in `podcast/services/` as plain functions. API routers do validation + auth + call a service. Celery tasks are thin wrappers over the same services. Never put logic in a router or a task body.

---

## 🌊 How Work Runs: Waves

**The unit of work is a WAVE, not a phase.** Waves are defined in **`specs/01-initial-build/01-waves.md`** - 13 of them, each self-contained with its own goal, deliverables, acceptance criteria and dependencies.

**The loop for every wave:**

1. Build it
2. **Verify against "Done when" by actually running it.** Never assume.
3. Update `docs/STATUS.md` - wave status, what runs, what surprised us
4. Log any schema change in `docs/02-schema-decisions.md`
5. Move to the next unblocked wave

- ❌ **NEVER** start a wave whose `Needs` are not green.
- ❌ **NEVER** mark a wave done without running its verification.
- ✅ **ALWAYS** update `docs/STATUS.md` on completion. That file is the single answer to "where are we?".

The phase table below is the product-level view. The waves are how it gets built.

## 🗺️ Build Plan (phase view)

| Phase | Goal | Done when |
| ----- | ---- | --------- |
| **0** | **Scaffolding.** Turborepo, Django + Ninja, Next.js, Docker Compose (Postgres/Redis/Meilisearch), Clerk wired end to end, Sentry + PostHog stubs. | `docker compose up` works, `/api/health` returns 200, a signed-in user's identity reaches Django. |
| **1** | **Ingestion.** `Channel` + `Episode` + `Chapter` models, yt-dlp backfill command, thumbnail handling, daily Celery Beat sync. | ~1,000 episodes visible and browsable in Django Admin. |
| **2** | **Browse + profiles.** Public episode/channel pages, user profiles, ratings, watch log, favorites. | A signed-in user can rate and mark watched from the web UI. |
| **3** | **Membership + scoring.** `ChannelMembership`, screenshot verification in admin, derived public + elite scores. | Verifying a member changes an episode's elite score with no data migration. |
| **4** | **Community + search.** Comments, canonical topics + votes, personal tags, moments, Meilisearch. | Bulgarian query finds an episode by a community label. |
| **5** | **People + moderation + leaderboards.** Personas, participants, report queue, leaderboards. | A reported comment appears in the admin queue and can be resolved. |
| **6** | **Later (optional).** Transcription layer, mobile app (Expo, reuses the API). | - |

**Do not start a phase before the previous one demonstrably runs.**

---

## 🌐 Environment Variables

```bash
# ---- apps/api (.env) ----
DJANGO_SECRET_KEY=
DJANGO_DEBUG=1
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1
DATABASE_URL=postgres://postgres:postgres@localhost:54320/podcast
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/1

# Clerk (backend verifies tokens)
CLERK_SECRET_KEY=
CLERK_JWKS_URL=
CLERK_ISSUER=
CLERK_WEBHOOK_SECRET=

# YouTube
YOUTUBE_API_KEY=                     # Data API v3, for the daily sync

# Meilisearch
MEILI_URL=http://localhost:7700
MEILI_MASTER_KEY=

# Cloudflare R2 (server-only)
R2_ENDPOINT=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=

SENTRY_DSN=

# ---- apps/web (.env.local) ----
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
NEXT_PUBLIC_SENTRY_DSN=
```

🔒 **Never commit `.env`, `.env.local`, or any file with a real key.** Only `NEXT_PUBLIC_*` is safe in the browser bundle.

---

## 🪟 Windows Dev-Machine Gotchas (both cost real debugging time on 2026-08-08)

### 1. Postgres is on port **54320**, not 5432

This machine runs **two native PostgreSQL Windows services** (`postgresql-x64-16` and `postgresql-x64-18`) which already own ports **5432 and 5433**. Publishing the container on 5432 *appears* to succeed - `docker compose ps` says healthy and `docker port` shows the mapping - but connections from the host silently reach the **native** server instead, failing with:

```
FATAL: password authentication failed for user "postgres"
```

- ✅ `POSTGRES_PORT=54320` in the root `.env`, and `DATABASE_URL=...@localhost:54320/podcast`.
- ❌ Never "fix" a Postgres auth error by changing the password. Check `Get-NetTCPConnection -LocalPort 5432` first.
- ℹ️ Redis (6379) and Meilisearch (7700) are fine - those ports are held by `wslrelay`, which **is** Docker's own forwarder.

### 2. Printing Bulgarian to the console needs `PYTHONIOENCODING=utf-8`

The Windows console defaults to **cp1252**, which cannot encode Cyrillic. Any `manage.py shell -c` or script that prints an episode title dies with:

```
UnicodeEncodeError: 'charmap' codec can't encode characters in position 0-8
```

- ✅ Prefix commands that print content: `PYTHONIOENCODING=utf-8 uv run python manage.py ...`
- ⚠️ This is a **console output** failure only. The data in Postgres is correct UTF-8. Never "fix" it by stripping or transliterating Cyrillic.

### 3. Ports 3000 and 5432 are already taken on this machine

`next dev` auto-falls-forward to **3001** because another project holds 3000. Always read the actual port out of the dev-server output instead of assuming 3000 - probing 3000 hits a **different app** and returns a confusing 200 with none of your content.

### 4. 🚨 NEVER test a Cyrillic endpoint with `curl` from Git Bash

Git Bash mangles non-ASCII **command-line arguments** before the native `curl.exe` ever receives them. Cyrillic is not representable in the ANSI codepage, so every letter becomes `?`:

```bash
curl -s --get http://localhost:8000/api/search --data-urlencode "q=Каспаров"
# the server actually receives  q='????????'
```

This is **maximally deceptive**: `?` is a separator in Meilisearch's tokenizer, so the query tokenizes to nothing, becomes an empty search, and returns **every document**. It looks exactly like a catastrophic relevance bug in search. An ASCII query in the same shell works fine, which makes it look like a Cyrillic-specific application bug. It is neither - it is the shell. (Cost real debugging time on 2026-08-08.)

- ✅ **Test Cyrillic endpoints from Python**, where the source file is UTF-8:
  ```bash
  PYTHONIOENCODING=utf-8 uv run python - <<'PY'
  import json, urllib.parse, urllib.request
  url = "http://localhost:8000/api/search?" + urllib.parse.urlencode({"q": "Каспаров"}, encoding="utf-8")
  print(json.load(urllib.request.urlopen(url))["total"])
  PY
  ```
- ✅ Or use the Django test client in pytest, which never crosses a shell boundary.
- 🔍 **Tell-tale sign:** the endpoint echoes the query back as `????????` with exactly one `?` per original character. When a search returns *everything* for a real word but *nothing* for gibberish, check the echoed query before touching the index.

## ⚡ Quick Commands

```bash
# Infra
docker compose up -d                      # postgres + redis + meilisearch

# API (apps/api)
uv run python manage.py migrate
uv run python manage.py runserver
uv run python manage.py makemigrations    # NEVER hand-write migrations
uv run celery -A config worker -l info
uv run celery -A config beat -l info
uv run python manage.py backfill_channel <youtube_channel_id>   # yt-dlp bulk
uv run python manage.py sync_channels                            # Data API daily
uv run python manage.py reindex                                  # rebuild Meilisearch
uv run pytest

# Web (apps/web)
npm run dev
npm run build
npm run typecheck
npm run lint

# Monorepo
npx turbo dev
npx turbo typecheck lint build
```

---

## 📁 Specs & Documentation

Feature specs live in `specs/`. They are a **living artifact** - update them as decisions are made.

### 🚨 Specs Rules

When discussing or implementing **new features, pipelines, or any significant new topic**:

1. **Create a spec folder** with sequential numbering: `specs/XX-feature-name/` (check existing folders for the next number).
2. **Files inside are also numbered:** `01-analysis.md`, `02-implementation-plan.md`, `03-decisions-summary.md`.
3. If a folder for the topic exists, add the next numbered file there instead of a new folder.
4. Add a row to `specs/00-index.md` whenever you create a folder.

Common file types: `XX-analysis.md`, `XX-implementation-plan.md`, `XX-decisions-summary.md`, `XX-testing-checklist.md`, `XX-known-issues.md`.

---

## 🚨 Git Rules

**Standing authorization granted 2026-08-08: commit and push freely to the current branch as work completes.** This OVERRIDES the global default of asking first. No need to ask each time.

- ✅ Stage everything (`git add -A`), commit with a descriptive message, push to the **current** branch (`main` is fine).
- ✅ Report branch + hash + file count afterwards.
- ❌ **NEVER** create a new branch unless explicitly asked.
- ❌ **NEVER** force-push, rewrite history, or delete a branch. Those stay explicit-request-only.
- 🚨 **The repo is PUBLIC** (`github.com/TheHero9/comedy-club-community`). Everything pushed is world-readable. Audit before every push: no `.env*`, no keys, no credentials, no verification screenshots, no absolute local paths.
- 🔒 If a secret is ever staged: unstage it, warn loudly, and continue with the rest.

### Branch Naming

```
YYYYMMDD-feature-name        e.g. 20260808-p1-ingestion
```

---

## 📌 Naming Conventions

### Python / Django

- Variables & functions: `snake_case` · Classes & Pydantic/Ninja schemas: `PascalCase` · Constants: `UPPER_SNAKE_CASE` · Files: `snake_case.py`
- Ninja schemas suffixed by intent: `EpisodeOut`, `RatingIn`, `EpisodeListOut`
- Celery tasks: verb-first, `sync_channel_episodes`, `reindex_episode`

### TypeScript / React

- Variables & functions: `camelCase` · Components & types: `PascalCase` · Constants: `UPPER_SNAKE_CASE`
- Files: components `ComponentName.tsx`, hooks `useSomething.ts`, utilities `kebab-case.ts`, routes per Next.js conventions

### Database

- Tables: Django default (`podcast_episode`) · Columns: `snake_case` · Text-as-enum values: lowercase literals (`"host"`, `"pending"`)

### Import organization

```python
# 1. stdlib
# 2. third-party (django, ninja, celery)
# 3. local (podcast.services, podcast.models)
```

```ts
// 1. External (react, next, @tanstack/react-query)
// 2. Internal alias (@/components, @/lib)
// 3. Relative (./helpers)
```

---

## 🔍 Post-Change Verification

After any significant feature or fix:

1. `npm run typecheck` and `npx turbo lint`
2. `uv run pytest` if the API was touched
3. Click through the new flow in the dev server on a **mobile viewport** (most users will be on phones)
4. Check edge cases: episode with zero ratings, unverified user, deleted YouTube video, missing `maxresdefault` thumbnail, Cyrillic input, duplicate topic spelling
5. If a model changed: `makemigrations` + `migrate` cleanly on a **fresh** database too
6. If search changed: `manage.py reindex` and query in Bulgarian

**Provide a confidence assessment** at the end of each significant change:

- 🟢 **95-100%** Simple change, fully traced
- 🟡 **80-94%** Moderate, most paths traced
- 🟠 **60-79%** Complex, recommend manual testing
- 🔴 **<60%** High risk, needs thorough testing

---

## 📝 Keeping Documentation Updated

When a change affects architecture or introduces a new concept:

1. **Update this CLAUDE.md** with new models, new services, new conventions, new stack rules.
2. **Update `docs/STATUS.md`** with what phase is done and what runs.
3. **Create/update a spec** for major features, known issues, and complex decisions.

"Significant" = new models or schema changes, new API routers, new Celery tasks, new cross-cutting libraries, new architectural patterns, known limitations.

---

## 📋 NEXT_TIME.md - Deferred Tasks

When the user says "later" / "next time" / "future stage", add an entry to root `NEXT_TIME.md` (create on demand) with: date added (YYYY-MM-DD), context heading, what was deferred, reference to relevant specs, dependencies. Group by topic, not chronologically. Scan it at session start.

---

## 🎨 Development Philosophy

| ❌ Avoid | ✅ Prefer |
| -------- | --------- |
| "Let's simplify for MVP" | Build it right the first time. Small audience, production-grade code. |
| "That's a lot of boilerplate" | Claude handles repetitive work. Ship the production-ready design. |
| Estimating in human-hours | Estimate in phases. Claude time is cheap. |
| Scope creep into v6 features mid-build | Drop it into `NEXT_TIME.md`, stay on the current phase. |
| Clever architecture | Boring, well-supported solutions. The brief says so explicitly. |

---

## 📊 Quick Reference Emojis

| Emoji | Meaning | Usage |
| ----- | ------- | ----- |
| ✅ | Success | Operation completed |
| ❌ | Failure | Operation failed |
| ⚠️ | Warning | Completed with caveats |
| 🔒 | Security | Security concern |
| 🚨 | Danger | Requires approval |
| 📝 | Docs | Comments, READMEs |
| 🐛 | Bug | Bug fix |
| ⚡ | Perf | Performance |
| 🎨 | Styling | UI/CSS |
| ♻️ | Refactor | Refactoring |
| 🔧 | Config | Config change |
| 💡 | Idea | Optional improvement |
| 🎯 | Feature | New feature |
| 🧪 | Testing | Tests |
