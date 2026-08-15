import Link from "next/link";
import type { Metadata } from "next";

import { SearchResultCard } from "@/components/search/SearchResultCard";
import { SearchTrigger } from "@/components/search/SearchTrigger";
import { EmptyState } from "@/components/shared/EmptyState";
import { LinkPending } from "@/components/shared/LinkPending";
import { Page } from "@/components/shell/Page";
import { buttonVariants, LinkButton } from "@/components/ui/button";
import type { SearchHit, TranscriptMatch } from "@/lib/api/podcast";
import { listTopics, search, searchTranscripts } from "@/lib/api/podcast";
import { getCopy } from "@/lib/locale";
import {
  API_SEARCH_MAX_LIMIT,
  RESULT_LIMIT,
  SEARCH_MAX_RESULTS,
  SPOKEN_EPISODE_LIMIT,
  TRANSCRIPT_SEGMENT_LIMIT,
} from "@/lib/search-limits";
import { stripControlCharacters } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getCopy();
  return {
    title: copy.nav.search,
    description: copy.search.subtitle,
  };
}

/** Search results must never be cached: a stale answer is worse than a slow one. */
export const dynamic = "force-dynamic";

const POPULAR_TOPIC_LIMIT = 8;

/**
 * How many results this render should reach, read off `?n=`.
 *
 * 🚨 Clamped and floored. `Number("2.5")` is finite and positive, and a float
 * against an `int` query parameter is a 422 from the API - the same trap that
 * made the eleventh "load more" on /episodes serve a 500.
 */
function readWanted(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed <= RESULT_LIMIT) return RESULT_LIMIT;
  return Math.min(parsed, SEARCH_MAX_RESULTS);
}

/**
 * Fetch up to `wanted` label matches, in parallel offset pages.
 *
 * The API caps one request at 50 (`MAX_LIMIT` in `podcast/api/search.py`), so
 * anything past that is a second page rather than a bigger ask. Pages are
 * fetched together because they are independent: sequential awaits would make
 * "load more" cost one round trip per 50 results.
 */
async function searchUpTo(query: string, wanted: number) {
  const pages = Math.ceil(wanted / API_SEARCH_MAX_LIMIT);
  const chunks = await Promise.all(
    Array.from({ length: pages }, (_unused, index) =>
      search({
        q: query,
        limit: Math.min(API_SEARCH_MAX_LIMIT, wanted - index * API_SEARCH_MAX_LIMIT),
        offset: index * API_SEARCH_MAX_LIMIT,
      }),
    ),
  );

  return {
    // `total` is the same on every page; the first is as good as any.
    total: chunks[0].total,
    hits: chunks.flatMap((chunk) => chunk.hits),
  };
}

/**
 * Split label matches into "the words are in the TITLE" and everything else.
 *
 * 🚨 Title first, because that is how people search. A title hit ranked below
 * three topic matches reads as "not found" even when the episode is right
 * there, and the owner hit exactly that.
 *
 * Token overlap, not a substring test: a multi-word Bulgarian query almost
 * never appears verbatim in a title, so `includes(query)` would put nearly
 * everything in the second bucket and the split would do nothing. Tokens of one
 * or two characters are dropped - they are prepositions and would match any
 * title at all.
 */
const MIN_TOKEN_LENGTH = 3;

function titleMatches(title: string, query: string): boolean {
  const haystack = title.toLocaleLowerCase("bg");
  const tokens = query
    .toLocaleLowerCase("bg")
    .split(/\s+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);

  if (tokens.length === 0) {
    // A query made entirely of short words: fall back to the whole string, so
    // the section is never empty for a reason the reader cannot see.
    return haystack.includes(query.toLocaleLowerCase("bg"));
  }
  return tokens.some((token) => haystack.includes(token));
}


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
  const copy = await getCopy();
  const params = await searchParams;
  const query = readQuery(params.q);
  const wanted = readWanted(params.n);

  if (query.length === 0) {
    const topics = await listTopics({ limit: POPULAR_TOPIC_LIMIT });
    /**
     * Aliased before use rather than chained inline: `tests/copy.spec.ts` reads
     * `copy.search.examples.map` as a copy KEY and cannot resolve it.
     */
    const exampleQueries = copy.search.examples;

    return (
      <Page>
        <SearchTrigger size="md" />

        <h1 className="text-display mt-6 leading-[1.1]">{copy.search.title}</h1>
        <p className="text-body mt-3 max-w-[560px] text-muted-foreground">
          {copy.search.subtitle}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {exampleQueries.map((example) => (
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
              <LinkPending />
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
                  <LinkPending />
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
    searchUpTo(query, wanted),
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
   * Two buckets out of one result set, in rank order within each. The API's
   * relevance ordering is preserved - this only decides which heading a hit
   * sits under, never how hits are sorted.
   */
  const inTitle = labelled.filter((hit) => titleMatches(hit.episode.title, query));
  const elsewhere = labelled.filter((hit) => !titleMatches(hit.episode.title, query));

  /** More label matches exist than this render asked for. */
  const canLoadMore = labelled.length < results.total;
  const nextWanted = Math.min(wanted + RESULT_LIMIT, SEARCH_MAX_RESULTS);

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
          {/* 🚨 The "found in N ms" readout used to live here and is gone
              (owner call, 2026-08-15). It answered a question nobody asked, and
              on a page whose headline number is the RESULT count, a second
              number in the same row competed with it. */}
          <div className="mt-5 flex flex-wrap items-baseline gap-2.5">
            <h1 className="text-h2">
              {copy.search.resultsFor(copy.search.resultCount(results.total), query)}
            </h1>
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
          {inTitle.length > 0 ? (
            <>
              {/* The heading only appears when BOTH sections have something to
                  show. One labelled section with a heading above it and nothing
                  to contrast against is just a label on the whole page. */}
              {elsewhere.length > 0 ? (
                <div className="mt-6">
                  <h2 className="text-h3">{copy.search.inTitleHeading}</h2>
                  <p className="mt-1.5 text-small text-subtle-foreground">
                    {copy.search.inTitleSubtitle}
                  </p>
                </div>
              ) : null}
              <div data-testid="results-title" className="mt-4 flex flex-col gap-3">
                {inTitle.map((hit) => (
                  <SearchResultCard
                    key={hit.episode.youtube_id}
                    hit={hit}
                    query={query}
                    passages={passagesByEpisode.get(hit.episode.youtube_id)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {elsewhere.length > 0 ? (
            <>
              {inTitle.length > 0 ? (
                <div className="mt-7 border-t border-border pt-5">
                  <h2 className="text-h3">{copy.search.elsewhereHeading}</h2>
                  <p className="mt-1.5 text-small text-subtle-foreground">
                    {copy.search.elsewhereSubtitle}
                  </p>
                </div>
              ) : null}
              <div data-testid="results-elsewhere" className="mt-4 flex flex-col gap-3">
                {elsewhere.map((hit) => (
                  <SearchResultCard
                    key={hit.episode.youtube_id}
                    hit={hit}
                    query={query}
                    passages={passagesByEpisode.get(hit.episode.youtube_id)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {/*
            🚨 The header quotes `results.total`, so a page that renders fewer
            than that MUST offer a way to reach the rest. It did not: the owner
            saw "38 episodes" above 21 cards and read it as a bug in search.
          */}
          {canLoadMore ? (
            <LinkButton
              href={`/search?q=${encodeURIComponent(query)}&n=${nextWanted}`}
              prefetch={false}
              variant="outline"
              size="lg"
              block
              className="mt-5"
            >
              {copy.browse.loadMore}
              <LinkPending />
            </LinkButton>
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
