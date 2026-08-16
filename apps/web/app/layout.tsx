import type { Metadata, Viewport } from "next";
import { Unbounded, Onest, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

import { ViewerAuthProvider } from "@/components/auth/ViewerAuthProvider";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { AppHeader } from "@/components/shell/AppHeader";
import { BottomNav } from "@/components/shell/BottomNav";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { Toaster } from "@/components/ui/sonner";
import { getCopy, getLocale, htmlLang, openGraphLocale } from "@/lib/locale";
import { SITE_URL } from "@/lib/site";

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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const copy = await getCopy();

  return {
    // 🚨 Without this every canonical and Open Graph URL Next resolves is
    // relative to `localhost:3000`, and Next warns about it at build time
    // rather than failing - so a share preview pointing at localhost is the
    // kind of thing that ships silently. Same origin the sitemap uses.
    metadataBase: new URL(SITE_URL),
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
      locale: openGraphLocale(locale),
    },
    twitter: {
      card: "summary_large_image",
      title: copy.app.name,
      description: copy.app.description,
    },
  };
}

export const viewport: Viewport = {
  // Matches --background in the dark theme, which is the default.
  themeColor: "#191614",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // 🚨 `lang` has to be the CHROME language, not the content language. The
  // catalogue is Bulgarian under both locales, so this attribute describes the
  // interface a screen reader is about to read out, and episode titles inside
  // the page carry their own `lang` where it matters.
  const locale = await getLocale();

  return (
    // `dark` is set here as well as in ThemeProvider so the first paint is
    // already dark and there is no light flash before hydration.
    <html
      lang={htmlLang(locale)}
      className={`dark ${unbounded.variable} ${onest.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <Providers>
          <LocaleProvider locale={locale}>
            <ViewerAuthProvider>
              <AppHeader />
              {/* Bottom padding clears the fixed mobile bar. The bar is either
                  the bottom nav or, on an episode route, the action bar. */}
              <main className="flex-1 pb-[84px] md:pb-0">{children}</main>
              <SiteFooter />
              <BottomNav />
              <Toaster />
            </ViewerAuthProvider>
          </LocaleProvider>
        </Providers>
        {/* Vercel Web Analytics: cookieless visit counting, page views and
            referrers only. Enabled in the Vercel dashboard; no consent banner
            needed because nothing identifies the visitor.

            🚨 Rendered ONLY on Vercel. The component loads
            `/_vercel/insights/script.js`, which is injected by Vercel's edge
            and exists nowhere else - so in a local production build it is a
            hard 404 on every single page. That tripped the E2E console guard
            and failed 63 tests at once, none of which had anything to do with
            analytics. `VERCEL` is set in every Vercel build and deployment. */}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
