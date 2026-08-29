/**
 * Recently opened episodes, kept in localStorage.
 *
 * The problem this solves is concrete: someone starts a podcast, closes the
 * app, hears a good moment - and the only ways back to the episode were the
 * search bar or having marked it watched in advance. Opening an episode page
 * IS the signal, so the page records itself here and the search overlay offers
 * the most recent few as one-tap re-entries.
 *
 * Deliberately client-only, per device, and never sent anywhere - same rule as
 * recent searches: what someone opened is theirs. Every reader is defensive
 * because localStorage throws in private mode on some browsers, and a thrown
 * storage error must never take a page down.
 */
export const RECENT_EPISODES_KEY = "podcast-index.recent-episodes";

/** Stored depth. More than shown, so a mis-tapped fourth is not lost forever. */
const MAX_RECENT_EPISODES = 8;

/** How many the search overlay renders (owner ask: the three most recent). */
export const RECENT_EPISODES_SHOWN = 3;

export interface RecentEpisode {
  youtubeId: string;
  title: string;
  channelName: string;
}

function isRecentEpisode(value: unknown): value is RecentEpisode {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.youtubeId === "string" &&
    item.youtubeId.length > 0 &&
    typeof item.title === "string" &&
    typeof item.channelName === "string"
  );
}

export function readRecentEpisodes(): RecentEpisode[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_EPISODES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentEpisode).slice(0, MAX_RECENT_EPISODES);
  } catch {
    return [];
  }
}

export function rememberEpisode(entry: RecentEpisode): void {
  if (typeof window === "undefined") return;
  if (!entry.youtubeId || !entry.title) return;
  try {
    // Deduped by id so a reopened episode moves to the front instead of
    // filling the whole list with itself.
    const existing = readRecentEpisodes().filter(
      (item) => item.youtubeId !== entry.youtubeId,
    );
    window.localStorage.setItem(
      RECENT_EPISODES_KEY,
      JSON.stringify([entry, ...existing].slice(0, MAX_RECENT_EPISODES)),
    );
  } catch {
    // Storage unavailable. Losing a recent entry is not worth surfacing.
  }
}
