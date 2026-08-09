"""🔒 Rate limiting for write endpoints.

CLAUDE.md § Security: "Rate-limit every write endpoint (ratings, comments, topics,
moments, reports). ~1k users can still spam." Everything written through this API
is user-generated content that ends up rendered publicly, so an unbounded write
path is a spam path.

ONE throttle is attached to the whole `NinjaAPI` in `config/api.py`, which is why
adding a new write endpoint cannot accidentally ship unthrottled.

Design notes:
- 🔑 The bucket key is the ACTOR (`request.auth`, set only by an auth backend), never
  anything the client sent. Two users can never share a bucket.
- 📖 Safe methods are deliberately NOT throttled. This is a content site whose read
  traffic (including crawlers) is the product.
- ⚙️ The rate is re-read from settings on every request instead of being frozen at
  import time, so `API_WRITE_RATE_LIMIT` is a real knob and a test can turn it down
  without rebuilding the router tree.
"""

from __future__ import annotations

import logging

from django.conf import settings
from ninja.throttling import SimpleRateThrottle

logger = logging.getLogger("podcast")

# GET/HEAD/OPTIONS never mutate anything, and throttling them would penalise the
# public browse pages this site exists to serve.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

DEFAULT_WRITE_RATE = "60/min"


class WriteThrottle(SimpleRateThrottle):
    """Per-actor limit on unsafe HTTP methods.

    - Authenticated: keyed on the user id behind the verified token.
    - Anonymous: keyed on IP, so an unauthenticated flood is not free either.
    """

    scope = "write"

    def __init__(self, rate: str | None = None):
        super().__init__(rate=rate or self._configured_rate() or DEFAULT_WRITE_RATE)
        self._explicit_rate = rate

    @staticmethod
    def _configured_rate() -> str | None:
        """The configured rate, or None when limiting is switched off."""
        return getattr(settings, "API_WRITE_RATE_LIMIT", DEFAULT_WRITE_RATE) or None

    def allow_request(self, request) -> bool:
        self.rate = self._explicit_rate or self._configured_rate()
        self.num_requests, self.duration = self.parse_rate(self.rate)
        if self.num_requests is None:
            return True

        try:
            return super().allow_request(request)
        except Exception:
            # ⚠️ Fail OPEN. The counters live in the cache; a Redis outage must not
            # turn the entire site read-only. Logged loudly rather than hidden.
            logger.warning(
                "Rate limiter unavailable, allowing the request through", exc_info=True
            )
            return True

    def get_cache_key(self, request) -> str | None:
        # None means "do not throttle this request" (ninja's contract).
        if request.method in SAFE_METHODS:
            return None

        actor = getattr(request, "auth", None)
        actor_id = getattr(actor, "pk", None)
        ident = f"user:{actor_id}" if actor_id else f"ip:{self.get_ident(request)}"
        return self.cache_format % {"scope": self.scope, "ident": ident}
