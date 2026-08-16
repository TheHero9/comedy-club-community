"""One grammar for the timestamps members type when logging a moment.

    "1:30:29" -> 5429     "30:29" -> 1829     "4:05" -> 245     "45" -> 45

🚨 The API parses this itself and does not trust a number the client computed.
The web form parses the same shapes for instant feedback, but a client is never
an authority on its own input - the same reason `request.auth` is the only
accepted actor and a client-supplied user id never is.

⚠️ Deliberately strict about the 60 boundary. "4:75" is not 5:15; it is a typo,
and silently reinterpreting it would store a timestamp the member did not mean
and deep-link the video to the wrong second. Only the LEADING part may exceed
60, so "90:00" is a legitimate 90 minutes.
"""

from __future__ import annotations

MAX_PARTS = 3


class TimestampError(ValueError):
    """The text is not a timestamp we can read. Message is user-facing."""


def parse_timestamp(text: str) -> int:
    """Seconds from `H:MM:SS`, `M:SS` or a bare second count."""
    if text is None:
        raise TimestampError("Enter a timestamp")

    cleaned = str(text).strip()
    if not cleaned:
        raise TimestampError("Enter a timestamp")

    parts = cleaned.split(":")
    if len(parts) > MAX_PARTS:
        raise TimestampError("Use at most hours:minutes:seconds")

    values: list[int] = []
    for part in parts:
        part = part.strip()
        # `isdigit` rather than int(): it rejects "+5", "-5", " 5.5" and the
        # Unicode digits int() happily accepts, all of which would parse into
        # something the member did not type.
        if not part.isdigit() or not part.isascii():
            raise TimestampError(f"'{cleaned}' is not a timestamp - try 1:30:29")
        values.append(int(part))

    # Every part after the leading one is a 0-59 field. The leading one is a
    # count, so "90:00" is fine.
    for value in values[1:]:
        if value > 59:
            raise TimestampError("Minutes and seconds must be under 60")

    total = 0
    for value in values:
        total = total * 60 + value
    return total


def format_timestamp(seconds: int) -> str:
    """The inverse, for display and for echoing a parsed value back."""
    seconds = max(0, int(seconds or 0))
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def resolve_timestamp(
    *, timestamp: str | None, timestamp_sec: int | None, required: bool = True
) -> int | None:
    """Accept either form, preferring the typed text when both are present.

    The string is what a human entered, so it wins over a number a client
    derived from it. Keeping `timestamp_sec` working means existing callers and
    tests do not break just because the form gained a nicer input.

    🚨 `required` defaults to True so that a caller which forgets to think about
    the absent case keeps the old, strict behaviour. Only the moment endpoint
    passes False, and only because a moment without a timestamp is a defined
    thing there (a note about the episode). An OMITTED value becomes None; a
    MALFORMED one is still an error either way - "4:75" is a typo, not a
    decision to leave the field blank.
    """
    if timestamp is not None and str(timestamp).strip():
        return parse_timestamp(timestamp)
    if timestamp_sec is None:
        if required:
            raise TimestampError("Enter a timestamp")
        return None
    if timestamp_sec < 0:
        raise TimestampError("A timestamp cannot be negative")
    return int(timestamp_sec)
