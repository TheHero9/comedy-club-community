/**
 * Section 18 - suggesting a cast: our dropdown, and one submission.
 *
 * Two owner reports produced this file, and neither is visible to a static
 * gate:
 *
 *   1. "when I click choose a person it's a drop down which is like native to
 *      the device you're using - we want to have our own." A `<select>`
 *      typechecks, lints and builds exactly as well as a listbox does.
 *   2. "I need to click someone to click suggest, then click someone else to
 *      click suggest - it's so slow." One round trip per person is a design
 *      decision no test could see either.
 *
 * 🚨 NOTHING HERE DEPENDS ON A PERSONA EXISTING. The real corpus has very few
 * `Person` rows and a test that needed one would either be flaky or - worse -
 * pass vacuously by iterating an empty list. Everything asserted below is true
 * of an empty catalogue: the panel opens, the "type a name" row is always
 * offered, a line can be added, and the submit label counts the lines.
 */
import { copy } from "@/lib/copy";

import { apiJson, expect, test } from "./fixtures";

interface EpisodeListResponse {
  items: { youtube_id: string }[];
}

async function openComposer(page: import("@playwright/test").Page) {
  const list = await apiJson<EpisodeListResponse>(page, "/api/episodes?limit=1");
  const id = list.items[0]?.youtube_id;
  expect(id, "the API returned no episode to open").toBeTruthy();

  await page.goto(`/e/${id}`);
  const add = page.getByRole("button", { name: copy.episode.castAdd });
  await expect(add).toBeVisible();
  await add.click();
  return page.locator("form", { hasText: copy.episode.castAddTitle });
}

test("18.1 choosing a person is OUR dropdown, never a native select", async ({
  page,
}) => {
  const form = await openComposer(page);

  // The whole point. A native control here hands the choice to the operating
  // system, which cannot show an avatar and cannot be searched.
  await expect(form.locator("select")).toHaveCount(0);

  const trigger = page.getByRole("button", { name: copy.episode.castPick }).first();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();

  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // Present whether or not the catalogue has anyone in it yet.
  await expect(page.getByPlaceholder(copy.picker.search)).toBeVisible();
  await expect(
    page.getByRole("option", { name: copy.picker.custom }),
  ).toBeVisible();
});

test("18.2 Escape closes the panel and returns focus to the trigger", async ({
  page,
}) => {
  await openComposer(page);

  const trigger = page.getByRole("button", { name: copy.episode.castPick }).first();
  await trigger.click();
  await expect(page.getByRole("listbox")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  // Losing focus to the top of the document is how a keyboard user gets lost.
  await expect(trigger).toBeFocused();
});

test("18.3 the whole cast is ONE submission, and the button says how many", async ({
  page,
}) => {
  await openComposer(page);

  const triggers = page.getByRole("button", { name: copy.episode.castPick });
  await expect(triggers).toHaveCount(1);
  // A single line offers no submit button per line and no way to remove itself.
  await expect(
    page.getByRole("button", { name: copy.episode.castSubmitAll(1) }),
  ).toBeVisible();

  await page.getByRole("button", { name: copy.episode.castAddRow }).click();
  await expect(triggers).toHaveCount(2);

  // 🚨 ONE button for both lines. Two submit buttons would be the old flow with
  // extra steps.
  await expect(
    page.getByRole("button", { name: copy.episode.castSubmitAll(2) }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: copy.episode.castRowRemove }),
  ).toHaveCount(2);

  await page.getByRole("button", { name: copy.episode.castRowRemove }).first().click();
  await expect(triggers).toHaveCount(1);
});

test("18.4 a line with nobody chosen is refused before it reaches the API", async ({
  page,
}) => {
  const form = await openComposer(page);

  await page.getByRole("button", { name: copy.episode.castSubmitAll(1) }).click();

  // Said on the page, not swallowed. An empty line is a half-finished thought,
  // so it does not deserve a round trip either. Scoped to the form: Next mounts
  // its own permanently-empty `role="alert"` route announcer on every page.
  await expect(form.getByRole("alert")).toContainText(copy.episode.castNeedsPerson);
});

test("18.5 the typed-name field appears only when it is asked for", async ({
  page,
}) => {
  await openComposer(page);

  const typed = page.getByPlaceholder(copy.episode.castCustomPlaceholder);
  await expect(typed).toHaveCount(0);

  await page.getByRole("button", { name: copy.episode.castPick }).first().click();
  await page.getByRole("option", { name: copy.picker.custom }).click();

  await expect(typed).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});
