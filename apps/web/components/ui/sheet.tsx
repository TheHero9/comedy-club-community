"use client";

import { Dialog } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";

/**
 * The one overlay surface in the product.
 *
 * Mobile: bottom-aligned, full width, radius 26 on the top corners, with a
 * 40x4 grab handle. Desktop: a centred 460px dialog at radius 20.
 *
 * Motion is deliberately asymmetric - 240ms `cubic-bezier(.32,.72,0,1)` in,
 * 180ms ease-in out. A sheet that leaves as slowly as it arrives feels stuck.
 * `prefers-reduced-motion` drops the transform globally in globals.css.
 *
 * Base UI (not Radix) owns focus trapping, scroll lock and escape handling, so
 * none of that is reimplemented here.
 */

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Announced title. Rendered visually unless `hideTitle` is set. */
  title: string;
  hideTitle?: boolean;
  description?: string;
  className?: string;
}

export function Sheet({
  open,
  onOpenChange,
  children,
  title,
  hideTitle = false,
  description,
  className,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-overlay",
            "transition-opacity duration-240 ease-out",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          )}
        />
        <Dialog.Popup
          className={cn(
            "fixed z-50 flex flex-col overflow-y-auto",
            "border border-border-2 bg-card-2 shadow-overlay",
            // Mobile: bottom sheet.
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-4xl px-4 pt-2.5 pb-6",
            "transition-transform duration-240 ease-sheet",
            "data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full",
            "data-[ending-style]:duration-180 data-[ending-style]:ease-in",
            // Desktop: centred dialog.
            "md:inset-x-auto md:bottom-auto md:top-1/2 md:left-1/2 md:w-[460px] md:max-w-[calc(100vw-2rem)]",
            "md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl md:p-5",
            "md:transition-[opacity,scale] md:data-[starting-style]:translate-y-[-50%]",
            "md:data-[ending-style]:translate-y-[-50%]",
            "md:data-[starting-style]:scale-95 md:data-[starting-style]:opacity-0",
            "md:data-[ending-style]:scale-95 md:data-[ending-style]:opacity-0",
            className,
          )}
        >
          {/* Grab handle. Mobile only - a centred dialog has nothing to grab. */}
          <span
            aria-hidden
            className="mx-auto mb-3.5 h-1 w-10 shrink-0 rounded-pill bg-border-2 md:hidden"
          />
          <Dialog.Title
            className={cn(
              "font-display text-[17px] font-bold",
              hideTitle && "sr-only",
            )}
          >
            {title}
          </Dialog.Title>
          {description ? (
            <Dialog.Description className="mt-1.5 text-small text-subtle-foreground">
              {description}
            </Dialog.Description>
          ) : null}
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const SheetClose = Dialog.Close;
