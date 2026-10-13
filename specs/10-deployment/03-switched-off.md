# ⏸️ Production is SWITCHED OFF (2026-10-13)

> Owner decision, 2026-10-13: *"switch it off for now"*. Nothing was deleted.
> Every service, its config, its variables, its domains and all three volumes are
> still in the Railway project. Only the running deployments were removed.

## 🔍 Why

Railway bills RAM held 24/7, not traffic. The comedy project cost **~$26/month**
while serving nobody:

| Service | Avg RAM (7 days) | ~$/month |
| ------- | ---------------- | -------- |
| Meilisearch | 1.68 GB (0.93 idle, 2.65 after the 05:00/05:30 nightly reindex) | ~$17 |
| celery-worker | 0.33 GB | ~$3 |
| api | 0.26 GB | ~$3 |
| Postgres | 0.19 GB | ~$2 |
| celery-beat + Redis | 0.09 GB | ~$1 |

- **Zero real users in the week measured**: no `/api/me` call, no successful write.
- The ~5,000 API calls a day were the Next.js server rendering pages for **AI crawlers**
  (GPTBot, ClaudeBot, Bytespider, Meta, Amazonbot, CCBot, DuckAssist), plus scanners
  probing `/.env` and `/.ssh/id_ed25519`, all of which got 404s.
- ❌ **Railway's serverless sleep cannot help this stack as built.** A service sleeps only
  after 5-10 min with no outbound packets, and here nothing is ever quiet: the Celery
  worker holds a permanent Redis connection, Beat warms Meilisearch every 4 minutes
  (deliberately, see `specs/20-search-index-warmth/`), and crawlers render a page every
  ~1.5 minutes.
- ❌ **"Off during certain hours" was rejected**: Railway has no schedule for services, so it
  would take a daily scripted stop/start of 6 services in strict order. That is the
  deploy path every past incident here came from, and it would have saved ~$8/month.

## 🛑 What was done

| Step | How | State |
| ---- | --- | ----- |
| Backup | `pg_dump -Fc --no-owner --no-privileges` over a temporary TCP proxy | ✅ Row counts matched prod exactly: 7 channels, 1,862 episodes, 1,861 transcripts, 61,333 segments, 23 moments, 6 ratings, 6 profiles, 8 users, 39 migrations |
| Proxy | Deleted right after the dump | ✅ `list-tcp-proxies` empty |
| Website | Vercel project **paused** (`/v1/projects/{id}/pause`) | ✅ `comedycommunity.club` + `www` answer **503** |
| Auto-deploy | `gh workflow disable deploy-api.yml` | ✅ `disabled_manually`, so a push to `main` cannot half-start the API |
| Railway | `railway down -s <svc> -y` for beat, worker, api, Meilisearch, Redis, Postgres | ✅ All 6 **Offline**, volumes attached |

🔒 **The backup is NOT in the repo** (the repo is public). It lives on the owner's machine,
outside the working tree. It holds real accounts (emails, Clerk ids), so it never gets
committed or uploaded anywhere public.

⚠️ **While off, a push to `main` still triggers a Vercel build, and that build FAILS**,
because it prerenders against the live API. This is harmless (a failed build never
replaces the current deployment, and the project is paused anyway), but do not chase
it as a bug.

## ▶️ Turning it back ON (in this order, never in parallel)

1. **Data services first: Postgres, then Redis, then Meilisearch.** These are image
   services (`postgres-ssl:18`, `redis:8.2`, `meilisearch:v1.11`) and their volumes are
   still mounted, so the data comes straight back. In the dashboard: service →
   Deployments → the REMOVED deployment → ⋮ → **Redeploy**. Removed deployment ids:
   - Postgres `9dc57536-6bbc-44e3-a041-fbf0a9ce2d06`
   - Redis `fc3807a0-6645-454c-b89f-f77d7c8a787b`
   - Meilisearch `92da3021-3674-47e5-bb7a-be4fa6281406`

   Wait for each to show **Online** before the next.
2. **App services through the workflow, NOT a dashboard redeploy.** A redeploy reuses the
   old build AND old config (see CLAUDE.md § Production). The workflow runs `railway up`
   for api (which runs `migrate`) → celery-worker → celery-beat, then polls
   `/api/health` until it reports the shipped SHA:
   ```bash
   gh workflow enable deploy-api.yml -R TheHero9/comedy-club-community
   gh workflow run deploy-api.yml -R TheHero9/comedy-club-community --ref main
   gh run watch -R TheHero9/comedy-club-community
   ```
3. **Verify on COUNTS, not on green.** `curl -s https://api.comedycommunity.club/api/health`
   reports the SHA; then from Python (never curl from Git Bash for Cyrillic) check that
   `/api/episodes` totals **1,862** and that `пица` and a transcript query return hits.
   If either index is empty: arm `reindex` as a one-off `preDeployCommand` (CLAUDE.md
   § Production) and re-check counts.
4. **Unpause the website**, then curl it for a 200:
   ```bash
   echo '{}' > /tmp/empty.json
   vercel api "/v1/projects/prj_jm63VAtF9Wv2KqVeJABkgLVoeKtp/unpause?teamId=team_BZcIIjcRu8XFuaVuJ8oMtqwE" --method POST --input /tmp/empty.json
   ```
   If the last production build predates later commits, push or redeploy the web after the
   API is up (its build needs the live API).

### 🆘 If a volume did not survive

Restore the dump through a temporary TCP proxy, then close the proxy:
```bash
pg_restore --clean --if-exists --no-owner --no-privileges -d "<public postgres url>" comedy-prod-2026-10-13.dump
```
then rebuild both search indexes from Postgres (`manage.py reindex`, as a one-off
`preDeployCommand`). Postgres is the source of truth; Meilisearch and Redis hold nothing
that cannot be rebuilt.

## 💡 If it comes back, cheaper than before

- Run the two full search rebuilds **weekly**, not nightly. Measured 2026-10-13: Meilisearch
  idles at 0.93 GB and each rebuild lifts it to 2.65 GB for ~10 hours, which is ~$5/month
  for re-indexing content that does not change.
- Consider blocking AI crawlers at the Vercel firewall. They were essentially the whole
  traffic, and every page they render costs a Vercel function run plus 5-6 API calls.
