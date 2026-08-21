/**
 * Section 15 - unsent composer text (`lib/drafts.ts`).
 *
 * 🚨 What these pin, and why the file exists at all: on 2026-08-20 two cast
 * submissions came back 401 and the member's typed cast was gone. The API-side
 * half of the fix is section 4.20-4.23 in `api-client.spec.ts`; this half is the
 * promise that the TEXT outlives any failure at all.
 *
 * Vitest runs in the node environment with no jsdom, so there is no
 * `localStorage`. Each test installs a minimal in-memory one - which is also
 * how the "storage throws" rows are possible, and those are the rows that
 * matter most: a draft store that takes the page down when Safari private mode
 * refuses `setItem` would be a worse bug than the one it repairs.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearDraft, draftKey, DRAFT_LIMITS, readDraft, writeDraft } from "@/lib/drafts";

/** The smallest thing that satisfies the `Storage` calls `drafts.ts` makes. */
function memoryStorage(overrides: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>();
  const store: Storage = {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    ...overrides,
  };
  return store;
}

function install(storage: Storage | (() => never)): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: typeof storage === "function" ? { get localStorage() { return storage(); } } : { localStorage: storage },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
});

describe("15.1 keys", () => {
  beforeEach(() => install(memoryStorage()));

  it("15.1 scopes a key to what the draft belongs to, not just the composer", () => {
    // 🚨 The whole point. A key of "moment" alone would carry a half-typed
    // label from one episode onto the next episode the member opens.
    expect(draftKey("moment", "uA41ekQ4IEE")).not.toBe(draftKey("moment", "WfzkZLc6zbY"));
    expect(draftKey("moment", "uA41ekQ4IEE")).toContain(DRAFT_LIMITS.prefix);
  });

  it("15.2 namespaces every key, so a draft cannot collide with another feature", () => {
    // `recent-searches` and the theme live in the same origin-wide store.
    expect(draftKey("cast", "abc").startsWith(DRAFT_LIMITS.prefix)).toBe(true);
  });
});

describe("15.3 round trip", () => {
  beforeEach(() => install(memoryStorage()));

  it("15.3 returns exactly what was stored, including Cyrillic", () => {
    const key = draftKey("moment", "uA41ekQ4IEE");
    writeDraft(key, { time: "1:07:24", label: "Иван деменция в колата" });
    expect(readDraft(key)).toEqual({ time: "1:07:24", label: "Иван деменция в колата" });
  });

  it("15.4 returns null for a key that was never written", () => {
    expect(readDraft(draftKey("moment", "nothing-here"))).toBeNull();
  });

  it("15.5 clearDraft forgets it", () => {
    const key = draftKey("moment", "uA41ekQ4IEE");
    writeDraft(key, { label: "x" });
    clearDraft(key);
    expect(readDraft(key)).toBeNull();
  });

  it("15.6 keeps drafts for different scopes apart", () => {
    const a = draftKey("moment", "AAA");
    const b = draftKey("moment", "BBB");
    writeDraft(a, { label: "first" });
    writeDraft(b, { label: "second" });
    expect(readDraft(a)).toEqual({ label: "first" });
    expect(readDraft(b)).toEqual({ label: "second" });
  });
});

