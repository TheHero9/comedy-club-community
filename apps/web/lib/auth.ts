/**
 * The auth seam - token side.
 *
 * Which identity a request carries is decided here; whether the UI treats the
 * viewer as signed in lives in `components/auth/ViewerAuthProvider.tsx`. Both
 * switch on the same thing, mirroring the API's pluggable AUTH_BACKEND
 * (docs/03-auth-decisions.md):
 *
 * - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set -> Clerk. `viewerToken()` returns
 *   the Clerk session JWT, which the Django API verifies against JWKS.
 * - unset (local dev, CI, the whole test suite) -> the OPT-IN development
 *   identity. Setting `NEXT_PUBLIC_DEV_USER` in `apps/web/.env.local` sends
 *   `Authorization: Bearer dev:<username>`, which only the API's DevAuth
 *   backend accepts - and `prod.py` refuses to boot with that backend, so a
 *   deployed API can never trust it.
 *
 * 🔒 The two modes are mutually exclusive by construction: when the Clerk key
 * is present the dev identity is ignored entirely.
 */
import { createApiClient } from "@/lib/api/client";

/**
 * Read straight off `process.env` so Next can inline these at build time.
 * Destructuring or dynamic access would break the inlining and leave them
 * undefined in the browser bundle.
 */
const DEV_USER = process.env.NEXT_PUBLIC_DEV_USER ?? "";
const CLERK_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

/** True when this build talks to Clerk instead of the dev identity. */
export const CLERK_ENABLED = CLERK_KEY.length > 0;

/** True when the dev identity is active (never in a Clerk build). */
export const DEV_SIGNED_IN = !CLERK_ENABLED && DEV_USER.length > 0;

/**
 * Clerk's browser global. Typed locally instead of importing Clerk's types so
 * this module stays dependency-free for the no-Clerk builds the test suite
 * runs.
 */
declare global {
  interface Window {
    Clerk?: {
      session?: { getToken(): Promise<string | null> } | null;
    };
  }
}

export async function viewerToken(): Promise<string | null> {
  if (CLERK_ENABLED) {
    // Server Components never make authenticated calls in this app (everything
    // behind identity is client-rendered), so "no window" simply means no token.
    if (typeof window === "undefined") return null;
    try {
      return (await window.Clerk?.session?.getToken()) ?? null;
    } catch {
      // Offline or Clerk not yet booted: an anonymous request beats a crash.
      return null;
    }
  }
  return DEV_SIGNED_IN ? `dev:${DEV_USER}` : null;
}

/**
 * API client that carries the viewer's identity. Use this for anything under
 * `/api/me` or any write; use the plain `api` client for public reads so they
 * stay cacheable.
 */
export const viewerApi = createApiClient({ getToken: viewerToken });
