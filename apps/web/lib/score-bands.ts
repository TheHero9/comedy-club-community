/**
 * Score band -> colour mapping for the ratings grid.
 *
 * The API owns the THRESHOLDS (podcast/services/grid.py) and returns a semantic
 * band key. This file owns only the presentation, so web and a future mobile app
 * can never disagree about what "Great" means while still styling it differently.
 *
 * Project rule: data carries semantic keys, components map them to visuals.
 */
import type { Schema } from "@ccc/api-types";

export type GridCell = Schema<"GridCellOut">;
export type BandKey =
  | "masterpiece"
  | "awesome"
  | "great"
  | "good"
  | "regular"
  | "bad"
  | "garbage";

interface BandStyle {
  /** Cell background + text, tuned for contrast in dark mode. */
  cell: string;
  /** Small square used in the legend. */
  swatch: string;
  label: string;
}

/**
 * Colours run blue (exceptional) -> green -> yellow -> orange -> red, matching
 * the convention people already know from IMDb-style episode heatmaps.
 *
 * Every combination below was picked to keep text at or above 4.5:1 against its
 * own background, so the number stays readable rather than glowing.
 */
const BAND_STYLES: Record<BandKey, BandStyle> = {
  masterpiece: {
    cell: "bg-sky-400 text-sky-950",
    swatch: "bg-sky-400",
    label: "Absolute cinema",
  },
  awesome: {
    cell: "bg-emerald-400 text-emerald-950",
    swatch: "bg-emerald-400",
    label: "Awesome",
  },
  great: {
    cell: "bg-green-300 text-green-950",
    swatch: "bg-green-300",
    label: "Great",
  },
  good: {
    cell: "bg-lime-200 text-lime-950",
    swatch: "bg-lime-200",
    label: "Good",
  },
  regular: {
    cell: "bg-amber-300 text-amber-950",
    swatch: "bg-amber-300",
    label: "Regular",
  },
  bad: {
    cell: "bg-orange-400 text-orange-950",
    swatch: "bg-orange-400",
    label: "Bad",
  },
  garbage: {
    cell: "bg-red-500 text-red-50",
    swatch: "bg-red-500",
    label: "Garbage",
  },
};

/**
 * Style for a band. An unrated episode (null band) is deliberately muted and
 * NEVER styled as "garbage" - no rating is not the same as a bad rating.
 */
export function bandStyle(band: string | null | undefined): BandStyle {
  if (!band || !(band in BAND_STYLES)) {
    return {
      cell: "bg-muted/40 text-muted-foreground",
      swatch: "bg-muted",
      label: "Not rated",
    };
  }
  return BAND_STYLES[band as BandKey];
}

export const BAND_ORDER: BandKey[] = [
  "masterpiece",
  "awesome",
  "great",
  "good",
  "regular",
  "bad",
  "garbage",
];

/** Format a 1-10 score for display. Null renders as a placeholder, never "0". */
export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? "?" : score.toFixed(1);
}

/** Seconds -> "1:23:45" or "23:45". */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

/**
 * Dates render in Bulgarian locale because the audience is Bulgarian, even
 * though the UI chrome is English.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("bg-BG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
