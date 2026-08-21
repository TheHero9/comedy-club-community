"use client";

import { useCallback, useState } from "react";

import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { useHydrated } from "@/lib/use-hydrated";

interface DraftHandle<T> {
  /** Current composer value: the restored draft after hydration, else `empty`. */
  value: T;
  /** Set the value and persist it. Use this in place of the composer's setState. */
  setValue: (next: T) => void;
  /** True when this value came back from storage rather than being typed now. */
  restored: boolean;
  /**
   * Stop reporting `restored` while KEEPING the stored draft.
   *
   * This is what "close the form but do not throw my text away" needs. Without
   * it, a composer that opens itself because `restored` is true can never be
   * closed again except by discarding - the one outcome this whole module
   * exists to avoid.
   */
  acknowledge: () => void;
  /** Reset to `empty` and forget the stored draft. Call on a successful submit. */
  clear: () => void;
}

/**
 * A composer value that survives a failed submit, a reload and a closed tab.
 *
 * 🚨 RESTORED DURING RENDER, NEVER IN AN EFFECT. `react-hooks/set-state-in-effect`
 * is an error in this repo, and the familiar
 * `useEffect(() => setValue(readDraft()))` is exactly the shape it bans. What
 * this does instead is React's sanctioned "adjust state during render": the
 * branch is conditional and converges after one pass, because the update writes
 * the key it just compared against.
 *
 * 🚨 GATED ON `useHydrated()`, because `localStorage` is the definition of
 * something the server cannot know. Reading it during the first client render
 * would produce markup that differs from the server's and silently break
 * hydration for the whole subtree - the same class of failure as reading the
 * stored theme directly.
 *
 * ⚠️ `key` must be scoped to the thing being drafted (see `draftKey`). When it
 * changes - the member navigates from one episode to another - the value is
 * re-read for the new key rather than carried over.
 *
 * @param key    storage key, from `draftKey(...)`
 * @param empty  the value meaning "nothing typed yet"
 * @param isEmpty optional predicate; when a value is empty the draft is REMOVED
 *                rather than stored, so an emptied form does not resurrect
 *                itself as a blank draft on the next visit.
 */
export function useDraft<T>(
  key: string,
  empty: T,
  isEmpty?: (value: T) => boolean,
): DraftHandle<T> {
  const hydrated = useHydrated();
  const [state, setState] = useState<{ key: string | null; value: T; restored: boolean }>({
    key: null,
    value: empty,
    restored: false,
  });

  if (hydrated && state.key !== key) {
    const stored = readDraft<T>(key);
    setState({ key, value: stored ?? empty, restored: stored !== null });
  }

  const setValue = useCallback(
    (next: T) => {
      setState({ key, value: next, restored: false });
      if (isEmpty?.(next) === true) {
        clearDraft(key);
      } else {
        writeDraft(key, next);
      }
    },
    [key, isEmpty],
  );

  const acknowledge = useCallback(() => {
    setState((current) => (current.restored ? { ...current, restored: false } : current));
  }, []);

  const clear = useCallback(() => {
    setState({ key, value: empty, restored: false });
    clearDraft(key);
  }, [key, empty]);

  return { value: state.value, setValue, restored: state.restored, acknowledge, clear };
}
