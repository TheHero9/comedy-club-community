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
- **Status:** 🚀 **LIVE IN PRODUCTION at https://comedycommunity.club** since 2026-08-15. See § Production below.

### 🚫 Explicit Non-Goals for v1

- ❌ **No paid transcription.** We never run ASR. ✅ **We DO store YouTube's own Bulgarian auto-captions** (free, `bg-orig` via yt-dlp) as searchable `TranscriptSegment` rows - see § Transcripts. Community topic labels and moments remain the primary structure; transcripts are the long-tail fallback for "who said X".
- ❌ **No mobile app yet.** The API is built API-first so React Native/Expo can be added later without a backend rewrite.
- ❌ **No microservices, no Kubernetes, no NoSQL.** This is a small app. Cache reads and denormalize aggregates before reaching for anything fancier.

---

## 🚀 Production (LIVE since 2026-08-15)

> 📖 Full topology, service IDs and the **six deployment gotchas** live in
> [`specs/10-deployment/01-production-setup.md`](specs/10-deployment/01-production-setup.md).
> Read that file before touching any production infrastructure.

| Piece | Where | Address |
| ----- | ----- | ------- |
| Next.js web | Vercel (`comedy-club-community`) | https://comedycommunity.club (+ `www`) |
| Django API | Railway `api` | https://api.comedycommunity.club |
| Celery worker + beat | Railway, same image, custom start commands | - |
| Postgres 18 / Redis / Meilisearch **v1.11** | Railway, volumes, **private network only** | `*.railway.internal` |
| Auth | Clerk **production** instance | issuer `https://clerk.comedycommunity.club` |
| DNS | Porkbun (`comedycommunity.club`) | A→Vercel, `api`→Railway CNAME+TXT, 5 Clerk CNAMEs |

### Rules that keep production healthy

