"use client";

import { useSyncExternalStore } from "react";

/** No store to subscribe to: the answer only ever changes once, at hydration. */
const subscribe = () => () => {};

/**
 * True once the component has hydrated in the browser, false during the server
 * render and the first client render.
 *
 * This exists because "read something the server cannot know" (the stored
 * theme, `localStorage`, `window.matchMedia`) is a guaranteed hydration
 * mismatch unless the first client render matches the server's.
 *
 * ⚠️ Deliberately NOT `useState(false)` + `useEffect(() => setMounted(true))`.
 * That is the familiar shape, but it schedules a second render pass through
 * setState, which `react-hooks/set-state-in-effect` flags and the React
 * compiler cannot optimise. `useSyncExternalStore` expresses the same idea as
 * what it actually is - a value that differs between server and client
 * snapshots - with no state and no effect.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
