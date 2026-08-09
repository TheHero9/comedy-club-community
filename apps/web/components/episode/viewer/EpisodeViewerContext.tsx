"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { notify } from "@/components/ui/toast";
import { isApiError } from "@/lib/api/client";
import type {
  FavoriteResult,
  RatingResult,
  ViewerState,
  WatchSummary,
} from "@/lib/api/podcast";
import { IS_SIGNED_IN, viewerApi } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { toIsoDay } from "@/lib/format";

/**
 * One place for everything the signed-in user has done with this episode.
 *
 * The episode page shows the same state in three places - the mobile score
 * strip, the mobile action bar and the desktop sidebar - so it lives in a
 * context rather than in each of them. Server-rendered content stays server
 * rendered and simply sits inside the provider as children.
 *
 * 🚨 Signed out is a first-class state, not an error. Every affordance stays
 * visible and opens the sign-in sheet instead of doing nothing.
 */
export interface EpisodeViewerSeed {
  youtubeId: string;
  title: string;
  watchUrl: string;
  publicScore: number | null;
  ratingCount: number;
  eliteScore: number | null;
  eliteBand: string | null;
}

type SheetKind = "rate" | "log" | "signin" | null;

interface EpisodeViewerValue extends EpisodeViewerSeed {
  signedIn: boolean;
  myRating: number | null;
  isFavorite: boolean;
  watchEvents: WatchSummary["events"];
  watchCount: number;
  saving: boolean;
  sheet: SheetKind;
  openSheet: (kind: Exclude<SheetKind, null>) => void;
  closeSheet: () => void;
  /** Opens the rating sheet, or the sign-in sheet when there is no identity. */
  requestRate: () => void;
  requestLog: () => void;
  saveRating: (score: number) => Promise<void>;
  clearRating: () => Promise<void>;
  addWatch: (isoDay: string) => Promise<void>;
  removeWatch: (eventId: number) => Promise<void>;
  toggleWatched: () => Promise<void>;
  toggleFavorite: () => Promise<void>;
}

const EpisodeViewerContext = createContext<EpisodeViewerValue | null>(null);

export function useEpisodeViewer(): EpisodeViewerValue {
  const value = useContext(EpisodeViewerContext);
  if (!value) {
    throw new Error("useEpisodeViewer must be used inside EpisodeViewerProvider");
  }
  return value;
}

