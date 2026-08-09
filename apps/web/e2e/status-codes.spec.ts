/**
 * Matrix section 2 - HTTP status codes (Lane A). REGRESSION-CRITICAL.
 *
 * Read this before touching anything in here:
 *
 * A root `app/loading.tsx` once wrapped every page in a Suspense boundary. Next
 * then flushed the HTML shell with a **200** before the page resolved, so every
 * `notFound()` on the site silently became a soft 404 - status 200 with a blank
 * body. `/channels/does-not-exist` and `/e/BADIDBADID` both answered 200.
 * `typecheck`, `lint` and `build` all stayed green the entire time.
 *
 * On a site whose whole purpose is being indexable, Google would have crawled
 * every dead episode link as a real page.
 *
 * That is why every assertion below is on `response.status()`. A test that only
 * checks "the 404 text is visible" would have passed while the bug shipped,
 * because the soft 404 still rendered the not-found body once the client caught
 * up. The status code is the only signal that told the truth.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import type { Schema } from "@ccc/api-types";
import { copy } from "@/lib/copy";

import {
  apiJson,
  expect,
  PUBLIC_ROUTES,
  test,
  type ConsoleCapture,
} from "./fixtures";

type EpisodeList = Schema<"EpisodeListOut">;

/** A channel slug that cannot exist, so the page must call `notFound()`. */
const MISSING_CHANNEL = "/channels/does-not-exist";

/** An 11-character-looking id that is not a real YouTube video. */
const MISSING_EPISODE = "/e/BADIDBADID";

/** A path with no matching route at all, handled by Next itself. */
const UNROUTED_PATH = "/nope";

/**
 * File names Next treats as a route-level loading boundary. Any of these at the
 * app root reintroduces the soft-404 bug.
 */
const LOADING_FILES = ["loading.tsx", "loading.ts", "loading.jsx", "loading.js"];

async function realEpisodePath(page: Page): Promise<string> {
  const list = await apiJson<EpisodeList>(page, "/api/episodes?limit=1&sort=newest");
  expect(
    list.items.length,
    "the dev database has no episodes, so there is no real episode route to check",
  ).toBeGreaterThan(0);
  return `/e/${list.items[0]!.youtube_id}`;
}

/**
 * Navigating to a deliberately missing URL makes Chrome log
 * "Failed to load resource: the server responded with a status of 404" for the
 * DOCUMENT itself. That is the browser reporting the exact status this section
 * exists to prove, not an application error.
 *
 * Chrome does not put the URL in the message text, so the pattern alone cannot
 * tell a failed document apart from a failed subresource. That blind spot is
 * closed by `expectOnlyIntentional404Noise`, which pins the count to the number
 * of deliberate bad navigations - a 404 on a stylesheet, script or image would
 * push the count over the limit and fail the test.
 *
 * The allow-list is scoped to the describe block below and used nowhere else.
 */
const DOCUMENT_404 =
  /Failed to load resource: the server responded with a status of 404/;

function expectOnlyIntentional404Noise(
  capture: ConsoleCapture,
  badNavigations: number,
): void {
  // Everything that is NOT a 404 resource failure is already handled by the
  // fixture's teardown guard, which fails on any console error outside the
  // global allow-list. This adds the one thing the guard cannot see: that the
  // allow-listed 404s are only the documents we deliberately requested.
  const document404s = capture.all.filter((message) => DOCUMENT_404.test(message));
  expect(
    document404s.length,
    "more 404 resource failures than deliberate bad navigations, so something " +
      "on the 404 page itself failed to load",
  ).toBeLessThanOrEqual(badNavigations);
}

