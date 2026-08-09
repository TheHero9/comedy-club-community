import { cn } from "@/lib/utils";

/**
 * Every empty state in this product is written copy, never a generic "No data".
 *
 * Sparse episodes are the common case, not an edge case: 22% are unrated, many
 * have no moments, no topics and a 44-character description. The page keeps
 * every section slot and turns each empty one into an invitation, rather than
 * collapsing into a different, shorter layout.
 *
 * `dashed` is the in-section variant (an empty Moments block on an episode
 * page); `card` is the standalone one (zero search results, filtered-out
 * browse).
 */
interface EmptyStateProps {
  title: string;
  body: string;
  action?: React.ReactNode;
  variant?: "dashed" | "card";
  /**
   * Render the title as the page's `<h1>`. Zero-result pages are still pages:
   * they need exactly one h1, and the honest one is the thing that happened
   * ("Нищо не съвпада"), not a heading invented to satisfy a rule.
   */
  titleAs?: "p" | "h1";
  className?: string;
}

export function EmptyState({
  title,
  body,
  action,
  variant = "dashed",
  titleAs: TitleTag = "p",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-[18px]",
        variant === "dashed"
          ? "border border-dashed border-border-3"
          : "max-w-[620px] rounded-2xl border border-border bg-card px-[18px] py-[22px]",
        className,
      )}
    >
      <TitleTag className="text-[17px] font-semibold text-foreground">
        {title}
      </TitleTag>
      <p className="mt-1.5 max-w-[440px] text-small leading-relaxed text-subtle-foreground">
        {body}
      </p>
      {action ? <div className="mt-3.5">{action}</div> : null}
    </div>
  );
}
