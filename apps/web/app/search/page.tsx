import Link from "next/link";
import { AudioLines, CircleDashed, Tags, Type, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";

import { SearchResultCard } from "@/components/search/SearchResultCard";
import { SearchTrigger } from "@/components/search/SearchTrigger";
import { EmptyState } from "@/components/shared/EmptyState";
import { LinkPending } from "@/components/shared/LinkPending";
import { Page } from "@/components/shell/Page";
import { buttonVariants, LinkButton } from "@/components/ui/button";
import type { SearchHit, TranscriptHit, TranscriptMatch } from "@/lib/api/podcast";
import { search, searchTranscripts } from "@/lib/api/podcast";
import { getCopy } from "@/lib/locale";
import {
  API_SEARCH_MAX_LIMIT,
  API_TRANSCRIPT_MAX_LIMIT,
  RESULT_LIMIT,
  SEARCH_MAX_RESULTS,
  SPOKEN_LIMIT,
  SPOKEN_MAX_RESULTS,
} from "@/lib/search-limits";
import { stripControlCharacters } from "@/lib/sanitize";
import { queryTokens, titleMatchesQuery } from "@/lib/search-tokens";
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

/**
 * How many results this render should reach, read off a query parameter.
 *
 * 🚨 Clamped and floored. `Number("2.5")` is finite and positive, and a float
 * against an `int` query parameter is a 422 from the API - the same trap that
 * made the eleventh "load more" on /episodes serve a 500.
 */
function readWanted(
  value: string | string[] | undefined,
  first: number,
  max: number,
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed <= first) return first;
  return Math.min(parsed, max);
}

/**
 * Fetch up to `wanted` results in parallel offset pages.
 *
 * The API caps one request at 50, so anything past that is a second page rather
 * than a bigger ask. Pages are fetched together because they are independent:
 * sequential awaits would make "load more" cost one round trip per page.
 */
function pageOffsets(wanted: number, pageSize: number) {
  return Array.from({ length: Math.ceil(wanted / pageSize) }, (_unused, index) => ({
    limit: Math.min(pageSize, wanted - index * pageSize),
    offset: index * pageSize,
  }));
}

async function searchUpTo(query: string, wanted: number) {
  const chunks = await Promise.all(
    pageOffsets(wanted, API_SEARCH_MAX_LIMIT).map((page) =>
      search({ q: query, ...page }),
    ),
  );

  return {
    // The totals are the same on every page; the first is as good as any.
    total: chunks[0].total,
    totalFull: chunks[0].total_full,
    hits: chunks.flatMap((chunk) => chunk.hits),
  };
}

