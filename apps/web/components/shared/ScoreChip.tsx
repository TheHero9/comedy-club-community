import { TriangleAlert } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { copy } from "@/lib/copy";
import { formatScore } from "@/lib/format";
import { bandStyle } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

/**
 * The score, printed inside its band colour.
 *
 * 🚨 The number is ALWAYS printed. Colour is never the only carrier of the
 * value - that is what lets the garbage band (a dull red at L 0.66 with
 * near-black text) coexist with brand red (L 0.60, high chroma, white text on
 * a pill) without either being mistaken for the other.
 *
 * 🚨 `score === null` renders "?" on `--card` with a dashed border. Never 0,
 * never the garbage band, never a filled colour.
 */
const chipVariants = cva(
  "inline-flex shrink-0 items-center gap-1 font-mono font-bold tabular",
  {
    variants: {
      size: {
        xs: "h-[23px] rounded-[6px] px-[7px] text-[12px]",
        sm: "h-[24px] rounded-[7px] px-2 text-[12.5px]",
        md: "h-[26px] rounded-sm px-2.5 text-[14px]",
        lg: "h-[30px] rounded-[9px] px-[9px] text-[13.5px]",
        xl: "h-[34px] rounded-[10px] px-3 text-[16px]",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

interface ScoreChipProps extends VariantProps<typeof chipVariants> {
  score: number | null | undefined;
  band?: string | null;
  /** Fewer than 3 ratings: keeps the band colour, adds a warning marker. */
  provisional?: boolean;
  className?: string;
}

export function ScoreChip({
  score,
  band,
  provisional = false,
  size,
  className,
}: ScoreChipProps) {
  const style = bandStyle(score === null || score === undefined ? null : band);
  const isRated = score !== null && score !== undefined;

  return (
    <span
      className={cn(chipVariants({ size }), style.cell, className)}
      title={isRated ? style.label : copy.band.unrated}
    >
      {formatScore(score)}
      {provisional && isRated ? (
        <TriangleAlert className="size-3" aria-hidden />
      ) : null}
    </span>
  );
}
