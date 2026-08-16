# Making a push to `main` deploy the API too

**Date:** 2026-08-16
**Problem:** `git push origin main` deploys the web and nothing else. It has
been that way since launch.

---

## Why the API never deployed

The three Railway services are **already repo-sourced** - this is their live
config, read back on 2026-08-16:

```json
{ "source": { "repo": "TheHero9/comedy-club-community",
              "rootDirectory": "/apps/api" },
  "build":  { "builder": "RAILPACK",
              "watchPatterns": ["apps/api/**"] } }
```

Repo, root directory and watch patterns are all correct. What is missing is the
one thing that is not in the service config at all: **the Railway GitHub App is
not installed on the repo**, so no push webhook is ever delivered and no
deployment is ever created. Not queued, not failed - never created.

That is why the 2026-08-15 incident was so hard to see. Every piece of
configuration you can inspect in Railway looks right.

| Service | Root dir | preDeployCommand | Start command |
| --- | --- | --- | --- |
| `api` | `/apps/api` | `python manage.py migrate --noinput` | (default, gunicorn) |
| `celery-worker` | `/apps/api` | - | `celery -A config worker -l info --concurrency=2` |
| `celery-beat` | `/apps/api` | - | (beat) |

---

## Option A - install the GitHub App (recommended, ~1 minute)

This is what the service config already expects, and it is strictly better than
anything CI can do: no token to rotate, no workflow to maintain, and Railway
handles the `watchPatterns` filtering itself so a docs-only commit does not
rebuild three containers.

1. Railway dashboard → project **comedy-club-community** → service **api**
2. **Settings → Source**, next to the connected repo choose **Configure** /
   reconnect. GitHub prompts to install the **Railway** app.
3. Grant it access to `TheHero9/comedy-club-community`.
4. Repeat if `celery-worker` / `celery-beat` do not pick it up automatically -
   they share the repo, so usually one install covers all three.

**Verify it, do not assume it.** Push a trivial commit touching `apps/api/**`
and confirm a deployment appears whose `commitHash` is that commit. A green
Vercel deploy proves nothing about Railway - that is the whole lesson of
2026-08-15.

🚨 **If you do this, delete `.github/workflows/deploy-api.yml`** or every push
will deploy twice.

---

## Option B - the GitHub Actions workflow (shipped, needs one secret)

`.github/workflows/deploy-api.yml`. Use this if you would rather deploys were
gated on CI than fired by a webhook.

### Setup

1. Railway → project **comedy-club-community** → **Settings → Tokens** → create
   a **project token** scoped to the **production** environment.
2. GitHub → repo **Settings → Secrets and variables → Actions** → new secret
   named `RAILWAY_TOKEN`.
3. Fire it once by hand (**Actions → Deploy API → Run workflow**) before
   relying on it.

🔒 The token is a production deploy credential. It lives in GitHub secrets only
- never in the repo, never in chat. The repo is public.

### What it does, and the three traps it avoids

- **Gated on CI, via `workflow_run`, not `push`.** The api service's
  `preDeployCommand` is `migrate --noinput`, so a deploy is a schema change
  against production Postgres. It must not start until ruff, migration-drift
  and pytest have gone green *on that commit*. It also checks out
  `workflow_run.head_sha` rather than `main`, so a push landing mid-run cannot
  be deployed on the strength of the previous commit's tick.
- **🚨 `railway up`, never `railway redeploy`.** Redeploy re-runs the most
  recent deployment reusing that deployment's build **and its config** - it
  ships the old commit and silently ignores any service-config change made
  since. `up` creates a real new deployment from the checked-out source.
- **🚨 All three services, `api` first and never in parallel.** The worker and
  beat bake code into their own images with no source mount, so leaving them
  behind means old task code running against a new schema - exactly how the
  nightly sync degraded 1,171 rows on 2026-08-13. `api` goes first because it
  is the one that migrates, and beat fires overdue jobs the moment it starts.
- **No `--detach`.** The command waits, so a failed build or a failed migration
  fails the job instead of being reported as a deploy that never served.

### Known cost of Option B

⚠️ `railway up` uploads a **source snapshot**, so the resulting deployment may
carry no `commitHash` in the Railway UI. The usual verification ("`list-deployments`
must show a deployment whose commitHash is your commit") does not apply - verify
by **behaviour** instead, e.g. that a response carries a field only the new code
returns.

⚠️ Every successful CI run on `main` deploys, including commits that touched no
API code. That is deliberate: a path filter that silently skips is the same
class of bug as the missing webhook, and over-deploying costs a rolling restart
while under-deploying costs a schema mismatch.

---

## Either way: what "deployed" means

A created deployment is not a serving one.

```bash
curl -s https://api.comedycommunity.club/api/health
```

and read the deploy log for the `migrate --noinput` output. 🚨 The Railway MCP
agent reports success for config it silently fails to apply - only believe a
read-back.
