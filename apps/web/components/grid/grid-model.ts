import type { Schema } from "@ccc/api-types";

import { copy } from "@/lib/copy";
import { formatScore } from "@/lib/format";

export type Grid = Schema<"ChannelGridOut">;
export type GridCell = Schema<"GridCellOut">;
export type GridSeason = Schema<"GridSeasonOut">;

/**
 * 🚨 DENSITY IS SCALE-DEPENDENT, and the redesign was drawn against the small
 * channel (3 years, 37 episodes in the busiest one).
 *
 * The other channel in this database is 11 years with 184 episodes in its
 * busiest year. The transposed mobile grid the design specifies puts years on
 * the horizontal axis, which is exactly the right call at 3 years (348px, no
 * horizontal scroll at all) and exactly the wrong one at 11 (1,012px of
 * sideways scrolling, and 184 rows of vertical page scroll under a year header
 * that cannot stay sticky inside a horizontal scroller).
 *
 * So the grid has two modes, chosen from the data rather than the viewport:
 *
 * - ROOMY: the design as drawn. Transposed on mobile, years-as-rows with 54x44
 *   cells on desktop, the score printed in every cell.
 * - DENSE: years-as-rows at every width, colour-only chips, score in the
 *   accessible name and the preview. This is the pre-existing behaviour that
 *   `specs/03-redesign` already asked for ("a compressed cell without the
 *   number") and it is the only thing that makes a decade of a near-daily
 *   podcast scannable at all.
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
 * 11px. At 5 it is ~58px, which cannot, so those channels go dense instead.
 */
export const ROOMY_MAX_SEASONS = 4;

/** Past ~48 columns the desktop grid is more sideways scroll than heatmap. */
export const ROOMY_MAX_ROWS = 48;

/** Above 3 years the mobile cell has to give up padding and marker size. */
export const TIGHT_FROM_SEASONS = 4;

export function isRoomy(grid: Grid): boolean {
  return (
    grid.seasons.length <= ROOMY_MAX_SEASONS && grid.rows.length <= ROOMY_MAX_ROWS
  );
}

/** Show a column number every Nth column in dense mode; the rest stay sr-only. */
export const DENSE_HEADER_EVERY = 10;

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
 * `data-flags` carries the two booleans the parser cannot otherwise know
 * (members-only, stream) and is OMITTED entirely when both are false, which is
 * ~97% of the corpus - so exactness here costs almost nothing.
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
    "data-score": cell.score === null ? "" : String(cell.score),
    "data-band": cell.band ?? "",
    "data-count": String(cell.rating_count),
    "data-provisional": cell.is_provisional ? "1" : "",
    "data-position": `${season.year}:${index}`,
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
