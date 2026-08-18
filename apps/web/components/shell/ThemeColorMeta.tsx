"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * Keeps `<meta name="theme-color">` in step with the chosen theme.
 *
 * 🚨 iOS Safari tints its own toolbars with this value, and the tag Next
 * renders from the `viewport` export is a single static colour. So a member
 * who switched to the light theme got a cream page framed top and bottom in
 * `#191614` - which reads as the browser being broken, not as a setting.
 * Desktop Chrome ignores theme-color entirely, which is why this is invisible
 * outside a phone.
 *
 * ⚠️ These two hexes are `--background` from the two blocks in globals.css.
 * They are duplicated here because the meta tag needs a literal colour and a
 * CSS variable cannot be read out of a stylesheet without a resolved element;
 * if either token moves, move it here too. `background_color` in
 * `app/manifest.ts` is the same dark value for the same reason.
 */
const THEME_COLORS = {
  dark: "#191614",
  light: "#fbf8f4",
} as const;

export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const color = resolvedTheme === "light" ? THEME_COLORS.light : THEME_COLORS.dark;
    // Next already rendered the tag, so this is an update in the normal case.
    // The create branch exists so the component cannot silently do nothing if
    // the `viewport` export ever drops `themeColor`.
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, [resolvedTheme]);

  return null;
}
