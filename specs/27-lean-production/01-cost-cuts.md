# 27 - Lean production: back online for less

**Status:** ✅ Built and deployed 2026-10-30. Owner: *"do the cost cuts"* and *"we are ready
to promote it"*, *"of course we need to make it public"*.

Production was switched off on 2026-10-13 (`specs/10-deployment/03-switched-off.md`)
because it cost ~$26/month to serve AI crawlers. This brings it back with the parts that
cost money and did nothing a reader would notice taken out.

---

## 1. Where the money went (measured 2026-10-13, 7-day average RAM)

| Service | RAM | ~$/month | After this change |
| ------- | --- | -------- | ----------------- |
| Meilisearch | 1.68 GB (0.93 idle, 2.65 for ~10 h after the nightly rebuilds) | ~$17 | ~0.93 GB, no nightly spike |
| celery-worker | 0.33 GB | ~$3 | ❌ not deployed |
| api | 0.26 GB | ~$3 | unchanged |
| Postgres | 0.19 GB | ~$2 | unchanged |
| celery-beat + Redis | 0.09 GB | ~$1 | beat ❌ not deployed, Redis kept |

Estimate: **~$26 → ~$15/month**, by the same October measurements. Not yet measured
after the change - re-read Railway → Usage after a week.

## 2. The cuts

| Cut | How | Why nobody notices |
| --- | --- | ------------------ |
| Nightly full index rebuilds | Removed from `config/celery.py` | Writes index themselves; `sync_new_episodes` and `remove_episodes` index synchronously and check counts; `manage.py reindex` repairs a mismatch |
| Celery worker + Beat | `prod.py`: `CELERY_TASK_ALWAYS_EAGER = True`; `deploy-api.yml` ships `api` only | Every task is milliseconds at this traffic. The services still exist on Railway, stopped |
| Keep-warm moved, not cut | `gunicorn.conf.py` `post_worker_init` → `warm.start_keep_warm_thread`, every `SEARCH_KEEP_WARM_SECONDS` (240) | The 2026-08-18 cold-transcript-index stall stays fixed |
| AI training crawlers | `app/robots.ts` disallows GPTBot, ClaudeBot, CCBot, Bytespider, Meta-ExternalAgent, Amazonbot, Google-Extended, Applebot-Extended | They were essentially all the traffic. AI SEARCH agents and Google stay allowed - being cited is a way to be found |
| Redis | KEPT | It is the shared cache and the write throttle's store; well under $1/month |

### 2.1 🚨 The claim that turned out to be wrong

`services/indexing.py` said an eager `.delay()` of a `retry_backoff` task would retry
inline and stall a request for ~30 s. A first version of this change added a separate
inline code path to avoid that. **Measured on Celery 5.6 it is false:** an eager task
that fails makes ONE attempt and raises `Retry` out of `.delay()`, and the helpers'
existing `except Exception` already swallows it. The extra path was reverted;
`test_lean_production.py` pins the real behaviour (one attempt, nothing reaches the
member) instead of the imagined one.

## 3. Turning it back on (what was actually run)

1. Data services back first: Postgres, Redis, Meilisearch v1.11 - redeploying their
   removed 10-13 deployments, each confirmed `SUCCESS` before the next.
2. Production Postgres held exactly the 10-13 state (1,862 episodes, 8 users, 6 ratings,
   23 moments). The local DB was a strict superset (+21 episodes). A fresh `pg_dump` of
   local was restored into production through a temporary TCP proxy, then the proxy was
   deleted and **verified closed with `pg_isready`** - the delete call's own response
   still said `ACTIVE`, and a raw TCP connect still succeeded at Railway's edge for a few
   seconds afterwards, so neither is proof.
3. API deployed with `preDeployCommand` temporarily set to a reindex (migrations were
   already 39/39), then set back to `migrate --noinput` and read back.
   - ❌ First attempt, `reindex --drop`: episodes 1,883 = 1,883 in 4s, then the transcript
     rebuild died at **37,500 of 64,093** with `MeilisearchTimeoutError ... read timeout=5`.
     Batches slowed from ~2s to 7-20s each as the index grew on Railway's CPU, and one
     answer came late. Nothing served, nothing broken - the deployment simply failed.
   - ✅ Fix: `reindex --timeout` (this command only; readers keep 5s). Second attempt,
     `reindex --only transcripts --drop --timeout 60`: **64,093 = 64,093 in 1,437s**
     (24 minutes, 45 docs/s - the same rebuild takes about a minute on the dev PC).
   - ✅ `/api/health` reported `ac06f4d`, database and Redis ok; the log showed
     `Search keep-warm started: every 240s` once per gunicorn worker (3).
4. Website unpaused (`paused: False` read back) and the blocked `ac06f4d` deployment
   rebuilt for production - while paused, Vercel BLOCKS builds rather than failing them.
5. Smoke test on comedycommunity.club: home, two of the new episodes (titles present),
   `/search?q=пица`, `/channels` all 200; `/e/BADID` and `/channels/does-not-exist` a
   real 404; `robots.txt` lists the blocked training crawlers. Live API: 1,883 episodes,
   search on `meilisearch` (not the fallback), transcript search available.

### 3.1 ⚠️ The GitHub deploy token is dead

`deploy-api.yml` failed with `Invalid RAILWAY_TOKEN` before uploading anything. The API
was deployed with the same `railway up` from the owner's machine instead, with
`BUILD_SHA` stamped by hand, and the workflow is **disabled** again so that every push
does not end in a red deploy run. Re-arming it needs a new PROJECT token
(Railway → comedy-club-community → Settings → Tokens, environment `production`) saved as
the `RAILWAY_TOKEN` repository secret, then `gh workflow enable deploy-api.yml`.

## 4. Production is the master copy again

From 2026-10-30 the local database is only a dev copy. `/sync-episodes` now runs
`sync_new_episodes` on the PC (the home IP is the one YouTube tolerates for yt-dlp)
against PRODUCTION through two temporary endpoints - a TCP proxy for Postgres with
`sslmode=require`, and a generated HTTPS domain for Meilisearch so its master key never
crosses the internet in clear text - via `apps/api/scripts/with-prod.sh`, then closes
both and verifies they are closed.

## 5. How we will know if people come

Vercel Web Analytics is enabled on the project and counts browsers, not bots: 1 to 13
October recorded **1 visitor, 1 page view** against ~5,000 bot API calls a day. ⚠️ The
Hobby plan keeps only the **last 31 days**, so read it at least monthly if the history
matters. Sign-ups are in the Clerk dashboard; ratings, watch log and moments in the
database are the honest engagement signal (bots do not rate episodes).
