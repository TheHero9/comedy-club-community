"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { notify } from "@/components/ui/toast";
import { type ApiError, isApiError } from "@/lib/api/client";
import type { Channel, Membership } from "@/lib/api/podcast";
import { viewerApi } from "@/lib/auth";

/**
 * Claiming or correcting a channel membership.
 *
 * 🚨 THE FORM ASKS FOR WHAT THE USER KNOWS, not for what the database stores.
 * Nobody knows the date they first subscribed; everybody can read "70 months"
 * off their own badge and knows which day of the month they get charged. The
 * API turns those two into the start date they imply, and the count then ticks
 * up on its own. Asking for a start date instead would be asking the user to do
 * the arithmetic we are perfectly able to do for them - and to redo it every
 * time they wanted to check.
 *
 * The same component serves "add" and "edit"; the only difference is whether
 * the channel is still choosable, because moving a membership between channels
 * is a delete plus a new claim, not an edit (it would silently move an elite
 * vote).
 */

/** Mirrors `MAX_MONTHS` in `podcast/services/memberships.py`. */
const MAX_MONTHS = 600;

export function MembershipEditor({
  open,
  onOpenChange,
  channels,
  membership,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: Channel[];
  /** Present when editing; absent when claiming a new one. */
  membership?: Membership | null;
}) {
  const copy = useCopy();
  const queryClient = useQueryClient();
  const editing = membership != null;

  const [channelId, setChannelId] = useState<number | null>(null);
  const [months, setMonths] = useState("");
  const [renewalDay, setRenewalDay] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Refill the form whenever the sheet opens.
   *
   * Adjusted during render rather than in an effect: an effect would paint the
   * previous membership's numbers for a frame - which on an EDIT form means
   * briefly showing someone another channel's month count - and `setState`
   * inside an effect is an error in this repo.
   */
  const [wasOpen, setWasOpen] = useState(open);
  const [lastId, setLastId] = useState(membership?.id ?? null);
  if (open !== wasOpen || (membership?.id ?? null) !== lastId) {
    setWasOpen(open);
    setLastId(membership?.id ?? null);
    if (open) {
      setChannelId(membership?.channel_id ?? channels[0]?.id ?? null);
      setMonths(membership?.months != null ? String(membership.months) : "");
      setRenewalDay(
        membership?.renewal_day != null ? String(membership.renewal_day) : "",
      );
      setError(null);
    }
  }

  const parsedMonths = Number.parseInt(months, 10);
  const parsedDay = Number.parseInt(renewalDay, 10);
  const valid =
    channelId !== null &&
    Number.isInteger(parsedMonths) &&
    parsedMonths >= 1 &&
    parsedMonths <= MAX_MONTHS &&
    Number.isInteger(parsedDay) &&
    parsedDay >= 1 &&
    parsedDay <= 31;

  async function save() {
    if (!valid || channelId === null) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        channel_id: channelId,
        months: parsedMonths,
        renewal_day: parsedDay,
      };
      if (editing && membership) {
        await viewerApi.patch<Membership>(
          `/api/me/memberships/${membership.id}`,
          body,
        );
      } else {
        await viewerApi.post<Membership>("/api/me/memberships", body);
      }
      // 🚨 Both queries. The profile header renders its member badge and its
      // avatar from `me`, and a chosen icon's unlock depends on these months -
      // refreshing only this page's list would leave both stale.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["me", "memberships"] }),
        queryClient.invalidateQueries({ queryKey: ["me", "avatars"] }),
      ]);
      notify.success(copy.memberships.savedToast);
      onOpenChange(false);
    } catch (caught) {
      // 422 carries the rule that was broken, which is worth printing verbatim
      // rather than collapsing into "something went wrong".
      setError(
        (isApiError(caught) && caught.status === 422 && messageFrom(caught)) ||
          (isApiError(caught) ? caught.userMessage : copy.errors.generic),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? copy.memberships.editTitle : copy.memberships.addTitle}
    >
      <label className="mt-5 block">
        <span className="text-eyebrow">{copy.memberships.channelLabel}</span>
        <select
          value={channelId ?? ""}
          disabled={editing}
          onChange={(event) => setChannelId(Number(event.target.value))}
          className="mt-1.5 h-12 w-full rounded-xl border border-border-2 bg-card px-3 text-[15px] text-foreground outline-none focus:border-primary disabled:text-subtle-foreground"
        >
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
            </option>
          ))}
        </select>
        {editing ? (
          <span className="mt-1.5 block text-[11.5px] text-subtle-foreground">
            {copy.memberships.channelLocked}
          </span>
        ) : null}
      </label>

      <label className="mt-4 block">
        <span className="text-eyebrow">{copy.memberships.monthsLabel}</span>
        <input
          value={months}
          onChange={(event) => setMonths(event.target.value.replace(/\D/g, ""))}
          // `inputMode` rather than `type="number"`: a number input on mobile
          // still lets a scroll wheel change the value by accident, and its
          // spinner is useless for a three-digit count.
          inputMode="numeric"
          autoComplete="off"
          maxLength={3}
          placeholder={copy.memberships.monthsPlaceholder}
          className="mt-1.5 h-12 w-full rounded-xl border border-border-2 bg-card px-3.5 text-[15px] text-foreground outline-none focus:border-primary"
        />
        <span className="mt-1.5 block text-[11.5px] text-subtle-foreground">
          {copy.memberships.monthsHint}
        </span>
      </label>

      <label className="mt-4 block">
        <span className="text-eyebrow">{copy.memberships.renewalLabel}</span>
        <input
          value={renewalDay}
          onChange={(event) =>
            setRenewalDay(event.target.value.replace(/\D/g, "").slice(0, 2))
          }
          inputMode="numeric"
          autoComplete="off"
          maxLength={2}
          placeholder={copy.memberships.renewalPlaceholder}
          className="mt-1.5 h-12 w-full rounded-xl border border-border-2 bg-card px-3.5 text-[15px] text-foreground outline-none focus:border-primary"
        />
        <span className="mt-1.5 block text-[11.5px] text-subtle-foreground">
          {copy.memberships.renewalHint}
        </span>
      </label>

      {/*
        The consequence of the two numbers, spelled out before saving. It is the
        one place a typo is catchable: "71 from 6 September" is obviously wrong
        to someone who meant 17, in a way that "17" in a box is not.
      */}
      {valid ? (
        <p className="mt-4 rounded-xl bg-card-2 px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
          {copy.memberships.preview(parsedMonths, parsedMonths + 1, parsedDay)}
        </p>
      ) : null}

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
          disabled={saving || !valid}
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
