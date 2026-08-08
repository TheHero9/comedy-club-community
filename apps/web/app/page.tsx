import Link from "next/link";
import { ArrowRight, Search, Trophy, Users } from "lucide-react";

import { EpisodeGrid } from "@/components/episode/EpisodeCard";
import { Badge } from "@/components/ui/badge";
import { getLeaderboard, listChannels, listEpisodes } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { bandStyle, formatScore } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export default async function HomePage() {
  // Independent requests, so fan out rather than waterfall.
  const [channels, latest, topRated] = await Promise.all([
    listChannels(),
    listEpisodes({ limit: 8, sort: "newest" }),
    getLeaderboard("top_rated", { limit: 5 }),
  ]);

  const episodeTotal = channels.reduce((sum, channel) => sum + channel.episode_count, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-12 px-4 py-10">
      <section className="space-y-4">
        <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight">
          {copy.app.tagline}
        </h1>
        <p className="max-w-2xl text-muted-foreground">{copy.app.description}</p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            href="/search"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Search className="h-4 w-4" aria-hidden />
            {copy.search.title}
          </Link>
          <Link
            href="/episodes"
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors hover:border-ring"
          >
            {copy.episodes.title}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 text-sm text-muted-foreground">
          <Badge variant="secondary" className="font-normal">
            {copy.channels.episodeCount(episodeTotal)}
          </Badge>
          <Badge variant="secondary" className="font-normal">
            {channels.length === 1 ? "1 channel" : `${channels.length} channels`}
          </Badge>
        </div>
      </section>

      {topRated.items.length > 0 ? (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Trophy className="h-5 w-5" aria-hidden />
            {copy.episodes.sortTop}
          </h2>

          <ol className="divide-y rounded-lg border bg-card">
            {topRated.items.map((entry) => {
              const band = bandStyle(entry.episode.band ?? null);
              return (
                <li key={entry.episode.youtube_id}>
                  <Link
                    href={`/e/${entry.episode.youtube_id}`}
                    className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/50"
                  >
                    <span className="w-6 shrink-0 text-center text-sm font-medium tabular-nums text-muted-foreground">
                      {entry.rank}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-2 py-1 text-sm font-bold tabular-nums",
                        band.cell,
                      )}
                    >
                      {formatScore(entry.episode.public_score)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm font-medium">
                        {entry.episode.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {entry.episode.channel_name} -{" "}
                        {copy.episode.ratings(entry.episode.rating_count)}
                      </span>
                    </span>
                    {entry.episode.elite_score !== null ? (
                      <Badge variant="secondary" className="hidden shrink-0 gap-1 sm:flex">
                        <Users className="h-3 w-3" aria-hidden />
                        {formatScore(entry.episode.elite_score)}
                      </Badge>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{copy.episodes.sortNewest}</h2>
          <Link
            href="/episodes"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {copy.channels.browseAll}
          </Link>
        </div>
        <EpisodeGrid episodes={latest.items} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{copy.channels.title}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => (
            <Link
              key={channel.id}
              href={`/channels/${channel.slug}`}
              className="rounded-lg border bg-card p-4 transition-colors hover:border-ring"
            >
              <span className="block font-medium">{channel.name}</span>
              <span className="block text-sm text-muted-foreground">
                {copy.channels.episodeCount(channel.episode_count)}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
