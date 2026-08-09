"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * Sun/moon toggle, 38x38 on `--elevated` at radius 11.
 *
 * Dark is the default and the priority, so this is a plain two-state switch
 * rather than a three-way with "system". next-themes persists the choice to
 * localStorage and injects the pre-paint script that stops a light flash.
 *
 * 🚨 BOTH the icon and the accessible label are gated on hydration. The server
 * cannot know the stored theme, so a resolved value on the first render is a
 * guaranteed mismatch - and an attribute mismatch is invisible in the rendered
 * page, so it only ever surfaces as a console error. That shipped once.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();

  const isDark = resolvedTheme !== "light";

  return (
    <Button
      variant="elevated"
      size="icon"
      shape="rounded"
      aria-label={
        hydrated
          ? isDark
            ? copy.nav.toLight
            : copy.nav.toDark
          : copy.nav.toggleTheme
      }
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="text-muted-foreground"
    >
      {hydrated ? (
        isDark ? (
          <Sun className="size-[17px]" aria-hidden strokeWidth={2.2} />
        ) : (
          <Moon className="size-[17px]" aria-hidden strokeWidth={2.2} />
        )
      ) : (
        // Same box, so the header does not reflow when the icon resolves.
        <span className="size-[17px]" aria-hidden />
      )}
    </Button>
  );
}
