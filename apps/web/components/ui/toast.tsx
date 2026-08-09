"use client";

import { toast as sonner } from "sonner";

import { cn } from "@/lib/utils";

/**
 * Top-centre pill toast.
 *
 * The status is carried by a coloured dot rather than a coloured background,
 * because a full-bleed green or red pill collides visually with the score
 * bands, which are the only thing in this product allowed to mean "good" or
 * "bad" through colour alone. The dot is small enough to read as chrome.
 *
 * Auto-dismiss is 2.2s. sonner owns the timer, so there is no interval to
 * clear on unmount.
 */
const TOAST_DURATION_MS = 2200;

type ToastKind = "success" | "warning" | "error" | "info";

const DOT_CLASS: Record<ToastKind, string> = {
  success: "bg-band-awesome",
  warning: "bg-gold",
  error: "bg-primary",
  info: "bg-band-masterpiece",
};

function ToastPill({ kind, message }: { kind: ToastKind; message: string }) {
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-center gap-2.5 rounded-pill",
        "border border-border-3 bg-elevated px-4 py-2.5 shadow-floating",
      )}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-pill", DOT_CLASS[kind])}
      />
      <span className="text-[13.5px] text-foreground">{message}</span>
    </div>
  );
}

function show(kind: ToastKind, message: string) {
  return sonner.custom(() => <ToastPill kind={kind} message={message} />, {
    duration: TOAST_DURATION_MS,
  });
}

export const notify = {
  success: (message: string) => show("success", message),
  warning: (message: string) => show("warning", message),
  error: (message: string) => show("error", message),
  info: (message: string) => show("info", message),
};
