"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AvatarPicker } from "@/components/profile/AvatarPicker";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { notify } from "@/components/ui/toast";
import { ApiError, isApiError } from "@/lib/api/client";
import type { Me } from "@/lib/api/podcast";
import { viewerApi } from "@/lib/auth";

/**
 * Editing your own display name and handle.
 *
 * 🚨 The handle is a self-chosen nickname (owner ruling, 2026-08-15: "users can
 * and will edit it, it's their name basically"). It is NOT proof of a YouTube
 * identity and must never be treated as one - if that linkage is ever wanted it
 * needs a separate verified field.
 *
 * The API owns validation and uniqueness; this form's job is to surface WHICH
 * of the two failed. A 409 means someone already has that handle and a 422
 * carries a reason worth printing, so neither collapses into "something went
 * wrong".
 */
export function ProfileEditor({
  open,
  onOpenChange,
  me,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: Me | undefined;
}) {
  const copy = useCopy();
  const queryClient = useQueryClient();
  const [name, setName] = useState(me?.display_name ?? "");
  const [handle, setHandle] = useState(me?.handle ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Reset the fields whenever the sheet opens, so a cancelled edit does not
   * come back next time. Adjusted during render rather than in an effect: an
   * effect would paint the stale values for a frame, and `setState` inside one
   * is an error in this repo.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(me?.display_name ?? "");
      setHandle(me?.handle ?? "");
      setError(null);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await viewerApi.patch<Me>("/api/me", {
        display_name: name.trim(),
        // "" is the documented "clear it" sentinel; the API turns that into
        // NULL, which is what keeps the unique index usable for everyone who
        // has not picked a handle.
        handle: handle.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      notify.success(copy.profile.savedToast);
      onOpenChange(false);
    } catch (caught) {
      if (isApiError(caught) && caught.status === 409) {
        setError(copy.profile.handleTakenToast);
      } else if (isApiError(caught) && caught.status === 422) {
        // The API's message names the actual rule that was broken.
        setError(messageFrom(caught) || copy.profile.handleHint);
      } else {
        setError(
          isApiError(caught) ? caught.userMessage : copy.errors.generic,
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.profile.editProfile}
    >
      <label className="mt-5 block">
        <span className="text-eyebrow">{copy.profile.nameLabel}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          className="mt-1.5 h-12 w-full rounded-xl border border-border-2 bg-card px-3.5 text-[15px] text-foreground outline-none focus:border-primary"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-eyebrow">{copy.profile.handleLabel}</span>
        <div className="mt-1.5 flex h-12 items-center gap-1 rounded-xl border border-border-2 bg-card px-3.5 focus-within:border-primary">
          <span aria-hidden className="text-[15px] text-subtle-foreground">
            @
          </span>
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            maxLength={30}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none"
          />
        </div>
        <span className="mt-1.5 block text-[11.5px] text-subtle-foreground">
          {copy.profile.handleHint}
        </span>
      </label>

      {/* 🚨 Saves on click, not with the button below. Picking an icon is its
          own endpoint (`PUT /api/me/avatar`, which re-checks the unlock server
          side), and folding it into this form's PATCH would mean a locked icon
          could ride along with a name change. */}
      <div className="mt-4">
        <span className="text-eyebrow">{copy.profile.iconLabel}</span>
        <AvatarPicker />
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-small text-primary-text">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex gap-2">
        <Button
          variant="primary"
          size="xl"
          className="flex-1"
          disabled={saving}
          onClick={save}
        >
          {saving ? copy.rating.saving : copy.profile.save}
        </Button>
        <Button
          variant="outline"
          size="xl"
          disabled={saving}
          onClick={() => onOpenChange(false)}
        >
          {copy.profile.cancel}
        </Button>
      </div>
    </Sheet>
  );
}

/** Ninja returns `{ detail: "..." }` on an HttpError. */
function messageFrom(error: ApiError): string {
  const body = error.body;
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return "";
}
