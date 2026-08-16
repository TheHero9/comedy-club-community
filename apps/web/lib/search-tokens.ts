/**
 * Splitting a search query into the words that carry meaning.
 *
 * 🇧🇬 This is the web-side twin of `content_tokens` in
 * `apps/api/podcast/search/querying.py`, and it exists for two jobs that both
 * used to treat the query as one opaque string:
 *
 *   - deciding whether a hit's words landed in the TITLE, which drives the
 *     title-first section split
 *   - highlighting the matched words inside a label, which with a two-word query
 *     highlighted nothing at all, because "историята колата" is never a literal
 *     substring of anything
 *
 * ⚠️ The stop-word list here is deliberately SHORT next to the API's. The API's
 * list is index settings - a word on it is erased from the documents, so it can
 * never match. This one only decides presentation, and over-stripping here would
 * hide a legitimate highlight. Where the two overlap they must agree; where they
 * do not, this one errs toward keeping the word.
 */

/** 🇧🇬 One- and two-letter Bulgarian function words, which match any text at all. */
const STOP_WORDS = new Set([
  "а",
  "в",
  "да",
  "е",
  "за",
  "и",
  "или",
  "не",
  "но",
  "от",
  "по",
  "с",
  "са",
  "се",
  "си",
  "със",
  "то",
  "че",
  "ще",
  "the",
  "of",
  "and",
]);

/**
 * Tokens of one or two characters are dropped whatever they are: they are
 * prepositions and particles, and a two-character needle matches most titles.
 */
const MIN_TOKEN_LENGTH = 3;

export function queryTokens(query: string): string[] {
  return query
    .toLocaleLowerCase("bg")
    .split(/\s+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(token));
}

/**
 * True when any meaningful word of the query appears in the title.
 *
 * Token overlap, not a substring test: a multi-word Bulgarian query almost
 * never appears verbatim in a title, so `includes(query)` would put nearly
 * everything in the "everywhere else" bucket and the split would do nothing.
 */
export function titleMatchesQuery(title: string, query: string): boolean {
  const haystack = title.toLocaleLowerCase("bg");
  const tokens = queryTokens(query);

  if (tokens.length === 0) {
    // A query made entirely of short words: fall back to the whole string, so
    // the section is never empty for a reason the reader cannot see.
    return haystack.includes(query.toLocaleLowerCase("bg"));
  }
  return tokens.some((token) => haystack.includes(token));
}

export interface HighlightRun {
  text: string;
  hit: boolean;
}

/**
 * Split `text` into runs, marking the ones that match a query word.
 *
 * 🚨 Per WORD, not per query. Search is typo tolerant, so the matched text
 * often does not contain the query literally; with a multi-word query it
 * essentially never does, and the old whole-string `indexOf` therefore
 * highlighted nothing on exactly the queries this app is built for.
 *
 * Runs are found by scanning left to right and taking the earliest match of any
 * token, so overlapping tokens cannot double-highlight and the output is always
 * a clean partition of the input. When nothing matches, the text comes back as
 * one un-hit run - a highlight on the wrong word is worse than none, because it
 * claims a match that did not happen.
 */
export function highlightRuns(text: string, query: string): HighlightRun[] {
  const tokens = queryTokens(query);
  const needles = tokens.length > 0 ? tokens : [query.trim().toLocaleLowerCase("bg")];
  const haystack = text.toLocaleLowerCase("bg");

  const runs: HighlightRun[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let bestAt = -1;
    let bestLength = 0;

    for (const needle of needles) {
      if (needle.length === 0) continue;
      const at = haystack.indexOf(needle, cursor);
      if (at === -1) continue;
      // Earliest wins; on a tie the longer token wins, so "колата" is preferred
      // over "кола" starting at the same character.
      if (bestAt === -1 || at < bestAt || (at === bestAt && needle.length > bestLength)) {
        bestAt = at;
        bestLength = needle.length;
      }
    }

    if (bestAt === -1) {
      runs.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (bestAt > cursor) {
      runs.push({ text: text.slice(cursor, bestAt), hit: false });
    }
    runs.push({ text: text.slice(bestAt, bestAt + bestLength), hit: true });
    cursor = bestAt + bestLength;
  }

  return runs.filter((run) => run.text.length > 0);
}
