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
import { RESULT_LIMIT, TRANSCRIPT_SEGMENT_LIMIT } from "@/lib/search-limits";

import { test, expect, apiJson } from "./fixtures";

type SearchResult = Schema<"SearchOut">;
type TranscriptResult = Schema<"TranscriptSearchOut">;

/** Imported, never restated: a copy of a page size drifts the moment one moves. */
const PAGE_LIMIT = RESULT_LIMIT;
const TRANSCRIPT_LIMIT = TRANSCRIPT_SEGMENT_LIMIT;

/** Bulgarian queries with known matches in the ingested data. */
const QUERY_KASPAROV = "Каспаров";
const QUERY_KASPAROV_TYPO = "Каспарв";
const QUERY_EUROVISION = "евровизия";
const QUERY_EUROVISION_TYPO = "еврвизия";
const QUERY_NO_MATCH = "zzznothingzzz";

/**
 * A word that is SPOKEN in the catalogue but labels nothing.
 *
 * 🚨 It is also one of the example queries printed on the search page itself,
 * and before transcripts were wired in it rendered "nothing matched" - the page
 * advertised a query it could not answer while 173 passages said the word out
 * loud. The test does not hardcode that count; it asserts against both live
 * endpoints.
 */
const QUERY_SPOKEN_ONLY = "баница";

/** URL of the search page for a query, percent-encoded by URLSearchParams. */
function searchPagePath(query: string): string {
  return `/search?${new URLSearchParams({ q: query })}`;
}

/** Same query straight to Django, so the UI can be diffed against the source. */
function transcriptApiPath(query: string): string {
  return `/api/search/transcripts?${new URLSearchParams({
    q: query,
    limit: String(TRANSCRIPT_LIMIT),
  })}`;
}

function searchApiPath(query: string): string {
  return `/api/search?${new URLSearchParams({ q: query, limit: String(PAGE_LIMIT) })}`;
}

/** Result cards are the only `/e/` links on the page - the nav has none. */
function resultLinks(page: Page) {
  return page.locator('a[href^="/e/"]');
}

/**
 * 🚨 Scoped to the LABEL-match region on purpose.
 *
 * /search renders two regions from two endpoints: `/api/search` ("which
 * episodes are ABOUT this") and `/api/search/transcripts` ("where was this
 * SAID"). An unscoped `a[href^="/e/"]` counts both, so comparing it against
 * `/api/search` alone would fail the moment a query also matched spoken words -
 * which is most of them. Each region is asserted against its own endpoint.
 */
async function renderedResultIds(page: Page): Promise<string[]> {
  return regionIds(page, "results-labelled");
}

/** Episodes that matched ONLY in the transcript, in render order. */
async function spokenResultIds(page: Page): Promise<string[]> {
  return regionIds(page, "results-spoken");
}

async function regionIds(page: Page, testId: string): Promise<string[]> {
  const region = page.getByTestId(testId);
  if ((await region.count()) === 0) return [];
  const hrefs = await region
    .locator('a[href^="/e/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
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

  test("7.3b a word that is only SPOKEN still finds its episodes", async ({ page }) => {
    const [labels, spoken] = await Promise.all([
      apiJson<SearchResult>(page, searchApiPath(QUERY_SPOKEN_ONLY)),
      apiJson<TranscriptResult>(page, transcriptApiPath(QUERY_SPOKEN_ONLY)),
    ]);

    // Fail loudly if the fixture stops being a transcript-only word, rather
    // than letting the assertions below pass over an empty page.
    expect(
      spoken.hits.length,
      `"${QUERY_SPOKEN_ONLY}" must be spoken somewhere in the catalogue`,
    ).toBeGreaterThan(0);

    await page.goto(searchPagePath(QUERY_SPOKEN_ONLY));

    // 🚨 The regression this whole feature exists for: the page must NOT claim
    // nothing matched while the word is audibly said in the catalogue.
    await expect(page.getByText(copy.search.zeroTitle)).toHaveCount(0);

    const labelIds = await renderedResultIds(page);
    const spokenIds = await spokenResultIds(page);
    expect(labelIds).toEqual(labels.hits.map((hit) => hit.episode.youtube_id));
    expect(spokenIds.length).toBeGreaterThan(0);

    // The spoken region holds only episodes the label search did NOT return -
    // an episode appearing in both regions would be one result shown twice.
    const apiSpokenOnly = spoken.hits
      .map((hit) => hit.episode.youtube_id)
      .filter((id) => !labelIds.includes(id));
    expect(spokenIds).toEqual(apiSpokenOnly.slice(0, spokenIds.length));
    for (const id of spokenIds) expect(labelIds).not.toContain(id);

    // 🚨 Coverage is ~30% of the catalogue and runs from 99% on one channel to
    // 0% on another, so the caveat is not optional decoration.
    await expect(page.getByText(copy.search.spokenPartial)).toBeVisible();
  });

  test("7.3c a spoken match carries a timestamp that deep-links into the video", async ({
    page,
  }) => {
    const spoken = await apiJson<TranscriptResult>(
      page,
      transcriptApiPath(QUERY_SPOKEN_ONLY),
    );
    const first = spoken.hits[0];
    expect(first, "fixture must return at least one spoken match").toBeTruthy();
    const match = first!.matches[0]!;

    await page.goto(searchPagePath(QUERY_SPOKEN_ONLY));

    // The timestamp IS the link - a passage without one is just a quote, and
    // "where was this said" is the entire question this half of search answers.
    const deepLink = page.locator(
      `a[href="https://www.youtube.com/watch?v=${first!.episode.youtube_id}&t=${match.start_sec}"]`,
    );
    await expect(deepLink.first()).toBeVisible();
    await expect(deepLink.first()).toContainText(copy.search.reasonSaidAt);

    // 🔒 Caption text reaches the page carrying <mark> tags. It is rendered as
    // element nodes, never injected as HTML, so the literal tag must not be
    // visible as text anywhere on the page.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("<mark>");
    expect(bodyText).not.toContain("</mark>");
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
