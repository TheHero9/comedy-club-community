/**
 * Lane E - matrix section 12 (accessibility).
 *
 * Policy for the axe scan (row 12.1): `critical` and `serious` violations fail
 * the test. `moderate` and `minor` are printed and attached to the report so
 * they are visible and actionable, but they do not gate the suite. Anything that
 * is failed here can only be fixed in app code, which this lane does not own.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Result } from "axe-core";

import { copy } from "@/lib/copy";

import {
  apiJson,
  expect,
  expectSingleVisibleH1,
  PUBLIC_ROUTES,
  test,
  visibleGrid,
} from "./fixtures";

const CHANNEL_SLUG = "ivan-kirkov";

interface EpisodeListResponse {
  items: { youtube_id: string; title: string }[];
}

interface GridCell {
  youtube_id: string;
  title: string;
  score: number | null;
}

interface GridResponse {
  channel_name: string;
  rows: { index: number; cells: (GridCell | null)[] }[];
}

async function firstEpisodeRoute(
  page: Parameters<typeof apiJson>[0],
): Promise<string> {
  const data = await apiJson<EpisodeListResponse>(page, "/api/episodes?limit=1");
  expect(data.items.length).toBeGreaterThan(0);
  return `/e/${data.items[0].youtube_id}`;
}

function summarize(violations: Result[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `      ${node.target.join(" ")}  ${node.html.slice(0, 120)}`)
        .join("\n");
      return `${violation.id} (${violation.impact}) x${violation.nodes.length}: ${violation.help}\n${nodes}`;
    })
    .join("\n");
}

/** Scan the current page and fail only on critical/serious. */
async function scanForA11y(
  page: Parameters<typeof apiJson>[0],
  route: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  const advisory = results.violations.filter(
    (violation) => violation.impact !== "critical" && violation.impact !== "serious",
  );

  if (advisory.length > 0) {
    const text = summarize(advisory);
    // Surfaced in the reporter output and in the HTML report, never silent.
    console.log(`[axe advisory] ${route}\n${text}`);
    test.info().annotations.push({ type: "axe-advisory", description: `${route}: ${text}` });
  }

  // Compared as id strings so the failure message stays readable; the full
  // detail, including the offending nodes, is in the message above it.
  expect(
    blocking.map((violation) => `${violation.id} (${violation.impact})`),
    `Critical/serious accessibility violations on ${route}:\n${summarize(blocking)}`,
  ).toEqual([]);
}

