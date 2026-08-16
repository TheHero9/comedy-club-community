"use client";

import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";

import { SearchOverlay } from "@/components/shell/SearchOverlay";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

/**
 * The big red-bordered search pill.
 *
 * 🔴 The 2px brand-red border is the one place a border carries brand colour,
 * and it is deliberate: search previously looked like a newsletter signup on a
 * site whose entire argument is that it is more findable than YouTube. Making
 * the field the loudest object on the page is the argument, restated visually.
 *
 * It opens the overlay rather than navigating, so the page behind it is still
 * there when the user changes their mind.
 */
export function SearchTrigger({
  size = "lg",
  initialQuery = "",
  className,
}: {
  size?: "md" | "lg";
  initialQuery?: string;
  className?: string;
}) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const label = initialQuery.length > 0 ? initialQuery : copy.search.trigger;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-3 rounded-pill border-2 border-primary bg-card text-left",
          size === "lg" ? "h-14 pr-1.5 pl-5" : "h-[54px] pr-1.5 pl-5",
          className,
        )}
      >
        <Search
          className={size === "lg" ? "size-5 shrink-0" : "size-[19px] shrink-0"}
          strokeWidth={2.4}
          aria-hidden
          color="var(--primary)"
        />
        <span
          className={cn(
            "flex-1 truncate text-base",
            initialQuery.length > 0 ? "text-foreground" : "text-subtle-foreground",
          )}
        >
          {label}
        </span>
        {/* 🚨 The filled circle is what makes this read as a field you can
            SUBMIT rather than a label. It is part of the same button, not a
            nested one - a button inside a button is invalid HTML and the whole
            pill already opens the overlay. Its twin in the overlay is the real
            submit control. */}
        <span
          aria-hidden
          className={cn(
            "flex shrink-0 items-center justify-center rounded-pill bg-primary text-primary-foreground",
            size === "lg" ? "size-11" : "size-[42px]",
          )}
        >
          <ArrowRight className="size-[19px]" strokeWidth={2.6} />
        </span>
      </button>

      <SearchOverlay
        open={open}
        onOpenChange={setOpen}
        initialQuery={initialQuery}
      />
    </>
  );
}
