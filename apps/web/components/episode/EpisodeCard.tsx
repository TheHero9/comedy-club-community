/**
 * Episode card used across browse, search and channel pages.
 *
 * Server Component. Thumbnails come straight from Google's CDN at a URL derived
 * from the video id - the project never uploads or mirrors them.
 */
import Image from "next/image";
import Link from "next/link";
import { Crown, Radio, Star, Users } from "lucide-react";

import type { Schema } from "@ccc/api-types";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/copy";
import { bandStyle, formatDate, formatDuration, formatScore } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

type Episode = Schema<"EpisodeBriefOut">;

export function EpisodeCard({ episode }: { episode: Episode }) {
  const band = bandStyle(episode.band ?? null);
  const hasScore = episode.public_score !== null;

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
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
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
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* 🇧🇬 Bulgarian titles are long. Clamp rather than truncate mid-word. */}
        <h3 className="line-clamp-2 text-sm font-medium leading-snug">{episode.title}</h3>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{episode.channel_name}</span>
          {episode.upload_date ? <span>{formatDate(episode.upload_date)}</span> : null}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {hasScore ? (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" aria-hidden />
              {copy.episode.ratings(episode.rating_count)}
            </span>
          ) : (
            <span>{copy.episode.notRated}</span>
          )}
          {episode.elite_score !== null ? (
            <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
              <Users className="h-2.5 w-2.5" aria-hidden />
              {formatScore(episode.elite_score)}
            </Badge>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function EpisodeGrid({ episodes }: { episodes: Episode[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {episodes.map((episode) => (
        <EpisodeCard key={episode.youtube_id} episode={episode} />
      ))}
    </div>
  );
}
