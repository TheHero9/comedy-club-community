"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, X } from "lucide-react";
import Link from "next/link";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import type { Report } from "@/lib/api/podcast";
import { viewerApi } from "@/lib/auth";
import { formatDate } from "@/lib/format";

/**
 * The moderator side of reporting.
 *
 * 🚨 WHY THIS EXISTS: `GET /api/reports` and `POST /api/reports/{id}/resolve`
 * have been implemented since wave 13 with NO caller. Reports were therefore
 * filed into a table nobody could see from the product - the owner's words
 * after filing one: "now where should I see it as an admin? I don't see
 * anything anywhere, I have no clue where I got it." An endpoint with no reader
 * is not a feature, and `resolution_note` in particular is a reply the reporter
 * is already shown on their profile - it just had nothing writing it.
 *
 * ⚠️ Handled reports are behind a toggle rather than a second page. A moderator
 * needs "what is waiting" almost always and "what did we decide" occasionally,
 * and a list that mixes them makes the queue look permanently full.
 */
export function ReportQueue() {
  const copy = useCopy();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);

  const reports = useQuery({
    queryKey: ["manage", "reports", showAll ? "all" : "pending"],
    queryFn: () =>
      viewerApi.get<Report[]>("/api/reports", {
        query: { status: showAll ? "all" : "pending" },
        cache: "no-store",
      }),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["manage", "reports"] });
  };

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-semibold">{copy.manage.reportsTitle}</h2>
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="rounded-pill border border-border px-3 py-1 text-[12px] text-subtle-foreground outline-none"
        >
          {showAll ? copy.manage.reportsShowPending : copy.manage.reportsShowAll}
        </button>
      </div>

      {reports.isLoading ? (
        <Skeleton className="mt-3 h-20 w-full" />
      ) : (reports.data ?? []).length === 0 ? (
        <p className="mt-2 text-small text-subtle-foreground">
          {copy.manage.reportsEmpty}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {(reports.data ?? []).map((report) => (
            <ReportRow key={report.id} report={report} onDone={refresh} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportRow({ report, onDone }: { report: Report; onDone: () => void }) {
  const copy = useCopy();
  const [note, setNote] = useState("");

  const resolve = useMutation({
    mutationFn: (status: "resolved" | "dismissed") =>
      viewerApi.post<Report>(`/api/reports/${report.id}/resolve`, {
        status,
        resolution_note: note,
      }),
    onSuccess: () => {
      notify.success(copy.manage.reportsResolved);
      onDone();
    },
    onError: () => notify.error(copy.errors.generic),
  });

  const categoryLabel = (category: string | null | undefined) =>
    ({
      wrong_participants: copy.report.catWrongParticipants,
      wrong_info: copy.report.catWrongInfo,
      not_an_episode: copy.report.catNotAnEpisode,
      bug: copy.report.catBug,
      suggestion: copy.report.catSuggestion,
      other: copy.report.catOther,
    })[category ?? ""] ?? copy.report.catOther;

  const statusLabel = (status: string) =>
    ({
      pending: copy.report.statusPending,
      resolved: copy.report.statusResolved,
      dismissed: copy.report.statusDismissed,
    })[status] ?? copy.report.statusPending;

  const pending = report.status === "pending";

  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-pill border border-border px-2 py-0.5 text-[11px] text-subtle-foreground">
          {categoryLabel(report.category)}
        </span>
        <span
          className={
            report.status === "resolved"
              ? "rounded-pill border border-border px-2 py-0.5 text-[11px] text-gold"
              : "rounded-pill border border-border px-2 py-0.5 text-[11px] text-subtle-foreground"
          }
        >
          {statusLabel(report.status)}
        </span>
        {report.reporter ? (
          <span className="text-[11.5px] text-faint-foreground">
            {copy.manage.reportsFrom(report.reporter)}
          </span>
        ) : null}
        <span className="font-mono text-[11px] text-faint-foreground tabular">
          {formatDate(report.created_at, copy.common.months)}
        </span>
      </div>

      <p className="mt-1.5 text-small">{report.reason}</p>

      {/* 🚨 WHAT was reported, not just its row id. A queue that says
          "comment 41" cannot be acted on without leaving the page to look it
          up, which is most of why this endpoint went unused for so long. */}
      {report.target_label ? (
        <p className="mt-1 border-l-2 border-border pl-2.5 text-[12.5px] text-subtle-foreground">
          {report.target_label}
        </p>
      ) : null}

      {report.target_youtube_id ? (
        <Link
          href={`/e/${report.target_youtube_id}`}
          className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-primary-text outline-none"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {copy.manage.reportsOpenTarget}
        </Link>
      ) : null}

      {pending ? (
        <div className="mt-2.5 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[190px] flex-1 flex-col gap-1">
            <span className="text-[12px] text-subtle-foreground">
              {copy.manage.reportsNoteLabel}
            </span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={280}
              className="rounded-pill border border-border bg-background px-3 py-2 text-small"
            />
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate("resolved")}
            >
              <Check className="h-4 w-4" />
              {copy.manage.reportsResolve}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate("dismissed")}
            >
              <X className="h-4 w-4" />
              {copy.manage.reportsDismiss}
            </Button>
          </div>
        </div>
      ) : report.resolution_note ? (
        <p className="mt-1.5 text-[12.5px] text-subtle-foreground">
          {report.resolution_note}
        </p>
      ) : null}
    </li>
  );
}
