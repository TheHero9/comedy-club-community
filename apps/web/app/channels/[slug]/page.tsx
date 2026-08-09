import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Star, Users } from "lucide-react";

import { EpisodeGrid } from "@/components/episode/EpisodeCard";
import { RatingsGrid } from "@/components/grid/RatingsGrid";
import { ChannelAvatar } from "@/components/shared/ChannelAvatar";
import { Badge } from "@/components/ui/badge";
import { isApiError } from "@/lib/api/client";
import { getChannel, getChannelGrid, listEpisodes } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { decodeRouteParam } from "@/lib/route-params";

export const revalidate = 60;

type ScoreKind = "public" | "elite";

function scoreKind(value: string | string[] | undefined): ScoreKind {
  return value === "elite" ? "elite" : "public";
}

export async function generateMetadata({
  params,
}: PageProps<"/channels/[slug]">): Promise<Metadata> {
  const { slug: rawSlug } = await params;
  const slug = decodeRouteParam(rawSlug);
  try {
    const channel = await getChannel(slug);
    return {
      title: channel.name,
      description: channel.description || copy.app.description,
    };
  } catch {
    return { title: copy.channels.title };
  }
}

export default async function ChannelPage({
  params,
  searchParams,
}: PageProps<"/channels/[slug]">) {
  const { slug: rawSlug } = await params;
  const slug = decodeRouteParam(rawSlug);
  const query = await searchParams;
  const score = scoreKind(query.score);

  let channel;
  try {
    channel = await getChannel(slug);
  } catch (error) {
    if (isApiError(error) && error.status === 404) notFound();
    throw error;
  }

  // Grid and episode list are independent, so fetch them together rather than
  // waterfalling one behind the other.
  const [grid, episodes] = await Promise.all([
    getChannelGrid(slug, score),
    listEpisodes({ channel: slug, limit: 12, sort: "newest" }),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-8">
      <div>
        <Link
          href="/channels"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {copy.channels.title}
        </Link>

        <div className="flex items-center gap-4">
          <ChannelAvatar name={channel.name} avatarUrl={channel.avatar_url} size="lg" />
          <h1 className="min-w-0 text-3xl font-bold tracking-tight">{channel.name}</h1>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {channel.handle ? <span>{channel.handle}</span> : null}
          <span>{copy.channels.episodeCount(channel.episode_count)}</span>
          {grid.overall_average !== null ? (
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5" aria-hidden />
              {copy.grid.seasonAverage(grid.overall_average.toFixed(2))}
            </span>
          ) : null}
          <span>{copy.grid.ratedOf(grid.rated_count, grid.total_count)}</span>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{copy.grid.title}</h2>
            <p className="text-sm text-muted-foreground">{copy.grid.subtitle}</p>
          </div>

          {/* Plain links, not a client component: the toggle stays server-rendered
              and therefore shareable and indexable. */}
          <div className="flex gap-1 rounded-md border p-1 text-sm">
            <Link
              href={`/channels/${slug}`}
              className={
                score === "public"
                  ? "rounded bg-primary px-3 py-1 text-primary-foreground"
                  : "rounded px-3 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {copy.grid.publicScore}
            </Link>
            <Link
              href={`/channels/${slug}?score=elite`}
              className={
                score === "elite"
                  ? "flex items-center gap-1.5 rounded bg-primary px-3 py-1 text-primary-foreground"
                  : "flex items-center gap-1.5 rounded px-3 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              <Users className="h-3.5 w-3.5" aria-hidden />
              {copy.grid.eliteScore}
            </Link>
          </div>
        </div>

        {score === "elite" ? (
          <Badge variant="secondary" className="font-normal">
            {copy.grid.eliteHint}
          </Badge>
        ) : null}

        <RatingsGrid grid={grid} />
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{copy.episodes.title}</h2>
          <Link
            href={`/episodes?channel=${slug}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {copy.channels.browseAll}
          </Link>
        </div>
        <EpisodeGrid episodes={episodes.items} />
      </section>
    </div>
  );
}
