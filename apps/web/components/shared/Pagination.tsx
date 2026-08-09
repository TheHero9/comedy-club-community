/**
 * URL-driven pagination for offset/limit list endpoints.
 *
 * Server Component on purpose. Every page of every filter combination is a real
 * URL, so it is shareable, crawlable, back-button-correct and works with
 * JavaScript disabled. That matters more here than anywhere else in the app:
 * this is a content site whose entire value proposition is being findable, and
 * without paged URLs episodes 25 to 1392 are unreachable by a crawler.
 *
 * `rel="prev"` / `rel="next"` are emitted so a crawler can walk the sequence.
 */
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * `min-h-11` is the project's 44px touch-target floor. Padding tightens on the
 * narrowest phones so "Previous / Page 58 of 58 / Next" cannot push the row
 * past 390px and give the page a horizontal scrollbar.
 */
const CONTROL =
  "inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-md border px-3 text-sm transition-colors sm:px-4";
const ENABLED = "hover:border-ring";
/**
 * Dimmed with a colour token, NOT with `opacity`. `opacity-40` on the foreground
 * token drops the text far below the 4.5:1 contrast floor and axe flags it as a
 * serious violation - being `aria-hidden` does not help, because the problem is
 * sighted legibility. `text-muted-foreground` still reads clearly as inactive
 * while staying above the threshold.
 */
const DISABLED = "pointer-events-none border-border/60 text-muted-foreground";

export interface PaginationProps {
  /** Path without a query string, e.g. "/episodes". */
  basePath: string;
  /** Query parameters to preserve, excluding `offset`. */
  params: Record<string, string>;
  offset: number;
  limit: number;
  total: number;
}

function hrefFor(
  basePath: string,
  params: Record<string, string>,
  offset: number,
): string {
  const next = new URLSearchParams(params);
  // Defensive: a caller that leaves `offset` in `params` would otherwise pin
  // every link to the page it was rendered on.
  next.delete("offset");
  // Page one is the canonical URL, so it never carries `offset=0`.
  if (offset > 0) next.set("offset", String(offset));
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function Pagination({ basePath, params, offset, limit, total }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  if (pageCount <= 1) return null;

  /**
   * `?offset=99999` is a URL anyone can type or a crawler can invent. Clamping
   * to the last real page keeps the controls sane instead of announcing
   * "Page 4167 of 58" with a Next link that goes nowhere.
   */
  const current = Math.min(Math.max(0, offset), (pageCount - 1) * limit);
  const page = Math.floor(current / limit) + 1;

  const hasPrevious = current > 0;
  const hasNext = current + limit < total;

  return (
    <nav
      aria-label={copy.pagination.label}
      className="flex items-center justify-between gap-3 pt-4"
    >
      {hasPrevious ? (
        <Link
          href={hrefFor(basePath, params, current - limit)}
          rel="prev"
          className={cn(CONTROL, ENABLED)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {copy.pagination.previous}
        </Link>
      ) : (
        <span className={cn(CONTROL, DISABLED)} aria-hidden>
          {copy.pagination.previous}
        </span>
      )}

      <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
        {copy.pagination.pageOf(page, pageCount)}
      </span>

      {hasNext ? (
        <Link
          href={hrefFor(basePath, params, current + limit)}
          rel="next"
          className={cn(CONTROL, ENABLED)}
        >
          {copy.pagination.next}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : (
        <span className={cn(CONTROL, DISABLED)} aria-hidden>
          {copy.pagination.next}
        </span>
      )}
    </nav>
  );
}
