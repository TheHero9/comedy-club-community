"use client";

import Link from "next/link";
import { Mic } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

/**
 * The brand mark: a red tile, and nothing else.
 *
 * 🚨 The wordmark is deliberately gone (owner call, 2026-08-15). It was the only
 * thing pushing the desktop search field narrow, and on mobile it competed with
 * the nav for a 390px bar. The mark alone still returns home, and the
 * accessible name carries what the removed text used to say - so this is a
 * visual removal, not a semantic one.
 *
 * The red tile stays: it is the only place brand red appears as a surface.
 */
export function Logo({
  size = "sm",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const copy = useCopy();
  const tile = size === "sm" ? "size-7" : "size-8";
  const icon = size === "sm" ? "size-4" : "size-[18px]";

  return (
    <Link
      href="/"
      aria-label={copy.nav.homeLink}
      className={cn("flex shrink-0 items-center", className)}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-md bg-primary text-primary-foreground",
          tile,
        )}
      >
        <Mic className={icon} aria-hidden strokeWidth={2.2} />
      </span>
    </Link>
  );
}
