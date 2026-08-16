# Search: the counts that lied, and matching that finds things

**Date:** 2026-08-16
**Trigger:** owner searched `царичи` on production and could not reconcile the
numbers on the page with the cards under them.

---

## 1. What was actually wrong

The report was *"I don't understand what this text means"*. Reproduced exactly:

```
GET /api/search?q=царичи              -> total = 2
GET /api/search/transcripts?q=царичи  -> 21 segments, 13 episodes in the page
Rendered:  heading "2 episodes"
           2 cards under "In the title"
           6 cards under "Said in the episode"
```

Three separate defects, each of which alone would have been confusing:

### 🚨 1a. The heading counted one of two result sets

`copy.search.resultsFor(resultCount(results.total), query)` printed the **label**
match total. Spoken-only episodes are fetched from a different endpoint and were
never counted, so the page said "2 episodes" above eight cards.

There is also **no honest combined number available**: the two halves come from
two indexes and their overlap across the full result sets is unknown. Any single
figure would have been a guess presented as a fact.

**Fix:** the heading carries no count at all. Two exact numbers go underneath,
each naming what it counts and each sitting next to the section that renders it.

### 🚨 1b. "13 episodes" was an artefact of a segment page size

`/api/search/transcripts` paged over **passages**, then grouped them for display.
So `hits.length` was "however many episodes the first 60 passages happened to
touch" - not a page size, and not the number of episodes containing the word.

For `царичи` the coincidence was cruel: the real answer *is* 13, so the number
looked right while being derived from nothing.

For a broad query it was plainly wrong. Meilisearch's `estimatedTotalHits` under
`distinct` reported **3,852 distinct episodes** for `историята с колата` - out of
a catalogue holding 1,961 episodes in total.

**Fix:** the endpoint pages by **episode**, using Meilisearch's `distinct:
episode_id`, and counts exhaustively with `page`/`hitsPerPage` so `totalHits` is
exact. Measured cost: 0-6 ms.

| query | old "episodes" | estimate under distinct | exact |
| --- | --- | --- | --- |
| `царичи` | 13 (accidental) | 17 | **13** |
| `историята с колата` | 20 | 3,852 | **414** |
| `подкаст` | 20 | - | **516** |

### 🚨 1c. The spoken section was capped below the number it advertised

`SPOKEN_EPISODE_LIMIT = 6` was applied *after* the fetch, with **no "load more"**.
So the page advertised 13 and drew 6, with no way to reach the other seven.

**Fix:** the cap is now a page **size** the API is asked for, and the section has
its own `?s=` pagination.

---

## 2. Matching: loose, but labelled

Owner ask: *"if someone searches three words we want to propose many things even
if two of the words are together ... people will search for something they think
they heard in an episode."*

### The strategy change

Meilisearch's default is `matchingStrategy: "last"`, which drops words **from the
end** until something matches. That is wrong for Bulgarian: the last word typed
is usually the noun carrying the meaning and the first is often a filler.

`frequency` (Meilisearch 1.11+, confirmed on the pinned 1.11.3) drops the **most
common** word first. Measured on this corpus:

| query | `all` | `last` | `frequency` |
| --- | --- | --- | --- |
| `извънземни в царичина` (segments) | 7 | 288 | **16** |
| `историята с колата` (episodes) | 4 | 134 | **15** |
| `счупен хладилник` (segments) | 0 | 181 | **181** |

`last` on the first query threw away `царичина` and kept `в`.

### 🚨 The safety valve: full vs partial

Loosening matching without saying so is how a search box loses trust - the
`пица`/`пичове` lesson in a different form. So every hit carries `match_kind`,
and the UI renders partial matches in their **own section, under their own
heading**, below the full ones.

The boundary is **computed, not guessed**. `words` is the first ranking rule on
both indexes and sorts by "how many query words matched", descending - so a loose
result list is always partitioned, and the count of strict (`all`) matches is
exactly where full matches stop. Verified against the live index: for three
multi-word Bulgarian queries the first `len(strict)` ids of the loose list were
exactly the strict id set.

That count costs one extra `count_only` query, batched into the same
`multi_search` round trip, and is skipped entirely for single-word queries
(which cannot half-match).

---

## 3. What the page looks like now

```
Results for "царичи"
2 episodes match by title, topic or guest
Spoken in 13 episodes (21 passages)

  In the title                        [2 cards]
  Said in the episode                 [6 cards]
  [ More spoken matches ]             <- reaches the other 7
```

Four regions, each `data-testid`-addressable and each asserted against the
endpoint that produced it:

| region | contents |
| --- | --- |
| `results-title` | full match, the words are in the episode title |
| `results-elsewhere` | full match, on a topic, moment, guest or channel |
| `results-partial` | matched **some** of the query's words |
| `results-spoken` | matched only in the transcript |

---

## 4. Other fixes carried in the same pass

- 🇧🇬 **Multi-word highlighting worked for the first time.** `Highlight` looked
  for the whole query string with `indexOf`, which for a Bulgarian multi-word
  query is never present verbatim - so on exactly the queries this feature
  exists for, nothing was ever highlighted. Now per word, via
  `lib/search-tokens.ts`, shared with the title split so both use one definition
  of "a word that counts".
- 🚨 **The Postgres fallback matched multi-word queries as one literal
  substring.** `ILIKE '%историята с колата%'` requires those words adjacent and
  in order. With Meilisearch down, the fallback answered "nothing matches" to
  queries with hundreds of real hits. Now an AND across words, OR across fields.
  Same fix in `/search/suggest`.
- **Stop words moved to `podcast/search/querying.py`** and are imported by both
  index modules. They have to be the same list the API counts words by: a token
  the index erased can never match, so counting it would make every ordinary
  query look partial.

---

## 5. Round trips

`/api/search` is now **one** HTTP call to Meilisearch (`multi_search` of up to 3
queries); `/api/search/transcripts` is **two** (a batch of up to 4, then one
scoped passage fetch that cannot be issued until the page's episode ids are
known). Each individual query costs Meilisearch 0-6 ms and ~25 ms of round trip
on this box, so batching is most of the wall clock.

Measured end to end through the Django test client:

| query | `/api/search` | `/api/search/transcripts` |
| --- | --- | --- |
| `царичи` | 9 ms | 90 ms |
| `историята с колата` | 33 ms | 94 ms |

---

## 6. Contract changes

`SearchOut` gains `total_full` and `word_count`; `SearchHitOut` gains
`match_kind`. `TranscriptSearchOut` gains `total_episodes`,
`total_full_episodes` and `word_count`; `TranscriptHitOut` gains `match_kind`.

🚨 **`limit`/`offset` on `/api/search/transcripts` changed meaning** from segments
to episodes. `MAX_TRANSCRIPT_LIMIT` dropped 100 → 50 accordingly.
