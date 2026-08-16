"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { readRecentSearches, rememberSearch } from "@/lib/recent-searches";

/**
 * The search overlay: a field, and the queries you have run before.
 *
 * It opens OVER the current page and returns to it on cancel - it never
 * navigates on open. Only submitting a query moves the user.
 *
 * 🚨 There is no live suggestion list, and that is the point (owner call,
 * 2026-08-15). It used to fetch `/api/search/suggest` on a 160ms debounce and
 * render the hits below the field, which meant the sheet GREW with every
 * keystroke - and because this is a bottom sheet, growing downward is
 * impossible, so it grew upward and dragged the input away from the thumb that
 * was typing into it. A field that runs from under your finger while you use it
 * is worse than no suggestions at all.
 *
 * What remains is deliberately fixed-height while typing: the recent list is
 * shown ONLY when the field is empty, so the sheet settles at open and does not
 * move again until the user submits. `/api/search/suggest` still exists and is
 * still correct; nothing renders it today.
 */
interface SearchOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefills the field, e.g. when opened from the search page. */
  initialQuery?: string;
}

export function SearchOverlay({
  open,
  onOpenChange,
  initialQuery = "",
}: SearchOverlayProps) {
  const copy = useCopy();
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Reset to the caller's query every time it opens, so a stale term from a
   * previous session never sits in the field.
   *
   * Adjusted during render rather than in an effect: an effect would paint the
   * old query for a frame, and setState inside one schedules a cascading render
   * that `react-hooks/set-state-in-effect` rejects.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setValue(initialQuery);
    }
  }

  // Recomputed whenever the sheet opens. A pure localStorage read, so it
  // belongs in render rather than in state an effect has to keep in sync.
  const recent = useMemo(() => (open ? readRecentSearches() : []), [open]);

  const trimmed = value.trim();

  // Focus is a DOM call, not state, so it stays an effect - that is exactly
  // what effects are for. The delay lets the sheet's entry transform finish;
  // focusing mid-flight scrolls the page on iOS.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  function go(query: string) {
    const next = query.trim();
    if (next.length === 0) return;
    rememberSearch(next);
    onOpenChange(false);
    router.push(`/search?q=${encodeURIComponent(next)}`);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.search.trigger}
      hideTitle
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          go(value);
        }}
        className="flex h-[50px] items-center gap-2.5 rounded-pill border-2 border-primary bg-card py-0 pr-[5px] pl-[18px]"
      >
        <Search
          className="size-[18px] shrink-0 text-primary"
          aria-hidden
          strokeWidth={2.4}
        />
        <input
          // `type="search"` gives the field role=searchbox rather than
          // role=textbox, which is what assistive tech and the e2e suite both
          // key off. Chrome's own clear button is suppressed - the sheet has
          // its own, and two of them read as a rendering bug.
          type="search"
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={copy.search.trigger}
          aria-label={copy.search.inputLabel}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-subtle-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {value.length > 0 ? (
          <Button
            type="button"
            variant="quiet"
            size="icon"
            shape="pill"
            aria-label={copy.search.clear}
            className="size-6"
            onClick={() => {
              setValue("");
              inputRef.current?.focus();
            }}
          >
            <X className="size-4" aria-hidden strokeWidth={2.6} />
          </Button>
        ) : null}

        {/*
          🚨 A real submit button, not decoration.

          There was none: the only way to run a query was the Enter key. On a
          phone that is the keyboard's own return key and nothing on screen
          says so, so the field looked like it had swallowed what you typed.
          The owner's words were "I don't have like an enter button or anything
          which I can actually search".

          `type="submit"` so the form's existing onSubmit is the single code
          path - Enter and this button cannot diverge. Disabled on an empty
          field rather than hidden: a control that appears as you type moves
          the clear button sideways under your thumb.
        */}
        <Button
          type="submit"
          variant="primary"
          size="icon"
          shape="pill"
          aria-label={copy.search.submit}
          disabled={trimmed.length === 0}
          className="size-10"
        >
          <ArrowRight className="size-[18px]" aria-hidden strokeWidth={2.6} />
        </Button>
      </form>

      {/*
        🚨 Gated on an EMPTY field, so this can never appear or disappear while
        someone is typing. That is what keeps the sheet a fixed height for the
        whole life of a query, which is the entire fix here.

        These are the viewer's own past searches out of localStorage, not
        server-side suggestions - so the heading says so rather than reusing
        the old "SUGGESTIONS" label, which described something else.
      */}
      {trimmed.length === 0 && recent.length > 0 ? (
        <div className="animate-in fade-in duration-240">
          <p className="text-eyebrow mt-[18px]">{copy.search.recent}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {recent.map((item) => (
              <Button
                key={item}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => go(item)}
              >
                <Clock
                  className="size-3.5 text-subtle-foreground"
                  aria-hidden
                  strokeWidth={2.2}
                />
                {item}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
