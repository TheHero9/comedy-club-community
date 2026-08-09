"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { api } from "@/lib/api/client";
import { copy } from "@/lib/copy";
import { readRecentSearches, rememberSearch } from "@/lib/recent-searches";
import { cn } from "@/lib/utils";

/**
 * The search overlay.
 *
 * It opens OVER the current page and returns to it on cancel - it never
 * navigates on open. Only submitting a query moves the user.
 *
 * ⚠️ Suggestion rows carry no result count. The design shows one, but
 * `/api/search/suggest` returns `string[]` and nothing else; inventing a number
 * here would be a fabricated fact on the one screen whose entire job is
 * trustworthy retrieval. Popular topics on /search do carry real counts,
 * because `/api/topics` returns `episode_count`.
 */
const SUGGEST_DEBOUNCE_MS = 160;

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
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  /** Tagged with the query it answers, so a stale list cannot be shown. */
  const [suggested, setSuggested] = useState<{ query: string; items: string[] } | null>(
    null,
  );
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

  useEffect(() => {
    if (!open || trimmed.length === 0) return;
    const controller = new AbortController();
    const id = window.setTimeout(() => {
      api
        .get<string[]>("/api/search/suggest", {
          query: { q: trimmed },
          signal: controller.signal,
          cache: "no-store",
        })
        .then((items) => setSuggested({ query: trimmed, items }))
        // A failed suggestion lookup is not worth a toast: the field still
        // works and Enter still searches.
        .catch(() => undefined);
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [open, trimmed]);

  // Focus is a DOM call, not state, so it stays an effect - that is exactly
  // what effects are for.
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

  // Only ever the suggestions for the query currently in the field: the tag
  // makes "stale results for the previous keystroke" unrepresentable.
  const rows = useMemo(() => {
    if (trimmed.length === 0 || suggested?.query !== trimmed) return [];
    return suggested.items.filter(
      (item) => item.toLowerCase() !== trimmed.toLowerCase(),
    );
  }, [suggested, trimmed]);

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
        className="flex h-[50px] items-center gap-2.5 rounded-pill border-2 border-primary bg-card px-[18px]"
      >
        <Search className="size-[18px] shrink-0 text-primary" aria-hidden strokeWidth={2.4} />
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
            aria-label={copy.common.close}
            className="size-6"
            onClick={() => {
              setValue("");
              inputRef.current?.focus();
            }}
          >
            <X className="size-4" aria-hidden strokeWidth={2.6} />
          </Button>
        ) : null}
      </form>

      {rows.length > 0 ? (
        <>
          <p className="text-eyebrow mt-[18px]">{copy.search.suggestions}</p>
          <ul className="mt-1 flex flex-col">
            {rows.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => go(item)}
                  className="flex min-h-[50px] w-full items-center gap-3 border-b border-border text-left"
                >
                  <Search
                    className="size-4 shrink-0 text-subtle-foreground"
                    aria-hidden
                    strokeWidth={2.2}
                  />
                  <span className="flex-1 text-[15px] text-foreground">
                    <Highlighted text={item} prefix={trimmed} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {trimmed.length === 0 && recent.length > 0 ? (
        <>
          <p className="text-eyebrow mt-[18px]">{copy.search.suggestions}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {recent.map((item) => (
              <Button
                key={item}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => go(item)}
              >
                {item}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

/** Bolds the part of a suggestion the user has already typed. */
function Highlighted({ text, prefix }: { text: string; prefix: string }) {
  const matches =
    prefix.length > 0 && text.toLowerCase().startsWith(prefix.toLowerCase());
  if (!matches) return <>{text}</>;
  return (
    <>
      <span className={cn("font-bold")}>{text.slice(0, prefix.length)}</span>
      {text.slice(prefix.length)}
    </>
  );
}
