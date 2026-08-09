import { Fragment } from "react";

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

/** Section heading with an optional right-aligned action. */
export function SectionHeading({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-baseline justify-between gap-4", className)}
    >
      <h2 className="text-h2">{title}</h2>
      {action}
    </div>
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
