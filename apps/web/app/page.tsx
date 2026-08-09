import Link from "next/link";
import { ChevronRight, Star } from "lucide-react";

import { EpisodeCard } from "@/components/episode/EpisodeCard";
import { SearchTrigger } from "@/components/search/SearchTrigger";
import { ChannelAvatar } from "@/components/shared/ChannelAvatar";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { Page, SectionHeading } from "@/components/shell/Page";
import { LinkButton } from "@/components/ui/button";
import {
  getLeaderboard,
  LEADERBOARD_KINDS,
  listChannels,
  listEpisodes,
  type EpisodeBrief,
} from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { formatScore } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Assigned before use rather than chained off `copy` inline: the copy-key
 * scanner reads `copy.search.examples.map` as a key and cannot resolve it.
 */
const EXAMPLE_QUERIES = copy.search.examples;

export const revalidate = 60;

/** Rank styling. #1 is gold and larger; the tail fades out deliberately. */
function rankStyle(rank: number): { size: string; color: string; row: string } {
  if (rank === 1) {
    return {
      size: "text-[21px]",
      color: "text-gold",
      row: "bg-rank-one",
    };
  }
  if (rank <= 3) {
    return {
      size: "text-[19px]",
      color: "text-muted-foreground",
      row: "bg-transparent",
    };
  }
  return {
    size: "text-[16px]",
    color: "text-subtle-foreground",
    row: "bg-transparent",
  };
}

export default async function HomePage() {
  const [channels, newest, topRated] = await Promise.all([
    listChannels(),
    listEpisodes({ limit: 8, sort: "newest" }),
    getLeaderboard(LEADERBOARD_KINDS.top, { limit: 5 }),
  ]);

  const totalEpisodes = newest.meta.total;

  return (
    <Page>
      <h1 className="text-display">
        {copy.home.heroLine1}
        <br />
        {copy.home.heroLine2}
        <br />
        <span className="text-primary">{copy.home.heroLine3}</span>
      </h1>

      <p className="text-body mt-3.5 max-w-[520px] text-muted-foreground">
        {copy.home.subhead(totalEpisodes)}
      </p>

      <SearchTrigger className="mt-4.5 max-w-[560px]" />

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLE_QUERIES.map((example) => (
          <LinkButton
            key={example}
            href={`/search?q=${encodeURIComponent(example)}`}
            // See the note in app/search/page.tsx: /search is force-dynamic and
            // a prefetch of it is a real search on the server.
            prefetch={false}
            variant="outline"
            size="sm"
            className="font-normal text-muted-foreground"
          >
            {example}
          </LinkButton>
        ))}
      </div>

      {topRated.items.length > 0 ? (
        <section className="mt-9">
          <SectionHeading
            title={copy.home.topRated}
            action={
              <Link
                href="/leaderboard"
                className="text-[13.5px] font-semibold text-primary-text hover:text-primary-hover"
              >
                {copy.home.seeAll}
              </Link>
            }
          />
          <ol className="mt-3.5 flex flex-col gap-2">
            {topRated.items.map((entry) => (
              <li key={entry.episode.youtube_id}>
                <TopRatedRow episode={entry.episode} rank={entry.rank} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {newest.items.length > 0 ? (
        <section className="mt-9">
          <h2 className="text-h2">{copy.home.newest}</h2>
          <div className="mt-3.5 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-4">
            {newest.items.slice(0, 4).map((episode, index) => (
              <EpisodeCard
                key={episode.youtube_id}
                episode={episode}
                sizes="(min-width: 768px) 280px, 50vw"
                priority={index < 2}
              />
            ))}
            {/* Desktop shows eight; mobile stops at four to keep the fold
                within reach of the sections below it. */}
            {newest.items.slice(4, 8).map((episode) => (
              <EpisodeCard
                key={episode.youtube_id}
                episode={episode}
                sizes="280px"
                className="hidden md:block"
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-9">
        <h2 className="text-h2">{copy.home.channels}</h2>
        <div className="mt-3.5 flex flex-col gap-2.5">
          {channels.map((channel) => (
            <Link
              key={channel.slug}
              href={`/channels/${encodeURIComponent(channel.slug)}`}
              className="flex items-center gap-3.5 rounded-2xl border border-border bg-card p-3.5 outline-none"
            >
              <ChannelAvatar
                name={channel.name}
                avatarUrl={channel.avatar_url}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="font-display text-base font-semibold text-foreground">
                  {channel.name}
                </p>
                <p className="mt-1 font-mono text-[12px] text-subtle-foreground tabular">
                  {copy.home.channelMetaNoAverage(channel.episode_count)}
                </p>
              </div>
              <ChevronRight
                className="size-[18px] shrink-0 text-faint-foreground"
                aria-hidden
                strokeWidth={2.2}
              />
            </Link>
          ))}
        </div>
      </section>
    </Page>
  );
}

function TopRatedRow({
  episode,
  rank,
}: {
  episode: EpisodeBrief;
  rank: number;
}) {
  const style = rankStyle(rank);

  return (
    <Link
      href={`/e/${episode.youtube_id}`}
      className={cn(
        "flex min-h-16 items-center gap-3 rounded-xl border border-border px-3 py-2.5 outline-none",
        style.row,
      )}
    >
      <span
        aria-label={copy.home.rank(rank)}
        className={cn(
          "min-w-6 text-center font-display font-bold",
          style.size,
          style.color,
        )}
      >
        {rank}
      </span>

      <Thumbnail
        src={episode.thumbnail_url}
        sizes="70px"
        className="w-[70px] shrink-0 rounded-[9px]"
      />

      <div className="min-w-0 flex-1">
        <p className="text-title-card line-clamp-2 text-foreground">
          {episode.title}
        </p>
        <p className="mt-1 text-[11.5px] text-subtle-foreground">
          {copy.episode.ratings(episode.rating_count)}
        </p>
      </div>

      <span className="flex shrink-0 items-center gap-1">
        <Star className="size-3.5 fill-gold text-gold" aria-hidden />
        <span className="font-mono text-[15px] font-bold tabular">
          {formatScore(episode.public_score)}
        </span>
      </span>
    </Link>
  );
}
