"use client";

import { useEffect, useId, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, PenLine, Search } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { api } from "@/lib/api/client";
import type { Person } from "@/lib/api/podcast";
import { cn } from "@/lib/utils";

/**
 * One page of personas, which is also `/api/people`'s hard `MAX_LIMIT`.
 *
 * 🚨 The list is CAPPED, and the panel says so when it is full. A picker that
 * silently shows the first 100 of 300 reads as "that person does not exist
 * yet" and invites a duplicate persona - which is the single thing `Person`
 * curation exists to prevent. The search box is what reaches past the cap.
 */
const PICKER_LIMIT = 100;

/** How long a keystroke waits before it becomes a request. */
const TYPING_SETTLE_MS = 180;

interface Props {
  /** The chosen persona's slug, or "" for nothing chosen yet. */
  value: string;
  /**
   * What to show when something IS chosen. Passed in rather than looked up in
   * the loaded page, because the chosen person is frequently not in it - a
   * search for someone else replaces the whole list, and the trigger must not
   * go blank when that happens.
   */
  valueLabel?: string;
  onSelect: (person: Person) => void;
  /**
   * Seed list, so opening the panel shows something before the first request
   * settles. Usually the page's already-fetched roster.
   */
  initialPeople?: Person[];
  /**
   * Offered as the last row when present: "not listed, I will type a name".
   * Absent on the moderation side, where a typed name is exactly what a
   * moderator is resolving AWAY from.
   */
  onCustom?: () => void;
  /** Marks the custom row as the current choice. */
  customActive?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Accessible name, for the callers where no visible label sits above it. */
  "aria-label"?: string;
}

/**
 * Choosing a person, in OUR dropdown.
 *
 * 🚨 It replaced a native `<select>`, and the reason is not decoration: on a
 * phone a `<select>` hands the choice to the operating system's own wheel or
 * full-screen list, which cannot show an avatar, cannot be searched, and looks
 * like a different application. With a catalogue that pages at 100 it also had
 * no way to reach past the first page at all.
 *
 * ⚠️ The panel is positioned relative to the trigger and NOT portalled, so a
 * caller that clips its overflow will clip this. Every current call site is a
 * plain card or a form row. If it ever needs to live inside a scroll container,
 * that is the moment to portal it - not the moment to add `overflow-visible`
 * somewhere and hope.
 */
