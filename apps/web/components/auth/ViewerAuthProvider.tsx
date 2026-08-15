"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ClerkProvider, useClerk, useUser } from "@clerk/nextjs";
import { bgBG } from "@clerk/localizations";
import { dark } from "@clerk/themes";

import { CLERK_ENABLED, DEV_SIGNED_IN } from "@/lib/auth";

/**
 * The frontend half of the pluggable auth (see docs/03-auth-decisions.md).
 *
 * Mirrors the API's AUTH_BACKEND switch exactly:
 * - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set   -> Clerk, real sign-in/sign-out.
 * - unset (local dev, CI, the test suite)   -> the NEXT_PUBLIC_DEV_USER
 *   identity, and the sign-in sheet stays a stub. Every existing test keeps
 *   the behaviour it was written against.
 *
 * Components never touch Clerk hooks directly - they read this context. That
 * is what lets the whole tree render without a ClerkProvider when the key is
 * absent (Clerk's hooks throw outside their provider; a conditional hook call
 * would violate the rules of hooks, a conditional COMPONENT does not).
 */
interface ViewerAuth {
  /** False only while Clerk is still loading its session on first paint. */
  ready: boolean;
  signedIn: boolean;
  /** True when a real sign-in flow exists (Clerk mode only). */
  canSignIn: boolean;
  signIn: () => void;
  signOut: () => void;
}

const noop = () => undefined;

const ViewerAuthContext = createContext<ViewerAuth>({
  ready: true,
  signedIn: false,
  canSignIn: false,
  signIn: noop,
  signOut: noop,
});

export function useViewerAuth(): ViewerAuth {
  return useContext(ViewerAuthContext);
}

function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const clerk = useClerk();

  const value = useMemo<ViewerAuth>(
    () => ({
      ready: isLoaded,
      signedIn: Boolean(isSignedIn),
      canSignIn: true,
      signIn: () => {
        void clerk.openSignIn({});
      },
      signOut: () => {
        void clerk.signOut({ redirectUrl: "/" });
      },
    }),
    [clerk, isLoaded, isSignedIn],
  );

  return (
    <ViewerAuthContext.Provider value={value}>
      {children}
    </ViewerAuthContext.Provider>
  );
}

function DevBridge({ children }: { children: ReactNode }) {
  const value = useMemo<ViewerAuth>(
    () => ({
      ready: true,
      signedIn: DEV_SIGNED_IN,
      canSignIn: false,
      signIn: noop,
      signOut: noop,
    }),
    [],
  );

  return (
    <ViewerAuthContext.Provider value={value}>
      {children}
    </ViewerAuthContext.Provider>
  );
}

export function ViewerAuthProvider({ children }: { children: ReactNode }) {
  if (!CLERK_ENABLED) {
    return <DevBridge>{children}</DevBridge>;
  }
  return (
    <ClerkProvider
      localization={bgBG}
      // Core 3 renamed `baseTheme` to `theme`. The site is dark-first.
      appearance={{ theme: dark }}
    >
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}
