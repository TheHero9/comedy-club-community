"use client";

import { useState } from "react";
import { Check, Clock, Plus, UserPlus, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { PersonPicker } from "@/components/shared/PersonPicker";
import { Tooltip } from "@/components/shared/Tooltip";
import { DraftNotice } from "@/components/shared/DraftNotice";
import { viewerApi } from "@/lib/auth";
import { isApiError } from "@/lib/api/client";
import { draftKey } from "@/lib/drafts";
import { useDraft } from "@/lib/use-draft";
import { cn } from "@/lib/utils";
import type { Person, Proposal } from "@/lib/api/podcast";

interface Props {
  youtubeId: string;
  /** Admin-curated personas. The ONLY source of a canonical person. */
  people: Person[];
  onSignInRequired: () => void;
  /**
   * Re-fetch the cast. NOT `router.refresh()`: the list is cached with
   * `revalidate: 60` and refresh does not invalidate the server fetch cache,
   * so a suggestion would be invisible for up to a minute and read as a
   * failed save.
   */
  onProposed: () => void | Promise<void>;
}

/**
 * 🚨 WIRE VALUES, so they stay at module scope and must NOT change with the
 * language - `copy.episode.role()` maps each to a label at render time. They
 * mirror `EpisodeParticipant.Role` in the API, which validates against its own
 * choices on both the propose AND the approve path.
 *
 * 🚨 THREE, and `regular` is FIRST because it is the default (owner ruling,
 * 2026-08-16: "only regular, guest, off-camera, and the default to be
 * regular"). `host`, `cohost` and `producer` are gone - the first two ranked
 * people who are simply on the show every week, and the third was a credit
 * rather than a presence in the episode.
 *
 * Ordered by how visible the person is in the episode, not alphabetically -
 * which puts the default at the top of the list for free.
 */
const ROLES = ["regular", "guest", "offcamera"] as const;

/**
 * The starting form: one blank line.
 *
 * Module scope so its identity is stable - `useDraft` takes it as the "nothing
 * typed" value, and a fresh array each render would make that dependency churn.
 */
const EMPTY_LINES: CastLine[] = [{ key: 1, slug: "", name: "", custom: false, typedName: "", role: "regular" }];

/** One line of the form: who, and in what capacity. */
interface CastLine {
  /** Stable across re-orders, so React does not reuse a removed line's state. */
  key: number;
  /** A chosen persona's slug, or "" when nothing is chosen yet. */
  slug: string;
  /** The chosen persona's name, kept for the trigger's label. */
  name: string;
  /** True once "not listed, I will type a name" was picked. */
  custom: boolean;
  typedName: string;
  role: string;
}

/** Nothing chosen and nothing typed - so nothing worth keeping as a draft. */
function isLineEmpty(line: CastLine): boolean {
  return line.slug.length === 0 && line.typedName.trim().length === 0;
}

/** One past the highest key in play, so a restored draft cannot collide. */
function nextLineKey(lines: CastLine[]): number {
  return lines.reduce((highest, line) => Math.max(highest, line.key), 0) + 1;
}

function emptyLine(key: number): CastLine {
  return {
    key,
    slug: "",
    name: "",
    custom: false,
    typedName: "",
    // `regular` matches the API's own default, so the two cannot drift into
    // disagreeing about what an unspecified role means.
    role: "regular",
  };
}

/**
 * Suggest who took part in an episode - the WHOLE cast, in one submission.
 *
 * 🚨 It used to be one person per trip: pick, submit, pick again, submit again.
 * The owner's report was exactly that ("it's so slow"), and it is also how the
 * data actually arrives - a viewer recognises three people at once, not one
 * every thirty seconds. So the form is a list of lines and the button sends
 * them together, through `/participants/batch`, which applies all of them or
 * none of them.
 *
 * 🚨 A typed name is sent as free text and NEVER becomes a `Person`. A
 * moderator maps it onto a persona that already exists (creating that persona
 * by hand first if it is genuinely new). The reason is concrete: the Bulgarian
 * auto-captions mishear `Тонката` as `Донката`, and the same performer is also
 * `Тони` - if user text minted personas, one filmography would split across
 * three near-empty `/episodes?person=` pages.
 */
export function CastProposer({
  youtubeId,
  people,
  onSignInRequired,
  onProposed,
}: Props) {
  const copy = useCopy();
  // 🚨 `ready` is Clerk's `isLoaded`. Two batches were lost on 2026-08-20
  // because this button was live while the session was still loading and
  // `viewerToken()` was still answering null.
  const { signedIn, ready } = useViewerAuth();

  // 🚨 This form is the one that provably lost work. A whole cast is minutes of
  // recognising faces, and it used to live only in React state - so a 401, a
  // reload or a backgrounded tab took all of it.
  const draft = useDraft<CastLine[]>(
    draftKey("cast", youtubeId),
    EMPTY_LINES,
    (lines) => lines.every(isLineEmpty),
  );
  const lines = draft.value;
  const setLines = draft.setValue;

  const [opened, setOpen] = useState(false);
  const open = opened || draft.restored;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function start() {
    // `!ready` is not `!signedIn` - see MomentComposer for why conflating them
    // shows the sign-in sheet to someone already signed in.
    if (!ready) return;
    if (!signedIn) {
      onSignInRequired();
      return;
    }
    setOpen(true);
  }

  function patch(key: number, changes: Partial<CastLine>) {
    setLines(lines.map((line) => (line.key === key ? { ...line, ...changes } : line)));
  }

  function addLine() {
    // 🚨 Derived from the lines themselves, NOT from a `useRef` counter. A
    // restored draft arrives with keys the ref never issued, so a ref that
    // starts at 1 again would mint a duplicate key and React would hand the
    // new line the removed one's state.
    setLines([...lines, emptyLine(nextLineKey(lines))]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const items = lines.map((line) =>
      line.custom
        ? { name: line.typedName.trim(), role: line.role }
        : { person_slug: line.slug, role: line.role },
    );

    // Checked here as well as on the server, because an empty line is a
    // half-finished thought rather than an error worth a round trip.
    const incomplete = items.some(
      (item) => !("name" in item ? item.name : item.person_slug),
    );
    if (incomplete) {
      setError(copy.episode.castNeedsPerson);
      return;
    }

    setSaving(true);
    try {
      await viewerApi.post<Proposal[]>(
        `/api/episodes/${encodeURIComponent(youtubeId)}/participants/batch`,
        { items },
      );
      // Only a 2xx forgets the draft. The batch is all-or-nothing, so anything
      // else means the whole cast still exists nowhere but this browser.
      draft.clear();
      setOpen(false);
      notify.success(copy.episode.castProposed);
      await onProposed();
    } catch (caught) {
      // 🚨 The lines stay exactly as they are. The batch is all-or-nothing, so
      // nothing was saved, and clearing the form would throw away work the
      // member still has to correct.
      setError(isApiError(caught) ? caught.userMessage : copy.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="mt-3" onClick={start} disabled={!ready}>
        <UserPlus className="h-4 w-4" />
        {signedIn ? copy.episode.castAdd : copy.episode.castSignedOut}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-lg border border-border bg-card p-3">
      <p className="mb-2.5 text-small font-semibold">{copy.episode.castAddTitle}</p>

      {draft.restored ? <DraftNotice onDiscard={draft.clear} /> : null}

      <ul className="flex flex-col gap-2.5">
        {lines.map((line) => (
          <li key={line.key} className="flex flex-wrap items-center gap-2">
            <span className="flex min-w-[190px] flex-1 flex-col gap-1">
              <PersonPicker
                aria-label={copy.episode.castPick}
                value={line.slug}
                valueLabel={line.name}
                initialPeople={people}
                customActive={line.custom}
                onSelect={(person) =>
                  patch(line.key, {
                    slug: person.slug,
                    name: person.name,
                    custom: false,
                    typedName: "",
                  })
                }
                onCustom={() =>
                  patch(line.key, { custom: true, slug: "", name: "" })
                }
              />
            </span>

            {line.custom ? (
              <input
                value={line.typedName}
                onChange={(event) =>
                  patch(line.key, { typedName: event.target.value })
                }
                placeholder={copy.episode.castCustomPlaceholder}
                aria-label={copy.episode.castCustom}
                maxLength={200}
                autoFocus
                className="min-w-[150px] flex-1 rounded-pill border border-border bg-background px-3 py-2 text-small"
              />
            ) : null}

            <RoleChoice
              value={line.role}
              onChange={(role) => patch(line.key, { role })}
            />

            {/* Only when there is something to remove. On a single line it
                would be a button that empties the form the Cancel button
                already closes. */}
            {lines.length > 1 ? (
              <Tooltip label={copy.episode.castRowRemove} align="end">
                <Button
                  type="button"
                  variant="quiet"
                  size="icon"
                  className="size-[34px]"
                  aria-label={copy.episode.castRowRemove}
                  onClick={() =>
                    setLines(lines.filter((other) => other.key !== line.key))
                  }
                >
                  <X className="size-3.5" aria-hidden strokeWidth={2.6} />
                </Button>
              </Tooltip>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="dashed" size="sm" onClick={addLine}>
          <Plus className="h-4 w-4" />
          {copy.episode.castAddRow}
        </Button>

        <span className="ml-auto flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {copy.episode.castSubmitAll(lines.length)}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              // Keeps the lines. Closing a form is not consent to throw away
              // the cast someone just spent minutes recognising - discarding
              // is the named action on the notice above.
              draft.acknowledge();
              setOpen(false);
              setError(null);
            }}
          >
            {copy.episode.momentCancel}
          </Button>
        </span>
      </div>

      <p className="mt-2 text-[12px] text-subtle-foreground">
        {copy.episode.castPendingNote}
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-primary-text">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The role, as three pills rather than a fourth dropdown.
 *
 * There are exactly three of them and they never grow with the data, so a menu
 * would hide a choice that fits on the line - and it would be a second tap for
 * something the member sets on every single line they add.
 */
function RoleChoice({
  value,
  onChange,
}: {
  value: string;
  onChange: (role: string) => void;
}) {
  const copy = useCopy();

  return (
    <span
      role="radiogroup"
      aria-label={copy.episode.castRole}
      className="flex items-center gap-1 rounded-pill border border-border p-0.5"
    >
      {ROLES.map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "rounded-pill px-2.5 py-1.5 text-[12.5px] outline-none transition-colors duration-120",
            value === key
              ? "bg-elevated font-semibold text-foreground"
              : "text-subtle-foreground hover:text-foreground",
          )}
        >
          {copy.episode.role(key)}
        </button>
      ))}
    </span>
  );
}

/**
 * A proposal awaiting review, rendered visibly distinct from confirmed cast.
 *
 * 🚨 It must never look like a confirmed participant: a pending row is NOT in
 * EpisodeParticipant, so search and `?person=` do not know about it, and
 * showing it as fact would make the page disagree with every other surface.
 *
 * 🚨 A MODERATOR DECIDES IT HERE. The review queue on /me/people still exists
 * and is where a batch is read as a batch, but the person who notices a wrong
 * cast is looking at the episode when they notice it, and making them leave the
 * page to act on it is how a queue grows. The endpoints are the same ones, and
 * the server re-checks the permission - the buttons below only decide what is
 * rendered.
 */
export function PendingCastRow({
  proposal,
  myProposalIds,
  isStaff,
  people,
  onChanged,
}: {
  proposal: Proposal;
  myProposalIds: number[];
  /** Moderator or admin. Decides what is RENDERED, never what is allowed. */
  isStaff: boolean;
  /** Seed for the "approve as" picker on a typed-name proposal. */
  people: Person[];
  onChanged: () => void | Promise<void>;
}) {
  const copy = useCopy();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [slug, setSlug] = useState(proposal.person_slug ?? "");
  const [slugLabel, setSlugLabel] = useState(
    proposal.person_slug ? proposal.display_name : "",
  );
  const [error, setError] = useState<string | null>(null);
  const mine = myProposalIds.includes(proposal.id);

  async function run(work: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (success) notify.success(success);
      await onChanged();
    } catch (caught) {
      // Inline, not a toast: the row that failed is on screen, and a toast
      // about "a proposal" would not say which one.
      setError(isApiError(caught) ? caught.userMessage : copy.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  const withdraw = () =>
    run(() => viewerApi.delete(`/api/participant-proposals/${proposal.id}`));

  const approve = () =>
    run(
      () =>
        viewerApi.post(
          `/api/moderation/participant-proposals/${proposal.id}/approve`,
          { person_slug: slug },
        ),
      copy.episode.castApproved,
    );

  const reject = () =>
    run(
      () =>
        viewerApi.post(
          `/api/moderation/participant-proposals/${proposal.id}/reject`,
          {},
        ),
      copy.episode.castRejected,
    );

  return (
    <li className="rounded-lg border border-dashed border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Plus className="h-3.5 w-3.5 shrink-0 text-subtle-foreground" aria-hidden />
        <span className="text-small">{proposal.display_name}</span>
        <span className="text-[11px] text-subtle-foreground">
          {copy.episode.role(proposal.role)}
        </span>

        {/* The state, as a mark rather than a sentence. The row is scanned, and
            "Awaiting review" spelled out beside every one of them was most of
            the line. The name is still the control's accessible name, so it is
            not lost - it is just not shouted. */}
        <Tooltip label={copy.episode.castPending} className="ml-auto">
          <span
            data-testid="cast-pending-mark"
            className="flex items-center rounded-pill border border-border px-1.5 py-1 text-subtle-foreground"
          >
            <Clock className="size-3.5" aria-hidden />
            <span className="sr-only">{copy.episode.castPending}</span>
          </span>
        </Tooltip>

        {isStaff ? (
          <>
            <Tooltip label={copy.episode.castApprove} align="end">
              <Button
                type="button"
                variant="quiet"
                size="icon"
                className="size-[30px]"
                aria-label={copy.episode.castApprove}
                // A typed name has no persona yet, and approving one without
                // choosing who it is would 422 on the server. The picker below
                // is where that gets fixed, and it says so there - a hint on a
                // disabled control is a hint nobody can hover.
                disabled={busy || !slug}
                onClick={approve}
              >
                <Check className="size-4" aria-hidden strokeWidth={2.6} />
              </Button>
            </Tooltip>
            <Tooltip label={copy.episode.castReject} align="end">
              <Button
                type="button"
                variant="quiet"
                size="icon"
                className="size-[30px]"
                aria-label={copy.episode.castReject}
                disabled={busy}
                onClick={reject}
              >
                <X className="size-4" aria-hidden strokeWidth={2.6} />
              </Button>
            </Tooltip>
          </>
        ) : null}

        {/* 🚨 Withdrawing asks first. It deletes the row outright, there is no
            undo, and the trigger is now a 30px icon rather than a word - a
            mis-tap that silently destroys someone's contribution is exactly
            what shrinking a control invites. */}
        {mine ? (
          armed ? (
            <span className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="primary"
                size="xs"
                autoFocus
                disabled={busy}
                onClick={() => {
                  setArmed(false);
                  void withdraw();
                }}
              >
                {copy.episode.castWithdrawConfirm}
              </Button>
              <Button
                type="button"
                variant="quiet"
                size="icon"
                className="size-[30px]"
                aria-label={copy.common.cancel}
                onClick={() => setArmed(false)}
              >
                <X className="size-3.5" aria-hidden strokeWidth={2.6} />
              </Button>
            </span>
          ) : (
            <Tooltip label={copy.episode.castWithdraw} align="end">
              <Button
                type="button"
                variant="quiet"
                size="icon"
                className="size-[30px]"
                aria-label={copy.episode.castWithdraw}
                disabled={busy}
                onClick={() => setArmed(true)}
              >
                <Undo2 className="size-4" aria-hidden />
              </Button>
            </Tooltip>
          )
        ) : null}
      </div>

      {/* Only where a decision is actually needed: the member typed a name, so
          somebody has to say which persona it is. A proposal that already names
          one approves in a single click above. */}
      {isStaff && !proposal.person_slug ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-subtle-foreground">
            {copy.episode.castApproveAs}
          </span>
          <PersonPicker
            className="min-w-[190px] flex-1"
            placeholder={copy.episode.castApprovePickFirst}
            aria-label={copy.episode.castApproveAs}
            value={slug}
            valueLabel={slugLabel}
            initialPeople={people}
            disabled={busy}
            onSelect={(person) => {
              setSlug(person.slug);
              setSlugLabel(person.name);
            }}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1.5 text-[12.5px] text-primary-text">
          {error}
        </p>
      ) : null}
    </li>
  );
}
