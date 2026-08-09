import { Crown, Radio, TriangleAlert } from "lucide-react";

import { GridInteraction } from "@/components/grid/GridInteraction";
import {
  cellDataAttributes,
  cellLabel,
  DENSE_HEADER_EVERY,
  isRoomy,
  TIGHT_FROM_SEASONS,
  type Grid,
  type GridCell,
  type GridSeason,
} from "@/components/grid/grid-model";
import { copy } from "@/lib/copy";
import { formatScore } from "@/lib/format";
import { bandStyle } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

/**
 * The ratings grid. One calendar year is one season.
 *
 * 🚨 THE MOBILE GRID IS TRANSPOSED, and that is the single most important
 * structural decision in the redesign.
 *
 * Years-as-rows at 390px makes a 2,100px strip for three years. Reaching
 * episode 30 of 2025 means scrolling sideways past 29 cells with no landmarks,
 * the sticky year column eats 90px of a 390px screen, and cells have to shrink
 * to about 56x36 to feel worth scrolling - which fails the 44px touch target,
 * and then three markers have to stack in the corners of a chip smaller than a
 * fingertip.
 *
 * Transposing turns the wide axis into the short one. Three years is three
 * columns of about 98px, so the grid fits with NO horizontal scroll at all and
 * the long axis becomes ordinary vertical page scroll. Cells get 44px of
 * height and enough width for the score plus all three markers in a row.
 *
 * Server Component: it renders from data the page already fetched, so the grid
 * is in the initial HTML and every cell is a crawlable link to its episode.
 * `GridInteraction` layers the preview on top by event delegation rather than
 * by making 2,024 cells into client components.
 */
interface RatingsGridProps {
  grid: Grid;
}

export function RatingsGrid({ grid }: RatingsGridProps) {
  if (grid.seasons.length === 0) {
    return <p className="text-small text-subtle-foreground">{copy.channel.empty}</p>;
  }

  const roomy = isRoomy(grid);

  return (
    <GridInteraction>
      {roomy ? (
        <>
          <MobileGrid grid={grid} />
          <DesktopGrid grid={grid} />
        </>
      ) : (
        <DenseGrid grid={grid} />
      )}
      <GridLegend grid={grid} />
    </GridInteraction>
  );
}

/* -------------------------------------------------------------------------
   Roomy: mobile, transposed. Episodes are rows, years are columns.
   ------------------------------------------------------------------------- */

