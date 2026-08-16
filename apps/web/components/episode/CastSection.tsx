"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { useViewerAuth } from "@/components/auth/ViewerAuthProvider";
import { useEpisodeViewer } from "./viewer/EpisodeViewerContext";
import { viewerApi } from "@/lib/auth";
import { api } from "@/lib/api/client";
import type { EpisodeCast, Person, ViewerState } from "@/lib/api/podcast";

import { CastProposer, PendingCastRow } from "./CastProposer";

/** Stable reference, so the derived value does not change identity per render. */
const EMPTY_IDS: number[] = [];

interface Props {
  youtubeId: string;
  /** Server-rendered, so first paint and crawlers see the confirmed cast. */
  initialCast: EpisodeCast;
  /** Admin-curated personas offered in the picker. */
  people: Person[];
}

/**
 * Confirmed cast plus open proposals.
 *
 * 🚨 The two lists stay visually and structurally separate. Only `confirmed`
 * exists in `EpisodeParticipant`, so only `confirmed` is what Meilisearch and
 * `?person=` agree with - rendering a pending guess as though it were settled
 * would make this page contradict every other surface on the site.
 *
 * Client-side for the same reason as the moments list: the cast is fetched
 * with `revalidate: 60` and `router.refresh()` does not invalidate the server
 * fetch cache, so a suggestion would take up to a minute to appear.
 */
export function CastSection({
  youtubeId,
  initialCast,
  people,
}: Props) {
  const copy = useCopy();
  const { signedIn } = useViewerAuth();
  const { requireIdentity } = useEpisodeViewer();
  const [cast, setCast] = useState<EpisodeCast>(initialCast);
  // 🚨 DERIVED, not reset in an effect. `react-hooks/set-state-in-effect` is
  // an error in this repo: a synchronous setState inside an effect causes
  // cascading renders. Signing out simply makes the derived value empty.
  const [fetchedIds, setMyProposalIds] = useState<number[]>([]);
  const myProposalIds = signedIn ? fetchedIds : EMPTY_IDS;

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    viewerApi
      .get<ViewerState>(`/api/episodes/${encodeURIComponent(youtubeId)}/me`, {
        signal: controller.signal,
        cache: "no-store",
      })
      .then((state) => setMyProposalIds(state.my_proposal_ids ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [youtubeId, signedIn]);

  const reload = useCallback(async () => {
    try {
      const fresh = await api.get<EpisodeCast>(
        `/api/episodes/${encodeURIComponent(youtubeId)}/participants`,
        { cache: "no-store" },
      );
      setCast(fresh);
      if (signedIn) {
        const state = await viewerApi.get<ViewerState>(
          `/api/episodes/${encodeURIComponent(youtubeId)}/me`,
          { cache: "no-store" },
        );
        setMyProposalIds(state.my_proposal_ids ?? []);
      }
    } catch {
      // The write succeeded; a failed refresh must not read as a failed save.
    }
  }, [youtubeId, signedIn]);

  const confirmed = cast.confirmed ?? [];
  const pending = cast.pending ?? [];

  return (
    <>
      {confirmed.length > 0 ? (
        <div className="noscroll mt-3 flex gap-2.5 overflow-x-auto pb-0.5">
          {confirmed.map((person) => (
            <Link
              key={person.slug}
              href={`/episodes?person=${encodeURIComponent(person.slug)}`}
              className="w-[92px] shrink-0 text-center outline-none"
            >
              <span className="mx-auto block w-16">
                <PersonAvatar name={person.name} slug={person.slug} size="md" />
              </span>
              <span className="mt-2 block text-[12.5px] leading-tight font-semibold">
                {person.name}
              </span>
              <span className="mt-0.5 block text-[11px] text-subtle-foreground">
                {copy.episode.role(person.role)}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-2.5 text-small text-subtle-foreground">{copy.episode.castEmpty}</p>
      )}

      {pending.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {pending.map((proposal) => (
            <PendingCastRow
              key={proposal.id}
              proposal={proposal}
              myProposalIds={myProposalIds}
              onWithdrawn={reload}
            />
          ))}
        </ul>
      ) : null}

      <CastProposer
        youtubeId={youtubeId}
        people={people}
        onSignInRequired={requireIdentity}
        onProposed={reload}
      />
    </>
  );
}
