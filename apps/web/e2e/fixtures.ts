/**
 * Shared Playwright fixtures.
 *
 * The centrepiece is the console-error guard. Base UI logs an accessibility
 * error when a `<Button render={<Link/>}>` omits `nativeButton={false}`; React
 * logs hydration mismatches. Both are console-only, so `typecheck`, `lint` and
 * `build` all stay green while the app is broken. Every test in this suite
 * fails if its page logged an error that is not explicitly allow-listed.
 *
 * Import `test` and `expect` from here, never from `@playwright/test` directly,
 * or the guard is silently skipped.
 */
import { expect, test as base, type Page } from "@playwright/test";

/**
 * Library-owned noise. Keep this list as short as possible and justify every
 * entry - an unexplained entry here is how a real bug gets silenced.
 */
const GLOBAL_ALLOWED_CONSOLE_ERRORS: RegExp[] = [
  // next-themes injects an inline <script> to set the theme before paint.
  // React's dev build warns about script tags in the tree. Library-owned,
  // dev-only, and the inline script is the whole point of avoiding a flash.
  // NOTE: this deliberately does NOT cover "Encountered two children with the
  // same key". That is a genuine React error in our own code, never noise.
  /Encountered a script tag while rendering React component/,
  // Informational React DevTools banner, logged as an error by some builds.
  /Download the React DevTools/,
];

/** Everything the page reported: console errors plus uncaught page errors. */
export interface ConsoleCapture {
  /** All error-level console messages seen, allow-listed or not. */
  all: string[];
  /** Only the ones that are not allow-listed. These fail the test. */
  unexpected: string[];
}

interface Fixtures {
  /**
   * Extra allow-list for one test or describe block, e.g. a resilience test
   * that deliberately makes the API unreachable and expects a fetch error.
   *
   *   test.use({ allowedConsoleErrors: [/Failed to fetch/] });
   */
  allowedConsoleErrors: RegExp[];
  /** Read the captured console output inside a test, for direct assertions. */
  consoleCapture: ConsoleCapture;
  /** Auto fixture: attaches listeners and asserts at teardown. */
  consoleGuard: void;
}

function isAllowed(text: string, extra: RegExp[]): boolean {
  return [...GLOBAL_ALLOWED_CONSOLE_ERRORS, ...extra].some((pattern) =>
    pattern.test(text),
  );
}

export const test = base.extend<Fixtures>({
  allowedConsoleErrors: [[], { option: true }],

  // The second parameter is Playwright's fixture-provider callback. It is passed
  // positionally, so it is named `provide` rather than the conventional `use`:
  // eslint's react-hooks rule reads a call to anything named `use` as a React
  // hook and errors out.
  consoleCapture: async ({ page, allowedConsoleErrors }, provide) => {
    const capture: ConsoleCapture = { all: [], unexpected: [] };

    const record = (text: string) => {
      capture.all.push(text);
      if (!isAllowed(text, allowedConsoleErrors)) {
        capture.unexpected.push(text);
      }
    };

    page.on("console", (message) => {
      if (message.type() === "error") record(message.text());
    });
    // An uncaught exception never reaches page.on("console").
    page.on("pageerror", (error) => record(`[pageerror] ${error.message}`));

    await provide(capture);
  },

  consoleGuard: [
    async ({ consoleCapture }, provide) => {
      await provide();
      // Runs at teardown, after the test body, so it sees everything the page
      // logged for the whole test.
      expect(
        consoleCapture.unexpected,
        `Unexpected browser console errors:\n${consoleCapture.unexpected.join("\n")}`,
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Every public route. Used by the route-sweep tests so none is forgotten. */
export const PUBLIC_ROUTES = [
  "/",
  "/channels",
  "/channels/ivan-kirkov",
  "/episodes",
  "/search",
  "/leaderboard",
  "/me",
  "/status",
] as const;

/** Base URL of the Django API, for cross-checking the UI against live data. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Fetch JSON straight from the Django API.
 *
 * Tests must assert "the UI matches the API", never "the score is 8.4" -
 * ratings change and a hardcoded number turns into a false failure.
 *
 * Uses Playwright's request context rather than a shell `curl`: Git Bash
 * mangles Cyrillic in command-line arguments, which silently turns a Bulgarian
 * query into `????????` and makes a search return every document.
 */
export async function apiJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API_URL}${path}`);
  expect(
    response.ok(),
    `API ${path} responded ${response.status()}`,
  ).toBeTruthy();
  return (await response.json()) as T;
}

/**
 * Assert the page has exactly ONE `<h1>` and that it is visible.
 *
 * 🚨 Why this is not two plain assertions in a row.
 *
 * React's streaming SSR does not render late content in place. It writes it
 * into a hidden staging container at the end of `<body>` and then MOVES it, so
 * for a moment the document genuinely holds two copies of the heading. Written
 * as
 *
 *     await expect(page.locator("h1")).toHaveCount(1);
 *     await expect(page.locator("h1")).toBeVisible();
 *
 * the first assertion can pass in a gap between the two copies existing, and
 * the second then hits `strict mode violation: resolved to 2 elements`.
 * Reproduced 2026-08-11 on `/status` (the one route with a scoped
 * `loading.tsx`, so the only one that streams a fallback): ~3 failures in 25
 * runs under parallel load, and it is what failed one of three full suite runs.
 *
 * Retrying BOTH together is what makes it correct. The guarantee is unchanged -
 * exactly one h1, and visible - it just has to hold at a single instant rather
 * than across two separately-timed checks.
 */
export async function expectSingleVisibleH1(page: Page): Promise<void> {
  await expect(async () => {
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toBeVisible();
  }).toPass({ timeout: 20_000 });
}

/** True when the page scrolls horizontally, which it never should. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.documentElement;
    // 1px of tolerance for sub-pixel layout rounding.
    return el.scrollWidth - el.clientWidth > 1;
  });
}

/**
 * The ratings grid the current viewport can actually see.
 *
 * A channel with at most 4 years ships BOTH layouts in the HTML - the
 * transposed mobile table and the wrapped flow grid - and CSS decides which one
 * renders, so a hardcoded selector for either passes on one project and fails
 * on the other. Every test that does not care WHICH layout it got should use
 * this. Note the selector is attribute-only: the flow grid is a `div`, not a
 * `table`.
 */
export function visibleGrid(page: Page) {
  return page.locator("[data-grid]").locator("visible=true");
}