function MobileGrid({ grid }: { grid: Grid }) {
  // `table-fixed` is what guarantees the promise that the page never scrolls
  // sideways: columns always divide the available width evenly, whatever the
  // year count, instead of being pushed out by a min-width.
  const tight = grid.seasons.length >= TIGHT_FROM_SEASONS;

  return (
    <div className="mt-3.5 md:hidden">
      <table
        data-grid="mobile"
        className="w-full table-fixed border-separate border-spacing-[5px]"
      >
        <caption className="sr-only">
          {copy.channel.gridLabel(grid.channel_name)}
        </caption>
        <colgroup>
          <col className="w-9" />
          {grid.seasons.map((season) => (
            <col key={season.year} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {/* Sticky lives on the cells, not the row: a `position: sticky` row
                is ignored in several engines, and this has to hold under the
                54px app header for 37 rows of vertical scroll. */}
            <th
              scope="col"
              className="sticky top-[54px] z-20 bg-background"
            >
              <span className="sr-only">{copy.channel.episodeColumn}</span>
            </th>
            {grid.seasons.map((season) => (
              <th
                key={season.year}
                scope="col"
                className="sticky top-[54px] z-20 bg-background pb-1.5 align-bottom"
              >
                <span className="flex flex-col items-center gap-px">
                  <span className="font-display text-[14px] font-bold text-foreground">
                    {season.label}
                  </span>
                  <span className="font-mono text-[10.5px] font-normal text-subtle-foreground tabular">
                    {season.average === null ? "" : season.average.toFixed(1)}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.index}>
              <th
                scope="row"
                className="bg-background pr-1.5 text-right align-middle font-mono text-[10.5px] font-normal text-faint-foreground tabular"
              >
                {row.index}
              </th>
              {grid.seasons.map((season, seasonIndex) => (
                <td key={season.year} className="p-0">
                  <RoomyCell
                    cell={row.cells[seasonIndex] ?? null}
                    season={season}
                    index={row.index}
                    orientation="mobile"
                    tight={tight}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Roomy: desktop. Years are rows, position in the year is the column.
   ------------------------------------------------------------------------- */

function DesktopGrid({ grid }: { grid: Grid }) {
  return (
    <div className="mt-4 hidden rounded-3xl border border-border bg-card-2 py-4 md:block">
      {/* 🚨 The only overflow-x container on the page. `relative` is
          load-bearing: Tailwind's `sr-only` is `position: absolute`, so without
          a positioned ancestor those spans resolve their containing block above
          this scroller, escape its overflow and stretch the document instead.
          Measured once at documentElement.scrollWidth 4121 on a 390px screen. */}
      <div className="relative overflow-x-auto px-4">
        <table data-grid="desktop" className="w-max border-separate border-spacing-1">
          <caption className="sr-only">
            {copy.channel.gridLabel(grid.channel_name)}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-20 w-[88px] bg-card-2">
                <span className="sr-only">{copy.channel.yearColumn}</span>
              </th>
              {grid.rows.map((row) => (
                <th
                  key={row.index}
                  scope="col"
                  className="w-[54px] pb-1 text-center font-mono text-[10.5px] font-normal text-faint-foreground tabular"
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
                  className="sticky left-0 z-20 w-[88px] bg-card-2 pr-3 text-left align-middle"
                >
                  <span className="flex flex-col">
                    <span className="font-display text-[15px] font-bold text-foreground">
                      {season.label}
                    </span>
                    <span className="font-mono text-[11px] font-normal text-subtle-foreground tabular">
                      {season.average === null
                        ? ""
                        : copy.channel.seasonAverage(season.average.toFixed(1))}
                    </span>
                  </span>
                </th>
                {grid.rows.map((row) => (
                  <td key={row.index} className="p-0">
                    <RoomyCell
                      cell={row.cells[seasonIndex] ?? null}
                      season={season}
                      index={row.index}
                      orientation="desktop"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   The roomy cell, in both orientations.
   ------------------------------------------------------------------------- */

function RoomyCell({
  cell,
  season,
  index,
  orientation,
  tight = false,
}: {
  cell: GridCell | null;
  season: GridSeason;
  index: number;
  orientation: "mobile" | "desktop";
  tight?: boolean;
}) {
  const mobile = orientation === "mobile";

  // A year shorter than the tallest one leaves a hole. It must read as absent:
  // no border, no number, not a link. Never a zero.
  if (!cell) {
    return (
      <span aria-hidden className={cn("block h-11", !mobile && "w-[54px]")} />
    );
  }

  const style = bandStyle(cell.band);
  const markerSize = mobile
    ? tight
      ? "size-[11px]"
      : "size-[13px]"
    : "size-[9px]";
  const markers = (
    <>
      {cell.is_provisional ? (
        <TriangleAlert
          className={markerSize}
          strokeWidth={mobile ? 2.4 : 3}
          aria-hidden
        />
      ) : null}
      {cell.members_only ? (
        <Crown className={markerSize} strokeWidth={mobile ? 2.2 : 3} aria-hidden />
      ) : null}
      {cell.content_kind === "stream" ? (
        <Radio className={markerSize} strokeWidth={mobile ? 2.2 : 3} aria-hidden />
      ) : null}
    </>
  );

  return (
    <a
      href={`/e/${cell.youtube_id}`}
      aria-label={cellLabel(cell)}
      title={cellLabel(cell)}
      {...cellDataAttributes(cell, season, index)}
      className={cn(
        "relative flex h-11 items-center outline-none",
        // Hover lifts the cell 2px and rings it in brand red. Band colours
        // themselves NEVER transition - a colour that moves reads as a value
        // that changed.
        "transition-[transform,box-shadow] duration-120 ease-out",
        "hover:z-10 hover:-translate-y-0.5 hover:ring-2 hover:ring-primary",
        "focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary",
        mobile
          ? cn("justify-between rounded-[10px]", tight ? "px-1.5" : "px-2")
          : "w-[54px] justify-center rounded-sm",
        style.cell,
      )}
    >
      <span
        className={cn(
          "font-mono font-bold tabular",
          mobile ? "text-[15px]" : "text-[14px]",
          cell.score === null && "text-faint-foreground",
        )}
      >
        {formatScore(cell.score)}
      </span>
      {mobile ? (
        <span className="flex shrink-0 items-center gap-1 text-marker">
          {markers}
        </span>
      ) : (
        <span className="absolute right-[3px] bottom-0.5 flex gap-0.5 text-marker">
          {markers}
        </span>
      )}
    </a>
  );
}

/* -------------------------------------------------------------------------
   Dense: one orientation at every width, colour only.
   ------------------------------------------------------------------------- */

function DenseGrid({ grid }: { grid: Grid }) {
  return (
    <div className="mt-4 rounded-3xl border border-border bg-card-2 py-4">
      <div className="relative overflow-x-auto px-4">
        <table data-grid="dense" className="w-max border-separate border-spacing-px">
          <caption className="sr-only">
            {copy.channel.gridLabel(grid.channel_name)}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-20 bg-card-2 pr-3">
                <span className="sr-only">{copy.channel.yearColumn}</span>
              </th>
              {grid.rows.map((row) => (
                <th
                  key={row.index}
                  scope="col"
                  className="pb-1 text-center font-mono text-[9px] font-normal text-faint-foreground tabular"
                >
                  {/* A 3-digit number does not fit a 20px column, so every
                      tenth is printed and the rest stay for screen readers.
                      Every column still announces its position. */}
                  {row.index % DENSE_HEADER_EVERY !== 0 ? (
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
                  className="sticky left-0 z-20 bg-card-2 pr-3 text-left align-middle"
                >
                  <span className="flex items-baseline gap-1.5 leading-tight">
                    <span className="font-display text-[13px] font-bold">
                      {season.label}
                    </span>
                    <span className="font-mono text-[10px] font-normal text-subtle-foreground tabular">
                      {season.average === null
                        ? ""
                        : season.average.toFixed(1)}
                    </span>
                  </span>
                </th>
                {grid.rows.map((row) => (
                  <td key={row.index} className="p-0">
                    <DenseCell
                      cell={row.cells[seasonIndex] ?? null}
                      season={season}
                      index={row.index}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 px-4 text-[12px] text-subtle-foreground">
        {copy.channel.hintDesktop}
      </p>
    </div>
  );
}

function DenseCell({
  cell,
  season,
  index,
}: {
  cell: GridCell | null;
  season: GridSeason;
  index: number;
}) {
  if (!cell) return <span aria-hidden className="block h-6 w-5" />;

  const style = bandStyle(cell.band);
  const label = cellLabel(cell);

  // The class list is deliberately minimal: it is repeated once per episode, so
  // at 1,318 episodes every character costs ~1.3 KB of HTML. Hover and focus
  // treatment lives on the table as a single descendant rule instead.
  return (
    <a
      href={`/e/${cell.youtube_id}`}
      aria-label={label}
      title={label}
      {...cellDataAttributes(cell, season, index)}
      className={cn("block h-6 w-5 rounded-[3px]", style.cell)}
    />
  );
}

/* ------------------------------------------------------------------------- */

function GridLegend({ grid }: { grid: Grid }) {
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[12px] text-muted-foreground">
      {grid.bands.map((band) => (
        <span key={band.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("h-3 w-[18px] rounded-[4px]", bandStyle(band.key).swatch)}
          />
          {band.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-3 w-[18px] rounded-[4px] border border-dashed border-unrated-border bg-unrated"
        />
        {copy.band.unrated}
      </span>
      <span className="flex items-center gap-1.5">
        <TriangleAlert className="size-3" aria-hidden />
        {copy.band.provisional}
      </span>
      <span className="flex items-center gap-1.5">
        <Crown className="size-3" aria-hidden />
        {copy.band.membersOnly}
      </span>
      <span className="flex items-center gap-1.5">
        <Radio className="size-3" aria-hidden />
        {copy.band.stream}
      </span>
    </div>
  );
}
