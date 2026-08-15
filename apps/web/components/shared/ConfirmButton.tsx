"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A destructive action that asks once, in place.
 *
 * 🚨 In place, NOT a nested dialog. Every destructive action in this product is
 * already inside a Sheet, and stacking a second modal on top of the first means
 * two focus traps, two scroll locks and two escape handlers fighting over the
 * same keypress. Swapping the button for a confirm/cancel pair keeps one
 * surface and works identically on a phone.
 *
 * Confirmation exists because these actions delete a person's own record with
 * no undo: a rating they gave, or a viewing they logged. A mis-tap on a 38px
 * target should not silently destroy either.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel,
  question,
  disabled = false,
  className,
}: {
  onConfirm: () => void;
  /** The resting label, e.g. "Remove". */
  children: React.ReactNode;
  /** The label once armed, e.g. "Remove it". */
  confirmLabel: string;
  /** Shown beside the armed button so the consequence is stated, not implied. */
  question?: string;
  disabled?: boolean;
  className?: string;
}) {
  const copy = useCopy();
  const [armed, setArmed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus follows the action. Without this a keyboard user arms the control and
  // then has to hunt for where the button they were on went.
  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);

  if (!armed) {
    return (
      <Button
        variant="ghost"
        size="md"
        disabled={disabled}
        onClick={() => setArmed(true)}
        className={className}
      >
        {children}
      </Button>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {question ? (
        <span className="text-[12.5px] text-subtle-foreground">{question}</span>
      ) : null}
      <Button
        ref={confirmRef}
        variant="primary"
        size="md"
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" size="md" onClick={() => setArmed(false)}>
        {copy.common.cancel}
      </Button>
    </div>
  );
}


/**
 * The icon-sized variant: an X that becomes a labelled confirm.
 *
 * Same contract as `ConfirmButton`, sized for a row action. It expands to a
 * text button when armed rather than staying a 26px icon - a confirmation you
 * can hit as easily as the thing you were trying to avoid is not one.
 */
export function ConfirmIconButton({
  onConfirm,
  label,
  confirmLabel,
}: {
  onConfirm: () => void;
  /** Accessible name of the resting X button. */
  label: string;
  confirmLabel: string;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button
        variant="quiet"
        size="icon"
        className="size-[26px]"
        aria-label={label}
        onClick={() => setArmed(true)}
      >
        <X className="size-3" aria-hidden strokeWidth={2.6} />
      </Button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button
        variant="primary"
        size="xs"
        autoFocus
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="quiet" size="icon" className="size-[26px]" onClick={() => setArmed(false)}>
        <X className="size-3" aria-hidden strokeWidth={2.6} />
      </Button>
    </span>
  );
}
