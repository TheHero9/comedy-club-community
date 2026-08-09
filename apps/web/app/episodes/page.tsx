import Link from "next/link";
import type { Metadata } from "next";

import {
  KIND_OPTIONS,
  PAGE_SIZE,
  readFilters,
  SORT_OPTIONS,
  toApiQuery,
  toSearchParams,
  type FilterGroupDef,
} from "@/components/browse/filter-model";
import { FilterBar } from "@/components/browse/FilterBar";
import { EpisodeCard } from "@/components/episode/EpisodeCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { Page } from "@/components/shell/Page";
import { buttonVariants } from "@/components/ui/button";
import { listChannels, listEpisodes, listPeople } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export const metadata: Metadata = {
  title: copy.browse.title,
  description: copy.app.description,
};

export default async function EpisodesPage({
  searchParams,
}: PageProps<"/episodes">) {
  const query = await searchParams;
  const filters = readFilters(query);

  const [episodes, channels, people] = await Promise.all([
    listEpisodes(toApiQuery(filters)),
    listChannels(),
    listPeople(),
  ]);

  // Per-option counts. These are the unfiltered totals for each option, which
  // is what makes them stable enough to be worth reading: a count that changed
  // every time another group moved would just be noise. The live filtered
  // total is on the apply button instead.
  const countedGroups = await Promise.all([
    Promise.all(
      KIND_OPTIONS.map(async (option) => ({
        ...option,
        count: (await listEpisodes({ kind: option.value, limit: 1 })).meta.total,
      })),
    ),
    Promise.all(
      channels.map(async (channel) => ({
        value: channel.slug,
        label: channel.name,
        count: channel.episode_count,
      })),
    ),
    Promise.all(
      people.map(async (person) => ({
        value: person.slug,
        label: person.name,
        count: person.appearance_count,
      })),
    ),
  ]);

  const groups: FilterGroupDef[] = [
    {
      group: "sort",
      title: copy.browse.groupSort,
      chipPrefix: "",
      options: SORT_OPTIONS,
      required: true,
    },
    {
      group: "kind",
      title: copy.browse.groupKind,
      chipPrefix: copy.browse.chipKind,
      options: countedGroups[0],
    },
    {
      group: "channel",
      title: copy.browse.groupChannel,
      chipPrefix: copy.browse.chipChannel,
      options: countedGroups[1],
    },
    {
      group: "person",
      title: copy.browse.groupPerson,
      chipPrefix: copy.browse.chipPerson,
      options: countedGroups[2],
    },
  ].filter((group) => group.options.length > 0) as FilterGroupDef[];

  const shown = episodes.items.length;
  const total = episodes.meta.total;

  const activeLabels = groups
    .flatMap((group) => {
      const value = filters[group.group];
      if (!value || (group.required && value === SORT_OPTIONS[0].value)) return [];
      return group.options
        .filter((option) => option.value === value)
        .map((option) => option.label);
    })
    .join(" и ");

  return (
    <Page>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-h1">{copy.browse.title}</h1>
        <p className="text-[13.5px] text-subtle-foreground">
          {copy.browse.showing(shown, total)}
        </p>
      </div>

      <FilterBar filters={filters} groups={groups} total={total} />

      {total === 0 ? (
        <EmptyState
          className="mt-5"
          variant="card"
          title={copy.browse.emptyTitle}
          body={copy.browse.emptyBody(
            activeLabels || copy.browse.emptyFallbackSummary,
          )}
          action={
            <Link
              href="/episodes"
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
            >
              {copy.browse.clearFilters}
            </Link>
          }
        />
      ) : (
        <>
          <div className="mt-4.5 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-4">
            {episodes.items.map((episode, index) => (
              <EpisodeCard
                key={episode.youtube_id}
                episode={episode}
                showRatingCount
                sizes="(min-width: 768px) 280px, 50vw"
                priority={index < 2}
              />
            ))}
          </div>

          {episodes.meta.has_more ? (
            // A link, not a client-side append: the deeper list stays
            // shareable and server-rendered. `scroll={false}` keeps the user
            // exactly where they were.
            <Link
              scroll={false}
              href={`/episodes${toSearchParams({
                ...filters,
                limit: filters.limit + PAGE_SIZE,
              })}`}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg", block: true }),
                "mt-5 max-w-[400px]",
              )}
            >
              {copy.browse.loadMore}
            </Link>
          ) : null}
        </>
      )}
    </Page>
  );
}
