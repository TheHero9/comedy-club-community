/**
 * The ratings grid (matrix section 3). The signature screen.
 *
 * 🚨 IT IS RENDERED TWICE, IN TWO DIFFERENT ORIENTATIONS, and getting either
 * direction wrong would still typecheck, lint and build.
 *
 *   DESKTOP (`[data-grid="desktop"]`)  years are ROWS, positions are COLUMNS
 *     rendered tbody rows    === grid.seasons.length
 *     rendered columns       === grid.rows.length
 *     rendered[season][col]  === grid.rows[col].cells[season]
 *
 *   MOBILE  (`[data-grid="mobile"]`)   TRANSPOSED: positions are ROWS, years
 *                                       are COLUMNS
 *     rendered tbody rows    === grid.rows.length
 *     rendered columns       === grid.seasons.length
 *     rendered[row][season]  === grid.rows[row].cells[season]
 *
 * Both are in the HTML at every width; CSS decides which one is visible. Each
 * test below walks the FULL matrix of the orientation its project can see,
 * rather than eyeballing a couple of cells.
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

/** The one channel small enough for the roomy grid. 74 episodes, 2024-2026. */
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

interface RenderedGrid {
  columnHeaders: string[];
  rowHeaders: string[];
  rows: RenderedCell[][];
}

/**
 * Read a whole rendered table in one round trip. 111 cells x a per-cell
 * Playwright locator call is slow enough to make the suite annoying to run, and
 * the comparison is pure data anyway.
 */
async function readGrid(page: Page, which: "mobile" | "desktop"): Promise<RenderedGrid> {
  return page.evaluate((selector) => {
    const table = document.querySelector(`table[data-grid="${selector}"]`);
    if (!table) throw new Error(`no ${selector} ratings grid was rendered`);

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
  }, which);
}

