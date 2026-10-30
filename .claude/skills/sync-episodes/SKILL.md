---
name: sync-episodes
description: Pull every new episode uploaded on the supported YouTube channels into the LIVE app - metadata, members-only flag, transcript and search - by running `manage.py sync_new_episodes` from this PC against production, asking the owner about short videos (possible promo clips) before adding them. Use when asked to get/sync/update new episodes or videos, or when the catalogue looks out of date.
---

# Syncing new episodes

One command does the whole job: `manage.py sync_new_episodes` (spec
`specs/26-new-episode-pipeline/02-implementation-plan.md`). This skill runs it **on this
PC against PRODUCTION**, and passes the owner's answers about short videos, which the
command cannot ask for itself when Claude runs it (no terminal).

🚨 **The two rules on this page:**

1. **Never decide about a short video for the owner.** Every one of the 100 promo clips
   removed on 2026-08-15 was under 12 minutes, but so are some real episodes (a 1:45
   news bulletin was real). Short ones are ASKED about. Never pass `--yes`.
2. **Every temporary endpoint you open, you close and VERIFY closed - even when the run
   failed.** Step 5 is not optional.

ℹ️ **Why from the PC, against production.** Production is live and is the master copy
since 2026-10-30 (`specs/27-lean-production/01-cost-cuts.md`); the local database is only
a dev copy now. But `sync_new_episodes` needs yt-dlp, and the home IP is the only one
proven to get full answers from YouTube. So the command runs here and talks to production
through two temporary endpoints. Docker is NOT needed.

## Railway ids

| | id |
| - | - |
| project `comedy-club-community` | `a0f31f6f-5de3-40f0-ac87-4d644755441b` |
| environment `production` | `72780376-4122-4aeb-a598-83db2010c84a` |
| service `Postgres` | `3941e5f2-7074-4a3e-b6c3-078acbe51b64` |
| service `Meilisearch` | `728f96a0-5c8b-4ec7-9115-d2e01f0466a0` |

---

## Step 1 - Logged in?

```bash
railway whoami
```

If it says `Unauthorized`, ask the owner to run `! railway login` and wait.

## Step 2 - Open the two temporary endpoints

**First look**, so you never delete something that was there before you: `list-tcp-proxies`
on Postgres and `list-domains` on Meilisearch should both be empty. If either is not,
stop and tell the owner rather than reuse or delete it.

Then, with the Railway MCP tools:

1. `create-tcp-proxy` on **Postgres**, `applicationPort: 5432`. Read the endpoint back
   with `list-tcp-proxies` (e.g. `xxx.proxy.rlwy.net:12345`) and wait for `ACTIVE`.
2. `generate-domain` on **Meilisearch**, `targetPort: 7700`. It returns
   `https://<something>.up.railway.app`. 🔒 Always this HTTPS domain, never a TCP proxy
   for Meilisearch: the master key would cross the internet unencrypted.

Wait until both answer (a new domain can take a minute):

```bash
curl -s https://<meili-domain>/health                 # {"status":"available"}
"/c/Program Files/PostgreSQL/18/bin/pg_isready.exe" -h <pg-host> -p <pg-port>   # accepting connections
```

## Step 3 - Dry run (writes nothing)

From the repo root. `with-prod.sh` reads the passwords from Railway at run time and never
prints them.

```bash
bash apps/api/scripts/with-prod.sh <pg-host:port> https://<meili-domain> \
  sync_new_episodes --dry-run 2>&1 | grep -v "^INFO"
```

The marker in front of each new video:

| Marker | Meaning | What to do |
| ------ | ------- | ---------- |
| (none) | 15 min or longer | added automatically |
| `?` | shorter than 15 min - maybe a promo clip | **ask the owner** |
| `~` | scheduled premiere or live right now | nothing; a later run adds it once it has aired |

- **0 new videos:** tell the owner nothing new was uploaded and go to **Step 5**.
- ⚠️ **"every one of the newest 50 on the X tab is new"**: add `--limit 200` to both runs.
- ℹ️ Two stale `~` streams (2024 and 2025 "upcoming" streams that never aired) show up
  on every run. Expected; ignore them.

**Ask about every `?` video** with AskUserQuestion, one question per video (up to 4 per
call). Put the channel, duration, title and `https://www.youtube.com/watch?v=<id>` in the
question. Options: **Add it** (→ `--add`), **Never (promo clip)** (→ `--exclude`, onto
the exclusion list for good), **Later** (pass neither; the next run asks again).

## Step 4 - The real run

Redirect to a log and check the exit code. ❌ Never pipe the run through `tail`: that
reports `tail`'s exit code, so a failed check reads as success.

```bash
bash apps/api/scripts/with-prod.sh <pg-host:port> https://<meili-domain> \
  sync_new_episodes --add <ids> --exclude <ids> > tmp/sync-new-episodes.log 2>&1; echo "exit=$?"
grep -v "^INFO" tmp/sync-new-episodes.log | sed -n '/Writing episodes/,$p'
```

Omit `--add` / `--exclude` when empty. About 5-10 seconds per new episode: one serial
yt-dlp request each, on purpose (speed is what gets this IP blocked).

## Step 5 - Close both endpoints and PROVE they are closed

Always, also after a failure or a 0-new dry run:

1. `delete-tcp-proxy` on Postgres (`applicationPort: 5432`) and `delete-domain` on
   Meilisearch (the generated domain).
2. 🚨 **Do not trust the delete call's answer.** On 2026-10-30 it still said `ACTIVE`,
   and a raw TCP connect still succeeded at Railway's edge for several seconds after.
   Verify the way that cannot lie:

```bash
"/c/Program Files/PostgreSQL/18/bin/pg_isready.exe" -h <pg-host> -p <pg-port> -t 8   # must say "no response"
curl -s -o /dev/null -w "%{http_code}\n" --max-time 10 https://<meili-domain>/health  # must NOT be 200
```

   Re-check after ~30 seconds if either still answers. `list-tcp-proxies` and
   `list-domains` must both come back empty.

## Step 6 - Report to the owner

From the output, not assumptions:

- **New episodes per channel**: the `N created` in each "Writing episodes" line
- **Transcripts stored**, and the **throttled** count
- **Held for later**: the `~` streams plus any short ones answered "Later"
- **Checks**: all four lines must say `ok`
- That both temporary endpoints are verified closed

| Situation | Meaning | Action |
| --------- | ------- | ------ |
| `exit=0`, all checks `ok` | done, live on comedycommunity.club | report it |
| Throttled > 0 | YouTube rate-limited some requests; nothing written for those | the next run retries them. ❌ Do not re-run now - the block lasts hours |
| `no captions yet (fresh)` > 0 | uploaded under 7 days ago, no captions yet | nothing; a later run fetches them |
| `exit=1` / a `FAIL` line | NOT complete | show the FAIL line. An index mismatch: `with-prod.sh ... reindex`, then re-check |

Do not start topic labelling on your own (the owner declined it on 2026-10-30); mention
the "Next: ... no topic labels" line only if asked.

## Step 7 - Keep the exclusion list

If the owner answered "Never" for any video, `apps/api/podcast/data/removed-episodes.txt`
changed. Commit and push it (standing authorization; the repo is public - audit the diff):

```bash
git add apps/api/podcast/data/removed-episodes.txt
git commit -m "chore(ingestion): exclude N promo clips found by sync_new_episodes"
git push
```
