#!/usr/bin/env bash
# Run ONE manage.py command from this PC against PRODUCTION Postgres + Meilisearch.
#
#   scripts/with-prod.sh <postgres host:port> <meilisearch https url> <manage.py args...>
#   scripts/with-prod.sh shortline.proxy.rlwy.net:39459 https://meili-xyz.up.railway.app sync_new_episodes --dry-run
#
# Why from the PC at all: `sync_new_episodes` needs yt-dlp, and the home IP is the
# only one proven to get full answers from YouTube (specs/26-new-episode-pipeline/).
#
# 🔒 Both endpoints are TEMPORARY and opened by the caller (the /sync-episodes
# skill): a Railway TCP proxy for Postgres and a generated HTTPS domain for
# Meilisearch, deleted again right after. Postgres is forced onto SSL, and
# Meilisearch is reached over HTTPS only - its master key must never cross the
# internet in clear text. Credentials are read from Railway at run time
# (`railway login` required) and never printed.
#
# ⚠️ Process environment beats apps/api/.env (load_dotenv does not override), so
# DATABASE_URL / MEILI_* here win, while YOUTUBE_API_KEY still comes from .env.
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <postgres host:port> <meilisearch https url> <manage.py args...>" >&2
  exit 2
fi
PG_ENDPOINT="$1"
MEILI_ENDPOINT="$2"
shift 2

case "$MEILI_ENDPOINT" in
  https://*) ;;
  *) echo "Meilisearch must be reached over https:// - refusing $MEILI_ENDPOINT" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

export DATABASE_URL MEILI_URL MEILI_MASTER_KEY
DATABASE_URL="$(railway variables --service Postgres --environment production --json | PG_ENDPOINT="$PG_ENDPOINT" python -c '
import json, os, sys
from urllib.parse import quote
d = json.load(sys.stdin)
print("postgres://%s:%s@%s/%s?sslmode=require" % (
    quote(d["PGUSER"], safe=""), quote(d["PGPASSWORD"], safe=""),
    os.environ["PG_ENDPOINT"], d["PGDATABASE"]))
')"
MEILI_MASTER_KEY="$(railway variables --service Meilisearch --environment production --json \
  | python -c 'import json, sys; print(json.load(sys.stdin)["MEILI_MASTER_KEY"])')"
MEILI_URL="$MEILI_ENDPOINT"

export PYTHONIOENCODING=utf-8
exec uv run python manage.py "$@"
