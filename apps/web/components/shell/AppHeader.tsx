"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Settings } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { Logo } from "@/components/shell/Logo";
import { SearchOverlay } from "@/components/shell/SearchOverlay";
import { SettingsSheet } from "@/components/shell/SettingsSheet";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { Button } from "@/components/ui/button";
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

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
        <Logo size="sm" className="md:hidden" />
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

        {/* Desktop search trigger. Opens the overlay, never navigates. */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="hidden h-10 max-w-[400px] flex-1 items-center gap-2.5 rounded-lg border border-border-2 bg-card px-3.5 text-left text-[15px] text-subtle-foreground transition-colors duration-120 hover:border-border-3 md:flex"
        >
          <Search className="size-[17px] shrink-0" aria-hidden strokeWidth={2.2} />
          <span className="flex-1 truncate">{copy.search.trigger}</span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* Theme moved in here with language: a bare sun/moon icon was the
              only "setting" on the site and nobody found it. */}
          <Button
            variant="elevated"
            size="icon"
            shape="rounded"
            aria-label={copy.nav.openSettings}
            onClick={() => setSettingsOpen(true)}
            className="text-muted-foreground"
          >
            <Settings className="size-[17px]" aria-hidden strokeWidth={2.2} />
          </Button>

          <Button
            variant="elevated"
            size="icon"
            shape="rounded"
            aria-label={copy.nav.openSearch}
            onClick={() => setSearchOpen(true)}
            className="md:hidden"
          >
            <Search className="size-[18px]" aria-hidden strokeWidth={2.2} />
          </Button>

          <Link
            href="/me"
            aria-label={copy.nav.profile}
            className="rounded-pill outline-none"
          >
            <PersonAvatar name={copy.nav.profile} size="sm" neutral />
          </Link>
        </div>
      </header>

      <SearchOverlay open={searchOpen} onOpenChange={setSearchOpen} />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
