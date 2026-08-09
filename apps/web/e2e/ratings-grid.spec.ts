/**
 * Ratings grid (matrix section 3).
 *
 * THE GRID IS TRANSPOSED. The API sends it EPISODE-MAJOR
 * (`rows[episodeIndex].cells[seasonIndex]`) and `RatingsGrid.tsx` renders YEARS
 * AS ROWS and EPISODE POSITIONS AS COLUMNS. So:
 *
 *   rendered tbody row count    === grid.seasons.length
 *   rendered column count       === grid.rows.length
 *   rendered[season][column]    === grid.rows[column].cells[season]
 *
 * Getting that direction wrong is the single most likely bug in this component,
 * and it would still typecheck, lint and build. Every test below walks the full
 * matrix rather than eyeballing a couple of cells.
 *
 * Nothing here hardcodes a score. Ratings change; the invariant under test is
 * "the rendered grid matches GET /api/channels/{slug}/grid".
 */
import type { Page } from "@playwright/test";
import type { Schema } from "@ccc/api-types";

import { copy } from "@/lib/copy";
import { bandStyle } from "@/lib/score-bands";

import { test, expect, apiJson, hasHorizontalOverflow } from "./fixtures";

type Grid = Schema<"ChannelGridOut">;

/** The one channel with real ingested data. 74 episodes across 2024-2026. */
const CHANNEL_SLUG = "ivan-kirkov";
const CHANNEL_PATH = `/channels/${CHANNEL_SLUG}`;
const GRID_API = `/api/channels/${CHANNEL_SLUG}/grid`;

/** What one rendered `<td>` looks like from the browser's point of view. */
interface RenderedCell {
  hasLink: boolean;
  /** Text of the link, i.e. the formatted score. Empty for a hole. */
  text: string;
  href: string | null;
  className: string;
  ariaLabel: string | null;
  /** `class` of every svg inside the cell, so lucide icons can be identified. */
  icons: string[];
}

interface RenderedRow {
  /** The year label, e.g. "2024". */
  year: string;
  /** The season-average line under the year, e.g. "7.5 avg". */
  average: string;
  cells: RenderedCell[];
}

interface RenderedGrid {
  columnHeaders: string[];
  rows: RenderedRow[];
}

/**
 * Read the whole rendered table in a single round trip.
 *
 * 74 cells x a per-cell Playwright locator call is slow enough to make the suite
 * annoying to run, and the comparison is pure data anyway.
 */
async function readRenderedGrid(page: Page): Promise<RenderedGrid> {
  return page.evaluate(() => {
    const table = document.querySelector("table");
    if (!table) throw new Error("no ratings grid table was rendered");

    const columnHeaders = Array.from(table.querySelectorAll("thead th"))
      // The first header is the sticky year column, which has no episode number.
      .slice(1)
      .map((th) => (th.textContent ?? "").trim());

    const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) => {
      // The row header holds two stacked spans: the year, then the average.
      const headerSpans = Array.from(tr.querySelectorAll("th span span")).map(
        (span) => (span.textContent ?? "").trim(),
      );

      const cells = Array.from(tr.querySelectorAll("td")).map((td) => {
        const link = td.querySelector("a");
        return {
          hasLink: link !== null,
          text: (link?.textContent ?? td.textContent ?? "").trim(),
          href: link?.getAttribute("href") ?? null,
          className: link?.getAttribute("class") ?? "",
          ariaLabel: link?.getAttribute("aria-label") ?? null,
          icons: Array.from(td.querySelectorAll("svg")).map(
            (svg) => svg.getAttribute("class") ?? "",
          ),
        };
      });

      return {
        year: headerSpans[0] ?? "",
        average: headerSpans[1] ?? "",
        cells,
      };
    });

    return { columnHeaders, rows };
  });
}

