"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { toIsoDay } from "@/lib/format";

/**
 * A real month calendar: weekday header, weeks that START ON MONDAY, and
 * chevrons that walk month by month across year boundaries.
 *
 * It owns the frame only - what a day looks like and what tapping it does is
 * the caller's, via `renderDay`. That is what lets the watch-log sheet (a
 * toggle that writes) and the profile recap (a read-only viewer) share one
 * calendar without either leaking into the other.
 *
 * 🚨 Monday first is arithmetic, not configuration: JS `getDay()` is 0=Sunday,
 * so the leading-blank count is `(getDay() + 6) % 7`. The weekday labels in
 * `copy.common.weekdaysShort` are already in Monday-first order - indexing
 * them with `getDay()` directly would shift every label by a day.
 */

export interface MonthCalendarDay {
  /** `YYYY-MM-DD`, local calendar, never UTC-shifted. */
  iso: string;
  /** 1-based day of month, what the cell prints. */
  day: number;
}

interface YearMonth {
  year: number;
  /** 0-based, matching `Date.getMonth()` and `copy.common.months`. */
  month: number;
}

interface MonthCalendarProps {
  year: number;
  month: number;
  onNavigate: (year: number, month: number) => void;
  /** Newest reachable month (inclusive) - usually the current one. */
  max?: YearMonth;
  /** Oldest reachable month (inclusive). Omit for unbounded history. */
  min?: YearMonth;
  renderDay: (cell: MonthCalendarDay) => React.ReactNode;
  className?: string;
}

function monthIndex(value: YearMonth): number {
  return value.year * 12 + value.month;
}

export function MonthCalendar({
  year,
  month,
  onNavigate,
  max,
  min,
  renderDay,
  className,
}: MonthCalendarProps) {
  const copy = useCopy();
  const monthNames = copy.common.months;
  const weekdays = copy.common.weekdaysShort;

  const current = monthIndex({ year, month });
  const canGoPrev = !min || current > monthIndex(min);
  const canGoNext = !max || current < monthIndex(max);

  const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;
  const dayCount = new Date(year, month + 1, 0).getDate();
  const days: MonthCalendarDay[] = Array.from({ length: dayCount }, (_, index) => ({
    day: index + 1,
    iso: toIsoDay(new Date(year, month, index + 1)),
  }));

  const step = (delta: number) => {
    const next = current + delta;
    onNavigate(Math.floor(next / 12), ((next % 12) + 12) % 12);
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={copy.common.prevMonth}
          disabled={!canGoPrev}
          onClick={() => step(-1)}
          className="flex size-9 items-center justify-center rounded-pill border border-border-2 bg-card text-foreground outline-none transition-colors duration-120 hover:bg-elevated disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronLeft className="size-4" aria-hidden strokeWidth={2.4} />
        </button>
        <p className="text-[14px] font-semibold" aria-live="polite">
          {`${monthNames[month]} ${year}`}
        </p>
        <button
          type="button"
          aria-label={copy.common.nextMonth}
          disabled={!canGoNext}
          onClick={() => step(1)}
          className="flex size-9 items-center justify-center rounded-pill border border-border-2 bg-card text-foreground outline-none transition-colors duration-120 hover:bg-elevated disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronRight className="size-4" aria-hidden strokeWidth={2.4} />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-[5px]">
        {weekdays.map((label) => (
          <span
            key={label}
            className="text-center text-[10.5px] font-semibold tracking-wide text-faint-foreground uppercase"
          >
            {label}
          </span>
        ))}
        {Array.from({ length: leadingBlanks }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden />
        ))}
        {days.map((cell) => renderDay(cell))}
      </div>
    </div>
  );
}
