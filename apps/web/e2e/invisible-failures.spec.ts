/**
 * Lane E - matrix sections 8 (mobile + layout), 9 (theme + fonts) and
 * 10 (console cleanliness), plus a named regression test for every entry in
 * "Invisible failure classes" (specs/02-test-hardening/01-analysis.md).
 *
 * Every bug guarded here shipped once and passed `typecheck`, `lint` AND
 * `build`. None of them is visible to a static gate:
 *
 *   1. A root `loading.tsx` turned every `notFound()` into a 200 + blank body.
 *   2. An `Error` instance in the render tree broke React's RSC debug channel.
 *   3. `Geist({ subsets: ["latin"] })` silently dropped every Cyrillic glyph.
 *      A circular `--font-sans: var(--font-sans)` silently fell back to serif.
 *   4. Base UI logs a console-only accessibility error for
 *      `<Button render={<Link/>}>` without `nativeButton={false}`.
 *
 * Test names below start with the matrix row so the scoreboard is auditable.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { copy } from "@/lib/copy";

import {
  apiJson,
  expect,
  hasHorizontalOverflow,
  PUBLIC_ROUTES,
  test,
  visibleGrid,
  type ConsoleCapture,
} from "./fixtures";

const WEB_ROOT = path.resolve(__dirname, "..");

/** Cyrillic block that every Bulgarian episode title lives in. */
const CYRILLIC_START = 0x400;
const CYRILLIC_END = 0x45f;

interface EpisodeListResponse {
  items: { youtube_id: string; title: string }[];
}

/**
 * Resolve a real episode id from the live API instead of hardcoding one, so a
 * reseeded database produces a clear API failure rather than a mystery 404.
 */
async function firstEpisodeRoute(
  page: Parameters<typeof apiJson>[0],
): Promise<string> {
  const data = await apiJson<EpisodeListResponse>(page, "/api/episodes?limit=1");
  expect(data.items.length, "the API has at least one episode to render").toBeGreaterThan(0);
  return `/e/${data.items[0].youtube_id}`;
}

/**
 * Elements sticking out past the right edge of the viewport, ignoring anything
 * whose ancestor clips or scrolls horizontally.
 *
 * That exemption is the design, not a loophole: the ratings grid is deliberately
 * wider than a phone and scrolls INSIDE its own `overflow-x-auto` container. An
 * element that overflows with no such ancestor is the real bug, because it drags
 * the whole page sideways.
 */
