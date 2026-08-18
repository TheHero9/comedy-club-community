"use client";

import { ArrowUpRight, Mail } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { CONTACT, instagramUrl, mailtoUrl } from "@/lib/contact";

/** Anything that can stand in for a lucide icon in the rows below. */
type Glyph = React.ComponentType<{
  className?: string;
  strokeWidth?: number;
  "aria-hidden"?: boolean;
}>;

/**
 * 🚨 Inline SVG, not an icon import: `lucide-react` v1 removed every BRAND
 * icon, so `Instagram` no longer exists and `import { Instagram }` fails
 * typecheck. Drawn to lucide geometry (24 box, `currentColor`, round caps) so
 * it sits at the same visual weight as the `Mail` beside it, and marked
 * `aria-hidden` because the row already says the word.
 *
 * This is NOT a licence to hand-roll icons generally - lucide stays the source
 * for everything it still ships.
 */
function InstagramGlyph({
  className,
  strokeWidth = 2,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

/**
 * "Who runs this and how do I reach them", on the profile page.
 *
 * 🚨 It renders in BOTH branches of /me - signed in and signed out. Someone who
 * cannot sign in is exactly the person who most needs the address, and the
 * signed-out branch returns early, so leaving it out of that one would hide it
 * from the only visitor it was written for.
 *
 * The desktop footer is `hidden md:block`, so on a phone this page is the only
 * place a contact detail can live and still be reachable from the bottom bar.
 *
 * A row whose value is empty in `lib/contact.ts` is dropped rather than
 * rendered as a dead link, so unpublishing a channel is a one-line change
 * there and needs no edit here.
 */
export function HelpContact() {
  const copy = useCopy();

  const rows: ReadonlyArray<{
    href: string;
    /** The icon COMPONENT, never a glyph on the data shape. */
    icon: Glyph;
    label: string;
    value: string;
    /** `mailto:` hands off to a mail client and must not open a blank tab. */
    external: boolean;
  }> = [
    ...(CONTACT.instagram
      ? [
          {
            href: instagramUrl(CONTACT.instagram),
            icon: InstagramGlyph,
            label: copy.profile.helpInstagram,
            value: `@${CONTACT.instagram}`,
            external: true,
          },
        ]
      : []),
    ...(CONTACT.email
      ? [
          {
            href: mailtoUrl(CONTACT.email, copy.profile.helpEmailSubject),
            icon: Mail,
            label: copy.profile.helpEmail,
            value: CONTACT.email,
            external: false,
          },
        ]
      : []),
  ];

  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="text-section-label">{copy.profile.helpTitle}</h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-subtle-foreground">
        {copy.profile.helpBody}
      </p>
      <div className="mt-3 flex flex-col gap-2 md:flex-row">
        {rows.map((row) => (
          <a
            key={row.href}
            href={row.href}
            target={row.external ? "_blank" : undefined}
            rel={row.external ? "noopener noreferrer" : undefined}
            className="flex min-h-[52px] flex-1 items-center gap-3 rounded-xl border border-border bg-background px-3.5 outline-none transition-colors duration-120 hover:border-border-3"
          >
            <row.icon
              className="size-[18px] shrink-0 text-subtle-foreground"
              aria-hidden
              strokeWidth={2.2}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] text-subtle-foreground">
                {row.label}
              </span>
              {/* `break-all` because an address is one unbreakable token and a
                  390px row is narrower than several real ones. */}
              <span className="block text-[13.5px] break-all">{row.value}</span>
            </span>
            <ArrowUpRight
              className="size-4 shrink-0 text-faint-foreground"
              aria-hidden
              strokeWidth={2.2}
            />
          </a>
        ))}
      </div>
    </section>
  );
}
