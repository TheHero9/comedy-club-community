/**
 * Matrix section 1 - route rendering (Lane A).
 *
 * Every public route must render real data from the live Django API. These are
 * deliberately cross-checked against `GET /api/...` rather than against copied
 * numbers: ratings and episode counts change, so a hardcoded expectation turns
 * into a false failure the first time someone rates something.
 *
 * `test` and `expect` come from ./fixtures, never from @playwright/test - the
 * fixture wires the console-error guard that fails a test whose page logged an
 * unexpected browser error. Those errors are invisible to typecheck, lint and
 * build.
 */
import type { Page } from "@playwright/test";

import type { Schema } from "@ccc/api-types";
import { LEADERBOARD_KINDS } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";

import { apiJson, expect, test } from "./fixtures";

type Channel = Schema<"ChannelOut">;
type EpisodeBrief = Schema<"EpisodeBriefOut">;
type EpisodeDetail = Schema<"EpisodeOut">;
type EpisodeList = Schema<"EpisodeListOut">;
type Health = Schema<"HealthOut">;
type SearchResults = Schema<"SearchOut">;

/** A Bulgarian query that is known to match content in the dev database. */
const BULGARIAN_QUERY = "Каспаров";

/** How many episodes `/episodes` renders before the load-more pill. */
const EPISODES_PAGE_SIZE = 9;

/**
 * Pick a real episode from the API instead of hardcoding an id, so the suite
 * survives a reseed.
 */
async function newestEpisode(page: Page): Promise<EpisodeBrief> {
  const list = await apiJson<EpisodeList>(page, "/api/episodes?limit=1&sort=newest");
  expect(
    list.items.length,
    "the dev database has no episodes, so there is nothing to render",
  ).toBeGreaterThan(0);
  return list.items[0]!;
}

async function firstChannel(page: Page): Promise<Channel> {
  const channels = await apiJson<Channel[]>(page, "/api/channels");
  expect(
    channels.length,
    "the dev database has no channels, so there is nothing to render",
  ).toBeGreaterThan(0);
  return channels[0]!;
}

/**
 * Deliberately a SECOND implementation of `formatDuration` from
 * lib/score-bands.ts. Importing the app helper would make the assertion agree
 * with itself even if the helper were wrong.
 */
function expectedDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/**
 * next/image rewrites a remote src to `/_next/image?url=<encoded>&w=...`.
 * Unwrap it so the assertion compares the real upstream URL.
 */
function upstreamImageUrl(src: string | null): string | null {
  if (!src) return null;
  if (!src.startsWith("/_next/image")) return src;
  return new URLSearchParams(src.split("?")[1] ?? "").get("url");
}

async function metaContent(page: Page, selector: string): Promise<string | null> {
  const tag = page.locator(selector);
  if ((await tag.count()) === 0) return null;
  return tag.first().getAttribute("content");
}

test("1.1 home page renders with real data", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  // The hero H1 is three lines, the third in brand red. `toHaveText` would
  // need the exact concatenation, so each line is asserted on its own.
  const hero = page.getByRole("heading", { level: 1 });
  await expect(hero).toContainText(copy.home.heroLine1);
  await expect(hero).toContainText(copy.home.heroLine2);
  await expect(hero).toContainText(copy.home.heroLine3);

  /**
   * 🚨 The home page is the SEARCH page (owner call, 2026-08-15). The
   * newest-episodes grid was removed, so this no longer asserts episode cards -
   * it asserts what the page is actually for now: a way to search, and every
   * channel listed below it.
   *
   * Deliberately NOT relaxed to "some link exists". Each of the two things the
   * page still promises is pinned separately, and the channel count is read
   * from the API so an empty render cannot pass.
   */
  // Scoped to `main`: the sticky header carries a second trigger with the same
  // accessible name, and this test is about the PAGE, not the chrome.
  await expect(
    page.locator("main").getByRole("button", { name: copy.search.trigger }),
  ).toBeVisible();

  const channels = await apiJson<Channel[]>(page, "/api/channels");
  expect(channels.length, "the dev database has no channels").toBeGreaterThan(0);
  for (const channel of channels) {
    await expect(
      page.locator(`main a[href="/channels/${encodeURIComponent(channel.slug)}"]`),
    ).toHaveCount(1);
  }

  /**
   * The top-rated rail is the one episode section left, and it renders only
   * when the leaderboard has entries. Asserting it unconditionally would fail
   * on a database with no ratings - which is exactly the state this one is in
   * after `seed_demo --clear`.
   */
  // `LEADERBOARD_KINDS.top` is the wire slug ("top_rated"), read from the same
  // constant the page uses so this cannot drift into a silent 404.
  const board = await apiJson<{ items: unknown[] }>(
    page,
    `/api/leaderboards/${LEADERBOARD_KINDS.top}?limit=5`,
  );
  if (board.items.length > 0) {
    expect(await page.locator('main a[href^="/e/"]').count()).toBeGreaterThan(0);
  }
});

