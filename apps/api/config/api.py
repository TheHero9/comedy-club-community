"""The single Django-Ninja API instance.

Routers are registered here and nowhere else, so the OpenAPI schema (and therefore
the generated TypeScript types in packages/api-types) has exactly one source.
"""

import json
import logging

from django.conf import settings
from django.db import connection
from ninja import NinjaAPI, Schema
from ninja.renderers import JSONRenderer

logger = logging.getLogger("podcast")


class CompactUnicodeJSONRenderer(JSONRenderer):
    """🇧🇬 Emit real UTF-8 instead of `\\uXXXX` escapes.

    Django-Ninja's default renderer uses `ensure_ascii=True`, which turns every
    Cyrillic character into a 6-byte `\\uXXXX` escape. On a Bulgarian-language
    API that is not a rounding error: the channel grid alone expanded 103,968
    Cyrillic characters into 406 KB of pure escape overhead on ONE response.

    Every payload here is `Content-Type: application/json; charset=utf-8`, so
    non-ASCII bytes are exactly what the spec expects a client to receive.

    The compact separators drop the space after every `,` and `:`, which is
    another few percent across list endpoints that repeat keys per row.
    """

    json_dumps_params = {"ensure_ascii": False, "separators": (",", ":")}

    def render(self, request, data, *, response_status):
        return json.dumps(data, cls=self.encoder_class, **self.json_dumps_params)


def _write_throttle():
    """🔒 One rate limiter for the whole API, so a new write endpoint cannot ship
    unthrottled by omission. Only unsafe methods are counted - see throttling.py."""
    from podcast.api.throttling import WriteThrottle

    return [WriteThrottle()]


api = NinjaAPI(
    title="Comedy Club Community API",
    version="0.1.0",
    description="Searchable community hub for Bulgarian YouTube podcast channels.",
    docs_url="/docs",
    throttle=_write_throttle(),
    renderer=CompactUnicodeJSONRenderer(),
)


class DependencyStatus(Schema):
    ok: bool
    detail: str = ""


class HealthOut(Schema):
    status: str
    database: DependencyStatus
    redis: DependencyStatus


def _check_database() -> DependencyStatus:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return DependencyStatus(ok=True)
    except Exception as exc:
        logger.warning("Health check: database unreachable: %s", exc)
        return DependencyStatus(ok=False, detail=str(exc)[:200])


def _check_redis() -> DependencyStatus:
    try:
        import redis

        client = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        client.ping()
        return DependencyStatus(ok=True)
    except Exception as exc:
        logger.warning("Health check: redis unreachable: %s", exc)
        return DependencyStatus(ok=False, detail=str(exc)[:200])


@api.get("/health", response=HealthOut, tags=["system"], auth=None)
def health(request):
    """Liveness plus dependency reachability. Never authenticated."""
    database = _check_database()
    cache = _check_redis()
    return HealthOut(
        status="ok" if (database.ok and cache.ok) else "degraded",
        database=database,
        redis=cache,
    )


# ---------------------------------------------------------------------------
# Routers
#
# Registered in ONE place so the OpenAPI schema (and the generated TypeScript in
# packages/api-types) always reflects the whole surface.
# ---------------------------------------------------------------------------


def _register_routers() -> None:
    from podcast.api.community import router as community_router
    from podcast.api.me import router as me_router
    from podcast.api.moderation import public_router as leaderboard_router
    from podcast.api.moderation import router as moderation_router
    from podcast.api.public import router as public_router
    from podcast.api.search import router as search_router

    api.add_router("", public_router)
    api.add_router("", leaderboard_router)
    api.add_router("", search_router)
    api.add_router("", me_router)
    api.add_router("", community_router)
    api.add_router("", moderation_router)


_register_routers()
