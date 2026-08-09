/**
 * Lane E - matrix section 11 (resilience).
 *
 * WARNING - READ BEFORE ADDING A TEST HERE.
 *
 * `/status` is a Server Component. `getHealthResult()` runs in Node inside the
 * Next server, so its fetch never leaves the server process. Playwright's
 * `page.route()` intercepts BROWSER requests only. A test that routes
 * `**\/api/health` and then asserts on the server-rendered card PASSES
 * VACUOUSLY: the handler never fires and the test merely re-asserts the healthy
 * state it would have seen anyway.
 *
 * The first test in this file exists purely to prove that, so nobody has to
 * rediscover it. Every other test in this file counts its route-handler hits and
 * asserts the counter moved, which makes a vacuous pass impossible.
 *
 * `HealthRecheckButton` IS a Client Component fetching from the browser via
 * TanStack Query, so rows 11.3-11.6 are genuinely interceptable and are covered
 * for real.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "./fixtures";

const WEB_ROOT = path.resolve(__dirname, "..");

/** Matches the browser-side health call, with or without a query string. */
const HEALTH_ROUTE = "**/api/health*";

/** `Schema<"HealthOut">` shaped payloads for the three states under test. */
const HEALTHY_BODY = {
  status: "ok",
  database: { ok: true, detail: "" },
  redis: { ok: true, detail: "" },
};

const DEGRADED_BODY = {
  status: "degraded",
  database: { ok: true, detail: "" },
  redis: { ok: false, detail: "connection refused" },
};

/** Copy strings, asserted as text because the toasts carry no test hooks. */
const TOAST = {
  success: "API is reachable.",
  degraded: "API answered, but a dependency is down.",
  failed: "Could not reach the API.",
} as const;

