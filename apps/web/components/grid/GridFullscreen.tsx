"use client";

import { useCallback, useEffect, useState } from "react";
import { Expand, X } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import type { ChannelGrid } from "@/lib/api/podcast";
import { cellLabel, type GridCell } from "@/components/grid/grid-model";
import { formatScore } from "@/lib/format";
import { bandStyle } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

/**
 * The whole channel on one screen: years across, episodes down, nothing scrolls.
 *
 * 🎯 What this is FOR. The inline grid answers "how was 2023?"; this answers
 * "what does this channel look like?" - the shape of eleven years at once,
 * screenshottable in one frame. That is why it is a heatmap with no numbers in
 * it: at 1,225 episodes the cells are a few pixels tall and a digit would not
 * fit, but the COLOUR reads perfectly at that size and the colour is the answer.
 *
 * 🚨 It replaces "Fit to screen", which was a `transform: scale()` over the
 * inline grid. That shrank the grid but not the box holding it, so the page
 * grew a vertical scrollbar over a mostly-empty area - the layout got worse in
 * exactly the way "fit to screen" promises it will not.
 *
 * 🚨 The grid is FETCHED, not passed in as a prop, and that is a payload
 * decision rather than a stylistic one. This is a Client Component, so anything
 * handed to it is serialized into the RSC flight payload on every page load
 * whether the dialog is ever opened or not - and the flagship channel's grid is
 * 322 KB of JSON on a page already measured at 916 KB. Fetching on first open
 * costs the page zero bytes and costs the user one request they asked for by
 * clicking. The response is cached in state, so re-opening is instant.
 *
 * ⚠️ Deliberately NOT wrapped in `GridInteraction`. That component layers the
 * hover preview onto the inline grid by delegating off `a[data-cell]`, and a
 * floating preview card anchored to a 4px target inside a fullscreen overlay
 * fights the pointer rather than helping it. Here the accessible name carries
 * the episode and its score, the native tooltip shows it on hover, and a click
 * opens the episode.
 */

/**
 * 🚨 THE CELLS ARE SIZED BY FLEX, NOT BY ARITHMETIC, and that is the second
 * attempt at this.
 *
 * The first version computed `(100dvh - CHROME_HEIGHT_PX) / rowCount` against a
 * measured constant for the header and legend. It was wrong twice over, and
 * both failures were the same shape - a number standing in for a layout the
 * browser was going to compute anyway:
 *
 *   1. it ignored the 1px gap between cells, which on the flagship channel's
 *      184 rows is 184px of unaccounted height, so the tallest years ran off
 *      the bottom of an overlay whose whole promise is that nothing scrolls;
 *   2. the constant was measured at 1280px wide, where the legend is one line.
 *      At 390px it wraps to three, and the small channel overflowed by 22px.
 *
 * Any fixed chrome constant has that second bug permanently: it is a guess
 * about how tall something else rendered. So the chrome now simply takes the
 * height it needs, the cell column takes what is left (`flex-1 min-h-0`), and
 * each cell takes an equal share of THAT (`flex-1`). Nothing has to be measured
 * and nothing can drift when the legend rewraps.
 *
 * Every column renders `grid.rows.length` children - a year with fewer episodes
 * renders spacers, not fewer cells - so equal shares means the years stay
 * aligned across columns, which is the entire point of the heatmap.
 */

/**
 * Stops a three-episode channel from rendering three enormous slabs.
 * A cap only; the floor is `MIN_CELL_PX` below.
 */
const MAX_CELL_PX = 22;

/**
 * The absolute floor, and a deliberately tiny one.
 *
 * Flex will happily shrink a row to nothing, and a row you cannot see is worse
 * than a scrollbar. But the owner's call was explicit - "thin colour strips are
 * fine" - so this is set low enough that the flagship channel fits any real
 * viewport, and the container keeps `overflow-auto` purely as a safety net for
 * something absurdly short.
 */
const MIN_CELL_PX = 2;

/**
 * The 1px hairline between cells, dropped once cells get thin.
 *
 * A 1px gap between 3px cells is a third of the row: it reads as a dotted line
 * rather than as separated episodes. Below the threshold the cells butt
 * together and the band colours do the separating.
 */
const CELL_GAP_PX = 1;
const GAP_LEGIBLE_FROM_PX = 6;

/**
 * A rough per-row height, used ONLY to decide whether a score and a gap will
 * fit - never for layout.
 *
 * 🚨 Both of those are presentation-only, so being wrong just hides a digit or
 * a hairline. Layout must never come back here: that is exactly the mistake
 * documented above.
 */
