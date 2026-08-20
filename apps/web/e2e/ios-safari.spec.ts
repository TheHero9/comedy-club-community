/**
 * Matrix section 14 - iOS Safari (Lane WebKit).
 *
 * 🚨 THIS IS THE ONLY SPEC THAT RUNS ON THE ENGINE iOS ACTUALLY SHIPS.
 *
 * The suite's "mobile" project is Desktop Chrome resized to 390x844. That is a
 * real and useful check of layout at phone width, and it is NOT a check of
 * Safari: it has Chromium's CSS support, Chromium's rendering and Chromium's
 * input behaviour. The bug this file was written for lived under exactly that
 * blind spot - every form control in the product computed to 13px or 15px
 * while a rule in `@layer base` claimed to pin them at 16px, and 386 green
 * tests across two Chromium viewports never saw it, because Chromium does not
 * zoom on focus and Safari does.
 *
 * `playwright.config.ts` runs this file, and only this file, under
 * `devices["iPhone 14"]` (WebKit). The other two projects ignore it.
 */
import type { Page } from "@playwright/test";

import type { Schema } from "@ccc/api-types";
import { copy } from "@/lib/copy";

import { apiJson, expect, test } from "./fixtures";

type EpisodeList = Schema<"EpisodeListOut">;

/** Apple's Human Interface Guidelines minimum for a touch target. */
const MIN_TAP_PX = 44;

/** Below this, Safari zooms the viewport when the control takes focus. */
const MIN_FIELD_FONT_PX = 16;

/**
 * Every form control on the page, with what Safari actually computed - not
 * what the class list suggests. Reading `getComputedStyle` is the whole point:
 * the failure mode here was a stylesheet whose intent and effect disagreed.
 */
async function fieldFontSizes(page: Page) {
  return page.$$eval("input, textarea, select", (nodes) =>
    nodes
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0;
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        // `name`, then the accessible name, then the placeholder - enough to
        // name the offending control in the failure message without putting a
        // testid on every input in the product.
        label:
          (el as HTMLInputElement).name ||
          el.getAttribute("aria-label") ||
          (el as HTMLInputElement).placeholder ||
          "(unnamed)",
        fontSize: parseFloat(getComputedStyle(el).fontSize),
      })),
  );
}

async function expectNoZoomingFields(page: Page, where: string) {
  const fields = await fieldFontSizes(page);
  // 🚨 Guard against a vacuous pass. Every call site below is a surface that
  // demonstrably has form controls; without this the assertion underneath
  // would pass by iterating nothing the day a selector stops matching.
  expect(
    fields.length,
    `${where}: expected form controls to be present`,
  ).toBeGreaterThan(0);

  const zooming = fields.filter((field) => field.fontSize < MIN_FIELD_FONT_PX);
  expect(
    zooming,
    `${where}: these controls are under ${MIN_FIELD_FONT_PX}px, so Safari ` +
      `zooms the viewport on focus and never zooms back out: ` +
      JSON.stringify(zooming),
  ).toEqual([]);
}

async function firstEpisodeId(page: Page): Promise<string> {
  const list = await apiJson<EpisodeList>(page, "/api/episodes?limit=1");
  const id = list.items[0]?.youtube_id;
  expect(id, "the API returned no episode to open").toBeTruthy();
  return id as string;
}

// ---------------------------------------------------------------------------
// 14.1-14.3 Focus zoom
// ---------------------------------------------------------------------------

test("14.1 the people filters do not trigger Safari focus zoom", async ({
  page,
}) => {
  await page.goto("/me/people");
  // ⚠️ This page renders a skeleton until the `me` query resolves, so reading
  // the controls straight after `goto` finds none - which the guard inside
  // `expectNoZoomingFields` correctly reports as a broken test rather than a
  // pass. Wait for the real form, never a fixed sleep.
  await expect(page.locator("input").first()).toBeVisible();
  await expectNoZoomingFields(page, "/me/people");
});

test("14.1b the profile editor does not trigger Safari focus zoom", async ({
  page,
}) => {
  // The 13px `text-small` family and the 15px `text-[15px]` family were two
  // separate ways of losing to the same cascade rule, so both need a case.
  // The composers below cover 13px; this sheet is the 15px one.
  await page.goto("/me");

  const openEditor = page.getByRole("button", { name: copy.profile.changeIcon });
  await expect(openEditor).toBeVisible();
  await openEditor.click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoZoomingFields(page, "profile editor");
});

test("14.2 the moment composer does not trigger Safari focus zoom", async ({
  page,
}) => {
  await page.goto(`/e/${await firstEpisodeId(page)}`);

  const add = page.getByRole("button", { name: copy.episode.momentAdd });
  await expect(add).toBeVisible();
  await add.click();

  await expectNoZoomingFields(page, "moment composer");
});

