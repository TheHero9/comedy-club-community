import type { MetadataRoute } from "next";

import { SITE_URL, absoluteUrl } from "@/lib/site";

/**
 * 🚨 There was no robots.txt at all until 2026-08-16 - `/robots.txt` was a live
 * 404 on a site whose entire stated value is being findable. This is the file
 * that points a crawler at the sitemap; without it Google discovers ~1,961
 * episode pages only by walking internal links, slowly, deepest pages last.
 *
 * Everything public is allowed, because everything public is the product. The
 * disallow list is only the paths that are private, per-viewer, or infinite:
 *
 * - `/me`      is the signed-in area. The API returns 401 to a crawler anyway,
 *              so indexing it can only ever produce a page of empty states.
 * - `/search`  is `force-dynamic` and takes free-text `?q=`, so it is an
 *              unbounded URL space. Every crawl of it is a real Meilisearch
 *              round trip, and the results are already reachable through the
 *              episode pages the sitemap lists directly. This is the one entry
 *              here that is about COST as much as about relevance.
 * - `/status`  is an operational health page, not content.
 *
 * ⚠️ Deliberately NOT disallowed: `/e/`, `/channels/` and `/episodes`. Those are
 * the whole catalogue and the reason this file exists.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/me", "/me/", "/search", "/status"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
