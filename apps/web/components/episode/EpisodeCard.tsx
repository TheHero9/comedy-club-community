import Link from "next/link";

import { ScoreChip } from "@/components/shared/ScoreChip";
import { Thumbnail } from "@/components/shared/Thumbnail";
import type { EpisodeBrief } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { formatDate, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The card that almost every screen is built from.
 *
 * Title is clamped to 2 lines with `overflow-wrap: anywhere`: Bulgarian titles
 * are long compound words, and without the break one of them pushes the card
 * out of the grid. The 40px reserved by the clamp is what stops a mixed row of
 * one-line and two-line titles from making the grid jump.
 */
interface EpisodeCardProps {
  episode: EpisodeBrief;
  /** Responsive `sizes` hint for the thumbnail. */
  sizes?: string;
  /** Show the rating count next to the date. */
  showRatingCount?: boolean;
  priority?: boolean;
  className?: string;
}

export function EpisodeCard({
  episode,
  sizes = "(min-width: 768px) 300px, 50vw",
  showRatingCount = false,
  priority = false,
  className,
}: EpisodeCardProps) {
  const duration = formatDuration(episode.duration_sec);
  const date = formatDate(episode.upload_date);
  const ratings =
    episode.public_score === null
      ? copy.episode.noRatingsShort
      : copy.episode.ratings(episode.rating_count);

  return (
    <Link
      href={`/e/${episode.youtube_id}`}
      className={cn("group block outline-none", className)}
    >
      <Thumbnail
        src={episode.thumbnail_url}
        sizes={sizes}
        priority={priority}
        className="rounded-[13px]"
      >
        <span className="absolute top-[7px] left-[7px]">
          <ScoreChip
            score={episode.public_score}
            band={episode.band}
            size="sm"
          />
        </span>
        {duration ? (
          <span className="absolute right-[7px] bottom-[7px] rounded-[5px] bg-[rgba(20,17,15,0.86)] px-[5px] py-0.5 font-mono text-[11px] text-[#F7F4F0] tabular">
            {duration}
          </span>
        ) : null}
      </Thumbnail>

      <p className="text-title-card mt-2.5 line-clamp-2 text-foreground">
        {episode.title}
      </p>
      <p className="mt-1 text-[11.5px] text-subtle-foreground">
        {showRatingCount && date ? `${date} / ${ratings}` : date || ratings}
      </p>
    </Link>
  );
}

/**
 * The horizontal variant: a wide thumbnail, the title, and the score as a chip
 * on the right. Used for "recent episodes" under a grid and anywhere a list
 * reads better than a grid.
 */
export function EpisodeRow({
  episode,
  className,
}: {
  episode: EpisodeBrief;
  className?: string;
}) {
  const duration = formatDuration(episode.duration_sec);
  const date = formatDate(episode.upload_date);
  const ratings =
    episode.public_score === null
      ? copy.episode.noRatingsShort
      : copy.episode.ratings(episode.rating_count);

  return (
    <Link
      href={`/e/${episode.youtube_id}`}
      className={cn("flex items-center gap-3 outline-none", className)}
    >
      <Thumbnail
        src={episode.thumbnail_url}
        sizes="(min-width: 768px) 180px, 120px"
        className="w-[120px] shrink-0 rounded-[11px] md:w-[180px]"
      >
        {duration ? (
          <span className="absolute right-[5px] bottom-[5px] rounded-[4px] bg-[rgba(20,17,15,0.86)] px-[5px] py-px font-mono text-[10px] text-[#F7F4F0] tabular">
            {duration}
          </span>
        ) : null}
      </Thumbnail>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[14.5px] leading-snug font-semibold text-foreground">
          {episode.title}
        </p>
        <p className="mt-1.5 text-[12px] text-subtle-foreground">
          {date ? `${date} / ${ratings}` : ratings}
        </p>
      </div>

      <ScoreChip
        score={episode.public_score}
        band={episode.band}
        size="lg"
        className="shrink-0"
      />
    </Link>
  );
}

/**
 * The 168px card used in the "similar episodes" rail. `reason` is why this
 * episode is here ("тема: хладилници", "с Даниел Петров") - the rail is
 * useless without it, because "similar" from an algorithm nobody can see is
 * just a second list of episodes.
 */
export function EpisodeRailCard({
  episode,
  reason,
}: {
  episode: EpisodeBrief;
  reason: string;
}) {
  return (
    <Link
      href={`/e/${episode.youtube_id}`}
      className="w-[168px] shrink-0 outline-none"
    >
      <Thumbnail
        src={episode.thumbnail_url}
        sizes="168px"
        className="rounded-lg"
      >
        <span className="absolute top-1.5 left-1.5">
          <ScoreChip
            score={episode.public_score}
            band={episode.band}
            size="xs"
          />
        </span>
      </Thumbnail>
      <p className="mt-2 line-clamp-2 text-[13px] leading-snug font-semibold text-foreground">
        {episode.title}
      </p>
      <p className="mt-1 text-[11px] text-subtle-foreground">{reason}</p>
    </Link>
  );
}
