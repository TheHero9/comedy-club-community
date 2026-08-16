"""How a query is interpreted, and how full matches are told from partial ones.

These are hermetic - no Meilisearch, no database. What they pin is the two rules
that make loose matching safe:

  1. a query's WORD COUNT is counted after stop words are dropped, because a
     word the index erased can never match and counting it would make every
     ordinary query look partial
  2. the full/partial boundary is computed from an ABSOLUTE rank, so a hit does
     not change kind when it is reached through a different page

The end-to-end behaviour (does `frequency` actually return more than `all`, does
the boundary land where Meilisearch puts it) is asserted by the Playwright specs
against the real index, because that is the only place it can be true or false.
"""

from __future__ import annotations

import pytest

from podcast.search import querying


class TestContentTokens:
    def test_stop_words_do_not_count_as_words(self):
        """🇧🇬 "историята с колата" is a TWO-word query.

        "с" is in the index's stop-word list, so no document contains it and no
        hit can ever match it. Counting it would mean a query that matched both
        real words still reported as partial, and every multi-word search would
        grow a "partial matches" section it did not deserve.
        """
        assert querying.content_tokens("историята с колата") == ["историята", "колата"]

    def test_case_is_folded(self):
        assert querying.content_tokens("Каспаров") == ["каспаров"]

    def test_a_bare_number_is_a_word(self):
        """"404" is a real query here - one of the channels is named for it."""
        assert querying.content_tokens("делo 404") == ["делo", "404"]

    def test_a_query_of_nothing_but_stop_words_has_no_words(self):
        assert querying.content_tokens("на и за") == []

    @pytest.mark.parametrize(
        "query,expected",
        [
            ("царичи", False),
            ("", False),
            ("на", False),
            ("историята с колата", True),
            ("счупен хладилник", True),
        ],
    )
    def test_when_a_partial_split_is_even_possible(self, query: str, expected: bool):
        """A one-word query cannot half-match, so the second count is skipped.

        This is a correctness guard as much as a saving: with no split, every hit
        is reported `full`, and the UI never prints a "partial matches" heading
        over an ordinary one-word search.
        """
        assert querying.wants_partial_split(query) is expected


class TestPartition:
    def test_the_boundary_is_the_full_match_count(self):
        assert querying.partition_index(2, 0, 0) == querying.FULL
        assert querying.partition_index(2, 0, 1) == querying.FULL
        assert querying.partition_index(2, 0, 2) == querying.PARTIAL

    def test_a_hit_keeps_its_kind_across_pages(self):
        """🚨 The reason this takes an offset instead of a list index.

        Rank 21 is the same hit whether it arrived as index 21 of one page or
        index 1 of the second. Labelling it from the page-local index would make
        the same episode read as a full match on page 2 and a partial on page 1.
        """
        first_page = querying.partition_index(30, 0, 21)
        second_page = querying.partition_index(30, 20, 1)
        assert first_page == second_page == querying.FULL

        assert querying.partition_index(30, 20, 11) == querying.PARTIAL

    def test_everything_is_full_when_everything_matched(self):
        assert querying.partition_index(50, 0, 49) == querying.FULL

    def test_everything_is_partial_when_nothing_matched_fully(self):
        """"счупен хладилник" matches 0 episodes with both words and 128 with one."""
        assert querying.partition_index(0, 0, 0) == querying.PARTIAL


class TestStopWordsStayInSync:
    def test_the_index_uses_the_same_list_this_module_counts_by(self):
        """🚨 The two must never diverge.

        `content_tokens` strips a word because the INDEX stripped it. If the
        index settings were ever pointed at a different list, a query word could
        be counted as matchable while being absent from every document, and the
        full/partial split would silently start lying.
        """
        from podcast.search import index as search_index

        assert search_index.STOP_WORDS is querying.STOP_WORDS
        assert search_index.INDEX_SETTINGS["stopWords"] is querying.STOP_WORDS

    def test_the_transcript_index_uses_it_too(self):
        from podcast.search import transcript_index

        assert transcript_index.INDEX_SETTINGS["stopWords"] is querying.STOP_WORDS


class TestSearchParams:
    def test_loose_matching_is_the_default_on_both_indexes(self):
        """🇧🇬 NOT Meilisearch's own default of `last`.

        `last` drops the LAST word typed, which in Bulgarian is usually the noun
        carrying the meaning: "извънземни в царичина" under `last` throws away
        "царичина" and keeps "в", returning 288 passages instead of 16.
        """
        from podcast.search import index as search_index
        from podcast.search import transcript_index

        assert search_index.build_search_params()["matchingStrategy"] == "frequency"
        assert transcript_index.build_search_params()["matchingStrategy"] == "frequency"

    def test_counting_uses_exhaustive_pagination_not_the_estimate(self):
        """🚨 A correctness switch, not a pagination style.

        In offset mode Meilisearch answers with `estimatedTotalHits`, which is
        what its name says - it reported one query's 13 distinct episodes as 17,
        and another's as 3,852 out of a catalogue holding 1,961 episodes in
        total. Page mode counts exhaustively and returns `totalHits`.
        """
        from podcast.search import index as search_index

        counting = search_index.build_search_params(count_only=True)
        assert counting["page"] == 1
        assert counting["hitsPerPage"] == 1
        assert "offset" not in counting

        paging = search_index.build_search_params(limit=20, offset=40)
        assert paging["offset"] == 40
        assert "page" not in paging

    def test_the_transcript_page_is_distinct_by_episode(self):
        """What makes `limit` mean EPISODES rather than passages."""
        from podcast.search import transcript_index

        params = transcript_index.build_search_params(
            distinct=transcript_index.DISTINCT_EPISODE
        )
        assert params["distinct"] == "episode_id"
        # Deleting or renaming this filterable attribute breaks `distinct`
        # silently - the search still answers, just not per episode.
        assert "episode_id" in transcript_index.FILTERABLE_ATTRIBUTES
