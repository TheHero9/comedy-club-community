"""🔒 Request-level input guards.

Currently one guard: NUL bytes never reach the database.

🚨 Why this is middleware and not a per-endpoint check.

`U+0000` is legal in a URL (`%00`) and legal in a JSON string (`\\u0000`), so it
arrives as an ordinary Python `str` and passes every Pydantic constraint the API
declares - `min_length`, `max_length` and the rest all see a perfectly good
string. It only fails at the very bottom, inside psycopg:

    django.db.utils.DataError: PostgreSQL text fields cannot contain NUL (0x00) bytes

which surfaces as an unhandled **500**. Measured 2026-08-11, before this
existed, every one of these was a 500 from a single unauthenticated request:

    GET  /api/episodes?channel=a%00b        (also person, topic, q, kind)
    GET  /api/search/suggest?q=a%00b
    POST /api/episodes/{id}/comments        {"body": "a\\u0000b"}
    POST /api/episodes/{id}/tags            {"text": "a\\u0000b"}
    POST /api/episodes/{id}/moments         {"label": "a\\u0000b"}
    POST /api/episodes/{id}/topics          {"name": "a\\u0000b"}

Per-endpoint validation would have to be repeated on every text field of every
current and future schema, and the failure mode of forgetting one is a 500 on a
public endpoint. So it is enforced once, here, in the same spirit as the single
`WriteThrottle` attached to the whole `NinjaAPI`: a new endpoint cannot ship
unprotected by omission.

📖 Rejecting is correct rather than stripping. A NUL inside a comment body is not
a typo a user can make - no keyboard produces one and no editor pastes one. It
means a fuzzer, a scanner, or a corrupted client, and silently rewriting the
payload would store something the caller did not send.
"""

from __future__ import annotations

import json
import logging

from django.http import JsonResponse

logger = logging.getLogger("podcast")

NUL = "\x00"

# Only JSON bodies are inspected. Multipart is deliberately skipped: the one
# upload in this app is the membership verification screenshot, and touching
# `request.body` on a file upload would buffer the whole thing into memory to
# look for a byte that a binary image is entitled to contain anyway.
JSON_CONTENT_TYPE = "application/json"

# A body larger than this is not read. Every JSON write this API accepts is a
# few hundred bytes (a rating, a comment, a label); anything vastly larger is
# not a payload we need to inspect to protect Postgres from.
MAX_BODY_INSPECT_BYTES = 256 * 1024


def _has_nul(value: object) -> bool:
    """True if a NUL hides anywhere in a decoded JSON structure.

    Keys are checked as well as values: a key is user-supplied text too, and
    some of them are written to the database.
    """
    if isinstance(value, str):
        return NUL in value
    if isinstance(value, dict):
        return any(
            _has_nul(key) or _has_nul(item) for key, item in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(_has_nul(item) for item in value)
    return False


class RejectNullBytesMiddleware:
    """Reject any request carrying a NUL byte in its query string or JSON body."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        source = self._offending_source(request)
        if source is not None:
            logger.warning(
                "Rejected request with a NUL byte in %s: %s %s",
                source,
                request.method,
                request.path,
            )
            return JsonResponse(
                {"detail": f"Invalid character (NUL) in request {source}"},
                status=400,
            )
        return self.get_response(request)

    def _offending_source(self, request) -> str | None:
        # A path segment is user input too: `/api/episodes/a%00b` is routed to a
        # lookup on `youtube_id` and reaches Postgres exactly like a query
        # parameter does. Django has already percent-decoded `path_info`.
        if NUL in request.path_info:
            return "path"

        # `request.GET` is already percent-decoded, so `?q=a%00b` shows up here
        # as a real NUL. Checking the raw QUERY_STRING for the literal "%00"
        # would miss a client that sent the byte undecoded.
        for key, values in request.GET.lists():
            if NUL in key or any(NUL in value for value in values):
                return "query"

        if not request.content_type or not request.content_type.startswith(
            JSON_CONTENT_TYPE
        ):
            return None

        # 📖 `request.body` is cached by Django, so reading it here does not
        # consume the stream - Django-Ninja re-reads the same cached bytes when
        # it parses the payload a moment later.
        try:
            body = request.body
        except Exception:
            # Unreadable body (already streamed, connection reset). Not this
            # middleware's failure to report - let the view handle it.
            return None

        if not body or len(body) > MAX_BODY_INSPECT_BYTES:
            return None

        try:
            payload = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            # Malformed JSON is Django-Ninja's 422 to return, not our 400.
            return None

        return "body" if _has_nul(payload) else None
