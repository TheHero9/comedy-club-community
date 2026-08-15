"use client";

import { useTheme } from "next-themes";
import { Check, Moon, Sun } from "lucide-react";

import { useCopy, useLocale, useSetLocale } from "@/components/i18n/LocaleProvider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/sheet";
import { LOCALES, type Locale } from "@/lib/copy";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

/**
 * Appearance and language, in one place.
 *
 * Both settings used to be unreachable: the theme lived in a bare sun/moon
 * button in the header with no label, and the language did not exist at all.
 *
 * 🚨 The theme rows are gated on hydration: next-themes keeps the choice in
 * localStorage, which the server cannot read, so rendering the resolved theme
 * on the first pass is a guaranteed mismatch - and an attribute mismatch is
 * invisible in the page, surfacing only as a console error. The LOCALE rows are
 * NOT
 * gated - the locale came from a cookie the server already read, so it is known
 * at render time on both sides.
 */
function Row({
  selected,
  onSelect,
  label,
  icon,
  hydrated = true,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  icon?: React.ReactNode;
  hydrated?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      // `aria-pressed` rather than `aria-checked`: these are toggle buttons in a
      // group, not a radio group, and Base UI owns no state here.
      aria-pressed={hydrated ? selected : undefined}
      className={cn(
        "flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-pill px-4",
        "text-[14px] font-medium outline-none transition-colors duration-120",
        hydrated && selected
          ? "bg-card text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
      {hydrated && selected ? (
        <Check className="size-4 shrink-0" aria-hidden strokeWidth={2.4} />
      ) : null}
    </button>
  );
}

export function SettingsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = useCopy();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();

  const isDark = resolvedTheme !== "light";

  const localeLabel: Record<Locale, string> = {
    en: copy.settings.languageEn,
    bg: copy.settings.languageBg,
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.settings.title}
      description={copy.settings.description}
    >
      <section className="mt-5">
        <h3 className="text-[12px] font-semibold tracking-wide text-subtle-foreground uppercase">
          {copy.settings.appearance}
        </h3>
        <div className="mt-2 flex gap-1.5 rounded-pill bg-elevated p-1">
          <Row
            hydrated={hydrated}
            selected={isDark}
            onSelect={() => setTheme("dark")}
            label={copy.settings.themeDark}
            icon={<Moon className="size-[15px]" aria-hidden strokeWidth={2.2} />}
          />
          <Row
            hydrated={hydrated}
            selected={!isDark}
            onSelect={() => setTheme("light")}
            label={copy.settings.themeLight}
            icon={<Sun className="size-[15px]" aria-hidden strokeWidth={2.2} />}
          />
        </div>
      </section>

      <section className="mt-5">
        <h3 className="text-[12px] font-semibold tracking-wide text-subtle-foreground uppercase">
          {copy.settings.language}
        </h3>
        <div className="mt-2 flex gap-1.5 rounded-pill bg-elevated p-1">
          {LOCALES.map((candidate) => (
            <Row
              key={candidate}
              selected={locale === candidate}
              onSelect={() => setLocale(candidate)}
              label={localeLabel[candidate]}
            />
          ))}
        </div>
        {/* 🚨 Load-bearing. Switching to English translates the interface and
            nothing else: the catalogue is Bulgarian in both locales. Without
            this the toggle silently promises a translated archive. */}
        <p className="mt-2.5 text-small text-subtle-foreground">
          {copy.settings.languageHint}
        </p>
      </section>

      <SheetClose
        render={
          <Button variant="primary" size="lg" className="mt-6 w-full">
            {copy.settings.done}
          </Button>
        }
      />
    </Sheet>
  );
}
