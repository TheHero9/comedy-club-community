"use client";

import { useLinkStatus } from "next/link";

import { cn } from "@/lib/utils";

/**
 * A busy marker for the Link it is rendered inside.
 *
 * 🚨 Why this exists: several routes on this site are `force-dynamic` or read
 * the locale cookie, so following a link is a real server round trip. Until
 * this, nothing acknowledged the click - a topic chip, a filter and a sort all
 * looked inert for a few hundred milliseconds, and the owner read that silence
 * as the app being broken rather than busy.
 *
 * `useLinkStatus` is Next's own primitive for this (16.x). It reports the
 * pending state of the ENCLOSING Link, which is why this is a child component
 * rather than a hook the link's parent calls: a parent has no way to ask about
 * a specific link.
 *
 * ⚠️ It returns `pending: false` on a link that resolves instantly, so a
 * prefetched or static route shows nothing at all. That is the intended
 * behaviour - a spinner that flashes on every fast navigation is worse than no
 * spinner - and it is why this is not gated behind a delay of its own.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return (
    <span
      // Presentational only. The destination page announces itself on arrival,
      // and an aria-live region firing on every chip tap would be noise.
      aria-hidden
      className={cn(
        "size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70",
        className,
      )}
    />
  );
}
