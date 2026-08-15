"use client";

import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useCopy } from "@/components/i18n/LocaleProvider";

/**
 * 🚨 Signed-out users still see EVERY rating affordance. The button is never
 * hidden - tapping it opens this instead.
 *
 * Hiding the control would make the site look read-only to exactly the people
 * it needs to convert, and it hides the product's whole point behind an account
 * wall they cannot see a reason to cross.
 *
 * The button opens Clerk's sign-in modal. In keyless builds (local dev, CI,
 * the test suite) there is no sign-in flow, so it stays the disabled stub the
 * tests were written against - a button that silently does nothing would be
 * worse than one that explains why.
 */
export function SignInSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const copy = useCopy();
  const { canSignIn, signIn } = useViewerAuth();

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
        disabled={!canSignIn}
        aria-disabled={!canSignIn}
        onClick={() => {
          if (!canSignIn) return;
          // Close the sheet first so Clerk's modal is not stacked inside it.
          onOpenChange(false);
          signIn();
        }}
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
