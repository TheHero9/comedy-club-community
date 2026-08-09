"""Lazily constructed Meilisearch client.

🚨 Meilisearch is a DISPOSABLE READ REPLICA. Postgres is the source of truth, so
nothing in this package may turn a search outage into a 500 on a web request.
Every call site either goes through `graceful()` or catches `SEARCH_ERRORS`
itself. `manage.py reindex` is the one place that wants failures to be loud, and
it opts in explicitly.

The client is built on first use (never at import time) so Django can start,
migrate and run tests with Meilisearch down.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from functools import wraps
from typing import Any, TypeVar

import meilisearch
from django.conf import settings
from meilisearch.errors import MeilisearchError
from meilisearch.index import Index

logger = logging.getLogger(__name__)

EPISODES_INDEX = "episodes"

# 🚨 A SEPARATE index, never a field on an episode document. A 26,000-word
# transcript next to a 60-character title makes every episode match almost every
# common Bulgarian word, and a passing mention would outrank an episode actually
# about the subject. See podcast/search/transcript_index.py.
TRANSCRIPTS_INDEX = "transcript_segments"

# Everything the meilisearch client can throw at us, plus the socket-level
# failures that escape it. Catching MeilisearchError alone is not enough:
# a DNS failure or a dropped connection can surface as a bare OSError.
SEARCH_ERRORS: tuple[type[Exception], ...] = (MeilisearchError, OSError)

# Seconds before a health check is re-issued. Without this every request that
# touches search would pay a network round trip just to ask "are you there?".
HEALTH_TTL_SECONDS = 30.0

# Seconds. Deliberately short: a slow search must fail fast, not hold a worker.
DEFAULT_TIMEOUT_SECONDS = 5

_lock = threading.Lock()
_client: meilisearch.Client | None = None
_health: tuple[float, bool] | None = None  # (checked_at_monotonic, healthy)

T = TypeVar("T")


def get_client() -> meilisearch.Client:
    """Return the process-wide client, building it on first use.

    Constructing the client does no I/O, so this cannot fail because
    Meilisearch is down. Only the actual calls can.
    """
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                timeout = getattr(settings, "MEILI_TIMEOUT", DEFAULT_TIMEOUT_SECONDS)
                _client = meilisearch.Client(
                    settings.MEILI_URL,
                    settings.MEILI_MASTER_KEY or None,
                    timeout=timeout,
                )
                logger.debug("Meilisearch client built for %s", settings.MEILI_URL)
    return _client


def get_index(name: str = EPISODES_INDEX) -> Index:
    """Return an index handle. Does no I/O and never asserts the index exists."""
    return get_client().index(name)


def reset_client() -> None:
    """Drop the cached client and health state.

    Needed by tests and by anything that mutates MEILI_URL at runtime.
    """
    global _client, _health
    with _lock:
        _client = None
        _health = None


def is_available(*, force: bool = False) -> bool:
    """True when Meilisearch answers its health endpoint.

    Cached for HEALTH_TTL_SECONDS so a burst of requests costs one round trip.
    Pass force=True from CLI paths that must see the current state.
    """
    global _health
    now = time.monotonic()
    cached = _health
    if not force and cached is not None and (now - cached[0]) < HEALTH_TTL_SECONDS:
        return cached[1]

    try:
        get_client().health()
        healthy = True
    except SEARCH_ERRORS as exc:
        logger.warning("Meilisearch unavailable at %s: %s", settings.MEILI_URL, exc)
        healthy = False

    _health = (now, healthy)
    return healthy


def task_uid(task: Any) -> int | None:
    """Pull the task uid out of whatever the client handed back."""
    uid = getattr(task, "task_uid", None)
    if uid is None and isinstance(task, dict):
        uid = task.get("taskUid")
    return uid if isinstance(uid, int) else None


def wait_for_task(task: Any, timeout_ms: int) -> None:
    """Block until an enqueued Meilisearch task finishes. No-op for a task-less call."""
    uid = task_uid(task)
    if uid is None:
        return
    get_client().wait_for_task(uid, timeout_in_ms=timeout_ms)


def graceful(
    *, default: Any = None, default_factory: Callable[[], Any] | None = None
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Swallow Meilisearch failures and return a fallback instead.

    Used on the write paths so a Celery task or a signal handler that fires
    while Meilisearch is down logs a warning rather than exploding. Callers that
    want the failure (the reindex command, a Celery task with retries) pass
    strict=True, which bypasses this wrapper.
    """

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return func(*args, **kwargs)
            except SEARCH_ERRORS as exc:
                logger.warning(
                    "Meilisearch %s failed, continuing without it: %s", func.__name__, exc
                )
                return default_factory() if default_factory is not None else default

        return wrapper

    return decorator
