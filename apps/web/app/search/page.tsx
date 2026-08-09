import Link from "next/link";
import type { Metadata } from "next";

import { SearchResultCard } from "@/components/search/SearchResultCard";
import { SearchTrigger } from "@/components/search/SearchTrigger";
import { EmptyState } from "@/components/shared/EmptyState";
import { Page } from "@/components/shell/Page";
import { buttonVariants, LinkButton } from "@/components/ui/button";
import { listTopics, search } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: copy.nav.search,
  description: copy.search.subtitle,
};

/** Search results must never be cached: a stale answer is worse than a slow one. */
export const dynamic = "force-dynamic";

/**
 * Assigned before use rather than chained off `copy` inline: the copy-key
 * scanner reads `copy.search.examples.map` as a key and cannot resolve it.
 */
const EXAMPLE_QUERIES = copy.search.examples;

const RESULT_LIMIT = 20;
const POPULAR_TOPIC_LIMIT = 8;

function readQuery(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const query = readQuery(params.q);

  if (query.length === 0) {
    const topics = await listTopics({ limit: POPULAR_TOPIC_LIMIT });

    return (
      <Page>
        <SearchTrigger size="md" />

        <h1 className="text-display mt-6 leading-[1.1]">{copy.search.title}</h1>
        <p className="text-body mt-3 max-w-[560px] text-muted-foreground">
          {copy.search.subtitle}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {EXAMPLE_QUERIES.map((example) => (
            <LinkButton
              key={example}
              href={`/search?q=${encodeURIComponent(example)}`}
              // 🚨 `prefetch={false}` is load-bearing. /search is force-dynamic,
              // so every prefetched query is a REAL Meilisearch round trip on
              // the server - a dozen of them fired the moment this page
              // painted, and the RSC prefetches for a dynamic route never
              // settled, so the page never reached network idle. Search results
              // are the last thing worth speculatively fetching anyway.
              prefetch={false}
              variant="elevated"
              size="md"
              className="font-normal"
            >
              {example}
            </LinkButton>
          ))}
        </div>

        {topics.length > 0 ? (
          <>
            <p className="text-eyebrow mt-7">{copy.search.popularTopics}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {topics.map((topic) => (
                <LinkButton
                  key={topic.slug}
                  href={`/search?q=${encodeURIComponent(topic.name)}`}
                  prefetch={false}
                  variant="outline"
                  size="sm"
                  className="font-normal"
                >
                  {topic.name}
                  <span className="font-mono text-[11px] text-subtle-foreground tabular">
                    {topic.episode_count}
                  </span>
                </LinkButton>
              ))}
            </div>
          </>
        ) : null}
      </Page>
    );
  }

  const results = await search({ q: query, limit: RESULT_LIMIT });

  // 🚨 Only claimed when it is actually true. "The word appears in no title" is
  // the strongest line on the page, and printing it above a result whose title
  // contains the word would discredit every other claim the site makes.
  const inNoTitle =
    results.hits.length > 0 &&
    results.hits.every(
      (hit) =>
        !hit.episode.title
          .toLocaleLowerCase("bg")
          .includes(query.toLocaleLowerCase("bg")),
    );

  return (
    <Page>
      <SearchTrigger size="md" initialQuery={query} />

      {results.total === 0 ? (
        <EmptyState
          className="mt-5"
          variant="card"
          titleAs="h1"
          title={copy.search.zeroTitle}
          body={copy.search.zeroBody}
          action={
            <Link
              href="/episodes"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg", block: true }),
              )}
            >
              {copy.search.zeroCta}
            </Link>
          }
        />
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-baseline gap-2.5">
            <h1 className="text-h2">
              {copy.search.resultsFor(copy.search.resultCount(results.total), query)}
            </h1>
            {results.processing_ms != null ? (
              <span className="ml-auto font-mono text-[11px] text-faint-foreground tabular">
                {copy.search.tookMs(results.processing_ms)}
              </span>
            ) : null}
          </div>

          {inNoTitle ? (
            <p className="mt-2 text-small text-subtle-foreground">
              {copy.search.notInAnyTitle}
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-3">
            {results.hits.map((hit) => (
              <SearchResultCard
                key={hit.episode.youtube_id}
                hit={hit}
                query={query}
              />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