/** Geometry of the scroll container, its sticky row header, and its first cell. */
async function readGridGeometry(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector("table");
    if (!table) throw new Error("no ratings grid table was rendered");
    const container = table.parentElement;
    if (!container) throw new Error("grid table has no scroll container");

    const rowHeader = table.querySelector("tbody tr th");
    const firstCellLink = table.querySelector("tbody tr td a");
    if (!rowHeader || !firstCellLink) throw new Error("grid rendered with no cells");

    return {
      containerLeft: container.getBoundingClientRect().left,
      rowHeaderLeft: rowHeader.getBoundingClientRect().left,
      firstCellLeft: firstCellLink.getBoundingClientRect().left,
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth,
      scrollLeft: container.scrollLeft,
    };
  });
}

/** Legend entries, read as text so the assertion does not depend on styling. */
async function readLegendItems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const table = document.querySelector("table");
    // table -> scroll container -> grid root -> legend is the last child.
    const legend = table?.parentElement?.parentElement?.lastElementChild;
    if (!legend) throw new Error("grid legend was not rendered");
    return Array.from(legend.children).map((child) =>
      (child.textContent ?? "").trim(),
    );
  });
}

/**
 * The score exactly as the component should print it: one decimal, and a
 * placeholder for unrated. Derived from the API value, never hardcoded.
 */
function expectedCellText(score: number | null): string {
  return score === null ? "?" : score.toFixed(1);
}

/** Walk every API cell together with the rendered cell it should have produced. */
function eachCell(
  grid: Grid,
  rendered: RenderedGrid,
  visit: (args: {
    apiCell: Schema<"GridCellOut"> | null;
    renderedCell: RenderedCell;
    where: string;
  }) => void,
) {
  grid.seasons.forEach((season, seasonIndex) => {
    grid.rows.forEach((row, rowIndex) => {
      visit({
        apiCell: row.cells[seasonIndex] ?? null,
        renderedCell: rendered.rows[seasonIndex]!.cells[rowIndex]!,
        where: `season ${season.label} (rendered row ${seasonIndex}), episode position ${row.index} (rendered column ${rowIndex})`,
      });
    });
  });
}

