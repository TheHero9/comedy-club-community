"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";

import { EpisodeCard } from "@/components/episode/EpisodeCard";
import { SignedOutNotice } from "@/components/profile/SignedOutNotice";
import { EmptyState } from "@/components/shared/EmptyState";
import { Page } from "@/components/shell/Page";
import { LinkButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { EpisodeList } from "@/lib/api/podcast";
import type { Schema } from "@ccc/api-types";
import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { viewerApi } from "@/lib/auth";
import { copy } from "@/lib/copy";

type PersonalTag = Schema<"PersonalTagOut">;

/**
 * The four lists behind the profile's navigation rows.
 *
 * One route rather than four near-identical files: they differ only in which
 * `/api/me/*` endpoint they read and what their empty state says.
 *
 * 🔒 `tags` is the odd one out and deliberately looks it. Personal tags are
 * PRIVATE - the API never returns them on a public endpoint - so they get a
 * treatment that can never be confused with a public topic chip: a dashed
 * violet border, violet text and a lock. That violet appears nowhere else in
 * the product.
 */
const LISTS = {
  ratings: {
    path: "/api/me/ratings",
    title: copy.profile.linkRatings,
    emptyTitle: copy.profile.ratingsEmptyTitle,
    emptyBody: copy.profile.ratingsEmptyBody,
    emptyCta: copy.profile.ratingsEmptyCta,
  },
  history: {
    path: "/api/me/watched",
    title: copy.profile.linkHistory,
    emptyTitle: copy.watchLog.historyEmptyTitle,
    emptyBody: copy.watchLog.historyEmptyBody,
    emptyCta: copy.watchLog.historyEmptyCta,
  },
  favorites: {
    path: "/api/me/favorites",
    title: copy.profile.linkFavorites,
    emptyTitle: copy.profile.linkFavorites,
    emptyBody: copy.profile.ratingsEmptyBody,
    emptyCta: copy.profile.ratingsEmptyCta,
  },
  tags: {
    path: "/api/me/tags",
    title: copy.profile.linkTags,
    emptyTitle: copy.profile.tagsEmptyTitle,
    emptyBody: copy.profile.tagsEmptyBody,
    emptyCta: copy.profile.ratingsEmptyCta,
  },
} as const;

type ListKey = keyof typeof LISTS;

export default function ProfileListPage({ params }: PageProps<"/me/[list]">) {
  const { signedIn } = useViewerAuth();
  const { list } = use(params);
  if (!(list in LISTS)) notFound();

  const key = list as ListKey;
  const config = LISTS[key];
  const isTags = key === "tags";

  const query = useQuery({
    queryKey: ["me", key],
    enabled: signedIn,
    retry: false,
    queryFn: ({ signal }) =>
      viewerApi.get<EpisodeList | PersonalTag[]>(config.path, {
        query: isTags ? undefined : { limit: 24 },
        signal,
        cache: "no-store",
      }),
  });

  if (!signedIn || query.isError) {
    return (
      <Page>
        <h1 className="text-h1">{config.title}</h1>
        <div className="mt-5">
          <SignedOutNotice />
        </div>
      </Page>
    );
  }

  const tags = isTags ? ((query.data ?? []) as PersonalTag[]) : [];
  const episodes = isTags ? [] : ((query.data as EpisodeList | undefined)?.items ?? []);
  const empty = query.isSuccess && (isTags ? tags.length === 0 : episodes.length === 0);

  return (
    <Page>
      <h1 className="text-h1">{config.title}</h1>

      {query.isPending ? (
        <div className="mt-4.5 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="aspect-video rounded-[13px]" />
          ))}
        </div>
      ) : null}

      {empty ? (
        <EmptyState
          className="mt-5"
          variant="card"
          title={config.emptyTitle}
          body={config.emptyBody}
          action={
            <LinkButton href="/episodes" variant="outline" size="md">
              {config.emptyCta}
            </LinkButton>
          }
        />
      ) : null}

      {isTags && tags.length > 0 ? (
        <ul className="mt-4.5 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-pill border border-dashed border-private-border px-3.5 text-[13px] text-private"
            >
              <Lock className="size-3.5" aria-hidden strokeWidth={2.2} />
              {tag.text}
            </li>
          ))}
        </ul>
      ) : null}

      {!isTags && episodes.length > 0 ? (
        <div className="mt-4.5 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-4">
          {episodes.map((episode, index) => (
            <EpisodeCard
              key={episode.youtube_id}
              episode={episode}
              showRatingCount
              sizes="(min-width: 768px) 280px, 50vw"
              priority={index < 2}
            />
          ))}
        </div>
      ) : null}
    </Page>
  );
}
