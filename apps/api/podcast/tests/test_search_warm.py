"""The Meilisearch keep-warm task.

🚨 The failure this guards against is a task that reports success while warming
nothing. A warm-up has no visible output - if it queried a stop word, hit one
index instead of two, or asked for a page of documents instead of a count, every
one of those still returns 200 and still logs "ok". So these tests assert the
SHAPE of the request, not just that it was made.

Hermetic: `multi_search` is replaced, because what is under test is the request
this module builds. Whether Meilisearch then keeps those pages resident is a
hosting property no unit test can assert - see podcast/search/warm.py.
"""

from __future__ import annotations

import pytest

from podcast.search import warm
from podcast.search.client import EPISODES_INDEX, TRANSCRIPTS_INDEX
from podcast.search.querying import STOP_WORDS


@pytest.fixture
def captured(monkeypatch):
    """Capture the queries `warm_indexes` sends, and answer them."""
    calls: list[list[dict]] = []

    def fake_multi_search(queries):
        calls.append(queries)
        return [{"totalHits": 41, "hits": []}, {"totalHits": 2716, "hits": []}]

    monkeypatch.setattr("podcast.search.client.multi_search", fake_multi_search)
    return calls


class TestWarmQuery:
    def test_the_warm_query_is_not_a_stop_word(self):
        """🇧🇬 A stop word is erased at index time, so it matches nothing.

        The task would still succeed, still log "ok", and still walk zero pages
        of the posting list - which is the quiet way this whole feature becomes
        theatre. This is the single assertion that keeps the query honest.
        """
        assert warm.WARM_QUERY not in STOP_WORDS

    def test_the_warm_query_has_searchable_text(self):
        from podcast.api.search import has_searchable_text

        assert has_searchable_text(warm.WARM_QUERY)


class TestWarmIndexes:
    def test_it_warms_BOTH_indexes_in_one_round_trip(self, captured):
        """The incident was the TRANSCRIPT index, but the small one is free."""
        warm.warm_indexes()

        assert len(captured) == 1, "the two indexes cost two round trips"
        assert [query["indexUid"] for query in captured[0]] == [
            EPISODES_INDEX,
            TRANSCRIPTS_INDEX,
        ]

    def test_it_counts_rather_than_fetching_a_page_of_documents(self, captured):
        """⚡ `count_only` walks the posting list and retrieves one document.

        A plain `limit=20` search would hydrate twenty transcript segments every
        four minutes forever, and - worse - would only touch the top of the
        ranking, which is the part already most likely to be resident.
        """
        warm.warm_indexes()

        for query in captured[0]:
            assert query["hitsPerPage"] == 1
            assert query["page"] == 1
            assert "limit" not in query
            assert "offset" not in query

    def test_it_does_not_ask_for_highlighting(self, captured):
        """Cropping and <mark>-wrapping a passage nobody reads is pure cost."""
        warm.warm_indexes()

        segments = captured[0][1]
        assert "attributesToHighlight" not in segments
        assert "attributesToCrop" not in segments

    def test_it_reports_the_per_index_hit_counts(self, captured):
        """🚨 So a warm-up against an EMPTY index is distinguishable.

        "The call succeeded" is exactly what a wiped volume also produces.
        """
        result = warm.warm_indexes()

        assert result["ok"] is True
        assert result["hits"] == [41, 2716]
        assert isinstance(result["seconds"], float)

    def test_an_empty_index_is_logged_rather_than_reported_as_healthy(
        self, monkeypatch, caplog
    ):
        monkeypatch.setattr(
            "podcast.search.client.multi_search",
            lambda queries: [{"totalHits": 0}, {"totalHits": 0}],
        )

        with caplog.at_level("WARNING"):
            result = warm.warm_indexes()

        assert result["hits"] == [0, 0]
        assert "matched nothing" in caplog.text

    def test_meilisearch_being_down_is_swallowed(self, monkeypatch, caplog):
        """🚨 A warm-up must never become an outage of its own.

        It runs on Celery Beat every four minutes. If it raised, a Meilisearch
        blip would fill the worker log with tracebacks and - with a retry policy
        - hammer a search server that is already struggling. Every real search
        path already surfaces an outage where a user can see it.
        """
        from meilisearch.errors import MeilisearchTimeoutError

        def boom(queries):
            raise MeilisearchTimeoutError("read timeout=5")

        monkeypatch.setattr("podcast.search.client.multi_search", boom)

        with caplog.at_level("WARNING"):
            result = warm.warm_indexes()

        assert result["ok"] is False
        assert "warm-up failed" in caplog.text

    def test_a_slow_warm_up_is_logged_because_that_IS_the_incident(
        self, monkeypatch, caplog
    ):
        """🚨 Wall clock, not Meilisearch's `processing_time_ms`.

        The 2026-08-18 stall was 5.13ms of processing inside 14.5s of waiting.
        A task that timed only the server's own number would have reported that
        exact request as healthy.
        """
        ticks = iter([0.0, 3.0])
        monkeypatch.setattr(warm.time, "monotonic", lambda: next(ticks))
        monkeypatch.setattr(
            "podcast.search.client.multi_search",
            lambda queries: [{"totalHits": 41, "processingTimeMs": 5}, {"totalHits": 9}],
        )

        with caplog.at_level("WARNING"):
            result = warm.warm_indexes()

        assert result["seconds"] == 3.0
        assert "the index was cold" in caplog.text


class TestTaskWrapper:
    def test_the_task_is_a_thin_wrapper(self, captured):
        """The task body must hold no logic of its own - repo rule."""
        from podcast.tasks import warm_search_indexes

        assert warm_search_indexes() == warm.warm_indexes()

    def test_the_task_is_actually_scheduled(self):
        """🚨 A task nobody schedules is the "endpoint with no reader" lesson.

        Nothing calls this from a request path, so Celery Beat is its ONLY
        caller. Without the schedule entry the module is dead code that every
        other test in this file happily proves correct.
        """
        import podcast.tasks  # noqa: F401  - registers the task name
        from config.celery import app

        entries = [
            entry
            for entry in app.conf.beat_schedule.values()
            if entry["task"] == "podcast.warm_search_indexes"
        ]
        assert len(entries) == 1

        # 🚨 And under a name Celery can resolve. Beat dispatches by STRING, so
        # a typo here is not an ImportError - it is a task that silently never
        # runs, which is indistinguishable from the bug it was written to fix.
        assert "podcast.warm_search_indexes" in app.tasks