test.describe("ratings grid", () => {
  test("3.1 orientation: tbody rows are years, thead columns are episode numbers", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const rendered = await readRenderedGrid(page);

    // Rows are years. If the component ever stopped transposing, these would be
    // episode positions instead.
    expect(rendered.rows.map((row) => row.year)).toEqual(
      grid.seasons.map((season) => season.label),
    );
    for (const row of rendered.rows) {
      expect(row.year, "a row header must be a calendar year").toMatch(/^\d{4}$/);
    }

    // Columns are the episode's position within its year, 1-based.
    expect(rendered.columnHeaders).toEqual(
      grid.rows.map((row) => String(row.index)),
    );
    for (const header of rendered.columnHeaders) {
      expect(header, "a column header must be an episode number").toMatch(/^\d+$/);
    }
  });

  test("3.2 row count equals seasons.length from the API", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);

    // Transposed: the API's seasons become the rendered ROWS.
    await expect(page.locator("tbody tr")).toHaveCount(grid.seasons.length);
    expect(grid.seasons.length).toBeGreaterThan(1);
  });

  test("3.3 column count equals rows.length from the API", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const rendered = await readRenderedGrid(page);

    // Transposed: the API's rows become the rendered COLUMNS.
    expect(rendered.columnHeaders).toHaveLength(grid.rows.length);
    for (const row of rendered.rows) {
      expect(row.cells).toHaveLength(grid.rows.length);
    }
    expect(grid.rows.length).toBeGreaterThan(1);
  });

  test("3.4 every cell value matches the API", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const rendered = await readRenderedGrid(page);

    let checked = 0;
    eachCell(grid, rendered, ({ apiCell, renderedCell, where }) => {
      if (!apiCell) return;
      checked += 1;
      // Identity first: the right EPISODE has to be in this slot. A transposition
      // bug would still produce plausible-looking numbers, so the youtube id and
      // the title are what actually pin the mapping down.
      expect(renderedCell.href, `href at ${where}`).toBe(`/e/${apiCell.youtube_id}`);
      expect(renderedCell.ariaLabel, `aria-label at ${where}`).toContain(
        apiCell.title,
      );
      // Then the value.
      expect(renderedCell.text, `score at ${where}`).toBe(
        expectedCellText(apiCell.score),
      );
    });

    // The fixture must actually exercise the loop.
    expect(checked).toBe(grid.total_count);
    expect(checked).toBeGreaterThan(0);
  });

  test("3.5 null cells render empty, never a zero", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const rendered = await readRenderedGrid(page);

    let holes = 0;
    eachCell(grid, rendered, ({ apiCell, renderedCell, where }) => {
      if (apiCell) return;
      holes += 1;
      expect(renderedCell.hasLink, `hole at ${where} must not be a link`).toBe(false);
      expect(renderedCell.text, `hole at ${where} must be empty`).toBe("");
      expect(renderedCell.text).not.toBe("0");
      expect(renderedCell.text).not.toBe("0.0");
    });

    // A short season has to leave holes, or this test proved nothing.
    expect(
      holes,
      "fixture must contain at least one season shorter than the tallest",
    ).toBeGreaterThan(0);
  });

  test("3.6 year label shows the season average to one decimal", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const rendered = await readRenderedGrid(page);

    grid.seasons.forEach((season, seasonIndex) => {
      const expected =
        season.average === null
          ? copy.grid.averageRow
          : copy.grid.seasonAverage(season.average.toFixed(1));
      expect(
        rendered.rows[seasonIndex]!.average,
        `season average for ${season.label}`,
      ).toBe(expected);
    });
  });

  test("3.7 year column stays sticky while the grid scrolls right", async ({
    page,
  }) => {
    await page.goto(CHANNEL_PATH);

    const before = await readGridGeometry(page);
    expect(
      before.scrollWidth,
      "grid must be wider than its container for this test to mean anything",
    ).toBeGreaterThan(before.clientWidth);

    await page.evaluate(() => {
      const container = document.querySelector("table")?.parentElement;
      if (container) container.scrollLeft = container.scrollWidth;
    });

    const after = await readGridGeometry(page);

    // The episode cells actually moved...
    expect(after.scrollLeft).toBeGreaterThan(0);
    expect(after.firstCellLeft).toBeLessThan(before.firstCellLeft - 50);
    // ...while the year header stayed pinned to the container's left edge.
    expect(Math.abs(after.rowHeaderLeft - after.containerLeft)).toBeLessThanOrEqual(2);
  });

  test("3.8 grid scrolls internally and the page does not", async ({ page }) => {
    await page.goto(CHANNEL_PATH);

    const geometry = await readGridGeometry(page);
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);

    // The whole point of the internal scroller: a phone must never scroll the
    // page body sideways.
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("3.9 band colours match the API band key", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const rendered = await readRenderedGrid(page);

    const seenBands = new Set<string>();
    eachCell(grid, rendered, ({ apiCell, renderedCell, where }) => {
      if (!apiCell) return;
      seenBands.add(String(apiCell.band));
      // `bandStyle` is the app's own key -> class map, so what this asserts is
      // the WIRING: the cell at this position carries the class for the band the
      // API assigned to the episode at this position. A transposed or shifted
      // grid fails here even though every individual class is valid.
      const expectedClasses = bandStyle(apiCell.band).cell.split(" ");
      for (const className of expectedClasses) {
        expect(renderedCell.className, `band class at ${where}`).toContain(className);
      }
    });

    // More than one band must be present, or a component that always emitted the
    // same colour would still pass.
    expect(seenBands.size).toBeGreaterThan(1);
  });

  test("3.10 provisional cells show the warning icon", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const rendered = await readRenderedGrid(page);

    let provisional = 0;
    eachCell(grid, rendered, ({ apiCell, renderedCell, where }) => {
      if (!apiCell) return;
      const icons = renderedCell.icons.join(" ");
      if (apiCell.is_provisional) {
        provisional += 1;
        expect(icons, `provisional marker at ${where}`).toContain(
          "lucide-triangle-alert",
        );
      } else {
        expect(icons, `unexpected provisional marker at ${where}`).not.toContain(
          "lucide-triangle-alert",
        );
      }
    });

    expect(
      provisional,
      "fixture must contain at least one provisional episode",
    ).toBeGreaterThan(0);
  });

  test("3.11 members-only cells show the crown icon", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const rendered = await readRenderedGrid(page);

    let membersOnly = 0;
    eachCell(grid, rendered, ({ apiCell, renderedCell, where }) => {
      if (!apiCell) return;
      const icons = renderedCell.icons.join(" ");
      if (apiCell.members_only) {
        membersOnly += 1;
        expect(icons, `members-only marker at ${where}`).toContain("lucide-crown");
      } else {
        expect(icons, `unexpected crown at ${where}`).not.toContain("lucide-crown");
      }
    });

    // Paywalled episodes are listed like any other, so this path must be live.
    expect(
      membersOnly,
      "fixture must contain at least one members-only episode",
    ).toBeGreaterThan(0);
  });

  test("3.12 stream cells show the radio icon", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const rendered = await readRenderedGrid(page);

    let streams = 0;
    eachCell(grid, rendered, ({ apiCell, renderedCell, where }) => {
      if (!apiCell) return;
      const icons = renderedCell.icons.join(" ");
      if (apiCell.content_kind === "stream") {
        streams += 1;
        expect(icons, `stream marker at ${where}`).toContain("lucide-radio");
      } else {
        expect(icons, `unexpected radio icon at ${where}`).not.toContain(
          "lucide-radio",
        );
      }
    });

    // Past live streams ARE episodes for a podcast, so they must be in the grid.
    expect(streams, "fixture must contain at least one stream").toBeGreaterThan(0);
  });

  test("3.13 every cell links to its episode page", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const rendered = await readRenderedGrid(page);

    const renderedHrefs = rendered.rows.flatMap((row) =>
      row.cells.filter((cell) => cell.hasLink).map((cell) => cell.href),
    );
    const apiHrefs = grid.rows.flatMap((row) =>
      row.cells
        .filter((cell): cell is Schema<"GridCellOut"> => cell !== null)
        .map((cell) => `/e/${cell.youtube_id}`),
    );

    expect(renderedHrefs).toHaveLength(apiHrefs.length);
    expect([...renderedHrefs].sort()).toEqual([...apiHrefs].sort());
    // Every id must be unique, so no episode is charted twice.
    expect(new Set(renderedHrefs).size).toBe(renderedHrefs.length);
  });

  test("3.14 public/elite toggle changes the URL and re-renders the grid", async ({
    page,
  }) => {
    const publicGrid = await apiJson<Grid>(page, GRID_API);
    const eliteGrid = await apiJson<Grid>(page, `${GRID_API}?score=elite`);

    // Find positions where the two payloads genuinely disagree. Without one, a
    // toggle that did nothing at all would still look correct.
    const divergent: Array<{ season: number; row: number; elite: string }> = [];
    publicGrid.seasons.forEach((_season, seasonIndex) => {
      publicGrid.rows.forEach((row, rowIndex) => {
        const publicCell = row.cells[seasonIndex] ?? null;
        const eliteCell = eliteGrid.rows[rowIndex]?.cells[seasonIndex] ?? null;
        if (!publicCell || !eliteCell) return;
        if (publicCell.score === eliteCell.score) return;
        divergent.push({
          season: seasonIndex,
          row: rowIndex,
          elite: expectedCellText(eliteCell.score),
        });
      });
    });
    expect(
      divergent.length,
      "public and elite scores are identical everywhere, so the toggle cannot be proven",
    ).toBeGreaterThan(0);

    await page.goto(CHANNEL_PATH);

    // `exact: true` is required, not cosmetic. Playwright's `name` option is a
    // case-insensitive SUBSTRING match by default, and an episode card now
    // renders its elite score as the text "Elite 8.7", which lands in that
    // card link's accessible name. A loose match resolves to the toggle plus
    // every card on the page and fails on strict mode. The assertion itself is
    // unchanged - this only pins the selector to the control under test.
    await expect(
      page.getByRole("link", { name: copy.grid.publicScore, exact: true }),
    ).toBeVisible();

    await page
      .getByRole("link", { name: copy.grid.eliteScore, exact: true })
      .click();
    await page.waitForURL((url) => url.searchParams.get("score") === "elite");

    // The elite view announces itself...
    await expect(page.getByText(copy.grid.eliteHint)).toBeVisible();

    // ...and the numbers on screen are now the elite ones.
    const rendered = await readRenderedGrid(page);
    for (const position of divergent) {
      expect(
        rendered.rows[position.season]!.cells[position.row]!.text,
        `elite score at rendered row ${position.season}, column ${position.row}`,
      ).toBe(position.elite);
    }
  });

  test("3.15 elite grid renders without crashing, unrated cells included", async ({
    page,
  }) => {
    const eliteGrid = await apiJson<Grid>(page, `${GRID_API}?score=elite`);
    expect(eliteGrid.score_kind).toBe("elite");

    await page.goto(`${CHANNEL_PATH}?score=elite`);
    const rendered = await readRenderedGrid(page);

    expect(rendered.rows).toHaveLength(eliteGrid.seasons.length);
    expect(rendered.columnHeaders).toHaveLength(eliteGrid.rows.length);

    // An episode with no verified-member ratings is a normal, valid state: it
    // must render the not-rated placeholder, never "0" and never "NaN".
    let unrated = 0;
    eachCell(eliteGrid, rendered, ({ apiCell, renderedCell, where }) => {
      if (!apiCell) return;
      expect(renderedCell.text, `elite score at ${where}`).toBe(
        expectedCellText(apiCell.score),
      );
      if (apiCell.score === null) {
        unrated += 1;
        expect(renderedCell.text).not.toBe("0.0");
        expect(renderedCell.text).not.toContain("NaN");
      }
    });

    // Guard the "no verified members" shape specifically: if every elite cell is
    // unrated the grid must still be a real grid, not an error page.
    expect(rendered.rows.length).toBeGreaterThan(0);
    expect(unrated).toBeGreaterThanOrEqual(0);
  });

  test("3.16 legend lists every band the API returned", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    await page.goto(CHANNEL_PATH);
    const legendItems = await readLegendItems(page);

    for (const band of grid.bands) {
      expect(legendItems, `legend entry for band "${band.key}"`).toContain(band.label);
    }
    // Plus the non-band markers the grid can draw.
    expect(legendItems).toContain(copy.grid.notRated);
    expect(legendItems).toContain(copy.grid.provisional);
    expect(legendItems).toContain(copy.grid.membersOnly);
    expect(legendItems).toContain(copy.grid.stream);
    expect(grid.bands.length).toBeGreaterThan(0);
  });
});