function jsonResponse(body: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

test.describe("11. resilience", () => {
  test("11.1/11.2 DOCUMENTED LIMIT: the server-side health fetch is not interceptable from the browser", async ({
    page,
  }) => {
    // This is not a coverage test. It is the proof that rows 11.1 and 11.2
    // CANNOT be covered this way, so the next agent does not write a green test
    // that asserts nothing. It also fails loudly if `/status` is ever converted
    // to a Client Component, at which point 11.1/11.2 become writable for real.
    let serverSideHits = 0;
    await page.route(HEALTH_ROUTE, async (route) => {
      serverSideHits += 1;
      await route.fulfill(jsonResponse(DEGRADED_BODY));
    });

    await page.goto("/status");
    await expect(page.getByText("API status")).toBeVisible();

    expect(
      serverSideHits,
      "the browser now fetches /api/health during /status render - rows 11.1 and 11.2 are newly testable, go write them",
    ).toBe(0);

    // And the card shows the REAL server reading, not the degraded body above.
    await expect(page.getByRole("button", { name: /Recheck/i })).toBeVisible();

    // Now prove the same interception does fire for the client component, so a
    // reader can see the counter is wired correctly and not stuck at zero.
    await page.getByRole("button", { name: /Recheck/i }).click();
    await expect(page.getByText(TOAST.degraded)).toBeVisible();
    expect(serverSideHits, "the client-side recheck must have been intercepted").toBe(1);
  });

  test("11.3 recheck on a healthy API shows the success toast", async ({ page }) => {
    let hits = 0;
    await page.goto("/status");
    await page.route(HEALTH_ROUTE, async (route) => {
      hits += 1;
      await route.fulfill(jsonResponse(HEALTHY_BODY));
    });

    await page.getByRole("button", { name: /Recheck/i }).click();

    await expect(page.getByText(TOAST.success)).toBeVisible();
    expect(hits, "route interception never fired - this test would be vacuous").toBeGreaterThan(0);
  });

  test("11.4 recheck on a degraded API shows the warning toast", async ({ page }) => {
    let hits = 0;
    await page.goto("/status");
    await page.route(HEALTH_ROUTE, async (route) => {
      hits += 1;
      await route.fulfill(jsonResponse(DEGRADED_BODY));
    });

    await page.getByRole("button", { name: /Recheck/i }).click();

    // A degraded API answers 200, so only `isFullyHealthy` separates this from
    // the success path. Assert the success toast is NOT the one shown.
    await expect(page.getByText(TOAST.degraded)).toBeVisible();
    await expect(page.getByText(TOAST.success)).toHaveCount(0);
    expect(hits, "route interception never fired - this test would be vacuous").toBeGreaterThan(0);
  });

  test.describe("11.5 unreachable API", () => {
    // The request is aborted on purpose, so Chrome logs the failed fetch. This
    // is the deliberate failure under test, not an app error.
    test.use({ allowedConsoleErrors: [/Failed to load resource: net::ERR_FAILED/] });

    test("11.5 recheck on an unreachable API shows the error toast", async ({
      page,
      consoleCapture,
    }) => {
      let hits = 0;
      await page.goto("/status");
      await page.route(HEALTH_ROUTE, async (route) => {
        hits += 1;
        await route.abort("failed");
      });

      await page.getByRole("button", { name: /Recheck/i }).click();

      await expect(page.getByText(TOAST.failed)).toBeVisible();
      expect(hits, "route interception never fired - this test would be vacuous").toBeGreaterThan(
        0,
      );

      // The page must survive a dead API, not blow up.
      await expect(page.getByText("API status")).toBeVisible();
      expect(
        consoleCapture.all.filter((text) => /\[pageerror\]/.test(text)),
        "a failed health fetch must never throw into the page",
      ).toEqual([]);
    });
  });

  test("11.6 a slow API aborts at the client timeout and renders the error state", async ({
    page,
  }) => {
    // `lib/api/client.ts` sets DEFAULT_TIMEOUT_MS = 10_000 and
    // `resolveSignal` turns that into an AbortSignal.timeout. Delaying past it
    // is the only honest way to prove the timeout is wired end to end.
    let hits = 0;
    await page.goto("/status");
    await page.route(HEALTH_ROUTE, async (route) => {
      hits += 1;
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      // The client has already given up; the continue may fail, which is fine.
      await route.continue().catch(() => undefined);
    });

    const startedAt = Date.now();
    await page.getByRole("button", { name: /Recheck/i }).click();

    // While in flight the button reports itself busy and is disabled.
    const busyButton = page.getByRole("button", { name: /Rechecking/i });
    await expect(busyButton).toBeVisible();
    await expect(busyButton).toBeDisabled();

    await expect(page.getByText(TOAST.failed)).toBeVisible({ timeout: 25_000 });
    const elapsed = Date.now() - startedAt;

    expect(hits, "route interception never fired - this test would be vacuous").toBeGreaterThan(0);
    // It gave up at the client timeout, not because the upstream finally answered.
    expect(elapsed, "the client did not abort at its own timeout").toBeLessThan(14_000);
    expect(elapsed, "it gave up suspiciously early for a 10s timeout").toBeGreaterThan(8_000);

    // The button recovers rather than staying stuck in the busy state.
    await expect(page.getByRole("button", { name: /^Recheck$/i })).toBeEnabled();
  });

  test("11.7 PARTIAL: /status declares force-dynamic so `build` survives a dead API", async () => {
    // Row 11.7 as written ("build succeeds with the API down") needs a real
    // `next build`, which cannot run here: the dev server under test owns
    // .next/, and building would corrupt it for every other lane. What IS
    // guarded is the single declaration that makes it true. Delete it and the
    // route becomes a build-time prerender that fetches a dead API and fails.
    //
    // A browser assertion cannot substitute: `next dev` renders every route
    // dynamically regardless, so any runtime check passes whether or not the
    // export is present.
    const source = readFileSync(path.join(WEB_ROOT, "app", "status", "page.tsx"), "utf8");
    expect(
      source,
      "app/status/page.tsx no longer exports `dynamic = \"force-dynamic\"`, so `next build` will try to prerender a live health check",
    ).toMatch(/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/);
  });
});
