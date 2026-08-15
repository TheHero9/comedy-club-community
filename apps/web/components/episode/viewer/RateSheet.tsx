"use client";

import { useState } from "react";

import { useEpisodeViewer } from "@/components/episode/viewer/EpisodeViewerContext";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/shared/ConfirmButton";
import { Sheet } from "@/components/ui/sheet";
import { useCopy } from "@/components/i18n/LocaleProvider";
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
  const copy = useCopy();
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
          {/* 🚨 The episode title used to repeat here and is gone (owner
              call, 2026-08-15). The sheet opens over the episode page, whose
              H1 is that same title - so it restated what was already on screen
              and pushed the 1-10 row further from the thumb. */}
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
      </div>

      {/* 🚨 Removal asks first. A rating is the user's own record and there is
          no undo - the previous score is gone the moment the DELETE lands, and
          this button sat directly beside "Save" at the same size. */}
      {viewer.myRating !== null ? (
        <div className="mt-2.5 flex justify-center">
          <ConfirmButton
            disabled={viewer.saving}
            question={copy.rating.confirmRemoveTitle}
            confirmLabel={copy.rating.confirmRemoveCta}
            onConfirm={() => viewer.clearRating()}
          >
            {copy.rating.remove}
          </ConfirmButton>
        </div>
      ) : null}

      <p className="mt-3 text-center text-[12.5px] text-subtle-foreground">
        {viewer.publicScore === null
          ? copy.rating.noPublicYet
          : copy.rating.compare(formatScore(viewer.publicScore), picked)}
      </p>
    </Sheet>
  );
}
