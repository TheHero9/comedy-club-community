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
 *
 * 🤖 AI TRAINING crawlers are shut out entirely (2026-10-30). In the week before
 * production was switched off they were essentially ALL of the traffic - ~5,000
 * API calls a day, every one a server render plus 5-6 API round trips - and
 * they bring no reader back. The AI SEARCH agents are deliberately NOT on the
 * list (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User,
 * PerplexityBot, DuckAssistBot): they fetch a page to answer a person's
 * question and cite it, which is a way to be found, and they fall under `*`.
 *
 * ⚠️ robots.txt is a request, not a wall. Bytespider in particular is known to
 * ignore it; the Vercel Firewall's bot rules are the enforcement if one keeps
 * coming.
 */
const AI_TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Bytespider",
  "Meta-ExternalAgent",
  "Amazonbot",
  "Google-Extended",
  "Applebot-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/me", "/me/", "/search", "/status"],
      },
      { userAgent: AI_TRAINING_CRAWLERS, disallow: "/" },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
