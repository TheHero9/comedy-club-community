import { ChevronDown, Crown, Radio, TriangleAlert } from "lucide-react";

import { GridInteraction } from "@/components/grid/GridInteraction";
import {
  cellDataAttributes,
  cellLabel,
  hasMobileTranspose,
  printsScores,
  seasonCells,
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
 * 🚨 THE GRID WRAPS. IT DOES NOT SCROLL SIDEWAYS. (Owner call, 2026-08-16.)
 *
 * Every earlier version was a MATRIX - years down one axis, position-in-the-year
 * along the other - and every one of them was wider than the screen. The
 * flagship channel's busiest year has 183 episodes, so at 20px a cell that axis
 * was 3,913px inside a 1,150px card: on a laptop you saw columns 1 to 52 of 183
 * and the other 71% of the catalogue was behind a horizontal scroll with no
 * scrollbar in sight. The owner's report was "I only see a bit of the
 * episodes", and it was literally true.
 *
 * The fix is not a smaller cell - that was tried twice and rejected, because
 * 1,225 cells squeezed into one frame read as noise rather than as a chart (see
 * the block comment on the channel page). The fix is to stop pretending the
 * year is one line. `FlowGrid` renders each year as its own wrapped run of
 * full-size cells, so the browser lays out as many per line as the container
 * has room for and the long axis becomes ordinary vertical page scroll. Nothing
 * shrinks, nothing is hidden, nothing scrolls sideways.
 *
 * What that costs: cells at the same position in different years no longer line
 * up in a column. That comparison was already unavailable to anyone who could
 * only see the first 52 of 183.
 *
 * The transposed mobile table survives for channels with at most 4 years - see
 * `hasMobileTranspose`. It is the better shape at that size, and at 390px it is
 * the only one that keeps a 44px touch target.
 *
 * Server Component: it renders from data the page already fetched, so the grid
 * is in the initial HTML and every cell is a crawlable link to its episode.
 * `GridInteraction` layers the preview on top by event delegation rather than
 * by making 1,225 cells into client components.
 */
interface RatingsGridProps {
  grid: Grid;
}

export async function RatingsGrid({ grid }: RatingsGridProps) {
  const copy = await getCopy();
  if (grid.seasons.length === 0) {
    return <p className="text-small text-subtle-foreground">{copy.channel.empty}</p>;
  }

  const transposed = hasMobileTranspose(grid);

  return (
    <GridInteraction>
      {/* The hints live here, not on the page, because only this component
          knows which of the two layouts a given channel actually gets. */}
      {transposed ? (
        <>
          <p className="mt-2 text-[12.5px] text-subtle-foreground md:hidden">
            {copy.channel.hintMobile}
          </p>
          <MobileGrid grid={grid} />
        </>
      ) : null}
      <p
        className={cn(
          "mt-2 text-[12.5px] text-subtle-foreground",
          transposed && "hidden md:block",
        )}
      >
        {copy.channel.hintFlow}
      </p>
      <FlowGrid grid={grid} transposed={transposed} />
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
   The flow grid: every episode, wrapped. One block per year.

   🚨 THIS IS THE ONLY LAYOUT THAT SHOWS THE WHOLE CHANNEL. It replaced two
   matrices (a 54px "roomy" desktop table and a 20px "dense" one) that were
   identical in the way that mattered: both put a whole year on one horizontal
   line, so both were wider than the page and both hid most of the catalogue
   behind a scroll container. Measured on the flagship channel at 1440px before
   this change: 3,913px of table in a 1,150px card, 52 of 183 columns visible.

   `flex-wrap` on a fixed-size cell is the whole mechanism. The browser fits as
   many per line as the container allows, at every width, with no measurement
   and no pixel constant - which is the lesson the removed fullscreen overlay
   paid for twice (never size cells with a number you computed yourself).
   ------------------------------------------------------------------------- */

async function FlowGrid({
  grid,
  transposed,
}: {
  grid: Grid;
  transposed: boolean;
}) {
  const copy = await getCopy();
  const scores = printsScores(grid);

  return (
    <div
      data-grid="flow"
      data-density={scores ? "roomy" : "dense"}
      // The table it replaced carried its name in a <caption>. A wrapped run of
      // links has nowhere to put one, so the region is named directly - without
      // this the grid is an unlabelled pile of 1,225 links to a screen reader.
      role="group"
      aria-label={copy.channel.gridLabel(grid.channel_name)}
      className={cn(
        "mt-3.5 rounded-3xl border border-border bg-card-2 p-4 md:p-5",
        // Channels that transpose already showed their grid on mobile; this one
        // is the laptop half for them. Everyone else gets it at every width.
        transposed && "hidden md:block",
      )}
    >
      <div className="flex flex-col gap-4 md:gap-5">
        {grid.seasons.map((season, seasonIndex) => (
          <section key={season.year} data-year={season.year}>
            <h3 className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className="font-display text-[15px] font-bold text-foreground">
                {season.label}
              </span>
              <span className="font-mono text-[11.5px] font-normal text-subtle-foreground tabular">
                {copy.channels.episodeCount(season.episode_count)}
              </span>
              {season.average === null ? null : (
                <span className="font-mono text-[11.5px] font-normal text-muted-foreground tabular">
                  {copy.channel.seasonAverage(season.average.toFixed(1))}
                </span>
              )}
            </h3>
            {/* 🚨 `items-start`, not the default `stretch`. A wrapped flex line
                stretches its items to the tallest one, and the roomy cell sets
                its height with `h-11` on a flex child - which loses to stretch
                on any line whose neighbours grew. */}
            <div
              data-year-cells
              className={cn(
                "mt-2 flex flex-wrap items-start",
                scores ? "gap-1" : "gap-px",
              )}
            >
              {seasonCells(grid, seasonIndex).map(({ cell, index }) =>
                scores ? (
                  <RoomyCell
                    key={cell.youtube_id}
                    cell={cell}
                    season={season}
                    index={index}
                    orientation="desktop"
                  />
                ) : (
                  <DenseCell
                    key={cell.youtube_id}
                    cell={cell}
                    season={season}
                    index={index}
                  />
                ),
              )}
            </div>
          </section>
        ))}
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
   The dense cell: colour only, for channels too large to print every score.
   ------------------------------------------------------------------------- */

function DenseCell({
  cell,
  season,
  index,
}: {
  cell: GridCell;
  season: GridSeason;
  index: number;
}) {
  const label = cellLabel(cell);

  // 🚨 NO className at all, deliberately. Size, radius, the unrated treatment
  // and all seven band colours live in one set of descendant rules in
  // globals.css keyed on `data-band`, because this element renders 1,225 times
  // and the class string was identical on every one of them - 138 KB of HTML,
  // charged again in the RSC flight payload. If you need to restyle a dense
  // cell, edit globals.css - the selector is `[data-density="dense"]`.
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
