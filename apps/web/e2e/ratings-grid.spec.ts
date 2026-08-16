/**
 * The ratings grid (matrix section 3). The signature screen.
 *
 * 🚨 IT IS RENDERED IN TWO DIFFERENT SHAPES, and getting either one wrong would
 * still typecheck, lint and build.
 *
 *   FLOW    (`[data-grid="flow"]`)     one block per year; inside a block the
 *                                      year's episodes WRAP across the width,
 *                                      oldest first. This is the only layout
 *                                      that shows a whole channel - the matrix
 *                                      it replaced was 3,913px wide inside a
 *                                      1,150px card on the flagship channel.
 *     year blocks             === grid.seasons.length
 *     cells in block[season]  === that season's non-null cells, in row order
 *
 *   MOBILE  (`[data-grid="mobile"]`)   TRANSPOSED table, kept for channels with
 *                                      at most 4 years: positions are ROWS,
 *                                      years are COLUMNS
 *     rendered tbody rows     === grid.rows.length
 *     rendered columns        === grid.seasons.length
 *     rendered[row][season]   === grid.rows[row].cells[season]
 *
 * On a channel that has both, both are in the HTML at every width and CSS
 * decides which one is visible. Each test below walks the FULL set of cells of
 * the shape it reads, rather than eyeballing a couple of them.
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
type GridCell = Schema<"GridCellOut">;

/** The one channel small enough for the roomy grid. 71 episodes, 2024-2026. */
const CHANNEL_SLUG = "ivan-kirkov";
const CHANNEL_PATH = `/channels/${CHANNEL_SLUG}`;
const GRID_API = `/api/channels/${CHANNEL_SLUG}/grid`;

/** The 44px touch target the mobile transpose exists to protect. */
const MIN_TOUCH_TARGET_PX = 44;

interface RenderedCell {
  hasLink: boolean;
  text: string;
  href: string | null;
  className: string;
  ariaLabel: string | null;
  iconCount: number;
}

interface RenderedYear {
  header: string;
  cells: RenderedCell[];
}

interface RenderedTable {
  columnHeaders: string[];
  rowHeaders: string[];
  rows: RenderedCell[][];
}

/**
 * Read the whole flow grid in one round trip. A per-cell Playwright locator
 * call across 111 cells is slow enough to make the suite annoying to run, and
 * the comparison is pure data anyway.
 */
async function readFlow(page: Page): Promise<RenderedYear[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-grid="flow"]');
    if (!root) throw new Error("no flow ratings grid was rendered");

    return Array.from(root.querySelectorAll("section[data-year]")).map((section) => ({
      header: (section.querySelector("h3")?.textContent ?? "").trim(),
      cells: Array.from(
        section.querySelectorAll("[data-year-cells] > a"),
      ).map((link) => ({
        hasLink: true,
        text: (link.textContent ?? "").trim(),
        href: link.getAttribute("href"),
        className: link.getAttribute("class") ?? "",
        ariaLabel: link.getAttribute("aria-label"),
        iconCount: link.querySelectorAll("svg").length,
      })),
    }));
  });
}

/** Read the transposed mobile table in one round trip. */
async function readMobile(page: Page): Promise<RenderedTable> {
  return page.evaluate(() => {
    const table = document.querySelector('table[data-grid="mobile"]');
    if (!table) throw new Error("no mobile ratings grid was rendered");

    const columnHeaders = Array.from(table.querySelectorAll("thead th"))
      // The first header is the sticky gutter, which has no value of its own.
      .slice(1)
      .map((th) => (th.textContent ?? "").trim());

    const rowHeaders: string[] = [];
    const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) => {
      rowHeaders.push((tr.querySelector("th")?.textContent ?? "").trim());
      return Array.from(tr.querySelectorAll("td")).map((td) => {
        const link = td.querySelector("a");
        return {
          hasLink: link !== null,
          text: (link?.textContent ?? td.textContent ?? "").trim(),
          href: link?.getAttribute("href") ?? null,
          className: link?.getAttribute("class") ?? "",
          ariaLabel: link?.getAttribute("aria-label") ?? null,
          iconCount: td.querySelectorAll("svg").length,
        };
      });
    });

    return { columnHeaders, rowHeaders, rows };
  });
}

