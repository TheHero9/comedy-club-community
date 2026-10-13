# Comedy Club Community

A searchable hub for a group of Bulgarian comedy podcasts on YouTube. Every episode across all channels in one place,
searchable down to what was said, with 1-10 ratings, watch logs and community labels.

<!-- TODO: add a screenshot or GIF of search results -->
![Comedy Club Community screenshot](docs/screenshot.png)

**Live:** [comedycommunity.club](https://comedycommunity.club) (paused for now)

## What's interesting

- **Transcript search at zero cost.** YouTube already has Bulgarian auto-captions for much of the catalogue.
  yt-dlp pulls them with no API key and no GPU, and they're indexed in Meilisearch next to the episode metadata.
  A throttled response looks exactly like "no captions", so the fetcher refuses to record "none" unless the response
  is complete ([`transcripts.py`](apps/api/podcast/ingestion/transcripts.py)).
- **Typo tolerance fixed for Cyrillic.** Meilisearch counts word length in bytes, and a Cyrillic letter is 2 bytes,
  so "пица" was matching "пичове". The thresholds are now set per character, and ids and slugs are never
  typo-matched ([`search/index.py`](apps/api/podcast/search/index.py)).
- **Typed contract between Python and TypeScript.** Next.js only talks to the Django Ninja API, never the database.
  TS types are generated from the OpenAPI schema, and a drift check regenerates them from the live schema and fails
  if they differ ([`check-api-types-drift.mjs`](scripts/check-api-types-drift.mjs)).
- **Gated deploys.** CI runs typecheck, lint, Vitest, ruff and pytest, and fails if a model change has no migration.
  The API, Celery worker and Celery beat deploy to Railway only after CI passes, then the workflow checks that the new
  build is actually serving ([`deploy-api.yml`](.github/workflows/deploy-api.yml)).

## Stack

Next.js 16, React 19, Tailwind, shadcn/ui, Clerk · Django 5, Django Ninja, Celery, Postgres, Redis, Meilisearch,
yt-dlp · Turborepo · Vercel + Railway

## Run locally

Needs Docker, Node 20+, Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```bash
# 1. Postgres, Redis, Meilisearch
cp .env.example .env
docker compose up -d

# 2. API on http://localhost:8000 (OpenAPI docs at /api/docs)
cd apps/api
cp .env.example .env
uv sync
uv run python manage.py migrate
uv run python manage.py backfill_channel @ivankirkov1 --limit 5   # a few real episodes via yt-dlp
uv run python manage.py runserver

# 3. Web on http://localhost:3000 (second terminal, repo root)
cp apps/web/.env.example apps/web/.env.local
npm install
npm run dev
```

Architecture, rules and build plan: [`CLAUDE.md`](CLAUDE.md), [`docs/STATUS.md`](docs/STATUS.md).
