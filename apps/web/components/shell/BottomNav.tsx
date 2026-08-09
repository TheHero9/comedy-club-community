"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, List, Search, User } from "lucide-react";

import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * The mobile bottom bar, 66px.
 *
 * 🚨 It is REPLACED by the episode action bar on `/e/:id`, never stacked with
 * it. Two fixed bars at the bottom of a 844px screen eat 132px and put the
 * primary action of the page above a nav the user did not ask for.
 */
const ITEMS = [
  { href: "/", label: copy.nav.home, icon: House, exact: true },
  { href: "/episodes", label: copy.nav.episodes, icon: List, exact: false },
  { href: "/search", label: copy.nav.search, icon: Search, exact: false },
  { href: "/me", label: copy.nav.profile, icon: User, exact: false },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  // The episode route owns the bottom of the screen.
  if (pathname.startsWith("/e/")) return null;

  return (
    <nav
      aria-label={copy.nav.primaryNav}
      className="fixed inset-x-0 bottom-0 z-30 flex h-[66px] border-t border-border bg-card-2 md:hidden"
    >
      {ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-120",
              active ? "text-primary-text" : "text-subtle-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden strokeWidth={2.2} />
            <span
              className={cn(
                "text-[10.5px]",
                active ? "font-semibold" : "font-normal",
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
