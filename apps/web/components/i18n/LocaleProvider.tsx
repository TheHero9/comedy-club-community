"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  getDictionary,
  setActiveDictionary,
  type Copy,
  type Locale,
} from "@/lib/copy";

interface LocaleContextValue {
  locale: Locale;
  copy: Copy;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** A year. The choice is a preference, not a session. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Supplies the active dictionary to Client Components.
 *
 * 🚨 The locale is a PROP, resolved on the server from the cookie and passed
 * down - it is never read from `document.cookie` here. That is what keeps the
 * client tree byte-identical to the server render: reading it on the client
 * would resolve to the same value a beat later and hydrate a mismatch in
 * between, which is invisible in the page and shows up only as a console error.
 * That exact failure already shipped once on the theme toggle.
 */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const copy = useMemo(() => getDictionary(locale), [locale]);

  // Point the non-React escape hatch at the same dictionary, so an ApiError
  // built inside lib/api/client.ts carries a message in the right language.
  // Safe during render: it is idempotent and derived purely from the prop.
  setActiveDictionary(copy);

  const setLocale = useCallback(
    (next: Locale) => {
      // `path=/` so every route sees it; `SameSite=Lax` because nothing here is
      // a credential and the cookie must survive a normal top-level navigation.
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
      // 🚨 `refresh()`, not a reload. Every page reads the cookie on the server,
      // so the RSC payload has to be re-fetched; a client-only state flip would
      // leave every Server Component rendered in the previous language.
      router.refresh();
    },
    [router],
  );

  const value = useMemo(
    () => ({ locale, copy, setLocale }),
    [locale, copy, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (context) return context;
  // Falling back rather than throwing keeps isolated renders (a test harness,
  // a Storybook-style mount) working, and the default locale is a correct
  // answer rather than a placeholder.
  return {
    locale: DEFAULT_LOCALE,
    copy: getDictionary(DEFAULT_LOCALE),
    setLocale: () => {},
  };
}

/**
 * The active dictionary, for Client Components.
 *
 * Assign it to a local named `copy` so `tests/copy.spec.ts` keeps resolving the
 * `copy.<key>` references it scans for:
 *
 *     const copy = useCopy();
 */
export function useCopy(): Copy {
  return useLocaleContext().copy;
}

export function useLocale(): Locale {
  return useLocaleContext().locale;
}

export function useSetLocale(): (next: Locale) => void {
  return useLocaleContext().setLocale;
}
