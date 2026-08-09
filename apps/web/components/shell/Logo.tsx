import Link from "next/link";
import { Mic } from "lucide-react";

import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/** Red tile plus wordmark. The only place brand red appears as a surface. */
export function Logo({
  size = "sm",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const tile = size === "sm" ? "size-7" : "size-8";
  const icon = size === "sm" ? "size-4" : "size-[18px]";
  const word = size === "sm" ? "text-[13px]" : "text-[15px]";

  return (
    <Link
      href="/"
      aria-label={copy.nav.homeLink}
      className={cn("flex shrink-0 items-center gap-2.5", className)}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-md bg-primary text-primary-foreground",
          tile,
        )}
      >
        <Mic className={icon} aria-hidden strokeWidth={2.2} />
      </span>
      <span
        className={cn(
          "font-display font-bold tracking-[-0.01em] whitespace-nowrap text-foreground",
          word,
        )}
      >
        {copy.app.name}
      </span>
    </Link>
  );
}
