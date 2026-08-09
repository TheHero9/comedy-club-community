/**
 * Recent searches, kept in localStorage.
 *
 * Deliberately client-only and deliberately not sent anywhere: a search history
 * is a personal thing and this product has no reason to hold one server side.
 * Every reader is defensive because localStorage throws in private mode on some
 * browsers, and a thrown storage error must never take a page down.
 */
export const RECENT_SEARCHES_KEY = "podcast-index.recent-searches";

const MAX_RECENT = 6;

export function readRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberSearch(query: string): void {
  if (typeof window === "undefined") return;
  const next = query.trim();
  if (next.length === 0) return;
  try {
    const existing = readRecentSearches().filter(
      (item) => item.toLowerCase() !== next.toLowerCase(),
    );
    window.localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify([next, ...existing].slice(0, MAX_RECENT)),
    );
  } catch {
    // Storage unavailable. Losing a recent search is not worth surfacing.
  }
}