export function EpisodeViewerProvider({
  seed,
  children,
}: {
  seed: EpisodeViewerSeed;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [myRating, setMyRating] = useState<number | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [watchEvents, setWatchEvents] = useState<WatchSummary["events"]>([]);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);

  /**
   * The public numbers after this viewer's own rating write, or null when they
   * have not written one on this episode yet.
   *
   * 🚨 The server render is the source of truth, and this is an OVERRIDE, not a
   * copy. Copying the props into state and re-syncing them in an effect looks
   * simpler but is wrong twice over: it paints the stale number for a frame
   * after a navigation, and it schedules a cascading render. Tagging the
   * override with the episode it belongs to makes the reset fall out of the
   * render instead.
   */
  const [override, setOverride] = useState<
    | null
    | {
        youtubeId: string;
        publicScore: number | null;
        ratingCount: number;
        eliteScore: number | null;
      }
  >(null);

  const live = override?.youtubeId === seed.youtubeId ? override : null;
  const publicScore = live ? live.publicScore : seed.publicScore;
  const ratingCount = live ? live.ratingCount : seed.ratingCount;
  const eliteScore = live ? live.eliteScore : seed.eliteScore;

  useEffect(() => {
    if (!IS_SIGNED_IN) return;
    const controller = new AbortController();
    const path = `/api/episodes/${encodeURIComponent(seed.youtubeId)}`;

    Promise.all([
      viewerApi.get<ViewerState>(`${path}/me`, {
        signal: controller.signal,
        cache: "no-store",
      }),
      viewerApi.get<WatchSummary>(`${path}/watch`, {
        signal: controller.signal,
        cache: "no-store",
      }),
    ])
      .then(([state, watch]) => {
        setMyRating(state.rating ?? null);
        setIsFavorite(state.is_favorite);
        setWatchEvents(watch.events);
      })
      // Viewer state is additive. If it fails the page still works, so this
      // must not become a toast on every load of every episode.
      .catch(() => undefined);

    return () => controller.abort();
  }, [seed.youtubeId]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const openSheet = useCallback(
    (kind: Exclude<SheetKind, null>) => setSheet(kind),
    [],
  );

  const requireIdentity = useCallback(() => {
    if (IS_SIGNED_IN) return true;
    setSheet("signin");
    return false;
  }, []);

  const applyRatingResult = useCallback(
    (result: RatingResult) => {
      setOverride({
        youtubeId: seed.youtubeId,
        publicScore: result.public_score,
        ratingCount: result.rating_count,
        eliteScore: result.elite_score,
      });
    },
    [seed.youtubeId],
  );

  const path = `/api/episodes/${encodeURIComponent(seed.youtubeId)}`;

  const saveRating = useCallback(
    async (score: number) => {
      if (!requireIdentity()) return;
      setSaving(true);
      try {
        const result = await viewerApi.put<RatingResult>(`${path}/rating`, { score });
        setMyRating(score);
        applyRatingResult(result);
        setSheet(null);
        notify.success(copy.rating.savedToast);
        // The grid, the leaderboard and every card of this episode are server
        // rendered from the same numbers.
        router.refresh();
      } catch (error) {
        notify.error(
          isApiError(error) ? error.userMessage : copy.rating.failedToast,
        );
      } finally {
        setSaving(false);
      }
    },
    [applyRatingResult, path, requireIdentity, router],
  );

  const clearRating = useCallback(async () => {
    if (!requireIdentity()) return;
    setSaving(true);
    try {
      const result = await viewerApi.delete<RatingResult>(`${path}/rating`);
      setMyRating(null);
      applyRatingResult(result);
      setSheet(null);
      notify.success(copy.rating.removedToast);
      router.refresh();
    } catch (error) {
      notify.error(isApiError(error) ? error.userMessage : copy.errors.generic);
    } finally {
      setSaving(false);
    }
  }, [applyRatingResult, path, requireIdentity, router]);

  const addWatch = useCallback(
    async (isoDay: string) => {
      if (!requireIdentity()) return;

      // 🚨 The duplicate guard is the UI's, not the API's: `WatchEvent` has no
      // unique constraint on (user, episode, date) because a genuine second
      // viewing on the same day is legal data. What the design rejects is the
      // accidental double tap, so it is rejected here, where the intent is.
      if (watchEvents.some((event) => event.watched_on === isoDay)) {
        notify.warning(copy.watchLog.duplicateToast);
        return;
      }

      try {
        const summary = await viewerApi.post<WatchSummary>(`${path}/watch`, {
          watched_on: isoDay,
        });
        setWatchEvents(summary.events);
        notify.success(copy.watchLog.savedToast(isoDay));
      } catch (error) {
        notify.error(isApiError(error) ? error.userMessage : copy.errors.generic);
      }
    },
    [path, requireIdentity, watchEvents],
  );

  const removeWatch = useCallback(
    async (eventId: number) => {
      if (!requireIdentity()) return;
      try {
        await viewerApi.delete(`/api/watch/${eventId}`);
        setWatchEvents((events) => events.filter((event) => event.id !== eventId));
      } catch (error) {
        notify.error(isApiError(error) ? error.userMessage : copy.errors.generic);
      }
    },
    [requireIdentity],
  );

  const toggleWatched = useCallback(async () => {
    if (!requireIdentity()) return;
    if (watchEvents.length === 0) {
      await addWatch(toIsoDay(new Date()));
      return;
    }
    // Already watched: the button opens the log rather than destroying it.
    setSheet("log");
  }, [addWatch, requireIdentity, watchEvents.length]);

  const toggleFavorite = useCallback(async () => {
    if (!requireIdentity()) return;
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      if (next) {
        await viewerApi.put<FavoriteResult>(`${path}/favorite`);
        notify.success(copy.watchLog.favoriteToast);
      } else {
        await viewerApi.delete<FavoriteResult>(`${path}/favorite`);
        notify.success(copy.watchLog.unfavoriteToast);
      }
    } catch (error) {
      setIsFavorite(!next);
      notify.error(isApiError(error) ? error.userMessage : copy.errors.generic);
    }
  }, [isFavorite, path, requireIdentity]);

  const value = useMemo<EpisodeViewerValue>(
    () => ({
      ...seed,
      publicScore,
      ratingCount,
      eliteScore,
      signedIn: IS_SIGNED_IN,
      myRating,
      isFavorite,
      watchEvents,
      watchCount: watchEvents.length,
      saving,
      sheet,
      openSheet,
      closeSheet,
      requestRate: () => {
        if (requireIdentity()) setSheet("rate");
      },
      requestLog: () => {
        if (requireIdentity()) setSheet("log");
      },
      saveRating,
      clearRating,
      addWatch,
      removeWatch,
      toggleWatched,
      toggleFavorite,
    }),
    [
      addWatch,
      clearRating,
      closeSheet,
      eliteScore,
      isFavorite,
      myRating,
      openSheet,
      publicScore,
      ratingCount,
      removeWatch,
      requireIdentity,
      saveRating,
      saving,
      seed,
      sheet,
      toggleFavorite,
      toggleWatched,
      watchEvents,
    ],
  );

  return (
    <EpisodeViewerContext.Provider value={value}>
      {children}
    </EpisodeViewerContext.Provider>
  );
}
