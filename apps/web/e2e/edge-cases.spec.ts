/**
 * Hostile and boundary inputs against every route that takes one.
 *
 * The rest of the suite proves the app is right when the input is right. This
 * file is about what happens when it is not: a hand-edited URL, a stale
 * bookmark, a crawler walking a query string, a fuzzer.
 *
 * 🚨 The bar for every case here is the same: **the page must answer with a
 * real status and a real body.** Not a 500, not a blank shell, and above all
 * not a confident-looking page built from input the app did not understand.
 *
 * Two real bugs found writing it (both fixed in the API):
 *   - `?channel=a%00b` and five other params 500ed, because a NUL byte is legal
 *     in a URL, satisfies every Pydantic constraint, and only fails inside
 *     psycopg.
 *   - `/search?q=???` returned the ENTIRE catalogue. "???" is non-empty, so it
 *     reached Meilisearch, which tokenizes it to nothing, calls that a
 *     placeholder search, and matches every document.
 */
import type { Schema } from "@ccc/api-types";
import { MAX_API_LIMIT } from "@/components/browse/filter-model";
import { copy } from "@/lib/copy";
import { RESULT_LIMIT, SPOKEN_LIMIT } from "@/lib/search-limits";

import { apiJson, expect, expectSingleVisibleH1, test } from "./fixtures";

type EpisodeList = Schema<"EpisodeListOut">;
type SearchResult = Schema<"SearchOut">;
type TranscriptSearchResult = Schema<"TranscriptSearchOut">;

// ---------------------------------------------------------------------------
// 13. Profile routes
// ---------------------------------------------------------------------------

/** The four lists behind /me. One route file serves all of them. */
const PROFILE_LISTS = ["ratings", "history", "favorites", "tags"] as const;

