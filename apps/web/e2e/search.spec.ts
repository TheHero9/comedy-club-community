/**
 * Search (matrix section 7).
 *
 * CYRILLIC NEVER GOES THROUGH A SHELL. Git Bash mangles non-ASCII
 * command-line arguments before `curl.exe` sees them, so `q=Каспаров` arrives as
 * `q=????????`. Meilisearch treats `?` as a separator, the query tokenizes to
 * nothing, and the search returns EVERY document - which reads exactly like a
 * catastrophic relevance bug. Every query here is issued from inside the browser
 * or through Playwright's request context, where the source file's UTF-8 is
 * preserved end to end.
 *
 * Expected counts come from the live API, never from a hardcoded number.
 */
import type { Page } from "@playwright/test";
import type { Schema } from "@ccc/api-types";

import { copy } from "@/lib/copy";

import { test, expect, apiJson } from "./fixtures";

type SearchResult = Schema<"SearchOut">;

/** The search page requests 24 hits per query. */
const PAGE_LIMIT = 24;

/** Bulgarian queries with known matches in the ingested data. */
const QUERY_KASPAROV = "Каспаров";
const QUERY_KASPAROV_TYPO = "Каспарв";
const QUERY_EUROVISION = "евровизия";
const QUERY_EUROVISION_TYPO = "еврвизия";
const QUERY_NO_MATCH = "zzznothingzzz";

/** URL of the search page for a query, percent-encoded by URLSearchParams. */
function searchPagePath(query: string): string {
  return `/search?${new URLSearchParams({ q: query })}`;
}

/** Same query straight to Django, so the UI can be diffed against the source. */
function searchApiPath(query: string): string {
  return `/api/search?${new URLSearchParams({ q: query, limit: String(PAGE_LIMIT) })}`;
}

/** Result cards are the only `/e/` links on the page - the nav has none. */
function resultLinks(page: Page) {
  return page.locator('a[href^="/e/"]');
}

async function renderedResultIds(page: Page): Promise<string[]> {
  const hrefs = await resultLinks(page).evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );
  return hrefs.map((href) => href.replace("/e/", ""));
}

