"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Host for the toast pills in `components/ui/toast.tsx`.
 *
 * Every toast in this product is rendered with `toast.custom`, so sonner's own
 * chrome (background, border, icons, close button) is switched off entirely -
 * otherwise the pill sits inside a second card and reads as two toasts.
 */
const Toaster = (props: ToasterProps) => (
  <Sonner
    position="top-center"
    offset={14}
    toastOptions={{
      unstyled: true,
      classNames: { toast: "flex w-full justify-center" },
    }}
    {...props}
  />
);

export { Toaster };