- 🚨 **`git push` to `main` deploys the WEB ONLY. Railway does NOT auto-deploy.** Vercel rebuilds on any push, as documented. Railway does not: the **Railway GitHub App is not installed on the repo**, so its push trigger has never fired. This was believed for days and only surfaced on 2026-08-15, when two commits touching `apps/api/**` produced **zero** Railway deployments - not queued, not failed, simply never created. The web shipped and the API did not, which is the worst shape: the site looked deployed while serving an old schema.
  - 🔍 **Always verify the API separately after a push.** `list-deployments` must show a deployment whose `commitHash` is your commit. A green Vercel deploy says nothing about Railway.
  - ✅ **To deploy the API, trigger it explicitly** (Railway dashboard, or the MCP agent's deploy tool, which creates a real build from current `main` - verified by read-back).
  - 🚨 **`redeploy` is NOT a deploy.** It re-runs the most recent deployment *reusing that deployment's build AND its config*, so a service-config change you just made is silently ignored. A `startCommand` set via `update-service` followed by `redeploy` ran the OLD command: Celery started, the management command never executed, and the only evidence was the absence of its output between "Starting Container" and Celery's banner. Trigger a NEW deployment instead.
- ✅ **`preDeployCommand` is the reliable way to run a one-off in production**, not the start-command chain. It is the mechanism that already runs `migrate --noinput` on the `api` service, its output lands in the deploy logs where you can read it, and a non-zero exit fails the deploy loudly instead of silently continuing. Set it with `update-service`, **read the config back**, trigger a NEW deployment, read the logs, then clear it (`preDeployCommand: []`) and deploy clean again.
- 🚨 **The Vercel build prerenders against the LIVE API** (`NEXT_PUBLIC_API_URL=https://api.comedycommunity.club`). If the API is down, the web build fails - that is the build telling you the truth, not a flake.
- 🚨 **Meilisearch is pinned to v1.11 in BOTH docker-compose and Railway, and must move in lockstep.** Prod briefly ran v1.42 and typo tolerance silently vanished (exact matches kept working, so nothing obvious broke). A version bump means: change both, wipe the prod volume, reindex, re-run the Bulgarian typo sweep.
- ✅ **A reindex closes on COUNTS, never on the command exiting** - same lesson as backfills. Compare prod totals against local for the same queries (`пица`, `еврвизия`); the Postgres fallback masks an empty index, and "backend switched to meilisearch" only proves the index EXISTS.
- ⚠️ **One-off prod commands: use `preDeployCommand`, one command per deployment.** The older recipe here was to chain the command into the worker's start command; that shape is fragile (see the `redeploy` trap above) and gives no clean failure signal. `preDeployCommand` runs before the service starts, logs to the deploy stream, and fails the deployment on a non-zero exit. Run ONE command per deployment - do not chain.
  - 🚨 **A command that finds nothing still needs a plan.** `delete_person` raises `CommandError` when its target is absent, which as a `preDeployCommand` would fail the deployment. Confirm the row exists in prod BEFORE arming it: `Гост от публиката` turned out to be local-only demo residue, and production had zero `Person` rows all along.
- 🔒 **Secrets live in the Railway/Vercel dashboards only.** Never in the repo, never in chat. The repo is public. `DJANGO_SECRET_KEY` and `MEILI_MASTER_KEY` were generated at deploy time; Clerk keys come from the Clerk dashboard (`sk_live` set by hand in both dashboards).
- 🔒 **Postgres stays private.** Restores go through a temporarily-enabled TCP proxy that is disabled again immediately after (`pg_restore --clean --if-exists --no-owner --no-privileges`, db name `railway`).
- ⚠️ **The Railway MCP agent reports success for config it silently fails to apply** (volumes, custom-domain ports). Only believe a read-back of the service config, never the agent's summary.

### Auth in production (Wave 8, completed 2026-08-15)

- **Both halves are pluggable and switch on the same signal.** API: `AUTH_BACKEND=clerk` (prod.py refuses anything else). Web: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` present → Clerk via `components/auth/ViewerAuthProvider.tsx`; absent (local dev, CI, the whole test suite) → the `NEXT_PUBLIC_DEV_USER` identity and the disabled sign-in stub. The 958-test suite runs keyless and must keep passing unchanged.
- **Components never import Clerk hooks directly** - they read `useViewerAuth()`. That is what lets the tree render without a ClerkProvider in keyless builds.
- 🚨 **`UserProfile.handle` is a self-chosen NICKNAME, not proof of anything** (ruling reversed 2026-08-15, hours after it shipped as an admin-assigned YouTube handle). Anyone can type anything, so it must never gate a membership or be read as a YouTube identity - that would need a separate verified field. Validation lives in `podcast/services/handles.py`: NFKC-normalised (fullwidth lookalikes are an impersonation vector), casefolded (so `IVAN` cannot dodge the unique index on `ivan`), Cyrillic allowed, empty normalised to **NULL not `""`** (unique + `""` is a value in Postgres, so a second user clearing theirs would collide), and a taken handle is a **409, checked before the write AND caught as an `IntegrityError`** - the check alone loses a race.
- 🚨 **`humanize()` must never fall back to an email.** It used to reduce `ivan.petrov@gmail.com` to `ivan.petrov`. The same value is `author_name` on every public comment, so that fallback would have published the local part of real addresses site-wide - and on the profile it simply read as "the site is showing me my email". It returns `""` instead, and the UI renders a neutral placeholder.
- 🚨 **Clerk's DEFAULT session token carries NO identity claims** - only `sub`, `sid`, `iss`, `exp`, `iat`, `nbf`, `azp`, `jti`, `v`. No name, no email, no username, no picture. `provision_user` therefore fell through to its last resort, the Clerk `sub`, and the first real Google sign-in rendered `user_33Kq...` as **both** the display name and the handle. `podcast/auth/clerk_api.py` now reads the real identity from Clerk's Backend API (fails soft - the token is already verified, so a Clerk outage must degrade the name, never block sign-in), and `humanize()` in `auth/backends.py` refuses to let an identity-provider id reach anything user-visible, repairing an already-broken profile on the next request. **Never render `user.get_username()` as a display name** - for a Clerk-provisioned account it IS the `sub`.
- **Google sign-in uses OUR OAuth client** (Google Cloud project `comedy-club`), configured as custom credentials in Clerk's production Google connection. Dev instances borrow Clerk's shared credentials; production does not - a cloned production instance ships the Google button ENABLED but broken ("missing client_id") until custom credentials are pasted in.
- **`proxy.ts` is Next 16's renamed `middleware.ts`** and runs Clerk's session handshake, guarded by the same key check. No route is protected there - authorization is always the API's job.

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

### UI language: bilingual, English by default

- 🌐 **The UI chrome ships in ENGLISH and Bulgarian, English is the DEFAULT** (owner ruling, 2026-08-15, superseding the 2026-08-09 Bulgarian handoff). Both dictionaries live in `apps/web/lib/copy.ts` and must stay in lockstep: `Copy` is `typeof en`, so a key added to English fails typecheck until Bulgarian has it too.
- 🚨 **CHROME ONLY. Content is Bulgarian in both locales and is NEVER translated** - episode titles, descriptions, channel names, community topic labels, moment labels and transcript passages all render as the API returns them. `copy.settings.languageHint` says so on the toggle, and dropping that line would make the switch silently promise a translated catalogue.
- ✅ **Reading the dictionary:** `const copy = await getCopy()` in a Server Component (`lib/locale.ts`), `const copy = useCopy()` in a Client Component (`components/i18n/LocaleProvider`). **Keep the local variable named `copy`** - `tests/copy.spec.ts` scans for `copy.<key>` references and a rename makes every key look unreferenced.
- 🚨 **The dictionary contains FUNCTIONS, so it can never cross the RSC boundary as a prop.** `LocaleProvider` receives the `locale` STRING and derives the dictionary client-side. This is also why a shared leaf used in a client tree (`EpisodeCard`, `ScoreChip`) had to become a Client Component rather than take `copy` as a prop.
- 🚨 **Never build a module-scope table out of `copy`.** A `const NAV = [{label: copy.nav.home}]` at module scope freezes whichever dictionary loaded first and never follows a locale change. Build such tables inside the component. Wire values (sort keys, tab keys, filter values) stay at module scope precisely because they must NOT change with the language.
- 🚨 **`formatDate(value, months)` takes the month names as a required parameter.** A module-level import resolves once per process, so a Bulgarian viewer would get English months in the server HTML and Bulgarian ones after hydration - an invisible mismatch that only surfaces as a console error.
- ⚠️ **Reading the locale cookie makes a route dynamic**, so `export const revalidate = 60` is gone from every page. The API round trips are unaffected: `lib/api/podcast.ts` carries `PUBLIC_CACHE = { next: { revalidate: 60 } }` at the fetch layer. Only the HTML render moved from cached to per-request. Watch `medianMs` (not `payloadKb`) in the perf budgets after touching this.
- ✅ **Never hardcode a user-facing string inside a component.** Everything lives in `apps/web/lib/copy.ts`. `tests/copy.spec.ts` parses every `.tsx` under `app/` and `components/` and fails on any rendered literal with three or more letters, so this is enforced, not aspirational.
- ⚠️ A Tailwind class in an object property named `text`, `label`, `title` or `heading` is read by that scanner as display copy. Name such a key `textClass`.
- ⚠️ The scanner also reads `copy.search.examples.map` as a copy KEY and cannot resolve it. **Alias an array before iterating it**: `const exampleQueries = copy.search.examples`.
- ✅ Structural labels identical in both dictionaries: `Public`, `Elite`, `Member`, and the seven score-band names. The `Podcast Index` wordmark is gone entirely.
- ❌ Still no `next-intl` or any i18n library. Two plain objects and a cookie cover this app's needs; a library would add a build step and a message-extraction workflow for nothing.

### Design system (see `specs/07-visual-redesign/`)

- 🎨 **Tokens live in `app/globals.css`.** Warm-hued neutrals at very low chroma - they are NOT grey, and that warmth is most of what makes the dark theme feel like a room. Dark is the default and the priority.
- 🚨 **Score bands are identical in both themes.** They carry meaning, so they are declared once outside the light/dark split. Only neutrals, brand red, gold and the unrated chip flip.
- 🚨 **Unrated is not a band.** `score === null` renders `?` on `--card` with a dashed border. Never `0`, never the garbage band, never a filled colour. That is 22% of the catalogue.
- 🚨 **`--primary` is the FILL colour; `--primary-text` is brand red as TEXT.** They differ in dark mode because `#E4232C` is only 3.9:1 on the background. Never use `text-primary` for small text - use `text-primary-text`.
- ♿ **The handed-over palette failed WCAG AA in nine places** and the shipped values are corrected. `e2e/a11y.spec.ts` fails the build on any critical or serious axe violation, so a "faithful" revert to the handoff's hex values will be caught. The table of what changed and why is in `specs/07-visual-redesign/01-implementation.md`.
- 🔤 **Three families, all with Cyrillic subsets: Unbounded (display), Onest (UI), JetBrains Mono (numerics).** `subsets: ["latin", "cyrillic"]` is not optional - without it the browser falls back per glyph and a Bulgarian title renders half in the wrong face. `e2e/invisible-failures.spec.ts` 9.4 pins all three.
- 💊 Almost every interactive surface is a pill (radius 99). That is the signature; a squared corner is the exception.
- 🚨 **Band colours NEVER transition.** A colour that moves reads as a value that changed. Skeletons pulse opacity only - a gradient sweeping 20 cards reads as the page loading 20 times.

### Next.js specifics

- 🚨 **`prefetch={false}` on every link to `/search?q=...`.** `/search` is `force-dynamic`, so each prefetch is a real Meilisearch round trip on the server; a dozen fired on paint and the RSC prefetches never settled, so the page never reached network idle.
- 🚨 **Never call `setState` synchronously inside an effect.** `react-hooks/set-state-in-effect` is an error in this repo. Use derived state, adjust-during-render for "reset when a prop changes", or `lib/use-hydrated.ts` for "the server cannot know this".
- ✅ **`LinkButton` / `ExternalLinkButton`, never `<Button render={<Link/>}>`.** Base UI's `render` prop without `nativeButton={false}` logs a console-only accessibility error that passes typecheck, lint AND build.

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
- 🚨 **`podcast/services/scoring.py` has TWO writers and they must never diverge.** `recompute_episode` is the per-write path; `recompute_many` is the set-based path for backfills and seeding (two aggregates + one `bulk_update`, and `reindex=False` so a bulk load does not queue one Celery task per episode). `test_scoring_bulk.py` compares the two **against each other**, never against hardcoded numbers, so tuning one alone fails the suite. Nothing else may write those four columns.
- 🚨 **In the bulk path the elite aggregate needs `F("episode__channel")` on the membership join.** Without it, any verified membership anywhere counts, and every single-channel test still passes.

### Ingestion

> 🔬 **Validated against `@ivankirkov1` (74 episodes, 2026-08-08).** Full findings in `tools/youtube-metadata/README.md`. The rules below are what that probe proved, not guesses.

- 🚨 **A channel's episode count spans THREE tabs, not one.** `/videos` alone silently loses past live streams, which for a podcast **are episodes**. On the test channel: 72 videos + 2 streams + 15 shorts = the 89 on the channel badge.
- 🚨 **Ingest `videos` + `streams` ONLY. Shorts are NEVER ingested** (owner decision, 2026-08-08). They are promo clips, not episodes. `DEFAULT_TABS = ("videos", "streams")` is the permanent setting. If this is ever reversed, it costs a full re-backfill.
- 🚨 **Excluding shorts is NOT enough - promo clips live on the `videos` tab too.** A manual pass over all 1,962 rows on 2026-08-15 removed **100** stand-up excerpts, trailers, show announcements and channel-update clips that had been ingested as episodes. Nothing in the metadata separates them from a real episode: duration is a hint, not a rule (a 1:45 news bulletin is real, an 11:55 "last day in the old studio" is not), so this is a human judgement and always will be.
  - ✅ `manage.py export_review_page` writes a single self-contained HTML file - every episode as a clickable card grouped by channel, filters by kind/duration/text, marks kept in `localStorage` so a 1,962-item pass survives a closed tab. It **marks**; it never deletes.
  - ✅ `manage.py remove_episodes <file>` deletes, from Postgres and BOTH Meilisearch indexes, dumping every affected row to JSON first. It prints the cascade before acting - the 100 episodes also took 119 transcript segments, 51 topic links and 15 now-orphaned topics.
  - 🚨 **A deletion does not stick while a sync is scheduled.** Ingestion is `update_or_create(youtube_id=...)`, so the nightly `sync-channels-daily` would have recreated all 100 the next morning and silently undone the pass. That entry is now **unscheduled** in `config/celery.py`; re-enabling it without an exclusion list first WILL resurrect them. New episodes are pulled deliberately with `manage.py sync_channels`.
  - ✅ The purged id list is committed at `podcast/data/removed-episodes.txt` (not `tmp/`), so it ships in the Docker image and the same command runs identically in prod.
- 🚨 **Members-only videos give up full metadata with no login.** Pass `ignore_no_formats_error: True` to yt-dlp. That error is about playable *formats*, not metadata. Coverage went 65/74 → **74/74, zero errors**. Paywalled episodes must be listed, searched, rated and labelled like any other. We never touch the media.
- ✅ **Thumbnails need no API call and NO upload.** Build from the video id:
  - `https://img.youtube.com/vi/{VIDEO_ID}/maxresdefault.jpg` (1280x720, best)
  - `https://img.youtube.com/vi/{VIDEO_ID}/hqdefault.jpg` (480x360, **guaranteed** present)
  - Try `maxresdefault` with a `HEAD` request, fall back to `hqdefault`. **Store the video id, derive the URL at render time.** ❌ **Do NOT mirror thumbnails to R2.** Google's CDN serves them free and forever; mirroring adds cost, a sync job, and staleness for zero gain. (74/74 had `maxresdefault` on the test channel.)
- 🚨 **Channel avatars/banners are the ONE image whose URL we store** - and it looks like it contradicts the thumbnail rule above, so know why. A thumbnail is *derivable* (`img.youtube.com/vi/{video_id}/...`), so we store the id. An avatar sits at an **opaque content hash** on `yt3.googleusercontent.com` that nothing in the channel id, handle or name predicts, so the URL itself is the data. Still ❌ **never mirrored to R2** - Google's CDN serves it.
  - ✅ Size is a suffix after `=` and is re-derived, not trusted: `=s480-c-k-c0x00ffffff-no-rj` (81 KB) for avatars, `=w1707-no-rj` for banners. Verified live 2026-08-09.
  - ⚠️ **The hash changes when the owner changes their picture**, so a stored URL can start 404ing. `manage.py refresh_channel_meta` re-fetches it in one cheap request per channel. The UI must always keep a fallback - `components/shared/ChannelAvatar.tsx` layers a `Mic` icon *behind* the image so both "no URL" and "URL stopped resolving" degrade without client JS.
  - ✅ `upsert_channel` only writes avatar/banner/subscribers **when present**. An absent value means "unknown", never "clear it" - same lesson as the throttle incident below.
- ⚠️ **Do NOT build `Chapter` ingestion assuming chapters arrive.** The probe found **0 of 12** episodes with `chapters`, and descriptions averaged **118 chars** (min 0). Populate `Chapter` opportunistically when present. Community `Moment` labels are the **primary** timestamp source. This is the strongest argument for the community-labelling model: there is no creator-supplied structure to lean on.
- ⚠️ **`view_count` is missing on members-only videos.** Never assume it is present. Nullable, and excluded from "most-watched" sorting when null.
- ✅ **yt-dlp for the one-time bulk backfill.** ~0.56s per episode with 8 parallel workers, so ~1,000 episodes ≈ **10 minutes**. Cheap enough to run in one foreground pass. Keep it resumable anyway via `update_or_create(youtube_id=...)`.
- ✅ **YouTube Data API v3 for the ongoing daily sync** (stable, TOS-blessed, ~10k units/day free quota).
- ✅ The flat channel listing is nearly free but returns **no upload date** (`timestamp` is null on flat entries). Dates require one full extraction per video. Budget accordingly.
- ✅ Sync is a **management command** with the actual work in a reusable service function, so Celery Beat and the CLI share one code path.
- ✅ Every sync run must be **idempotent and resumable**. Rate-limit, back off, and log per-video failures without aborting the run (see `build_one` error handling in the probe tool).
- 🚨 **A large backfill gets soft-blocked partway through, and yt-dlp DOES NOT ERROR.** Discovered on the 1,318-episode `@comedyclubpodcast` run (2026-08-09). At 8 workers YouTube starts serving a **reduced** metadata payload. Title, description, `upload_date` and id still arrive, so the run finishes reporting **"1318 created, 0 errors"** and looks perfect. What silently vanishes is everything derived from the player response: **`duration`, `availability`, `view_count`, `like_count`**. 1,036 of 1,318 rows came back degraded.
  - 🚨 **The dangerous part is `availability`.** `shape_video` coerces a missing value to `"public"`, so a members-only episode caught by the block is stored as **confidently public**. Missing duration is visibly wrong; a wrong paywall flag is not.
  - 🔍 **Detection: `duration_sec IS NULL` is the marker of a degraded row.** A full response always carries a duration. Proven directly - `vawEZWFo4BA` returned `duration=10246` during the run and `None` on a re-fetch minutes later. Same video, same code, different IP reputation.
  - ✅ **Always run `manage.py repair_metadata --probe 10` after any backfill over ~100 episodes.** It re-fetches degraded rows serially with a delay, and **only writes from a full response**, so running it while still blocked changes nothing rather than overwriting good data with nulls. It aborts after 25 consecutive degraded responses instead of wasting an hour.
  - ⏳ **The block lasts hours, not minutes.** Probing 8 videos serially right after the run recovered **0/8**. There is no "retry harder" here - only wait.
  - ❌ **Never judge a backfill by its error count.** `0 errors` means nothing survived an exception; it does not mean the data is complete. Check `duration_sec IS NULL` instead.
  - 🚨 **A `repair_metadata` run that was never verified is not a repair.** On 2026-08-10 the channel table here said "metadata complete after `repair_metadata`" while **1,076 of 1,318 rows still had `duration_sec IS NULL`** - the repair had been started against a live block, correctly written nothing, and the claim was recorded anyway. It surfaced only because the demo seeder produced a quarter of the expected `Moment` rows (moments need a duration). The re-run recovered all 1,076 with **0 availability corrections**, so nothing had been mis-flagged as public; the loss was duration/view_count only.
  - ✅ **So: finish with the COUNT, not with the command.** `Episode.objects.filter(duration_sec__isnull=True).count()` is the only thing that closes a backfill. `repair_metadata --probe 10` reporting "Block appears lifted" means *start the real run now*, not *done*.
  - ⚠️ **`members_only` is a two-channel total; `availability_corrected` is the reclassification count.** Comparing a corpus-wide `Episode.objects.filter(members_only=True).count()` against a per-channel figure from an earlier note produced a false "9 episodes were reclassified" during that same investigation. Read the number `repair_metadata` prints; do not reconstruct it from a filter with a different scope.
- ⚠️ yt-dlp is scraping and **will** break on YouTube changes. It already warns about the missing JavaScript runtime (only needed for format decipher, which we never request). Never make the daily sync depend on it.
- ⚠️ **Findings come from ONE channel.** Chapter availability, description quality and shorts/streams ratios will differ. **Re-probe each new channel** with `tools/youtube-metadata/fetch_video.py` before assuming its shape.

### Channels

| Handle | Channel ID | Episodes | Status |
| ------ | ---------- | -------- | ------ |
| `@ivankirkov1` | `UCBy9yfnAqjC1gofLFJ8kMlw` | **71** (was 75; 4 removed 08-15) | ✅ Metadata complete |
| `@comedyclubpodcast` | `UCEf1BL_OqYKu2-CVuuMoE2Q` | **1,225** (was 1,318; 93 removed 08-15) | ✅ Metadata complete (degraded twice - 08-09 backfill, 08-13 sync incident - repaired both times) |
| `@comedyclubsport7786` | `UCqe-KdhynYVaIC5YA1Rl4IA` | 47 (47 videos, no streams/shorts tabs) | ✅ Metadata complete; ⏳ transcripts pending |
| `@КомедиКлубКлюкиПодкаст` | `UCi6J4WBZMHtZ2YIAqfDyoww` | 139 (138 videos + 1 stream) | ✅ Metadata complete (API-repaired 08-13); ⏳ transcripts pending |
| `@ComedyClubNews` | `UCQ-cZDkcZUYG5Hb9IeHz4Dw` | **243** (was 246; 3 removed 08-15) | ✅ Metadata complete (API-repaired 08-13); ⏳ transcripts pending |
| `@BFFPepiQ` | `UClo9PMxg3fLWOAMBE6ggl1w` | 80 (79 videos + 1 stream) | ✅ Metadata complete (API-repaired 08-13); ⏳ transcripts pending |
| `@delo404podcast` | `UCu3iYvciVyiwRKysLHA_wFg` | 57 (57 videos; 17 shorts excluded) | ✅ Metadata complete (API-repaired 08-13); ⏳ transcripts pending |

✅ **Metadata is COMPLETE and verified corpus-wide (2026-08-13):** a full Data API
sweep of all 1,961 rows found 0 missing durations/dates/titles/thumbnails, all 1,961
ids returned by the API, and 0 duration mismatches. The evening's 1,680 degraded rows
(509 batch-during-block + 1,171 from the sync incident) were all recovered via
`repair_metadata --api` in one pass - the Data API is quota-based and immune to the
yt-dlp soft-block. Demo data has been fully cleared (`seed_demo --clear`); the DB now
holds ONLY real extracted YouTube data. Cyrillic handles work percent-encoded since
2026-08-13 (`normalize_channel_target` unquotes).

✅ **Transcripts: full catalogue swept 2026-08-13/14.** 579 of 1,961 episodes
(29.5%) have a transcript - **61,452 searchable segments**, Postgres == Meilisearch
exactly; 1,381 episodes checked and recorded as caption-less; **one** episode still
pending on a caption-endpoint 429 (`MoMnxWU9zq8` - it stays in the pending queryset
and any later `backfill_transcripts` run picks it up). Coverage is wildly
channel-dependent: BFF 99%, Kirkov 88%, Дело 404 86%, CCP 28%, News 6%, Клюки 1%,
Sport 0% - never present transcript search as exhaustive.

✅ **Availability: CONFIRMED by full yt-dlp re-backfill of all 5 new channels
(2026-08-14, 0 degraded).** The distribution matched the inferred flags exactly
(55 members-only: 37+9+8+1), so no degraded-era row was ever mislabeled. The re-run
also picked up 89 chapters on Клюки.

⚠️ **`@comedyclubpodcast` alone is 1,318 episodes** - the brief's "~1,000 across all channels"
estimate is wrong by an order of magnitude. Budget search, sync quota and page size for
**5,000-10,000+** episodes, not 1,000. 27 shorts on that channel were correctly excluded.

### Performance (measured 2026-08-09, see `specs/05-performance/`)

- 🇧🇬 **The API renders JSON with `ensure_ascii=False`** via `CompactUnicodeJSONRenderer` in `config/api.py`. Django-Ninja's default escapes every Cyrillic character to a 6-byte `\uXXXX`, which inflated the channel grid by **406 KB on one response**. Never revert to the default renderer on this project.
- ✅ **`GZipMiddleware` is enabled.** Bulgarian JSON compresses ~90%. The BREACH assessment is recorded in `settings/base.py`; re-evaluate it if any endpoint ever returns a token in its body.
- 🚨 **`Index(fields=["-col"])` compiles to `DESC NULLS FIRST`, but the list endpoints sort `DESC NULLS LAST`.** Postgres cannot use one for the other, so a naive descending index is **dead** (`idx_scan = 0`). Sort indexes must be expression indexes matching the actual ordering. Verify with `EXPLAIN ANALYZE` before adding one.
- ⚠️ **Calling `.select_related()` on a related manager inside a loop builds a NEW queryset and silently bypasses the prefetch cache.** This caused a 102-query N+1 in the search fallback. Use `.all()` on a prefetched relation.
- ✅ **Run `npm run benchmark`** before and after anything touching a list, the grid, or a serializer. Budgets live in `scripts/perf-budgets.json` and are enforced by `apps/web/tests/perf-budget.spec.ts`.
- 🚨 **A budget is worth exactly what its WORST SAMPLED query is worth.** `web:search` sampled only `Каспаров`, which matches **one** episode - so it measured a nearly empty page and reported "ok" while a full page regressed 101 → 208 KB. `web:search-broad` (`ергена`, which fills the page) now measures the real thing. When adding a route to the benchmark, pick an input that fills it.
- 🚨 **A result card costs ~5 KB, and RSC charges it TWICE** (the HTML plus the flight tree that re-serializes the same tree). So on a list page, card COUNT dominates and text tweaks are second-order. Cutting `/search`'s caption crop from 30 to 20 words moved 173 → 158.5 KB; the remaining bulk is simply 26 cards where the ceiling was set for 20.
- ⚠️ **Slicing data before passing it to a SERVER component saves nothing.** Its props never cross the wire - only its rendered output does. A "payload optimisation" of that shape here produced a byte-identical response. **Byte-identical numbers after a change mean the change did nothing; re-measure before believing a rationale.**
- ⚠️ A waived budget is a **ratchet**: it fails if the route regresses AND fails with `STALE WAIVER` once the route comes back inside budget, so the waiver must then be deleted.

### Transcripts

> 🔬 Built 2026-08-09. Full spec in `specs/06-transcripts/02-architecture.md`.

- ✅ **Free, no ASR.** YouTube publishes a Bulgarian ASR track (`bg-orig`) for part of the catalogue; yt-dlp fetches it with no API key and no cost. `manage.py backfill_transcripts --since 2024-01-01`.
- 🚨 **Transcript text NEVER goes in the `episodes` Meilisearch document.** A 26,000-word field next to a 60-character title makes every episode match every common Bulgarian word, and a passing mention outranks an episode actually about the subject. It lives in a **second index**, `transcript_segments`. Two indexes, two questions: `episodes` = "which episodes are ABOUT this", `transcript_segments` = "where was this SAID".
- ✅ **Stored as ~60s windowed segments**, not one blob. A raw caption cue is ~2s / ~7 words - a phrase spanning two cues would match neither. `start_sec` is an exact YouTube deep link.
- 🚨 **A degraded response looks EXACTLY like "no captions".** The same soft-block that strips `duration` also strips the caption list. `fetch_transcript` refuses to answer "none" without a `duration` and raises `TranscriptThrottled` instead, writing nothing. Recording a false "none" would be permanent - nothing would re-check that episode.
- ✅ **`Transcript.status="unavailable"` is DATA, with a `checked_at`.** Most of the catalogue has no captions; without a negative record every run would re-fetch them forever. Re-checked after `TRANSCRIPT_RECHECK_DAYS` (90) because YouTube does add captions to older videos.
- ⚠️ **Coverage is partial and date-dependent - never present transcript search as exhaustive.** Sampled 2024-2026: 9/9. 2019-2022: 0/12. 2023 mixed. Members-only: 0/5. An absent episode has not been ruled out; it may just have no transcript.
- ⚠️ **Changing `TRANSCRIPT_SEGMENT_SECONDS` invalidates existing windowing.** Re-run with `--force`. The index deletes **by filter**, never by computed id, so a re-window cannot leave orphans.
- 📊 **Budget Meilisearch, not Postgres.** ~1.2 MB of index per hour of audio (~2.0-2.5 GB for the full catalogue) versus ~56 MB of compressed Postgres text.

### Search

- 🚨 **`minWordSizeForTypos` is measured in BYTES, not characters.** Cyrillic is 2 bytes/char, so every Bulgarian word crosses the threshold at HALF the word length you would assume. The episodes index sat at `{4, 8}` believing those were characters; they meant **2 and 4 characters**, and the query `пица` returned 100 hits of which **95 were false** (`пича`, `пичаги`, `пичове`). Proven by sweep 2026-08-09: false matches persisted to 8 and stopped dead at 9, the byte length of `пица`. Always write thresholds as `N * BYTES_PER_CYRILLIC_CHAR`.
- 🚨 **`/search` MUST query BOTH indexes. Two indexes, two questions, one page.** `apps/web/app/search/page.tsx` fires `/api/search` and `/api/search/transcripts` in a single `Promise.all`. Calling only the first is not a smaller feature, it is a broken one: for 8 months the page did exactly that, and **`баница` - an example query printed on the page itself - showed "Нищо не съвпада" while 173 passages said the word out loud**. Community labelling has barely started, so titles alone answer very little.
  - ✅ Episodes matching both collapse onto ONE card (keyed by `youtube_id`); transcript-only episodes render in the `results-spoken` region below.
  - 🚨 **Label matches are split TITLE-FIRST across two regions** (`results-title`, then `results-elsewhere`), 2026-08-15. People search for a title far more often than for a label, and a title hit ranked below three topic matches reads as "not found". The split reorders the API's ranked list by design, so e2e asserts the union as a SET and pins the partition separately (`7.1b`).
  - 🚨 **`/search` paginates via `?n=`.** The header quotes `results.total`, so a page rendering fewer than that MUST offer a way to reach the rest - it did not, and "38 episodes" above 21 cards read as a broken search. `n` is clamped to `SEARCH_MAX_RESULTS` (500) and floored, because an unbounded page size read off the query string is a DoS lever; the API caps one request at 50, so larger asks are parallel offset pages.
  - ✅ The transcript half `.catch`es to `null`. A 4xx/5xx thrown inside a Server Component is an unhandled throw and therefore a 500 page - label matches are still a useful answer.
  - 🚨 `copy.search.spokenPartial` renders whenever spoken results do. Coverage is ~30% and runs 99% to 0% by channel, so an absent episode has NOT been ruled out.
  - 🔒 Passage text arrives with `<mark>` tags. Render them as element nodes (`Marked` in `SearchResultCard`), **never** `dangerouslySetInnerHTML` - it is auto-caption text that has crossed two systems.
  - 🧪 The two regions carry `data-testid="results-labelled"` / `"results-spoken"` so each is asserted against the endpoint that produced it. An unscoped `a[href^="/e/"]` count spans both and will break.
  - 📏 Page sizes live in `apps/web/lib/search-limits.ts`, imported by the page AND the e2e specs. Never restate one in a test.
- 🚨 **`/api/search/suggest` uses Meilisearch for the ORDER and Postgres for the TEXT.** It fires on nearly every keystroke, so the old `title__icontains` was a sequential scan per keystroke with no typo tolerance (`девствна` suggested nothing). But titles are re-read from Postgres by id, exactly like `_meilisearch_search` does: the index is eventually consistent, and suggesting a renamed episode's stale title sends the user to a zero-result page. Postgres stays the fallback when the index is down or empty.
- ✅ Meilisearch index updates happen in **Celery tasks**, never inline in a request.
- 🚨 **`ensure_index` must set `_settings_applied` with a BARE assignment, never `with _settings_lock`.** `ensure_index_once` calls it while already holding that non-reentrant lock, so taking it again self-deadlocks on the process's first index write. The episodes index hit this on 2026-08-14; **the transcript index was a copy that never got the fix and hung `remove_episodes` on 2026-08-15**. Both modules now carry the same comment - if a third index module is ever added, copy the comment with it.
  - 🔍 **The symptom lies about where the fault is.** The Meilisearch task itself completes in ~9ms and the server stays perfectly healthy, so the queue is empty, `/health` is green, and only the Python client is frozen. It reads as "Meilisearch is slow" or "the network hung". Check `Get-CimInstance Win32_Process` for a live process against an idle index before blaming the search server.
- ⚠️ **The per-episode index helpers are for the incremental path; do not loop them over a batch.** `remove_episode` / `remove_episode_segments` are one HTTP round trip each, so 100 episodes is 200 requests and long enough to look like a hang. Delete a whole id list in one `delete_documents([...])` call, and segments with one `delete_documents(filter="episode_id IN [...]")`. Still **by filter, never by computed id** - segment ids depend on the window size.
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

### Local dev server (all three cost real debugging time)

- 🚨 **`ccc-worker`/`ccc-beat` run code BAKED INTO their Docker image, not the working
  tree.** There is no source volume mount, so a backend fix does NOT reach Celery until
  `docker compose --profile workers build worker beat && docker compose --profile workers up -d worker beat`.
  On 2026-08-13 a worker image built 08-08 ran the daily sync with pre-protection
  `upsert_episode` and degraded 1,171 rows the 08-10 repair had already fixed. After
  ANY change under `apps/api/` that tasks touch, rebuild the images - and remember Beat
  fires overdue jobs (like the daily sync) **immediately on container start**.

- 🚨 **`CONN_MAX_AGE` is 0 in `dev.py` and must stay there.** `base.py` sets 600, which is right for production (gunicorn has a fixed worker count, so connections are bounded). `manage.py runserver` spawns a **new thread per request** with no bound, and Django holds one connection per thread, so a 600s max age exhausts Postgres' default `max_connections = 100`. Measured: **8 concurrent requests produced 14 failures of 32**, 65 connections stayed idle afterwards, and E2E failures ACCUMULATED across runs (1 -> 4 -> 10). With 0: 48 concurrent, 192/192 OK. Pinned by `test_db_connection_policy.py`.
- 🚨 **Next.js serves a STALE fetch-cache entry when revalidation fails, so an API 500 shows up as WRONG DATA, not as an error.** This is why the above hid for a session: the ratings-grid test failed with plausible-but-outdated scores and was logged as an "unexplained flake". When a test says the page and the API disagree, check whether the API was erroring, not just whether the numbers changed.
- ⚠️ **A `runserver` started with `--noreload` does not pick up settings changes.** Restart it, then confirm with `Get-CimInstance Win32_Process` if a fix appears to do nothing.

### Input validation (non-negotiable)

- 🚨 **A NUL byte must never reach Postgres.** `U+0000` is legal in a URL (`%00`) and in a JSON string (`\u0000`), passes every Pydantic constraint, and 500s inside psycopg. It is rejected once, in `podcast/middleware.RejectNullBytesMiddleware` (path + query + JSON body, recursive), for the same reason the throttle is attached to the whole `NinjaAPI`: **a new endpoint cannot ship vulnerable by omission.** Never add a per-endpoint NUL check instead.
- 🚨 **Fixing the API is only half of it: a 4xx raised inside a Server Component is an unhandled throw and therefore a 500 page.** Query-string input is normalised at the edge too - `lib/sanitize.ts` strips C0/C1 control characters in `readFilters` and the search page. 🇧🇬 Control characters ONLY; a sanitiser that ate Cyrillic would break every real slug while still passing a NUL test.
- 🚨 **`MAX_API_LIMIT` in `components/browse/filter-model.ts` must equal `MAX_LIMIT` in `podcast/api/public.py`.** It was 200 against the API's 100, and "Зареди още" grows `limit` by 9 per click - so the **eleventh click served a 500** to an ordinary user. `tests/filter-model.spec.ts` parses the Python constant and fails on drift. Also floor the value: `Number("2.5")` is finite and positive and a float against an `int` param is a 422.
- 🚨 **A query that tokenizes to nothing is not the same as a non-empty query.** `/search?q=???` reached Meilisearch, which read it as a placeholder search and returned **the entire catalogue as matches**. Use `has_searchable_text()`; both `/search` and `/search/transcripts` share it.

### Security

- 🔒 **Rate limiting is IMPLEMENTED** (2026-08-08): `podcast/api/throttling.py` attaches one `WriteThrottle` to the whole `NinjaAPI` in `config/api.py`, so a new write endpoint cannot ship unthrottled by omission. Keyed on `request.auth` (never a client-supplied id), safe methods exempt, **fails open** on a cache outage so a Redis blip cannot make the site read-only. Tune with `API_WRITE_RATE_LIMIT` (default `60/min`); `""` disables it and is local-debug only.
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
YOUTUBE_API_KEY=                     # Data API v3. SET since 2026-08-13 (root .env for
                                     # docker-compose + apps/api/.env for manage.py).
                                     # Keyed: daily sync + repair use the quota-based
                                     # Data API. Keyless: sync falls back to capped
                                     # yt-dlp scraping (YOUTUBE_SYNC_FALLBACK_LIMIT).

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

### 4. 🚨 `next dev` needs a bigger heap, or the big channel page KILLS it

Rendering `/channels/комеди-клуб-подкаст-comedy-club-podcast` (1,318 episodes, ~2,024 grid cells) exhausts the default Node heap in **dev mode only**. The render worker dies with:

```
Jest worker encountered 2 child process exceptions, exceeding retry limit
```

and then the **whole dev server stops answering** - every subsequent request fails to connect, including pages that have nothing to do with the grid. It looks like a bug in whatever page you load next.

- ✅ `apps/web`'s `dev` script sets `NODE_OPTIONS=--max-old-space-size=4096` via `cross-env`. Do not remove it.
- ✅ Verified: default heap dies on render 1; 4 GB heap survives 4 consecutive renders.
- ℹ️ **Production is unaffected** - `next start` serves the same page in ~360 ms. This is dev-mode overhead (source maps, the RSC debug channel), not a production problem.
- 🚧 The real fix is reducing the page, not raising the ceiling. See `specs/05-performance/03-optimization-results.md`.

### 5. 🐌 `localhost:8000` stalls ~2.1s per request - use `127.0.0.1`

Django's `runserver` binds **IPv4 only**, but `localhost` resolves to `::1` first on this machine. Clients that do not implement Happy Eyeballs wait for the IPv6 connection to fail before retrying IPv4.

- Node's `fetch` is unaffected (it races both), so Next.js and any node script look fine.
- **Python's `http.client` and Playwright's request context are NOT** - the e2e suite fails with `ECONNREFUSED ::1:8000` until you pass `NEXT_PUBLIC_API_URL=http://127.0.0.1:8000`.
- ✅ Prefer `http://127.0.0.1:8000` everywhere. A "slow API" on this box is usually this, not the query.

### 6. 🚨 NEVER test a Cyrillic endpoint with `curl` from Git Bash

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
uv run python manage.py repair_metadata --probe 10               # 🚨 ALWAYS after a big backfill
uv run python manage.py repair_metadata --api                    # ⚡ Data API repair: block-immune, 50 rows/quota unit
uv run python manage.py repair_metadata --channel @handle        # yt-dlp re-fetch (states availability; API cannot)
uv run python manage.py refresh_channel_meta                     # avatars, banners, sub counts
uv run python manage.py sync_channels                            # Data API daily
uv run python manage.py backfill_transcripts --probe 10          # free captions: is it worth it?
uv run python manage.py backfill_transcripts --since 2024-01-01  # where the captions actually are
uv run python manage.py backfill_transcripts --tracks <VIDEO_ID> # what tracks exist on one video
uv run python manage.py seed_demo                                # DEV ONLY: fake community data on real episodes
uv run python manage.py seed_demo --channel @ivankirkov1         # scope it to one channel
uv run python manage.py seed_demo --clear                        # exact inverse; episodes untouched
uv run python manage.py reindex                                  # rebuild BOTH Meilisearch indexes
uv run python manage.py reindex --only transcripts               # just the transcript index
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

## 🧪 Testing

**753 automated tests.** ⚡ **Most of them run in CI on every push and PR**
(`.github/workflows/ci.yml`): typecheck, lint, ruff, migration-drift, Vitest, pytest.
**Push instead of re-running those locally.** Only Playwright and the perf budgets have
to run on your machine, because they need the real ingested corpus - and those should be
**scoped to the change**, not run wholesale. See "Match the gate to the change" below.

```bash
npm run test                 # everything: Vitest + Playwright + pytest
npm run test:web             # turbo test -> Vitest then Playwright
npm run test:api             # pytest only

cd apps/web && npx vitest run           # 137 unit + contract tests
cd apps/web && npx playwright test      # 259 E2E (desktop 1280x800 + mobile 390x844)
cd apps/web && npx playwright test --ui # debug interactively
cd apps/api && uv run pytest -q         # 357 backend tests
```

| Layer | Tool | Location |
| ----- | ---- | -------- |
| Frontend E2E | **Playwright** (Chromium only) | `apps/web/e2e/` |
| Frontend unit | **Vitest** (node env, no jsdom) | `apps/web/tests/` |
| Backend | **pytest + pytest-django** | `apps/api/podcast/tests/` |
| A11y | **`@axe-core/playwright`** | `apps/web/e2e/a11y.spec.ts` |

❌ **Never** add Jest, Cypress, Selenium, Enzyme, or a React component renderer. Server Components are covered by Playwright against a real server.

⚠️ **Run the E2E suite against a PRODUCTION build when the signal matters.** `next dev` compiles routes on demand, and under parallel Playwright load the failures that appear are compile pressure, not product bugs - they move between runs. `npx next build && npx next start --port 3100`, then `npx playwright test` (the config reuses an existing server on that port). Dev is fine for iterating on one spec.

### 🚨 Never weaken a test to make it pass

If a test fails, **fix the app**. A test that was loosened to go green is worse than no test, because it reports safety that does not exist. Specifically banned:

- ❌ `test.skip` / `pytest.mark.skip` to dodge a failure
- ❌ `try/catch` that swallows an assertion
- ❌ `expect(true).toBe(true)` or `expect(x).toBeGreaterThanOrEqual(0)` as filler
- ❌ Widening the console allow-list in `e2e/fixtures.ts` to silence a real error
- ❌ Adding an entry to `KNOWN_HARDCODED_STRINGS` instead of moving the string into `lib/copy.ts`

If a row genuinely cannot be covered, leave it **uncovered with a written reason**. An honest gap beats a green test that proves nothing.

### Rules that keep the suite honest

- ✅ **Import `test`/`expect` from `e2e/fixtures`, never from `@playwright/test`.** The fixture wires the console-error guard; importing directly bypasses it silently.
- ✅ **Assert against the live API response, never a hardcoded score or count.** Ratings change. The invariant is "the UI matches the API".
- ✅ **Guard every loop with a fixture check** (`expect(found).toBeGreaterThan(0)`), so a test cannot pass by iterating over nothing.
- ✅ **Prove a `page.route` interception actually fired** with a hit counter. `/status` renders in a **Server Component**, so its health fetch never crosses the browser and `page.route` cannot see it - a test that intercepts it passes vacuously.
- ✅ E2E runs at **both** 1280x800 and 390x844. Most of this audience is on a phone.
- 🇧🇬 **Never issue a Cyrillic query through a shell.** Build it with `URLSearchParams` inside the test. See the Git Bash gotcha above.

### Why E2E exists at all

Three bugs shipped during the initial build and **all three passed `typecheck`, `lint` AND `build`**: a root `loading.tsx` that turned every `notFound()` into a soft 404, an `Error` instance in the RSC render tree that hung the request for 60s, and `subsets: ["latin"]` that silently dropped Cyrillic to a fallback font. Static gates cannot see any of them. Each now has a named regression test.

Full spec: [`specs/02-test-hardening/`](specs/02-test-hardening/05-results.md).

### 🚨 Match the gate to the change - do NOT run everything by reflex

**CI runs the hermetic gates on every push and PR** (`.github/workflows/ci.yml`):
typecheck, `turbo lint`, ruff, `makemigrations --check`, Vitest and pytest. **Do not
re-run those locally just to feel safe** - push and let the pipeline do it.

What CI *cannot* run is the Playwright E2E suite and the perf budgets: both assert
against the ~1,961 **really ingested** episodes, and the only way to get that corpus is
to scrape YouTube. Faking it with fixtures would make them assert against something
other than the thing they exist to protect. So they stay local - which makes them
expensive, which is exactly why they must be **scoped**:

```bash
# ✅ the specs that touch what you changed, one viewport while iterating
npx playwright test e2e/public-browse.spec.ts --project=desktop

# ❌ 259 tests x 2 viewports for a three-file visual change
npx playwright test
```

Run the **full** suite for: a change to `lib/copy.ts`, routing, `next.config.ts`,
`globals.css` tokens, a shared shell component, or anything touching search. A card
tweak does not qualify.

**Budget the cost honestly.** A full local E2E pass is ~10 minutes, and a production
build is ~40s. A visual tweak deserves: static gates (~1 min) → the relevant spec file
→ look at a screenshot. That is the whole loop.

### 🚨 A local `next dev` on 3000 makes the ENTIRE E2E suite fail

Cost a wasted ~11-minute run on 2026-08-15. The suite's `webServer` block starts its own
dev server on **3100**, and `reuseExistingServer` only reuses something *already
listening on 3100*. But **Next refuses a second dev server for the same directory** - so
with a dev server already up on 3000, the E2E webServer never starts and **every single
test fails**, including `smoke-dev-server-serves-the-home-page`.

- 🔍 **Tell-tale:** the failure count is the whole suite, and `test-results/` fills with
  a directory per test. A real regression fails a handful of related specs, never all of
  them. **When everything fails, suspect the harness, not the app.**
- ✅ **Fix:** point the suite at a server that is already up, rather than letting it
  start one:
  ```bash
  cd apps/web && npx next build && npx next start --port 3200   # once
  E2E_PORT=3200 npx playwright test --reporter=line
  ```
  This is also the production build CLAUDE.md wants for honest signal, and it doubles as
  the benchmark server, so one build serves both.
- ⚠️ The default `list` reporter **buffers all output until the run ends**, so a
  backgrounded run looks hung and its log stays empty. Use `--reporter=line` for
  progress you can actually watch.
- ⚠️ **Never pipe the run through `tail`.** `npx playwright test | tail -40` reports
  **`tail`'s** exit code, so an interrupted or failing run reads as success. Redirect to
  a file (`> run.log 2>&1`), check `$?`, then grep the file.

### 🚨 A third-party script that only exists in production 404s the WHOLE suite

Cost 63 failures on 2026-08-15. `<Analytics />` from `@vercel/analytics` loads
`/_vercel/insights/script.js`, which **Vercel's edge injects and nothing else
serves**. In a local production build that is a hard 404 on every page, the
console guard in `e2e/fixtures.ts` catches it, and 63 tests fail with
`Unexpected browser console errors` - none of them about analytics.

- 🔍 **Tell-tale:** the failures span unrelated specs and every message is the
  console guard. Probe with a 10-line Playwright script that logs `response`
  events over 400 before bisecting your own diff.
- ✅ **Fix:** gate the component on the environment that serves it -
  `{process.env.VERCEL ? <Analytics /> : null}`. `VERCEL` is set in every Vercel
  build and deployment.
- ❌ **Do NOT widen the console allow-list.** The 404 is real; the fix is to not
  request a file that cannot exist.

### 🚨 Never run `next build` while `next start` is serving that build

This manufactured **15 failures in `public-browse.spec.ts`** on 2026-08-15 that had
nothing to do with the code under test. `next start` holds the chunk manifest it booted
with; rebuilding replaces the hashed files on disk underneath it. The running server
then serves HTML referencing chunks that no longer exist:

```
500  /_next/static/chunks/1f_wq8lh506j2.css
404  /_next/static/chunks/0z6mpqwepmrqz.css
```

🔍 **The failures do not look like a CSS problem.** With the stylesheet missing the
grid collapses, cards overlap, and Playwright reports
`<a href="/e/…"> subtree intercepts pointer events` → `locator.click: Test timeout`.
It reads exactly like a z-index or overlay bug in whatever you just changed.

- ✅ **Kill the server, build, then start.** In that order, every time.
- 🔍 **Tell-tale:** `_next/static/chunks/*.css` returning 500 or 404. Probe with a
  10-line Playwright script that logs `response` events over 400 before you start
  bisecting your own diff - it is seconds, and it names the real cause outright.

### ⚠️ Prove "is this failure mine?" with a stash, but only once

A budget or test that fails on a route your diff does not import is usually
pre-existing. Confirm it in one pass rather than reasoning about it:

```bash
git stash push -- <only the files you changed>
npx next build && <re-run the one failing check>     # same number => not yours
git stash pop && npx next build
```

Byte-identical output proves it. **Scope the stash to your files** (not a bare
`git stash`) so unrelated working-tree state is not disturbed, and re-run only the
**one** failing check, not the whole suite.

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
