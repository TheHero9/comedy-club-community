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
  flowSeasons,
  hasMobileTranspose,
  positionLabel,
  printsScores,
  ROOMY_MAX_EPISODES,
  seasonCells,
  titleFromCellLabel,
  type CellLabelFlags,
  type Grid,
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

/**
 * 🚨 The payload is a MATRIX padded to the tallest year; the flow grid is not.
 * Everything below is about that mismatch, which is where a year silently
 * renders short or gains a phantom episode.
 */
describe("seasonCells", () => {
  /** Two seasons: 2020 has 3 episodes, 2021 has 1, so 2021 carries 2 holes. */
  function grid(): Grid {
    const at = (id: string) => cell({ youtube_id: id });
    return {
      rows: [
        { index: 1, cells: [at("a"), at("x")] },
        { index: 2, cells: [at("b"), null] },
        { index: 3, cells: [at("c"), null] },
      ],
    } as unknown as Grid;
  }

  it("returns a season's real cells, oldest first, with holes dropped", () => {
    expect(seasonCells(grid(), 0).map((entry) => entry.cell.youtube_id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(seasonCells(grid(), 1).map((entry) => entry.cell.youtube_id)).toEqual(["x"]);
  });

  it("keeps the API's own row index, never the position in the returned array", () => {
    // A leading hole is not a shape the API produces today, but deriving the
    // index from the array would renumber the whole year the day it does.
    const leading = {
      rows: [
        { index: 1, cells: [null] },
        { index: 2, cells: [cell({ youtube_id: "b" })] },
      ],
    } as unknown as Grid;
    expect(seasonCells(leading, 0)).toEqual([
      { cell: expect.objectContaining({ youtube_id: "b" }), index: 2 },
    ]);
  });

  it("returns nothing for a season index that does not exist", () => {
    expect(seasonCells(grid(), 9)).toEqual([]);
  });
});

/**
 * 🚨 The whole risk of newest-first is the INDEX, not the order.
 *
 * `seasonCells(grid, seasonIndex)` and `row.cells[seasonIndex]` are keyed by
 * the season's position in the API array. A reversal that renumbers as it goes
 * still renders every cell, still shows a plausible count under every header,
 * and quietly pairs each year's heading with a different year's episodes.
 */
describe("flowSeasons", () => {
  const grid = {
    seasons: [{ year: 2023 }, { year: 2024 }, { year: 2025 }],
  } as unknown as Grid;

  it("stacks the years newest first", () => {
    expect(flowSeasons(grid).map((entry) => entry.season.year)).toEqual([
      2025, 2024, 2023,
    ]);
  });

  it("keeps each season's ORIGINAL index, not its position after reversing", () => {
    expect(flowSeasons(grid)).toEqual([
      { season: { year: 2025 }, seasonIndex: 2 },
      { season: { year: 2024 }, seasonIndex: 1 },
      { season: { year: 2023 }, seasonIndex: 0 },
    ]);
  });

  it("does not mutate the API's own array, which mobile and the sparkline read", () => {
    const payload = {
      seasons: [{ year: 2023 }, { year: 2024 }],
    } as unknown as Grid;
    flowSeasons(payload);
    expect(payload.seasons.map((season) => season.year)).toEqual([2023, 2024]);
  });

  it("has nothing to stack for a channel with no episodes", () => {
    expect(flowSeasons({ seasons: [] } as unknown as Grid)).toEqual([]);
  });
});

describe("the two density decisions are independent", () => {
  const shaped = (seasons: number, rows: number, total: number) =>
    ({
      seasons: Array.from({ length: seasons }, (_, i) => ({ year: 2016 + i })),
      rows: Array.from({ length: rows }, (_, i) => ({ index: i + 1, cells: [] })),
      total_count: total,
    }) as unknown as Grid;

  it("transposes on mobile only up to 4 years and 48 episodes in the tallest", () => {
    expect(hasMobileTranspose(shaped(4, 48, 100))).toBe(true);
    expect(hasMobileTranspose(shaped(5, 48, 100))).toBe(false);
    expect(hasMobileTranspose(shaped(4, 49, 100))).toBe(false);
  });

  it("decides printed scores on the EPISODE count, not the year count", () => {
    // The flagship channel: 11 years, 1,225 episodes. Colour only.
    expect(printsScores(shaped(11, 183, 1225))).toBe(false);
    // A many-year channel that is still small prints its scores. Under the old
    // single `isRoomy` the year count alone would have denied it.
    expect(printsScores(shaped(11, 30, 243))).toBe(true);
    expect(printsScores(shaped(1, 400, ROOMY_MAX_EPISODES))).toBe(true);
    expect(printsScores(shaped(1, 401, ROOMY_MAX_EPISODES + 1))).toBe(false);
  });
});
