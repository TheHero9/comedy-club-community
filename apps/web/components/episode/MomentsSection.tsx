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

/**
 * How many rows a section shows before it collapses behind "show all".
 *
 * 🚨 The owner's concern, verbatim: "I don't know what will happen if you add
 * like 30 moments, if it will flood". It will - the moments list sits inside
 * an episode page that also carries ratings, topics and comments, so an
 * uncapped list pushes all of it below a wall of rows. Eight is roughly one
 * phone screen, which is the unit that matters here.
 */
const COLLAPSED_ROWS = 8;

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

  // 🚨 Split by OWNERSHIP, from `my_moment_ids` - the authed call - and never
  // from `author`, which is a display name two members can share.
  const mine = moments.filter((moment) => myMomentIds.includes(moment.id));
  const theirs = moments.filter((moment) => !myMomentIds.includes(moment.id));

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
          <MomentTimeline moments={moments} durationSec={durationSec} />

          {/* Only headed once BOTH sections exist. A single heading over the
              only list on screen is noise, and "From everyone else" above
              every moment on an episode you have never touched is worse than
              noise - it is wrong. */}
          {mine.length > 0 ? (
            <MomentGroup
              heading={theirs.length > 0 ? copy.episode.momentsYours : null}
              moments={mine}
              youtubeId={youtubeId}
              myMomentIds={myMomentIds}
              onChanged={reload}
            />
          ) : null}

          {theirs.length > 0 ? (
            <MomentGroup
              heading={mine.length > 0 ? copy.episode.momentsOthers : null}
              moments={theirs}
              youtubeId={youtubeId}
              myMomentIds={myMomentIds}
              onChanged={reload}
            />
          ) : null}
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

/**
 * The tick bar: where in the episode the moments are.
 *
 * Ticks are positioned by timestamp, so the bar only means something once the
 * duration is known - and a moment with no timestamp has no position on it at
 * all, which is exactly why those are filtered out rather than pinned to 0.
 */
function MomentTimeline({
  moments,
  durationSec,
}: {
  moments: Moment[];
  durationSec: number | null;
}) {
  if (!durationSec) return null;

  const placed = moments.filter((moment) => moment.timestamp_sec !== null);
  if (placed.length === 0) return null;

  return (
    <div className="relative mt-3 h-8">
      <span className="absolute inset-x-0 top-[13px] h-1.5 rounded-pill bg-elevated" />
      {placed.map((moment) => (
        <span
          key={moment.id}
          className="absolute top-[7px] h-[18px] w-1 rounded-pill bg-gold"
          style={{
            left: `${Math.min(99, ((moment.timestamp_sec ?? 0) / durationSec) * 100)}%`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * One ownership group, capped until asked to expand.
 *
 * The cap is per-group on purpose: yours collapsing because someone else added
 * twenty would hide your own rows behind a control you did not cause.
 */
function MomentGroup({
  heading,
  moments,
  youtubeId,
  myMomentIds,
  onChanged,
}: {
  heading: string | null;
  moments: Moment[];
  youtubeId: string;
  myMomentIds: number[];
  onChanged: () => void | Promise<void>;
}) {
  const copy = useCopy();
  const [expanded, setExpanded] = useState(false);
  const overflowing = moments.length > COLLAPSED_ROWS;
  const shown = expanded || !overflowing ? moments : moments.slice(0, COLLAPSED_ROWS);

  return (
    <div className="mt-3">
      {heading ? <p className="text-eyebrow">{heading}</p> : null}

      <ul className="mt-1.5 flex flex-col gap-2">
        {shown.map((moment) => (
          <li key={moment.id} className="flex items-center gap-2">
            <MomentBody moment={moment} youtubeId={youtubeId} />
            <MomentOwnerControls
              momentId={moment.id}
              myMomentIds={myMomentIds}
              onDeleted={onChanged}
            />
          </li>
        ))}
      </ul>

      {overflowing ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-2 rounded-pill border border-border px-3 py-1.5 text-[12.5px] text-subtle-foreground outline-none"
        >
          {expanded
            ? copy.episode.momentsShowFewer
            : copy.episode.momentsShowAll(moments.length)}
        </button>
      ) : null}
    </div>
  );
}

/**
 * One row. A LINK when it points at a second of video, a plain block when it
 * does not.
 *
 * 🚨 The element type changes, not just the styling. A timestamp-less moment
 * is a note about the whole episode, and rendering it as an anchor to the
 * episode start would look like a working deep link and land at 0:00 - the
 * same reason `Moment.deep_link` returns None server-side rather than dropping
 * the `&t=`.
 */
function MomentBody({
  moment,
  youtubeId,
}: {
  moment: Moment;
  youtubeId: string;
}) {
  const copy = useCopy();
  const shell =
    "flex min-h-[52px] flex-1 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 outline-none";

  const inner = (
    <>
      {moment.timestamp_sec === null ? (
        <span
          title={copy.episode.momentNoteHint}
          className="inline-flex h-[27px] shrink-0 items-center rounded-sm border border-dashed border-border px-2 text-[11px] text-subtle-foreground"
        >
          {copy.episode.momentNote}
        </span>
      ) : (
        <span className="inline-flex h-[27px] shrink-0 items-center rounded-sm bg-elevated px-2 font-mono text-[12.5px] font-bold text-gold tabular">
          {formatTimestamp(moment.timestamp_sec)}
        </span>
      )}
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
    </>
  );

  if (moment.timestamp_sec === null) {
    return <div className={shell}>{inner}</div>;
  }

  return (
    <a
      href={youtubeMomentUrl(youtubeId, moment.timestamp_sec)}
      target="_blank"
      rel="noopener noreferrer"
      className={shell}
    >
      {inner}
    </a>
  );
}
