/**
 * Score band -> colour mapping.
 *
 * The API owns the THRESHOLDS (`podcast/services/grid.py`) and returns a
 * semantic band key. This file owns only the presentation, so web and a future
 * mobile app can never disagree about what "Great" means while still styling it
 * differently. `tests/score-bands.spec.ts` parses the Python thresholds and
 * fails if either side is edited alone.
 *
 * 🎨 The seven band colours are IDENTICAL in light and dark. They carry
 * meaning, so they do not flip with the theme - only the neutrals, brand red,
 * gold and the unrated chip do. All seven sit at L 0.66-0.87 with chroma held
 * 0.13-0.16, which is why every one of them can take the same near-black
 * `--ink` text and still clear 5:1.
 *
 * 🚨 Unrated is NOT a band. `score === null` renders as "?" on `--card` with a
 * dashed border. Never 0, never the garbage band, never a filled colour. That
 * is 22% of the catalogue.
 */
import type { Schema } from "@ccc/api-types";

import { copy } from "@/lib/copy";

export type GridCell = Schema<"GridCellOut">;
export type BandKey =
  | "masterpiece"
  | "awesome"
  | "great"
  | "good"
  | "regular"
  | "bad"
  | "garbage";

export interface BandStyle {
  /** Filled chip: band background plus the shared near-black text. */
  cell: string;
  /** Bare background, for legend swatches and histogram bars. */
  swatch: string;
  /** The band's name, exactly as the API spells it. */
  label: string;
}

const BAND_STYLES: Record<BandKey, BandStyle> = {
  masterpiece: {
    cell: "bg-band-masterpiece text-ink",
    swatch: "bg-band-masterpiece",
    label: copy.band.masterpiece,
  },
  awesome: {
    cell: "bg-band-awesome text-ink",
    swatch: "bg-band-awesome",
    label: copy.band.awesome,
  },
  great: {
    cell: "bg-band-great text-ink",
    swatch: "bg-band-great",
    label: copy.band.great,
  },
  good: {
    cell: "bg-band-good text-ink",
    swatch: "bg-band-good",
    label: copy.band.good,
  },
  regular: {
    cell: "bg-band-regular text-ink",
    swatch: "bg-band-regular",
    label: copy.band.regular,
  },
  bad: {
    cell: "bg-band-bad text-ink",
    swatch: "bg-band-bad",
    label: copy.band.bad,
  },
  garbage: {
    cell: "bg-band-garbage text-ink",
    swatch: "bg-band-garbage",
    label: copy.band.garbage,
  },
};

/** The unrated look. Deliberately not a colour, so it cannot read as a score. */
export const UNRATED_STYLE: BandStyle = {
  cell: "bg-unrated text-unrated-foreground border border-dashed border-unrated-border",
  swatch: "bg-unrated border border-dashed border-unrated-border",
  label: copy.band.unrated,
};

export function bandStyle(band: string | null | undefined): BandStyle {
  if (!band || !(band in BAND_STYLES)) return UNRATED_STYLE;
  return BAND_STYLES[band as BandKey];
}

/** Highest band first, matching the API's declaration order. */
export const BAND_ORDER: BandKey[] = [
  "masterpiece",
  "awesome",
  "great",
  "good",
  "regular",
  "bad",
  "garbage",
];

/**
 * Band for a raw 1-10 value, used where the API has not banded it for us: the
 * rating sheet's stripe under each numeral, and the community histogram.
 * Mirrors `score_band()` in grid.py.
 */
export function bandForScore(score: number): BandKey {
  if (score >= 9.5) return "masterpiece";
  if (score >= 8.5) return "awesome";
  if (score >= 7.5) return "great";
  if (score >= 6.5) return "good";
  if (score >= 5.5) return "regular";
  if (score >= 4.0) return "bad";
  return "garbage";
}

// Re-exported so existing consumers keep one import for "how a score looks".
export {
  formatScore,
  formatDuration,
  formatDate,
} from "@/lib/format";
