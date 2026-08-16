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

## The decision: CI-gated GitHub Actions, not the Railway GitHub App

Both were on the table. The app is one click and needs no token; the workflow
needs a secret and some YAML. **The workflow won anyway**, for one reason:

> This repo has standing authorization to commit straight to `main` with no PR
> and no review, and the api service's `preDeployCommand` is
> `migrate --noinput`.

Put together, the GitHub App means a typo in a model runs an **unreviewed schema
change against production Postgres** seconds after being typed - and
`makemigrations --check`, the gate that exists precisely to catch that, finds
out afterwards. On a repo with PR review that trade is fine. Here there is
nothing between the keyboard and the database.

| | GitHub App | **Actions workflow (chosen)** |
| --- | --- | --- |
| Setup | one click | one secret |
| Runs ruff / pytest / migration-drift first | ❌ | ✅ |
| Skips docs-only commits | ✅ `watchPatterns` | ❌ deploys anyway |
| Deployment carries a commitHash | ✅ | ❌ (upload-sourced) |
| Proves the new code is **serving** | ❌ | ✅ polls `/api/health` |

The two ❌ in the chosen column are real, and the second one mattered enough to
fix rather than accept - see "Verification" below. The first is deliberate: a
path filter that silently skips is the same class of bug as the missing
webhook, and an unnecessary rolling restart is much cheaper than a missed
schema change.

### Rejected alternative, for the record

Installing the app *and* adding branch protection with required status checks
would give gating and a real commitHash. It does not work for a solo developer
pushing directly: required checks run **after** the push, so protection would
reject every push rather than gate the deploy.

---

## ⚠️ Current state: written, NOT armed

`.github/workflows/deploy-api.yml` is `workflow_dispatch`-only. The
`workflow_run` trigger is commented out until the secret exists (owner,
2026-08-16: *"I will look at the automation later"*), so **a push to `main`
still deploys the web only** and the API is deployed by hand.

Arming it is two steps: add the secret below, then uncomment the `workflow_run`
block at the top of the file.

It is commented out rather than left running-and-failing deliberately. A job
that goes red on every push until an unrelated setup step is done does not
communicate "configure me" - it trains you to ignore red, and then hides the
failure that matters.

---

## Setup (one time)

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

---

## Verification: the API reports its own commit

🚨 **`railway up` uploads a source snapshot, so the deployment carries no
`commitHash`.** The project's documented check - "`list-deployments` must show a
deployment whose commitHash is your commit" - simply does not work on this path.

Rather than accept a weaker check, the commit is stamped **into the image** and
the running process reports it:

```bash
curl -s https://api.comedycommunity.club/api/health
# {"status":"ok","database":{...},"redis":{...},"version":"73c700f"}
```

- `apps/api/BUILD_SHA` is a **tracked** file holding the placeholder `dev`. The
  workflow overwrites it with the commit being shipped, just before
  `railway up`. Tracked rather than generated because a gitignored file would
  be left out of the upload.
- `config/version.py` reads it at import, falling back to Railway's own
  `RAILWAY_GIT_COMMIT_SHA` (so this keeps working if the GitHub App is ever
  installed) and then to `""` locally.
- The workflow's last step **polls `/api/health` until it reports the new SHA**,
  for up to ten minutes, and fails if it never does.

That last point is the one that matters. Every incident in this project's
history is a version of *"it reported success and served the old thing"*: the
2026-08-15 phantom deploys, the `redeploy` that silently reused an old config,
the Railway MCP agent reporting success for volumes it never attached. A green
deploy job now means the new code **answered**, not that a container was built.

⚠️ It also means a failed migration fails the workflow loudly. Railway keeps the
old container when a `preDeployCommand` exits non-zero, so `/api/health` would
keep reporting the previous SHA - which is exactly the signal you want.
