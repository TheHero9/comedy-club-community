---
name: sync-episodes
description: Pull every new episode uploaded on the supported YouTube channels into the app - metadata, members-only flag, transcript and search - with `manage.py sync_new_episodes`, asking the owner about short videos (possible promo clips) before adding them. Use when asked to get/sync/update new episodes or videos, or when the catalogue looks out of date.
---

# Syncing new episodes

One command does the whole job: `manage.py sync_new_episodes` (built 2026-10-30, spec
`specs/26-new-episode-pipeline/02-implementation-plan.md`). This skill wraps it so the
owner's answers about short videos reach it, because the command cannot prompt when
Claude runs it - there is no terminal.

🚨 **The single most important rule on this page:** never decide about a short video
for the owner. Every one of the 100 promo clips removed on 2026-08-15 was under 12
minutes, but so are some real episodes (a 1:45 news bulletin was real). Short ones
are ASKED about. Never pass `--yes` - it adds every short video unasked.

ℹ️ Production is switched off (`specs/10-deployment/03-switched-off.md`). This writes to
the LOCAL database, which is the master copy until production comes back. Nothing
goes live from here.

---

## Step 1 - Docker up

The command needs Postgres and Meilisearch; it does NOT need the API or web server.

```bash
docker info > /dev/null 2>&1 && echo up || echo down
```

If it is down, start Docker Desktop (PowerShell) and wait until `docker info` answers:

```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Then, from the repo root, start the infra and wait for `(healthy)` on all three:

```bash
docker compose up -d
docker compose ps --format "{{.Name}} {{.Status}}"
```

## Step 2 - Dry run (writes nothing)

```bash
cd apps/api && uv run python manage.py sync_new_episodes --dry-run 2>&1 | grep -v "^INFO"
```

Read each channel's block. The marker in front of a new video:

| Marker | Meaning | What to do |
| ------ | ------- | ---------- |
| (none) | 15 min or longer | added automatically |
| `?` | shorter than 15 min - maybe a promo clip | **ask the owner (Step 3)** |
| `~` | scheduled premiere or live right now | nothing; a later run adds it once it has aired |

- **0 new videos:** tell the owner nothing new was uploaded and stop.
- ⚠️ **"every one of the newest 50 on the X tab is new"**: there may be more beyond the
  window. Add `--limit 200` to both the dry run and the real run.
- ℹ️ Two stale `~` streams (2024 and 2025 "upcoming" streams that never aired) show up
  on every run. That is expected; ignore them.

## Step 3 - Ask about every `?` video

Use AskUserQuestion, one question per short video (up to 4 per call; call again for
more). Put the channel, duration, title and `https://www.youtube.com/watch?v=<id>` in
the question so the owner can check it. Options:

- **Add it** - a real episode → goes into `--add`
- **Never (promo clip)** - goes into `--exclude`, onto the exclusion list for good
- **Later** - pass neither flag; the command holds it and the next run asks again

If there are no `?` videos, skip straight to Step 4 with no flags.

## Step 4 - The real run

Redirect to a log file and check the exit code. ❌ Never pipe the run through `tail`:
that reports `tail`'s exit code, so a failed check reads as success.

```bash
cd apps/api && uv run python manage.py sync_new_episodes --add <ids> --exclude <ids> \
  > ../../tmp/sync-new-episodes.log 2>&1; echo "exit=$?"
grep -v "^INFO" ../../tmp/sync-new-episodes.log | sed -n '/Writing episodes/,$p'
```

Omit `--add` / `--exclude` when they would be empty. It takes about 5 seconds per new
episode: one serial yt-dlp request each, on purpose (speed is what gets this IP blocked).

## Step 5 - Report to the owner

Use the output, not assumptions:

- **New episodes per channel**: the `N created` in each "Writing episodes" line
- **Transcripts stored**, and the **throttled** count
- **Held for later**: the `~` streams plus any short ones answered "Later"
- **Checks**: all four lines must say `ok`

| Situation | Meaning | Action |
| --------- | ------- | ------ |
| `exit=0`, all checks `ok` | done | report it |
| Throttled > 0 | YouTube rate-limited some caption or metadata requests. Nothing was written for those; they stay pending | tell the owner the next run retries them. ❌ Do not re-run now - the block lasts hours |
| `no captions yet (fresh)` > 0 | uploaded under 7 days ago, YouTube has not made captions yet | nothing; a later run fetches them |
| `exit=1` / a `FAIL` line | the run is NOT complete | show the FAIL line. An index mismatch is fixed with `uv run python manage.py reindex`, then re-check the counts |

The run also prints a "Next: N episode(s) have a transcript and no topic labels" line.
❌ Do not start topic labelling on your own - the owner declined it on 2026-10-30. Only
mention it if asked.

## Step 6 - Keep the exclusion list

If the owner answered "Never" for any video, `apps/api/podcast/data/removed-episodes.txt`
changed. That file is the record of what must never come back, so commit and push it
(standing authorization in this repo; the repo is public - audit the diff first):

```bash
git add apps/api/podcast/data/removed-episodes.txt
git commit -m "chore(ingestion): exclude N promo clips found by sync_new_episodes"
git push
```

Nothing else changes in git: the episodes live in the local database, not in the repo.
