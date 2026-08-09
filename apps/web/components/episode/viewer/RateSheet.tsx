"use client";

import { useState } from "react";

import { useEpisodeViewer } from "@/components/episode/viewer/EpisodeViewerContext";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { copy } from "@/lib/copy";
import { formatScore } from "@/lib/format";
import { bandForScore, bandStyle } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

/**
 * The 1-10 rating control, as a 5x2 grid of 58px buttons in a sheet.
 *
 * Ten 44px targets need 440px. The screen is 390px. Rejected alternatives:
 * a SLIDER turns a discrete ten-point judgement into a drag, which is
 * imprecise with a thumb and gives no target for the value you already know
 * you want; a SINGLE ROW OF TEN cannot exist at 390px without failing the
 * touch target; FIVE STARS WITH HALVES changes the scale the database stores.
 *
 * The stripe under each numeral is the band that value will take in the grid.
 * It is what connects the score you are about to give to the colour you will
 * see it as afterwards.
 */
const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const DEFAULT_PICK = 8;

export function RateSheet() {
  const viewer = useEpisodeViewer();
  const open = viewer.sheet === "rate";
  const [picked, setPicked] = useState(viewer.myRating ?? DEFAULT_PICK);

  /**
   * The sheet always opens pre-selected on the existing score, so picking
   * REPLACES a rating rather than starting a new one from nothing.
   *
   * Adjusting state during render is React's own answer to "reset when a prop
   * changes" - it re-renders before anything is committed, so nothing flashes.
   * An effect would paint the stale value for one frame and would schedule a
   * cascading render, which `react-hooks/set-state-in-effect` rejects.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicked(viewer.myRating ?? DEFAULT_PICK);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) viewer.closeSheet();
      }}
      title={copy.rating.sheetTitle}
      hideTitle
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[17px] font-bold">
            {copy.rating.sheetTitle}
          </p>
          <p className="mt-1 truncate text-[12.5px] text-subtle-foreground">
            {viewer.title}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 font-mono text-[30px] font-bold tabular",
            bandStyle(bandForScore(picked)).swatch,
            "bg-clip-text text-transparent",
          )}
        >
          {picked}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label={copy.rating.sheetTitle}
        className="mt-4 grid grid-cols-5 gap-2"
      >
        {SCALE.map((value) => {
          const selected = picked === value;
          const band = bandStyle(bandForScore(value));
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={copy.rating.pick(value)}
              onClick={() => setPicked(value)}
              className={cn(
                "flex h-[58px] flex-col items-center justify-center gap-[3px] rounded-xl border",
                "font-mono text-[20px] font-bold tabular",
                selected
                  ? cn("border-2 border-foreground", band.cell)
                  : "border-border-2 bg-card text-foreground",
              )}
            >
              {value}
              <span
                aria-hidden
                className={cn("h-[3px] w-[18px] rounded-pill", band.swatch)}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          variant="primary"
          size="xl"
          className="flex-1"
          disabled={viewer.saving}
          onClick={() => viewer.saveRating(picked)}
        >
          {viewer.saving ? copy.rating.saving : copy.rating.save}
        </Button>
        {viewer.myRating !== null ? (
          <Button
            variant="outline"
            size="xl"
            disabled={viewer.saving}
            onClick={() => viewer.clearRating()}
          >
            {copy.rating.remove}
          </Button>
        ) : null}
      </div>

      <p className="mt-3 text-center text-[12.5px] text-subtle-foreground">
        {viewer.publicScore === null
          ? copy.rating.noPublicYet
          : copy.rating.compare(formatScore(viewer.publicScore), picked)}
      </p>
    </Sheet>
  );
}
