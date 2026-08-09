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
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // Most of this audience is on a phone. 390x844 is an iPhone 14 viewport.
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
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
