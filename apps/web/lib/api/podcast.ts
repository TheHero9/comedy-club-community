/**
 * Typed data access for the podcast API.
 *
 * Every function is safe to call from a Server Component. Response types come
 * from @ccc/api-types, which is generated from the API's OpenAPI schema - no API
 * shape is ever hand-written here.
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
export type Moment = Schema<"MomentOut">;
export type CommentList = Schema<"CommentListOut">;
export type SearchResult = Schema<"SearchOut">;
export type Leaderboard = Schema<"LeaderboardOut">;

/**
 * Public content changes at most once a day (the ingestion sync), so a short
 * revalidate keeps pages fast without serving stale ratings for long.
 */
const PUBLIC_CACHE = { next: { revalidate: 60 } } as const;

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
  return api.get<Episode>(`/api/episodes/${encodeURIComponent(youtubeId)}`, PUBLIC_CACHE);
}

export function listMoments(youtubeId: string) {
  return api.get<Moment[]>(
    `/api/episodes/${encodeURIComponent(youtubeId)}/moments`,
    PUBLIC_CACHE,
  );
}

export function listComments(youtubeId: string, params: QueryParams = {}) {
  return api.get<CommentList>(`/api/episodes/${encodeURIComponent(youtubeId)}/comments`, {
    query: params,
    ...PUBLIC_CACHE,
  });
}

export function listTopics(params: QueryParams = {}) {
  return api.get<Topic[]>("/api/topics", { query: params, ...PUBLIC_CACHE });
}

export function listPeople() {
  return api.get<Person[]>("/api/people", PUBLIC_CACHE);
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
