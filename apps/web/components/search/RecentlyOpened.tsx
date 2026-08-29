"use client";

import { useMemo } from "react";
import Link from "next/link";

import { NavProgress } from "@/components/shared/NavProgress";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { thumbnailUrl } from "@/lib/format";
import {
  readRecentEpisodes,
  RECENT_EPISODES_SHOWN,
} from "@/lib/recent-episodes";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * The three most recently OPENED episodes, at the bottom of the empty search
 * page (owner call, 2026-08-29, moving it out of the search overlay: the sheet
 * is for typing, the page is where a section can live without competing with
 * the field). The use case is concrete: someone closed the app mid-podcast,
 * heard a good moment, and needs back to the episode without re-searching its
 * title.
 *
 * Client component over a localStorage list, so it must be gated on
 * `useHydrated` - the server cannot know the device's history, and rendering
 * it on the first client pass is a guaranteed hydration mismatch. Rows are
 * plain Links with `NavProgress` inside: `/e/[youtubeId]` cannot have a
 * `loading.tsx`, and unlike the overlay there is no sheet to hold open.
 */
export function RecentlyOpened({ className }: { className?: string }) {
  const copy = useCopy();
  const hydrated = useHydrated();

  const recent = useMemo(
    () => (hydrated ? readRecentEpisodes().slice(0, RECENT_EPISODES_SHOWN) : []),
    [hydrated],
  );

  if (recent.length === 0) return null;

  return (
    <section className={className}>
      <p className="text-eyebrow">{copy.search.recentEpisodes}</p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {recent.map((item) => (
          <Link
            key={item.youtubeId}
            href={`/e/${encodeURIComponent(item.youtubeId)}`}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-2 text-left outline-none transition-colors duration-120 hover:bg-elevated"
          >
            <Thumbnail
              src={thumbnailUrl(item.youtubeId)}
              sizes="88px"
              className="w-[88px] shrink-0 rounded-lg"
            />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 block text-[13.5px] leading-snug">
                {item.title}
              </span>
              <span className="mt-0.5 block text-[11.5px] text-subtle-foreground">
                {item.channelName}
              </span>
            </span>
            <NavProgress />
          </Link>
        ))}
      </div>
    </section>
  );
}
