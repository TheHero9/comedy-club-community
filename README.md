# 🎙️ Comedy Club Community

A searchable community hub for a group of Bulgarian YouTube podcast channels. Browse every episode across all channels, rate them 1-10, log what you have watched, label what happened, and find things YouTube's own search cannot.

- 📖 **Rules and architecture:** [`CLAUDE.md`](CLAUDE.md)
- 🌊 **Build plan:** [`specs/01-initial-build/01-waves.md`](specs/01-initial-build/01-waves.md)
- 📊 **Where we are:** [`docs/STATUS.md`](docs/STATUS.md)

---

## ⚡ Local start

Prerequisites: **Docker**, **Node 20+**, **Python 3.12+**, **[uv](https://docs.astral.sh/uv/)**.

```bash
# 1. Infrastructure (Postgres + Redis + Meilisearch)
cp .env.example .env
docker compose up -d

# 2. API
cd apps/api
cp .env.example .env
uv sync
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver
```

| URL | What |
| --- | ---- |
| http://localhost:8000/api/health | Health check (DB + Redis) |
| http://localhost:8000/api/docs | OpenAPI browser |
| http://localhost:8000/admin/ | Django Admin |

---

## 📥 Ingesting a channel

```bash
cd apps/api
uv run python manage.py backfill_channel @ivankirkov1              # full backfill
uv run python manage.py backfill_channel @ivankirkov1 --limit 5    # quick sample
uv run python manage.py backfill_channel @ivankirkov1 --dry-run    # no writes
```

Ingests the `videos` and `streams` tabs only. **Shorts are deliberately never ingested.** Re-running is idempotent (`update_or_create` on `youtube_id`), so an interrupted run costs nothing.

---

## 🏗️ Layout

```
apps/api/          Django + Django-Ninja. Owns the DB, the admin, ingestion, jobs.
apps/web/          Next.js App Router. Talks to the API only.
packages/          Shared TS packages (generated API types).
docs/              Brief, schema decisions, STATUS.
specs/             Feature specs, numbered.
tools/             Research spikes (the yt-dlp metadata probe).
```

**Boundary:** Next.js never touches Postgres, Redis or Meilisearch. Everything goes through the API. That is what keeps a future mobile app free.

---

## 🧰 Common commands

```bash
# Infra
npm run infra:up            # docker compose up -d
npm run infra:down          # stop
npm run infra:nuke          # stop AND delete volumes (destroys local data)

# API (from apps/api)
uv run python manage.py runserver
uv run python manage.py makemigrations     # NEVER hand-write migrations
uv run python manage.py migrate
uv run pytest

# Web (from repo root)
npm run dev
npm run typecheck
npm run lint
```

---

## 🗄️ Database

Postgres runs locally in Docker and moves to a managed host later by changing **one environment variable** (`DATABASE_URL`). No vendor-specific extensions, no provider SDKs, so Neon, Supabase, Fly, Railway and RDS all stay on the table.
