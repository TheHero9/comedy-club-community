/**
 * Page-size limits for /search, in one place so the tests cannot drift.
 *
 * These live outside `app/search/page.tsx` because the e2e suite asserts the
 * rendered card counts against them. A route segment may only export the
 * handful of names Next reserves, so a shared module is the way both sides read
 * the same number - the same reason `MAX_API_LIMIT` lives in `filter-model.ts`.
 */

/** Label-matched episodes on the FIRST page of `/api/search`. */
export const RESULT_LIMIT = 20;

/**
 * The API's own per-request ceiling (`MAX_LIMIT` in `podcast/api/search.py`).
 * Anything beyond this has to be fetched as a second offset page.
 */
export const API_SEARCH_MAX_LIMIT = 50;

/**
 * The most results "load more" will ever reach.
 *
 * 🚨 A cap, and deliberately one. The owner asked for search not to be capped,
 * and in practice this is not: the broadest Bulgarian query in the corpus
 * returns well under 500, so every real search is fully reachable. What the
 * ceiling actually stops is `?n=100000` turning one request into 2,000 parallel
 * calls against the API - an unbounded page size read straight off the query
 * string is a denial-of-service lever, not a feature.
 *
 * The first page stays at RESULT_LIMIT. That is what `web:search-broad`
 * measures, so growing the reachable maximum costs the budget nothing until a
 * user actually asks for more.
 */
export const SEARCH_MAX_RESULTS = 500;

/**
 * ⚠️ SEGMENTS, not episodes. `/api/search/transcripts` pages over passages and
 * only then groups them by episode, so this buys episode coverage at a poor
 * exchange rate - several passages routinely collapse into one card. 60
 * segments returned 29-39 distinct episodes across the sampled queries, which
 * comfortably covers a first page, and costs ~10 ms of Meilisearch time.
 */
export const TRANSCRIPT_SEGMENT_LIMIT = 60;

/**
 * Transcript-only episodes appended below the label matches.
 *
 * ⚡ A payload dial. A result card costs ~5 KB of HTML plus the RSC flight tree
 * that duplicates it, so card COUNT is what drives the page's weight: a broad
 * query renders 20 label cards at ~101 KB, and each extra spoken card adds
 * ~5 KB on top. Raising this is measured by `web:search-broad` in
 * `scripts/perf-budgets.json`; past its ceiling /search needs pagination rather
 * than a bigger budget.
 */
export const SPOKEN_EPISODE_LIMIT = 6;