async function searchSpokenUpTo(query: string, wanted: number) {
  const chunks = await Promise.all(
    pageOffsets(wanted, API_TRANSCRIPT_MAX_LIMIT).map((page) =>
      searchTranscripts({ q: query, ...page }),
    ),
  );

  return {
    totalEpisodes: chunks[0].total_episodes,
    totalSegments: chunks[0].total_segments,
    available: chunks[0].available,
    hits: chunks.flatMap((chunk) => chunk.hits),
  };
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
  const wanted = readWanted(params.n, RESULT_LIMIT, SEARCH_MAX_RESULTS);
  const spokenWanted = readWanted(params.s, SPOKEN_LIMIT, SPOKEN_MAX_RESULTS);

  if (query.length === 0) {
    /**
     * 🚨 The empty search page is now ONE thing: the field, centred, with the
     * two lines that say what it reaches.
     *
     * The "popular topics" disclosure that used to sit under it is gone (owner
     * call, 2026-08-16). It had already been collapsed once for competing with
     * the field; collapsing it only made it a control nobody opened, sitting
     * below the one object the page exists for. And the topics it listed are
     * machine suggestions - a menu of them reads as "these are the subjects we
     * cover", which is exactly the wrong promise for a free-text search box.
     *
     * Centring is vertical as well as horizontal: `min-h` off the viewport
     * minus the header, so on a phone the field lands under the thumb instead
     * of at the top of an otherwise empty screen.
     */
    return (
      <Page className="flex min-h-[calc(100dvh-54px)] flex-col justify-center md:min-h-[calc(100dvh-64px)] md:justify-start md:pt-[12vh]">
        <div className="mx-auto w-full max-w-[620px] text-center">
          <h1 className="text-display leading-[1.1]">{copy.search.title}</h1>
          <p className="text-body mx-auto mt-3 max-w-[520px] text-muted-foreground">
            {copy.search.subtitle}
          </p>

          <SearchTrigger size="lg" className="mt-6" />

          {/* 🚨 States the REACH of search, and its limit, in the same breath.
              Transcript coverage is ~30% overall and runs 99% to 0% by channel,
              so "most episodes, though not all" is the strongest honest claim
              available. */}
          <p className="mx-auto mt-3.5 max-w-[520px] text-small text-subtle-foreground">
            {copy.search.scopeNote}
          </p>
        </div>
      </Page>
    );
  }

  /**
   * ⚡ Both halves of search, on one wait.
   *
   * These are independent questions answered by two indexes ("which episodes are
   * ABOUT this" and "where was this SAID"), so awaiting them in sequence would
   * have doubled the page's server time for no reason.
   *
   * 🚨 The transcript half is allowed to fail without taking the page with it.
   * Label matches are still a useful answer, and a 4xx/5xx thrown inside a
   * Server Component is an unhandled throw and therefore a 500 page - not a
   * degraded search. Meilisearch being down already comes back as
   * `available: false`; this catch covers the rest.
   */
  const [results, spoken] = await Promise.all([
    searchUpTo(query, wanted),
    searchSpokenUpTo(query, spokenWanted).catch(() => null),
  ]);

  /**
   * Passages keyed by episode, so a label match and a spoken match for the same
   * episode land on ONE card instead of two competing ones.
   */
  const passagesByEpisode = new Map<string, TranscriptMatch[]>(
    (spoken?.hits ?? []).map((hit) => [hit.episode.youtube_id, hit.matches]),
  );

  const labelled = results.hits;
  const labelledIds = new Set(labelled.map((hit) => hit.episode.youtube_id));

  /**
   * Three buckets out of one result set, in rank order within each.
   *
   * 🚨 The API's own ordering is preserved inside every bucket - this only
   * decides which heading a hit sits under. Two independent splits are applied,
   * and they mean different things:
   *
   *   - `match_kind` comes from the API and is a fact about the QUERY: did this
   *     episode match every word, or only some? A partial match is a real
   *     answer (a remembered phrase is rarely verbatim) but it is a weaker one,
   *     so it must never be interleaved with the full matches.
   *   - the title split is a fact about WHERE the words landed. People search
   *     for a title far more often than for a label, and a title hit ranked
   *     below three topic matches reads as "not found".
   */
  const fullMatches = labelled.filter((hit) => hit.match_kind !== "partial");
  const partialMatches = labelled.filter((hit) => hit.match_kind === "partial");
  const inTitle = fullMatches.filter((hit) => titleMatchesQuery(hit.episode.title, query));
  const elsewhere = fullMatches.filter(
    (hit) => !titleMatchesQuery(hit.episode.title, query),
  );

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
   *
   * 🚨 NOT sliced. The slice used to live here, hard-capped at six, and it is
   * what made the page render six cards under a line advertising thirteen
   * episodes. The cap is now a page SIZE that the fetch above honours and that
   * "load more" below can grow.
   */
  const spokenHits: TranscriptHit[] = (spoken?.hits ?? []).filter(
    (hit) => !labelledIds.has(hit.episode.youtube_id),
  );
  const spokenOnly: SearchHit[] = spokenHits.map((hit) => ({
    episode: hit.episode,
    matched_topics: [],
    matched_moments: [],
    match_kind: hit.match_kind,
  }));

  /**
   * ⚠️ Measured against the FETCHED episode count, not the rendered one.
   * Episodes that also matched a label are folded into the cards above, so the
   * rendered count is legitimately smaller - reading it here would hide the
   * "load more" while unfetched episodes still existed.
   */
  const fetchedSpoken = spoken?.hits.length ?? 0;
  const canLoadMoreSpoken =
    spoken != null && fetchedSpoken < spoken.totalEpisodes && spokenWanted < SPOKEN_MAX_RESULTS;
  const nextSpokenWanted = Math.min(spokenWanted + SPOKEN_LIMIT, SPOKEN_MAX_RESULTS);

  const transcriptsDown = spoken != null && !spoken.available;

  /**
   * 🚨 Based on what is RENDERABLE, not on a count.
   *
   * A count can be absent for reasons that have nothing to do with the query:
   * `total_episodes` is a field the API only started sending on 2026-08-16, and
   * the web deploys on every push while the API does not (see CLAUDE.md
   * § Production). During that window `totalEpisodes` is `undefined`, and a
   * check of `(spoken?.totalEpisodes ?? 0) === 0` would declare "Nothing
   * matches" over a page that has spoken cards to show - re-creating the exact
   * bug this section was built to fix, where `баница` reported nothing while
   * 173 passages said the word out loud.
   */
  const nothingAtAll = results.total === 0 && spokenOnly.length === 0;

  /** A one-word query cannot have partial matches, so the wording never implies it. */
  const multiWord = queryTokens(query).length >= 2;

  const searchHref = (next: { n?: number; s?: number }) => {
    const url = new URLSearchParams({ q: query });
    const n = next.n ?? wanted;
    const s = next.s ?? spokenWanted;
    if (n !== RESULT_LIMIT) url.set("n", String(n));
    if (s !== SPOKEN_LIMIT) url.set("s", String(s));
    return `/search?${url.toString()}`;
  };

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
          {/*
            🚨 The heading carries NO number, and that is the fix.

            It used to read "N episodes for <query>" where N was the label-match
            total alone - so a query with 2 label matches and 13 spoken ones
            printed "2 episodes" above 8 cards. There is no honest single number
            available either: the two halves are counted by two indexes and
            their overlap across the full result set is unknown, so any combined
            figure would be a guess presented as a fact.

            The two numbers that ARE exact go below, each next to the thing it
            counts and next to the section that renders it.
          */}
          <div className="mt-5">
            <h1 className="text-h2">{copy.search.resultsFor(query)}</h1>
            <div className="mt-2 flex flex-col gap-1">
              {results.total > 0 ? (
                <p className="text-small text-subtle-foreground">
                  {multiWord && results.totalFull < results.total
                    ? copy.search.summaryLabelledSplit(
                        results.totalFull,
                        results.total - results.totalFull,
                      )
                    : copy.search.summaryLabelled(results.total)}
                </p>
              ) : null}
              {spoken != null && spoken.totalEpisodes > 0 ? (
                <p className="text-small text-subtle-foreground">
                  {copy.search.summarySpoken(
                    spoken.totalEpisodes,
                    spoken.totalSegments,
                  )}
                </p>
              ) : null}
              {transcriptsDown ? (
                <p className="text-small text-subtle-foreground">
                  {copy.search.spokenUnavailable}
                </p>
              ) : null}
            </div>
          </div>

          {/*
            The regions are addressable separately because they answer to two
            different endpoints. The e2e suite asserts each against the API that
            produced it; one merged list would only be checkable loosely.
          */}
          {inTitle.length > 0 ? (
            <>
              {/* The heading only appears when another section has something to
                  contrast against. One labelled section with a heading above it
                  and nothing to compare to is just a label on the whole page. */}
              {elsewhere.length > 0 || partialMatches.length > 0 ? (
                <div className="mt-6">
                  <ResultsHeading title={copy.search.inTitleHeading} icon={Type} />
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
                  <ResultsHeading title={copy.search.elsewhereHeading} icon={Tags} />
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
            🎯 Matched SOME of the words. Kept, because requiring every word is
            how a search box answers "nothing matches" to a question that has
            hundreds of real answers - "счупен хладилник" matches zero episodes
            with both words and 128 with one. Kept SEPARATE and labelled,
            because a one-of-three-words hit shown as an equal is how a search
            box loses the user's trust in the results above it.
          */}
          {partialMatches.length > 0 ? (
            <>
              <div className="mt-7 border-t border-border pt-5">
                <ResultsHeading title={copy.search.partialHeading} icon={CircleDashed} />
                <p className="mt-1.5 text-small text-subtle-foreground">
                  {copy.search.partialSubtitle}
                </p>
              </div>
              <div data-testid="results-partial" className="mt-4 flex flex-col gap-3">
                {partialMatches.map((hit) => (
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
            🚨 The summary quotes exact totals, so a page that renders fewer than
            that MUST offer a way to reach the rest. It did not: the owner saw
            "38 episodes" above 21 cards and read it as a bug in search.
          */}
          {canLoadMore ? (
            <LinkButton
              href={searchHref({ n: nextWanted })}
              prefetch={false}
              /* 🚨 `scroll={false}`. Next restores scroll to the TOP on every
                 navigation by default, and "load more" IS a navigation here -
                 so clicking it threw the reader back to the heading and they
                 had to scroll past everything they had already read to reach
                 the new cards. The URL still changes, so the longer page is
                 shareable and survives a reload; only the jump is gone. */
              scroll={false}
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
                <ResultsHeading title={copy.search.spokenHeading} icon={AudioLines} />
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

              {/* 🚨 The spoken section never had one of these, which is the
                  other half of why "13 episodes" over six cards read as broken:
                  there was literally no way to see the other seven. */}
              {canLoadMoreSpoken ? (
                <LinkButton
                  href={searchHref({ s: nextSpokenWanted })}
                  prefetch={false}
                  /* 🚨 Same as above, and this is the one the owner hit: the
                     spoken section is the LAST thing on the page, so its load
                     more sits furthest from the top - and a scroll reset from
                     there is the most expensive one on the site. */
                  scroll={false}
                  variant="outline"
                  size="lg"
                  block
                  className="mt-5"
                >
                  {copy.search.spokenLoadMore}
                  <LinkPending />
                </LinkButton>
              ) : null}
            </>
          ) : null}

          {/*
            🚨 Printed whenever spoken results are on screen, never conditionally
            softened. Captions exist for ~30% of the catalogue and coverage runs
            from 99% on one channel to 0% on another, so "not in the results" is
            not evidence of "never said".
          */}
          {spokenOnly.length > 0 || passagesByEpisode.size > 0 ? (
            <p className="mt-5 text-small text-faint-foreground">
              {copy.search.spokenPartial}
            </p>
          ) : null}
        </>
      )}
    </Page>
  );
}

/**
 * A results-section heading.
 *
 * The four sections on this page answer four different questions ("in the
 * title", "somewhere else", "only some of your words", "said out loud"), and
 * as four same-weight Bulgarian headings they were indistinguishable while
 * scrolling. The icon is a `lucide-react` component, never an emoji.
 */
function ResultsHeading({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return (
    <h2 className="text-h3 flex items-center gap-2">
      <Icon
        className="size-[18px] shrink-0 text-subtle-foreground"
        aria-hidden
        strokeWidth={2.2}
      />
      {title}
    </h2>
  );
}
