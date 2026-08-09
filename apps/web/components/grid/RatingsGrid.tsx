/**
 * IMDb / SeriesGraph style ratings heatmap for one channel.
 *
 * A podcast has no seasons, so ONE CALENDAR YEAR = ONE SEASON. Rows are years and
 * columns are the episode's position within that year. Reading across a row walks
 * the year in order; reading down a column compares the same point across years.
 *
 * The API sends the grid episode-major (`rows[episodeIndex].cells[seasonIndex]`),
 * so it is transposed here at render time rather than in the payload.
 *
 * Server Component: it renders from data the page already fetched, so the grid is
 * in the initial HTML and is indexable.
 *
 * 🚨 DENSITY IS SCALE-DEPENDENT. A near-daily podcast puts ~184 episodes in its
 * busiest year, and 184 columns of 56px cell is a 10,700px table - roughly 27
 * phone screens of sideways scrolling. Above `COMPACT_ABOVE_COLUMNS` the grid
 * switches to a colour-only chip: same table, same cells, same links, same
 * accessible names, but the score moves out of the cell body and into the
 * tooltip / accessible name. See `specs/03-redesign/03-page-map.md` section 3.1,
 * which asks for exactly this ("a compressed cell without the number").
 */
import Link from "next/link";
import { Crown, Radio, TriangleAlert } from "lucide-react";

import type { Schema } from "@ccc/api-types";
import { copy } from "@/lib/copy";
import { bandStyle, formatScore } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

type Grid = Schema<"ChannelGridOut">;
type Cell = Schema<"GridCellOut">;

/**
 * Above this many columns the grid stops printing the score inside the cell.
 *
 * 48 columns is about 2,700px at the comfortable 56px cell: the widest a heatmap
 * can get before the numbers stop being scannable and the horizontal scroll
 * becomes the whole experience. Every channel with under a year of weekly
 * episodes stays comfortable; the near-daily ones go compact.
 */
const COMPACT_ABOVE_COLUMNS = 48;

/** Show a column number every Nth column in compact mode; the rest stay sr-only. */
const COMPACT_HEADER_EVERY = 10;

/**
 * Hover and focus treatment for compact cells, applied ONCE on the table as
 * descendant rules instead of on every one of 1,300+ cells.
 *
 * The comfortable cell can afford to carry these utilities itself; at compact
 * scale the identical ~250-character string on every cell is ~330 KB of HTML for
 * styling that never varies. The only `<a>` inside the table is a grid cell, and
 * `[&_...]` descendant variants are the same mechanism `components/ui/button.tsx`
 * already relies on, so they are known to compile in this project.
 */
const COMPACT_INTERACTION = [
  "[&_a]:transition-transform",
  "[&_a:hover]:z-10 [&_a:hover]:scale-150 [&_a:hover]:ring-2 [&_a:hover]:ring-ring",
  "[&_a:focus-visible]:z-10 [&_a:focus-visible]:scale-150 [&_a:focus-visible]:outline-none",
  "[&_a:focus-visible]:ring-2 [&_a:focus-visible]:ring-ring",
].join(" ");

/**
 * Project rule: no user-facing string hardcoded inside a component. These are
 * grid-scale specific, so they live in this module-level const rather than in
 * the shared copy map.
 */
const GRID_SCALE_COPY = {
  compactNotice:
    "This channel has too many episodes per year to print a score in every cell, so cells show only their band colour. Hover or tap a cell for its title and score.",
} as const;

/** Markers folded into the accessible name, since compact cells draw no icons. */
const CELL_MARKERS = {
  provisional: copy.grid.provisional,
  membersOnly: copy.grid.membersOnly,
  stream: copy.grid.stream,
} as const;

/**
 * The full accessible name for a cell.
 *
 * This is the ONLY description a compact cell has - its icons are gone and its
 * score is not printed - so everything the comfortable cell shows visually has
 * to be in here. It is also the desktop `title` tooltip.
 */
function cellLabel(cell: Cell): string {
  const parts: string[] = [cell.title];

  if (cell.members_only) parts.push(CELL_MARKERS.membersOnly);
  if (cell.content_kind === "stream") parts.push(CELL_MARKERS.stream);
  if (cell.is_provisional) parts.push(CELL_MARKERS.provisional);
  if (cell.rating_count > 0) parts.push(copy.episode.ratings(cell.rating_count));

  // 🚨 The score stays LAST. `e2e/a11y.spec.ts` 12.3 asserts the accessible name
  // ends with `<score>/10`, and that ordering is also the right one to hear: the
  // title identifies the cell, the score is the answer you came for.
  parts.push(
    cell.score === null ? copy.grid.notRated : `${formatScore(cell.score)}/10`,
  );

  return parts.join(" - ");
}

