"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

/**
 * The description, fully collapsed behind a disclosure.
 *
 * 🚨 Fully collapsed as of 2026-08-15, where it used to show a 2-line clamp.
 * These are YouTube descriptions: business-enquiry addresses, sponsor codes and
 * a wall of social links. They average 109 characters on this catalogue and the
 * shortest is empty, so the two visible lines were almost never the interesting
 * part - they just pushed the cast, moments and community score down.
 *
 * A short description has no toggle at all: a disclosure that opens to reveal
 * one more line is worse than just printing the line.
 */
const TOGGLE_ABOVE_CHARS = 90;

export function EpisodeDescription({ text }: { text: string }) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const toggleable = text.length > TOGGLE_ABOVE_CHARS;

  if (!toggleable) {
    return (
      <p className="text-body mt-4 text-muted-foreground">{text}</p>
    );
  }

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
