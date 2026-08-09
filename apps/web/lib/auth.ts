/**
 * The auth seam.
 *
 * Clerk is the identity provider this project has chosen, but its keys have not
 * landed yet, so nothing here issues or verifies a token - it only decides what
 * `Authorization` header the browser sends. When Clerk arrives, `viewerToken`
 * becomes a call to Clerk's `getToken()` and nothing else in the app changes.
 *
 * 🔒 Until then there is an OPT-IN development identity. The Django API already
 * ships a `DevAuth` backend that accepts `Authorization: Bearer dev:<username>`
 * and exists exactly so waves 9-13 could be built before Clerk; `prod.py`
 * refuses to boot with that backend selected, and `DevAuth` itself returns None
 * unless DEBUG is on or the backend is explicitly "dev".
 *
 * Setting `NEXT_PUBLIC_DEV_USER` in `apps/web/.env.local` turns the signed-in
 * half of the redesign (rating sheet, watch log, favourites, profile) on
 * locally. Leaving it unset - the default, and the only correct value for any
 * deployed environment - renders the signed-out state the design specifies,
 * where every affordance is still visible and tapping one opens the sign-in
 * sheet.
 */
import { createApiClient } from "@/lib/api/client";

/**
 * Read straight off `process.env` so Next can inline it at build time.
 * Destructuring or dynamic access would break the inlining and leave it
 * undefined in the browser bundle.
 */
const DEV_USER = process.env.NEXT_PUBLIC_DEV_USER ?? "";

/** True when this build has an identity to act as. */
export const IS_SIGNED_IN = DEV_USER.length > 0;

export function viewerToken(): string | null {
  return IS_SIGNED_IN ? `dev:${DEV_USER}` : null;
}

/**
 * API client that carries the viewer's identity. Use this for anything under
 * `/api/me` or any write; use the plain `api` client for public reads so they
 * stay cacheable.
 */
export const viewerApi = createApiClient({ getToken: viewerToken });