function GridCell({ cell, compact }: { cell: Cell | null; compact: boolean }) {
  // A season shorter than the tallest one leaves a hole. It must read as absent,
  // never as a zero score.
  if (!cell) {
    return <td className={compact ? "p-px" : "p-0.5"} aria-hidden />;
  }

  const style = bandStyle(cell.band);
  const label = cellLabel(cell);
  const href = `/e/${cell.youtube_id}`;

  if (compact) {
    // Colour only, and the class list is deliberately minimal: it is repeated
    // once per episode, so at 1,300+ episodes every character costs ~1.3 KB of
    // HTML. The hover and focus treatment lives on the table instead, as a
    // single descendant rule (`COMPACT_INTERACTION`) rather than 250 characters
    // of utilities stamped onto every cell.
    // 20px wide keeps a decade of a near-daily podcast inside ~4,000px instead
    // of ~11,000px; 24px tall buys back touch target without costing width.
    return (
      <td className="p-px">
        <Link
          href={href}
          title={label}
          aria-label={label}
          className={cn("relative block h-6 w-5 rounded-[3px]", style.cell)}
        />
      </td>
    );
  }

  return (
    <td className="p-0.5">
      <Link
        href={href}
        title={label}
        aria-label={label}
        className={cn(
          "relative flex h-9 w-14 items-center justify-center rounded-sm text-[13px] font-semibold tabular-nums",
          "transition-transform hover:z-10 hover:scale-110 hover:ring-2 hover:ring-ring",
          "focus-visible:z-10 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          style.cell,
        )}
      >
        {formatScore(cell.score)}
        {/* Too few ratings to trust the band - shown, but flagged. */}
        {cell.is_provisional ? (
          <TriangleAlert
            className="absolute right-0.5 top-0.5 h-2.5 w-2.5 opacity-70"
            aria-hidden
          />
        ) : null}
        {cell.members_only ? (
          <Crown className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 opacity-70" aria-hidden />
        ) : null}
        {cell.content_kind === "stream" ? (
          <Radio className="absolute bottom-0.5 left-0.5 h-2.5 w-2.5 opacity-70" aria-hidden />
        ) : null}
      </Link>
    </td>
  );
}

export function RatingsGrid({ grid }: RatingsGridProps) {
  if (grid.seasons.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{copy.grid.empty}</p>
    );
  }

  // The API's `rows` are episode positions, which become the rendered COLUMNS.
  const compact = grid.rows.length > COMPACT_ABOVE_COLUMNS;

  return (
    <div className="space-y-4">
      {/* Wide grids scroll INSIDE this container - the page body must never
          scroll horizontally on a phone. The year column is sticky so it stays
          readable while the episodes scroll under it.

          🚨 `relative` is load-bearing, not decoration. Tailwind's `sr-only` is
          `position: absolute`, so without a positioned ancestor those spans
          resolve their containing block ABOVE this scroller and are therefore
          not clipped by its overflow - they stretch the document instead. In
          compact mode ~90% of the column headers are `sr-only`, so a 4,116px
          table made the whole page scroll sideways at 390px. Two sr-only nodes
          in comfortable mode made this invisible until a channel got big.
          Measured: documentElement.scrollWidth 4121 -> 390. */}
      <div className="relative overflow-x-auto pb-2">
        <table
          className={cn(
            "border-separate border-spacing-0",
            compact && COMPACT_INTERACTION,
          )}
        >
          <caption className="sr-only">{copy.grid.caption(grid.channel_name)}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 bg-background pr-2 text-left"
              >
                <span className="sr-only">{copy.grid.yearColumn}</span>
              </th>
              {grid.rows.map((row) => (
                <th
                  key={row.index}
                  scope="col"
                  className={cn(
                    "pb-1 text-center font-normal tabular-nums text-muted-foreground",
                    compact ? "px-0 text-[9px]" : "px-0.5 text-[11px]",
                  )}
                >
                  {/* A 3-digit number does not fit a 20px column, so compact
                      mode prints every 10th and keeps the rest for screen
                      readers. The header's text content is unchanged either
                      way, so every column still announces its position. */}
                  {compact && row.index % COMPACT_HEADER_EVERY !== 0 ? (
                    <span className="sr-only">{row.index}</span>
                  ) : (
                    row.index
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {grid.seasons.map((season, seasonIndex) => (
              <tr key={season.year}>
                <th
                  scope="row"
                  className="sticky left-0 z-20 bg-background pr-3 text-left align-middle"
                >
                  <span
                    className={cn(
                      "flex leading-tight",
                      // A 20px compact row cannot carry two stacked lines, so
                      // the year and its average sit side by side instead.
                      compact ? "items-baseline gap-1.5" : "flex-col",
                    )}
                  >
                    <span className="text-xs font-medium">{season.label}</span>
                    <span className="text-[10px] font-normal tabular-nums text-muted-foreground">
                      {season.average === null
                        ? copy.grid.averageRow
                        : copy.grid.seasonAverage(season.average.toFixed(1))}
                    </span>
                  </span>
                </th>
                {grid.rows.map((row) => (
                  <GridCell
                    key={row.index}
                    cell={row.cells[seasonIndex] ?? null}
                    compact={compact}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {compact ? (
        <p className="text-xs text-muted-foreground">
          {GRID_SCALE_COPY.compactNotice}
        </p>
      ) : null}

      {/* 🚨 The legend must stay the LAST child of this container. */}
      <GridLegend grid={grid} />
    </div>
  );
}

interface RatingsGridProps {
  grid: Grid;
}

function GridLegend({ grid }: { grid: Grid }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {grid.bands.map((band) => (
        <span key={band.key} className="flex items-center gap-1.5">
          <span
            className={cn("h-3 w-3 rounded-sm", bandStyle(band.key).swatch)}
            aria-hidden
          />
          {band.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-muted" aria-hidden />
        {copy.grid.notRated}
      </span>
      <span className="flex items-center gap-1.5">
        <TriangleAlert className="h-3 w-3" aria-hidden />
        {copy.grid.provisional}
      </span>
      <span className="flex items-center gap-1.5">
        <Crown className="h-3 w-3" aria-hidden />
        {copy.grid.membersOnly}
      </span>
      <span className="flex items-center gap-1.5">
        <Radio className="h-3 w-3" aria-hidden />
        {copy.grid.stream}
      </span>
    </div>
  );
}
