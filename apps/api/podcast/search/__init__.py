"""Meilisearch layer for episode search.

🇧🇬 The reason this app exists: YouTube's own search across these Bulgarian
channels is bad. Community topic labels + moments + typo tolerance fix it.

Layout:
- `client.py`    lazy client, health check, graceful-degradation helpers
- `documents.py` Episode -> searchable document (N+1 safe)
- `index.py`     index settings, writes, and `search()`

🚨 Postgres is the source of truth. `manage.py reindex --drop` rebuilds the
entire index from nothing.
🚨 Writes belong in Celery tasks, never inline in a request.
"""

from .client import EPISODES_INDEX, get_client, get_index, is_available, reset_client
from .documents import build_document, build_documents, episode_index_queryset
from .index import (
    build_filter,
    drop_index,
    ensure_index,
    index_episode,
    index_episodes,
    rebuild_all,
    remove_episode,
    search,
    stats,
)

__all__ = [
    "EPISODES_INDEX",
    "build_document",
    "build_documents",
    "build_filter",
    "drop_index",
    "ensure_index",
    "episode_index_queryset",
    "get_client",
    "get_index",
    "index_episode",
    "index_episodes",
    "is_available",
    "rebuild_all",
    "remove_episode",
    "reset_client",
    "search",
    "stats",
]
