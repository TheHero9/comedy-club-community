---
name: start-local
description: Start the whole app locally - Docker infra (Postgres/Redis/Meilisearch), the Django API and the Next.js web server - and verify it actually serves real data. Use when asked to run/start the app, boot the dev environment, or when the site is behaving oddly and you need a clean restart.
---

# Starting the app locally

Three tiers, in order: **infra -> API -> web**. Each one is verified by a request, not
by "the command didn't error".

🚨 **The single most important rule on this page:** a dev server that is *running* is
not necessarily *working*. A long-lived `next dev` process degrades into a state where
every `notFound()` route answers **500** instead of 404, and the pages that still work
look completely fine. Always finish with the 404 check in Step 4.

---

## Step 0 - Is any of it already up?

Never blindly launch. Two of the three tiers survive across sessions (Docker restarts
itself, and `next dev` can sit there for days), so check first:

```bash
docker compose ps --format "table {{.Name}}\t{{.Status}}"
curl -s -o /dev/null -w "api:%{http_code}\n"  http://127.0.0.1:8000/api/health
curl -s -o /dev/null -w "web:%{http_code}\n"  http://127.0.0.1:3000
```

⚠️ **A 200 on port 3000 does not prove it is *this* app.** Another project on this
machine also wants 3000, which is why `next dev` sometimes falls forward to 3001. When
Next refuses to start it prints the incumbent's identity - read the `Dir:` line:

```
⨯ Another next dev server is already running.
- PID:  28832
- Dir:  C:\Users\dimib\Desktop\comedy-club-community\apps\web   <- ours
```

If `Dir` is this repo, the app is already served on that port; do not start a second
one. If `Dir` is some other project, ours is the one on 3001. Either way, **read the
port out of the server output** rather than assuming 3000.

---

## Step 1 - Infra

```bash
docker compose up -d
```

Postgres, Redis and Meilisearch. Wait for all three to report `(healthy)` - the API's
health endpoint will report `database.ok: false` if you race it.

Celery is **deliberately excluded** from the default `up`: dev runs
`CELERY_TASK_ALWAYS_EAGER=True`, so tasks execute inline and no worker is needed to
develop. Only start it when you are specifically exercising the queue:

```bash
docker compose --profile workers up -d
```

🚨 **Worker containers run code baked into their image, not the working tree.** There
is no source mount. After any change under `apps/api/` that a task touches:

```bash
docker compose --profile workers build worker beat
docker compose --profile workers up -d worker beat
```

And remember Beat fires overdue jobs (like the daily sync) **immediately on container
start** - starting the workers profile is not a neutral act.

---

## Step 2 - API

```bash
cd apps/api
uv run python manage.py runserver 127.0.0.1:8000
```

🚨 **Bind `127.0.0.1` explicitly, not `localhost`.** `runserver` is IPv4-only but
`localhost` resolves to `::1` first on this machine. Node's `fetch` races both families
and looks fine; Python's `http.client` and Playwright's request context do **not** and
fail with `ECONNREFUSED ::1:8000`, or stall ~2.1s per request. A "slow API" on this box
is almost always this, not the query.

Verify - and read the body, not just the status:

```bash
curl -s http://127.0.0.1:8000/api/health
# {"status":"ok","database":{"ok":true,...},"redis":{"ok":true,...}}
```

A 200 with `"ok":false` inside means infra is not actually ready. Go back to Step 1.

---

## Step 3 - Web

```bash
cd apps/web
npm run dev
```

The `dev` script sets `NODE_OPTIONS=--max-old-space-size=4096` via `cross-env`. **Do
not bypass it** by running `next dev` directly - the 1,318-episode channel page
exhausts the default Node heap in dev mode and takes the entire dev server down with
it, after which every unrelated route also fails to connect.

Read the actual port from the output (`- Local: http://localhost:PORT`).

---

## Step 4 - Verify, including the 404s

Static routes only prove the server compiles. The routes that matter are the ones that
are supposed to **fail**:

```bash
for p in / /channels /episodes /search /status; do
  echo -n "$p -> "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000$p"
done

echo "--- these MUST be 404 ---"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/e/BADID
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/channels/does-not-exist
```

🚨 **If those two answer 500 while the normal pages answer 200, the dev server is a
zombie - restart it.** Confirm by reading its own log:

```bash
tail -20 apps/web/.next/dev/logs/next-development.log
```

`Jest worker encountered 2 child process exceptions, exceeding retry limit` and
repeating `write EPIPE` mean the render workers are dead. The process still accepts
connections, so nothing looks obviously broken from outside. The fix is a restart, not
debugging the route:

```bash
taskkill //PID <pid> //F      # Git Bash needs the doubled slashes
cd apps/web && npm run dev
```

Observed 2026-08-15: a dev server left up ~45 hours served `/` and `/channels` as 200
while `/e/BADID` and `/channels/does-not-exist` both returned 500. A fresh start
returned all five 200s and both 404s correctly, with no code change. On a site whose
whole value is being indexable, that is the failure worth catching.

---

## Step 5 - Drive it with real Bulgarian data

Status codes do not prove the data path. Hit the real corpus:

```bash
cd apps/api
PYTHONIOENCODING=utf-8 uv run python - <<'PY'
import json, urllib.parse, urllib.request
def get(u): return json.load(urllib.request.urlopen(u))

eps = get("http://127.0.0.1:8000/api/episodes?limit=3")
for e in eps["items"]:
    print(" ", e["youtube_id"], "|", e["title"][:60])

q = "ергена"                      # fills a page; a rare word measures nothing
s = get("http://127.0.0.1:8000/api/search?" + urllib.parse.urlencode({"q": q}, encoding="utf-8"))
t = get("http://127.0.0.1:8000/api/search/transcripts?" + urllib.parse.urlencode({"q": q}, encoding="utf-8"))
print("labelled:", s["total"], "| spoken:", t["total_segments"])
PY
```

⚠️ **The two search endpoints report their counts under different keys** - `total` for
episodes, `total_segments` for transcripts. Reading `total` off the transcript response
yields `None` and looks exactly like "transcript search is broken".

🚨 **Never issue a Cyrillic query through Git Bash `curl`.** The shell mangles non-ASCII
arguments to `?` before `curl.exe` sees them; `?` is a Meilisearch separator, so the
query tokenizes to nothing, becomes an empty search, and returns **the entire
catalogue**. It looks precisely like a catastrophic relevance bug. Use Python (as
above), or percent-encode the URL yourself:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://127.0.0.1:3000/search?q=%D0%B5%D1%80%D0%B3%D0%B5%D0%BD%D0%B0"   # ергена
```

Then confirm the search page rendered **both** halves - label matches and spoken
matches are separate regions from separate indexes, and the page shipped broken for
8 months by querying only the first:

```bash
curl -s "http://127.0.0.1:3000/search?q=%D0%B5%D1%80%D0%B3%D0%B5%D0%BD%D0%B0" -o /tmp/s.html
grep -oE 'data-testid="results-(labelled|spoken)"' /tmp/s.html | sort | uniq -c
grep -oE 'href="/e/[A-Za-z0-9_-]+' /tmp/s.html | sort -u | wc -l
```

⚠️ `grep -c` counts matching **lines**, and the rendered HTML is effectively one line -
it will report `1` no matter how many results there are. Use `grep -o | wc -l`.

---

## Ports on this machine

| Service | Port | Note |
| ------- | ---- | ---- |
| Web (Next) | 3000 | falls forward to 3001 if another project holds it |
| API (Django) | 8000 | bind `127.0.0.1`, never `localhost` |
| Postgres | **54320** | 5432/5433 belong to two native Windows Postgres services |
| Redis | 6379 | |
| Meilisearch | 7700 | |

🚨 **Never "fix" a Postgres auth error by changing the password.** Publishing the
container on 5432 appears to succeed, but host connections silently reach the *native*
server and fail with `password authentication failed for user "postgres"`. Check
`Get-NetTCPConnection -LocalPort 5432` first. `POSTGRES_PORT=54320` in the root `.env`
is the fix, and it is already set.

---

## Shutting down

```bash
# stop the two foreground servers with Ctrl-C, then:
docker compose down          # keeps volumes / data
docker compose down -v       # 🚨 DESTROYS the DB, the corpus and the search indexes
```

`down -v` throws away 1,961 extracted episodes and 61,452 transcript segments -
re-ingesting is hours of work and risks a fresh YouTube soft-block. Never run it to
"clean up".
