"use client";

import { useState } from "react";
import { Clock, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { viewerApi } from "@/lib/auth";
import { isApiError } from "@/lib/api/client";
import type { Moment } from "@/lib/api/podcast";
import { maskTimestampInput, parseTimestamp } from "@/lib/timestamp";

interface Props {
  youtubeId: string;
  /** Used to reject a time past the end BEFORE a round trip. */
  durationSec: number | null;
  onSignInRequired: () => void;
  /**
   * Re-fetch the list. NOT `router.refresh()`: the moment list is cached with
   * `revalidate: 60` and refresh does not invalidate the server fetch cache,
   * so the new row would be invisible for up to a minute.
   */
  onAdded: () => void | Promise<void>;
}

/**
 * Logging a moment: a timestamp plus a few words.
 *
 * 🚨 The typed timestamp is sent as a STRING and parsed by the API. This
 * component parses the same grammar only to show an error before the round
 * trip - the server re-parses regardless, because a client is never an
 * authority on its own input.
 */
export function MomentComposer({
  youtubeId,
  durationSec,
  onSignInRequired,
  onAdded,
}: Props) {
  const copy = useCopy();
  const { signedIn } = useViewerAuth();

  const [open, setOpen] = useState(false);
  const [time, setTime] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const errorFor = (key: NonNullable<ReturnType<typeof parseTimestamp>["errorKey"]>) =>
    ({
      malformed: copy.episode.momentTimeMalformed,
      overSixty: copy.episode.momentTimeOverSixty,
      tooLong: copy.episode.momentTimeTooLong,
      pastEnd: copy.episode.momentTimePastEnd,
    })[key];

  function start() {
    if (!signedIn) {
      onSignInRequired();
      return;
    }
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = parseTimestamp(time);
    if (!parsed.ok) {
      setError(errorFor(parsed.errorKey!));
      return;
    }
    // `parsed.seconds === null` is the blank field, which is allowed and means
    // "a note about the whole episode". Only a real number can be past the end.
    if (parsed.seconds !== null && durationSec && parsed.seconds > durationSec) {
      setError(copy.episode.momentTimePastEnd);
      return;
    }
    if (!label.trim()) {
      setError(copy.episode.momentWhatPlaceholder);
      return;
    }

    setSaving(true);
    try {
      await viewerApi.post<Moment>(
        `/api/episodes/${encodeURIComponent(youtubeId)}/moments`,
        // The STRING, not our parsed number. The API is the authority.
        { timestamp: time.trim(), label: label.trim() },
      );
      setTime("");
      setLabel("");
      setOpen(false);
      notify.success(copy.episode.momentAdded);
      await onAdded();
    } catch (caught) {
      // `userMessage` is sourced from copy.errors, so it is localised. The
      // API's own `detail` is English developer text and must not be rendered
      // into a Bulgarian UI - the client-side checks above already cover the
      // cases a member can actually hit.
      setError(isApiError(caught) ? caught.userMessage : copy.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="mt-3" onClick={start}>
        <Plus className="h-4 w-4" />
        {signedIn ? copy.episode.momentAdd : copy.episode.momentSignedOut}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-subtle-foreground">
            {copy.episode.momentTimeLabel}{" "}
            <span className="text-muted-foreground">
              ({copy.episode.momentTimeOptional})
            </span>
          </span>
          <span className="relative">
            <Clock className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
            <input
              value={time}
              // 🚨 The colon is INSERTED, never typed. `inputMode="numeric"`
              // gives a digits-only keypad on a phone, so ":" was unreachable
              // on the device most of this audience uses. Keeping the numeric
              // keypad and punctuating for them is better than widening the
              // keyboard and leaving the key two taps deep. See
              // lib/timestamp.ts maskTimestampInput.
              onChange={(event) => setTime(maskTimestampInput(event.target.value))}
              placeholder={copy.episode.momentTimePlaceholder}
              inputMode="numeric"
              autoFocus
              aria-describedby="moment-time-hint"
              className="w-[124px] rounded-pill border border-border bg-background py-2 pr-3 pl-8 font-mono text-small tabular"
            />
          </span>
        </label>

        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className="text-[12px] text-subtle-foreground">
            {copy.episode.momentWhatLabel}
          </span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={copy.episode.momentWhatPlaceholder}
            maxLength={200}
            className="rounded-pill border border-border bg-background px-3 py-2 text-small"
          />
        </label>

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {copy.episode.momentSave}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            {copy.episode.momentCancel}
          </Button>
        </div>
      </div>

      {/* Always rendered, so the field never changes height when an error
          appears or clears - and so "you may leave this blank" is visible
          BEFORE someone gives up on the field, not after they submit. */}
      <p id="moment-time-hint" className="mt-2 text-[12px] text-subtle-foreground">
        {copy.episode.momentTimeHint}
      </p>

      {error ? (
        <p role="alert" className="mt-1 text-[12.5px] text-primary-text">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Delete control for a moment the viewer owns.
 *
 * 🔒 Ownership comes from `myMomentIds` on the authed viewer-state call, never
 * from the public moment list - that is cached, has no actor, and its `author`
 * field is a display name rather than an identity.
 */
export function MomentOwnerControls({
  momentId,
  myMomentIds,
  onDeleted,
}: {
  momentId: number;
  myMomentIds: number[];
  onDeleted: () => void | Promise<void>;
}) {
  const copy = useCopy();
  const [busy, setBusy] = useState(false);

  if (!myMomentIds.includes(momentId)) return null;

  async function remove() {
    setBusy(true);
    try {
      await viewerApi.delete(`/api/moments/${momentId}`);
      notify.success(copy.episode.momentDeleted);
      await onDeleted();
    } catch {
      notify.error(copy.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      <span className="rounded-pill border border-border px-2 py-0.5 text-[10.5px] text-subtle-foreground">
        {copy.episode.momentMine}
      </span>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        aria-label={copy.episode.momentDelete}
        className="rounded-pill p-1 text-subtle-foreground outline-none hover:text-primary-text"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
