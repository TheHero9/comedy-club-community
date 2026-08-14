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
 */
export function cellDataAttributes(
  cell: GridCell,
  season: GridSeason,
  index: number,
): Record<string, string> {
  return {
    "data-cell": cell.youtube_id,
    "data-score": cell.score === null ? "" : String(cell.score),
    "data-band": cell.band ?? "",
    "data-count": String(cell.rating_count),
    "data-provisional": cell.is_provisional ? "1" : "",
    "data-position": `${season.year}:${index}`,
  };
}

/** Format the compact `data-position` value ("2021:14") for display. */
export function positionLabel(raw: string): string {
  const [year, index] = raw.split(":");
  if (!year || index === undefined) return "";
  return copy.episode.cellPosition(Number(year), Number(index));
}

/**
 * Recover the bare episode title from a cell's `aria-label`.
 *
 * `cellLabel` appends a fixed, finite set of machine suffixes after the title,
 * joined with " - ". Stripping known suffixes from the END is exact even when
 * the title itself contains " - ", because only trailing parts that byte-match
 * a marker (or the score / ratings-count patterns) are removed. The one
 * theoretical miss - a title that literally ends in one of the Bulgarian
 * marker phrases - would only trim the hover preview's heading, never data.
 */
export function titleFromCellLabel(label: string, ratingCount: number): string {
  const parts = label.split(" - ");

  // Last part is always the score or the unrated copy.
  const last = parts[parts.length - 1];
  if (last === copy.band.unrated || /^\d+(\.\d+)?\/10$/.test(last)) {
    parts.pop();
  }

  const markers = new Set<string>([
    copy.band.membersOnly,
    copy.band.stream,
    copy.band.provisional,
    ...(ratingCount > 0 ? [copy.episode.ratings(ratingCount)] : []),
  ]);
  while (parts.length > 1 && markers.has(parts[parts.length - 1])) {
    parts.pop();
  }

  return parts.join(" - ");
}