/** The cell the API says belongs at a given (season, position). */
function apiCell(grid: Grid, seasonIndex: number, rowIndex: number): GridCell | null {
  return grid.rows[rowIndex]?.cells[seasonIndex] ?? null;
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
  test("3.1 the desktop grid renders years as rows and positions as columns", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);
    expect(grid.seasons.length, "the channel has no seasons to chart").toBeGreaterThan(0);

    await page.goto(CHANNEL_PATH);
    const rendered = await readGrid(page, "desktop");

    expect(rendered.rows).toHaveLength(grid.seasons.length);
    expect(rendered.columnHeaders).toHaveLength(grid.rows.length);
    expect(rendered.columnHeaders).toEqual(
      grid.rows.map((row) => String(row.index)),
    );

    for (const [seasonIndex, season] of grid.seasons.entries()) {
      expect(rendered.rowHeaders[seasonIndex]).toContain(season.label);
      expect(rendered.rows[seasonIndex]).toHaveLength(grid.rows.length);
    }
  });

  test("3.2 the mobile grid is TRANSPOSED: positions are rows, years are columns", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);

    await page.goto(CHANNEL_PATH);
    const rendered = await readGrid(page, "mobile");

    // This is the assertion that would catch a copy-paste of the desktop
    // orientation into the mobile markup.
    expect(rendered.rows).toHaveLength(grid.rows.length);
    expect(rendered.columnHeaders).toHaveLength(grid.seasons.length);

    for (const [seasonIndex, season] of grid.seasons.entries()) {
      expect(rendered.columnHeaders[seasonIndex]).toContain(season.label);
    }
    expect(rendered.rowHeaders).toEqual(grid.rows.map((row) => String(row.index)));
  });

  test("3.3 every desktop cell matches the API cell for its coordinates", async ({
    page,
  }) => {
    const grid = await apiJson<Grid>(page, GRID_API);

    await page.goto(CHANNEL_PATH);
    const rendered = await readGrid(page, "desktop");

    let checked = 0;
    for (const [seasonIndex] of grid.seasons.entries()) {
      for (let rowIndex = 0; rowIndex < grid.rows.length; rowIndex += 1) {
        const cell = apiCell(grid, seasonIndex, rowIndex);
        const node = rendered.rows[seasonIndex][rowIndex];

        if (!cell) {
          // A hole must read as absent: no link, no number, not clickable.
          expect(node.hasLink, `hole at [${seasonIndex}][${rowIndex}] is a link`).toBe(
            false,
          );
          expect(node.text).toBe("");
          continue;
        }

        expect(node.hasLink).toBe(true);
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
    const rendered = await readGrid(page, "mobile");

    let checked = 0;
    for (let rowIndex = 0; rowIndex < grid.rows.length; rowIndex += 1) {
      for (const [seasonIndex] of grid.seasons.entries()) {
        const cell = apiCell(grid, seasonIndex, rowIndex);
        const node = rendered.rows[rowIndex][seasonIndex];

        if (!cell) {
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
    const rendered = await readGrid(page, "desktop");

    const garbage = bandStyle("garbage").cell.split(" ")[0];
    const nodes = rendered.rows.flat().filter((node) => node.text === "?");
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
    const rendered = await readGrid(page, "desktop");

    let flagged = 0;
    for (const [seasonIndex] of grid.seasons.entries()) {
      for (let rowIndex = 0; rowIndex < grid.rows.length; rowIndex += 1) {
        const cell = apiCell(grid, seasonIndex, rowIndex);
        if (!cell) continue;
        const expectedMarkers = markerCount(cell);
        expect(
          rendered.rows[seasonIndex][rowIndex].iconCount,
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
    // at that instant can capture the PUBLIC table still in the DOM, and the
    // failure then looks like wrong scores rather than a mistimed read - which
    // is how this test spent a session logged as an unexplained flake.
    //
    // `aria-current` is set by the SERVER from `score === "elite"`, so it can
    // only be true once the elite render has actually landed. Asserting it is
    // additive: it pins the toggle's accessibility state as well.
    await expect(elite).toHaveAttribute("aria-current", "true");

    const rendered = await readGrid(page, "desktop");
    const renderedScores = rendered.rows.flat().map((node) => node.text);
    const expectedScores = eliteGrid.seasons.flatMap((_season, seasonIndex) =>
      eliteGrid.rows.map((_row, rowIndex) =>
        expectedText(apiCell(eliteGrid, seasonIndex, rowIndex)),
      ),
    );

    expect(renderedScores).toEqual(expectedScores);

    // Proves the switch actually did something, rather than the two modes
    // happening to be identical.
    const publicScores = publicGrid.seasons.flatMap((_season, seasonIndex) =>
      publicGrid.rows.map((_row, rowIndex) =>
        expectedText(apiCell(publicGrid, seasonIndex, rowIndex)),
      ),
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

  test("3.9 the season average under each year matches the API", async ({ page }) => {
    const grid = await apiJson<Grid>(page, GRID_API);

    await page.goto(CHANNEL_PATH);
    const rendered = await readGrid(page, "desktop");

    for (const [seasonIndex, season] of grid.seasons.entries()) {
      if (season.average === null) continue;
      expect(
        rendered.rowHeaders[seasonIndex],
        `season ${season.label} shows the wrong average`,
      ).toContain(season.average.toFixed(1));
    }
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

/**
 * The fullscreen "Full view" overlay (2026-08-16).
 *
 * 🚨 It replaces "Fit to screen", which scaled the inline grid with a CSS
 * transform but left its container at full height - so the page grew a vertical
 * scrollbar over mostly-empty space, the exact opposite of what the button
 * promised. The replacement transposes the grid (years across, episodes down)
 * so a whole channel fits one frame and can be screenshotted.
 *
 * The two properties worth pinning are the two that would silently regress:
 * the whole channel is present, and the page underneath does not scroll.
 */
test.describe("fullscreen grid", () => {
  test("3.12 the overlay renders every episode of the channel", async ({ page }) => {
    const api = await apiJson<Grid>(page, GRID_API);
    const expected = api.seasons.reduce(
      (total, _season, index) =>
        total + api.rows.filter((row) => row.cells[index] != null).length,
      0,
    );
    expect(expected, "the fixture channel must have episodes").toBeGreaterThan(0);

    await page.goto(CHANNEL_PATH);
    await page.getByTestId("grid-fullscreen-open").click();

    const overlay = page.getByTestId("grid-fullscreen");
    await expect(overlay).toBeVisible();

    // 🚨 Every episode, not a page of them. The whole point is "the entire
    // channel in one frame", so a cap creeping in here is the regression.
    await expect(overlay.locator("a[data-cell]")).toHaveCount(expected);

    // One column per year, in the same order the API returned them.
    for (const season of api.seasons) {
      await expect(overlay.getByText(season.label, { exact: true })).toBeVisible();
    }
  });

  test("3.13 the page behind the overlay does not scroll", async ({ page }) => {
    await page.goto(CHANNEL_PATH);
    await page.getByTestId("grid-fullscreen-open").click();
    await expect(page.getByTestId("grid-fullscreen")).toBeVisible();

    // 🚨 The literal complaint that produced this feature: "it makes the whole
    // page have a vertical scroll bar which is awful". A fixed overlay does not
    // stop a wheel event reaching the document, so the body has to be locked -
    // otherwise closing the overlay leaves the reader somewhere they never
    // navigated to.
    expect(
      await page.evaluate(() => getComputedStyle(document.body).overflow),
    ).toBe("hidden");
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  /**
   * 🚨 The regression that cost two rounds of this feature.
   *
   * Sized by arithmetic, the overlay overflowed twice, and both times the
   * failure was a NUMBER standing in for a layout the browser was going to
   * compute anyway:
   *
   *   1. `(100dvh - chrome) / rowCount` ignored the 1px gap between cells. On
   *      the flagship channel's 184 rows that is 184px, so the tallest years
   *      ran off the bottom.
   *   2. the `chrome` constant was measured at 1280px wide, where the legend
   *      is one line. At 390px it wraps to three and the SMALL channel
   *      overflowed by 22px.
   *
   * It is now flex-sized, so nothing is measured. This runs against the biggest
   * channel in the corpus (1,225 episodes, 11 years) at BOTH viewports, which
   * is what would have caught either bug.
   */
  test("3.13b the biggest channel fits with no inner scroll", async ({ page }) => {
    const slug = "комеди-клуб-подкаст-comedy-club-podcast";
    const grid = await apiJson<Grid>(
      page,
      `/api/channels/${encodeURIComponent(slug)}/grid`,
    );
    const expected = grid.seasons.reduce(
      (total, _season, index) =>
        total + grid.rows.filter((row) => row.cells[index] != null).length,
      0,
    );
    expect(expected, "the flagship channel must be the big one").toBeGreaterThan(500);

    await page.goto(`/channels/${encodeURIComponent(slug)}`);
    await page.getByTestId("grid-fullscreen-open").click();
    await expect(page.getByTestId("grid-fullscreen")).toBeVisible();

    const overlay = page.getByTestId("grid-fullscreen");
    // Every episode is present...
    await expect(overlay.locator("a[data-cell]")).toHaveCount(expected);

    // ...and the scroll container has nothing to scroll.
    const overflow = await page.evaluate(() => {
      const scroller = document.querySelector(
        '[data-testid="grid-fullscreen"] .overflow-auto',
      );
      if (!scroller) return null;
      return scroller.scrollHeight - scroller.clientHeight;
    });
    expect(overflow, "the fullscreen scroll container was not found").not.toBeNull();
    // One pixel of slack for sub-pixel row heights; 184px would be the bug.
    expect(overflow ?? 0).toBeLessThanOrEqual(1);
  });

  test("3.14 closing the overlay restores the page", async ({ page }) => {
    await page.goto(CHANNEL_PATH);
    await page.getByTestId("grid-fullscreen-open").click();
    await expect(page.getByTestId("grid-fullscreen")).toBeVisible();

    await page.getByTestId("grid-fullscreen-close").click();
    await expect(page.getByTestId("grid-fullscreen")).toHaveCount(0);

    // The scroll lock must be released, or the page is left frozen.
    expect(
      await page.evaluate(() => getComputedStyle(document.body).overflow),
    ).not.toBe("hidden");

    // ...and Escape does the same thing.
    await page.getByTestId("grid-fullscreen-open").click();
    await expect(page.getByTestId("grid-fullscreen")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("grid-fullscreen")).toHaveCount(0);
  });

  test("3.15 a cell in the overlay links to its episode", async ({ page }) => {
    await page.goto(CHANNEL_PATH);
    await page.getByTestId("grid-fullscreen-open").click();

    const cell = page.getByTestId("grid-fullscreen").locator("a[data-cell]").first();
    const href = await cell.getAttribute("href");
    expect(href).toMatch(/^\/e\//);

    // The accessible name has to carry the episode: at a few pixels tall the
    // cell has no visible text, so this is the only thing identifying it.
    const label = await cell.getAttribute("aria-label");
    expect(label?.length ?? 0).toBeGreaterThan(3);

    await cell.click();
    await page.waitForURL((url) => url.pathname === href);
  });
});