test.describe("12. accessibility", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`12.1 axe finds no critical or serious violation on ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle");
      await scanForA11y(page, route);
    });
  }

  test("12.1 axe finds no critical or serious violation on the episode page", async ({
    page,
  }) => {
    const route = await firstEpisodeRoute(page);
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    await scanForA11y(page, route);
  });

  test("12.2 the ratings grid has an accessible name", async ({ page }) => {
    const grid = await apiJson<GridResponse>(page, `/api/channels/${CHANNEL_SLUG}/grid`);
    await page.goto(`/channels/${CHANNEL_SLUG}`);

    const table = visibleGrid(page);
    await expect(table).toBeVisible();

    // The caption is visually hidden but is what a screen reader announces, so
    // assert on the accessible name rather than on visible text.
    const accessibleName = await table.evaluate((el) => {
      const caption = el.querySelector("caption");
      return caption?.textContent?.trim() ?? "";
    });
    expect(accessibleName.length, "the grid table has no caption").toBeGreaterThan(0);
    expect(
      accessibleName,
      "the caption must name the channel, or it is useless out of context",
    ).toContain(grid.channel_name);
  });

  test("12.3 every grid cell link announces its episode title and score", async ({ page }) => {
    const grid = await apiJson<GridResponse>(page, `/api/channels/${CHANNEL_SLUG}/grid`);
    await page.goto(`/channels/${CHANNEL_SLUG}`);
    await expect(visibleGrid(page)).toBeVisible();

    const cells = grid.rows
      .flatMap((row) => row.cells)
      .filter((cell): cell is GridCell => cell !== null);
    expect(cells.length, "the grid returned no cells to check").toBeGreaterThan(0);

    // Check a spread of cells rather than all ~74, keeping the test fast while
    // still cross-checking against the live API rather than hardcoded text.
    const sample = [cells[0], cells[Math.floor(cells.length / 2)], cells[cells.length - 1]];

    for (const cell of sample) {
      const link = page.locator(`table a[href="/e/${cell.youtube_id}"]`).first();
      await expect(link).toHaveCount(1);
      const label = (await link.getAttribute("aria-label")) ?? "";
      expect(label, `cell ${cell.youtube_id} has no aria-label`).not.toBe("");
      expect(
        label,
        "the label must carry the episode title, not just a bare number",
      ).toContain(cell.title);
      if (cell.score === null) {
        // 🐛 This branch first ran on 2026-08-14, when the demo data was
        // cleared and the whole catalogue became unrated. It used to assert
        // the English "Not rated", which the Bulgarian copy pass had long
        // since replaced - assert the real copy value, never a literal.
        expect(label).toContain(copy.band.unrated);
      } else {
        expect(label).toMatch(/\d+\.\d\/10$/);
      }
    }
  });

  for (const route of PUBLIC_ROUTES) {
    test(`12.4 ${route} has exactly one <h1>`, async ({ page }) => {
      await page.goto(route);
      await expectSingleVisibleH1(page);
    });
  }

  test("12.4 heading order is reported for every route", async ({ page }) => {
    // One test walks every route, and the dev server compiles each route on
    // first hit, so the default 60s budget is not enough under parallel load.
    test.setTimeout(180_000);
    // Heading skips are `moderate` in axe, so per the policy at the top of this
    // file they are reported rather than failed. KNOWN GAP at the time of
    // writing: components/episode/EpisodeCard.tsx renders an <h3> directly under
    // the page <h1>, so /episodes and /search?q=... skip <h2>.
    const skips: string[] = [];

    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      // /status has a scoped loading.tsx, so Next streams a fallback and React
      // stages the resolved subtree in a hidden container before moving it -
      // two h1s exist for an instant. `expectSingleVisibleH1` retries both
      // conditions together; see its docstring.
      await expectSingleVisibleH1(page);
      const levels = await page.evaluate(() =>
        Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) =>
          Number(h.tagName.slice(1)),
        ),
      );
      expect(levels.length, `${route} has no headings at all`).toBeGreaterThan(0);
      expect(levels[0], `${route} does not start at <h1>`).toBe(1);

      for (let i = 1; i < levels.length; i += 1) {
        if (levels[i] - levels[i - 1] > 1) {
          skips.push(`${route}: h${levels[i - 1]} -> h${levels[i]}`);
          break;
        }
      }
    }

    if (skips.length > 0) {
      console.log(`[heading-order advisory]\n${skips.join("\n")}`);
      test.info().annotations.push({ type: "heading-order", description: skips.join("; ") });
    }
  });

  test("12.5 keyboard reaches the grid cell links", async ({ page }) => {
    await page.goto(`/channels/${CHANNEL_SLUG}`);
    await expect(visibleGrid(page)).toBeVisible();

    const firstCell = visibleGrid(page).locator("tbody a").first();
    await firstCell.focus();

    const before = await page.evaluate(() => (document.activeElement as HTMLAnchorElement).href);
    await page.keyboard.press("Tab");
    const after = await page.evaluate(() => {
      const active = document.activeElement as HTMLAnchorElement | null;
      return {
        tag: active?.tagName ?? "",
        href: active?.href ?? "",
        insideTable: Boolean(active?.closest("table")),
      };
    });

    expect(after.tag, "Tab did not land on a link").toBe("A");
    expect(after.insideTable, "Tab left the grid after one cell").toBe(true);
    expect(after.href, "Tab did not move to a different cell").not.toBe(before);
  });

  test("12.5 keyboard reaches the Recheck button on /status", async ({ page }) => {
    await page.goto("/status");
    await expect(page.getByRole("button", { name: copy.status.recheck })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    let pressesToReach = -1;
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      // `copy` cannot be referenced inside page.evaluate - the browser has no
      // module scope - so the label crosses as an argument.
      const isRecheck = await page.evaluate((label) => {
        const active = document.activeElement;
        return (
          active?.tagName === "BUTTON" && (active.textContent ?? "").includes(label)
        );
      }, copy.status.recheck);
      if (isRecheck) {
        pressesToReach = i + 1;
        break;
      }
    }

    expect(
      pressesToReach,
      "the Recheck button is not reachable by keyboard within 40 tab stops",
    ).toBeGreaterThan(0);
  });

  test("12.6 focus is visibly indicated on interactive elements", async ({ page }) => {
    /**
     * Takes a LOCATOR, not a selector.
     *
     * Both grid orientations are always in the DOM and CSS hides one of them,
     * so `document.querySelector("table ... a")` resolves to whichever comes
     * first - which on desktop is the hidden mobile grid. Focusing a
     * `display: none` element never matches `:focus-visible`, so the test
     * failed for a reason that had nothing to do with focus styling.
     */
    async function focusStyles(locator: ReturnType<typeof page.locator>) {
      return locator.evaluate((el: HTMLElement) => {
        const read = () => {
          const style = getComputedStyle(el);
          return [
            style.outlineStyle,
            style.outlineWidth,
            style.outlineColor,
            style.boxShadow,
            style.borderColor,
          ].join(" | ");
        };
        const blurred = read();
        el.focus({ focusVisible: true } as FocusOptions);
        const focused = read();
        const isFocusVisible = el.matches(":focus-visible");
        el.blur();
        return { blurred, focused, isFocusVisible };
      });
    }

    await page.goto("/status");
    const button = await focusStyles(page.locator("main button").first());
    expect(button.isFocusVisible, "the Recheck button never matched :focus-visible").toBe(
      true,
    );
    expect(
      button.focused,
      "focusing the Recheck button changes nothing visually",
    ).not.toBe(button.blurred);

    await page.goto(`/channels/${CHANNEL_SLUG}`);
    await expect(visibleGrid(page)).toBeVisible();
    const cell = await focusStyles(visibleGrid(page).locator("tbody a").first());
    expect(cell.isFocusVisible, "the grid cell link never matched :focus-visible").toBe(
      true,
    );
    expect(cell.focused, "focusing a grid cell changes nothing visually").not.toBe(
      cell.blurred,
    );
  });

  for (const route of PUBLIC_ROUTES) {
    test(`12.7 decorative icons on ${route} are hidden from assistive tech`, async ({
      page,
    }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const exposed = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("svg"))
          .filter((svg) => {
            // The Next.js dev overlay is not part of the app.
            if (svg.closest("nextjs-portal")) return false;
            // An icon is fine if it is hidden, or if it is deliberately labelled.
            if (svg.getAttribute("aria-hidden") === "true") return false;
            if (svg.getAttribute("role") === "img" && svg.getAttribute("aria-label")) return false;
            if (svg.querySelector("title")) return false;
            return true;
          })
          .map((svg) => `${svg.parentElement?.tagName ?? "?"} > ${svg.outerHTML.slice(0, 80)}`);
      });

      expect(
        exposed,
        `Decorative icons announced to screen readers on ${route}:\n${exposed.join("\n")}`,
      ).toEqual([]);
    });
  }
});
