"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The description, collapsed to 2 lines.
 *
 * Descriptions on this catalogue average 109 characters and the shortest is
 * empty, so a full-height description block would be mostly whitespace on most
 * episodes. Nobody reads them, so they never take vertical space by default -
 * and the toggle only appears when there is actually more to show.
 */
const TOGGLE_ABOVE_CHARS = 90;

export function EpisodeDescription({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const toggleable = text.length > TOGGLE_ABOVE_CHARS;

  return (
    <div className="mt-4">
      <p
        className={cn(
          "text-body text-muted-foreground",
          !open && "line-clamp-2",
        )}
      >
        {text}
      </p>
      {toggleable ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="mt-1.5 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-primary-text outline-none"
        >
          {open ? copy.episode.descriptionLess : copy.episode.descriptionMore}
          <ChevronDown
            className={cn("size-3.5 transition-transform duration-120", open && "rotate-180")}
            aria-hidden
            strokeWidth={2.4}
          />
        </button>
      ) : null}
    </div>
  );
}