/** The cell the API says belongs at a given (season, position). */
function apiCell(grid: Grid, seasonIndex: number, rowIndex: number): GridCell | null {
  return grid.rows[rowIndex]?.cells[seasonIndex] ?? null;
}

/**
 * The API's cells for one season, oldest first, holes dropped.
 *
 * 🚨 Written here a second time on purpose rather than imported from
 * `grid-model`. If the app's own helper started dropping cells, importing it
 * would make this suite agree with the bug.
 */
function apiSeasonCells(grid: Grid, seasonIndex: number): GridCell[] {
  return grid.rows
    .map((row) => row.cells[seasonIndex])
    .filter((cell): cell is GridCell => cell !== null && cell !== undefined);
}

/** Same formatting rule as the app, written a second time on purpose. */
function expectedText(cell: GridCell | null): string {
  if (!cell) return "";
  return cell.score === null ? "?" : cell.score.toFixed(1);
}

function markerCount(cell: GridCell): number {
  return (
    (cell.is_provisional ? 1 : 0) +
    (cell.members_only ? 1 : 0) +
    (cell.content_kind === "stream" ? 1 : 0)
  );
}

test.describe("3. ratings grid", () => {
  test("3.1 the flow grid renders one block per year, holding that year's episodes", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    expect(grid.seasons.length, "the channel has no seasons to chart").toBeGreaterThan(0);

    await page.goto(CHANNEL_PATH);
    const rendered = await readFlow(page);

    expect(rendered).toHaveLength(grid.seasons.length);

    for (const [seasonIndex, season] of grid.seasons.entries()) {
      expect(rendered[seasonIndex].header).toContain(season.label);
      // 🚨 The count the API states for the year, not the count of cells the
      // matrix happened to pad it to. A year rendered short is exactly the bug
      // this whole layout exists to kill.
      expect(
        rendered[seasonIndex].cells,
        `${season.label} rendered the wrong number of episodes`,
      ).toHaveLength(season.episode_count);
    }
  });

  test("3.1b every episode of the channel is on the page, and nothing is duplicated", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);

    await page.goto(CHANNEL_PATH);
    const rendered = await readFlow(page);

    const hrefs = rendered.flatMap((year) => year.cells.map((cell) => cell.href));
    expect(hrefs).toHaveLength(grid.total_count);
    expect(new Set(hrefs).size, "a cell was rendered twice").toBe(grid.total_count);
  });

  test("3.2 the mobile grid is TRANSPOSED: positions are rows, years are columns", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);

    await page.goto(CHANNEL_PATH);
    const rendered = await readMobile(page);

    // This is the assertion that would catch a copy-paste of the flow
    // orientation into the mobile markup.
    expect(rendered.rows).toHaveLength(grid.rows.length);
    expect(rendered.columnHeaders).toHaveLength(grid.seasons.length);

    for (const [seasonIndex, season] of grid.seasons.entries()) {
      expect(rendered.columnHeaders[seasonIndex]).toContain(season.label);
    }
    expect(rendered.rowHeaders).toEqual(grid.rows.map((row) => String(row.index)));
  });

  test("3.3 every flow cell matches the API cell for its position in the year", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);

    await page.goto(CHANNEL_PATH);
    const rendered = await readFlow(page);

    let checked = 0;
    for (const [seasonIndex, season] of grid.seasons.entries()) {
      const expectedCells = apiSeasonCells(grid, seasonIndex);
      for (const [position, cell] of expectedCells.entries()) {
        const node = rendered[seasonIndex].cells[position];
        expect(
          node,
          `${season.label} is missing the cell at position ${position + 1}`,
        ).toBeDefined();
        expect(node.href).toBe(`/e/${cell.youtube_id}`);
        expect(node.text).toBe(expectedText(cell));
        expect(node.ariaLabel).toContain(cell.title);
        checked += 1;
      }
    }

    // A test that iterated over nothing would otherwise pass silently.
    expect(checked, "walked zero real cells").toBeGreaterThan(0);
  });

  test("3.4 every mobile cell matches the API cell for its coordinates", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);

    await page.goto(CHANNEL_PATH);
    const rendered = await readMobile(page);

    let checked = 0;
    for (let rowIndex = 0; rowIndex < grid.rows.length; rowIndex += 1) {
      for (const [seasonIndex] of grid.seasons.entries()) {
        const cell = apiCell(grid, seasonIndex, rowIndex);
        const node = rendered.rows[rowIndex][seasonIndex];

        if (!cell) {
          // A hole must read as absent: no link, no number, not clickable.
          expect(node.hasLink).toBe(false);
          expect(node.text).toBe("");
          continue;
        }

        expect(node.hasLink).toBe(true);
        expect(node.href).toBe(`/e/${cell.youtube_id}`);
        expect(node.text).toBe(expectedText(cell));
        checked += 1;
      }
    }

    expect(checked, "walked zero real cells").toBeGreaterThan(0);
  });

  test("3.5 an unrated cell is never styled as the worst band", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    const unrated = grid.rows
      .flatMap((row) => row.cells)
      .filter((cell): cell is GridCell => cell !== null && cell.score === null);
    expect(
      unrated.length,
      "no unrated episode in the fixture, so 3.5 proves nothing",
    ).toBeGreaterThan(0);

    await page.goto(CHANNEL_PATH);
    const rendered = await readFlow(page);

    const garbage = bandStyle("garbage").cell.split(" ")[0];
    const nodes = rendered
      .flatMap((year) => year.cells)
      .filter((node) => node.text === "?");
    expect(nodes.length).toBe(unrated.length);

    for (const node of nodes) {
      // Absent is not bad. It must not carry a band fill at all.
      expect(node.className).not.toContain(garbage);
      expect(node.className).toContain("border-dashed");
      expect(node.ariaLabel).toContain(copy.band.unrated);
    }
  });

  test("3.6 markers appear on exactly the cells the API flags", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);

    await page.goto(CHANNEL_PATH);
    const rendered = await readFlow(page);

    let flagged = 0;
    for (const [seasonIndex] of grid.seasons.entries()) {
      for (const [position, cell] of apiSeasonCells(grid, seasonIndex).entries()) {
        const expectedMarkers = markerCount(cell);
        expect(
          rendered[seasonIndex].cells[position].iconCount,
          `marker count wrong on ${cell.youtube_id}`,
        ).toBe(expectedMarkers);
        if (expectedMarkers > 0) flagged += 1;
      }
    }

    expect(flagged, "no flagged cell in the fixture, so 3.6 proves nothing").toBeGreaterThan(
      0,
    );
  });

  test("3.7 the legend names every band the API returns, plus the three markers", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);

    await page.goto(CHANNEL_PATH);

    /**
     * 🚨 The legend is collapsed behind a `<details>` as of 2026-08-15 - it is
     * eleven swatches between the grid and the episode list, and a reader who
     * knows the bands saw them on every visit. It is COLLAPSED, not removed, so
     * this test opens it and then asserts exactly what it always did.
     *
     * Asserting the closed state would be the weakening: a legend that has been
     * emptied out looks identical to one that is merely shut.
     */
    const toggle = page
      .locator("main")
      .getByText(copy.channel.legendToggle, { exact: true });
    await expect(toggle.first()).toBeVisible();
    await toggle.first().click();

    const legend = page.locator("main").getByText(copy.band.unrated, { exact: true });
    await expect(legend.first()).toBeVisible();

    for (const band of grid.bands) {
      await expect(
        page.getByText(band.label, { exact: true }).first(),
        `legend is missing the ${band.key} band`,
      ).toBeVisible();
    }
    for (const marker of [
      copy.band.provisional,
      copy.band.membersOnly,
      copy.band.stream,
    ]) {
      await expect(page.getByText(marker, { exact: true }).first()).toBeVisible();
    }
  });

  test("3.8 the public/elite toggle is a link and recomputes the whole grid", async ({
    page,
  }) => {
    const [publicGrid, eliteGrid] = await Promise.all([
      apiJson<Grid>(page, `${GRID_API}?score=public`),
      apiJson<Grid>(page, `${GRID_API}?score=elite`),
    ]);

    await page.goto(CHANNEL_PATH);

    // Links, not client state: a filtered grid must be shareable and indexable.
    const elite = page.getByRole("link", { name: copy.channel.eliteScore, exact: true });
    await expect(elite).toHaveAttribute("href", `${CHANNEL_PATH}?score=elite`);

    await elite.click();
    await page.waitForURL(/score=elite/);

    // 🚨 `waitForURL` resolves on the History API update, which during a soft
    // navigation happens BEFORE the new RSC payload is applied. Reading the grid
    // at that instant can capture the PUBLIC cells still in the DOM, and the
    // failure then looks like wrong scores rather than a mistimed read - which
    // is how this test spent a session logged as an unexplained flake.
    //
    // `aria-current` is set by the SERVER from `score === "elite"`, so it can
    // only be true once the elite render has actually landed. Asserting it is
    // additive: it pins the toggle's accessibility state as well.
    await expect(elite).toHaveAttribute("aria-current", "true");

    const rendered = await readFlow(page);
    const renderedScores = rendered.flatMap((year) => year.cells.map((c) => c.text));
    const expectedScores = eliteGrid.seasons.flatMap((_season, seasonIndex) =>
      apiSeasonCells(eliteGrid, seasonIndex).map(expectedText),
    );

    expect(renderedScores).toEqual(expectedScores);

    // Proves the switch actually did something, rather than the two modes
    // happening to be identical.
    const publicScores = publicGrid.seasons.flatMap((_season, seasonIndex) =>
      apiSeasonCells(publicGrid, seasonIndex).map(expectedText),
    );
    if (JSON.stringify(publicScores) === JSON.stringify(expectedScores)) {
      // With zero community ratings (the state since the 2026-08-14 demo-data
      // purge) every cell is "?" in BOTH modes, so "the modes differ" is a
      // property of the DATA, not of the toggle.
      //
      // 🚨 Do NOT "keep it green" by re-asserting renderedScores against
      // publicScores - that is byte-identical to the assertion above and
      // proves nothing (review finding, 2026-08-14). Assert instead the two
      // things that still discriminate: the API really served two DIFFERENT
      // projections, and the identical cells are explained by there being
      // nothing to average. The server-render evidence is `aria-current`,
      // asserted above. The stronger check re-arms itself on the first rating.
      expect(publicGrid.score_kind).toBe("public");
      expect(eliteGrid.score_kind).toBe("elite");
      expect(
        eliteGrid.rated_count,
        "grids matched but ratings exist - the toggle may not be recomputing",
      ).toBe(0);
    } else {
      expect(renderedScores).not.toEqual(publicScores);
    }
  });

  test("3.9 each year block states its episode count and its average", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);

    await page.goto(CHANNEL_PATH);
    const rendered = await readFlow(page);

    for (const [seasonIndex, season] of grid.seasons.entries()) {
      const header = rendered[seasonIndex].header;
      expect(
        header,
        `season ${season.label} shows the wrong episode count`,
      ).toContain(copy.channels.episodeCount(season.episode_count));
      if (season.average === null) continue;
      expect(header, `season ${season.label} shows the wrong average`).toContain(
        season.average.toFixed(1),
      );
    }
  });
});