test.describe("search", () => {
  test("7.1 a Bulgarian query returns episode results", async ({ page }) => {
    const api = await apiJson<SearchResult>(page, searchApiPath(QUERY_KASPAROV));
    // If the fixture stops matching, fail loudly here rather than letting the
    // page assertions pass vacuously against an empty result set.
    expect(api.total, `"${QUERY_KASPAROV}" must match at least one episode`).toBeGreaterThan(0);

    await page.goto(searchPagePath(QUERY_KASPAROV));

    const ids = await renderedResultIds(page);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBe(Math.min(api.total, PAGE_LIMIT));
    expect(ids).toEqual(api.hits.map((hit) => hit.episode.youtube_id));
    await expect(
      page.getByText(
        copy.search.resultsFor(copy.search.resultCount(api.total), QUERY_KASPAROV),
      ),
    ).toBeVisible();
  });

  test("7.2 a dropped letter still finds the episode (typo tolerance)", async ({
    page,
  }) => {
    const correct = await apiJson<SearchResult>(page, searchApiPath(QUERY_KASPAROV));
    const topHitId = correct.hits[0]?.episode.youtube_id;
    expect(topHitId, "the correctly spelled query must have a top hit").toBeTruthy();

    await page.goto(searchPagePath(QUERY_KASPAROV_TYPO));

    const ids = await renderedResultIds(page);
    expect(
      ids.length,
      `misspelled "${QUERY_KASPAROV_TYPO}" returned nothing - typo tolerance is broken`,
    ).toBeGreaterThan(0);
    expect(ids).toContain(topHitId);
    // A misspelling must not degenerate into "match everything", which is what a
    // tokenizer that swallowed the query would produce.
    expect(ids.length).toBeLessThan(PAGE_LIMIT);
  });

  test("7.3 a misspelled query returns the same results as the correct one", async ({
    page,
  }) => {
    const correctApi = await apiJson<SearchResult>(
      page,
      searchApiPath(QUERY_EUROVISION),
    );
    const typoApi = await apiJson<SearchResult>(
      page,
      searchApiPath(QUERY_EUROVISION_TYPO),
    );
    expect(correctApi.total).toBeGreaterThan(0);
    expect(typoApi.total).toBe(correctApi.total);

    await page.goto(searchPagePath(QUERY_EUROVISION));
    const correctIds = await renderedResultIds(page);

    await page.goto(searchPagePath(QUERY_EUROVISION_TYPO));
    const typoIds = await renderedResultIds(page);

    expect(correctIds.length).toBe(correctApi.total);
    expect(typoIds.length).toBe(correctIds.length);
    expect([...typoIds].sort()).toEqual([...correctIds].sort());
  });

  test("7.4 a query with no matches renders the empty state", async ({ page }) => {
    const api = await apiJson<SearchResult>(page, searchApiPath(QUERY_NO_MATCH));
    expect(api.total).toBe(0);

    await page.goto(searchPagePath(QUERY_NO_MATCH));

    // Page still renders, and renders nothing pretending to be a result.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(resultLinks(page)).toHaveCount(0);
    await expect(page.getByText(copy.search.zeroTitle)).toBeVisible();
    // Never blame the speller: the engine already tolerates typos, so the
    // copy has to say the word is unlabelled rather than misspelled.
    await expect(page.getByText(copy.search.zeroBody)).toBeVisible();
  });

  test("7.5 the bare search page prompts, and the field opens the overlay", async ({
    page,
  }) => {
    const response = await page.goto("/search");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      copy.search.title,
    );
    await expect(page.getByText(copy.search.subtitle)).toBeVisible();
    await expect(resultLinks(page)).toHaveCount(0);

    // The field is a trigger, not an input: it opens the overlay OVER the page
    // rather than navigating, so the page behind it survives a change of mind.
    await page.getByRole("button", { name: copy.search.trigger }).first().click();
    await expect(page.getByRole("searchbox")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/search");
  });

  test("7.6 Bulgarian result text renders intact, not as mojibake", async ({ page }) => {
    const api = await apiJson<SearchResult>(page, searchApiPath(QUERY_KASPAROV));
    const title = api.hits[0]?.episode.title;
    expect(title, "fixture must return a hit with a title").toBeTruthy();
    expect(title, "the fixture title must actually be Bulgarian").toMatch(/[Ѐ-ӿ]/);

    await page.goto(searchPagePath(QUERY_KASPAROV));

    // The exact Bulgarian title from the API is present in the DOM. Any encoding
    // fault anywhere in the chain breaks this byte-for-byte comparison.
    await expect(page.getByText(title!, { exact: false }).first()).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/[Ѐ-ӿ]/);
    // Classic UTF-8-read-as-latin1 signatures, plus the replacement character.
    expect(bodyText).not.toContain("Ð");
    expect(bodyText).not.toContain("Ñ");
    expect(bodyText).not.toContain("�");
    // The `????` shape a mangled Cyrillic query produces.
    expect(bodyText).not.toContain("????");
  });

  test("7.7 submitting the overlay puts the query in the URL, so results are shareable", async ({
    page,
  }) => {
    await page.goto("/search");

    await page.getByRole("button", { name: copy.search.trigger }).first().click();
    await page.getByRole("searchbox").fill(QUERY_KASPAROV);
    await page.getByRole("searchbox").press("Enter");

    // The query has to land in the URL, intact, for a result page to be linkable.
    await page.waitForURL((url) => url.pathname === "/search" && url.search !== "");
    const url = new URL(page.url());
    expect(url.searchParams.get("q")).toBe(QUERY_KASPAROV);

    const submittedIds = await renderedResultIds(page);
    expect(submittedIds.length).toBeGreaterThan(0);

    // Reloading that URL cold gives the same results - nothing was held in
    // client-side state.
    await page.goto(searchPagePath(QUERY_KASPAROV));
    expect(await renderedResultIds(page)).toEqual(submittedIds);
    // And the trigger is repopulated from the URL.
    await expect(
      page.getByRole("button", { name: QUERY_KASPAROV }).first(),
    ).toBeVisible();
  });
});
