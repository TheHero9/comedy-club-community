"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { MonthCalendar } from "@/components/shared/MonthCalendar";
import { NavProgress } from "@/components/shared/NavProgress";
import type { WatchCalendar as WatchCalendarData } from "@/lib/api/podcast";
import { viewerApi } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The year-in-review piece of the profile: a month calendar where every day
 * with a logged viewing is lit, and tapping a lit day lists what was watched.
 *
 * Reads only. The writes live on each episode's watch-log sheet - this is
 * where they add up to something worth scrolling back through.
 *
 * The query is keyed by YEAR, not month: `/api/me/watch-days` returns the
 * whole year in one call, so walking through the months of a year costs one
 * request, not twelve, and TanStack serves the cached year on every
 * within-year navigation.
 */

export function WatchCalendar() {
  const copy = useCopy();
  const months = copy.common.months;
  const { signedIn } = useViewerAuth();

  // Never in server output, so it cannot cause a hydration mismatch.
  const today = useMemo(() => new Date(), []);
  const thisMonth = { year: today.getFullYear(), month: today.getMonth() };

  const [view, setView] = useState(thisMonth);
  const [selected, setSelected] = useState<string | null>(null);

  const calendar = useQuery({
    queryKey: ["me", "watch-days", view.year],
    enabled: signedIn,
    retry: false,
    queryFn: ({ signal }) =>
      viewerApi.get<WatchCalendarData>("/api/me/watch-days", {
        query: { year: view.year },
        signal,
        cache: "no-store",
      }),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, WatchCalendarData["events"]>();
    for (const event of calendar.data?.events ?? []) {
      const existing = map.get(event.watched_on);
      if (existing) existing.push(event);
      else map.set(event.watched_on, [event]);
    }
    return map;
  }, [calendar.data]);

  const selectedEvents = selected ? (byDay.get(selected) ?? []) : [];
  const nothingLoggedEver =
    calendar.data !== undefined && calendar.data.years.length === 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="text-section-label">{copy.profile.watchCalendarTitle}</h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-subtle-foreground">
        {nothingLoggedEver
          ? copy.profile.watchCalendarEmpty
          : copy.profile.watchCalendarHint}
      </p>

      <MonthCalendar
        className="mt-3.5"
        year={view.year}
        month={view.month}
        max={thisMonth}
        onNavigate={(year, month) => {
          setView({ year, month });
          // A day of one month selected under another month's list would pin
          // stale context below the calendar.
          setSelected(null);
        }}
        renderDay={(entry) => {
          const dayEvents = byDay.get(entry.iso) ?? [];
          const hasEvents = dayEvents.length > 0;
          const isSelected = selected === entry.iso;
          const dayLabel = formatDate(entry.iso, months);
          return (
            <button
              key={entry.iso}
              type="button"
              // The badge is aria-hidden so the accessible name is not read
              // as "52" for the 5th with two viewings; the count goes here.
              aria-label={
                dayEvents.length > 1
                  ? `${dayLabel}, ${copy.profile.watchCalendarDayCount(dayEvents.length)}`
                  : dayLabel
              }
              aria-pressed={isSelected}
              // Empty days are not tappable: there is nothing to show, and a
              // tap that visibly does nothing reads as a broken calendar.
              disabled={!hasEvents}
              onClick={() => setSelected(isSelected ? null : entry.iso)}
              className={cn(
                "relative h-[38px] rounded-[9px] border font-mono text-[12.5px] tabular",
                hasEvents
                  ? "border-transparent bg-band-awesome font-bold text-ink"
                  : "border-border-2 bg-card font-medium text-faint-foreground",
                isSelected && "ring-2 ring-foreground ring-offset-2 ring-offset-card",
              )}
            >
              {entry.day}
              {dayEvents.length > 1 ? (
                // A day with two viewings used to look exactly like a day
                // with one. The count is a corner badge rather than a deeper
                // shade of green: band colours carry meaning elsewhere, and a
                // second green would read as a different score, not a count.
                <span
                  aria-hidden
                  className="absolute top-[3px] right-[3px] flex h-[13px] min-w-[13px] items-center justify-center rounded-pill bg-ink px-[3px] text-[9px] leading-none font-bold text-[#F7F4F0]"
                >
                  {dayEvents.length}
                </span>
              ) : null}
            </button>
          );
        }}
      />

      {calendar.data ? (
        <p className="mt-2.5 font-mono text-[11.5px] text-subtle-foreground tabular">
          {copy.profile.watchCalendarYearTotal(calendar.data.total, view.year)}
        </p>
      ) : null}

      {selected && selectedEvents.length > 0 ? (
        <div className="mt-3.5 border-t border-border pt-3.5">
          <p className="text-[13.5px] font-semibold">
            {copy.profile.watchCalendarDayTitle(formatDate(selected, months))}
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {selectedEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/e/${event.youtube_id}`}
                  className="flex min-h-11 flex-col justify-center rounded-md bg-elevated px-3 py-2 outline-none"
                >
                  <span className="line-clamp-1 text-[13.5px]">{event.title}</span>
                  <span className="text-[11.5px] text-subtle-foreground">
                    {event.channel_name}
                  </span>
                  <NavProgress />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
