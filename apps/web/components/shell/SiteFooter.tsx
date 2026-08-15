import Link from "next/link";

import { getCopy } from "@/lib/locale";

/**
 * Desktop footer. Hidden on mobile, where the bottom bar already carries
 * navigation and 66px of chrome is as much as a 390px screen should give up.
 */
export async function SiteFooter() {
  const copy = await getCopy();

  const BROWSE_LINKS = [
    { href: "/channels", label: copy.nav.channels },
    { href: "/episodes", label: copy.nav.episodes },
  ];

  const SITE_LINKS = [
    { href: "/leaderboard", label: copy.nav.leaderboard },
    { href: "/status", label: copy.nav.status },
  ];

  return (
    <footer className="hidden md:block">
      <div className="mx-auto flex max-w-[1216px] items-start gap-10 border-t border-border px-8 pt-[22px] pb-10">
        <div className="max-w-[320px]">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="size-6 rounded-sm bg-primary" />
            {/* 🔬 `data-testid` is load-bearing, not decoration.
                `e2e/invisible-failures.spec.ts` 9.4 proves the Cyrillic font
                subset is really loaded by comparing a Cyrillic heading against
                LATIN text in the same face (Unbounded). It used to anchor on
                the header wordmark, which was removed on 2026-08-15 - this is
                now the site's only stable Latin display-face string. */}
            <span
              data-testid="footer-wordmark"
              className="font-display text-[13px] font-bold"
            >
              {copy.app.name}
            </span>
          </div>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-subtle-foreground">
            {copy.nav.footerBlurb}
          </p>
        </div>

        <div className="flex gap-9 text-[13px] text-muted-foreground">
          <FooterColumn heading={copy.nav.columnBrowse} links={BROWSE_LINKS} />
          <FooterColumn heading={copy.nav.columnSite} links={SITE_LINKS} />
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: ReadonlyArray<{ href: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10.5px] text-faint-foreground">
        {heading}
      </span>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="text-[13px] transition-colors duration-120 hover:text-foreground"
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
