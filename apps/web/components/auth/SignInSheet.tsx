"use client";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { copy } from "@/lib/copy";

/**
 * 🚨 Signed-out users still see EVERY rating affordance. The button is never
 * hidden - tapping it opens this instead.
 *
 * Hiding the control would make the site look read-only to exactly the people
 * it needs to convert, and it hides the product's whole point behind an account
 * wall they cannot see a reason to cross.
 *
 * The sign-in action itself is a stub until Clerk keys land. It says so rather
 * than pretending: a button that silently does nothing is worse than one that
 * explains why.
 */
export function SignInSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.auth.signInTitle}
      description={copy.auth.signInBody}
    >
      <Button
        variant="primary"
        size="xl"
        block
        className="mt-4"
        disabled
        aria-disabled
      >
        {copy.auth.signIn}
      </Button>
      <Button
        variant="outline"
        size="lg"
        block
        className="mt-2.5"
        onClick={() => onOpenChange(false)}
      >
        {copy.auth.later}
      </Button>
    </Sheet>
  );
}
