"use client";

import { Calendar, Check, ExternalLink, Eye, Heart, Star, X } from "lucide-react";

import { SignInSheet } from "@/components/auth/SignInSheet";
import { useEpisodeViewer } from "@/components/episode/viewer/EpisodeViewerContext";
import { RateSheet } from "@/components/episode/viewer/RateSheet";
import { WatchLogSheet } from "@/components/episode/viewer/WatchLogSheet";
import { Button, ExternalLinkButton } from "@/components/ui/button";
import { useCopy } from "@/components/i18n/LocaleProvider";
import { formatDate, formatDelta, formatScore, relativeDay } from "@/lib/format";
import { bandStyle } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

/** Mounts the sheets once, wherever the provider is. */
export function EpisodeSheets() {
  const viewer = useEpisodeViewer();
  return (
    <>
      <RateSheet />
      <WatchLogSheet />
      <SignInSheet
        open={viewer.sheet === "signin"}
        onOpenChange={(open) => {
          if (!open) viewer.closeSheet();
        }}
      />
    </>
  );
}

/** The star + score + rate button, shared by the mobile strip and the header. */
function RateButton({ size = "md" }: { size?: "sm" | "md" }) {
  const copy = useCopy();
  const viewer = useEpisodeViewer();
  const rated = viewer.myRating !== null;

  return (
    <button
      type="button"
      onClick={viewer.requestRate}
      className="shrink-0 px-1 text-center text-primary-text outline-none"
    >
      <span className="flex justify-center">
        <Star
          className={size === "sm" ? "size-5" : "size-[21px]"}
          strokeWidth={2}
          aria-hidden
          fill={rated ? "currentColor" : "none"}
        />
      </span>
      <span className="mt-1 block text-[12.5px] font-semibold whitespace-nowrap">
        {rated ? copy.episode.yourRating(viewer.myRating!) : copy.episode.rate}
      </span>
      {/* The counterpart label to "Community" beside it. Only once a score
          exists - before that the button reads "Rate", which is its own
          label. */}
      {rated ? (
        <span className="mt-px block text-[10.5px] text-subtle-foreground">
          {copy.episode.yourScore2}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Desktop only: the score block in the top-right of the header, beside the H1.
 */
export function EpisodeHeaderScore() {
  const copy = useCopy();
  const viewer = useEpisodeViewer();

  return (
    /* 🚨 The community score and YOUR score sit side by side, labelled, at the
       top of the page. The community number used to be here unlabelled while
       "Community ratings" lived in a section far below, so there was nothing to
       compare it against without scrolling - and the owner could not tell which
       number was whose. */
    <div className="hidden shrink-0 items-center gap-5 pt-1 md:flex">
      <div className="text-right">
        <p className="text-eyebrow">{copy.episode.communityScore}</p>
        <p className="mt-0.5 flex items-baseline justify-end gap-1.5">
          <Star className="size-[18px] self-center fill-gold text-gold" aria-hidden />
          <span className="font-mono text-[24px] font-bold tabular">
            {formatScore(viewer.publicScore)}
          </span>
          <span className="font-mono text-[13px] text-subtle-foreground">
            {copy.episode.outOfTen}
          </span>
        </p>
        <p className="mt-px text-[11.5px] text-subtle-foreground">
          {viewer.ratingCount > 0
            ? copy.episode.ratings(viewer.ratingCount)
            : copy.episode.noRatings}
        </p>
      </div>
      <RateButton size="sm" />
    </div>
  );
}

/**
 * Mobile only: the score strip below the thumbnail. Carries the elite score
 * when one exists, because on mobile there is no sidebar to put it in.
 */
export function EpisodeScoreStrip() {
  const copy = useCopy();
  const viewer = useEpisodeViewer();
  const hasElite = viewer.eliteScore !== null;

  return (
    <div className="mt-4 flex items-center gap-3.5 rounded-2xl border border-border bg-card p-3.5 md:hidden">
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5">
          <Star className="size-[18px] self-center fill-gold text-gold" aria-hidden />
          <span className="font-mono text-[24px] font-bold tabular">
            {formatScore(viewer.publicScore)}
          </span>
          <span className="font-mono text-[13px] text-subtle-foreground">
            {copy.episode.outOfTen}
          </span>
        </p>
        <p className="mt-0.5 text-[11.5px] text-subtle-foreground">
          {copy.episode.communityScore}
          {copy.common.separator}{" "}
          {viewer.ratingCount > 0
            ? copy.episode.ratings(viewer.ratingCount)
            : copy.episode.noRatings}
        </p>
      </div>

      <span aria-hidden className="h-9 w-px bg-border" />
      <RateButton />

      {hasElite ? (
        <>
          <span aria-hidden className="h-9 w-px bg-border" />
          <div className="text-center">
            <p
              className={cn(
                "font-mono text-[17px] font-bold tabular",
                bandStyle(viewer.eliteBand).swatch,
                "bg-clip-text text-transparent",
              )}
            >
              {formatScore(viewer.eliteScore)}
            </p>
            <p className="mt-0.5 text-[10.5px] text-subtle-foreground">
              {copy.episode.elite}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Desktop only: the sticky 320px sidebar. */
export function EpisodeSidebar() {
  const copy = useCopy();
  const viewer = useEpisodeViewer();
  const watched = viewer.watchCount > 0;
  const today = new Date();

  const delta =
    viewer.myRating !== null && viewer.publicScore !== null
      ? copy.episode.deltaNote(formatDelta(viewer.myRating - viewer.publicScore))
      : viewer.myRating !== null
        ? copy.episode.firstRatingNote
        : copy.episode.notRatedNote;

  return (
    <aside className="sticky top-20 hidden flex-col gap-3 md:flex">
      {/*
        🚨 THE UNWATCHED STATE MUST NOT LOOK LIKE THE WATCHED ONE. This button
        used to render a tick on brand red with the word "Watched" beside it
        while the episode was unwatched - the owner read it as "you have seen
        this" and so would anyone. Three things separate them now, not one:
        the icon (an open eye = an instruction, a tick = a fact), the label
        (`markWatchedLong` is an imperative), and the fill.

        Red stays on the UNWATCHED state deliberately: it is the page's call to
        action, and the done state has no business shouting. The tick then
        takes the green band colour the watch-log entries below already use,
        so "done" reads as done rather than as another button to press.
      */}
      <Button
        variant={watched ? "soft" : "primary"}
        size="2xl"
        block
        className="text-[15px] font-bold"
        onClick={viewer.toggleWatched}
        aria-pressed={watched}
      >
        {watched ? (
          <Check
            className="size-[18px] text-band-great"
            aria-hidden
            strokeWidth={2.6}
          />
        ) : (
          <Eye className="size-[18px]" aria-hidden strokeWidth={2.4} />
        )}
        {watched
          ? copy.episode.watchedCount(viewer.watchCount)
          : copy.episode.markWatchedLong}
      </Button>

      <div className="flex gap-2">
        <Button
          variant="soft"
          size="lg"
          className="flex-1 text-[13.5px]"
          onClick={viewer.requestLog}
        >
          <Calendar className="size-4" aria-hidden strokeWidth={2.2} />
          {copy.episode.logDate}
        </Button>
        <Button
          variant="soft"
          size="lg"
          className="w-[52px] px-0"
          aria-label={
            viewer.isFavorite ? copy.episode.unfavorite : copy.episode.favorite
          }
          aria-pressed={viewer.isFavorite}
          onClick={viewer.toggleFavorite}
        >
          <Heart
            className={cn(
              "size-[18px]",
              viewer.isFavorite ? "text-primary-text" : "text-muted-foreground",
            )}
            strokeWidth={2.2}
            aria-hidden
            fill={viewer.isFavorite ? "currentColor" : "none"}
          />
        </Button>
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13.5px] font-bold">{copy.episode.watchedByYou}</h2>
          <span className="font-mono text-[12px] text-subtle-foreground tabular">
            {copy.episode.watchCount(viewer.watchCount)}
          </span>
        </div>

        {viewer.watchEvents.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5">
            {viewer.watchEvents.map((event) => (
              <li
                key={event.id}
                className="flex items-center gap-2.5 rounded-md bg-card-2 px-2.5 py-2"
              >
                <Check
                  className="size-3.5 shrink-0 text-band-great"
                  aria-hidden
                  strokeWidth={2.4}
                />
                <span className="flex-1 text-[13px]">
                  {formatDate(event.watched_on, copy.common.months)}
                </span>
                <span className="font-mono text-[11px] text-subtle-foreground">
                  {relativeDay(event.watched_on, today)}
                </span>
                <Button
                  variant="quiet"
                  size="icon"
                  className="size-[22px]"
                  aria-label={copy.episode.removeWatch(formatDate(event.watched_on, copy.common.months))}
                  onClick={() => viewer.removeWatch(event.id)}
                >
                  <X className="size-3" aria-hidden strokeWidth={2.6} />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-subtle-foreground">
            {copy.episode.watchLogEmpty}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-[13.5px] font-bold">{copy.episode.yourScore}</h2>
        <p className="mt-1.5 flex items-baseline gap-2.5">
          <span className="font-mono text-[32px] font-bold tabular">
            {viewer.myRating ?? copy.episode.noScoreYet}
          </span>
          <span className="text-[12.5px] text-subtle-foreground">{delta}</span>
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            size="md"
            className="h-[42px] flex-1 text-[13.5px]"
            onClick={viewer.requestRate}
          >
            {viewer.myRating === null
              ? copy.episode.rate
              : copy.episode.changeRating}
          </Button>
          {viewer.myRating !== null ? (
            <Button
              variant="outline"
              size="md"
              className="h-[42px] text-[13px] font-normal text-muted-foreground"
              onClick={viewer.clearRating}
            >
              {copy.episode.clearRating}
            </Button>
          ) : null}
        </div>
      </section>

      <ExternalLinkButton
        href={viewer.watchUrl}
        variant="outline"
        size="lg"
        block
        className="text-[14px]"
      >
        <ExternalLink className="size-4" aria-hidden strokeWidth={2.2} />
        {copy.episode.watchOnYouTube}
      </ExternalLinkButton>
    </aside>
  );
}

/**
 * Mobile only: the fixed action bar.
 *
 * 🚨 It REPLACES the bottom nav on this route rather than stacking with it.
 * `BottomNav` returns null on `/e/`, so the two can never both be on screen.
 */
export function EpisodeActionBar() {
  const copy = useCopy();
  const viewer = useEpisodeViewer();
  const watched = viewer.watchCount > 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-card-2 px-3 pt-2.5 pb-3.5 md:hidden">
      {/* 🚨 `min-w-0` + `truncate` are load-bearing, not polish. A flex child
          defaults to `min-width: auto`, so its text refuses to shrink below its
          own content - the long Bulgarian label pushed the whole row wider than
          the viewport and shoved the last icon off the right edge of a 390px
          screen. The label is also short now ("Watched" / "Гледано"); both
          fixes are needed, because one long word would do it again. */}
      {/* Same three-way distinction as the sidebar; the SHORT label, because
          this bar is 390px wide and the long form pushed the favourite button
          off the right edge. */}
      <Button
        variant={watched ? "soft" : "primary"}
        size="lg"
        className="min-w-0 flex-1 text-[14.5px] font-bold"
        onClick={viewer.toggleWatched}
        aria-pressed={watched}
      >
        {watched ? (
          <Check
            className="size-[17px] shrink-0 text-band-great"
            aria-hidden
            strokeWidth={2.6}
          />
        ) : (
          <Eye className="size-[17px] shrink-0" aria-hidden strokeWidth={2.4} />
        )}
        <span className="truncate">
          {watched
            ? copy.episode.watchedCount(viewer.watchCount)
            : copy.episode.markWatched}
        </span>
      </Button>

      <Button
        variant="soft"
        size="icon-lg"
        aria-label={copy.episode.logDate}
        onClick={viewer.requestLog}
      >
        <Calendar className="size-[18px]" aria-hidden strokeWidth={2.2} />
      </Button>

      <Button
        variant="soft"
        size="icon-lg"
        aria-label={viewer.isFavorite ? copy.episode.unfavorite : copy.episode.favorite}
        aria-pressed={viewer.isFavorite}
        onClick={viewer.toggleFavorite}
      >
        <Heart
          className={cn(
            "size-[18px]",
            viewer.isFavorite ? "text-primary-text" : "text-muted-foreground",
          )}
          strokeWidth={2.2}
          aria-hidden
          fill={viewer.isFavorite ? "currentColor" : "none"}
        />
      </Button>

      {/* 🚨 The "open on YouTube" icon used to sit here and is gone (owner
          call, 2026-08-15): the episode thumbnail directly above carries a
          62px play button that does exactly the same thing, so this was a
          second copy of the page's most obvious action - and it was the button
          being pushed off-screen. The trade-off is real and accepted: once you
          scroll past the thumbnail on mobile, the watch action is no longer
          within reach of the bar. */}
    </div>
  );
}
