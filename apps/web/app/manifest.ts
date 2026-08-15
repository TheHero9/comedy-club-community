import type { MetadataRoute } from "next";

import { copy } from "@/lib/copy";

/**
 * The web app manifest is what makes "install" behave like an app instead of
 * a bookmark: Chrome pre-fills the name (no "name your shortcut" dialog), the
 * home-screen icon is ours rather than the browser default, and `standalone`
 * opens it without browser chrome.
 *
 * Next serves this as /manifest.webmanifest and links it from every page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: copy.app.name,
    short_name: copy.app.shortName,
    description: copy.app.description,
    start_url: "/",
    display: "standalone",
    // Matches --background of the dark theme, same as the viewport themeColor.
    background_color: "#191614",
    theme_color: "#191614",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        // Launchers crop maskable icons to a circle, so this variant keeps the
        // logo inside the safe zone on an opaque background.
        purpose: "maskable",
      },
    ],
  };
}