async function elementsPastViewport(
  page: Parameters<typeof hasHorizontalOverflow>[0],
): Promise<string[]> {
  return page.evaluate(() => {
    function describe(el: Element): string {
      const cls = typeof el.className === "string" ? el.className.slice(0, 60) : "";
      const right = Math.round(el.getBoundingClientRect().right);
      return `${el.tagName}.${cls} right=${right}`;
    }

    function hasClippingAncestor(el: Element): boolean {
      let node = el.parentElement;
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const overflows = [style.overflowX, style.overflow];
        if (overflows.some((v) => v === "auto" || v === "scroll" || v === "hidden")) {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    }

    const viewportWidth = document.documentElement.clientWidth;
    const offenders: string[] = [];

    for (const el of Array.from(document.querySelectorAll("body *"))) {
      // The Next.js dev overlay is not part of the app.
      if (el.closest("nextjs-portal")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // 1px of tolerance for sub-pixel layout rounding.
      if (rect.right <= viewportWidth + 1) continue;
      if (hasClippingAncestor(el)) continue;
      offenders.push(describe(el));
    }

    return offenders;
  });
}

/** Resolve any CSS colour Chrome accepts down to sRGB, including `lab()`. */
async function toRgb(
  page: Parameters<typeof hasHorizontalOverflow>[0],
  cssColor: string,
): Promise<[number, number, number]> {
  return page.evaluate((color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b] as [number, number, number];
  }, cssColor);
}

// ---------------------------------------------------------------------------
// Section 8 - mobile + layout
//
// These run in both Playwright projects. The `mobile` project (390x844) is the
// one row 8.1-8.3 are written for; passing at 1280 too is a bonus, not the point.
// ---------------------------------------------------------------------------

test.describe("8. mobile + layout", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`8.1 ${route} does not scroll horizontally`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should render`).toBe(200);
      expect(await hasHorizontalOverflow(page), `${route} overflows horizontally`).toBe(
        false,
      );
    });
  }

  test("8.1 the episode page does not scroll horizontally", async ({ page }) => {
    const route = await firstEpisodeRoute(page);
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test.describe("8.2 the 404 page", () => {
    // Navigating to a deliberately missing route makes Chrome log the 404 it
    // received. That is the browser reporting the status this test asserts, not
    // the app misbehaving. Narrowest possible pattern, scoped to this describe.
    test.use({
      allowedConsoleErrors: [
        /Failed to load resource: the server responded with a status of 404/,
      ],
    });

    test("8.2 the 404 page does not scroll horizontally", async ({ page }) => {
      const response = await page.goto("/this-route-does-not-exist");
      expect(response?.status()).toBe(404);
      expect(await hasHorizontalOverflow(page)).toBe(false);
    });
  });

  test("8.3 the ratings grid never makes the PAGE scroll sideways", async ({
    page,
  }) => {
    await page.goto("/channels/ivan-kirkov");
    await expect(visibleGrid(page)).toBeVisible();
    expect(await hasHorizontalOverflow(page), "the page itself must not scroll").toBe(
      false,
    );
  });

  test("8.3 the desktop grid is the only thing that scrolls sideways", async ({
    page,
    viewport,
  }) => {
    test.skip(
      (viewport?.width ?? 0) < 768,
      "the mobile grid is transposed precisely so that nothing scrolls sideways; 3.10 pins that",
    );

    await page.goto("/channels/ivan-kirkov");
    const container = page
      .locator("div.overflow-x-auto")
      .filter({ has: page.locator("table[data-grid='desktop']") });
    await expect(container).toBeVisible();

    const box = await container.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(
      box.scrollWidth,
      "the grid must actually be wider than its container, or this test proves nothing",
    ).toBeGreaterThan(box.clientWidth);
    expect(await hasHorizontalOverflow(page), "the page itself must not scroll").toBe(
      false,
    );
  });

  for (const route of PUBLIC_ROUTES) {
    test(`8.4 no element on ${route} extends past the viewport`, async ({ page }) => {
      await page.goto(route);
      expect(await elementsPastViewport(page)).toEqual([]);
    });
  }

  test("8.4 the overflow detector actually detects overflow", async ({ page }) => {
    // Self-check. Without this, a detector that silently returns [] would make
    // every 8.4 row above pass vacuously.
    await page.goto("/");
    expect(await elementsPastViewport(page)).toEqual([]);

    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.id = "overflow-probe";
      probe.style.cssText = "position:absolute;top:0;left:0;width:99999px;height:10px;";
      document.body.appendChild(probe);
    });

    const offenders = await elementsPastViewport(page);
    expect(offenders.join("\n")).toContain("DIV");

    await page.evaluate(() => document.getElementById("overflow-probe")?.remove());
    expect(await elementsPastViewport(page)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Section 9 - theme + fonts (regression-critical)
// ---------------------------------------------------------------------------

test.describe("9. theme + fonts", () => {
  test("9.1 dark theme is in the first byte of HTML, before any JavaScript", async ({
    page,
    baseURL,
  }) => {
    // Read the raw server response, not the hydrated DOM. If `dark` were only
    // applied by next-themes after hydration there would be a white flash, and
    // the hydrated DOM would still look correct.
    const response = await page.request.get(`${baseURL}/`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    const openingTag = html.slice(html.indexOf("<html"), html.indexOf(">", html.indexOf("<html")) + 1);
    expect(openingTag, "server HTML must already carry the dark class").toMatch(
      /class="[^"]*\bdark\b/,
    );

    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });

  test("9.2 the body background is the dark token, not a light default", async ({ page }) => {
    await page.goto("/");
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    const [r, g, b] = await toRgb(page, background);
    // Rec. 709 relative luminance. The dark token is oklch(0.145 0 0).
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(luminance, `body background ${background} is not dark`).toBeLessThan(60);
  });

  test("9.3 REGRESSION: headings resolve to Unbounded, not a serif fallback", async ({
    page,
  }) => {
    // Guards the circular `--font-sans: var(--font-sans)` that shadcn's init
    // once wrote. The variable resolved to nothing, so every heading silently
    // rendered in the browser's default serif. Nothing errored.
    await page.goto("/");
    const family = await page.evaluate(
      () => getComputedStyle(document.querySelector("h1") as Element).fontFamily,
    );
    expect(family, `<h1> font-family was "${family}"`).toMatch(/unbounded/i);
    expect(family).not.toMatch(/(^|[\s,"])(serif|Times|Times New Roman)([\s,"]|$)/i);
  });

  test("9.3 body text resolves to Onest, the Cyrillic-first UI family", async ({
    page,
  }) => {
    await page.goto("/");
    const family = await page.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    );
    expect(family, `body font-family was "${family}"`).toMatch(/onest/i);
  });

  test("9.4 REGRESSION: a Bulgarian title uses the same family as Latin text in the same face", async ({
    page,
  }) => {
    const route = await firstEpisodeRoute(page);
    await page.goto(route);

    // Both of these are Unbounded by design: the episode H1 and the wordmark.
    // One is Cyrillic and one is Latin, so if the Cyrillic subset were missing
    // the browser would fall back per glyph and the families would diverge.
    const families = await page.evaluate(() => {
      const title = document.querySelector("h1") as Element;
      const wordmark = document.querySelector(
        'header a[href="/"] span:last-child',
      ) as Element;
      return {
        titleText: title.textContent ?? "",
        titleFamily: getComputedStyle(title).fontFamily,
        wordmarkText: wordmark.textContent ?? "",
        wordmarkFamily: getComputedStyle(wordmark).fontFamily,
      };
    });

    expect(families.titleText, "the episode title must be Bulgarian").toMatch(/[Ѐ-ӿ]/);
    expect(families.wordmarkText, "the wordmark must be Latin").toMatch(
      /^[ -~]+$/,
    );
    // Compare the PRIMARY family only. Both resolve to Unbounded, but the
    // heading class declares its own fallback chain while the utility class
    // does not, so the full stacks differ by tail entries that never render.
    const primary = (stack: string) => stack.split(",")[0].trim().replace(/^"|"$/g, "");
    expect(primary(families.titleFamily)).toBe(primary(families.wordmarkFamily));
    expect(primary(families.titleFamily)).toMatch(/unbounded/i);
  });

  test("9.4 REGRESSION: every family loads a Cyrillic subset and actually uses it", async ({
    page,
  }) => {
    // The computed `font-family` above is IDENTICAL whether or not the Cyrillic
    // subset was requested - the browser falls back per glyph, silently. This is
    // the assertion that genuinely catches `subsets: ["latin"]`: it inspects the
    // @font-face rules next/font emitted and requires a face whose unicode-range
    // covers the Cyrillic block, in "loaded" state (which only happens when the
    // browser needed it to paint real text on this page).
    //
    // 🚨 All THREE families are checked. The handoff is explicit that every
    // typeface must cover Cyrillic, and the mono face is the easiest to forget:
    // it only ever renders digits and timestamps in the chrome, so a missing
    // Cyrillic subset there would go unnoticed until a Bulgarian label landed
    // in a mono slot.
    const route = await firstEpisodeRoute(page);
    await page.goto(route);
    await page.evaluate(() => document.fonts.ready);

    const faces = await page.evaluate(() => {
      const collected: { family: string; status: string; unicodeRange: string }[] = [];
      document.fonts.forEach((face) => {
        collected.push({
          family: face.family,
          status: face.status,
          unicodeRange: face.unicodeRange,
        });
      });
      return collected;
    });

    function coversCyrillic(unicodeRange: string): boolean {
      return unicodeRange.split(",").some((part) => {
        const match = /U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/.exec(part.trim());
        if (!match) return false;
        const start = parseInt(match[1], 16);
        const end = match[2] ? parseInt(match[2], 16) : start;
        return start <= CYRILLIC_END && end >= CYRILLIC_START;
      });
    }

    for (const family of [/unbounded/i, /onest/i, /jetbrains/i]) {
      const familyFaces = faces.filter((face) => family.test(face.family));
      expect(
        familyFaces.length,
        `next/font emitted no @font-face at all for ${family}`,
      ).toBeGreaterThan(0);

      const cyrillic = familyFaces.filter((face) => coversCyrillic(face.unicodeRange));
      expect(
        cyrillic.length,
        `no ${family} face covers U+0400-U+045F. Ranges seen: ${familyFaces
          .map((face) => face.unicodeRange)
          .join(" | ")}`,
      ).toBeGreaterThan(0);
    }

    // At least one of them must have actually been used to paint this page.
    const usedCyrillic = faces.filter(
      (face) => coversCyrillic(face.unicodeRange) && face.status === "loaded",
    );
    expect(
      usedCyrillic.length,
      "a Cyrillic face exists but none loaded, so the Bulgarian title did not use one",
    ).toBeGreaterThan(0);
  });

  test("9.5 numeric chrome renders in the mono family", async ({ page }) => {
    // Scores, timestamps, counts and dates are JetBrains Mono and tabular, so a
    // column of grid numbers cannot wobble.
    await page.goto("/channels/ivan-kirkov");
    const meta = page.locator("table[data-grid] a[data-cell] span").first();
    const style = await meta.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        family: computed.fontFamily,
        numeric: computed.fontVariantNumeric,
      };
    });
    expect(style.family, `score font-family was "${style.family}"`).toMatch(
      /jetbrains/i,
    );
    expect(style.numeric).toContain("tabular-nums");
  });
});

// ---------------------------------------------------------------------------
// Section 10 - console cleanliness (regression-critical)
//
// The console guard in fixtures.ts already fails every test in this suite on an
// unexpected error. These rows make that coverage explicit and auditable, and
// add checks the guard's allow-list could otherwise hide.
// ---------------------------------------------------------------------------

/** Patterns that must never appear, even if something allow-lists them later. */
const NEVER_ALLOWED = [
  // React hydration mismatch, in all the wordings React 18/19 uses.
  /hydrat/i,
  /did not match/i,
  /Text content does not match/i,
  // Base UI's console-only accessibility complaint.
  /nativeButton/i,
  /fake button/i,
  // The RSC debug-channel crash from an Error instance in the render tree.
  /enqueueModel/i,
];

function assertNoForbidden(capture: ConsoleCapture, route: string): void {
  // Deliberately reads `all`, not `unexpected`: a future widening of the
  // allow-list must not be able to hide any of these.
  const forbidden = capture.all.filter((text) =>
    NEVER_ALLOWED.some((pattern) => pattern.test(text)),
  );
  expect(forbidden, `Forbidden console output on ${route}:\n${forbidden.join("\n")}`).toEqual(
    [],
  );
}

test.describe("10. console cleanliness", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`10.1 ${route} logs no unexpected console error`, async ({
      page,
      consoleCapture,
    }) => {
      await page.goto(route);
      // Give client components a beat to hydrate and log.
      await page.waitForLoadState("networkidle");
      expect(
        consoleCapture.unexpected,
        `Unexpected console errors on ${route}:\n${consoleCapture.unexpected.join("\n")}`,
      ).toEqual([]);
      assertNoForbidden(consoleCapture, route);
    });
  }

  test("10.1 the episode page logs no unexpected console error", async ({
    page,
    consoleCapture,
  }) => {
    const route = await firstEpisodeRoute(page);
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    expect(consoleCapture.unexpected).toEqual([]);
    assertNoForbidden(consoleCapture, route);
  });

  test("10.2 the global console allow-list stays short and every entry is justified", async () => {
    // The allow-list is the one place a real bug can be silenced forever. This
    // asserts the discipline the fixture's own comment demands.
    const source = readFileSync(path.join(WEB_ROOT, "e2e", "fixtures.ts"), "utf8");
    const block = /GLOBAL_ALLOWED_CONSOLE_ERRORS:\s*RegExp\[\]\s*=\s*\[([\s\S]*?)\n\];/.exec(
      source,
    );
    expect(block, "could not find GLOBAL_ALLOWED_CONSOLE_ERRORS in e2e/fixtures.ts").not.toBeNull();

    const lines = (block as RegExpExecArray)[1].split("\n");
    const entries: { pattern: string; justified: boolean }[] = [];
    let sawComment = false;

    for (const raw of lines) {
      const line = raw.trim();
      if (line.length === 0) continue;
      if (line.startsWith("//")) {
        sawComment = true;
        continue;
      }
      entries.push({ pattern: line, justified: sawComment });
      sawComment = false;
    }

    expect(entries.length, "the allow-list has grown; every entry needs review").toBeLessThanOrEqual(
      4,
    );
    for (const entry of entries) {
      expect(
        entry.justified,
        `allow-list entry has no explanatory comment above it: ${entry.pattern}`,
      ).toBe(true);
    }
  });

  for (const route of PUBLIC_ROUTES) {
    test(`10.3 ${route} logs no React hydration mismatch`, async ({
      page,
      consoleCapture,
    }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const hydration = consoleCapture.all.filter((text) =>
        /hydrat|did not match|Text content does not match/i.test(text),
      );
      expect(
        hydration,
        `Hydration mismatch on ${route}:\n${hydration.join("\n")}`,
      ).toEqual([]);
    });
  }
});

test.describe("10.4 + invisible failure class 4 - the 404 page", () => {
  // A navigation that deliberately returns 404 makes Chrome log the response
  // status as a resource error. That is the browser reporting the status this
  // test is asserting, not the app misbehaving. Scoped to this describe only,
  // and the test below still inspects every message it captured.
  test.use({
    allowedConsoleErrors: [
      /Failed to load resource: the server responded with a status of 404/,
    ],
  });

  test("10.4 REGRESSION: the 404 page logs no Base UI nativeButton accessibility error", async ({
    page,
    consoleCapture,
  }) => {
    // `<Button render={<Link/>}>` without `nativeButton={false}` logs an
    // accessibility error that only the browser console ever sees. The 404 page
    // is the only page in the app that renders link-styled buttons.
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);

    const links = page.locator("main a");
    await expect(links.first()).toBeVisible();
    // Both CTAs must really be anchors, which is what nativeButton={false} buys.
    // The design gives 404 one link home plus a search trigger, so one
    // anchor in <main> is the correct count - the point of this test is
    // the CONSOLE, not the link inventory.
    expect(await links.count()).toBeGreaterThanOrEqual(1);

    assertNoForbidden(consoleCapture, "/this-route-does-not-exist");
    expect(consoleCapture.unexpected).toEqual([]);

    // The one allow-listed message must be the 404 status and nothing else.
    const unexplained = consoleCapture.all.filter(
      (text) => !/Failed to load resource: the server responded with a status of 404/.test(text),
    );
    expect(
      unexplained,
      `Unexplained console output on the 404 page:\n${unexplained.join("\n")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invisible failure classes 1 and 2 - named regression tests
// ---------------------------------------------------------------------------

test.describe("invisible failure classes", () => {
  test("class 1 REGRESSION: no root loading.tsx, which would soft-404 the whole site", async () => {
    // A root app/loading.tsx wraps every page in Suspense. Next then flushes the
    // HTML shell with a 200 before the page resolves, so notFound() can no longer
    // set the status: every dead episode link becomes 200 + blank body and gets
    // crawled as a real page. Skeletons must be scoped to routes that cannot 404.
    expect(
      existsSync(path.join(WEB_ROOT, "app", "loading.tsx")),
      "app/loading.tsx exists. It converts every notFound() into a soft 404.",
    ).toBe(false);

    // The scoped one is fine and should stay.
    expect(existsSync(path.join(WEB_ROOT, "app", "status", "loading.tsx"))).toBe(true);
  });

  test.describe("class 1 - dead URLs", () => {
    // Same justification as section 8.2 and 10.4: the only allow-listed message
    // is Chrome reporting the 404 status these tests exist to assert.
    test.use({
      allowedConsoleErrors: [
        /Failed to load resource: the server responded with a status of 404/,
      ],
    });

    test("class 1 REGRESSION: a dead channel 404s with real content, not a blank 200", async ({
      page,
    }) => {
      const response = await page.goto("/channels/does-not-exist");
      expect(response?.status(), "soft 404: status was not 404").toBe(404);
      // The soft-404 bug returned 200 with an EMPTY body, so the status alone is
      // only half the guard.
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator("main a[href='/']")).toHaveCount(1);
    });

    test("class 1 REGRESSION: a dead episode id 404s with real content", async ({ page }) => {
      const response = await page.goto("/e/BADIDBADID");
      expect(response?.status()).toBe(404);
      await expect(page.locator("h1")).toBeVisible();
      expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(0);
    });
  });

  test("class 2 REGRESSION: /status renders promptly and raises no RSC serialization error", async ({
    page,
    consoleCapture,
  }) => {
    // Handing an `ApiError` instance to a component broke React's dev RSC debug
    // channel with `chunk.reason.enqueueModel is not a function` and then hung
    // the request for ~60s. `getHealthResult` now returns a plain
    // { kind, status, message } object instead.
    //
    // LIMIT: the crash only fires on the health ERROR path, and that fetch runs
    // in Node inside the Next server. Playwright's page.route cannot reach it
    // (proved in resilience.spec.ts). The error-path serialization guard is
    // matrix row 4.43, a Vitest unit test owned by Lane C. What is asserted here
    // is the observable half: the page resolves fast and the debug channel stays
    // quiet.
    const started = Date.now();
    const response = await page.goto("/status");
    const elapsed = Date.now() - started;

    expect(response?.status()).toBe(200);
    expect(elapsed, "/status took long enough to look like the 60s RSC hang").toBeLessThan(
      20_000,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.status.title,
    );
    assertNoForbidden(consoleCapture, "/status");
  });
});