describe("15.7 expiry and caps", () => {
  beforeEach(() => install(memoryStorage()));

  it("15.7 drops a draft past MAX_AGE and removes the key as it reads", () => {
    const storage = memoryStorage();
    install(storage);
    const key = draftKey("moment", "old");
    const stale = Date.now() - DRAFT_LIMITS.maxAgeMs - 1;
    storage.setItem(key, JSON.stringify({ v: { label: "ancient" }, at: stale }));

    expect(readDraft(key)).toBeNull();
    // Removed on read, so a later read cannot resurrect it.
    expect(storage.getItem(key)).toBeNull();
  });

  it("15.8 keeps a draft that is old but not expired", () => {
    const storage = memoryStorage();
    install(storage);
    const key = draftKey("moment", "recent");
    storage.setItem(
      key,
      JSON.stringify({ v: { label: "still good" }, at: Date.now() - DRAFT_LIMITS.maxAgeMs + 60_000 }),
    );
    expect(readDraft(key)).toEqual({ label: "still good" });
  });

  it("15.9 DROPS an oversized draft rather than truncating it", () => {
    // 🚨 Half a sentence restored as though it were the whole thing is worse
    // than an honest nothing - the member would submit it without noticing.
    const key = draftKey("moment", "huge");
    writeDraft(key, { label: "я".repeat(DRAFT_LIMITS.maxDraftChars) });
    expect(readDraft(key)).toBeNull();
  });

  it("15.10 evicts the oldest once the store is at its cap", () => {
    const storage = memoryStorage();
    install(storage);

    // Distinct timestamps, oldest first, so eviction order is well defined.
    for (let index = 0; index < DRAFT_LIMITS.maxDrafts; index += 1) {
      storage.setItem(
        draftKey("moment", `ep${index}`),
        // 🚨 RECENT stamps, ordered oldest-first. An earlier draft of this test
        // used `1_000 + index` - epoch 1970 - so every entry read as EXPIRED
        // and the eviction assertion passed without eviction ever happening.
        JSON.stringify({
          v: { label: `n${index}` },
          at: Date.now() - (DRAFT_LIMITS.maxDrafts - index) * 1_000,
        }),
      );
    }
    expect(storage.length).toBe(DRAFT_LIMITS.maxDrafts);

    writeDraft(draftKey("moment", "newest"), { label: "newest" });

    expect(storage.length).toBe(DRAFT_LIMITS.maxDrafts);
    expect(readDraft(draftKey("moment", "ep0"))).toBeNull();
    expect(readDraft(draftKey("moment", "newest"))).toEqual({ label: "newest" });
    // The cap is about total storage pressure, so it must not evict anything
    // it did not have to.
    expect(readDraft(draftKey("moment", "ep1"))).toEqual({ label: "n1" });
  });

  it("15.11 overwriting an existing key evicts nothing", () => {
    const storage = memoryStorage();
    install(storage);
    for (let index = 0; index < DRAFT_LIMITS.maxDrafts; index += 1) {
      storage.setItem(
        draftKey("moment", `ep${index}`),
        // 🚨 RECENT stamps, ordered oldest-first. An earlier draft of this test
        // used `1_000 + index` - epoch 1970 - so every entry read as EXPIRED
        // and the eviction assertion passed without eviction ever happening.
        JSON.stringify({
          v: { label: `n${index}` },
          at: Date.now() - (DRAFT_LIMITS.maxDrafts - index) * 1_000,
        }),
      );
    }
    writeDraft(draftKey("moment", "ep0"), { label: "edited" });
    expect(storage.length).toBe(DRAFT_LIMITS.maxDrafts);
    expect(readDraft(draftKey("moment", "ep0"))).toEqual({ label: "edited" });
  });
});

describe("15.12 storage that fights back", () => {
  it("15.12 survives localStorage throwing on access (Safari private mode)", () => {
    install(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    const key = draftKey("moment", "x");
    expect(() => writeDraft(key, { label: "y" })).not.toThrow();
    expect(readDraft(key)).toBeNull();
    expect(() => clearDraft(key)).not.toThrow();
  });

  it("15.13 survives a full quota on setItem", () => {
    install(
      memoryStorage({
        setItem: () => {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        },
      }),
    );
    expect(() => writeDraft(draftKey("moment", "x"), { label: "y" })).not.toThrow();
  });

  it("15.14 survives a corrupt entry instead of throwing it at the render", () => {
    const storage = memoryStorage();
    install(storage);
    const key = draftKey("moment", "corrupt");
    storage.setItem(key, "{not json");
    expect(readDraft(key)).toBeNull();
  });

  it("15.15 ignores an entry with no timestamp rather than trusting it forever", () => {
    const storage = memoryStorage();
    install(storage);
    const key = draftKey("moment", "no-stamp");
    storage.setItem(key, JSON.stringify({ v: { label: "when?" } }));
    expect(readDraft(key)).toBeNull();
  });

  it("15.16 is a no-op on the server, where there is no window at all", () => {
    // No `install()` here: this is the server render path.
    const key = draftKey("moment", "ssr");
    expect(() => writeDraft(key, { label: "x" })).not.toThrow();
    expect(readDraft(key)).toBeNull();
  });
});
