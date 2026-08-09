"""Meilisearch layer for episode search.

🇧🇬 The reason this app exists: YouTube's own search across these Bulgarian
channels is bad. Community topic labels + moments + typo tolerance fix it.

Layout:
- `client.py`               lazy client, health check, graceful-degradation helpers
- `documents.py`            Episode -> searchable document (N+1 safe)
- `index.py`                `episodes` index settings, writes, and `search()`
- `transcript_documents.py` TranscriptSegment -> searchable document (N+1 safe)
- `transcript_index.py`     `transcript_segments` index settings, writes, search

🚨 TWO indexes, on purpose. `episodes` answers "which episodes are ABOUT this";
`transcript_segments` answers "where was this SAID". Merging them would let a
26,000-word transcript drown a 60-character title and destroy ranking - see the
docstring in transcript_index.py.

🚨 Postgres is the source of truth. `manage.py reindex --drop` rebuilds BOTH
indexes from nothing.
🚨 Writes belong in Celery tasks, never inline in a request.
"""

from .client import (
    EPISODES_INDEX,
    TRANSCRIPTS_INDEX,
    get_client,
    get_index,
    is_available,
    reset_client,
)
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
from .transcript_documents import build_segment_document, segment_index_queryset

__all__ = [
    "EPISODES_INDEX",
    "TRANSCRIPTS_INDEX",
    "build_document",
    "build_segment_document",
    "segment_index_queryset",
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
