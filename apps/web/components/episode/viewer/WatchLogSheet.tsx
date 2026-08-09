"use client";

import { useMemo } from "react";
import { Check, Plus, X } from "lucide-react";

import { useEpisodeViewer } from "@/components/episode/viewer/EpisodeViewerContext";
import { notify } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { copy } from "@/lib/copy";
import { formatDate, relativeDay, toIsoDay } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The watch log - the piece IMDb does not have.
 *
 * People rewatch. This records EACH viewing as its own dated entry, including
 * backdated ones, which is why the button says "Гледано 3x" rather than
 * carrying a checkmark.
 *
 * 🚨 Future days refuse the tap and say so. Silently ignoring the press reads
 * as a broken button; greying them out with no explanation reads as a bug.
 */
const QUICK_OFFSETS = [
  { label: copy.watchLog.quickToday, days: 0 },
  { label: copy.watchLog.quickYesterday, days: 1 },
  { label: copy.watchLog.quickThisWeek, days: 4 },
  { label: copy.watchLog.quickLastMonth, days: 30 },
] as const;

function shiftDays(from: Date, days: number): Date {
  const next = new Date(from);
  next.setDate(next.getDate() - days);
  return next;
}

export function WatchLogSheet() {
  const viewer = useEpisodeViewer();
  const open = viewer.sheet === "log";

  // `new Date()` once per render of an open sheet is fine; it is never used in
  // server output, so it cannot cause a hydration mismatch.
  const today = useMemo(() => new Date(), []);
  const todayIso = toIsoDay(today);

  const logged = new Set(viewer.watchEvents.map((event) => event.watched_on));

  const days = useMemo(() => {
    const year = today.getFullYear();
    const month = today.getMonth();
    const count = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(year, month, index + 1);
      return { day: index + 1, iso: toIsoDay(date) };
    });
  }, [today]);

  const monthLabel = `${copy.common.months[today.getMonth()]} ${today.getFullYear()}`;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) viewer.closeSheet();
      }}
      title={copy.watchLog.sheetTitle}
      description={copy.watchLog.sheetBody}
    >
      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK_OFFSETS.map((quick) => (
          <Button
            key={quick.label}
            variant="soft"
            size="md"
            className="min-h-11 font-normal"
            onClick={() => viewer.addWatch(toIsoDay(shiftDays(today, quick.days)))}
          >
            <Plus className="size-3.5" aria-hidden strokeWidth={2.4} />
            {quick.label}
          </Button>
        ))}
      </div>

      <p className="text-eyebrow mt-4.5">{copy.watchLog.pickDate}</p>
      <div className="mt-2.5 grid grid-cols-7 gap-[5px]">
        {days.map((entry) => {
          const isLogged = logged.has(entry.iso);
          const isFuture = entry.iso > todayIso;
          return (
            <button
              key={entry.iso}
              type="button"
              aria-label={formatDate(entry.iso)}
              aria-pressed={isLogged}
              onClick={() => {
                if (isFuture) {
                  notify.warning(copy.watchLog.futureToast);
                  return;
                }
                viewer.addWatch(entry.iso);
              }}
              className={cn(
                "h-[38px] rounded-[9px] border font-mono text-[12.5px] tabular",
                isLogged
                  ? "border-transparent bg-band-awesome font-bold text-ink"
                  : isFuture
                    ? "border-transparent bg-transparent font-medium text-faint-foreground"
                    : "border-border-2 bg-card font-medium text-foreground",
              )}
            >
              {entry.day}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11.5px] text-subtle-foreground">{monthLabel}</p>

      {viewer.watchEvents.length > 0 ? (
        <div className="mt-4.5 border-t border-border pt-4">
          <p className="text-[13.5px] font-semibold">
            {copy.watchLog.recorded(viewer.watchCount)}
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {viewer.watchEvents.map((event) => (
              <li
                key={event.id}
                className="flex items-center gap-2.5 rounded-md bg-card px-3 py-2.5"
              >
                <Check
                  className="size-3.5 shrink-0 text-band-great"
                  aria-hidden
                  strokeWidth={2.4}
                />
                <span className="flex-1 text-[13.5px]">
                  {formatDate(event.watched_on)}
                </span>
                <span className="font-mono text-[11px] text-subtle-foreground">
                  {relativeDay(event.watched_on, today)}
                </span>
                <Button
                  variant="quiet"
                  size="icon"
                  className="size-[26px]"
                  aria-label={copy.episode.removeWatch(formatDate(event.watched_on))}
                  onClick={() => viewer.removeWatch(event.id)}
                >
                  <X className="size-3" aria-hidden strokeWidth={2.6} />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button
        variant="primary"
        size="xl"
        block
        className="mt-4.5"
        onClick={viewer.closeSheet}
      >
        {copy.watchLog.done}
      </Button>
    </Sheet>
  );
}
