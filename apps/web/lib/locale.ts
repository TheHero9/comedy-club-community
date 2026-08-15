/**
 * Server-side locale resolution.
 *
 * 🚨 Reading a cookie makes a route DYNAMIC. That is a deliberate, priced
 * trade-off, recorded in specs/11-ux-feedback/01-backlog.md:
 *
 * - The alternative that keeps ISR is an `app/[locale]/` segment plus a proxy
 *   rewrite. It is the textbook answer, but it moves all 13 route files and
 *   puts the repo's hard-won `notFound()` behaviour at risk. Rejected on risk.
 * - The alternative that keeps ISR *and* costs nothing is a client-side swap
 *   after hydration, the way `next-themes` handles dark mode. It does not work
 *   here: this app is Server-Component-first, and a Server Component cannot
 *   re-render on the client, so half of every page would stay English.
 *
 * What this does NOT cost is API traffic. `lib/api/podcast.ts` carries its own
 * `PUBLIC_CACHE = { next: { revalidate: 60 } }` at the fetch layer, so the
 * upstream round trips stay cached exactly as they were. Only the HTML render
 * moves from cached to per-request.
 *
 * ⚠️ Server Components only. `next/headers` throws in a Client Component - use
 * `useCopy()` from `components/i18n/LocaleProvider` there.
 */
import { cookies } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  getDictionary,
  isLocale,
  type Copy,
  type Locale,
} from "@/lib/copy";

/** The viewer's locale, defaulting to English. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * The dictionary for this request.
 *
 * Assign it to a local named `copy` so `tests/copy.spec.ts` keeps resolving the
 * `copy.<key>` references it scans for:
 *
 *     const copy = await getCopy();
 */
export async function getCopy(): Promise<Copy> {
  return getDictionary(await getLocale());
}

/** `<html lang>`. Bulgarian content is served under both, so this is the CHROME. */
export function htmlLang(locale: Locale): string {
  return locale === "bg" ? "bg" : "en";
}

/** Open Graph wants a territory, not a bare language. */
export function openGraphLocale(locale: Locale): string {
  return locale === "bg" ? "bg_BG" : "en_GB";
}