test.describe("13. profile routes", () => {
  for (const list of PROFILE_LISTS) {
    test(`13.1 /me/${list} renders with a single heading`, async ({ page }) => {
      const response = await page.goto(`/me/${list}`);

      expect(response?.status(), `/me/${list} did not answer 200`).toBe(200);
      await expectSingleVisibleH1(page);
    });
  }

  test.describe("13.2 unknown list", () => {
    // Navigating to a deliberately missing document makes Chrome log the 404 it
    // returned. That is the browser reporting the status under test.
    test.use({
      allowedConsoleErrors: [
        /Failed to load resource: the server responded with a status of 404/,
      ],
    });

    test("13.2 an unknown profile list is a hard 404", async ({ page }) => {
      // `/me/[list]` calls notFound() for an unknown segment. A soft 200 here
      // would put a blank page on a real URL.
      const response = await page.goto("/me/not-a-real-list");

      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        copy.notFound.title,
      );
    });
  });

  test("13.3 the four lists are reachable from /me", async ({ page }) => {
    await page.goto("/me");

    let found = 0;
    for (const list of PROFILE_LISTS) {
      const link = page.locator(`a[href="/me/${list}"]`);
      if ((await link.count()) > 0) {
        await expect(link.first()).toBeVisible();
        found += 1;
      }
    }

    // Guards the loop: a /me page that linked to nothing would otherwise pass.
    expect(found, "/me links to none of its four lists").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 14. Query-string abuse on /episodes
// ---------------------------------------------------------------------------

/**
 * Each case is a query string the app must survive. `readFilters` allow-lists
 * `sort` and `kind` and clamps `limit`, but `channel` and `person` are passed
 * to the API verbatim, so these exercise both halves.
 */
const EPISODE_QUERIES: { name: string; query: string }[] = [
  { name: "unknown sort falls back to the default", query: "?sort=nonsense" },
  { name: "unknown kind is ignored", query: "?kind=banana" },
  { name: "unknown channel yields an empty state", query: "?channel=no-such-channel" },
  { name: "unknown person yields an empty state", query: "?person=no-such-person" },
  { name: "negative limit", query: "?limit=-5" },
  { name: "zero limit", query: "?limit=0" },
  { name: "non-numeric limit", query: "?limit=abc" },
  { name: "absurd limit is clamped", query: "?limit=99999999" },
  { name: "float limit", query: "?limit=2.5" },
  { name: "repeated params take the first", query: "?sort=top&sort=oldest" },
  { name: "SQL-looking channel is inert", query: "?channel=%27+OR+1%3D1--" },
  { name: "script tag in a filter is inert", query: "?channel=%3Cscript%3E" },
  { name: "NUL byte in a filter", query: "?channel=a%00b" },
  { name: "very long filter value", query: `?channel=${"a".repeat(3000)}` },
  { name: "cyrillic channel slug that does not exist", query: "?channel=несъществуващ" },
  { name: "empty values", query: "?sort=&kind=&channel=&person=&limit=" },
];

test.describe("14. /episodes survives a hand-edited query string", () => {
  for (const { name, query } of EPISODE_QUERIES) {
    test(`14.1 ${name}`, async ({ page }) => {
      const response = await page.goto(`/episodes${query}`);
      const status = response?.status() ?? 0;

      expect(
        status,
        `/episodes${query.slice(0, 60)} returned ${status}. A malformed filter ` +
          `must never produce a server error.`,
      ).toBeLessThan(500);

      // A real body, not a blank shell. Either results or the empty state -
      // both are legitimate answers, an empty <main> is not.
      await expectSingleVisibleH1(page);
    });
  }

  test("14.2 an unknown channel says so instead of showing everything", async ({
    page,
  }) => {
    // 🚨 The dangerous failure is not an error page, it is a filter that was
    // silently dropped: the user asked for one channel and got the whole
    // catalogue, presented as if it matched.
    await page.goto("/episodes?channel=no-such-channel-anywhere");

    await expect(
      page.getByText(copy.browse.emptyTitle, { exact: true }),
    ).toBeVisible();
  });

  test("14.3 a clamped limit never renders more cards than the API returned", async ({
    page,
  }) => {
    await page.goto("/episodes?limit=99999999");

    // MAX_API_LIMIT mirrors `MAX_LIMIT = 100` in podcast/api/public.py. Asking
    // the API for more than that is a 422, which is exactly the 500 this case
    // was written to catch.
    const api = await apiJson<EpisodeList>(
      page,
      `/api/episodes?limit=${MAX_API_LIMIT}&sort=newest`,
    );
    const cards = await page.locator('main a[href^="/e/"]').count();

    expect(cards, "no episode cards rendered at all").toBeGreaterThan(0);
    expect(
      cards,
      "the page rendered more episodes than the API's own maximum page",
    ).toBeLessThanOrEqual(api.items.length);
  });

  test("14.4 load more disappears at the API's ceiling instead of 500ing", async ({
    page,
  }) => {
    // 🚨 "Зареди още" grows `limit` by PAGE_SIZE per click. Past MAX_API_LIMIT
    // the API answers 422 and the server component throws, so the eleventh
    // click used to serve a 500 to an ordinary user.
    const response = await page.goto(`/episodes?limit=${MAX_API_LIMIT}`);
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("link", { name: copy.browse.loadMore }),
    ).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 15. Search edge cases
// ---------------------------------------------------------------------------

test.describe("15. search edge cases", () => {
  /**
   * 🚨 The regression this file exists for.
   *
   * A query of "???" tokenizes to nothing. Meilisearch reads that as a
   * placeholder search and answers with every document, so the page reported
   * the whole catalogue as matches. It is also exactly what a Cyrillic query
   * mangled by a shell looks like (every letter becomes "?"), so an API that
   * answers it honestly is what keeps that diagnosis readable.
   */
  for (const query of ["???", "...", "!!!", "?!.,"]) {
    test(`15.1 a punctuation-only query (${query}) finds nothing, not everything`, async ({
      page,
    }) => {
      const api = await apiJson<SearchResult>(
        page,
        `/api/search?q=${encodeURIComponent(query)}`,
      );
      expect(
        api.total,
        `the API returned ${api.total} hits for ${query}, so the UI cannot be right`,
      ).toBe(0);

      await page.goto(`/search?q=${encodeURIComponent(query)}`);

      await expect(page.getByText(copy.search.zeroTitle, { exact: true })).toBeVisible();
      await expect(page.locator('main a[href^="/e/"]')).toHaveCount(0);
    });
  }

  test("15.2 a real Bulgarian query still returns results", async ({ page }) => {
    // Guards 15.1: if search were broken outright, "finds nothing" would pass
    // for every query and prove nothing at all.
    const api = await apiJson<SearchResult>(page, "/api/search?q=подкаст");
    expect(api.total, "the fixture corpus is not searchable").toBeGreaterThan(0);

    await page.goto("/search?q=подкаст");

    await expect(page.locator('main a[href^="/e/"]').first()).toBeVisible();
  });

  test("15.3 the UI result count matches the API", async ({ page }) => {
    const query = "подкаст";
    // 🚨 /search renders TWO regions from TWO endpoints - "which episodes are
    // ABOUT this" and "where was this SAID". Each is counted against the
    // endpoint that produced it; an unscoped count over both could be satisfied
    // by the wrong region and would break whenever transcript coverage moved.
    const [labels, spoken] = await Promise.all([
      apiJson<SearchResult>(
        page,
        `/api/search?q=${encodeURIComponent(query)}&limit=${RESULT_LIMIT}`,
      ),
      apiJson<TranscriptSearchResult>(
        page,
        `/api/search/transcripts?q=${encodeURIComponent(query)}&limit=${SPOKEN_LIMIT}`,
      ),
    ]);
    expect(labels.hits.length).toBeGreaterThan(0);

    await page.goto(`/search?q=${encodeURIComponent(query)}`);

    // ⚠️ Three label regions since 2026-08-16: full matches split title-first,
    // then partial matches (some of the query's words, not all). Together they
    // are exactly what `/api/search` returned.
    await expect(
      page
        .getByTestId("results-title")
        .locator('a[href^="/e/"]')
        .or(page.getByTestId("results-elsewhere").locator('a[href^="/e/"]'))
        .or(page.getByTestId("results-partial").locator('a[href^="/e/"]')),
    ).toHaveCount(labels.hits.length);

    // The spoken region holds exactly the transcript episodes the label search
    // did NOT already return.
    //
    // 🚨 No `Math.min` against a cap any more, and that is the point: the cap
    // is now the page SIZE the API was asked for, so the region renders every
    // episode that came back. It used to be a second, smaller ceiling applied
    // after the fetch, which is how the page advertised 13 episodes and drew 6.
    const labelIds = new Set(labels.hits.map((hit) => hit.episode.youtube_id));
    const expectedSpoken = spoken.hits
      .map((hit) => hit.episode.youtube_id)
      .filter((id) => !labelIds.has(id));
    const spokenRegion = page.getByTestId("results-spoken").locator('a[href^="/e/"]');
    await expect(spokenRegion).toHaveCount(expectedSpoken.length);

    // And no episode is shown twice across the two regions.
    const shownTwice = (
      await spokenRegion.evaluateAll((links) =>
        links.map((link) => (link.getAttribute("href") ?? "").replace("/e/", "")),
      )
    ).filter((id) => labelIds.has(id));
    expect(shownTwice).toEqual([]);
  });

  const HOSTILE_QUERIES: { name: string; q: string }[] = [
    { name: "empty", q: "" },
    { name: "whitespace", q: "   " },
    { name: "a NUL byte", q: "a\u0000b" },
    { name: "an emoji", q: "🎙️🎧" },
    { name: "a script tag", q: "<script>alert(1)</script>" },
    { name: "a very long string", q: "я".repeat(2000) },
    { name: "a lone surrogate-ish sequence", q: "%F0%9F" },
    { name: "path traversal", q: "../../etc/passwd" },
  ];

  for (const { name, q } of HOSTILE_QUERIES) {
    test(`15.4 search survives ${name}`, async ({ page }) => {
      const response = await page.goto(`/search?q=${encodeURIComponent(q)}`);
      const status = response?.status() ?? 0;

      expect(status, `/search with ${name} returned ${status}`).toBeLessThan(500);
      await expectSingleVisibleH1(page);
    });
  }

  test("15.5 a script tag in the query is rendered as text, never executed", async ({
    page,
  }) => {
    // The query is echoed back into the results heading and the search box, so
    // it is user input rendered on a public page.
    let dialogOpened = false;
    page.on("dialog", async (dialog) => {
      dialogOpened = true;
      await dialog.dismiss();
    });

    await page.goto(`/search?q=${encodeURIComponent("<script>alert(1)</script>")}`);
    await expectSingleVisibleH1(page);

    expect(dialogOpened, "an injected script executed").toBe(false);
    expect(
      await page.locator("main script").count(),
      "the query was injected into the DOM as a real <script> element",
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 17. The allow-listed query params
// ---------------------------------------------------------------------------

/**
 * `/leaderboard?kind=` and `/channels/[slug]?score=` are matched against a fixed
 * set rather than forwarded, so a junk value must fall back to the default
 * instead of reaching the API. These are the two routes that were ALREADY safe
 * when `/episodes` and `/search` were not; this is what keeps them that way.
 */
test.describe("17. allow-listed params fall back rather than forward", () => {
  const CASES = [
    "/leaderboard?kind=nonsense",
    "/leaderboard?kind=%3Cscript%3E",
    "/leaderboard?kind=a%00b",
    "/leaderboard?kind=top&kind=elite",
    "/channels/ivan-kirkov?score=nonsense",
    "/channels/ivan-kirkov?score=a%00b",
    "/channels/ivan-kirkov?score=%27+OR+1%3D1--",
  ];

  for (const path of CASES) {
    test(`17.1 ${path} answers 200`, async ({ page }) => {
      const response = await page.goto(path);

      expect(response?.status(), `${path} returned ${response?.status()}`).toBe(200);
      await expectSingleVisibleH1(page);
    });
  }

  test("17.2 a junk score renders the PUBLIC grid, not an empty one", async ({
    page,
  }) => {
    // Falling back must mean "the default view", not "no view".
    await page.goto("/channels/ivan-kirkov?score=nonsense");

    await expect(
      page.getByRole("link", { name: copy.channel.publicScore, exact: true }),
    ).toHaveAttribute("aria-current", "true");
  });
});

// ---------------------------------------------------------------------------
// 16. Dynamic route params
// ---------------------------------------------------------------------------

test.describe("16. hostile route params", () => {
  const BAD_PATHS = [
    "/channels/" + encodeURIComponent("' OR '1'='1"),
    "/channels/" + encodeURIComponent("../../etc/passwd"),
    "/channels/" + encodeURIComponent("несъществуващ-канал"),
    "/channels/" + "a".repeat(400),
    "/e/" + encodeURIComponent("<script>"),
    "/e/" + encodeURIComponent("' OR '1'='1"),
    "/e/" + "b".repeat(400),
  ];

  test.use({
    allowedConsoleErrors: [
      // Navigating to a deliberately missing document makes Chrome log the
      // status it returned. That is the browser reporting the 404 these cases
      // are asserting, not an application error.
      /Failed to load resource: the server responded with a status of 4\d\d/,
    ],
  });

  for (const path of BAD_PATHS) {
    test(`16.1 ${path.slice(0, 48)} answers 404, never 500`, async ({ page }) => {
      const response = await page.goto(path);
      const status = response?.status() ?? 0;

      expect(
        status,
        `${path.slice(0, 60)} returned ${status}; a bad param must be a 404`,
      ).toBe(404);
    });
  }
});