/**
 * 🚨 THE REGRESSION THIS LAYOUT EXISTS FOR (2026-08-16).
 *
 * The grid used to be a matrix whose horizontal axis was "every episode of the
 * busiest year". On the flagship channel that was 3,913px inside a 1,150px
 * card, so a laptop showed 52 of 183 columns and the rest sat behind a scroll
 * container with no visible scrollbar. It looked like the site only had a few
 * hundred episodes.
 *
 * This runs against the BIGGEST channel deliberately - the small one fitted
 * even under the old layout, so it could never have caught the bug.
 */
test.describe("3.12 the whole channel is on the page", () => {
  const BIG_SLUG = encodeURIComponent("комеди-клуб-подкаст-comedy-club-podcast");
  const BIG_PATH = `/channels/${BIG_SLUG}`;

  test("3.12 nothing on the biggest channel scrolls sideways", async ({ page }) => {
    await page.goto(BIG_PATH);

    const overflow = await page.evaluate(() => {
      const root = document.querySelector('[data-grid="flow"]');
      if (!root) throw new Error("no flow ratings grid was rendered");
      // Every element inside the grid, not just the root: the failure mode
      // being pinned is an inner container that scrolls while the page does
      // not, which is exactly what the deleted matrix did.
      return Array.from(root.querySelectorAll("*"))
        .concat(root)
        .map((el) => el.scrollWidth - el.clientWidth)
        .filter((delta) => delta > 1).length;
    });

    expect(overflow, "something inside the grid still scrolls sideways").toBe(0);
    expect(await hasHorizontalOverflow(page), "the page itself must not scroll").toBe(
      false,
    );
  });

  test("3.12 every one of the biggest channel's episodes is rendered", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, `/api/channels/${BIG_SLUG}/grid`);
    expect(
      grid.total_count,
      "the big channel got small, so this test no longer proves anything",
    ).toBeGreaterThan(1000);

    await page.goto(BIG_PATH);
    const rendered = await readFlow(page);

    const hrefs = rendered.flatMap((year) => year.cells.map((cell) => cell.href));
    expect(hrefs).toHaveLength(grid.total_count);
    expect(new Set(hrefs).size).toBe(grid.total_count);
  });
});

