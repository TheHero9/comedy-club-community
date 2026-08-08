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
 */
import Link from "next/link";
import { Crown, Radio, TriangleAlert } from "lucide-react";

import type { Schema } from "@ccc/api-types";
import { copy } from "@/lib/copy";
import { bandStyle, formatScore } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

type Grid = Schema<"ChannelGridOut">;
type Cell = Schema<"GridCellOut">;

interface RatingsGridProps {
  grid: Grid;
}

function GridCell({ cell }: { cell: Cell | null }) {
  // A season shorter than the tallest one leaves a hole. It must read as absent,
  // never as a zero score.
  if (!cell) {
    return <td className="p-0.5" aria-hidden />;
  }

  const style = bandStyle(cell.band);
  const label = `${cell.title} - ${
    cell.score === null ? copy.grid.notRated : `${formatScore(cell.score)}/10`
  }`;

  return (
    <td className="p-0.5">
      <Link
        href={`/e/${cell.youtube_id}`}
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

  return (
    <div className="space-y-4">
      {/* Wide grids scroll INSIDE this container - the page body must never
          scroll horizontally on a phone. The year column is sticky so it stays
          readable while the episodes scroll under it. */}
      <div className="overflow-x-auto pb-2">
        <table className="border-separate border-spacing-0">
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
                  className="px-0.5 pb-1 text-center text-[11px] font-normal tabular-nums text-muted-foreground"
                >
                  {row.index}
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
                  <span className="flex flex-col leading-tight">
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
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <GridLegend grid={grid} />
    </div>
  );
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
