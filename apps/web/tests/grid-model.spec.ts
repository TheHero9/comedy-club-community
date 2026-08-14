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
        // Defaults mirror GridInteraction.readCell exactly - these attributes
        // are omitted when they carry their default value.
        ratingCount: Number(attrs["data-count"] ?? "0"),
        provisional: attrs["data-provisional"] === "1",
        membersOnly: flags.includes(FLAG_MEMBERS_ONLY),
        stream: flags.includes(FLAG_STREAM),
      }),
    ).toBe("На живо от клуба - Стрийм");
  });
});

describe("cellDataAttributes omits defaults", () => {
  it("ships only the two unconditional attributes for an unrated video", () => {
    // 71% of the catalogue. Every attribute here is charged 1,318 times in the
    // HTML and again in the RSC flight payload.
    expect(Object.keys(cellDataAttributes(cell({}), SEASON, 14)).sort()).toEqual([
      "data-cell",
      "data-position",
    ]);
  });

  it("ships each optional attribute exactly when it is meaningful", () => {
    const rated = cellDataAttributes(
      cell({ score: 7.4, band: "great", rating_count: 12, is_provisional: true }),
      SEASON,
      14,
    );
    expect(rated["data-score"]).toBe("7.4");
    expect(rated["data-band"]).toBe("great");
    expect(rated["data-count"]).toBe("12");
    expect(rated["data-provisional"]).toBe("1");
  });

  it("keeps a zero score, which is a real score and not a default", () => {
    // 🚨 `score: 0` is falsy. Omitting it would render the worst-rated
    // episodes on the site as unrated.
    expect(cellDataAttributes(cell({ score: 0, band: "garbage" }), SEASON, 1)["data-score"]).toBe(
      "0",
    );
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
