"use client";

import { RotateCcw } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";

/**
 * The line a composer shows when it reopened holding text it kept for you.
 *
 * 🚨 SAID OUT LOUD, always. A form that silently repopulates itself is
 * indistinguishable from a form that submitted something on your behalf - and
 * on a site where the whole complaint was "I logged a moment and it vanished",
 * unexplained text appearing is the mirror-image failure. It names what
 * happened and offers the one control that undoes it.
 *
 * Shared by every composer rather than copied into each: three near-identical
 * notices are three places for the discard to drift out of step with the store.
 */
export function DraftNotice({ onDiscard }: { onDiscard: () => void }) {
  const copy = useCopy();

  return (
    <p className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-subtle-foreground">
      <RotateCcw aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {copy.common.draftRestored}
      <button
        type="button"
        onClick={onDiscard}
        className="rounded-pill underline underline-offset-2 outline-none hover:text-primary-text focus-visible:text-primary-text"
      >
        {copy.common.draftDiscard}
      </button>
    </p>
  );
}
