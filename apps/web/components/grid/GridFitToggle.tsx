"use client";

import { useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { Button } from "@/components/ui/button";

/**
 * "Fit to screen" for the ratings grid.
 *
 * 🚨 Why this is a CSS scale and not a re-render: the big channel is 1,318
 * episodes across ~2,024 cells, and that grid was expensive to get down to
 * 916 KB. Re-rendering it at a second size would either double the payload or
 * need a client round trip; `transform: scale()` costs nothing and keeps the
 * one grid the server already sent.
 *
 * The scale is applied to a wrapper, and `transform-origin: top left` keeps the
 * grid anchored where it already was rather than drifting toward the middle.
 * The wrapper's own height is NOT corrected for the scale, so the page keeps
 * the taller layout - deliberate: correcting it makes the surrounding content
 * jump upward the instant you toggle, which reads as the page breaking.
 *
 * ⚠️ It only shrinks. Scaling a heatmap UP past 1 makes the cells blurry and
 * buys nothing, since at 1 the grid already fits on a desktop for every channel
 * except the flagship.
 */
const FIT_SCALE = 0.62;

export function GridFitToggle({ children }: { children: React.ReactNode }) {
  const copy = useCopy();
  const [fitted, setFitted] = useState(false);

  return (
    <div>
      <div className="flex justify-end px-4">
        <Button
          variant="elevated"
          size="xs"
          shape="pill"
          onClick={() => setFitted((value) => !value)}
          aria-pressed={fitted}
          className="text-muted-foreground"
        >
          {fitted ? (
            <Minimize2 className="size-3.5" aria-hidden strokeWidth={2.2} />
          ) : (
            <Maximize2 className="size-3.5" aria-hidden strokeWidth={2.2} />
          )}
          {fitted ? copy.channel.collapseGrid : copy.channel.expand}
        </Button>
      </div>

      <div
        // `w-fit` so the scaled box does not keep the unscaled width and
        // create an empty horizontal scroll region to the right of the grid.
        className={fitted ? "w-fit origin-top-left" : undefined}
        style={fitted ? { transform: `scale(${FIT_SCALE})` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
