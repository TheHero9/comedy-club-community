# 🚀 Production Deployment - comedycommunity.club

**Deployed:** 2026-08-15 (infra created 2026-08-13)
**Status:** LIVE. Final smoke test: 13/13 passed. Wave 8 (Clerk auth) completed the same
day: email + Google sign-in verified working end to end by the owner on the live site.

## Topology

| Piece | Where | URL / ID |
| ----- | ----- | -------- |
| Next.js web | Vercel (`comedy-club-community`, prj_jm63VAtF9Wv2KqVeJABkgLVoeKtp) | https://comedycommunity.club (+ www) |
| Django API | Railway service `api` | https://api.comedycommunity.club (custom) + api-production-3a93f.up.railway.app |
| Celery worker | Railway `celery-worker` | `celery -A config worker -l info --concurrency=2` |
| Celery beat | Railway `celery-beat` | `celery -A config beat -l info` |
| Postgres 18 | Railway template, volume | private only: `postgres.railway.internal` |
| Redis | Railway template, volume | private only: `redis.railway.internal` (cache db /0, broker db /1) |
| Meilisearch **v1.11** | Railway, image-pinned, volume `meilisearch-data` at `/meili_data` | private only: `meilisearch.railway.internal:7700` |

Railway project: `comedy-club-community` (a0f31f6f-5de3-40f0-ac87-4d644755441b), environment `production`.
DNS at Porkbun: A `@` -> 76.76.21.21 (Vercel), CNAME `www` -> cname.vercel-dns.com,
CNAME `api` -> n0vc9v9i.up.railway.app (+ Railway TXT validation record), 5 Clerk CNAMEs
(`clerk`, `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey`).

Auth: Clerk **production** instance on comedycommunity.club (`CLERK_ISSUER=https://clerk.comedycommunity.club`).
Deploys: pushes to `main` auto-deploy all three Django services (Railway GitHub App) and the web (Vercel GitHub App).
The web build prerenders against the live API, so **the API must be up for `vercel deploy` to succeed**.

## 🚨 Six deployment gotchas (each cost real time on 2026-08-13/15)

1. **`gunicorn` was never a dependency.** The Dockerfile CMD referenced it, but local dev always ran
   `runserver` and Docker only ever ran Celery, so the web CMD path had never executed anywhere.
   Railway failed `CREATE_CONTAINER` with "The executable gunicorn could not be found" - the error was
   literal truth, not a platform bug. Fixed in `f8d53bc`.
2. **Meilisearch version MUST match local (`v1.11`, same as docker-compose).** Railway's agent deployed
   v1.42 and typo tolerance silently vanished: exact queries matched, `еврвизия` returned 0. Every
   byte-threshold rule in CLAUDE.md § Search encodes v1.11 semantics. A version bump is a deliberate
   local+prod lockstep change with the typo sweep re-run, never a hosting-side default.
3. **The Railway agent reports success for config it silently fails to apply.** The Meilisearch volume
   "attached" twice without attaching (`hasVolume:false`); the custom-domain target port "set" without
   being set (`targetPort:null`, manifesting as edge 502 with a green cert). Only believe a read-back:
   `get-service-config` showing the mount / `list-domains` showing the port. The volume finally stuck
   when created as a first-class volume resource; the port was set by hand in the dashboard.
4. **A Railway custom domain needs the CNAME AND a TXT validation record.** The cert sat in
   VALIDATING_OWNERSHIP ~40 min on a fully propagated CNAME until the TXT (shown under
   "Show DNS records" in the dashboard) was added. Port 8000 must also be set on the custom domain
   explicitly - it does not inherit from the service domain.
5. **"Backend switched to meilisearch" is NOT "reindex done".** The index exists (no 404) long before
   documents land, and the Postgres fallback masks emptiness. Two reindexes were killed mid-flight by
   redeploys before this was respected. A reindex closes the same way a backfill does - on counts:
   prod and local answering identical totals for the same queries (`пица` 23/23, `еврвизия` 7/7).
6. **Railway start-command parsing broke on a 3-part `sh -c` chain.** `sh -c "reindex && celery"` ran;
   adding `&& echo MARKER` in the middle made the whole chain silently skip to Celery in 2s with zero
   reindex output. Keep chained start commands to the exact shape that has been proven, and verify by
   log output, not exit status.

## Auth completion (same day, after launch)

The sign-in button was still the Wave 8 stub at launch. Completed in `408754f`:

- `@clerk/nextjs` v7 (Core 3: `appearance.theme`, not `baseTheme`), `bgBG` localization,
  dark theme. `proxy.ts` (Next 16's renamed middleware) runs the session handshake with a
  keyless pass-through so CI never needs Clerk.
- `ViewerAuthProvider` bridges Clerk state into an app-owned context; keyless builds get a
  Dev bridge instead of a ClerkProvider, keeping the 958-test suite byte-identical.
  Proven: full Playwright suite (368) green against a keyless production build.
- **Google OAuth**: a production Clerk instance cloned from dev ships the Google button
  enabled but broken ("Error 400: missing required parameter: client_id") - production
  instances do not inherit Clerk's shared dev credentials. Fixed with a dedicated Google
  Cloud project (`comedy-club`) OAuth web client, redirect URI from Clerk's
  "use custom credentials" panel, consent screen published, credentials pasted into Clerk.
- Perf note: `web:search-broad` was already over budget before this change (transcript
  coverage grew 3 -> 579 episodes since the budget was measured); waived at 200 KB as a
  ratchet in `scripts/perf-budgets.json`.

## Operational notes

- One-off admin commands (reindex, repair_metadata) run by temporarily setting the worker's
  startCommand to `sh -c "python manage.py <cmd> && celery -A config worker -l info --concurrency=2"`
  and redeploying, then reverting. Railway MCP has no exec.
- Postgres restores: enable the TCP proxy on the Postgres service, `pg_restore` from the machine with
  the dump (`--clean --if-exists --no-owner --no-privileges`, db name `railway`), then **disable the
  proxy again** - the DB must stay private-only.
- `.vercelignore` exists because the monorepo upload otherwise includes the Python venv and the 1.1 GB
  `.next` dev cache and blows Vercel's 100 MB file limit. `**/.next` did not match; explicit paths do.
- Verification screenshots / R2 signed URLs are still deferred (`NEXT_TIME.md` § Security) - the
  membership-verification upload flow should stay unused until that lands.
