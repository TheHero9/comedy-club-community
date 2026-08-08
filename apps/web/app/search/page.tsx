import type { Metadata } from "next";
import { Search as SearchIcon } from "lucide-react";

import { EpisodeCard } from "@/components/episode/EpisodeCard";
import { Badge } from "@/components/ui/badge";
import { search } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";

// A stale search result is worse than a slow one.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: copy.search.title,
  description: copy.search.subtitle,
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const query = first(params.q).trim();

  const results = query ? await search({ q: query, limit: 24 }) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{copy.search.title}</h1>
        <p className="mt-1 text-muted-foreground">{copy.search.subtitle}</p>
      </div>

      {/* A GET form keeps every search a shareable URL and needs no JavaScript. */}
      <form action="/search" method="get" className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={copy.search.placeholder}
            aria-label={copy.search.title}
            autoComplete="off"
            /* text-base, not text-sm: anything under 16px makes iOS Safari zoom
               the viewport on focus and never zoom back. */
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {copy.search.title}
        </button>
      </form>

      {!query ? (
        <p className="py-12 text-center text-muted-foreground">{copy.search.prompt}</p>
      ) : results && results.hits.length > 0 ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {copy.search.results(results.total)}
            <Badge variant="secondary" className="font-normal">
              {copy.search.poweredBy(results.backend)}
              {results.processing_ms !== null ? ` - ${results.processing_ms}ms` : ""}
            </Badge>
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {results.hits.map((hit) => (
              <div key={hit.episode.youtube_id} className="space-y-1.5">
                <EpisodeCard episode={hit.episode} />
                {hit.matched_topics.length > 0 || hit.matched_moments.length > 0 ? (
                  <div className="flex flex-wrap gap-1 px-1">
                    {hit.matched_topics.map((topic) => (
                      <Badge key={topic} variant="outline" className="text-[10px]">
                        {topic}
                      </Badge>
                    ))}
                    {hit.matched_moments.map((moment) => (
                      <Badge key={moment} variant="outline" className="text-[10px]">
                        {moment}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="py-12 text-center text-muted-foreground">{copy.search.empty}</p>
      )}
    </div>
  );
}
