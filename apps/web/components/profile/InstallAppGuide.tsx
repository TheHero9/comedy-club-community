import { MonitorDown, Smartphone, TabletSmartphone } from "lucide-react";

import { copy } from "@/lib/copy";

/**
 * Per-platform "add to home screen" instructions.
 *
 * This is a website, not a store app, and that is invisible to most people -
 * so the profile page spells out the three install paths precisely. The
 * manifest (app/manifest.ts) is what makes the result feel like an app: our
 * icon, our name pre-filled, standalone window.
 */
const PLATFORMS = [
  { icon: Smartphone, title: copy.install.androidTitle, steps: copy.install.androidSteps },
  { icon: TabletSmartphone, title: copy.install.iosTitle, steps: copy.install.iosSteps },
  { icon: MonitorDown, title: copy.install.desktopTitle, steps: copy.install.desktopSteps },
] as const;

export function InstallAppGuide() {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="text-section-label">{copy.install.title}</h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-subtle-foreground">
        {copy.install.body}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {PLATFORMS.map((platform) => (
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
    </section>
  );
}