test("14.3 the cast proposer does not trigger Safari focus zoom", async ({
  page,
}) => {
  await page.goto(`/e/${await firstEpisodeId(page)}`);

  const add = page.getByRole("button", { name: copy.episode.castAdd });
  await expect(add).toBeVisible();
  await add.click();

  /**
   * 🚨 THE COMPOSER AT REST NO LONGER HAS A TYPABLE CONTROL, and that is why
   * this test opens two of them by hand. Choosing a person is our own dropdown
   * (a button) and the role is three buttons, so the guard inside
   * `expectNoZoomingFields` reported "no form controls" - correctly. Both
   * fields it used to cover still exist; they are just one interaction away,
   * and asserting on the resting state would now prove nothing.
   */
  const picker = page.getByRole("button", { name: copy.episode.castPick }).first();
  await expect(picker).toBeVisible();
  await picker.click();

  // The panel's search box, which is the field a member types in most often.
  await expect(page.getByPlaceholder(copy.picker.search)).toBeVisible();
  await expectNoZoomingFields(page, "cast proposer, person search");

  // And the free-text name, reached through the picker's last row.
  await page.getByRole("option", { name: copy.picker.custom }).click();
  await expect(
    page.getByPlaceholder(copy.episode.castCustomPlaceholder),
  ).toBeVisible();
  await expectNoZoomingFields(page, "cast proposer, typed name");
});

// ---------------------------------------------------------------------------
// 14.4 Layout under WebKit
// ---------------------------------------------------------------------------

// 🇧🇬 The Cyrillic query is built here with `encodeURIComponent`, never passed
// through a shell: Git Bash replaces every Cyrillic character in an argument
// with "?", which tokenises to nothing and makes a broken search look fine.
const PUBLIC_ROUTES = [
  "/",
  "/episodes",
  "/channels",
  "/leaderboard",
  "/search",
  `/search?q=${encodeURIComponent("баница")}`,
];

for (const route of PUBLIC_ROUTES) {
  test(`14.4 ${route} never scrolls sideways in Safari`, async ({ page }) => {
    await page.goto(route);

    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));

    expect(
      metrics.doc,
      `${route}: the document is wider than the viewport (${JSON.stringify(metrics)})`,
    ).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
  });
}

// ---------------------------------------------------------------------------
// 14.5 Touch targets in the persistent chrome
// ---------------------------------------------------------------------------

test("14.5 every header control clears the 44px touch minimum", async ({
  page,
}) => {
  await page.goto("/");

  // The controls that are on screen on every single route. Their VISIBLE boxes
  // are 28, 34 and 38px by design - `.tap-target` in globals.css grows the hit
  // area with a pseudo-element rather than the drawn box, so this reads the
  // union of the two, which is what a finger actually lands on.
  const boxes = await page.evaluate((min) => {
    const header = document.querySelector("header");
    if (!header) return null;
    return [...header.querySelectorAll("a, button")]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const after = getComputedStyle(el, "::after");
        // A `.tap-target` pseudo is centred on its element, so the hit area is
        // whichever of the two is larger on each axis.
        const width = Math.max(rect.width, parseFloat(after.width) || 0);
        const height = Math.max(rect.height, parseFloat(after.height) || 0);
        return {
          label:
            el.getAttribute("aria-label") ||
            el.textContent?.trim() ||
            "(unlabelled)",
          width: Math.round(width),
          height: Math.round(height),
          tooSmall: width < min || height < min,
        };
      });
  }, MIN_TAP_PX);

  expect(boxes, "no <header> on the page").not.toBeNull();
  expect(boxes!.length, "the header rendered no controls").toBeGreaterThan(0);

  const small = boxes!.filter((box) => box.tooSmall);
  expect(
    small,
    `these header controls are under ${MIN_TAP_PX}px of touch area: ${JSON.stringify(small)}`,
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// 14.6 The bottom sheet
// ---------------------------------------------------------------------------

test("14.6 the settings sheet fits inside the Safari viewport", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: copy.nav.openSettings }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // ⚠️ POLLED, not read once. The sheet slides up from `translate-y-full` over
  // 240ms, so a single read taken the instant it becomes visible catches it
  // mid-flight and reports a bottom edge ~40px below the screen - a measurement
  // of the animation, not of the layout. This asserts where it comes to REST,
  // which is the thing that would actually be wrong.
  //
  // 🚨 What it is guarding: `max-h-[92dvh]`. `dvh` rather than `vh` is the
  // load-bearing half - `vh` in Safari resolves against the LARGE viewport,
  // the one with the browser toolbars collapsed, so a sheet sized in `vh` is
  // taller than the screen for as long as they are expanded, which is exactly
  // the moment the user has just tapped something.
  // How far the sheet hangs below the bottom of the screen. Zero at rest;
  // ~40px while it is still sliding.
  const overhang = async () =>
    dialog.evaluate(
      (el) => el.getBoundingClientRect().bottom - window.innerHeight,
    );

  await expect
    .poll(overhang, {
      message:
        "the settings sheet never came to rest inside the viewport - it is " +
        "taller than the screen, which is what `max-h-[92dvh]` prevents",
    })
    .toBeLessThanOrEqual(1);

  // And it must not have overshot upward either: a sheet whose top is above 0
  // has content scrolled off the top of the screen with no way back to it.
  const top = await dialog.evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  expect(top).toBeGreaterThanOrEqual(0);
});
