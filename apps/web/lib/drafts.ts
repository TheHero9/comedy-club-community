/**
 * Unsent composer text, kept in localStorage.
 *
 * 🚨 WHY THIS EXISTS. On 2026-08-20 two cast submissions left the browser with
 * no Authorization header, came back 401, and what the member had typed was
 * gone as soon as the tab moved on. `lib/api/client.ts` now refuses to send an
 * anonymous write at all - but a refused write is still a write that did not
 * happen, and the text must survive it. It must equally survive a dropped
 * connection, a 500, a reload, a phone killing the tab, and a member who taps
 * away mid-sentence and comes back an hour later.
 *
 * The rule this encodes: **the thing the member typed is never the thing that
 * pays for a failure.**
 *
 * Deliberately client-only, and deliberately not sent anywhere. A draft is
 * unsent by definition, so "keep it safe on the server" would be exactly the
 * write we could not do in the first place.
 *
 * 🔒 Every reader and writer is defensive. `localStorage` throws outright in
 * Safari private mode and when the origin quota is full, and a storage error
 * taking down the episode page would be this fix causing a worse bug than the
 * one it repairs. Every failure here degrades to "no draft", never to a throw.
 */

/** Namespaced so a draft cannot collide with `recent-searches` or the theme. */
const PREFIX = "podcast-index.draft.";

/**
 * Drafts older than this are dropped on read.
 *
 * Two weeks is long enough that a member who left a half-typed cast on Friday
 * still finds it after a holiday, and short enough that a phone is not carrying
 * a year of abandoned text nobody will ever finish.
 */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A single draft is capped, and the number of drafts is capped.
 *
 * ⚠️ Both caps exist because localStorage is a SHARED, small (~5 MB) quota for
 * the whole origin. An unbounded draft store does not fail by losing a draft -
 * it fails by making `setItem` throw for the theme, the locale and the recent
 * searches too. The cap is not about drafts being large; it is about drafts
 * never being the reason something else cannot be stored.
 */
const MAX_DRAFT_CHARS = 8_000;
const MAX_DRAFTS = 20;

interface StoredDraft {
  /** The composer's value, whatever shape that composer uses. */
  v: unknown;
  /** Epoch ms, for expiry and for evicting the oldest when over the cap. */
  at: number;
}

/**
 * Build a storage key.
 *
 * ⚠️ Scope every key to what the draft belongs to (`moment` + the episode id),
 * never to the composer type alone. A single `draft.moment` key would carry one
 * episode's half-typed label onto the next episode the member opens, which
 * reads as the site putting words in their mouth.
 */
export function draftKey(kind: string, ...scope: string[]): string {
  return PREFIX + [kind, ...scope].join(".");
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Every draft key currently stored, with its timestamp. Oldest first. */
function storedKeys(store: Storage): { key: string; at: number }[] {
  const found: { key: string; at: number }[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key === null || !key.startsWith(PREFIX)) continue;
    let at = 0;
    try {
      const parsed: unknown = JSON.parse(store.getItem(key) ?? "");
      if (parsed !== null && typeof parsed === "object" && "at" in parsed) {
        const stamp = (parsed as StoredDraft).at;
        if (typeof stamp === "number") at = stamp;
      }
    } catch {
      // Unreadable entry. `at: 0` makes it the first thing evicted, which is
      // the right answer for something we cannot restore anyway.
    }
    found.push({ key, at });
  }
  return found.sort((a, b) => a.at - b.at);
}

/**
 * The draft stored under `key`, or null.
 *
 * An expired draft is removed as it is read, so expiry costs nothing extra and
 * a key is never resurrected by a later read.
 */
export function readDraft<T>(key: string): T | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const draft = parsed as StoredDraft;
    if (typeof draft.at !== "number" || Date.now() - draft.at > MAX_AGE_MS) {
      store.removeItem(key);
      return null;
    }
    return draft.v as T;
  } catch {
    return null;
  }
}

/**
 * Store a draft, evicting the oldest if the store is at its cap.
 *
 * ⚠️ A value that serialises to more than `MAX_DRAFT_CHARS` is DROPPED rather
 * than truncated. Half a sentence restored as if it were the whole thing is
 * worse than an honest nothing - the member would submit it without noticing.
 */
export function writeDraft(key: string, value: unknown): void {
  const store = storage();
  if (store === null) return;
  try {
    const payload = JSON.stringify({ v: value, at: Date.now() } satisfies StoredDraft);
    if (payload.length > MAX_DRAFT_CHARS) return;

    const existing = storedKeys(store);
    if (!existing.some((entry) => entry.key === key)) {
      for (const stale of existing.slice(0, Math.max(0, existing.length - MAX_DRAFTS + 1))) {
        store.removeItem(stale.key);
      }
    }
    store.setItem(key, payload);
  } catch {
    // Quota exceeded or storage disabled. The composer still holds the value in
    // React state, so this only costs the member a reload - not their text.
  }
}

/** Forget a draft. Called on a successful submit and on an explicit discard. */
export function clearDraft(key: string): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(key);
  } catch {
    // Nothing useful to do, and nothing worth breaking a render over.
  }
}

/** Exported for the unit tests, which assert the caps rather than restating them. */
export const DRAFT_LIMITS = {
  prefix: PREFIX,
  maxAgeMs: MAX_AGE_MS,
  maxDraftChars: MAX_DRAFT_CHARS,
  maxDrafts: MAX_DRAFTS,
} as const;
