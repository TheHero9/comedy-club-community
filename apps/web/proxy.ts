/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` (same behaviour, new name -
 * see node_modules/next/dist/docs/.../proxy.md).
 *
 * Clerk's session handshake runs here: `clerkMiddleware` refreshes the session
 * cookie before pages render. No route is protected - every page on this site
 * is public and authorization is always the Django API's job
 * (docs/03-auth-decisions.md) - so the default, non-protecting middleware is
 * exactly right.
 *
 * 🔒 When the publishable key is absent (local dev, CI, the test suite) Clerk
 * must not run at all: `clerkMiddleware` throws without keys, and the suite
 * runs keyless by design. The pass-through keeps behaviour byte-identical to
 * the pre-Clerk app in that mode.
 */
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const proxy = CLERK_ENABLED
  ? clerkMiddleware()
  : () => NextResponse.next();

export const config = {
  // Everything except Next internals and static assets.
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