const CHROME_HEIGHT_ESTIMATE_PX = 160;

/**
 * Below this a cell cannot carry its score, so it renders colour only.
 *
 * 🚨 Decided from the ROW COUNT against a pessimistic viewport, never from a
 * measured one. Measuring means a layout pass, which means painting once at the
 * wrong size and again at the right one - a visible lurch across 2,024 cells.
 * Assuming the shortest viewport worth supporting is the safe direction to be
 * wrong in: a taller screen just gets a roomier cell that still holds the digit.
 */
const SCORE_LEGIBLE_FROM_PX = 15;
const PESSIMISTIC_VIEWPORT_PX = 600;

/** Height one row gets on the shortest viewport worth supporting. */
function pessimisticRowHeight(rowCount: number): number {
  return (
    (PESSIMISTIC_VIEWPORT_PX - CHROME_HEIGHT_ESTIMATE_PX) / Math.max(rowCount, 1)
  );
}

function scoresFit(rowCount: number): boolean {
  return pessimisticRowHeight(rowCount) >= SCORE_LEGIBLE_FROM_PX;
}

function gapFits(rowCount: number): boolean {
  return pessimisticRowHeight(rowCount) >= GAP_LEGIBLE_FROM_PX;
}

interface GridFullscreenProps {
  slug: string;
  channelName: string;
  score: "public" | "elite";
}

