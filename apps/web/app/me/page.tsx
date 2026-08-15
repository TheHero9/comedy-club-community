"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { EpisodeRow } from "@/components/episode/EpisodeCard";
import { InstallAppGuide } from "@/components/profile/InstallAppGuide";
import { SignedOutNotice } from "@/components/profile/SignedOutNotice";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { Page, StatTile } from "@/components/shell/Page";
import { Skeleton } from "@/components/ui/skeleton";
import type { EpisodeList, Me } from "@/lib/api/podcast";
import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { Button } from "@/components/ui/button";
import { viewerApi } from "@/lib/auth";
import { useCopy } from "@/components/i18n/LocaleProvider";

/**
 * The signed-in user's profile.
 *
 * ⚠️ The design also puts a "Как оценяваш" histogram of the user's own 1-10
 * distribution on this page. It is NOT built, and it cannot be without an API
 * change: `/api/me/ratings` returns the EPISODES a user rated, not the scores
 * they gave, so the only way to draw the histogram today is one
 * `/api/episodes/{id}/me` request per rated episode - 122 requests for the
 * seeded profile. It is listed in the handoff report as needing a
 * `score_distribution` field on `/api/me`.
 *
 * Client Component: everything here is behind the viewer's token, so none of
 * it is cacheable or indexable and there is nothing to gain from rendering it
 * on the server.
 */

export default function ProfilePage() {
  const copy = useCopy();
  // `key` indexes into the /api/me payload, so it is typed against Me rather
  // than left as a widened string - otherwise `me[link.key]` is an implicit any.
  const LINKS: ReadonlyArray<{
    href: string;
    label: string;
    key: "rating_count" | "watched_count" | "favorite_count" | null;
  }> = [
    { href: "/me/ratings", label: copy.profile.linkRatings, key: "rating_count" },
    { href: "/me/history", label: copy.profile.linkHistory, key: "watched_count" },
    { href: "/me/favorites", label: copy.profile.linkFavorites, key: "favorite_count" },
    { href: "/me/tags", label: copy.profile.linkTags, key: null },
  ];
  const { signedIn, canSignIn, signOut } = useViewerAuth();
  const profile = useQuery({
    queryKey: ["me"],
    enabled: signedIn,
    retry: false,
    queryFn: ({ signal }) =>
      viewerApi.get<Me>("/api/me", { signal, cache: "no-store" }),
  });

  const history = useQuery({
    queryKey: ["me", "watched"],
    enabled: signedIn,
    retry: false,
    queryFn: ({ signal }) =>
      viewerApi.get<EpisodeList>("/api/me/watched", {
        query: { limit: 6 },
        signal,
        cache: "no-store",
      }),
  });

  if (!signedIn || profile.isError) {
    return (
      <Page>
        <h1 className="text-h1">{copy.nav.profile}</h1>
        <div className="mt-5">
          <SignedOutNotice />
        </div>
        <div className="mt-5">
          <InstallAppGuide />
        </div>
      </Page>
    );
  }

  const me = profile.data;

  return (
    <Page>
      <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            <PersonAvatar
              name={me?.display_name || me?.username || copy.nav.profile}
              size="lg"
              neutral
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-h1">
                {me ? me.display_name || me.username : <Skeleton className="h-7 w-40" />}
              </h1>
              {me ? (
                <div className="mt-1.5 flex items-center gap-2">
                  {/*
                    🚨 `handle` is the user's YOUTUBE handle and is NULL until
                    someone links it. It is NOT the Django username and must
                    never fall back to it: for anyone signed in with Google that
                    username IS the Clerk `sub`, so `@{me.username}` printed
                    `@user_33Kq...` directly under a heading showing the exact
                    same string. Two identical junk ids is what the owner saw on
                    their first sign-in.

                    With no handle we say so, rather than inventing one.
                  */}
                  <span className="font-mono text-[12.5px] text-subtle-foreground">
                    {me.handle ? `@${me.handle}` : copy.profile.noHandle}
                  </span>
                  {me.memberships.some((membership) => membership.is_verified) ? (
                    <span className="inline-flex h-[22px] items-center rounded-pill bg-elevated px-2 text-[11px] font-semibold text-gold">
                      {copy.profile.memberBadge}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4.5 grid grid-cols-3 gap-2.5">
            <StatTile
              value={me ? String(me.rating_count) : "-"}
              label={copy.profile.statRatings}
            />
            <StatTile
              value={me ? String(me.watched_count) : "-"}
              label={copy.profile.statWatched}
            />
            <StatTile
              value={me ? String(me.favorite_count) : "-"}
              label={copy.profile.statFavorites}
            />
          </div>

          <nav className="mt-4 flex flex-col gap-2">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex min-h-[52px] items-center gap-3 rounded-xl border border-border bg-card px-3.5 outline-none"
              >
                <span className="flex-1 text-[14.5px]">{link.label}</span>
                <span className="font-mono text-[12.5px] text-subtle-foreground tabular">
                  {me && link.key ? me[link.key] : ""}
                </span>
                <ChevronRight
                  className="size-4 text-faint-foreground"
                  aria-hidden
                  strokeWidth={2.2}
                />
              </Link>
            ))}
          </nav>

          {/* Sign-out exists only in Clerk mode; the dev identity is a build
              setting, not a session, so there is nothing to sign out of. */}
          {canSignIn ? (
            <Button
              variant="outline"
              size="lg"
              className="mt-4"
              onClick={signOut}
            >
              {copy.auth.signOut}
            </Button>
          ) : null}
        </div>

        <section className="hidden rounded-2xl border border-border bg-card p-4 md:block">
          <h2 className="text-section-label">{copy.profile.historyTitle}</h2>
          {history.data && history.data.items.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {history.data.items.map((episode) => (
                <EpisodeRow key={episode.youtube_id} episode={episode} />
              ))}
            </div>
          ) : (
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-subtle-foreground">
              {copy.watchLog.historyEmptyBody}
            </p>
          )}
        </section>
      </div>

      <div className="mt-8">
        <InstallAppGuide />
      </div>
    </Page>
  );
}
