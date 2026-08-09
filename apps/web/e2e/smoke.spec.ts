/**
 * Harness smoke test. Owned by Phase 0, not by any lane.
 *
 * Proves the plumbing itself works before any real assertion is trusted: the
 * dev server boots, the base URL resolves, the console guard is attached, and
 * the API is reachable for cross-checking. If this fails, every other failure
 * in the suite is meaningless.
 */
import { test, expect, apiJson } from "./fixtures";

test("dev server serves the home page", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1")).toBeVisible();
});

test("console guard is attached and collecting", async ({ page, consoleCapture }) => {
  await page.goto("/");
  // The fixture is wired even when nothing was logged. This asserts the shape
  // exists, so a lane relying on `consoleCapture` cannot be silently no-op.
  expect(Array.isArray(consoleCapture.all)).toBe(true);
  expect(consoleCapture.unexpected).toEqual([]);
});

test("django api is reachable for cross-checking", async ({ page }) => {
  const health = await apiJson<{ status: string }>(page, "/api/health");
  expect(health.status).toBe("ok");
});