export function PersonPicker({
  value,
  valueLabel,
  onSelect,
  initialPeople,
  onCustom,
  customActive = false,
  placeholder,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: Props) {
  const copy = useCopy();
  const fieldId = useId();
  const listId = `${fieldId}-list`;

  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [settled, setSettled] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Debounced, so holding a key down is one request rather than eight. The
  // setState is inside a timer, never synchronous in the effect body -
  // `react-hooks/set-state-in-effect` is an error in this repo.
  useEffect(() => {
    const timer = setTimeout(() => setSettled(term.trim()), TYPING_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  // Close on a click anywhere else. `pointerdown` rather than `click` so the
  // panel is gone before the thing underneath reacts.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const people = useQuery({
    queryKey: ["people", "picker", settled],
    enabled: open,
    // The previous page stays on screen while the next one loads, so typing
    // does not flash an empty list between keystrokes.
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.get<Person[]>("/api/people", {
        query: { limit: PICKER_LIMIT, ...(settled ? { q: settled } : {}) },
        signal,
        cache: "no-store",
      }),
  });

  // The seed only stands in for an unsearched list. Once a term is typed, an
  // unfiltered roster would be a wrong answer rather than a stale one.
  const options = people.data ?? (settled ? [] : (initialPeople ?? []));
  const rowCount = options.length + (onCustom ? 1 : 0);
  // Clamped at render rather than reset in an effect: the list changes on every
  // keystroke, and an index left pointing past the end would select nothing.
  const active = rowCount === 0 ? -1 : Math.min(activeIndex, rowCount - 1);
  const customIndex = onCustom ? options.length : -1;

  // Keeps the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function close() {
    setOpen(false);
    setTerm("");
    setSettled("");
    setActiveIndex(0);
    // Focus follows the panel back to the control that opened it, or a keyboard
    // user is returned to the top of the document with no way back.
    triggerRef.current?.focus();
  }

  function choose(index: number) {
    // 🚨 -1 means "nothing is highlighted", which happens whenever the list is
    // empty. Without this guard it would equal `customIndex` on a picker that
    // has no custom row (also -1) and Enter would silently close the panel.
    if (index < 0) return;
    if (index === customIndex) {
      onCustom?.();
      close();
      return;
    }
    const person = options[index];
    if (!person) return;
    onSelect(person);
    close();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, rowCount - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(rowCount - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  const chosenLabel = customActive
    ? copy.picker.custom
    : value
      ? (valueLabel ?? value)
      : "";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex w-full items-center gap-2 rounded-pill border border-border bg-background px-3 py-2 text-left text-small outline-none",
          "transition-colors duration-120 hover:border-border-3 focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        {chosenLabel ? (
          <span className="min-w-0 flex-1 truncate">{chosenLabel}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-subtle-foreground">
            {placeholder ?? copy.picker.choose}
          </span>
        )}
        <ChevronDown className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
      </button>

      {open ? (
        <div className="absolute top-[calc(100%+4px)] left-0 z-50 w-full min-w-[240px] overflow-hidden rounded-xl border border-border-2 bg-card shadow-floating">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
            <input
              // The panel only exists because it was just opened, and typing is
              // what it is for.
              autoFocus
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={true}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${fieldId}-row-${active}` : undefined}
              placeholder={copy.picker.search}
              className="w-full bg-transparent text-small outline-none placeholder:text-subtle-foreground"
            />
          </div>

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel ?? copy.picker.choose}
            className="max-h-[264px] overflow-y-auto py-1"
          >
            {options.map((person, index) => {
              const selected = person.slug === value && !customActive;
              return (
                <li
                  key={person.slug}
                  id={`${fieldId}-row-${index}`}
                  role="option"
                  aria-selected={selected}
                  onPointerEnter={() => setActiveIndex(index)}
                  onClick={() => choose(index)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 px-3 py-2",
                    index === active && "bg-elevated",
                  )}
                >
                  <PersonAvatar name={person.name} slug={person.slug} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small font-semibold">
                      {person.name}
                    </span>
                    <span className="block text-[11px] text-subtle-foreground">
                      {copy.manage.appearances(person.appearance_count)}
                    </span>
                  </span>
                  {selected ? (
                    <Check className="size-4 shrink-0 text-primary-text" aria-hidden />
                  ) : null}
                </li>
              );
            })}

            {onCustom ? (
              <li
                id={`${fieldId}-row-${customIndex}`}
                role="option"
                aria-selected={customActive}
                onPointerEnter={() => setActiveIndex(customIndex)}
                onClick={() => choose(customIndex)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 border-t border-border px-3 py-2",
                  customIndex === active && "bg-elevated",
                )}
              >
                <PenLine className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
                <span className="text-small">{copy.picker.custom}</span>
              </li>
            ) : null}

          </ul>

          {/* Outside the list, deliberately: a `listbox` may only contain
              options, and a bare `<li>` of prose inside one is an
              `aria-required-children` violation `e2e/a11y.spec.ts` would fail
              the build on. */}
          {options.length === 0 && !people.isFetching ? (
            <p className="px-3 py-3 text-small text-subtle-foreground">
              {copy.picker.empty}
            </p>
          ) : null}

          {/* Stated, never silent - see the note on PICKER_LIMIT. */}
          {options.length >= PICKER_LIMIT ? (
            <p className="border-t border-border px-3 py-2 text-[11.5px] text-subtle-foreground">
              {copy.picker.capped(PICKER_LIMIT)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
