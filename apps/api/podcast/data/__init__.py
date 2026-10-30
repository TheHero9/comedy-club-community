"""Data that ships with the code rather than living in the database.

🚨 In the Docker image, not in `tmp/`. `removed-episodes.txt` is here for exactly
that reason - the purge list has to be readable by the same management command
running in production. Anything added here is subject to the same rule.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from pathlib import Path

REMOVED_EPISODES_FILE = Path(__file__).with_name("removed-episodes.txt")


def ids_in(text: str) -> list[str]:
    """Youtube ids from a one-per-line list. Everything after `#` is a comment."""
    ids = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            ids.append(line)
    return ids


def removed_episode_ids() -> frozenset[str]:
    """Every id on the exclusion list - videos no sync may ever recreate.

    🚨 Ingestion is `update_or_create(youtube_id=...)`, so a sync that lists a
    purged promo clip brings it straight back with a `created` count that reads
    as good news. Every ingestion path filters through this.

    Read on every call, never cached: `remove_episodes` and `sync_new_episodes`
    append to the file, and a sync later in the same process must see it.
    """
    try:
        return frozenset(ids_in(REMOVED_EPISODES_FILE.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return frozenset()


def add_removed_episodes(entries: Iterable[tuple[str, str]], *, reason: str) -> list[str]:
    """Append `(youtube_id, note)` pairs that are not listed yet.

    Returns the ids actually added. An id already on the list is skipped, so
    re-running a removal never duplicates a line.
    """
    listed = removed_episode_ids()
    fresh: dict[str, str] = {}
    for youtube_id, note in entries:
        if youtube_id and youtube_id not in listed:
            fresh.setdefault(youtube_id, note)
    if not fresh:
        return []

    lines = ["", f"# {reason} ({date.today().isoformat()})"]
    lines += [f"{youtube_id}  # {note}" if note else youtube_id for youtube_id, note in fresh.items()]
    with REMOVED_EPISODES_FILE.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
    return list(fresh)


def clock(seconds: int | None) -> str:
    """`119` -> `1:59`, `3723` -> `1:02:03`. Unknown stays visibly unknown."""
    if seconds is None:
        return "?"
    hours, rest = divmod(int(seconds), 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def exclusion_note(channel_slug: str, duration_sec: int | None, title: str) -> str:
    """The `channel | m:ss | title` comment the 2026-08-15 list was written in."""
    return f"{channel_slug} | {clock(duration_sec)} | {title}"
