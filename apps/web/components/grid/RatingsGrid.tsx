import { ChevronDown, Crown, Radio, TriangleAlert } from "lucide-react";

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
import { getCopy } from "@/lib/locale";
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

export async function RatingsGrid({ grid }: RatingsGridProps) {
  const copy = await getCopy();
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

async function MobileGrid({ grid }: { grid: Grid }) {
  const copy = await getCopy();
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

async function DesktopGrid({ grid }: { grid: Grid }) {
  const copy = await getCopy();
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

async function DenseGrid({ grid }: { grid: Grid }) {
  const copy = await getCopy();
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
                  // Padding comes from the dense descendant rule - "p-0" alone
                  // was 24 KB across 2,024 cells, twice over with the flight.
                  <td key={row.index}>
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
  if (!cell) return <span aria-hidden />;

  const label = cellLabel(cell);

  // 🚨 NO className at all, deliberately. Size, radius, the unrated treatment
  // and all seven band colours live in one set of descendant rules in
  // globals.css keyed on `data-band`, because this element renders 1,318 times
  // and the class string was identical on every one of them - 138 KB of HTML,
  // charged again in the RSC flight payload. Hover and focus already worked
  // this way. If you need to restyle a dense cell, edit globals.css.
  //
  // 🚨 No `title` attribute, deliberately. It used to carry the same string as
  // `aria-label`, which cost a second full copy of the episode title on every
  // one of 2,024 cells - and then a THIRD, because the RSC flight payload
  // serializes the whole tree again. Measured 2026-08-11: dropping it took the
  // page from 2076.3 KB to 1723.9 KB.
  //
  // It was not buying anything either. `GridInteraction` renders a real hover
  // preview from the `data-*` attributes below, so the native tooltip fired
  // ALONGSIDE that card rather than instead of it. The accessible name is
  // unaffected: `aria-label` is what screen readers use, and `e2e/a11y.spec.ts`
  // still asserts it ends with the score.
  return (
    <a
      href={`/e/${cell.youtube_id}`}
      aria-label={label}
      {...cellDataAttributes(cell, season, index)}
    />
  );
}

/* ------------------------------------------------------------------------- */

/**
 * The band key, collapsed behind a disclosure.
 *
 * 🚨 Collapsed, NOT deleted (owner call, 2026-08-15). It is the only place the
 * grid explains what its colours mean, and a heatmap with no key is decoration
 * - but a reader who already knows the bands sees eleven swatches between the
 * grid and the episode list every single visit.
 *
 * `<details>` rather than React state: it works before hydration, it keeps the
 * whole thing a Server Component, and the browser owns the open/closed
 * semantics and the keyboard behaviour for free.
 */
async function GridLegend({ grid }: { grid: Grid }) {
  const copy = await getCopy();
  return (
    <details className="mt-3.5 group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-semibold text-subtle-foreground outline-none hover:text-foreground">
        <ChevronDown
          className="size-3.5 transition-transform duration-120 group-open:rotate-180"
          aria-hidden
          strokeWidth={2.4}
        />
        {copy.channel.legendToggle}
      </summary>
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[12px] text-muted-foreground">
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
    </details>
  );
}