test("1.2 channels page lists every channel the API returns", async ({ page }) => {
  const channels = await apiJson<Channel[]>(page, "/api/channels");
  expect(channels.length).toBeGreaterThan(0);

  const response = await page.goto("/channels");
  expect(response?.status()).toBe(200);

  for (const channel of channels) {
    // Located by its own link, not by name: one channel's description mentions
    // the other channel by name, so `hasText` matches two cards.
    const card = page
      .locator("main article")
      .filter({
        // Cyrillic slugs are percent-encoded in the rendered href, so the
        // comparison has to encode too or every Bulgarian channel misses.
        has: page.locator(
          `a[href="/channels/${encodeURIComponent(channel.slug)}"]`,
        ),
      });
    await expect(card, `no card for ${channel.slug}`).toHaveCount(1);
    await expect(card).toContainText(
      copy.channels.handleAndCount(channel.handle, channel.episode_count),
    );
    await expect(
      card.locator(`a[href="/channels/${encodeURIComponent(channel.slug)}"]`),
    ).toHaveCount(1);
  }
});

test("1.3 channel page renders name, episode count and the ratings grid", async ({
  page,
}) => {
  const channel = await firstChannel(page);

  const response = await page.goto(`/channels/${channel.slug}`);
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(channel.name);
  await expect(
    page.getByText(copy.channels.episodeCount(channel.episode_count)).first(),
  ).toBeVisible();


  // Grid presence only - every cell value is cross-checked in section 3. A
  // channel with at most 4 years ships both layouts, so this asserts on the one
  // CSS shows. The name used to be a <caption>; the flow grid is not a table,
  // so it carries the same string as the labelled region's accessible name.
  const grid = page.locator("[data-grid]").locator("visible=true");
  await expect(grid).toHaveCount(1);
  await expect(grid).toHaveAccessibleName(copy.channel.gridLabel(channel.name));
});

