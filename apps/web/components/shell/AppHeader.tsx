"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";

import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { Logo } from "@/components/shell/Logo";
import { SettingsSheet } from "@/components/shell/SettingsSheet";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { ReportSheetButton } from "@/components/shared/ReportDialog";
import { Button } from "@/components/ui/button";
import type { Me } from "@/lib/api/podcast";
import { viewerApi } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * The site header. 54px on mobile, 64px on desktop, sticky on both.
 *
 * It takes the `raised` shadow only once the page has scrolled - a shadow
 * sitting under a header at scroll position 0 reads as a rendering artefact
 * rather than depth.
 */
export function AppHeader() {
  const copy = useCopy();
  const pathname = usePathname();
  const { signedIn } = useViewerAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  /**
   * 🚨 The SAME query key the profile page and the avatar picker use, and that
   * is the whole fix: picking a new icon invalidates `["me"]`, so this avatar
   * had to be reading the same cache entry to follow it. It was not reading
   * anything at all - it rendered a neutral initials tile forever, so choosing
   * an icon changed the profile page and left the header showing the old one.
   *
   * Deduped by TanStack Query, so on /me this is the profile page's own
   * in-flight request rather than a second round trip.
   */
  const me = useQuery({
    queryKey: ["me"],
    enabled: signedIn,
    retry: false,
    queryFn: ({ signal }) =>
      viewerApi.get<Me>("/api/me", { signal, cache: "no-store" }),
  });

  // 🚨 Built inside the component, not at module scope. A module-level table
  // would capture whichever dictionary happened to be loaded first and would
  // never re-render on a locale change.
  const topNav = [
    { href: "/channels", label: copy.nav.channels },
    { href: "/episodes", label: copy.nav.episodes },
    { href: "/leaderboard", label: copy.nav.leaderboard },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-40 flex h-[54px] shrink-0 items-center gap-2.5 border-b border-border bg-background px-3",
          "md:h-16 md:gap-[22px] md:px-8",
          scrolled && "shadow-raised",
        )}
      >
        <Logo size="sm" className="tap-target md:hidden" />
        <Logo size="md" className="hidden md:flex" />

        <nav className="hidden shrink-0 gap-0.5 md:flex" aria-label={copy.nav.sectionNav}>
          {topNav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center rounded-[9px] px-3 text-sm font-medium transition-colors duration-120",
                  active
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* 🚨 The header search field and the mobile search button are both
            gone (owner call, 2026-08-15): search was reachable from three
            places at once - here, the home page hero, and /search - and the
            header copy was the one nobody used. `/search` is still in the
            bottom nav on mobile and the footer on desktop, and the home page
            IS the search page, so nothing became unreachable. */}
        <span className="flex-1" />

        <div className="ml-auto flex items-center gap-2">
          {/* 🚨 Reporting used to be reachable from the DESKTOP FOOTER and from
              an episode page, and nowhere else - and the footer is
              `hidden md:block`, so on a phone the only way to say "this is
              broken" was to be standing on the broken episode. This is the
              site-wide entry point: it carries no target, opens over the
              current page, and is on every route at every width. */}
          <ReportSheetButton />

          {/* Theme moved in here with language: a bare sun/moon icon was the
              only "setting" on the site and nobody found it. */}
          <Button
            variant="elevated"
            size="icon"
            shape="rounded"
            aria-label={copy.nav.openSettings}
            onClick={() => setSettingsOpen(true)}
            className="tap-target text-muted-foreground"
          >
            <Settings className="size-[17px]" aria-hidden strokeWidth={2.2} />
          </Button>

          <Link
            href="/me"
            aria-label={copy.nav.profile}
            className="tap-target rounded-pill outline-none"
          >
            <PersonAvatar
              name={copy.nav.profile}
              imageUrl={me.data?.avatar_url}
              size="sm"
              neutral
            />
          </Link>
        </div>
      </header>

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
