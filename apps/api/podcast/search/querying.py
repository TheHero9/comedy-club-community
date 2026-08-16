"""How a user's words are turned into a Meilisearch query.

🎯 Shared by BOTH indexes and by the API layer, because the single worst thing
this app can do is have its two search endpoints disagree about what a query
means. `episodes` and `transcript_segments` answer different questions; they must
answer them about the *same* interpretation of the words typed.

The central decision here is the **matching strategy**, and it is the difference
between search working and search looking broken:

  - `all`     - every word must be present. Precise, and empty far too often.
                A three-word memory of something heard in a podcast almost never
                appears verbatim: "счупен хладилник" matched 181 passages on
                "счупен" alone and ZERO with both words required.
  - `last`    - Meilisearch's default. Drops words from the END, one at a time,
                until something matches. Cheap, and wrong for natural language:
                the last word a Bulgarian speaker types is usually the noun that
                carries the meaning, and the first is often a filler.
  - `frequency` - drops the MOST COMMON word first. This is the one we want.
                Measured on this corpus (2026-08-16): "извънземни в царичина"
                returned 288 passages under `last` and 16 under `frequency`,
                because `last` threw away "царичина" and kept "в".

🚨 So loose matching is the DEFAULT, and the price of loose matching is paid in
the UI, not by tightening the query: a hit that matched two of three words is
still returned, but is labelled as a partial match and ranked below the full
ones. See `partition_index` for how that boundary is computed exactly rather
than guessed.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Matching strategies
# ---------------------------------------------------------------------------

#: Everything a user types goes through this. See the module docstring.
LOOSE = "frequency"

#: Companion query used only to COUNT how many hits matched every word.
STRICT = "all"

# 🇧🇬 High-frequency Bulgarian function words. Removed from both documents and
# queries, so "епизодът за политиката" matches on the nouns and not on "за".
# Deliberately conservative: anything that can carry meaning stays out of here.
#
# ⚠️ This list lives here, not in index.py, because `content_tokens` below has to
# apply the SAME notion of "a word that carries meaning" that the index applies.
# A query token the index stripped can never match anything, so counting it as a
# word would make every query look partial.
STOP_WORDS: list[str] = [
    "а",
    "ако",
    "ама",
    "б",
    "без",
    "би",
    "бъде",
    "в",
    "върху",
    "г",
    "го",
    "д",
    "да",
    "де",
    "докато",
    "е",
    "един",
    "една",
    "едно",
    "за",
    "и",
    "или",
    "им",
    "ими",
    "иска",
    "й",
    "каза",
    "как",
    "какво",
    "като",
    "кога",
    "който",
    "която",
    "което",
    "които",
    "ли",
    "ме",
    "между",
    "ми",
    "мога",
    "му",
    "на",
    "над",
    "най",
    "не",
    "него",
    "нея",
    "ни",
    "ние",
    "но",
    "от",
    "още",
    "по",
    "при",
    "с",
    "са",
    "само",
    "се",
    "си",
    "сме",
    "според",
    "сте",
    "съм",
    "със",
    "също",
    "т",
    "те",
    "тези",
    "този",
    "той",
    "то",
    "това",
    "тук",
    "ти",
    "у",
    "че",
    "ще",
    "щом",
    "я",
]

_STOP_WORD_SET = frozenset(STOP_WORDS)


def content_tokens(query: str) -> list[str]:
    """The words in `query` that can actually match something.

    🇧🇬 Stop words are dropped because the index dropped them too, so a query of
    "историята с колата" is TWO words as far as matching is concerned, not three.
    Getting this wrong is not cosmetic: it decides whether the page offers a
    "partial matches" section at all.

    Punctuation is not stripped - Meilisearch's tokenizer handles that, and a
    query like "404" must stay a word.
    """
    return [
        token
        for token in query.lower().split()
        if token and token not in _STOP_WORD_SET
    ]


def wants_partial_split(query: str) -> bool:
    """True when "matched every word" and "matched some words" can differ.

    A single-content-word query cannot have a partial match, so the second
    counting query is skipped entirely and every hit is reported as full.
    """
    return len(content_tokens(query)) >= 2


def partition_index(total_full: int, offset: int, position: int) -> str:
    """Label one hit `full` or `partial` from its ABSOLUTE rank.

    🚨 This is exact, not a heuristic, and it rests on one property of
    Meilisearch: `words` is the FIRST ranking rule on both indexes, and it sorts
    by "how many of the query's words did this document match", descending. So a
    loose result list is always partitioned - every document matching all the
    words comes before every document matching fewer.

    That means the count of strict (`all`) matches is precisely the index at
    which the loose list stops being full matches. Verified on the live corpus
    (2026-08-16): for three multi-word Bulgarian queries the first `len(strict)`
    ids of the loose list were exactly the strict id set.

    ⚠️ Do NOT replace this with "is this id in the strict result set". That set
    would have to be fetched in full to be correct across pagination, which for
    a broad query means retrieving hundreds of ids to label twenty.
    """
    return FULL if (offset + position) < total_full else PARTIAL


FULL = "full"
PARTIAL = "partial"


__all__ = [
    "FULL",
    "LOOSE",
    "PARTIAL",
    "STOP_WORDS",
    "STRICT",
    "content_tokens",
    "partition_index",
    "wants_partial_split",
]
