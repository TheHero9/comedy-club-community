"use client";

import { useState } from "react";
import Link from "next/link";

import { NavProgress } from "@/components/shared/NavProgress";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Crown,
  Heart,
  History,
  Pencil,
  ShieldCheck,
  Star,
  Tags,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { EpisodeRow } from "@/components/episode/EpisodeCard";
import { InstallAppGuide } from "@/components/profile/InstallAppGuide";
import { ProfileEditor } from "@/components/profile/ProfileEditor";
import { SignedOutNotice } from "@/components/profile/SignedOutNotice";
import { MyReports } from "@/components/shared/MyReports";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { Page, PageHeading, StatTile } from "@/components/shell/Page";
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
  const [editing, setEditing] = useState(false);
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
        <PageHeading title={copy.nav.profile} icon={UserRound} />
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

  /**
   * The profile's navigation rows.
   *
   * 🚨 Built inside the component, never at module scope: the labels come from
   * the dictionary, and a module-level table freezes whichever locale loaded
   * first and never follows a language change.
   *
   * `key` indexes into the /api/me payload, so it is typed against Me rather
   * than left as a widened string - otherwise `me[link.key]` is an implicit any.
   * `value` is the escape hatch for a row whose number is not one of those
   * tallies; memberships are counted from the array itself.
   */
  const LINKS: ReadonlyArray<{
    href: string;
    label: string;
    /**
     * 🚨 The icon COMPONENT, never an emoji and never a glyph on the data
     * shape. Five rows that differed only by a Bulgarian noun were four
     * identical grey bars to anyone scanning; the icon is what makes them
     * findable at a glance.
     */
    icon: LucideIcon;
    key: "rating_count" | "watched_count" | "favorite_count" | null;
    value?: string;
  }> = [
    { href: "/me/ratings", label: copy.profile.linkRatings, icon: Star, key: "rating_count" },
    { href: "/me/history", label: copy.profile.linkHistory, icon: History, key: "watched_count" },
    {
      href: "/me/favorites",
      label: copy.profile.linkFavorites,
      icon: Heart,
      key: "favorite_count",
    },
    { href: "/me/tags", label: copy.profile.linkTags, icon: Tags, key: null },
    {
      href: "/me/memberships",
      label: copy.profile.linkMemberships,
      icon: Crown,
      key: null,
      value: me ? String(me.memberships.length) : "",
    },
    // 🔒 Staff only - but that is PRESENTATION. The page itself and every
    // endpoint behind it re-check the role, because a hidden tile is not a
    // permission.
    ...(me?.role === "admin" || me?.role === "moderator"
      ? [
          {
            href: "/me/people",
            label: copy.manage.title,
            icon: ShieldCheck,
            key: null as null,
          },
        ]
      : []),
  ];

  return (
    <Page>
      <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="flex items-center gap-3.5">
            {/*
              🚨 The avatar IS the way into the icon picker. It used to live
              only behind an "Edit profile" button at the bottom of the nav
              rows, past five links - the owner's words were that it is "a bit
              difficult to find that you can actually change your icon there".
              Tapping your own picture to change it is the convention
              everywhere else, and it costs nothing to honour.

              A real <button> rather than a click handler on the span, so it is
              keyboard-reachable and announces itself. `group` + the overlay
              below make it look pressable without adding chrome that would
              sit on the picture permanently.
            */}
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={copy.profile.changeIcon}
              className="group relative shrink-0 rounded-pill outline-none"
            >
              <PersonAvatar
                name={me?.display_name || copy.profile.unnamed}
                imageUrl={me?.avatar_url}
                size="lg"
                neutral
              />
              <span
                aria-hidden
                className="absolute right-0 bottom-0 flex size-6 items-center justify-center rounded-pill border-2 border-background bg-elevated text-muted-foreground transition-colors duration-120 group-hover:text-foreground"
              >
                <Pencil className="size-3" strokeWidth={2.6} />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-h1">
                {me ? (
                  // 🚨 Never `me.username` as a fallback: for a Clerk account
                  // that IS the `sub`. An unset name says so plainly instead.
                  me.display_name || copy.profile.unnamed
                ) : (
                  <Skeleton className="h-7 w-40" />
                )}
              </h1>
              {me ? (
                <div className="mt-1.5 flex items-center gap-2">
                  {/*
                    🚨 NEVER falls back to `me.username`: for anyone signed in
                    with Google that username IS the Clerk `sub`, so
                    `@{me.username}` printed `@user_33Kq...` directly under a
                    heading showing the exact same string.

                    With no handle this is a prompt to set one, not an invented
                    value. It is a self-chosen nickname since 2026-08-15 and is
                    NOT proof of a YouTube identity.
                  */}
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="font-mono text-[12.5px] text-subtle-foreground outline-none hover:text-foreground"
                  >
                    {me.handle ? `@${me.handle}` : copy.profile.noHandle}
                  </button>
                  {/*
                    🚨 ANY membership earns the badge, verified or not (owner
                    ruling, 2026-08-16: "for now badges"). Verification is a
                    separate, stronger thing and it is the ONLY thing that lets
                    a rating count toward a channel's Elite score - so the badge
                    is social and the vote is earned, and conflating them here
                    would quietly let anyone into the elite average.
                  */}
                  {me.memberships.length > 0 ? (
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
                <link.icon
                  className="size-[18px] shrink-0 text-subtle-foreground"
                  aria-hidden
                  strokeWidth={2.2}
                />
                <span className="flex-1 text-[14.5px]">{link.label}</span>
                <span className="font-mono text-[12.5px] text-subtle-foreground tabular">
                  {link.value ?? (me && link.key ? me[link.key] : "")}
                </span>
                <ChevronRight
                  className="size-4 text-faint-foreground"
                  aria-hidden
                  strokeWidth={2.2}
                />
                <NavProgress />
            </Link>
            ))}
          </nav>

          {canSignIn ? (
            <Button
              variant="outline"
              size="lg"
              className="mt-4 w-full md:w-auto"
              onClick={() => setEditing(true)}
            >
              {copy.profile.editProfile}
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

      {/* 🚨 Sign-out lives at the very BOTTOM, past everything else.
          It used to sit directly under the profile's navigation rows, where it
          read as a fifth nav item - the most destructive action on the page,
          styled and placed like "My ratings". Down here it is deliberately out
          of the flow and hard to hit by accident.

          Clerk mode only: the dev identity is a build setting, not a session,
          so there is nothing to sign out of. */}
      {/* Closes the reporting loop: what a moderator decided, and why. */}
      <MyReports />

      {canSignIn ? (
        <div className="mt-10 border-t border-border pt-5">
          <Button
            variant="ghost"
            size="md"
            className="text-subtle-foreground"
            onClick={signOut}
          >
            {copy.auth.signOut}
          </Button>
        </div>
      ) : null}

      <ProfileEditor open={editing} onOpenChange={setEditing} me={me} />
    </Page>
  );
}
