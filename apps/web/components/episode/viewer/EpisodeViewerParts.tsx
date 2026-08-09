"use client";

import { Calendar, Check, ExternalLink, Heart, Star, X } from "lucide-react";

import { SignInSheet } from "@/components/auth/SignInSheet";
import { useEpisodeViewer } from "@/components/episode/viewer/EpisodeViewerContext";
import { RateSheet } from "@/components/episode/viewer/RateSheet";
import { WatchLogSheet } from "@/components/episode/viewer/WatchLogSheet";
import { Button, ExternalLinkButton } from "@/components/ui/button";
import { copy } from "@/lib/copy";
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
    </button>
  );
}

/**
 * Desktop only: the score block in the top-right of the header, beside the H1.
 */
export function EpisodeHeaderScore() {
  const viewer = useEpisodeViewer();

  return (
    <div className="hidden shrink-0 items-center gap-5 pt-1 md:flex">
      <div className="text-right">
        <p className="text-eyebrow">{copy.episode.scoreLabel}</p>
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
      <Button
        variant={watched ? "elevated" : "primary"}
        size="2xl"
        block
        className="text-[15px] font-bold"
        onClick={viewer.toggleWatched}
      >
        <Check className="size-[18px]" aria-hidden strokeWidth={2.4} />
        {watched
          ? copy.episode.watchedCount(viewer.watchCount)
          : copy.episode.markWatched}
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
                  {formatDate(event.watched_on)}
                </span>
                <span className="font-mono text-[11px] text-subtle-foreground">
                  {relativeDay(event.watched_on, today)}
                </span>
                <Button
                  variant="quiet"
                  size="icon"
                  className="size-[22px]"
                  aria-label={copy.episode.removeWatch(formatDate(event.watched_on))}
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
  const viewer = useEpisodeViewer();
  const watched = viewer.watchCount > 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-card-2 px-3 pt-2.5 pb-3.5 md:hidden">
      <Button
        variant={watched ? "elevated" : "primary"}
        size="lg"
        className="flex-1 text-[14.5px] font-bold"
        onClick={viewer.toggleWatched}
      >
        <Check className="size-[17px]" aria-hidden strokeWidth={2.4} />
        {watched
          ? copy.episode.watchedCount(viewer.watchCount)
          : copy.episode.markWatched}
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

      <ExternalLinkButton
        href={viewer.watchUrl}
        variant="soft"
        size="icon-lg"
        aria-label={copy.episode.watchOnYouTube}
      >
        <ExternalLink className="size-[18px]" aria-hidden strokeWidth={2.2} />
      </ExternalLinkButton>
    </div>
  );
}
