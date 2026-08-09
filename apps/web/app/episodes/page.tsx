import Link from "next/link";
import type { Metadata } from "next";

import { EpisodeGrid } from "@/components/episode/EpisodeCard";
import { Pagination } from "@/components/shared/Pagination";
import { listEpisodes } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export const metadata: Metadata = {
  title: copy.episodes.title,
  description: copy.episodes.subtitle,
};

const PAGE_SIZE = 24;

const SORTS = [
  { key: "newest", label: copy.episodes.sortNewest },
  { key: "oldest", label: copy.episodes.sortOldest },
  { key: "top", label: copy.episodes.sortTop },
  { key: "top_elite", label: copy.episodes.sortTopElite },
  { key: "most_rated", label: copy.episodes.sortMostRated },
] as const;

const KINDS = [
  { key: "", label: copy.episodes.filterAll },
  { key: "video", label: copy.episodes.filterVideos },
  { key: "stream", label: copy.episodes.filterStreams },
] as const;

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** Rebuild the query string with one key changed, preserving the rest. */
function withParam(
  current: Record<string, string>,
  key: string,
  value: string,
): string {
  const next = new URLSearchParams(current);
  if (value) next.set(key, value);
  else next.delete(key);
  next.delete("offset"); // changing a filter must reset pagination
  const qs = next.toString();
  return qs ? `/episodes?${qs}` : "/episodes";
}

export default async function EpisodesPage({ searchParams }: PageProps<"/episodes">) {
  const query = await searchParams;

  const channel = first(query.channel);
  const topic = first(query.topic);
  const kind = first(query.kind);
  const membersOnly = first(query.members_only);
  const sort = first(query.sort) || "newest";
  const offset = Math.max(0, Number.parseInt(first(query.offset) || "0", 10) || 0);

  const active: Record<string, string> = {};
  if (channel) active.channel = channel;
  if (topic) active.topic = topic;
  if (kind) active.kind = kind;
  if (membersOnly) active.members_only = membersOnly;
  if (sort !== "newest") active.sort = sort;

  const data = await listEpisodes({
    channel: channel || undefined,
    topic: topic || undefined,
    kind: kind || undefined,
    members_only: membersOnly || undefined,
    sort,
    limit: PAGE_SIZE,
    offset,
  });

  const total = data.meta.total;
  const shown = data.items.length;
  // "Showing 25 to 48 of 1392" only says something once there is more than one
  // page. A single page, or an offset past the end, reads better as a count.
  const summary =
    shown > 0 && total > PAGE_SIZE
      ? copy.episodes.showingRange(offset + 1, offset + shown, total)
      : copy.episodes.showing(shown, total);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{copy.episodes.title}</h1>
        <p className="mt-1 text-muted-foreground">{summary}</p>
      </div>

      {/* Filters are plain links so every combination is a shareable, indexable URL. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {SORTS.map((option) => (
          <Link
            key={option.key}
            href={withParam(active, "sort", option.key === "newest" ? "" : option.key)}
            className={cn(
              "rounded-full border px-3 py-1 transition-colors",
              sort === option.key
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:border-ring hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        ))}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden />

        {KINDS.map((option) => (
          <Link
            key={option.key || "all"}
            href={withParam(active, "kind", option.key)}
            className={cn(
              "rounded-full border px-3 py-1 transition-colors",
              kind === option.key
                ? "border-primary bg-primary text-primary-foreground"
                : "text-muted-foreground hover:border-ring hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        ))}

        <Link
          href={withParam(active, "members_only", membersOnly === "true" ? "" : "true")}
          className={cn(
            "rounded-full border px-3 py-1 transition-colors",
            membersOnly === "true"
              ? "border-primary bg-primary text-primary-foreground"
              : "text-muted-foreground hover:border-ring hover:text-foreground",
          )}
        >
          {copy.episodes.filterMembers}
        </Link>
      </div>

      {data.items.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">{copy.episodes.empty}</p>
      ) : (
        // The grid starts just below the h1 and the filter row, so the first
        // row of thumbnails is above the fold on every viewport.
        <EpisodeGrid episodes={data.items} eagerCount={4} />
      )}

      <Pagination
        basePath="/episodes"
        params={active}
        offset={offset}
        limit={PAGE_SIZE}
        total={total}
      />
    </div>
  );
}
