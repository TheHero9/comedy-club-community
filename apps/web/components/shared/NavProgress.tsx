"use client";

import { useLinkStatus } from "next/link";

/**
 * A top-of-viewport progress bar that appears while a link is navigating.
 *
 * 🚨 WHY IT EXISTS. `loading.tsx` fixes the routes that can have one, but three
 * of this site's routes cannot: `/e/[youtubeId]`, `/channels/[slug]` and
 * `/me/[list]` all call `notFound()`, and a Suspense boundary above them
 * flushes a 200 shell first and turns every dead link into a soft 404. Those
 * are also the most-clicked links on the site, so without this they stayed in
 * the state the owner described: "you click something and you don't have any
 * indication, it feels like nothing happened".
 *
 * 🚨 MUST BE RENDERED INSIDE A `<Link>`. `useLinkStatus` reads the pending
 * state from the nearest Link ancestor and returns `{pending: false}` anywhere
 * else - so this cannot be mounted once in the layout. Rendering it in several
 * links is fine: only the pending one animates, and Next tracks only the LAST
 * link clicked.
 *
 * `position: fixed` so it never affects the card it sits inside, and the CSS
 * (globals.css, `.nav-progress`) starts it invisible with a 120ms animation
 * delay - a navigation that resolves faster than that shows nothing at all
 * rather than flashing.
 */
export function NavProgress() {
  const { pending } = useLinkStatus();
  return <span aria-hidden data-pending={pending || undefined} className="nav-progress" />;
}
