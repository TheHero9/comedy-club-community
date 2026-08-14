"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";

import { ScoreChip } from "@/components/shared/ScoreChip";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import {
  FLAG_MEMBERS_ONLY,
  FLAG_STREAM,
  positionLabel,
  titleFromCellLabel,
} from "@/components/grid/grid-model";
import { api } from "@/lib/api/client";
import { ARIA_LABEL_ATTR } from "@/lib/dom-attrs";
import type { Episode } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { formatDate, formatDuration, thumbnailUrl } from "@/lib/format";
import { bandStyle } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

/**
 * Preview behaviour for the ratings grid, layered on by EVENT DELEGATION.
 *
 * 🚨 Why delegation instead of a component per cell: the biggest channel has
 * 2,024 cells. Turning each into a Client Component would push the whole grid
 * into the RSC client payload and hand React 2,024 event listeners to attach.
 * The cells stay plain server-rendered `<a>` elements - crawlable, working
 * without JS, middle-clickable - and this one wrapper reads `data-*` off
 * whichever one was hit.
 *
 * Mobile tap opens a bottom sheet; desktop hover opens a floating card after
 * 120ms and closes it with no delay, and a click opens the same sheet as a
 * centred dialog.
 */
const HOVER_OPEN_DELAY_MS = 120;

interface PreviewData {
  youtubeId: string;
  title: string;
  score: number | null;
  band: string | null;
  ratingCount: number;
  provisional: boolean;
  position: string;
}

function readCell(element: HTMLElement): PreviewData | null {
  const anchor = element.closest<HTMLAnchorElement>("a[data-cell]");
  if (!anchor) return null;

  const rawScore = anchor.dataset.score ?? "";
  const parsedCount = Number(anchor.dataset.count ?? "0");
  // A NaN here would silently disable the ratings-suffix strip AND make the
  // sheet claim "no ratings yet" under a heading that says otherwise.
  const ratingCount = Number.isFinite(parsedCount) ? parsedCount : 0;
  const flags = anchor.dataset.flags ?? "";
  const provisional = anchor.dataset.provisional === "1";

  return {
    youtubeId: anchor.dataset.cell ?? "",
    // The title ships ONCE, inside aria-label - a data-title duplicate cost
    // 135.5 KB (plus its RSC flight copy) on the 1,318-cell page.
    // `ariaLabel` is the property reflection; the attribute read is the
    // fallback for engines that predate it (Firefox < 119, Safari < 16.4),
    // where an empty title would otherwise be the only symptom.
    title: titleFromCellLabel(
      anchor.ariaLabel ?? anchor.getAttribute(ARIA_LABEL_ATTR) ?? "",
      {
        ratingCount,
        provisional,
        membersOnly: flags.includes(FLAG_MEMBERS_ONLY),
        stream: flags.includes(FLAG_STREAM),
      },
    ),
    score: rawScore === "" ? null : Number(rawScore),
    band: anchor.dataset.band || null,
    ratingCount,
    provisional,
    position: positionLabel(anchor.dataset.position ?? ""),
  };
}

