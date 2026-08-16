/**
 * The site's own public origin.
 *
 * 🚨 Needed by three things that CANNOT use a relative URL: `robots.ts` (the
 * `Sitemap:` line must be absolute per the robots.txt spec), `sitemap.ts` (a
 * `<loc>` must be absolute per the sitemaps protocol), and `metadataBase` in
 * the root layout, without which Next resolves every canonical and Open Graph
 * URL against `localhost:3000` and warns at build time.
 *
 * Read straight off `process.env` so Next can inline it; `NEXT_PUBLIC_` because
 * `metadataBase` is evaluated in the client bundle's module graph too.
 *
 * ⚠️ The fallback is the real production origin rather than localhost. This
 * value only ever reaches a crawler or a link preview, and a sitemap full of
 * `http://localhost:3000` URLs shipped to Google is a far worse failure than a
 * local build advertising the production host in a file nobody reads locally.
 */
const FALLBACK_SITE_URL = "https://comedycommunity.club";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE_URL
).replace(/\/+$/, "");

/** Absolute URL for a site-relative path, for sitemap and metadata use. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
