import Link from "next/link";
import { ChevronRight, Mic, Star, Trophy } from "lucide-react";

import { SearchTrigger } from "@/components/search/SearchTrigger";
import { ChannelAvatar } from "@/components/shared/ChannelAvatar";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { Page, SectionHeading } from "@/components/shell/Page";
import {
  getLeaderboard,
  LEADERBOARD_KINDS,
  listChannels,
  listEpisodes,
  type EpisodeBrief,
} from "@/lib/api/podcast";
import { getCopy } from "@/lib/locale";
import { formatScore } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * 🚨 No `revalidate` any more. The page reads the locale cookie via `getCopy`,
 * which makes it dynamic by definition. The API round trips are still cached -
 * `lib/api/podcast.ts` carries `PUBLIC_CACHE` at the fetch layer - so what
 * moved from cached to per-request is the HTML render, not the data.
 */

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
  const copy = await getCopy();
  const [channels, catalogue, topRated] = await Promise.all([
    listChannels(),
    // 🚨 `limit: 1`, not 8. The home page no longer lists newest episodes, but
    // the subhead still quotes the catalogue size, and `meta.total` is the only
    // place that number exists. Asking for one row instead of eight is the
    // difference between a count and a payload.
    listEpisodes({ limit: 1, sort: "newest" }),
    getLeaderboard(LEADERBOARD_KINDS.top, { limit: 5 }),
  ]);

  const totalEpisodes = catalogue.meta.total;


  /**
   * Channel avatars for the episode lists below, joined here rather than
   * carried on every `EpisodeBrief`. The channel list is already fetched above
   * for its own section, so this costs one Map and zero extra bytes on the
   * wire - see the note on `EpisodeCard`'s `channelAvatarUrl` prop.
   *
   * `?? ""` on lookup, never a skipped badge: an episode whose channel somehow
   * missed the list still renders the initials tile. One card silently losing
   * its badge would read as a bug.
   */
  const channelAvatars = new Map(channels.map((c) => [c.id, c.avatar_url]));

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

      {/* 🚨 The four example-query chips used to sit here and are gone
          (owner call, 2026-08-15). This page is now the search page, and a row
          of pre-baked queries under the field competes with the field itself -
          it reads as "pick one of these" rather than "type anything". */}

      {topRated.items.length > 0 ? (
        <section className="mt-9">
          <SectionHeading
            title={copy.home.topRated}
            icon={Trophy}
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
                <TopRatedRow
                  episode={entry.episode}
                  rank={entry.rank}
                  channelAvatarUrl={
                    channelAvatars.get(entry.episode.channel_id) ?? ""
                  }
                />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* 🚨 The "newest episodes" grid used to sit here and is deliberately
          gone (owner call, 2026-08-15). The home page is the SEARCH page now:
          a hero, the field, some example queries, the top-rated rail, and the
          channels. A newest-first grid is what /episodes is for, and putting
          it here made the search field compete with a wall of thumbnails. */}
      <section className="mt-9">
        <SectionHeading title={copy.home.channels} icon={Mic} />
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

async function TopRatedRow({
  episode,
  rank,
  channelAvatarUrl,
}: {
  episode: EpisodeBrief;
  rank: number;
  channelAvatarUrl: string;
}) {
  const copy = await getCopy();
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
        {/* Inline rather than overlaid: this row's thumbnail is 70px, and a
            badge on it would read as the subject of the picture. */}
        <p className="mt-1 flex items-center gap-1.5 text-[11.5px] text-subtle-foreground">
          <ChannelAvatar
            name={episode.channel_name}
            avatarUrl={channelAvatarUrl}
            size="2xs"
          />
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