test.describe("3.10 the transpose keeps its promises at 390px", () => {
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) > 500,
    "these are the mobile-specific guarantees",
  );

  test("3.10 the page never scrolls sideways", async ({ page }) => {
    await page.goto(CHANNEL_PATH);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("3.10 the mobile grid itself does not scroll sideways either", async ({
    page,
  }) => {
    await page.goto(CHANNEL_PATH);

    // The whole point of the transpose: three years fit, so there is nothing to
    // scroll. A regression here means the cells stopped being width-flexible.
    const overflow = await page.evaluate(() => {
      const table = document.querySelector('table[data-grid="mobile"]');
      if (!table) throw new Error("no mobile grid was rendered");
      return table.scrollWidth - table.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("3.10 every mobile cell clears the 44px touch target", async ({ page }) => {
    await page.goto(CHANNEL_PATH);

    const heights = await page.evaluate(() => {
      const table = document.querySelector('table[data-grid="mobile"]');
      if (!table) throw new Error("no mobile grid was rendered");
      return Array.from(table.querySelectorAll("tbody td a")).map(
        (link) => link.getBoundingClientRect().height,
      );
    });

    expect(heights.length, "walked zero cells").toBeGreaterThan(0);
    for (const height of heights) {
      expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX - 0.5);
    }
  });

  test("3.11 tapping a cell opens the preview instead of navigating", async ({
    page,
  }) => {
    await page.goto(CHANNEL_PATH);

    const cell = page.locator('table[data-grid="mobile"] a[data-cell]').first();
    const href = await cell.getAttribute("href");
    expect(href).toMatch(/^\/e\//);

    await cell.click();

    // The preview opens; the URL does not change.
    await expect(
      page.getByRole("button", { name: copy.episode.openEpisode }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(CHANNEL_PATH);

    // And the preview's CTA is what actually navigates.
    await page.getByRole("button", { name: copy.episode.openEpisode }).click();
    await page.waitForURL((url) => url.pathname === href);
  });
});
