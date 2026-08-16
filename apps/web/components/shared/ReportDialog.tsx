"use client";

import { useState } from "react";
import { Flag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { viewerApi } from "@/lib/auth";
import { isApiError } from "@/lib/api/client";
import type { Report } from "@/lib/api/podcast";

/**
 * Categories that describe the SITE and therefore carry no target. The API
 * enforces the same split - "wrong participants" with nothing to point at
 * would be a perfectly valid, perfectly useless row.
 */
const TARGETLESS = ["bug", "suggestion"] as const;
const TARGETED = ["wrong_participants", "wrong_info", "not_an_episode", "other"] as const;

interface Props {
  /** Omit both to file a general report about the site. */
  targetType?: "episode" | "comment" | "moment" | "episodetopic" | "rating";
  targetId?: number;
  /** Rendered as a small inline flag rather than a full button. */
  compact?: boolean;
}

export function ReportDialog({ targetType, targetId, compact = false }: Props) {
  const copy = useCopy();
  const { signedIn, signIn } = useViewerAuth();

  const hasTarget = Boolean(targetType && targetId);
  const categories = hasTarget ? [...TARGETED, ...TARGETLESS] : [...TARGETLESS];

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(categories[0]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const label = (key: string) =>
    ({
      wrong_participants: copy.report.catWrongParticipants,
      wrong_info: copy.report.catWrongInfo,
      not_an_episode: copy.report.catNotAnEpisode,
      bug: copy.report.catBug,
      suggestion: copy.report.catSuggestion,
      other: copy.report.catOther,
    })[key] ?? copy.report.catOther;

  function start() {
    if (!signedIn) {
      signIn();
      return;
    }
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError(copy.report.detailPlaceholder);
      return;
    }

    // A targetless category detaches the target even on an episode page: the
    // member is telling us the SITE is broken, not this episode.
    const targetless = (TARGETLESS as readonly string[]).includes(category);
    const body: Record<string, unknown> = { category, reason: reason.trim() };
    if (hasTarget && !targetless) {
      body.target_type = targetType;
      body.target_id = targetId;
    }

    setSaving(true);
    try {
      await viewerApi.post<Report>("/api/reports", body);
      setReason("");
      setOpen(false);
      notify.success(copy.report.sent);
    } catch (caught) {
      if (isApiError(caught) && caught.status === 409) {
        setError(copy.report.duplicate);
      } else {
        setError(isApiError(caught) ? caught.userMessage : copy.errors.generic);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return compact ? (
      <button
        type="button"
        onClick={start}
        className="inline-flex items-center gap-1.5 text-[12px] text-subtle-foreground outline-none hover:text-foreground"
      >
        <Flag className="h-3.5 w-3.5" />
        {copy.report.trigger}
      </button>
    ) : (
      <Button variant="ghost" size="sm" onClick={start}>
        <Flag className="h-4 w-4" />
        {copy.report.trigger}
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-2 rounded-lg border border-border bg-card p-3 text-left"
    >
      <p className="text-small font-semibold">{copy.report.title}</p>
      <p className="mt-1 text-[12px] text-subtle-foreground">{copy.report.intro}</p>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[12px] text-subtle-foreground">
          {copy.report.categoryLabel}
        </span>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="rounded-pill border border-border bg-background px-3 py-2 text-small"
        >
          {categories.map((key) => (
            <option key={key} value={key}>
              {label(key)}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-2 flex flex-col gap-1">
        <span className="text-[12px] text-subtle-foreground">{copy.report.detailLabel}</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={copy.report.detailPlaceholder}
          maxLength={280}
          rows={3}
          className="rounded-lg border border-border bg-background px-3 py-2 text-small"
        />
      </label>

      <div className="mt-2.5 flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {copy.report.submit}
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
          {copy.report.cancel}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-primary-text">
          {error}
        </p>
      ) : null}
    </form>
  );
}
