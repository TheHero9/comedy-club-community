import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { EpisodeRow } from "@/components/episode/EpisodeCard";
import { RatingsGrid } from "@/components/grid/RatingsGrid";
import { ChannelAvatar } from "@/components/shared/ChannelAvatar";
import { MetaLine, Page, SectionHeading, StatTile } from "@/components/shell/Page";
import { isApiError } from "@/lib/api/client";
import {
  getChannel,
  getChannelGrid,
  listEpisodes,
  type ChannelGrid,
} from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { formatCompactNumber } from "@/lib/format";
import { decodeRouteParam } from "@/lib/route-params";
import { cn } from "@/lib/utils";

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

/**
 * Derived numbers for the stats strip.
 *
 * All of them come out of the grid payload that the page already fetched, so
 * the strip costs no extra request. They all change when the public/elite
 * toggle flips, which is the point: switching recomputes every cell, every
 * year average AND the strip. A strip that kept showing public numbers under
 * an elite grid would be the most misleading thing on the page.
 */
function gridStats(grid: ChannelGrid) {
  let best: number | null = null;
  let ratingsGiven = 0;

  for (const row of grid.rows) {
    for (const cell of row.cells) {
      if (!cell) continue;
      ratingsGiven += cell.rating_count;
      if (cell.score !== null && (best === null || cell.score > best)) {
        best = cell.score;
      }
    }
  }

  const bestSeason = grid.seasons.reduce<{ year: number; average: number } | null>(
    (winner, season) =>
      season.average !== null && (winner === null || season.average > winner.average)
        ? { year: season.year, average: season.average }
        : winner,
    null,
  );

  return { best, ratingsGiven, bestSeason };
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
    listEpisodes({ channel: slug, limit: 5, sort: "newest" }),
  ]);

  const { best, ratingsGiven, bestSeason } = gridStats(grid);
  const basePath = `/channels/${encodeURIComponent(slug)}`;

  return (
    <Page>
      <header className="flex items-start gap-3.5 md:gap-6">
        <ChannelAvatar
          name={channel.name}
          avatarUrl={channel.avatar_url}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-h1">{channel.name}</h1>
          <MetaLine
            className="mt-2"
            items={[
              channel.handle,
              copy.channels.episodeCount(channel.episode_count),
              channel.subscriber_count === null
                ? ""
                : copy.channels.subscribers(
                    formatCompactNumber(channel.subscriber_count),
                  ),
            ]}
          />
          {channel.description ? (
            <p className="mt-2.5 max-w-[620px] text-[14.5px] leading-relaxed text-muted-foreground">
              {channel.description}
            </p>
          ) : null}
        </div>
      </header>

      <div className="mt-5 grid grid-cols-3 gap-2.5 md:grid-cols-5">
        <StatTile
          value={grid.overall_average === null ? "-" : grid.overall_average.toFixed(1)}
          label={
            score === "elite" ? copy.channel.statAverageElite : copy.channel.statAverage
          }
        />
        <StatTile
          value={copy.channel.ratedOf(grid.rated_count, grid.total_count)}
          label={copy.channel.statRated}
        />
        <StatTile
          value={best === null ? "-" : best.toFixed(1)}
          label={copy.channel.statBest}
          accent
        />
        <StatTile
          value={bestSeason === null ? "-" : String(bestSeason.year)}
          label={copy.channel.statBestYear}
          className="hidden md:block"
        />
        <StatTile
          value={String(ratingsGiven)}
          label={copy.channel.statRatings}
          className="hidden md:block"
        />
      </div>

      <section className="mt-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-h2">{copy.channel.gridTitle}</h2>

          {/* Plain links, not client state: the toggle stays server-rendered,
              so it is shareable, indexable and works with JS off. */}
          <div
            role="group"
            aria-label={copy.channel.scoreModeLabel}
            className="flex rounded-pill border border-border-2 bg-card p-[3px]"
          >
            <ScoreModeLink
              href={basePath}
              label={copy.channel.publicScore}
              active={score === "public"}
            />
            <ScoreModeLink
              href={`${basePath}?score=elite`}
              label={copy.channel.eliteScore}
              active={score === "elite"}
            />
          </div>
        </div>

        <p className="mt-2 text-[12.5px] text-subtle-foreground md:hidden">
          {copy.channel.hintMobile}
        </p>
        <p className="mt-2 hidden text-[12.5px] text-subtle-foreground md:block">
          {copy.channel.hintDesktop}
        </p>

        <RatingsGrid grid={grid} />
      </section>

      {episodes.items.length > 0 ? (
        <section className="mt-8">
          <SectionHeading
            title={copy.channel.recent}
            action={
              <Link
                href={`/episodes?channel=${encodeURIComponent(slug)}`}
                className="text-[13.5px] font-semibold text-primary-text hover:text-primary-hover"
              >
                {copy.home.seeAll}
              </Link>
            }
          />
          <div className="mt-3.5 flex flex-col gap-2.5">
            {episodes.items.map((episode) => (
              <EpisodeRow key={episode.youtube_id} episode={episode} />
            ))}
          </div>
        </section>
      ) : null}
    </Page>
  );
}

function ScoreModeLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex h-[34px] items-center rounded-pill px-4 text-[13px] font-semibold transition-colors duration-120",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}
