import type { MetadataRoute } from "next";

import { listChannels, listEpisodes } from "@/lib/api/podcast";
import { absoluteUrl } from "@/lib/site";

/**
 * Every indexable URL on the site.
 *
 * 🚨 There was no sitemap at all until 2026-08-16. On a catalogue of ~1,961
 * episodes whose stated core value is searchability, that meant Google found
 * episode pages only by crawling internal links - and the deep ones (an episode
 * from 2019, reachable only by paging a channel grid) effectively never.
 *
 * 🚨 PAGED, because `/api/episodes` caps `limit` at 100 (`MAX_LIMIT`). Asking
 * for 2,000 in one call is a 422, which is the exact drift that broke
 * `/me/people`'s "load more". The first request doubles as the count: its
 * `meta.total` says how many more offset pages are needed, and they are then
 * fetched in parallel.
 *
 * 🚨 `force-dynamic`, AND THAT IS LOAD-BEARING - it is not a caching preference.
 *
 * A sitemap route is STATIC by default, so Next prerenders it during `next
 * build`. Every page in this app is already dynamic (reading the locale cookie
 * makes them so), which means this was the ONLY route that fetched the API at
 * build time - and CI builds with no API running, because CI has no ingested
 * corpus. So the first push broke the build outright:
 *
 *     Error: connect ECONNREFUSED 127.0.0.1:8000
 *     Export encountered an error on /sitemap.xml/route, exiting the build.
 *
 * ⚠️ The original version of this comment argued the opposite - that it should
 * throw, "like every other prerendered page here". There are no other
 * prerendered pages here. The claim was wrong and CI caught it; a local build
 * could not, because the API was up.
 *
 * Generating per-request is also simply more correct: the sitemap then reflects
 * the catalogue as it is now rather than as it was at deploy time, so a newly
 * ingested episode is listed without a redeploy. The ~19 API calls stay cheap
 * because `PUBLIC_CACHE` keeps the underlying fetches in the data cache for 60s,
 * so a burst of crawler hits shares one set of responses.
 *
 * ✅ Still deliberately NOT wrapped in a try/catch. If the API is down the
 * sitemap should 500, not quietly serve six static routes - a response that
 * looks healthy while de-listing the entire catalogue is the "reports success,
 * serves the old thing" failure this project keeps hitting. The difference is
 * that it now fails a REQUEST, which is recoverable, instead of a BUILD.
 */
export const dynamic = "force-dynamic";


/** The API's own per-request ceiling (`MAX_LIMIT` in `podcast/api/public.py`). */
const API_MAX_LIMIT = 100;

/**
 * Refuse to emit more than this many episode URLs.
 *
 * A sitemap file is capped at 50,000 URLs by the protocol, and the catalogue is
 * ~1,961. This is a guard against a runaway `meta.total`, not a real limit - if
 * it is ever hit, the sitemap needs splitting via `generateSitemaps`.
 */
const MAX_EPISODE_URLS = 45_000;

/** ISO date -> Date, for `lastModified`. Null upload dates fall back to now. */
function modifiedAt(uploadDate: string | null): Date {
  if (!uploadDate) return new Date();
  const parsed = new Date(uploadDate);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 🚨 `/search` and `/me` are absent on purpose, and `robots.ts` disallows
  // both. `/status` is operational, not content.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/episodes"), changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/channels"), changeFrequency: "weekly", priority: 0.8 },
    { url: absoluteUrl("/leaderboard"), changeFrequency: "daily", priority: 0.7 },
  ];

  const [channels, firstPage] = await Promise.all([
    listChannels(),
    listEpisodes({ limit: API_MAX_LIMIT, offset: 0, sort: "newest" }),
  ]);

  const channelRoutes: MetadataRoute.Sitemap = channels.map((channel) => ({
    url: absoluteUrl(`/channels/${encodeURIComponent(channel.slug)}`),
    changeFrequency: "daily",
    priority: 0.8,
  }));

  const total = Math.min(firstPage.meta.total, MAX_EPISODE_URLS);
  const remainingPages = Math.max(
    0,
    Math.ceil((total - API_MAX_LIMIT) / API_MAX_LIMIT),
  );

  const laterPages = await Promise.all(
    Array.from({ length: remainingPages }, (_, index) =>
      listEpisodes({
        limit: API_MAX_LIMIT,
        offset: (index + 1) * API_MAX_LIMIT,
        sort: "newest",
      }),
    ),
  );

  const episodes = [firstPage, ...laterPages].flatMap((page) => page.items);

  const episodeRoutes: MetadataRoute.Sitemap = episodes.map((episode) => ({
    // `/e/[youtubeId]` - the youtube id IS the external key, and the slug is
    // not in the URL, so nothing here goes stale when a title is corrected.
    url: absoluteUrl(`/e/${encodeURIComponent(episode.youtube_id)}`),
    lastModified: modifiedAt(episode.upload_date),
    changeFrequency: "weekly",
    // Ratings, labels and moments accumulate on an episode page over time, but
    // a single episode is still a leaf next to the browse routes above.
    priority: 0.6,
  }));

  return [...staticRoutes, ...channelRoutes, ...episodeRoutes];
}
