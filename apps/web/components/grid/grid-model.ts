import type { Schema } from "@ccc/api-types";

import { copy } from "@/lib/copy";

/**
 * The id `RatingsGrid` renders and every deep link targets.
 *
 * 🚨 Shared, not restated. An episode page links to `#<GRID_ANCHOR>` on the
 * channel page; the previous attempt hard-coded `#year-<n>`, nothing carried
 * that id, and the button silently jumped nowhere.
 */
export const GRID_ANCHOR = "ratings-grid";
import { formatScore } from "@/lib/format";

export type Grid = Schema<"ChannelGridOut">;
export type GridCell = Schema<"GridCellOut">;
export type GridSeason = Schema<"GridSeasonOut">;

/**
 * 🚨 TWO INDEPENDENT DECISIONS, and they used to be one.
 *
 * Until 2026-08-16 a single `isRoomy` answered both "does the mobile grid
 * transpose?" and "does a cell print its score?", because both were really the
 * same question about the WIDTH of a matrix: years-as-rows put every episode of
 * the busiest year on one horizontal axis, so a 183-episode year was 3,913px
 * wide and only the first ~52 columns were on a laptop screen.
 *
 * The desktop/dense matrix is gone - the grid now WRAPS (see `seasonCells` and
 * `FlowGrid`), so nothing is ever wider than its container and there is no
 * width to run out of. What is left are two unrelated constraints:
 *
 * - `hasMobileTranspose` is about COLUMN WIDTH at 390px. The transposed table
 *   is `table-fixed` with one column per year, so the year count alone decides
 *   whether a cell can still hold a score plus three markers.
 * - `printsScores` is about TOTAL PAGE HEIGHT. A wrapped run of 54x44 cells
 *   fits ~19 per line on a laptop, so the episode count alone decides whether
 *   printing every score is a readable page or a five-screen scroll.
 *
 * Both modes ship the SAME links, the same accessible names and the same
 * preview, so nothing is lost but the printed digits.
 */

/**
 * 4 years is the ceiling for the transposed mobile grid.
 *
 * The mobile table is `table-fixed`, so columns always divide the 358px of
 * content width evenly and the page can never scroll sideways. At 3 years that
 * is ~102px per cell, which is what the design was measured at. At 4 it is
 * ~75px, which still prints a score plus three markers once the markers drop to
 * 11px. At 5 it is ~58px, which cannot.
 */
export const ROOMY_MAX_SEASONS = 4;

/**
 * Past ~48 episodes in the tallest year the transposed table is 48 rows of
 * vertical scroll per column, which is more list than heatmap.
 */
export const ROOMY_MAX_ROWS = 48;

/** Above 3 years the mobile cell has to give up padding and marker size. */
export const TIGHT_FROM_SEASONS = 4;

/**
 * 🚨 The ceiling for printed scores, measured in EPISODES - not in years and
 * not in rows.
 *
 * A 54x44 cell with 4px of gap wraps ~19 to a line in the 1,120px the card
 * gives it, so 400 episodes is ~21 lines plus a header per year: about two
 * screens of laptop, which is a page you scroll through rather than a page you
 * give up on. The flagship channel's 1,225 would be ~65 lines - five screens -
 * so it stays colour-only, where the same 1,225 cells are ~23 lines.
 *
 * ⚠️ This is deliberately NOT tuned to the current catalogue's exact numbers.
 * The largest channel under it today is 243 episodes; the gap to 400 is
 * headroom for those channels to keep growing without the page silently
 * flipping density on the morning they cross a line.
 */
export const ROOMY_MAX_EPISODES = 400;

/**
 * Does the mobile grid transpose (episodes as rows, years as columns)?
 *
 * False means mobile sees the same wrapped flow grid the laptop does.
 */
export function hasMobileTranspose(grid: Grid): boolean {
  return (
    grid.seasons.length <= ROOMY_MAX_SEASONS && grid.rows.length <= ROOMY_MAX_ROWS
  );
}

/** Does every cell print its score, or is the flow grid colour-only? */
export function printsScores(grid: Grid): boolean {
  return grid.total_count <= ROOMY_MAX_EPISODES;
}

/**
 * One season's episodes, oldest first, with their position within the year.
 *
 * 🚨 The payload is a MATRIX (`rows[position].cells[season]`) padded to the
 * tallest year, so a short year carries trailing `null`s. The flow layout has
 * no columns to keep aligned, so it drops those holes entirely rather than
 * rendering them as spacers - 788 of them on the flagship channel. In the
 * matrix a hole was load-bearing (remove one and the years shear); here it is
 * pure weight, and an empty chip in a wrapped run reads as "an episode we know
 * nothing about" rather than as "this year was shorter".
 *
 * `index` is the API's own 1-based `row.index`, NOT the position in this array.
 * They agree today because holes only ever trail, but deriving one from the
 * other would silently renumber a year the moment that stops being true.
 */
export function seasonCells(
  grid: Grid,
  seasonIndex: number,
): { cell: GridCell; index: number }[] {
  const out: { cell: GridCell; index: number }[] = [];
  for (const row of grid.rows) {
    const cell = row.cells[seasonIndex];
    if (cell) out.push({ cell, index: row.index });
  }
  return out;
}

/**
 * The full accessible name for a cell.
 *
 * In dense mode this is the ONLY description a cell has - no icons, no printed
 * score - so everything the roomy cell shows visually has to be in here.
 *
 * 🚨 The score stays LAST. `e2e/a11y.spec.ts` asserts the accessible name ends
 * with `<score>/10`, and that is also the right order to hear it: the title
 * identifies the cell, the score is the answer you came for.
 */
