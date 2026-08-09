import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";

import { ChannelAvatar } from "@/components/shared/ChannelAvatar";
import { listChannels } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";

export const revalidate = 60;

export const metadata: Metadata = {
  title: copy.channels.title,
  description: copy.channels.subtitle,
};

export default async function ChannelsPage() {
  const channels = await listChannels();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{copy.channels.title}</h1>
        <p className="mt-1 text-muted-foreground">{copy.channels.subtitle}</p>
      </div>

      <ul className="space-y-3">
        {channels.map((channel) => (
          <li key={channel.id}>
            <Link
              href={`/channels/${channel.slug}`}
              className="flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChannelAvatar name={channel.name} avatarUrl={channel.avatar_url} />

              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{channel.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {channel.handle ? `${channel.handle} - ` : ""}
                  {copy.channels.episodeCount(channel.episode_count)}
                </span>
              </span>

              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
