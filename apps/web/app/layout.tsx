import type { Metadata, Viewport } from "next";
import { Unbounded, Onest, JetBrains_Mono } from "next/font/google";

import { AppHeader } from "@/components/shell/AppHeader";
import { BottomNav } from "@/components/shell/BottomNav";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { Toaster } from "@/components/ui/sonner";
import { copy } from "@/lib/copy";

import { Providers } from "./providers";
import "./globals.css";

/**
 * 🇧🇬 "cyrillic" is NOT optional on any of the three families. Every episode
 * title and community label is Bulgarian; with only the latin subset the
 * browser silently falls back per glyph, so a title renders half in the chosen
 * face and half in a system serif. That shipped once already and passed
 * typecheck, lint and build - `e2e/invisible-failures.spec.ts` now pins it.
 *
 * All three are variable fonts, so no `weight` is declared: Next serves the
 * variable file and the whole declared range (Unbounded 500-800, Onest
 * 400-700, JetBrains Mono 500-700) is available from one download.
 */
const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: copy.app.name,
    template: `%s | ${copy.app.shortName}`,
  },
  description: copy.app.description,
  // Next does NOT synthesise Open Graph tags from `title`/`description`, so
  // without this block every share of a non-episode page renders a bare link
  // preview. This is a content site whose whole point is being discoverable.
  openGraph: {
    type: "website",
    siteName: copy.app.name,
    title: copy.app.name,
    description: copy.app.description,
    locale: "bg_BG",
  },
  twitter: {
    card: "summary_large_image",
    title: copy.app.name,
    description: copy.app.description,
  },
};

export const viewport: Viewport = {
  // Matches --background in the dark theme, which is the default.
  themeColor: "#191614",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `dark` is set here as well as in ThemeProvider so the first paint is
    // already dark and there is no light flash before hydration.
    <html
      lang="bg"
      className={`dark ${unbounded.variable} ${onest.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <Providers>
          <AppHeader />
          {/* Bottom padding clears the fixed mobile bar. The bar is either the
              bottom nav or, on an episode route, the action bar - never both. */}
          <main className="flex-1 pb-[84px] md:pb-0">{children}</main>
          <SiteFooter />
          <BottomNav />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
