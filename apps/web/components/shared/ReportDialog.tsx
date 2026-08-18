"use client";

import { useState } from "react";
import { Flag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { notify } from "@/components/ui/toast";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { viewerApi } from "@/lib/auth";
import { isApiError } from "@/lib/api/client";
import type { Report } from "@/lib/api/podcast";
import { cn } from "@/lib/utils";

/**
 * Categories that describe the SITE and therefore carry no target. The API
 * enforces the same split - "wrong participants" with nothing to point at
 * would be a perfectly valid, perfectly useless row.
 */
const TARGETLESS = ["bug", "suggestion"] as const;
const TARGETED = ["wrong_participants", "wrong_info", "not_an_episode", "other"] as const;

type TargetType = "episode" | "comment" | "moment" | "episodetopic" | "rating";

interface Target {
  /** Omit both to file a general report about the site. */
  targetType?: TargetType;
  targetId?: number;
}

interface Props extends Target {
  /** Rendered as a small inline flag rather than a full button. */
  compact?: boolean;
}

/**
 * The form and the submit, with no opinion about what opened it.
 *
 * 🚨 Extracted so the header button and the inline trigger share ONE
 * implementation. Two copies of a form posting to a throttled, deduplicated
 * write endpoint is two places for the 409 handling to drift apart, and the
 * duplicate branch is the half nobody re-tests.
 *
 * `layout` decides only who draws the chrome: `inline` draws its own card and
 * heading, `sheet` lets the Sheet own the title and description it already
 * renders, so the same two lines do not appear twice.
 */
function ReportForm({
  targetType,
  targetId,
  layout,
  onDone,
}: Target & { layout: "inline" | "sheet"; onDone: () => void }) {
  const copy = useCopy();

  const hasTarget = Boolean(targetType && targetId);
  const categories = hasTarget ? [...TARGETED, ...TARGETLESS] : [...TARGETLESS];

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
      onDone();
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

  const inline = layout === "inline";

  return (
    <form
      onSubmit={submit}
      className={cn(
        "text-left",
        inline ? "mt-2 rounded-lg border border-border bg-card p-3" : "mt-4",
      )}
    >
      {inline ? (
        <>
          <p className="text-small font-semibold">{copy.report.title}</p>
          <p className="mt-1 text-[12px] text-subtle-foreground">{copy.report.intro}</p>
        </>
      ) : null}

      <label className={cn("flex flex-col gap-1", inline && "mt-3")}>
        <span className="text-[12px] text-subtle-foreground">
          {copy.report.categoryLabel}
        </span>
        {/* ⚠️ `text-small` is 13px, which is the DESKTOP size the design
            specifies. The iOS focus-zoom fix is not this class: the unlayered
            rule in globals.css raises every input/textarea/select to 16px on
            coarse pointers and under 768px. Hardcoding 16px here would win on
            desktop too and quietly re-size the form for the pointer that never
            had the problem. */}
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

      <div className={cn("flex gap-2", inline ? "mt-2.5" : "mt-4")}>
        <Button
          type="submit"
          size={inline ? "sm" : "lg"}
          disabled={saving}
          className={inline ? undefined : "flex-1"}
        >
          {copy.report.submit}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={inline ? "sm" : "lg"}
          onClick={() => {
            setError(null);
            onDone();
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

/**
 * The inline trigger: a flag that swaps itself for the form, in place.
 *
 * Used where the report is ABOUT something on the page - an episode, a comment
 * - and in the footer, where it is the site-wide entry point that can carry no
 * target at all.
 */
export function ReportDialog({ targetType, targetId, compact = false }: Props) {
  const copy = useCopy();
  const { signedIn, signIn } = useViewerAuth();
  const [open, setOpen] = useState(false);

  function start() {
    if (!signedIn) {
      signIn();
      return;
    }
    setOpen(true);
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
    <ReportForm
      targetType={targetType}
      targetId={targetId}
      layout="inline"
      onDone={() => setOpen(false)}
    />
  );
}

/**
 * The header entry point: one small flag that opens the form OVER the current
 * page.
 *
 * 🚨 A sheet, not the inline form, and not a link to a separate page. The whole
 * value of a report in the header is that it is filed from wherever the problem
 * is - navigating away loses the page being described, and the inline form
 * cannot expand inside a 54px sticky header.
 *
 * 🚨 It reuses `size="icon"` exactly like the settings button beside it. Both
 * carry `.tap-target`, which grows the hit area to 44px with an INVISIBLE
 * pseudo-element: at 390px a 38px control grows 3px a side into an 8px gap, so
 * two of them meet at 6px and do not overlap. A bigger control here would
 * silently start swallowing its neighbour taps with nothing on screen to show
 * it.
 *
 * It carries no target, so its categories are the two site-wide ones - which is
 * exactly what a header report is for.
 */
export function ReportSheetButton() {
  const copy = useCopy();
  const { signedIn, signIn } = useViewerAuth();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="elevated"
        size="icon"
        shape="rounded"
        aria-label={copy.report.trigger}
        onClick={() => (signedIn ? setOpen(true) : signIn())}
        className="tap-target text-muted-foreground"
      >
        <Flag className="size-[17px]" aria-hidden strokeWidth={2.2} />
      </Button>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={copy.report.title}
        description={copy.report.intro}
      >
        <ReportForm layout="sheet" onDone={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
