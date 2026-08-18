/**
 * Playwright configuration for the web app's end-to-end suite.
 *
 * Why E2E at all when typecheck, lint and build are green: all three passed
 * cleanly while the app was shipping a soft 404, a serif font fallback that
 * killed Bulgarian, and a console-only accessibility error. None of those are
 * visible to a static gate. They need a real browser.
 *
 * Port 3100, not 3000: port 3000 on this machine is held by an unrelated
 * project, so probing it returns a confusing 200 from a different app.
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  // The dev server compiles routes on demand, so a cold first hit is slow.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 1,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Bulgarian content must not depend on the runner's locale.
    locale: "en-US",
    timezoneId: "Europe/Sofia",
  },

  projects: [
    {
      name: "desktop",
      // The iOS spec asserts engine-specific behaviour (and a mobile-only type
      // scale); running it here would fail on rules that are correct.
      testIgnore: /ios-safari\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // Most of this audience is on a phone. 390x844 is an iPhone 14 viewport.
      name: "mobile",
      testIgnore: /ios-safari\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      /**
       * 🚨 The REAL Safari engine, which nothing else in this suite uses.
       *
       * The "mobile" project above is Desktop CHROME resized to an iPhone
       * viewport. That catches layout at 390px and nothing else: it does not
       * have Safari's rendering, its CSS support, or - the reason this project
       * exists - its focus-zoom behaviour. Every form control in the app
       * computed to 13px or 15px against a `@layer base` rule that claimed to
       * hold them at 16px, and 386 green tests across two "mobile" viewports
       * never saw it, because Chromium simply does not zoom.
       *
       * `devices["iPhone 14"]` selects WebKit, which is what iOS ships.
       *
       * ⚠️ Scoped to `ios-safari.spec.ts` on purpose. Running the whole suite
       * a third time is ~3 minutes for coverage the other two projects already
       * give; this project exists for the assertions that are engine-specific.
       */
      name: "ios",
      testMatch: /ios-safari\.spec\.ts/,
      use: { ...devices["iPhone 14"] },
    },
  ],

  webServer: {
    // `reuseExistingServer` matters here: Next refuses a second dev server for
    // the same directory, so a developer already running one is reused.
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
