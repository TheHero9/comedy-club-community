"use client";

import { useState } from "react";
import { Plus, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { viewerApi } from "@/lib/auth";
import { isApiError } from "@/lib/api/client";
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
 * `regular` and `offcamera` were added 2026-08-16. A regular is a recurring
 * member of the show who is NOT a guest ("we won't allow for guests"), and
 * off-camera is the voice heard but never seen - which `producer`, a job
 * rather than a presence, did not cover. Ordered by how visible the person is
 * in the episode, not alphabetically.
 */
const ROLES = ["host", "cohost", "regular", "guest", "offcamera", "producer"] as const;

/**
 * Suggest who took part in an episode.
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
  const { signedIn } = useViewerAuth();

  const [open, setOpen] = useState(false);
  const [personSlug, setPersonSlug] = useState("");
  const [customName, setCustomName] = useState("");
  const [role, setRole] = useState<string>("guest");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const usingCustom = personSlug === "__custom__";

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

    const body: Record<string, string> = { role };
    if (usingCustom) {
      if (!customName.trim()) {
        setError(copy.episode.castCustomPlaceholder);
        return;
      }
      body.name = customName.trim();
    } else if (personSlug) {
      body.person_slug = personSlug;
    } else {
      setError(copy.episode.castPick);
      return;
    }

    setSaving(true);
    try {
      await viewerApi.post<Proposal>(
        `/api/episodes/${encodeURIComponent(youtubeId)}/participants`,
        body,
      );
      setPersonSlug("");
      setCustomName("");
      setOpen(false);
      notify.success(copy.episode.castProposed);
      await onProposed();
    } catch (caught) {
      setError(isApiError(caught) ? caught.userMessage : copy.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="mt-3" onClick={start}>
        <UserPlus className="h-4 w-4" />
        {signedIn ? copy.episode.castAdd : copy.episode.castSignedOut}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-lg border border-border bg-card p-3">
      <p className="mb-2.5 text-small font-semibold">{copy.episode.castAddTitle}</p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[190px] flex-1 flex-col gap-1">
          <span className="text-[12px] text-subtle-foreground">{copy.episode.castPick}</span>
          <select
            value={personSlug}
            onChange={(event) => setPersonSlug(event.target.value)}
            className="rounded-pill border border-border bg-background px-3 py-2 text-small"
          >
            <option value="">-</option>
            {people.map((person) => (
              <option key={person.slug} value={person.slug}>
                {person.name}
              </option>
            ))}
            <option value="__custom__">{copy.episode.castCustom}</option>
          </select>
        </label>

        {usingCustom ? (
          <label className="flex min-w-[170px] flex-1 flex-col gap-1">
            <span className="text-[12px] text-subtle-foreground">
              {copy.episode.castCustom}
            </span>
            <input
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              placeholder={copy.episode.castCustomPlaceholder}
              maxLength={200}
              autoFocus
              className="rounded-pill border border-border bg-background px-3 py-2 text-small"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-subtle-foreground">{copy.episode.castRole}</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="rounded-pill border border-border bg-background px-3 py-2 text-small"
          >
            {ROLES.map((key) => (
              <option key={key} value={key}>
                {copy.episode.role(key)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {copy.episode.castSubmit}
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
 * A proposal awaiting review, rendered visibly distinct from confirmed cast.
 *
 * 🚨 It must never look like a confirmed participant: a pending row is NOT in
 * EpisodeParticipant, so search and `?person=` do not know about it, and
 * showing it as fact would make the page disagree with every other surface.
 */
export function PendingCastRow({
  proposal,
  myProposalIds,
  onWithdrawn,
}: {
  proposal: Proposal;
  myProposalIds: number[];
  onWithdrawn: () => void | Promise<void>;
}) {
  const copy = useCopy();
  const [busy, setBusy] = useState(false);
  const mine = myProposalIds.includes(proposal.id);

  async function withdraw() {
    setBusy(true);
    try {
      await viewerApi.delete(`/api/participant-proposals/${proposal.id}`);
      await onWithdrawn();
    } catch {
      notify.error(copy.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
      <Plus className="h-3.5 w-3.5 shrink-0 text-subtle-foreground" />
      <span className="text-small">{proposal.display_name}</span>
      <span className="text-[11px] text-subtle-foreground">
        {copy.episode.role(proposal.role)}
      </span>
      <span className="ml-auto rounded-pill border border-border px-2 py-0.5 text-[10.5px] text-subtle-foreground">
        {copy.episode.castPending}
      </span>
      {mine ? (
        <button
          type="button"
          onClick={withdraw}
          disabled={busy}
          className="text-[11px] text-subtle-foreground underline outline-none hover:text-foreground"
        >
          {copy.episode.castWithdraw}
        </button>
      ) : null}
    </li>
  );
}
