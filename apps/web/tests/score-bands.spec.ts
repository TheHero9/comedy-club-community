/**
 * Matrix section 5 - the pure helpers in `lib/score-bands.ts` and `lib/utils.ts`.
 *
 * Row 5.8 ("each numeric score maps to the band the API would assign") is a
 * cross-stack invariant, not a frontend-only one: the API owns the thresholds
 * (`apps/api/podcast/services/grid.py`) and the web app owns only the colours.
 * So the thresholds are read out of the Python source and the web mapping is
 * checked against them. If either side is edited alone, this fails.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BAND_ORDER,
  bandStyle,
  formatDate,
  formatDuration,
  formatScore,
} from "@/lib/score-bands";
import { copy, dictionaries } from "@/lib/copy";
import { cn } from "@/lib/utils";

const GRID_SERVICE_PATH = fileURLToPath(
  new URL("../../api/podcast/services/grid.py", import.meta.url),
);

/** `(9.5, "masterpiece", "Absolute cinema"),` -> one entry, in declared order. */
interface PythonBand {
  threshold: number;
  key: string;
  label: string;
}

function readApiBands(): PythonBand[] {
  const source = readFileSync(GRID_SERVICE_PATH, "utf8");
  const block = source.match(/SCORE_BANDS[^=]*=\s*\(([\s\S]*?)\n\)/);
  if (!block) throw new Error("could not find SCORE_BANDS in grid.py");

  const bands = [...block[1].matchAll(/\(\s*([\d.]+)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g)].map(
    (match) => ({
      threshold: Number(match[1]),
      key: match[2],
      label: match[3],
    }),
  );

  if (bands.length === 0) throw new Error("parsed zero bands out of grid.py");
  return bands;
}

/** Mirror of `score_band()` in grid.py, driven by the thresholds parsed above. */
function apiBandForScore(bands: PythonBand[], score: number): string {
  for (const band of bands) {
    if (score >= band.threshold) return band.key;
  }
  return "garbage";
}

const API_BANDS = readApiBands();
/**
 * Read from `lib/copy.ts`, never duplicated. The band NAMES stay English
 * because the API owns them, but "no rating" is product copy and moved to
 * Bulgarian with the redesign - a literal here would have pinned the old one.
 */
const FALLBACK_LABEL = copy.band.unrated;

describe("5.1-5.2 bandStyle", () => {
  it("5.1 returns a complete style for every band key the API can emit", () => {
    for (const band of API_BANDS) {
      const style = bandStyle(band.key);
      expect(style, `missing style for band "${band.key}"`).toBeDefined();
      expect(style.cell.length).toBeGreaterThan(0);
      expect(style.swatch.length).toBeGreaterThan(0);
      expect(style.label.length).toBeGreaterThan(0);
    }
  });

  it("5.1 gives every band a distinct cell style, so the heatmap is readable", () => {
    const cells = API_BANDS.map((band) => bandStyle(band.key).cell);
    expect(new Set(cells).size).toBe(API_BANDS.length);
  });

  it("5.2 falls back safely for null, undefined and an unknown key", () => {
    for (const input of [null, undefined, "not-a-band", "", "MASTERPIECE"] as const) {
      const style = bandStyle(input);
      expect(style, `no fallback for ${String(input)}`).toBeDefined();
      expect(style.label).toBe(FALLBACK_LABEL);
      expect(style.cell.length).toBeGreaterThan(0);
    }
  });

  it("5.2 never styles an unrated cell as the worst band - absent is not bad", () => {
    const unrated = bandStyle(null);
    const worst = bandStyle("garbage");
    expect(unrated.cell).not.toBe(worst.cell);
    expect(unrated.swatch).not.toBe(worst.swatch);
    expect(unrated.label).not.toBe(worst.label);
  });
});

describe("5.3-5.4 formatScore", () => {
  it("5.3 renders the not-rated marker for null and undefined, never 0 or NaN", () => {
    for (const input of [null, undefined] as const) {
      const rendered = formatScore(input);
      expect(rendered).toBe("?");
      expect(rendered).not.toBe("0");
      expect(rendered).not.toBe("0.0");
      expect(rendered).not.toContain("NaN");
    }
  });

  it("5.3 renders a real zero as a number, not as the not-rated marker", () => {
    expect(formatScore(0)).toBe("0.0");
  });

  it("5.4 always renders exactly one decimal place", () => {
    expect(formatScore(7)).toBe("7.0");
    expect(formatScore(10)).toBe("10.0");
    expect(formatScore(9.75)).toBe("9.8");
    expect(formatScore(8.44)).toBe("8.4");
  });

  it("5.4 shows no floating point noise", () => {
    // 0.1 + 0.2 is the classic 0.30000000000000004.
    expect(formatScore(0.1 + 0.2)).toBe("0.3");
    expect(formatScore(7.1 * 3)).toBe("21.3");
    for (let raw = 0; raw <= 10; raw += 0.07) {
      expect(formatScore(raw)).toMatch(/^\d+\.\d$/);
    }
  });
});

describe("5.5 formatDuration", () => {
  it("formats sub-hour durations as m:ss", () => {
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("formats hour-plus durations as h:mm:ss with zero padding", () => {
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(7325)).toBe("2:02:05");
  });

  it("is null safe and never renders NaN", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(null)).not.toContain("NaN");
  });
});

