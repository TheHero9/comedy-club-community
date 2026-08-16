"use client";

import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { useEpisodeViewer } from "./viewer/EpisodeViewerContext";
import { viewerApi } from "@/lib/auth";
import { api } from "@/lib/api/client";
import type { Moment, ViewerState } from "@/lib/api/podcast";
import { formatTimestamp, youtubeMomentUrl } from "@/lib/format";

import { MomentComposer, MomentOwnerControls } from "./MomentComposer";

/** Stable reference, so the derived value does not change identity per render. */
const EMPTY_IDS: number[] = [];

interface Props {
  youtubeId: string;
  durationSec: number | null;
  /** Server-rendered list, so the first paint and the crawler both see content. */
  initialMoments: Moment[];
}

/**
 * The moments list, owning its own state after first paint.
 *
 * 🚨 WHY THIS IS A CLIENT COMPONENT rather than server-rendered with a
 * `router.refresh()` after each write: the list is fetched with
 * `{ next: { revalidate: 60 } }`, and `router.refresh()` explicitly does NOT
 * invalidate the server-side fetch cache. A member would add a moment, see
 * nothing change for up to a minute, and reasonably conclude the button was
 * broken. Re-fetching `no-store` here is the only way the new row appears at
 * the moment it exists.
 *
 * The server still renders `initialMoments`, so SEO and first paint are
 * unaffected - this only takes over once the member interacts.
 */
export function MomentsSection({
  youtubeId,
  durationSec,
  initialMoments,
}: Props) {
  const copy = useCopy();
  const { signedIn } = useViewerAuth();
  const { requireIdentity } = useEpisodeViewer();
  const [moments, setMoments] = useState<Moment[]>(initialMoments);
  // 🚨 DERIVED, not reset in an effect. `react-hooks/set-state-in-effect` is
  // an error in this repo: a synchronous setState inside an effect causes
  // cascading renders. Signing out simply makes the derived value empty.
  const [fetchedIds, setMyMomentIds] = useState<number[]>([]);
  const myMomentIds = signedIn ? fetchedIds : EMPTY_IDS;

  // 🔒 Ownership comes from the authed viewer-state call. The public list is
  // cached and has no actor, and its `author` is a display name - which two
  // members can share and either can edit, so it is not an identity.
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    viewerApi
      .get<ViewerState>(`/api/episodes/${encodeURIComponent(youtubeId)}/me`, {
        signal: controller.signal,
        cache: "no-store",
      })
      .then((state) => setMyMomentIds(state.my_moment_ids ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [youtubeId, signedIn]);

  const reload = useCallback(async () => {
    try {
      const fresh = await api.get<Moment[]>(
        `/api/episodes/${encodeURIComponent(youtubeId)}/moments`,
        { cache: "no-store" },
      );
      setMoments(fresh);
      if (signedIn) {
        const state = await viewerApi.get<ViewerState>(
          `/api/episodes/${encodeURIComponent(youtubeId)}/me`,
          { cache: "no-store" },
        );
        setMyMomentIds(state.my_moment_ids ?? []);
      }
    } catch {
      // The write already succeeded; a failed refresh must not look like a
      // failed save. The next navigation picks it up.
    }
  }, [youtubeId, signedIn]);

  return (
    <>
      {/* 🚨 Printed whether or not there are moments. With moments present the
          list explained nothing, and with none the empty state only said
          "nothing labelled yet". */}
      <p className="mt-2.5 text-small text-subtle-foreground">
        {copy.episode.momentsHowTo}
      </p>

      {moments.length > 0 ? (
        <>
          {/* Ticks are positioned by timestamp, so the bar only means
              something once the duration is known. */}
          {durationSec ? (
            <div className="relative mt-3 h-8">
              <span className="absolute inset-x-0 top-[13px] h-1.5 rounded-pill bg-elevated" />
              {moments.map((moment) => (
                <span
                  key={moment.id}
                  className="absolute top-[7px] h-[18px] w-1 rounded-pill bg-gold"
                  style={{
                    left: `${Math.min(99, (moment.timestamp_sec / durationSec) * 100)}%`,
                  }}
                />
              ))}
            </div>
          ) : null}

          <ul className="mt-1 flex flex-col gap-2">
            {moments.map((moment) => (
              <li key={moment.id} className="flex items-center gap-2">
                <a
                  href={youtubeMomentUrl(youtubeId, moment.timestamp_sec)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[52px] flex-1 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 outline-none"
                >
                  <span className="inline-flex h-[27px] shrink-0 items-center rounded-sm bg-elevated px-2 font-mono text-[12.5px] font-bold text-gold tabular">
                    {formatTimestamp(moment.timestamp_sec)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-snug">{moment.label}</span>
                    {moment.author ? (
                      <span className="mt-0.5 block text-[11px] text-subtle-foreground">
                        {moment.author}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[12.5px] text-muted-foreground tabular">
                    {copy.episode.momentVotes(moment.score)}
                  </span>
                </a>
                <MomentOwnerControls
                  momentId={moment.id}
                  myMomentIds={myMomentIds}
                  onDeleted={reload}
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          className="mt-3"
          title={copy.episode.momentsEmptyTitle}
          body={copy.episode.momentsEmptyBody}
        />
      )}

      <MomentComposer
        youtubeId={youtubeId}
        durationSec={durationSec}
        onSignInRequired={requireIdentity}
        onAdded={reload}
      />
    </>
  );
}