export function cellLabel(cell: GridCell): string {
  const parts: string[] = [cell.title];

  if (cell.members_only) parts.push(copy.band.membersOnly);
  if (cell.content_kind === "stream") parts.push(copy.band.stream);
  if (cell.is_provisional) parts.push(copy.band.provisional);
  if (cell.rating_count > 0) parts.push(copy.episode.ratings(cell.rating_count));

  parts.push(
    cell.score === null ? copy.band.unrated : `${formatScore(cell.score)}/10`,
  );

  return parts.join(" - ");
}

/**
 * Everything the preview needs that is not worth a network round trip.
 *
 * `GridCellOut` is deliberately lean (every field is multiplied by 1,318), so
 * the date, duration and thumbnail come from `/api/episodes/{youtube_id}` when
 * the preview actually opens. These attributes cover the instant paint.
 *
 * 🚨 No `data-title`, deliberately - same lesson as the removed `title`
 * attribute (2026-08-11). The full episode title already ships in `aria-label`,
 * and a second copy cost 135.5 KB of HTML on the 1,318-cell page - then again
 * in the RSC flight payload, which serializes the whole tree a second time.
 * The preview recovers the bare title with `titleFromCellLabel`.
 *
 * `data-position` is the compact `year:index` pair, not the localized sentence:
 * the sentence weighed 49 KB across the big grid and the client can format it
 * with the same copy function at hover time.
 *
 * 🚨 EVERY attribute here is omitted when it carries its default. An attribute
 * multiplied by 1,318 cells is never free: `data-provisional=""` alone was
 * 24.5 KB of HTML, and the RSC flight payload serializes the whole tree a
 * second time, so each byte is charged twice. An unrated episode - 71% of the
 * catalogue - now ships three attributes instead of six.
 *
 * The reader in `GridInteraction.readCell` already defaults every one of these
 * to exactly the value being omitted, so absence and default are the same
 * thing to it. `data-cell` stays unconditional: it is the delegation selector.
 *
 * `data-flags` carries the two booleans the label parser cannot otherwise know
 * (members-only, stream), and is likewise absent on the ~97% of cells that are
 * neither - which is what makes the exact title recovery nearly free.
 */
export function cellDataAttributes(
  cell: GridCell,
  season: GridSeason,
  index: number,
): Record<string, string> {
  const flags =
    (cell.members_only ? FLAG_MEMBERS_ONLY : "") +
    (cell.content_kind === "stream" ? FLAG_STREAM : "");

  return {
    "data-cell": cell.youtube_id,
    "data-position": `${season.year}:${index}`,
    ...(cell.score === null ? {} : { "data-score": String(cell.score) }),
    ...(cell.band ? { "data-band": cell.band } : {}),
    ...(cell.rating_count > 0 ? { "data-count": String(cell.rating_count) } : {}),
    ...(cell.is_provisional ? { "data-provisional": "1" } : {}),
    ...(flags ? { "data-flags": flags } : {}),
  };
}

export const FLAG_MEMBERS_ONLY = "m";
export const FLAG_STREAM = "s";

/**
 * Format the compact `data-position` value ("2021:14") for display.
 *
 * Anything malformed degrades to "" rather than rendering "епизод NaN" - the
 * attribute can be stale (a cached page from an older build) or hand-edited.
 */
export function positionLabel(raw: string): string {
  const [rawYear, rawIndex, ...rest] = raw.split(":");
  if (rest.length > 0) return "";
  const year = Number(rawYear);
  const index = Number(rawIndex);
  if (!rawYear || !rawIndex || !Number.isFinite(year) || !Number.isFinite(index)) {
    return "";
  }
  return copy.episode.cellPosition(year, index);
}

export interface CellLabelFlags {
  ratingCount: number;
  provisional: boolean;
  membersOnly: boolean;
  stream: boolean;
}

/**
 * Recover the bare episode title from a cell's `aria-label`.
 *
 * 🚨 This is the EXACT inverse of `cellLabel`, not a heuristic, and it has to
 * stay that way: since 2026-08-14 the aria-label is the only copy of the title
 * a cell ships. It walks the suffixes in reverse append order and pops each one
 * AT MOST ONCE, and only when the cell's own flags say that suffix was
 * appended. Both halves of that matter - a first attempt used an unconditional
 * marker set in a `while` loop, which mangled two real title shapes:
 *
 *   - a plain video titled "На живо - Стрийм" lost its last word, because
 *     "Стрийм" was stripped from a cell that is not a stream at all;
 *   - an actual stream titled "Иван Кирков - Стрийм" lost it too, because the
 *     loop popped the real marker and then the title's own trailing word.
 *
 * Callers pass the flags straight off the cell's data attributes.
 */
export function titleFromCellLabel(label: string, flags: CellLabelFlags): string {
  const parts = label.split(" - ");

  const popIf = (present: boolean, expected: string) => {
    if (present && parts.length > 1 && parts[parts.length - 1] === expected) {
      parts.pop();
    }
  };

  // The score (or the unrated copy) is always last.
  const last = parts[parts.length - 1];
  if (parts.length > 1 && (last === copy.band.unrated || SCORE_SUFFIX.test(last))) {
    parts.pop();
  }

  // Reverse of cellLabel's append order.
  popIf(flags.ratingCount > 0, copy.episode.ratings(flags.ratingCount));
  popIf(flags.provisional, copy.band.provisional);
  popIf(flags.stream, copy.band.stream);
  popIf(flags.membersOnly, copy.band.membersOnly);

  return parts.join(" - ");
}

const SCORE_SUFFIX = /^\d+(\.\d+)?\/10$/;
