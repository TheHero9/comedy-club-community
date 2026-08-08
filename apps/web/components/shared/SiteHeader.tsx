import Link from "next/link";
import { Mic, Search } from "lucide-react";

import { copy } from "@/lib/copy";

const NAV = [
  { href: "/channels", label: copy.nav.channels },
  { href: "/episodes", label: copy.nav.episodes },
  { href: "/search", label: copy.nav.search },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
        >
          <Mic className="h-5 w-5" aria-hidden />
          <span className="hidden sm:inline">{copy.app.shortName}</span>
        </Link>

        <nav className="flex flex-1 items-center gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/search"
          aria-label={copy.nav.search}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Search className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </header>
  );
}
