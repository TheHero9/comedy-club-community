/**
 * Episode card used across browse, search and channel pages.
 *
 * Server Component. Thumbnails come straight from Google's CDN at a URL derived
 * from the video id - the project never uploads or mirrors them.
 *
 * ⚡ This component is rendered 24 times on /episodes and is the single largest
 * contributor to that page's HTML. Every byte here is multiplied by the page
 * size, and again by the RSC flight payload, which serializes the same tree a
 * second time. Three deliberate choices come out of that:
 *
 * 1. No decorative icons. A lucide icon inlines ~620 bytes of SVG per instance
 *    plus a client-component reference in the flight payload. A star beside
 *    "7 ratings" earns none of that, so the text stands alone. Crown and Radio
 *    stay: they are the only carrier of "members only" and "live stream", they
 *    are conditional, and they have a text tooltip.
 * 2. The elite score is a plain span, not <Badge>. The shadcn badge variant
 *    class string is 573 bytes of HTML per instance for a chip that needs 90.
 *    The public score overlay was already a plain span, so this is also the
 *    more consistent of the two.
 * 3. Shared text classes are hoisted onto the content wrapper rather than
 *    repeated on each row.
 */
import Image from "next/image";
import Link from "next/link";
import { Crown, Radio } from "lucide-react";

import type { Schema } from "@ccc/api-types";
import { copy } from "@/lib/copy";
import { bandStyle, formatDate, formatDuration, formatScore } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

type Episode = Schema<"EpisodeBriefOut">;

/**
 * The card is at most ~400px wide once the grid reaches three columns inside
 * `max-w-7xl`, so the last clause is a fixed width rather than a viewport
 * percentage. That also raises the floor Next uses to build the srcSet
 * (`min(percentage) * deviceSizes[0]`), which trims the candidate list from 10
 * entries to 5 without losing a single real breakpoint. See next.config.ts.
 */
const THUMBNAIL_SIZES = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px";

export interface EpisodeCardProps {
  episode: Episode;
  /** Skip lazy loading. Only ever true for cards above the fold. */
  eager?: boolean;
  /** Marks the thumbnail as the likely LCP element. At most one per page. */
  lcp?: boolean;
}

export function EpisodeCard({ episode, eager = false, lcp = false }: EpisodeCardProps) {
  const band = bandStyle(episode.band ?? null);
  const hasScore = episode.public_score !== null;
  const hasOverlayFlags = episode.members_only || episode.content_kind === "stream";

  return (
    <Link
      href={`/e/${episode.youtube_id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border bg-card transition-colors",
        "hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-muted">
        {episode.thumbnail_url ? (
          <Image
            src={episode.thumbnail_url}
            alt=""
            fill
            sizes={THUMBNAIL_SIZES}
            // Next 16 deprecated `priority` in favour of `preload`, and its own
            // guidance is to prefer loading/fetchPriority over a <head> preload
            // when several images could be the LCP depending on viewport - which
            // is exactly a responsive card grid.
            loading={eager || lcp ? "eager" : "lazy"}
            fetchPriority={lcp ? "high" : undefined}
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}

        {episode.duration_sec ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {formatDuration(episode.duration_sec)}
          </span>
        ) : null}

        {hasScore ? (
          <span
            className={cn(
              "absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-xs font-bold tabular-nums",
              band.cell,
            )}
          >
            {formatScore(episode.public_score)}
          </span>
        ) : null}

        {/* Rendered only when it has something in it. An always-present wrapper
            costs 55 bytes of empty <div> on every card that has neither flag. */}
        {hasOverlayFlags ? (
          <div className="absolute right-1.5 top-1.5 flex gap-1">
            {episode.members_only ? (
              <span
                className="rounded bg-amber-500/90 p-1 text-amber-950"
                title={copy.episode.membersOnly}
              >
                <Crown className="h-3 w-3" aria-hidden />
              </span>
            ) : null}
            {episode.content_kind === "stream" ? (
              <span
                className="rounded bg-red-500/90 p-1 text-white"
                title={copy.episode.stream}
              >
                <Radio className="h-3 w-3" aria-hidden />
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3 text-xs text-muted-foreground">
        {/* 🇧🇬 Bulgarian titles are long. Clamp rather than truncate mid-word. */}
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {episode.title}
        </h3>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{episode.channel_name}</span>
          {episode.upload_date ? <span>{formatDate(episode.upload_date)}</span> : null}
        </div>

        <div className="flex items-center gap-3">
          <span>
            {hasScore ? copy.episode.ratings(episode.rating_count) : copy.episode.notRated}
          </span>
          {episode.elite_score !== null ? (
            <span
              className="rounded-full bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground tabular-nums"
              title={copy.episode.eliteScore}
            >
              {copy.episode.eliteChip(formatScore(episode.elite_score))}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export interface EpisodeGridProps {
  episodes: Episode[];
  /**
   * How many leading thumbnails load eagerly. Pass a value only when the grid
   * starts above the fold; the default keeps every image lazy, which is right
   * for a grid sitting under a hero or a leaderboard.
   */
  eagerCount?: number;
}

export function EpisodeGrid({ episodes, eagerCount = 0 }: EpisodeGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {episodes.map((episode, index) => (
        <EpisodeCard
          key={episode.youtube_id}
          episode={episode}
          eager={index < eagerCount}
          lcp={eagerCount > 0 && index === 0}
        />
      ))}
    </div>
  );
}