test.describe("hard 404s", () => {
  test.use({ allowedConsoleErrors: [DOCUMENT_404] });

  test("2.1 a missing channel returns 404, not a soft 404", async ({
    page,
    consoleCapture,
  }) => {
    const response = await page.goto(MISSING_CHANNEL);

    // The status, not the text. See the header comment.
    expect(response?.status(), `${MISSING_CHANNEL} must be a hard 404`).toBe(404);

    // And the body really is the 404 page, not an empty shell.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.notFound.title,
    );
    expectOnlyIntentional404Noise(consoleCapture, 1);
  });

  test("2.2 a missing episode returns 404, not a soft 404", async ({
    page,
    consoleCapture,
  }) => {
    const response = await page.goto(MISSING_EPISODE);

    expect(response?.status(), `${MISSING_EPISODE} must be a hard 404`).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.notFound.title,
    );
    expectOnlyIntentional404Noise(consoleCapture, 1);
  });

  test("2.3 an unrouted path returns 404", async ({ page, consoleCapture }) => {
    const response = await page.goto(UNROUTED_PATH);

    expect(response?.status(), `${UNROUTED_PATH} must be a hard 404`).toBe(404);
    expectOnlyIntentional404Noise(consoleCapture, 1);
  });

  test("2.4 the 404 page renders real content and a way back", async ({
    page,
    consoleCapture,
  }) => {
    const response = await page.goto(MISSING_EPISODE);
    expect(response?.status()).toBe(404);

    await expect(page.getByText(copy.notFound.code)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.notFound.title,
    );
    await expect(page.getByText(copy.notFound.body)).toBeVisible();

    // A dead end is a bounce. There must be a working route home, and the
    // design's other escape hatch is the search trigger - on a site whose whole
    // argument is findability, "search will probably find it" is the right
    // thing to offer someone who followed a stale link.
    //
    // Selected as an anchor rather than by role "link": `LinkButton` renders a
    // real `<a href>` (deliberately NOT a Base UI Button with `render`, which
    // would claim role=button on an anchor), so this asserts on what actually
    // matters to a user - a real anchor, with an href, carrying the right
    // accessible name.
    const home = page.locator('main a[href="/"]');
    await expect(home).toBeVisible();
    await expect(home).toHaveAccessibleName(copy.notFound.backHome);

    await expect(
      page.getByRole("main").getByRole("button", { name: copy.search.trigger }),
    ).toBeVisible();

    await home.click();
    await page.waitForURL((url) => url.pathname === "/");

    expectOnlyIntentional404Noise(consoleCapture, 1);
  });

  /**
   * 2.6 - the explicit guard for the regression described at the top of this
   * file.
   *
   * Two halves, both needed:
   *
   * 1. A STRUCTURAL check that no loading boundary sits at the app root. That is
   *    what actually caused the bug, and it fails the moment someone adds
   *    `app/loading.tsx` - before anyone ever browses to a dead URL.
   * 2. A BEHAVIOURAL re-assertion that the two `notFound()` routes still answer
   *    404. The assertion is on the status code and nothing else, because a soft
   *    404 renders exactly the same visible page while serving a 200. A text
   *    assertion cannot tell the two apart; the status code can.
   *
   * Skeletons are fine on routes that cannot 404 - `app/status/loading.tsx` is
   * the sanctioned example. The rule is only about the root.
   */
  test("2.6 no root loading boundary, and notFound() still sets a 404 status", async ({
    page,
    consoleCapture,
  }, testInfo) => {
    const webRoot = path.resolve(testInfo.project.testDir, "..");
    const appDir = path.join(webRoot, "app");

    for (const file of LOADING_FILES) {
      expect(
        existsSync(path.join(appDir, file)),
        `app/${file} exists. A root loading boundary makes Next flush a 200 shell ` +
          "before the page resolves, which turns every notFound() into a soft 404. " +
          "Scope the skeleton to a route that cannot 404, e.g. app/status/loading.tsx.",
      ).toBe(false);
    }

    const badRoutes = [MISSING_CHANNEL, MISSING_EPISODE];
    for (const route of badRoutes) {
      const response = await page.goto(route);
      expect(
        response?.status(),
        `${route} returned ${response?.status()}. A 200 here means a Suspense ` +
          "boundary swallowed notFound() and crawlers will index a dead page.",
      ).toBe(404);
    }

    expectOnlyIntentional404Noise(consoleCapture, badRoutes.length);
  });
});

test("2.5 every real route answers 200", async ({ page }) => {
  // Cold dev-server compilation makes a full sweep slow the first time.
  test.slow();

  const routes = [...PUBLIC_ROUTES, await realEpisodePath(page)];
  // 6 static/public routes plus the dynamic episode route: the 7 the app ships.
  expect(routes).toHaveLength(9);

  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), `${route} did not answer 200`).toBe(200);
  }
});
