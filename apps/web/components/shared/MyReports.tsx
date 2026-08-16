"use client";

import { useEffect, useState } from "react";

import { useCopy } from "@/components/i18n/LocaleProvider";
import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { viewerApi } from "@/lib/auth";
import type { Report } from "@/lib/api/podcast";

/**
 * What happened to the things you reported.
 *
 * 🔁 This is the reader `resolution_note` never had. The column has existed on
 * `Report` since wave 13, and moderators could fill it in, but nothing showed
 * it to the person who filed the report - so reporting was a write-only act.
 * A moderator writes one line; it shows up here.
 *
 * 🔒 The endpoint filters on the verified actor. It takes no user id, so this
 * cannot be pointed at somebody else's reports.
 */
export function MyReports() {
  const copy = useCopy();
  const { signedIn } = useViewerAuth();
  const [reports, setReports] = useState<Report[] | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    viewerApi
      .get<Report[]>("/api/me/reports", {
        signal: controller.signal,
        cache: "no-store",
      })
      .then(setReports)
      // Additive: a failure here must not break the profile page.
      .catch(() => setReports([]));
    return () => controller.abort();
  }, [signedIn]);

  if (!signedIn || reports === null) return null;

  const statusLabel = (status: string) =>
    ({
      pending: copy.report.statusPending,
      resolved: copy.report.statusResolved,
      dismissed: copy.report.statusDismissed,
    })[status] ?? copy.report.statusPending;

  // Takes the raw key and falls back internally, so no caller needs a
  // literal default - `?? "other"` at the call site reads to the copy
  // scanner as display text, and that guard may not be widened.
  const categoryLabel = (category: string | null | undefined) =>
    ({
      wrong_participants: copy.report.catWrongParticipants,
      wrong_info: copy.report.catWrongInfo,
      not_an_episode: copy.report.catNotAnEpisode,
      bug: copy.report.catBug,
      suggestion: copy.report.catSuggestion,
      other: copy.report.catOther,
    })[category ?? ""] ?? copy.report.catOther;

  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-semibold">{copy.report.mineTitle}</h2>

      {reports.length === 0 ? (
        <p className="mt-2 text-small text-subtle-foreground">{copy.report.mineEmpty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {reports.map((report) => (
            <li
              key={report.id}
              className="rounded-lg border border-border bg-card px-3 py-2.5"
            >
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
                {!report.target_type ? (
                  <span className="text-[11px] text-faint-foreground">
                    {copy.report.aboutTheSite}
                  </span>
                ) : null}
              </div>

              <p className="mt-1.5 text-small">{report.reason}</p>

              {/* The whole point: the moderator's reply back to the reporter. */}
              {report.resolution_note ? (
                <p className="mt-1.5 border-l-2 border-border pl-2.5 text-[12.5px] text-subtle-foreground">
                  {report.resolution_note}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
