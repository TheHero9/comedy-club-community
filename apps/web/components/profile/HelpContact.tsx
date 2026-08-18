"use client";

import { ArrowUpRight, ChevronDown, Mail, type LucideIcon } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { CONTACT, mailtoUrl } from "@/lib/contact";

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
 * ⚠️ COLLAPSED by default (owner call, 2026-08-18), like `InstallAppGuide`
 * directly above it. This is a one-time read that has to be FINDABLE, not
 * something to look at on every visit - and two open cards stacked at the
 * bottom of the profile competed for the same attention. A native <details>
 * keeps it keyboard- and screen-reader-accessible with zero client JS.
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
    icon: LucideIcon;
    label: string;
    value: string;
  }> = [
    ...(CONTACT.email
      ? [
          {
            href: mailtoUrl(CONTACT.email, copy.profile.helpEmailSubject),
            icon: Mail,
            label: copy.profile.helpEmail,
            value: CONTACT.email,
          },
        ]
      : []),
  ];

  if (rows.length === 0) return null;

  return (
    <details className="group rounded-2xl border border-border bg-card">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 [&::-webkit-details-marker]:hidden">
        <h2 className="text-section-label flex-1">{copy.profile.helpTitle}</h2>
        <ChevronDown
          className="size-4 text-faint-foreground transition-transform group-open:rotate-180"
          aria-hidden
          strokeWidth={2.2}
        />
      </summary>
      <div className="px-4 pb-4">
        <p className="text-[12.5px] leading-relaxed text-subtle-foreground">
          {copy.profile.helpBody}
        </p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          {rows.map((row) => (
            <a
              key={row.href}
              href={row.href}
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
      </div>
    </details>
  );
}
