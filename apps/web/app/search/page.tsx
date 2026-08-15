import Link from "next/link";
import type { Metadata } from "next";

import { SearchResultCard } from "@/components/search/SearchResultCard";
import { SearchTrigger } from "@/components/search/SearchTrigger";
import { EmptyState } from "@/components/shared/EmptyState";
import { Page } from "@/components/shell/Page";
import { buttonVariants, LinkButton } from "@/components/ui/button";
import type { SearchHit, TranscriptMatch } from "@/lib/api/podcast";
import { listTopics, search, searchTranscripts } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import {
  RESULT_LIMIT,
  SPOKEN_EPISODE_LIMIT,
  TRANSCRIPT_SEGMENT_LIMIT,
} from "@/lib/search-limits";
import { stripControlCharacters } from "@/lib/sanitize";
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

const POPULAR_TOPIC_LIMIT = 8;


/**
 * 🚨 Control characters are stripped before the query goes anywhere.
 *
 * `?q=a%00b` reaches this page as an ordinary string, and the API rejects a NUL
 * byte with a 400 - which, raised inside a Server Component, is an unhandled
 * throw and therefore a 500 page. The query is also echoed back into the
 * results heading and the search box, so it is user input rendered publicly.
 */
function readQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  return stripControlCharacters(raw).trim();
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

  /**
   * ⚡ Both halves of search, on one wait.
   *
   * These are independent questions answered by two indexes ("which episodes are
   * ABOUT this" and "where was this SAID"), so awaiting them in sequence would
   * have doubled the page's server time for no reason. Meilisearch answers each
   * in ~1-13ms; the round trip dominates, and there is now only one of those.
   *
   * 🚨 The transcript half is allowed to fail without taking the page with it.
   * Label matches are still a useful answer, and a 4xx/5xx thrown inside a
   * Server Component is an unhandled throw and therefore a 500 page - not a
   * degraded search. Meilisearch being down already comes back as
   * `available: false`; this catch covers the rest.
   */
  const [results, spoken] = await Promise.all([
    search({ q: query, limit: RESULT_LIMIT }),
    searchTranscripts({ q: query, limit: TRANSCRIPT_SEGMENT_LIMIT }).catch(() => null),
  ]);

  /**
   * Passages keyed by episode, so a label match and a spoken match for the same
   * episode land on ONE card instead of two competing ones.
   *
   * ℹ️ Passed whole. The card slices to what it renders, and because it is a
   * Server Component its props never cross the wire - only its OUTPUT does, so
   * slicing here changes the response by zero bytes (verified: byte-identical).
   * What the page costs is the passages it actually RENDERS; that is tuned with
   * MAX_PASSAGES and SPOKEN_EPISODE_LIMIT, not here.
   */
  const passagesByEpisode = new Map<string, TranscriptMatch[]>(
    (spoken?.hits ?? []).map((hit) => [hit.episode.youtube_id, hit.matches]),
  );

  const labelled = results.hits;
  const labelledIds = new Set(labelled.map((hit) => hit.episode.youtube_id));

  /**
   * 🎯 The episodes this feature exists for: nothing in the title, description
   * or community labels matches, but the words are spoken in the recording.
   * `баница` - an example query printed on this very page - matched zero
   * episodes before this section existed, while 173 passages said it out loud.
   *
   * They are shaped into a SearchHit with no label reasons because that is
   * exactly what they are: a match with no label behind it.
   */
  const spokenOnly: SearchHit[] = (spoken?.hits ?? [])
    .filter((hit) => !labelledIds.has(hit.episode.youtube_id))
    .slice(0, SPOKEN_EPISODE_LIMIT)
    .map((hit) => ({
      episode: hit.episode,
      matched_topics: [],
      matched_moments: [],
    }));

  const spokenSegmentCount = (spoken?.hits ?? []).reduce(
    (sum, hit) => sum + hit.matches.length,
    0,
  );
  const transcriptsDown = spoken != null && !spoken.available;
  const nothingAtAll = results.total === 0 && spokenOnly.length === 0;

  // 🚨 Only claimed when it is actually true. "The word appears in no title" is
  // the strongest line on the page, and printing it above a result whose title
  // contains the word would discredit every other claim the site makes.
  const inNoTitle =
    labelled.length > 0 &&
    labelled.every(
      (hit) =>
        !hit.episode.title
          .toLocaleLowerCase("bg")
          .includes(query.toLocaleLowerCase("bg")),
    );

  return (
    <Page>
      <SearchTrigger size="md" initialQuery={query} />

      {nothingAtAll ? (
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

          {spokenSegmentCount > 0 ? (
            <p className="mt-1 text-small text-subtle-foreground">
              {copy.search.spokenInCount(
                spoken?.total_segments ?? spokenSegmentCount,
                (spoken?.hits ?? []).length,
              )}
            </p>
          ) : null}

          {transcriptsDown ? (
            <p className="mt-2 text-small text-subtle-foreground">
              {copy.search.spokenUnavailable}
            </p>
          ) : null}

          {/*
            The two regions are addressable separately because they answer to
            two different endpoints. The e2e suite asserts each against the API
            that produced it; one merged list would only be checkable loosely.
          */}
          {labelled.length > 0 ? (
            <div data-testid="results-labelled" className="mt-4 flex flex-col gap-3">
              {labelled.map((hit) => (
                <SearchResultCard
                  key={hit.episode.youtube_id}
                  hit={hit}
                  query={query}
                  passages={passagesByEpisode.get(hit.episode.youtube_id)}
                />
              ))}
            </div>
          ) : null}

          {spokenOnly.length > 0 ? (
            <>
              <div className="mt-7 border-t border-border pt-5">
                <h2 className="text-h3">{copy.search.spokenHeading}</h2>
                <p className="mt-1.5 text-small text-subtle-foreground">
                  {copy.search.spokenSubtitle}
                </p>
              </div>
              <div data-testid="results-spoken" className="mt-4 flex flex-col gap-3">
                {spokenOnly.map((hit) => (
                  <SearchResultCard
                    key={hit.episode.youtube_id}
                    hit={hit}
                    query={query}
                    passages={passagesByEpisode.get(hit.episode.youtube_id)}
                    spokenOnly
                  />
                ))}
              </div>
            </>
          ) : null}

          {/*
            🚨 Printed whenever spoken results are on screen, never conditionally
            softened. Captions exist for ~30% of the catalogue and coverage runs
            from 99% on one channel to 0% on another, so "not in the results" is
            not evidence of "never said".
          */}
          {spokenSegmentCount > 0 ? (
            <p className="mt-5 text-small text-faint-foreground">
              {copy.search.spokenPartial}
            </p>
          ) : null}
        </>
      )}
    </Page>
  );
}
