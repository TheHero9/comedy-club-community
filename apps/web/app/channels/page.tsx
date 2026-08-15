import type { Metadata } from "next";

import { YearSparkline } from "@/components/channel/YearSparkline";
import { ChannelAvatar } from "@/components/shared/ChannelAvatar";
import { EmptyState } from "@/components/shared/EmptyState";
import { Page } from "@/components/shell/Page";
import { LinkButton } from "@/components/ui/button";
import {
  getChannelGrid,
  listChannels,
  type Channel,
  type ChannelGrid,
} from "@/lib/api/podcast";
import { getCopy } from "@/lib/locale";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getCopy();
  return {
    title: copy.channels.title,
    description: copy.app.description,
  };
}

export default async function ChannelsPage() {
  const copy = await getCopy();
  const channels = await listChannels();

  // One grid per channel, in parallel. The sparkline needs per-episode bands
  // and the grid endpoint is the only thing that has them; a failed fetch
  // degrades to a card with no sparkline rather than taking the page down.
  const grids = await Promise.all(
    channels.map((channel) =>
      getChannelGrid(channel.slug).catch(() => null),
    ),
  );

  const totalEpisodes = channels.reduce(
    (sum, channel) => sum + channel.episode_count,
    0,
  );
  const totalRated = grids.reduce(
    (sum, grid) => sum + (grid?.rated_count ?? 0),
    0,
  );

  // Designed for one channel AND for eight. With one it is a single wide card,
  // never a grid with one filled cell and a hole beside it.
  const single = channels.length <= 1;

  return (
    <Page>
      <h1 className="text-h1">{copy.channels.title}</h1>
      <p className="text-body mt-2.5 text-muted-foreground">
        {copy.channels.subtitle(channels.length, totalEpisodes, totalRated)}
      </p>

      {channels.length === 0 ? (
        <EmptyState
          className="mt-5"
          variant="card"
          title={copy.channels.title}
          body={copy.channels.empty}
        />
      ) : (
        <div
          className={cn(
            "mt-5 grid gap-4",
            single ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2",
          )}
        >
          {channels.map((channel, index) => (
            <ChannelCard
              key={channel.slug}
              channel={channel}
              grid={grids[index]}
            />
          ))}
        </div>
      )}
    </Page>
  );
}

async function ChannelCard({
  channel,
  grid,
}: {
  channel: Channel;
  grid: ChannelGrid | null;
}) {
  const copy = await getCopy();
  return (
    <article className="rounded-3xl border border-border bg-card p-[18px]">
      <div className="flex items-start gap-3.5">
        <ChannelAvatar
          name={channel.name}
          avatarUrl={channel.avatar_url}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[19px] font-semibold">
            {channel.name}
          </h2>
          <p className="mt-1 font-mono text-[12px] text-subtle-foreground tabular">
            {copy.channels.handleAndCount(channel.handle, channel.episode_count)}
          </p>
          {channel.description ? (
            <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-muted-foreground">
              {channel.description}
            </p>
          ) : null}
        </div>
      </div>

      {grid ? (
        <div className="mt-4">
          <YearSparkline grid={grid} />
        </div>
      ) : null}

      <LinkButton
        href={`/channels/${encodeURIComponent(channel.slug)}`}
        variant="primary"
        size="xl"
        block
        className="mt-4.5"
      >
        {copy.channels.viewGrid}
      </LinkButton>
    </article>
  );
}
