"use client";

import {
  ChevronDown,
  MonitorDown,
  Smartphone,
  TabletSmartphone,
} from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";

/**
 * Per-platform "add to home screen" instructions, collapsed by default.
 *
 * This is a website, not a store app, and that is invisible to most people -
 * so the profile page spells out the three install paths precisely. It is a
 * one-time read, so it folds away: a native <details> keeps it keyboard- and
 * screen-reader-accessible with zero client JS.
 *
 * The manifest (app/manifest.ts) is what makes the result feel like an app:
 * our icon, our name pre-filled, standalone window.
 */
export function InstallAppGuide() {
  const copy = useCopy();

  const platforms = [
    {
      icon: Smartphone,
      title: copy.install.androidTitle,
      steps: copy.install.androidSteps,
    },
    {
      icon: TabletSmartphone,
      title: copy.install.iosTitle,
      steps: copy.install.iosSteps,
    },
    {
      icon: MonitorDown,
      title: copy.install.desktopTitle,
      steps: copy.install.desktopSteps,
    },
  ];

  return (
    <details className="group rounded-2xl border border-border bg-card">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 [&::-webkit-details-marker]:hidden">
        <h2 className="text-section-label flex-1">{copy.install.title}</h2>
        <ChevronDown
          className="size-4 text-faint-foreground transition-transform group-open:rotate-180"
          aria-hidden
          strokeWidth={2.2}
        />
      </summary>
      <div className="px-4 pb-4">
        <p className="text-[12.5px] leading-relaxed text-subtle-foreground">
          {copy.install.body}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {platforms.map((platform) => (
            <div key={platform.title}>
              <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                <platform.icon
                  className="size-4 text-subtle-foreground"
                  aria-hidden
                  strokeWidth={2}
                />
                {platform.title}
              </h3>
              <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-[12.5px] leading-relaxed text-subtle-foreground">
                {platform.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
