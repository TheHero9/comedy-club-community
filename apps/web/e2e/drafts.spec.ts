/**
 * Section 19 - what you typed survives.
 *
 * 🚨 THE INCIDENT. On 2026-08-20 two cast submissions were sent with no
 * Authorization header (`viewerToken()` answers null while Clerk is still
 * loading), came back 401, and the whole typed cast was gone. The forensic
 * cost was a five-day sweep of the production proxy log; the cost to the
 * member was minutes of work and the belief that the site loses things.
 *
 * 🚨 WHY THIS HAS TO BE AN E2E TEST. `tests/drafts.spec.ts` proves the STORE
 * keeps a value, and `tests/api-client.spec.ts` 4.44-4.50 prove a write never
 * leaves anonymous. Neither can prove the only thing the member cares about:
 * that text typed into a real form in a real browser is still on screen after
 * the page is thrown away and rebuilt. That claim spans localStorage, the
 * hydration gate in `useDraft`, and the composer's own open/closed state - and
 * a mistake in any one of them is invisible to typecheck, lint and build.
 *
 * ⚠️ Reloading is the harshest honest test available here. It destroys every
 * scrap of React state exactly as a crashed tab, a killed background tab or a
 * followed link would, without needing to simulate any of them.
 */
import { copy } from "@/lib/copy";

import { apiJson, expect, test } from "./fixtures";

interface EpisodeListResponse {
  items: { youtube_id: string }[];
}

/** An episode id from the live API - never a hardcoded one. */
async function anyEpisodeId(page: import("@playwright/test").Page): Promise<string> {
  const list = await apiJson<EpisodeListResponse>(page, "/api/episodes?limit=1");
  const id = list.items[0]?.youtube_id;
  expect(id, "the API returned no episode to open").toBeTruthy();
  return id as string;
}

const TYPED_LABEL = "Иван деменция в колата с Петя";
const TYPED_TIME = "1:07:24";

test("19.1 a moment typed but never sent is still there after a reload", async ({ page }) => {
  const id = await anyEpisodeId(page);
  await page.goto(`/e/${id}`);

  const add = page.getByRole("button", { name: copy.episode.momentAdd });
  await expect(add).toBeVisible();
  await add.click();

  const time = page.getByPlaceholder(copy.episode.momentTimePlaceholder);
  const label = page.getByPlaceholder(copy.episode.momentWhatPlaceholder);
  await time.fill(TYPED_TIME);
  await label.fill(TYPED_LABEL);

  // Everything React knows is discarded here. Nothing was submitted.
  await page.reload();

  // 🚨 The composer reopens ITSELF. Text restored into a form nobody can see
  // would not be a restore - the member would retype it without ever knowing.
  await expect(page.getByPlaceholder(copy.episode.momentWhatPlaceholder)).toHaveValue(
    TYPED_LABEL,
  );
  await expect(page.getByPlaceholder(copy.episode.momentTimePlaceholder)).toHaveValue(
    TYPED_TIME,
  );
  // And it says so, rather than silently repopulating - unexplained text
  // appearing is the mirror image of text unexplainedly vanishing.
  await expect(page.getByText(copy.common.draftRestored)).toBeVisible();
});

test("19.2 discarding is explicit, and then it really is gone", async ({ page }) => {
  const id = await anyEpisodeId(page);
  await page.goto(`/e/${id}`);

  await page.getByRole("button", { name: copy.episode.momentAdd }).click();
  await page.getByPlaceholder(copy.episode.momentWhatPlaceholder).fill(TYPED_LABEL);
  await page.reload();

  await expect(page.getByText(copy.common.draftRestored)).toBeVisible();
  await page.getByRole("button", { name: copy.common.draftDiscard }).click();

  // Discard closes the form, because there is nothing left in it to show.
  await expect(page.getByRole("button", { name: copy.episode.momentAdd })).toBeVisible();

  // 🚨 And it stays gone across a reload. A discard that only cleared React
  // state would resurrect the text on the next visit, which is worse than not
  // having a discard at all.
  await page.reload();
  await expect(page.getByText(copy.common.draftRestored)).toHaveCount(0);
  await page.getByRole("button", { name: copy.episode.momentAdd }).click();
  await expect(page.getByPlaceholder(copy.episode.momentWhatPlaceholder)).toHaveValue("");
});

test("19.3 closing the composer KEEPS the draft - closing is not discarding", async ({
  page,
}) => {
  const id = await anyEpisodeId(page);
  await page.goto(`/e/${id}`);

  await page.getByRole("button", { name: copy.episode.momentAdd }).click();
  await page.getByPlaceholder(copy.episode.momentWhatPlaceholder).fill(TYPED_LABEL);

  // Cancel used to throw the text away. It no longer does: a member tidying a
  // form away has not agreed to lose what is in it.
  await page.getByRole("button", { name: copy.episode.momentCancel }).click();
  await expect(page.getByRole("button", { name: copy.episode.momentAdd })).toBeVisible();

  await page.getByRole("button", { name: copy.episode.momentAdd }).click();
  await expect(page.getByPlaceholder(copy.episode.momentWhatPlaceholder)).toHaveValue(
    TYPED_LABEL,
  );
});

test("19.4 a draft belongs to ONE episode and never follows you to another", async ({
  page,
}) => {
  const list = await apiJson<EpisodeListResponse>(page, "/api/episodes?limit=2");
  const [first, second] = list.items;
  expect(second, "need two episodes to prove drafts are scoped").toBeTruthy();

  await page.goto(`/e/${first.youtube_id}`);
  await page.getByRole("button", { name: copy.episode.momentAdd }).click();
  await page.getByPlaceholder(copy.episode.momentWhatPlaceholder).fill(TYPED_LABEL);

  // 🚨 A single "moment" key would put one episode's half-typed label into the
  // next episode's form, which reads as the site putting words in your mouth.
  await page.goto(`/e/${second.youtube_id}`);
  await expect(page.getByText(copy.common.draftRestored)).toHaveCount(0);
  await page.getByRole("button", { name: copy.episode.momentAdd }).click();
  await expect(page.getByPlaceholder(copy.episode.momentWhatPlaceholder)).toHaveValue("");

  // ...and the first episode still has its own.
  await page.goto(`/e/${first.youtube_id}`);
  await expect(page.getByPlaceholder(copy.episode.momentWhatPlaceholder)).toHaveValue(
    TYPED_LABEL,
  );
});

test("19.5 a typed cast line survives a reload too", async ({ page }) => {
  const id = await anyEpisodeId(page);
  await page.goto(`/e/${id}`);

  await page.getByRole("button", { name: copy.episode.castAdd }).click();
  const form = page.locator("form", { hasText: copy.episode.castAddTitle });

  // The "not listed, I will type a name" path, which needs no persona to exist
  // and so cannot pass vacuously on a catalogue with few `Person` rows.
  await page.getByRole("button", { name: copy.episode.castPick }).first().click();
  await page.getByRole("option", { name: copy.picker.custom }).click();
  const typed = form.getByPlaceholder(copy.episode.castCustomPlaceholder);
  await typed.fill("Тонката");

  await page.reload();

  await expect(page.getByText(copy.common.draftRestored)).toBeVisible();
  await expect(
    page.locator("form", { hasText: copy.episode.castAddTitle })
      .getByPlaceholder(copy.episode.castCustomPlaceholder),
  ).toHaveValue("Тонката");
});
