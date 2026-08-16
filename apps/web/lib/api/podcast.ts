/**
 * Typed data access for the podcast API.
 *
 * Every function here is safe to call from a Server Component. Response types
 * come from @ccc/api-types, which is generated from the API's OpenAPI schema -
 * no API shape is ever hand-written.
 */
import type { Schema } from "@ccc/api-types";

import { api, type QueryParams } from "./client";

export type Channel = Schema<"ChannelOut">;
export type EpisodeBrief = Schema<"EpisodeBriefOut">;
export type Episode = Schema<"EpisodeOut">;
export type EpisodeList = Schema<"EpisodeListOut">;
export type ChannelGrid = Schema<"ChannelGridOut">;
export type Topic = Schema<"TopicOut">;
export type Person = Schema<"PersonOut">;
export type PersonDetail = Schema<"PersonDetailOut">;
export type Moment = Schema<"MomentOut">;
export type Comment = Schema<"CommentOut">;
export type CommentList = Schema<"CommentListOut">;
export type SearchResult = Schema<"SearchOut">;
export type SearchHit = Schema<"SearchHitOut">;
export type TranscriptSearchResult = Schema<"TranscriptSearchOut">;
export type TranscriptHit = Schema<"TranscriptHitOut">;
export type TranscriptMatch = Schema<"TranscriptMatchOut">;
export type Leaderboard = Schema<"LeaderboardOut">;
export type Me = Schema<"MeOut">;
export type Membership = Schema<"MembershipOut">;
export type AvatarIcon = Schema<"AvatarIconOut">;
export type ViewerState = Schema<"ViewerStateOut">;
export type WatchSummary = Schema<"WatchSummaryOut">;
export type RatingResult = Schema<"RatingOut">;
export type FavoriteResult = Schema<"FavoriteOut">;
export type EpisodeCast = Schema<"EpisodeCastOut">;
export type Proposal = Schema<"ProposalOut">;
export type ProposalQueueItem = Schema<"ProposalQueueOut">;
export type Report = Schema<"ReportOut">;
export type PersonBrief = Schema<"PersonBriefOut">;
export type AdminUser = Schema<"UserAdminOut">;

/**
 * Public content changes at most once a day (the ingestion sync), so a short
 * revalidate keeps pages fast without serving stale ratings for long.
 */
const PUBLIC_CACHE = { next: { revalidate: 60 } } as const;

/**
 * Reads a member can CHANGE FROM THE PAGE THEY ARE LOOKING AT.
 *
 * 🚨 These must not sit in the fetch cache, and the reason is a bug report, not
 * a preference. 2026-08-16: "I'm pretty sure I added something - why is it
 * gone? ... now it appears apparently, which was super strange." A moment was
 * added, the client list updated correctly, the member navigated away and came
 * back - and the server re-rendered from a cached response captured BEFORE the
 * write. Their own contribution was missing for up to a minute and then
 * returned on its own, which reads as the site losing data.
 *
 * ⚠️ `router.refresh()` does not fix this: it explicitly does not invalidate
 * the server-side fetch cache. Nor can a write hook - the writes go from the
 * browser straight to Django, so Next never learns about them.
 *
 * The cost is one uncached API call per episode render, measured in tens of
 * milliseconds against endpoints that answer in single digits. The payload is
 * unchanged, so the perf budgets are unaffected - caching is not what those
 * measure.
 */
const LIVE_CACHE = { cache: "no-store" } as const;

/** Leaderboard kinds the API accepts. Anything else is a 404 by design. */
export const LEADERBOARD_KINDS = {
  top: "top_rated",
  elite: "top_elite",
  mostRated: "most_rated",
} as const;

export type LeaderboardKey = keyof typeof LEADERBOARD_KINDS;

export function listChannels() {
  return api.get<Channel[]>("/api/channels", PUBLIC_CACHE);
}

export function getChannel(slug: string) {
  return api.get<Channel>(`/api/channels/${encodeURIComponent(slug)}`, PUBLIC_CACHE);
}

export function getChannelGrid(slug: string, score: "public" | "elite" = "public") {
  return api.get<ChannelGrid>(`/api/channels/${encodeURIComponent(slug)}/grid`, {
    query: { score },
    ...PUBLIC_CACHE,
  });
}

export function listEpisodes(params: QueryParams = {}) {
  return api.get<EpisodeList>("/api/episodes", { query: params, ...PUBLIC_CACHE });
}

export function getEpisode(youtubeId: string) {
  return api.get<Episode>(
    `/api/episodes/${encodeURIComponent(youtubeId)}`,
    PUBLIC_CACHE,
  );
}

export function listMoments(youtubeId: string) {
  return api.get<Moment[]>(
    `/api/episodes/${encodeURIComponent(youtubeId)}/moments`,
    LIVE_CACHE,
  );
}

/**
 * Confirmed cast and open proposals, as the API returns them: two lists.
 *
 * 🚨 Do not merge them for convenience. Only `confirmed` exists in
 * EpisodeParticipant, so only `confirmed` is what search and `?person=` agree
 * with - a blended list invites rendering a pending guess as fact.
 */
export function listCast(youtubeId: string) {
  return api.get<EpisodeCast>(
    `/api/episodes/${encodeURIComponent(youtubeId)}/participants`,
    LIVE_CACHE,
  );
}

export function listComments(youtubeId: string, params: QueryParams = {}) {
  return api.get<CommentList>(
    `/api/episodes/${encodeURIComponent(youtubeId)}/comments`,
    { query: params, ...LIVE_CACHE },
  );
}

export function listTopics(params: QueryParams = {}) {
  return api.get<Topic[]>("/api/topics", { query: params, ...PUBLIC_CACHE });
}

export function listPeople() {
  return api.get<Person[]>("/api/people", PUBLIC_CACHE);
}

export function getPerson(slug: string) {
  return api.get<PersonDetail>(
    `/api/people/${encodeURIComponent(slug)}`,
    PUBLIC_CACHE,
  );
}

export function getLeaderboard(kind: string, params: QueryParams = {}) {
  return api.get<Leaderboard>(`/api/leaderboards/${encodeURIComponent(kind)}`, {
    query: params,
    ...PUBLIC_CACHE,
  });
}

/** Search is never cached - a stale search result is worse than a slow one. */
export function search(params: QueryParams) {
  return api.get<SearchResult>("/api/search", { query: params, cache: "no-store" });
}

/**
 * Where a phrase was SPOKEN, with timestamps.
 *
 * 🚨 This is the OTHER half of search and it must always be issued alongside
 * `search()`, never instead of it. `/api/search` answers "which episodes are
 * ABOUT this" from titles, descriptions and community labels; this answers
 * "where was this SAID". Running only the first is why `баница` - an example
 * query printed on the search page itself - reported zero results while 173
 * passages across 33 episodes said the word out loud.
 *
 * ⚠️ Coverage is ~30% of the catalogue and heavily channel-dependent, so an
 * episode absent from these results has NOT been ruled out. The UI must say so.
 */
export function searchTranscripts(params: QueryParams) {
  return api.get<TranscriptSearchResult>("/api/search/transcripts", {
    query: params,
    cache: "no-store",
  });
}

export function suggest(query: string) {
  return api.get<string[]>("/api/search/suggest", {
    query: { q: query },
    cache: "no-store",
  });
}
