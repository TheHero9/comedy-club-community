import { Fragment } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The page container. 16px gutter on mobile, 32px on desktop, capped at
 * 1216px - which with the gutter is exactly the 1280px the design was drawn
 * at.
 */
export function Page({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1216px] px-4 pt-4 pb-5 md:px-8 md:pt-7 md:pb-10",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Section heading with an optional leading icon and right-aligned action.
 *
 * 🚨 The icon is a COMPONENT passed in, never an emoji and never a glyph
 * stored on data. Sections on this site were a stack of same-weight Bulgarian
 * headings with nothing to tell them apart at a glance; a `lucide-react` mark
 * to the left of each is what makes the page scannable.
 *
 * `items-center` rather than `items-baseline` once an icon is present: an SVG
 * has no baseline, so it aligns to the bottom of the text box and sits low.
 */
export function SectionHeading({
  title,
  icon: Icon,
  action,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-4",
        Icon ? "items-center" : "items-baseline",
        className,
      )}
    >
      <h2 className="text-h2 flex min-w-0 items-center gap-2">
        {Icon ? (
          <Icon
            className="size-[19px] shrink-0 text-subtle-foreground"
            aria-hidden
            strokeWidth={2.2}
          />
        ) : null}
        <span className="min-w-0 truncate">{title}</span>
      </h2>
      {action}
    </div>
  );
}

/**
 * The page's own H1, with the same leading-icon treatment as a section.
 *
 * Separate from `SectionHeading` rather than a `level` prop because the two
 * differ in more than the tag: an H1 carries the page's type scale and never
 * takes an action slot.
 */
export function PageHeading({
  title,
  icon: Icon,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <h1 className={cn("text-h1 flex items-center gap-2.5", className)}>
      {Icon ? (
        <Icon
          className="size-[22px] shrink-0 text-subtle-foreground"
          aria-hidden
          strokeWidth={2.2}
        />
      ) : null}
      <span className="min-w-0">{title}</span>
    </h1>
  );
}

/** One tile in a stats strip: big mono number over a small muted label. */
export function StatTile({
  value,
  label,
  accent = false,
  className,
}: {
  value: string;
  label: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card px-3.5 py-3",
        className,
      )}
    >
      <p
        className={cn(
          "font-mono text-[21px] font-bold tabular",
          accent ? "text-band-masterpiece" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11.5px] text-subtle-foreground">{label}</p>
    </div>
  );
}

/** The mono meta line with dimmed period separators, e.g. `@handle . 74 епизода`. */
export function MetaLine({
  items,
  className,
}: {
  items: string[];
  className?: string;
}) {
  const shown = items.filter((item) => item.length > 0);
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-[7px] font-mono text-[12.5px] text-subtle-foreground tabular",
        className,
      )}
    >
      {shown.map((item, index) => (
        <Fragment key={`${index}-${item}`}>
          {index > 0 ? <Separator /> : null}
          <span>{item}</span>
        </Fragment>
      ))}
    </p>
  );
}

function Separator() {
  return (
    <span aria-hidden className="opacity-50">
      .
    </span>
  );
}
