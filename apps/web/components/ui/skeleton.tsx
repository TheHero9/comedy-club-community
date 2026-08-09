import { cn } from "@/lib/utils";

/**
 * 🚨 Opacity pulse only, never a moving gradient.
 *
 * A sweep travelling across a grid of 20 cards reads as the page loading 20
 * separate times. One synchronised 1200ms 0.5-to-1 opacity pulse reads as one
 * page loading once. `prefers-reduced-motion` kills the animation entirely in
 * globals.css and leaves a static block.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-pulse rounded-lg bg-elevated", className)}
      {...props}
    />
  );
}

export { Skeleton };
