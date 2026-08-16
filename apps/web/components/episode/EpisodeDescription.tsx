"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

/**
 * The description, ALWAYS collapsed behind a disclosure.
 *
 * 🚨 Fully collapsed as of 2026-08-15, where it used to show a 2-line clamp.
 * These are YouTube descriptions: business-enquiry addresses, sponsor codes and
 * a wall of social links. They average 109 characters on this catalogue and the
 * shortest is empty, so the two visible lines were almost never the interesting
 * part - they just pushed the cast, moments and community score down.
 *
 * 🚨 The "short descriptions print in full" exception is GONE (owner call,
 * 2026-08-16). It made the page inconsistent in the one way that reads as a
 * bug: whether the description was hidden depended on a character count nobody
 * can see, so the same section collapsed on one episode and sat open on the
 * next. Every episode now behaves identically.
 *
 * An EMPTY description renders nothing at all - not a toggle, and not a
 * "no description" placeholder. A disclosure that opens onto an apology is
 * worse than the absence it is apologising for.
 */
export function EpisodeDescription({ text }: { text: string }) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);

  if (text.trim().length === 0) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-primary-text outline-none"
      >
        {copy.episode.descriptionToggle}
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform duration-120",
            open && "rotate-180",
          )}
          aria-hidden
          strokeWidth={2.4}
        />
      </button>
      {open ? (
        <p className="text-body mt-2 text-muted-foreground">{text}</p>
      ) : null}
    </div>
  );
}
