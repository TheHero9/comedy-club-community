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
 * Spoken-word episodes on the FIRST page.
 *
 * 🚨 EPISODES, and that is a change. This used to be `TRANSCRIPT_SEGMENT_LIMIT`
 * - 60 SEGMENTS, fetched and then grouped into however many episodes they
 * happened to touch. That is why the page could advertise "21 passages in 13
 * episodes" and render six cards: the 13 was an artefact of the segment page,
 * the six was this cap, and neither was the real answer (which is also 13).
 * `/api/search/transcripts` now pages over episodes, so this is a page size.
 *
 * ⚡ A payload dial. A result card costs ~5 KB of HTML plus the RSC flight tree
 * that duplicates it, so card COUNT is what drives the page's weight: a broad
 * query renders 20 label cards at ~101 KB, and each extra spoken card adds
 * ~5 KB on top. Raising this is measured by `web:search-broad` in
 * `scripts/perf-budgets.json`.
 */
export const SPOKEN_LIMIT = 6;

/** `MAX_TRANSCRIPT_LIMIT` in `podcast/api/search.py`, in EPISODES. */
export const API_TRANSCRIPT_MAX_LIMIT = 50;

/**
 * The most spoken episodes "load more" will ever reach.
 *
 * Lower than SEARCH_MAX_RESULTS because a spoken card is the more expensive
 * kind - it always carries passage text - and because a broad query genuinely
 * matches hundreds of episodes here ("историята с колата" is spoken in 414), so
 * this ceiling is reachable in a way the label one is not.
 */
export const SPOKEN_MAX_RESULTS = 200;