test("1.4 episodes page renders one card per episode, each linking to /e/", async ({
  page,
}) => {
  const list = await apiJson<EpisodeList>(
    page,
    `/api/episodes?limit=${EPISODES_PAGE_SIZE}&offset=0&sort=newest`,
  );
  expect(list.items.length).toBeGreaterThan(0);

  const response = await page.goto("/episodes");
  expect(response?.status()).toBe(200);

  const hrefs = await page
    .locator('main a[href^="/e/"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));

  expect(hrefs).toHaveLength(list.items.length);
  for (const href of hrefs) {
    expect(href).toMatch(/^\/e\/[^/?#]+$/);
  }
  expect([...hrefs].sort()).toEqual(
    list.items.map((item) => `/e/${item.youtube_id}`).sort(),
  );
});

/**
 * 1.4b - "Зареди още", and why deep pagination is no longer needed.
 *
 * The browse list previously used offset pagination with rel=prev/next so that
 * episodes past page one had crawlable URLs. The redesign replaces that with
 * the "Зареди още" pill the design specifies, which grows `limit` in the URL.
 *
 * That would orphan deep episodes IF browse were the only path to them. It is
 * not: the channel grid renders EVERY episode of a channel as an `<a href>` on
 * one page - 74 cells for one channel and 1,318 for the other - so every
 * episode already has a crawlable link from an indexable page. 3.3/3.4 walk
 * that matrix cell by cell. The test below pins the guarantee itself, so
 * removing it from the grid cannot silently un-index the archive.
 */
test("1.4b the load-more pill is a real link that widens the list", async ({ page }) => {
  const list = await apiJson<EpisodeList>(
    page,
    `/api/episodes?limit=${EPISODES_PAGE_SIZE}&offset=0&sort=newest`,
  );
  test.skip(
    !list.meta.has_more,
    "the dev database holds a single page of episodes, so there is nothing to load",
  );

  await page.goto("/episodes");
  const more = page.getByRole("link", { name: copy.browse.loadMore });
  await expect(more).toHaveAttribute("href", `/episodes?limit=${EPISODES_PAGE_SIZE * 2}`);

  await more.click();
  await page.waitForURL(/limit=/);
  const hrefs = await page
    .locator('main a[href^="/e/"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("href")));
  expect(hrefs.length).toBe(EPISODES_PAGE_SIZE * 2);
});

test("1.4c every episode of a channel is a crawlable link on its grid page", async ({
  page,
}) => {
  const channel = await firstChannel(page);
  const grid = await apiJson<{
    total_count: number;
    rows: Array<{ cells: Array<{ youtube_id: string } | null> }>;
  }>(page, `/api/channels/${channel.slug}/grid`);

  const expected = new Set(
    grid.rows.flatMap((row) =>
      row.cells.filter(Boolean).map((cell) => `/e/${cell!.youtube_id}`),
    ),
  );
  expect(expected.size).toBe(grid.total_count);

  await page.goto(`/channels/${channel.slug}`);
  const hrefs = new Set(
    await page
      .locator("[data-grid] a[href^='/e/']")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("href") ?? ""),
      ),
  );

  for (const href of expected) {
    expect(hrefs.has(href), `${href} is not linked from the grid`).toBe(true);
  }
});

test("1.4d the filter chips live in the URL, so a filtered view is shareable", async ({
  page,
}) => {
  const streams = await apiJson<EpisodeList>(page, "/api/episodes?kind=stream&limit=1");
  test.skip(streams.meta.total === 0, "no streams in the dev database");

  const response = await page.goto("/episodes?kind=stream");
  expect(response?.status()).toBe(200);

  await expect(
    page.getByText(copy.browse.showing(
      Math.min(EPISODES_PAGE_SIZE, streams.meta.total),
      streams.meta.total,
    )),
  ).toBeVisible();
});

test("1.5 episode page renders title, thumbnail and duration", async ({ page }) => {
  const brief = await newestEpisode(page);
  const episode = await apiJson<EpisodeDetail>(
    page,
    `/api/episodes/${brief.youtube_id}`,
  );

  const response = await page.goto(`/e/${episode.youtube_id}`);
  expect(response?.status()).toBe(200);

  // The title is Bulgarian. Comparing it to the API value also proves the
  // response was not mangled into mojibake on the way through.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(episode.title);

  const thumbnail = page.locator("main img").first();
  await expect(thumbnail).toBeVisible();
  expect(upstreamImageUrl(await thumbnail.getAttribute("src"))).toBe(
    episode.thumbnail_url,
  );

  expect(
    episode.duration_sec,
    "the fixture episode has no duration, so 1.5 cannot check the duration",
  ).toBeTruthy();
  await expect(
    page.getByText(expectedDuration(episode.duration_sec!), { exact: false }).first(),
  ).toBeVisible();
});

test("1.6 search page renders results for a Bulgarian query", async ({ page }) => {
  // Built with URLSearchParams, never a shell argument: Git Bash mangles
  // Cyrillic on the command line, which silently turns the query into `????????`.
  const results = await apiJson<SearchResults>(
    page,
    `/api/search?${new URLSearchParams({ q: BULGARIAN_QUERY, limit: "24" }).toString()}`,
  );
  expect(
    results.total,
    `"${BULGARIAN_QUERY}" matched nothing in the API, so the UI has nothing to render`,
  ).toBeGreaterThan(0);

  const response = await page.goto(
    `/search?q=${encodeURIComponent(BULGARIAN_QUERY)}`,
  );
  expect(response?.status()).toBe(200);

  await expect(
    page.getByText(copy.search.resultsFor(BULGARIAN_QUERY)),
  ).toBeVisible();
  // 🚨 The count moved OUT of the heading and into a summary line that names
  // what it counts. The heading used to carry the label-match total alone,
  // which printed "2 episodes" above eight cards on a query that also had
  // spoken matches.
  await expect(
    page.getByText(copy.search.summaryLabelled(results.total)).or(
      page.getByText(
        copy.search.summaryLabelledSplit(
          results.total_full,
          results.total - results.total_full,
        ),
      ),
    ),
  ).toBeVisible();
  expect(await page.locator('main a[href^="/e/"]').count()).toBeGreaterThan(0);
});

test("1.7 status page renders the API health card and its dependency rows", async ({
  page,
}) => {
  // apiJson asserts the response is ok, so reaching this line means the API is
  // up and the card must render dependency rows rather than the error state.
  const health = await apiJson<Health>(page, "/api/health");
  expect(health.status).toBeTruthy();

  const response = await page.goto("/status");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    copy.status.title,
  );
  await expect(page.getByText(copy.status.database)).toBeVisible();
  await expect(page.getByText(copy.status.redis)).toBeVisible();
});

test("1.8 every link in the site header resolves", async ({ page }) => {
  // The dev server compiles routes on demand, so a cold sweep is slow.
  test.slow();

  await page.goto("/");

  const hrefs = await page
    .locator("header a")
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute("href"))
        .filter((href): href is string => Boolean(href)),
    );

  const unique = [...new Set(hrefs)];
  expect(unique.length, "the header rendered no links at all").toBeGreaterThan(0);

  for (const href of unique) {
    const response = await page.goto(href);
    expect(response?.status(), `header link ${href} did not resolve`).toBe(200);
  }
});

