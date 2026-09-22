"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Host for the toast pills in `components/ui/toast.tsx`.
 *
 * Every toast in this product is rendered with `toast.custom`, so sonner's own
 * chrome (background, border, icons, close button) is switched off entirely -
 * otherwise the pill sits inside a second card and reads as two toasts.
 *
 * 🚨 The toast sits BELOW the sticky header, never on top of it. It used to
 * hang at 14px from the top, which is the header's own strip - and on a phone
 * sonner stretches each toast to the full viewport width, so for the 2.2s a
 * "viewing logged" pill was visible, nothing in the header could be tapped:
 * not the profile avatar, not settings, not the logo. The report was "you have
 * to dismiss the notification before you can press anything". The offsets
 * below are the header heights (54px on mobile, 64px from `md`) plus a gap;
 * sonner's own mobile breakpoint is 600px, so between 600 and 767px the pill
 * simply sits 10px lower than it strictly needs to.
 *
 * `pointer-events-none` on the toast wrapper is the second half: the wrapper
 * is a full-width strip, the pill inside it re-enables pointer events for
 * itself, so only the visible pill can ever intercept a tap.
 */
const HEADER_HEIGHT_MOBILE_PX = 54;
const HEADER_HEIGHT_DESKTOP_PX = 64;
const TOAST_GAP_PX = 10;

const Toaster = (props: ToasterProps) => (
  <Sonner
    position="top-center"
    offset={{ top: HEADER_HEIGHT_DESKTOP_PX + TOAST_GAP_PX }}
    mobileOffset={{ top: HEADER_HEIGHT_MOBILE_PX + TOAST_GAP_PX, left: 14, right: 14 }}
    toastOptions={{
      unstyled: true,
      classNames: { toast: "pointer-events-none flex w-full justify-center" },
    }}
    {...props}
  />
);

export { Toaster };
