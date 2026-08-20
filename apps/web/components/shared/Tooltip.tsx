import { cn } from "@/lib/utils";

/**
 * The name of an icon-only control, shown on hover and on keyboard focus.
 *
 * 🚨 CSS ONLY - no state, no timer, no portal. A JS tooltip here would mean a
 * listener per row on lists that already render a control per proposal, and
 * every one of them would have to be torn down correctly. `group-hover` and
 * `group-focus-within` do the same job with nothing to leak.
 *
 * 🚨 `hidden` when closed, NOT `opacity-0`. An absolutely positioned element
 * still contributes to `scrollWidth` while it is transparent, so a permanently
 * mounted label on a right-edge icon would widen the document and give the
 * whole page a horizontal scrollbar - the exact failure `ios-safari.spec.ts`
 * 14.4 exists to catch, and it would have been invisible on screen.
 *
 * ⚠️ HOVER IS A POINTER BEHAVIOUR. On a phone there is nothing to hover, so the
 * label never appears - which is why the trigger must always carry its own
 * accessible name (`aria-label`, or an `sr-only` span). The bubble is
 * `aria-hidden` precisely so it does not announce that name a second time.
 */
export function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
  className,
}: {
  label: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
  /**
   * Which edge the bubble is anchored to. `end` for a control sitting at the
   * right of a row, so the label grows inwards instead of off the screen.
   */
  align?: "center" | "start" | "end";
  className?: string;
}) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        aria-hidden
        className={cn(
          "pointer-events-none absolute z-50 hidden max-w-[220px] rounded-md border border-border-2 bg-elevated px-2 py-1 text-center text-[11.5px] leading-tight font-medium text-foreground shadow-floating",
          "group-hover/tip:block group-focus-within/tip:block",
          side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "start" && "left-0",
          align === "end" && "right-0",
        )}
      >
        {label}
      </span>
    </span>
  );
}