test("1.9 an episode card links through to a real episode page", async ({ page }) => {
  await page.goto("/episodes");

  const card = page.locator('main a[href^="/e/"]').first();
  const href = await card.getAttribute("href");
  expect(href).toMatch(/^\/e\/[^/?#]+$/);

  await card.click();
  await page.waitForURL((url) => url.pathname === href);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  expect((await heading.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
});

test("1.10 home page exposes title and description metadata", async ({ page }) => {
  await page.goto("/");

  expect(await page.title()).toBe(copy.app.name);
  expect(await metaContent(page, 'meta[name="description"]')).toBe(
    copy.app.description,
  );
});

/**
 * Matrix row 1.10, Open Graph half.
 *
 * This shipped broken: `app/layout.tsx` declared `title` and `description` but
 * no `openGraph` block, and Next does NOT synthesise Open Graph tags from those.
 * Every share of the site root rendered a bare link preview - on a site whose
 * entire purpose is being discoverable. Nothing in typecheck, lint or build says
 * a word about it; only reading the rendered `<head>` does.
 */
test("1.10 home page exposes Open Graph and Twitter card tags", async ({ page }) => {
  await page.goto("/");

  expect(await metaContent(page, 'meta[property="og:title"]')).toBe(copy.app.name);
  expect(await metaContent(page, 'meta[property="og:description"]')).toBe(
    copy.app.description,
  );
  expect(await metaContent(page, 'meta[property="og:type"]')).toBe("website");
  expect(await metaContent(page, 'meta[name="twitter:card"]')).toBe(
    "summary_large_image",
  );
});

test("1.11 episode page uses the YouTube thumbnail as its OG image", async ({
  page,
}) => {
  const brief = await newestEpisode(page);
  const episode = await apiJson<EpisodeDetail>(
    page,
    `/api/episodes/${brief.youtube_id}`,
  );
  expect(episode.thumbnail_url).toBeTruthy();

  await page.goto(`/e/${episode.youtube_id}`);

  // Thumbnails are a derived Google CDN URL, never an upload. The OG image must
  // be that same URL - if it ever points at our own host, something started
  // mirroring images.
  expect(await metaContent(page, 'meta[property="og:image"]')).toBe(
    episode.thumbnail_url,
  );
  expect(episode.thumbnail_url).toContain(episode.youtube_id);

  expect(await metaContent(page, 'meta[property="og:title"]')).toBe(episode.title);
});
