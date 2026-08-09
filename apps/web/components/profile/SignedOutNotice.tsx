"use client";

import { useState } from "react";

import { SignInSheet } from "@/components/auth/SignInSheet";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";

/**
 * What /me shows without an identity.
 *
 * The design never hides an affordance from a signed-out user, and the profile
 * is the one screen that genuinely cannot be rendered without one - so it
 * explains itself and offers the same sign-in sheet every other affordance
 * opens, rather than redirecting somewhere and losing the user's place.
 */
export function SignedOutNotice() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <EmptyState
        variant="card"
        title={copy.auth.signInTitle}
        body={copy.auth.signInBody}
        action={
          <Button variant="primary" size="lg" onClick={() => setOpen(true)}>
            {copy.auth.signIn}
          </Button>
        }
      />
      <SignInSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
