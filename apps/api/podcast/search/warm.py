"""Keep both Meilisearch indexes resident, so the first real search is not the
one that pays to load them.

🚨 WHY THIS EXISTS - the 2026-08-18 "transcript search is unavailable" report.

A live search for `Царичина` rendered the degraded banner on production. The
API's log said `MeilisearchTimeoutError ... read timeout=5`. Meilisearch's own
log for the SAME request said:

    POST /multi-search  status_code=200  time.busy=5.13ms  time.idle=14.5s

That is the whole diagnosis in one line: Meilisearch did the search in five
MILLISECONDS and then took fourteen and a half SECONDS to get round to
answering. It was never slow at searching; it was stalled. The API had already
hung up nine seconds earlier, `search_transcripts` returned `available: False`,
and the page correctly degraded to label matches only.

🔍 What makes it the transcript index specifically: both halves of `/search`
fire in one `Promise.all`, and in that same second the `episodes` query
(1,862 documents) answered in 14.6ms while the `transcript_segments` one
(61,452 segments, ~2 GB projected) stalled. Small index resident, big index
faulted back off the Railway volume. The API's own health check had passed
30 seconds earlier, because a healthy server and a resident index are not the
same claim.

✅ So the fix is to keep the pages warm, NOT to raise the timeout. Five seconds
is already generous for something that measures in single-digit milliseconds,
and no reader should wait fourteen. A longer timeout would have turned a wrong
answer into a wrong answer that also held a gunicorn worker.

⚠️ What this does NOT do: make a cold index fast. It makes the index unlikely to
GO cold, which is a probabilistic fix for a probabilistic failure - one
occurrence in two days of logs. If the banner reappears with this scheduled and
Meilisearch again reports a large `time.idle` against a tiny `time.busy`, the
next suspect is the container being descheduled, which is a hosting question and
not a code one.
"""

from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger("podcast")

# 🇧🇬 A common Bulgarian word that is NOT in `querying.STOP_WORDS` - a stop word
# is erased at index time, so it would match nothing and touch nothing, and this
# task would report success while warming exactly zero pages.
#
# Common on purpose: the point is to walk a LARGE posting list. A rare word
# reads a few pages and leaves the rest of the index just as cold as it found
# it, which is the quiet way this whole file becomes theatre.
WARM_QUERY = "много"

# Above this, say so. The number that matters here is wall clock, not Meilisearch's
# own `processing_time_ms` - the incident had 5ms of processing inside 14.5s of
# waiting, so a task that logged only the former would have reported everything
# as fine on the exact request that failed.
SLOW_SECONDS = 1.0


def warm_indexes() -> dict[str, Any]:
    """Run one cheap exhaustive count against each index. Never raises.

    ⚡ ONE `multi_search` round trip covers both indexes, and `count_only=True`
    is deliberate on both: it asks Meilisearch to count the term exhaustively
    (walking the posting list, which is the paging-in we want) while retrieving
    a single document (which is the part we do not want to pay for).
    """
    from .client import EPISODES_INDEX, SEARCH_ERRORS, TRANSCRIPTS_INDEX, multi_search
    from .index import build_search_params as episode_params
    from .transcript_index import build_search_params as segment_params

    queries = [
        {"indexUid": EPISODES_INDEX, "q": WARM_QUERY, **episode_params(count_only=True)},
        {
            "indexUid": TRANSCRIPTS_INDEX,
            "q": WARM_QUERY,
            **segment_params(count_only=True, highlight=False),
        },
    ]

    started = time.monotonic()
    try:
        results = multi_search(queries)
    except SEARCH_ERRORS as exc:
        # A warm-up is a nice-to-have. It must never retry, never alert and
        # never affect a request - Meilisearch being down is already visible on
        # every search path that matters.
        elapsed = time.monotonic() - started
        logger.warning("Search warm-up failed after %.2fs: %s", elapsed, exc)
        return {"ok": False, "seconds": round(elapsed, 3)}

    elapsed = time.monotonic() - started
    # 🚨 `totalHits` per index, so a warm-up against an EMPTY index is visible.
    # "The call succeeded" is the same signal a wiped volume gives, and this is
    # the one line of evidence that a search would have found anything.
    hits = [int(result.get("totalHits") or 0) for result in results]
    payload = {"ok": True, "seconds": round(elapsed, 3), "hits": hits}

    if elapsed >= SLOW_SECONDS:
        logger.warning(
            "Search warm-up took %.2fs for %r - the index was cold: %s",
            elapsed,
            WARM_QUERY,
            payload,
        )
    elif not any(hits):
        logger.warning(
            "Search warm-up matched nothing for %r - is either index empty? %s",
            WARM_QUERY,
            payload,
        )
    else:
        logger.debug("Search warm-up: %s", payload)

    return payload
