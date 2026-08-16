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
import { formatTimestamp } from "@/lib/format";
import { RESULT_LIMIT, SPOKEN_LIMIT } from "@/lib/search-limits";

import { test, expect, apiJson } from "./fixtures";

type SearchResult = Schema<"SearchOut">;
type TranscriptResult = Schema<"TranscriptSearchOut">;

/** Imported, never restated: a copy of a page size drifts the moment one moves. */
const PAGE_LIMIT = RESULT_LIMIT;
/**
 * ⚠️ EPISODES since 2026-08-16, not segments. `/api/search/transcripts` used to
 * page over passages and group them afterwards, which is why the page could
 * advertise more episodes than it rendered.
 */
const TRANSCRIPT_LIMIT = SPOKEN_LIMIT;

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

/**
 * A multi-word query where only SOME episodes contain every word.
 *
 * 🎯 The case the whole loose-matching design exists for. People search for a
 * half-remembered phrase, not a quotation, so requiring every word answers
 * "nothing matches" to questions with real answers - and answering loosely
 * without saying so makes a one-of-three-words hit look like a perfect one.
 * Measured 2026-08-16: 15 label matches, of which 4 contain both words.
 */
const QUERY_MULTI_WORD = "историята с колата";

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
 * 🚨 Scoped to the LABEL-match regions on purpose.
 *
 * /search renders results from two endpoints: `/api/search` ("which episodes
 * are ABOUT this") and `/api/search/transcripts` ("where was this SAID"). An
 * unscoped `a[href^="/e/"]` counts both, so comparing it against `/api/search`
 * alone would fail the moment a query also matched spoken words - which is most
 * of them. Each region is asserted against its own endpoint.
 *
 * ⚠️ Since 2026-08-15 the label matches are PARTITIONED across regions, and
 * since 2026-08-16 there are three of them:
 *
 *   - `results-title`     full match, the words are in the episode title
 *   - `results-elsewhere` full match, on a topic, moment, guest or channel
 *   - `results-partial`   matched only SOME of the query's words
 *
 * Together they are exactly what `/api/search` returned, which is why this
 * concatenates all three. The title partition is pinned by 7.1b and the
 * full/partial one by 7.1e; ORDER across regions is deliberately not asserted
 * here, because the whole point of the split is that it reorders.
 */
async function renderedResultIds(page: Page): Promise<string[]> {
  await waitForResults(page);
  return [
    ...(await regionIds(page, "results-title")),
    ...(await regionIds(page, "results-elsewhere")),
    ...(await regionIds(page, "results-partial")),
  ];
}

/** Episodes that matched ONLY in the transcript, in render order. */
async function spokenResultIds(page: Page): Promise<string[]> {
  await waitForResults(page);
  return regionIds(page, "results-spoken");
}

/**
 * Block until the page has actually rendered its answer.
 *
 * 🚨 REQUIRED SINCE `app/search/loading.tsx` EXISTED (2026-08-16). With a
 * Suspense boundary the route streams: Next flushes the shell and the skeleton
 * first, and `page.goto` resolves on that. `regionIds` then reads a DOM with no
 * result regions in it yet and returns `[]` - a silent empty answer, not a
 * failure, which is the worst shape a race can take in a test.
 *
 * The `<h1>` is the right thing to wait on because it renders for EVERY query,
 * including one that matches nothing. Waiting on a result region instead would
 * hang forever on the no-results case.
 *
 * 🚨 AND THE ASSERTION IS `toHaveCount(1)`, NOT `toBeVisible()`. React streams
 * a completed Suspense boundary into a `<div hidden>` at the end of `<body>`
 * and moves it into place with an inline script, so for a few milliseconds the
 * document genuinely contains the results TWICE. Playwright caught that window
 * and reported it as a doubled result id and a strict-mode violation on
 * `getByText` - two failures that read like product bugs and are neither.
 * Waiting for exactly one heading waits out the swap.
 */
async function waitForResults(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
    // Set equality, not sequence equality: the page splits the API's ranked
    // list into title matches and everything else, so render order is a
    // permutation of API order by design. 7.1b pins that the split is correct.
    expect([...ids].sort()).toEqual(
      api.hits.map((hit) => hit.episode.youtube_id).sort(),
    );
    await expect(
      page.getByText(copy.search.resultsFor(QUERY_KASPAROV)),
    ).toBeVisible();
  });

  /**
   * 🚨 The regression test for the count that lied.
   *
   * Reported 2026-08-16 on `царичи`: the heading said "2 episodes", the page
   * rendered eight cards, and a line underneath advertised passages in thirteen
   * episodes while the spoken section showed six with no way to reach the rest.
   * Three separate defects produced that, and this pins all three:
   *
   *   1. the heading counted only one of the two result sets
   *   2. the spoken episode count was an artefact of a SEGMENT page size
   *   3. the spoken section was hard-capped below the number it advertised
   */
  test("7.1c every number on the page is reachable by the cards below it", async ({
    page,
  }) => {
    const [labels, spoken] = await Promise.all([
      apiJson<SearchResult>(page, searchApiPath(QUERY_SPOKEN_ONLY)),
      apiJson<TranscriptResult>(page, transcriptApiPath(QUERY_SPOKEN_ONLY)),
    ]);
    expect(
      spoken.total_episodes,
      `"${QUERY_SPOKEN_ONLY}" must be spoken somewhere in the catalogue`,
    ).toBeGreaterThan(0);

    await page.goto(searchPagePath(QUERY_SPOKEN_ONLY));

    // 1. The heading no longer claims a count at all.
    await expect(
      page.getByText(copy.search.resultsFor(QUERY_SPOKEN_ONLY)),
    ).toBeVisible();

    // 2. The spoken summary quotes the EXACT episode total from the API.
    await expect(
      page.getByText(
        copy.search.summarySpoken(spoken.total_episodes, spoken.total_segments),
      ),
    ).toBeVisible();

    // 3. The API returned a full page of episodes, so the section must either
    //    render all of them or offer a way to reach the rest. Rendering fewer
    //    than advertised with no "load more" is the exact bug.
    const rendered = (await spokenResultIds(page)).length;
    const labelIds = new Set(labels.hits.map((hit) => hit.episode.youtube_id));
    const expectedRendered = spoken.hits.filter(
      (hit) => !labelIds.has(hit.episode.youtube_id),
    ).length;
    expect(rendered).toBe(expectedRendered);

    if (spoken.total_episodes > spoken.hits.length) {
      await expect(
        page.getByRole("link", { name: copy.search.spokenLoadMore }),
      ).toBeVisible();
    }
  });

  /**
   * The spoken section pages independently of the label sections, so "load
   * more" there must actually widen the spoken region and leave the label
   * regions alone.
   */
  test("7.1d spoken load-more widens only the spoken section", async ({ page }) => {
    const spoken = await apiJson<TranscriptResult>(
      page,
      transcriptApiPath(QUERY_SPOKEN_ONLY),
    );
    // A fixture check, not a skip: if this query stops having more spoken
    // episodes than one page holds, the test must fail loudly rather than
    // quietly stop covering pagination.
    expect(
      spoken.total_episodes,
      `"${QUERY_SPOKEN_ONLY}" must exceed one spoken page (${SPOKEN_LIMIT}) for this test to mean anything`,
    ).toBeGreaterThan(SPOKEN_LIMIT);

    await page.goto(searchPagePath(QUERY_SPOKEN_ONLY));
    const firstSpoken = (await spokenResultIds(page)).length;
    const firstLabels = (await renderedResultIds(page)).length;

    await page.getByRole("link", { name: copy.search.spokenLoadMore }).click();
    await page.waitForURL(/[?&]s=/);

    expect((await spokenResultIds(page)).length).toBeGreaterThan(firstSpoken);
    expect((await renderedResultIds(page)).length).toBe(firstLabels);
  });

  /**
   * Loose matching is only safe because it is LABELLED.
   *
   * The API returns hits that matched some of the query's words, ordered so
   * that full matches come first, and says exactly where that boundary is
   * (`total_full`). This asserts the page honours it: partial hits go in their
   * own region under their own heading, and no full match is buried among them.
   */
  test("7.1e partial matches are separated from full ones", async ({ page }) => {
    const api = await apiJson<SearchResult>(page, searchApiPath(QUERY_MULTI_WORD));
    expect(
      api.total,
      `"${QUERY_MULTI_WORD}" must match something for this test to mean anything`,
    ).toBeGreaterThan(0);
    expect(
      api.total_full,
      `"${QUERY_MULTI_WORD}" must have BOTH full and partial matches`,
    ).toBeGreaterThan(0);
    expect(api.total_full).toBeLessThan(api.total);

    await page.goto(searchPagePath(QUERY_MULTI_WORD));

    await expect(
      page.getByRole("heading", { name: copy.search.partialHeading }),
    ).toBeVisible();

    const fullIds = new Set(
      api.hits.filter((hit) => hit.match_kind !== "partial").map((h) => h.episode.youtube_id),
    );
    const partialIds = new Set(
      api.hits.filter((hit) => hit.match_kind === "partial").map((h) => h.episode.youtube_id),
    );
    expect(partialIds.size).toBeGreaterThan(0);

    const renderedPartial = await regionIds(page, "results-partial");
    expect(renderedPartial.length).toBe(partialIds.size);
    for (const id of renderedPartial) {
      expect(partialIds.has(id), `${id} is under "partial" but the API called it full`).toBe(true);
    }

    // ...and nothing the API called partial may sit in a full-match region.
    const renderedFull = [
      ...(await regionIds(page, "results-title")),
      ...(await regionIds(page, "results-elsewhere")),
    ];
    expect(renderedFull.length).toBe(fullIds.size);
    for (const id of renderedFull) {
      expect(fullIds.has(id), `${id} is shown as a full match but the API called it partial`).toBe(
        true,
      );
    }
  });

  /**
   * The title/elsewhere split is the whole reason /search reorders its results,
   * so it needs its own assertion. Without this, a bug that dropped every hit
   * into one bucket would still pass 7.1 - the union would be identical.
   */
  test("7.1b title matches are separated from everything else", async ({ page }) => {
    const api = await apiJson<SearchResult>(page, searchApiPath(QUERY_KASPAROV));
    expect(api.total, `"${QUERY_KASPAROV}" must match at least one episode`).toBeGreaterThan(0);

    await page.goto(searchPagePath(QUERY_KASPAROV));

    const titleRegion = page.getByTestId("results-title");
    const elsewhereRegion = page.getByTestId("results-elsewhere");

    const titleCount = await titleRegion.count();
    const elsewhereCount = await elsewhereRegion.count();
    expect(
      titleCount + elsewhereCount,
      "neither result region rendered - the split is not wired up",
    ).toBeGreaterThan(0);

    const needle = QUERY_KASPAROV.toLocaleLowerCase("bg");

    // Every card under "in the title" must actually have it in its title.
    if (titleCount > 0) {
      const titles = await titleRegion.locator("h2").allInnerTexts();
      expect(titles.length).toBeGreaterThan(0);
      for (const title of titles) {
        expect(
          title.toLocaleLowerCase("bg"),
          `"${title}" is under the title heading but does not contain the query`,
        ).toContain(needle);
      }
    }

    // ...and nothing under "everywhere else" may have it in its title, or the
    // reader is being told two different things about the same card.
    if (elsewhereCount > 0) {
      const titles = await elsewhereRegion.locator("h2").allInnerTexts();
      for (const title of titles) {
        expect(
          title.toLocaleLowerCase("bg"),
          `"${title}" is under the non-title heading but contains the query`,
        ).not.toContain(needle);
      }
    }
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
    // 🚨 The badge no longer PRINTS "said at" - it repeated on every passage
    // row and the owner asked for it gone. It survives as the accessible name,
    // which is now the only thing telling a screen-reader user what the bare
    // timestamp means, so it is asserted there instead of in the text.
    await expect(deepLink.first()).toHaveAttribute(
      "aria-label",
      new RegExp(copy.search.reasonSaidAt),
    );
    await expect(deepLink.first()).toContainText(formatTimestamp(match.start_sec));

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
    // The wait is shared with the other DOM readers - see waitForResults for
    // why a bare toBeVisible() is not enough on a streamed route.
    await waitForResults(page);
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