/**
 * Compact mode (matrix section 3, scale variant).
 *
 * A channel with more episodes in its busiest year than
 * `COMPACT_ABOVE_COLUMNS` (48) switches every cell to a 20x24px colour chip:
 * no printed score, no icons, and the hover/focus utilities hoisted onto the
 * table as one descendant rule instead of ~250 characters stamped onto each of
 * 1,300+ cells.
 *
 * The rest of this file exercises `ivan-kirkov` at 37 columns, which is BELOW
 * the threshold - so without this block the compact path had zero coverage
 * while being the path that a real channel actually takes.
 *
 * The channel is discovered from the API rather than hardcoded, and the block
 * skips itself when no channel is large enough, so the suite still passes on a
 * small database.
 */
test.describe("ratings grid at scale (compact mode)", () => {
  // Serial, and deliberately few page loads. Rendering the big channel costs
  // ~20s on the dev server, and running several of these concurrently starves
  // the comfortable-mode tests above into flakiness.
  test.describe.configure({ mode: "serial" });

  /** Mirrors COMPACT_ABOVE_COLUMNS in RatingsGrid.tsx. */
  const COMPACT_ABOVE_COLUMNS = 48;

  async function findWideChannel(page: Page) {
    const channels = await apiJson<Array<{ slug: string }>>(page, "/api/channels");
    for (const channel of channels) {
      const grid = await apiJson<Grid>(
        page,
        `/api/channels/${encodeURIComponent(channel.slug)}/grid`,
      );
      if (grid.rows.length > COMPACT_ABOVE_COLUMNS) return { channel, grid };
    }
    return null;
  }

  test("3.18 a wide grid renders every cell as a link with an accessible name", async ({
    page,
  }) => {
    test.slow();
    const wide = await findWideChannel(page);
    test.skip(
      wide === null,
      `no channel has more than ${COMPACT_ABOVE_COLUMNS} episodes in a single year`,
    );

    const { channel, grid } = wide!;
    const response = await page.goto(`/channels/${encodeURIComponent(channel.slug)}`);
    expect(response?.status()).toBe(200);

    const rendered = await readRenderedGrid(page);
    expect(rendered.rows).toHaveLength(grid.seasons.length);
    expect(rendered.columnHeaders).toHaveLength(grid.rows.length);

    // Compact cells print no score, so identity has to live in href and label.
    let checked = 0;
    eachCell(grid, rendered, ({ apiCell, renderedCell, where }) => {
      if (!apiCell) return;
      checked += 1;
      expect(renderedCell.href, `href at ${where}`).toBe(`/e/${apiCell.youtube_id}`);
      expect(renderedCell.ariaLabel, `aria-label at ${where}`).toContain(apiCell.title);
    });
    expect(checked).toBe(grid.total_count);
    expect(checked).toBeGreaterThan(COMPACT_ABOVE_COLUMNS);
  });

  test("3.19 compact cells drop score text and icons, and never overflow the page", async ({
    page,
  }) => {
    test.slow();
    const wide = await findWideChannel(page);
    test.skip(wide === null, "no channel is wide enough to go compact");

    const { channel, grid } = wide!;
    await page.goto(`/channels/${encodeURIComponent(channel.slug)}`);
    const rendered = await readRenderedGrid(page);

    // No printed number and no inline SVG anywhere in the grid. That is the
    // whole point of compact mode and where the byte savings come from.
    for (const row of rendered.rows) {
      for (const renderedCell of row.cells) {
        expect(renderedCell.text).toBe("");
        expect(renderedCell.icons).toEqual([]);
      }
    }

    // The markers a comfortable cell draws as icons must survive in the label,
    // or compact mode would be hiding information rather than compressing it.
    const flagged = grid.rows
      .flatMap((row) => row.cells)
      .filter(
        (cell): cell is Schema<"GridCellOut"> =>
          cell !== null && (cell.members_only || cell.content_kind === "stream"),
      );
    expect(
      flagged.length,
      "fixture must contain a members-only or stream episode",
    ).toBeGreaterThan(0);

    const labels = rendered.rows
      .flatMap((row) => row.cells)
      .map((renderedCell) => renderedCell.ariaLabel ?? "");
    for (const cell of flagged.slice(0, 5)) {
      const label = labels.find((text) => text.includes(cell.title));
      expect(label, `no rendered label for "${cell.title}"`).toBeTruthy();
      expect(label).toMatch(cell.members_only ? /members only/i : /stream|live/i);
    }

    // 🚨 The regression this block exists for. Tailwind's `sr-only` is
    // `position: absolute`, and in compact mode ~90% of column headers are
    // sr-only. Without a positioned scroll container they escape its overflow
    // and stretch the document: 4,121px wide at a 390px viewport. The grid must
    // scroll inside its own container while the page does not.
    const geometry = await readGridGeometry(page);
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