describe("5.6 formatDate", () => {
  const EN = dictionaries.en.common.months;
  const BG = dictionaries.bg.common.months;

  it("is safe for null, undefined and an empty string", () => {
    expect(formatDate(null, EN)).toBe("");
    expect(formatDate(undefined, EN)).toBe("");
    expect(formatDate("", EN)).toBe("");
  });

  it("renders a real ISO date as a non-empty string", () => {
    const rendered = formatDate("2026-03-14T10:00:00Z", EN);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).toContain("2026");
    expect(rendered).not.toContain("NaN");
    expect(rendered).not.toBe("Invalid Date");
  });

  it("accepts a date-only string as the API sends upload_date", () => {
    const rendered = formatDate("2026-03-14", EN);
    expect(rendered).toContain("2026");
    expect(rendered).not.toContain("NaN");
  });

  /**
   * The whole reason `months` became a parameter: a module-level dictionary
   * resolves once per process, so a Bulgarian viewer would get English months
   * in the server HTML and Bulgarian ones after hydration.
   */
  it("renders the month in whichever locale it is handed", () => {
    expect(formatDate("2026-03-14", EN)).toBe("14 March 2026");
    expect(formatDate("2026-03-14", BG)).toBe("14 март 2026");
  });

  it("has a full twelve months in both dictionaries", () => {
    // An off-by-one here renders "undefined" in the middle of every date.
    for (const months of [EN, BG]) {
      expect(months).toHaveLength(12);
      expect(months.every((month) => month.length > 0)).toBe(true);
    }
  });
});

describe("5.7 cn", () => {
  it("lets the later class win a Tailwind conflict", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
    expect(cn("bg-red-500", "bg-sky-400")).toBe("bg-sky-400");
  });

  it("keeps non-conflicting classes and drops falsy input", () => {
    expect(cn("flex", "items-center")).toBe("flex items-center");
    expect(cn("flex", false, null, undefined, "gap-2")).toBe("flex gap-2");
    expect(cn()).toBe("");
  });

  it("resolves a conditional band class the way the grid uses it", () => {
    const style = bandStyle("great");
    expect(cn("rounded-sm", style.cell)).toContain(style.cell.split(" ")[0]);
  });
});

describe("5.8 band thresholds match the API", () => {
  it("BAND_ORDER lists exactly the API bands, highest first", () => {
    expect(BAND_ORDER).toEqual(API_BANDS.map((band) => band.key));
  });

  it("every band label matches the label the API returns", () => {
    for (const band of API_BANDS) {
      expect(bandStyle(band.key).label, `label drift on "${band.key}"`).toBe(band.label);
    }
  });

  it("every score on the 0-10 scale maps to a styled, non-fallback band", () => {
    for (let raw = 0; raw <= 100; raw += 1) {
      const score = raw / 10;
      const key = apiBandForScore(API_BANDS, score);
      const style = bandStyle(key);
      expect(style.label, `score ${score} banded as "${key}" has no style`).not.toBe(
        FALLBACK_LABEL,
      );
      expect(style.label).toBe(API_BANDS.find((band) => band.key === key)?.label);
    }
  });

  it("maps each threshold boundary to the band the API would assign", () => {
    for (const band of API_BANDS) {
      expect(apiBandForScore(API_BANDS, band.threshold)).toBe(band.key);
      expect(bandStyle(apiBandForScore(API_BANDS, band.threshold)).label).toBe(band.label);
    }
  });

  it("an unrated score has no band at all, and renders as the fallback", () => {
    // The API returns band === null for an unrated episode; it never returns
    // "garbage" for one. The web fallback must match that meaning.
    expect(bandStyle(null).label).toBe(FALLBACK_LABEL);
    expect(BAND_ORDER).not.toContain(null);
  });
});