export function GridFullscreen({ slug, channelName, score }: GridFullscreenProps) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const [grid, setGrid] = useState<ChannelGrid | null>(null);
  const [failed, setFailed] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Fetch once per (slug, score), on first open. An AbortController keeps a
  // dialog closed mid-flight from writing into an unmounted-ish state.
  useEffect(() => {
    if (!open || grid !== null || failed) return;
    const controller = new AbortController();
    api
      .get<ChannelGrid>(`/api/channels/${encodeURIComponent(slug)}/grid`, {
        query: { score },
        signal: controller.signal,
        cache: "no-store",
      })
      .then(setGrid)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // 🚨 Surfaced, never swallowed into a spinner that never stops. An
        // overlay that shows a loading state forever reads as a hung page.
        setFailed(true);
        console.error("channel grid fetch failed", error);
      });
    return () => controller.abort();
  }, [open, grid, failed, slug, score]);

  // Escape closes, and the page behind must not scroll while the overlay is up:
  // a wheel event over a fixed overlay still scrolls the document underneath,
  // so closing would leave the reader somewhere they never navigated to.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  return (
    <>
      <div className="flex justify-end px-4">
        <Button
          variant="elevated"
          size="xs"
          shape="pill"
          onClick={() => setOpen(true)}
          className="text-muted-foreground"
          data-testid="grid-fullscreen-open"
        >
          <Expand className="size-3.5" aria-hidden strokeWidth={2.2} />
          {copy.channel.fullView}
        </Button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={copy.channel.fullViewLabel(channelName)}
          data-testid="grid-fullscreen"
          className="fixed inset-0 z-50 flex flex-col bg-background"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3 pb-2">
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-bold text-foreground">
                {channelName}
              </h2>
              <p className="text-[11.5px] text-subtle-foreground">
                {copy.channel.fullViewHint}
              </p>
            </div>
            <Button
              variant="elevated"
              size="xs"
              shape="pill"
              onClick={close}
              aria-label={copy.common.close}
              data-testid="grid-fullscreen-close"
            >
              <X className="size-4" aria-hidden strokeWidth={2.4} />
            </Button>
          </div>

          {grid ? (
            <FullscreenColumns grid={grid} />
          ) : (
            <p className="flex-1 px-4 pt-6 text-small text-subtle-foreground">
              {failed ? copy.channel.fullViewFailed : copy.common.loading}
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}

/**
 * Years as columns, episodes stacked down each one.
 *
 * 🚨 Transposed relative to the inline desktop grid, on purpose. A channel has
 * at most a dozen years but can have 184 episodes in one of them, so putting
 * years on the SHORT axis is what makes the whole thing fit a screen: 12
 * columns of ~150px across, and the long axis becomes height that the cells
 * shrink to fill rather than scroll.
 *
 * Sizing is pure CSS arithmetic against `dvh`, with no measurement pass. A
 * `useLayoutEffect` that measured the viewport would paint once at the wrong
 * size and again at the right one, which on a 2,024-cell grid is a visible
 * lurch - and `dvh` already accounts for mobile browser chrome, which is the
 * only thing measuring would have bought.
 */
function FullscreenColumns({ grid }: { grid: ChannelGrid }) {
  const copy = useCopy();
  const rowCount = Math.max(grid.rows.length, 1);

  const gap = gapFits(rowCount) ? CELL_GAP_PX : 0;
  const withScores = scoresFit(rowCount);

  return (
    <>
      {/* `min-h-0` is load-bearing on every level of this stack: a flex child
          defaults to `min-height: auto`, which refuses to shrink below its
          content, and one missing `min-h-0` anywhere here puts the overflow
          back. `overflow-auto` is the safety net, not the plan. */}
      <div className="min-h-0 flex-1 overflow-auto px-4">
        <div
          className="grid h-full gap-x-1.5"
          style={{
            gridTemplateColumns: `repeat(${grid.seasons.length}, minmax(0, 1fr))`,
          }}
        >
          {grid.seasons.map((season, seasonIndex) => (
            <section key={season.year} className="flex min-w-0 flex-col">
              <header className="shrink-0 bg-background pb-1 text-center">
                <div className="font-display text-[13px] font-bold text-foreground">
                  {season.label}
                </div>
                <div className="font-mono text-[10px] font-normal text-subtle-foreground tabular">
                  {season.average === null ? "" : season.average.toFixed(1)}
                </div>
              </header>
              <div
                className="flex min-h-0 flex-1 flex-col"
                style={{ gap: `${gap}px` }}
              >
                {grid.rows.map((row) => (
                  <FullscreenCell
                    key={row.index}
                    cell={row.cells[seasonIndex] ?? null}
                    withScore={withScores}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* The key is not collapsible here the way it is inline: this view has no
          numbers in it at all, so without the key the colours mean nothing. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[11px] text-muted-foreground">
        {grid.bands.map((band) => (
          <span key={band.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("h-2.5 w-[14px] rounded-[3px]", bandStyle(band.key).swatch)}
            />
            {band.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-[14px] rounded-[3px] border border-dashed border-unrated-border bg-unrated"
          />
          {copy.band.unrated}
        </span>
      </div>
    </>
  );
}

/**
 * 🚨 Every cell carries the SAME flex sizing, holes included.
 *
 * A year with fewer episodes than the tallest one renders spacers rather than
 * fewer children, which is what keeps row N of 2016 level with row N of 2020.
 * Give the spacer a different size and the whole grid shears.
 */
const CELL_SIZING = "min-h-0 flex-1";
const CELL_STYLE = { maxHeight: MAX_CELL_PX, minHeight: MIN_CELL_PX } as const;

function FullscreenCell({
  cell,
  withScore,
}: {
  cell: GridCell | null;
  withScore: boolean;
}) {
  // A year shorter than the tallest one leaves a hole. It must read as absent -
  // no border, no colour, not a link. Never a zero.
  if (!cell) {
    return <span aria-hidden className={CELL_SIZING} style={CELL_STYLE} />;
  }

  const label = cellLabel(cell);
  const style = bandStyle(cell.band);

  return (
    <a
      href={`/e/${cell.youtube_id}`}
      aria-label={label}
      // 🚨 A native tooltip HERE, unlike the inline grid where it was removed.
      // There it duplicated `aria-label` across 2,024 server-rendered cells and
      // cost 352 KB of HTML for a card `GridInteraction` already drew. This
      // grid is client-rendered from a fetch, so the string is in memory
      // either way and costs the page nothing - and it is the only way to
      // identify a 4px cell without a hover card fighting the pointer.
      title={label}
      data-cell={cell.youtube_id}
      data-band={cell.band ?? ""}
      style={CELL_STYLE}
      className={cn(
        CELL_SIZING,
        "flex items-center justify-center rounded-[2px] outline-none",
        // Band colours never transition; only the ring appears. A colour that
        // moves reads as a value that changed.
        "hover:relative hover:z-10 hover:ring-2 hover:ring-primary",
        "focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary",
        style.cell,
      )}
    >
      {withScore ? (
        <span
          className={cn(
            "font-mono text-[11px] font-bold tabular",
            cell.score === null && "text-faint-foreground",
          )}
        >
          {formatScore(cell.score)}
        </span>
      ) : null}
    </a>
  );
}

export {
  CELL_GAP_PX,
  MAX_CELL_PX,
  MIN_CELL_PX,
  SCORE_LEGIBLE_FROM_PX,
  gapFits,
  pessimisticRowHeight,
  scoresFit,
};
