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
  FLAG_MEMBERS_ONLY,
  FLAG_STREAM,
  positionLabel,
  titleFromCellLabel,
  type CellLabelFlags,
  type GridCell,
  type GridSeason,
} from "@/components/grid/grid-model";
import { copy } from "@/lib/copy";

const SEASON = { year: 2021, label: "'21", episode_count: 40 } as GridSeason;

function flagsOf(cell: GridCell): CellLabelFlags {
  return {
    ratingCount: cell.rating_count,
    provisional: cell.is_provisional,
    membersOnly: cell.members_only,
    stream: cell.content_kind === "stream",
  };
}

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
  // 🚨 Titles that END in a marker phrase. The first implementation lost the
  // last word of all three: an unconditional marker set stripped them from
  // cells that carry no such flag, and a `while` loop stripped them a second
  // time from cells that do. Found by review 2026-08-14.
  "На живо от клуба - Стрийм",
  "Ексклузивно - Само за членове",
  "Първи впечатления - Малко оценки",
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
        expect(titleFromCellLabel(cellLabel(c), flagsOf(c))).toBe(title);
      }
    });
  }

  it("reads its flags off the very attributes the cell ships", () => {
    // The parser is only exact if what the component writes is what the
    // preview reads back - assert the loop closes through data-flags.
    const c = cell({
      title: "На живо от клуба - Стрийм",
      members_only: true,
      content_kind: "stream",
    });
    const attrs = cellDataAttributes(c, SEASON, 3);
    const flags = attrs["data-flags"] ?? "";
    expect(
      titleFromCellLabel(cellLabel(c), {
        ratingCount: Number(attrs["data-count"]),
        provisional: attrs["data-provisional"] === "1",
        membersOnly: flags.includes(FLAG_MEMBERS_ONLY),
        stream: flags.includes(FLAG_STREAM),
      }),
    ).toBe("На живо от клуба - Стрийм");
  });
});

describe("cellDataAttributes", () => {
  it("never ships the title - aria-label is its only copy", () => {
    const attrs = cellDataAttributes(cell({}), SEASON, 14);
    expect(Object.keys(attrs)).not.toContain("data-title");
  });

  it("ships the compact position and positionLabel formats it", () => {
    const attrs = cellDataAttributes(cell({}), SEASON, 14);
    expect(attrs["data-position"]).toBe("2021:14");
    expect(positionLabel("2021:14")).toBe(copy.episode.cellPosition(2021, 14));
  });

  it("omits data-flags entirely for an ordinary video", () => {
    // ~97% of cells. Exactness has to be free for the common case.
    expect(Object.keys(cellDataAttributes(cell({}), SEASON, 14))).not.toContain(
      "data-flags",
    );
    expect(
      cellDataAttributes(cell({ members_only: true }), SEASON, 14)["data-flags"],
    ).toBe(FLAG_MEMBERS_ONLY);
    expect(
      cellDataAttributes(cell({ content_kind: "stream" }), SEASON, 14)["data-flags"],
    ).toBe(FLAG_STREAM);
  });
});

describe("positionLabel", () => {
  it("degrades to empty rather than rendering NaN", () => {
    // Stale HTML from an older build, or a hand-edited attribute.
    for (const raw of ["", "2021", "2021:", ":14", "2021:x", "abc:14", "1:2:3"]) {
      expect(positionLabel(raw), `positionLabel(${JSON.stringify(raw)})`).toBe("");
    }
  });
});
