/**
 * The cell label round-trip: `titleFromCellLabel` must recover the exact title
 * from whatever `cellLabel` produced, because since 2026-08-14 the aria-label
 * is the ONLY copy of the title a grid cell ships (data-title cost 135.5 KB
 * plus its RSC flight duplicate on the 1,318-cell page).
 *
 * Builder and parser live in the same module; this suite is what keeps them
 * coupled in fact and not just in intent.
 */
import { describe, expect, it } from "vitest";

import {
  cellDataAttributes,
  cellLabel,
  positionLabel,
  titleFromCellLabel,
  type GridCell,
  type GridSeason,
} from "@/components/grid/grid-model";
import { copy } from "@/lib/copy";

function cell(overrides: Partial<GridCell>): GridCell {
  return {
    youtube_id: "abcdefghij1",
    title: "Обикновен епизод",
    score: null,
    rating_count: 0,
    band: null,
    is_provisional: false,
    members_only: false,
    content_kind: "video",
    ...overrides,
  } as GridCell;
}

const TITLES = [
  "Обикновен епизод",
  // Titles containing the join sequence must survive the reverse parse.
  "Гост - Иван Кирков - Комеди Клуб Подкаст",
  "UFC 265 Gane vs Lewis - Подкаст за спорт",
];

describe("titleFromCellLabel", () => {
  for (const title of TITLES) {
    it(`round-trips ${JSON.stringify(title)} through every cell shape`, () => {
      const shapes: Partial<GridCell>[] = [
        {},
        { score: 7.4, rating_count: 12, band: "great" },
        { score: 9.1, rating_count: 1, band: "peak", is_provisional: true },
        { members_only: true },
        { content_kind: "stream" },
        {
          members_only: true,
          content_kind: "stream",
          is_provisional: true,
          score: 5.5,
          rating_count: 2,
          band: "fine",
        },
      ];
      for (const shape of shapes) {
        const c = cell({ title, ...shape });
        expect(titleFromCellLabel(cellLabel(c), c.rating_count)).toBe(title);
      }
    });
  }
});

describe("cellDataAttributes", () => {
  const season = { year: 2021, label: "'21", episode_count: 40 } as GridSeason;

  it("never ships the title - aria-label is its only copy", () => {
    const attrs = cellDataAttributes(cell({}), season, 14);
    expect(Object.keys(attrs)).not.toContain("data-title");
  });

  it("ships the compact position and positionLabel formats it", () => {
    const attrs = cellDataAttributes(cell({}), season, 14);
    expect(attrs["data-position"]).toBe("2021:14");
    expect(positionLabel("2021:14")).toBe(copy.episode.cellPosition(2021, 14));
    expect(positionLabel("")).toBe("");
  });
});