export function GridInteraction({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);

  const [selected, setSelected] = useState<PreviewData | null>(null);
  /**
   * Tagged with the episode it describes, so closing the sheet does not need an
   * effect to null it out - a stale detail simply stops matching. Clearing it
   * from an effect would be a cascading render for no visible benefit.
   */
  const [fetched, setFetched] = useState<{ youtubeId: string; episode: Episode } | null>(
    null,
  );
  const detail =
    fetched && fetched.youtubeId === selected?.youtubeId ? fetched.episode : null;
  const [hover, setHover] = useState<{
    data: PreviewData;
    top: number;
    left: number;
  } | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  // Detail is only fetched when a preview actually opens. `GridCellOut` is
  // deliberately lean, so the date, duration and thumbnail live here.
  const selectedId = selected?.youtubeId;
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    api
      .get<Episode>(`/api/episodes/${encodeURIComponent(selectedId)}`, {
        signal: controller.signal,
      })
      .then((episode) => setFetched({ youtubeId: selectedId, episode }))
      // The preview still shows title, score and position without it.
      .catch(() => undefined);
    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  function onClick(event: React.MouseEvent<HTMLDivElement>) {
    // Let the browser do its normal thing for new-tab and download intents.
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;

    const data = readCell(event.target as HTMLElement);
    if (!data) return;

    event.preventDefault();
    clearHoverTimer();
    setHover(null);
    setSelected(data);
  }

  function onPointerOver(event: React.PointerEvent<HTMLDivElement>) {
    // Touch fires pointerover immediately before the tap; only true hover
    // devices get the floating card.
    if (event.pointerType !== "mouse") return;

    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      "a[data-cell]",
    );
    if (!anchor) return;
    const data = readCell(anchor);
    if (!data) return;

    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      const rect = anchor.getBoundingClientRect();
      setHover({ data, top: rect.bottom + 8, left: rect.left + rect.width / 2 });
    }, HOVER_OPEN_DELAY_MS);
  }

  function onPointerOut(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    clearHoverTimer();
    setHover(null);
  }

  const style = selected ? bandStyle(selected.score === null ? null : selected.band) : null;

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {children}

      {hover ? (
        <div
          role="presentation"
          className="pointer-events-none fixed z-50 w-[260px] -translate-x-1/2 rounded-2xl border border-border-2 bg-card p-3 shadow-overlay"
          style={{ top: hover.top, left: hover.left }}
        >
          <Image
            src={thumbnailUrl(hover.data.youtubeId)}
            alt=""
            width={236}
            height={133}
            className="aspect-video w-full rounded-lg object-cover"
          />
          <div className="mt-2.5 flex items-center gap-2">
            <ScoreChip
              score={hover.data.score}
              band={hover.data.band}
              provisional={hover.data.provisional}
              size="md"
            />
            <span className="text-[12.5px] text-muted-foreground">
              {bandStyle(hover.data.score === null ? null : hover.data.band).label}
            </span>
          </div>
          <p className="mt-2 line-clamp-3 text-[14px] leading-snug font-semibold">
            {hover.data.title}
          </p>
          <p className="mt-1.5 font-mono text-[11.5px] text-subtle-foreground">
            {hover.data.position}
          </p>
        </div>
      ) : null}

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={copy.episode.openEpisode}
        hideTitle
      >
        {selected ? (
          <div>
            <Thumbnail
              src={detail?.thumbnail_url ?? thumbnailUrl(selected.youtubeId)}
              sizes="(min-width: 768px) 420px, 100vw"
              className="rounded-xl"
            />

            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <ScoreChip
                score={selected.score}
                band={selected.band}
                provisional={selected.provisional}
                size="md"
              />
              <span className="text-[12.5px] text-muted-foreground">
                {style?.label}
              </span>
              <span aria-hidden className="opacity-50">
                {copy.common.separator}
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                {selected.ratingCount > 0
                  ? copy.episode.ratings(selected.ratingCount)
                  : copy.episode.noRatings}
              </span>
            </div>

            {selected.provisional && selected.score !== null ? (
              <div className="mt-2.5 flex items-center gap-2.5 rounded-md bg-elevated px-3 py-2.5">
                <TriangleAlert className="size-4 shrink-0 text-gold" aria-hidden />
                <span className="text-[12.5px] text-muted-foreground">
                  {copy.episode.provisionalNote}
                </span>
              </div>
            ) : null}

            <h3 className="mt-3 line-clamp-3 text-[18px] leading-snug font-semibold">
              {selected.title}
            </h3>

            <p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[12px] text-subtle-foreground">
              <span>{selected.position}</span>
              {detail?.upload_date ? (
                <>
                  <span aria-hidden className="opacity-50">
                    {copy.common.separator}
                  </span>
                  <span>{formatDate(detail.upload_date)}</span>
                </>
              ) : null}
              {detail?.duration_sec ? (
                <>
                  <span aria-hidden className="opacity-50">
                    {copy.common.separator}
                  </span>
                  <span>{formatDuration(detail.duration_sec)}</span>
                </>
              ) : null}
            </p>

            <Button
              variant="primary"
              size="xl"
              block
              className={cn("mt-4")}
              onClick={() => {
                const target = `/e/${selected.youtubeId}`;
                setSelected(null);
                router.push(target);
              }}
            >
              {copy.episode.openEpisode}
            </Button>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
