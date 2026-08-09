import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteHeader } from "@/components/shared/SiteHeader";
import { Toaster } from "@/components/ui/sonner";
import { copy } from "@/lib/copy";

import { Providers } from "./providers";
import "./globals.css";

// 🇧🇬 "cyrillic" is NOT optional. Every episode title and community label is
// Bulgarian; with only the latin subset the browser silently falls back to a
// system font for Cyrillic text, so the whole content area renders in a
// different typeface than the chrome around it.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `dark` is set here as well as in ThemeProvider so the first paint is
    // already dark and there is no light flash before hydration.
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <Providers>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <Toaster position="top-center" richColors />
        </Providers>
      </body>
    </html>
  );
}
