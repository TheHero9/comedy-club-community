import Link from "next/link";
import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/EmptyState";
import { ScoreChip } from "@/components/shared/ScoreChip";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { Page } from "@/components/shell/Page";
import {
  getLeaderboard,
  LEADERBOARD_KINDS,
  type Leaderboard,
  type LeaderboardKey,
} from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { formatScore } from "@/lib/format";
import { bandStyle } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export const metadata: Metadata = {
  title: copy.leaderboard.title,
  description: copy.app.description,
};

const TABS: ReadonlyArray<{ key: LeaderboardKey; label: string }> = [
  { key: "top", label: copy.leaderboard.kindTop },
  { key: "elite", label: copy.leaderboard.kindElite },
  { key: "mostRated", label: copy.leaderboard.kindMostRated },
];

/** Block heights are 62/84/50 for 2nd/1st/3rd, and the order is 2, 1, 3. */
const PODIUM_ORDER = [1, 0, 2] as const;
const PODIUM_HEIGHT = ["h-[62px]", "h-[84px]", "h-[50px]"] as const;

function readKind(value: string | string[] | undefined): LeaderboardKey {
  const raw = Array.isArray(value) ? value[0] : value;
  return TABS.some((tab) => tab.key === raw) ? (raw as LeaderboardKey) : "top";
}

export default async function LeaderboardPage({
  searchParams,
}: PageProps<"/leaderboard">) {
  const params = await searchParams;
  const kind = readKind(params.kind);
  const board = await getLeaderboard(LEADERBOARD_KINDS[kind], { limit: 10 });

  const podium = PODIUM_ORDER.map((index) => board.items[index]).filter(Boolean);
  const rest = board.items.slice(3);

  return (
    <Page>
      <h1 className="text-h1">{copy.leaderboard.title}</h1>

      <div className="mt-3.5 flex flex-wrap gap-1.5">
        {TABS.map((tab) => {
          const active = tab.key === kind;
          return (
            <Link
              key={tab.key}
              href={tab.key === "top" ? "/leaderboard" : `/leaderboard?kind=${tab.key}`}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex h-[38px] items-center rounded-pill border px-4 text-[13px] font-semibold transition-colors duration-120",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border-2 bg-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {board.items.length === 0 ? (
        <EmptyState
          className="mt-5"
          variant="card"
          title={copy.leaderboard.title}
          body={copy.leaderboard.empty}
        />
      ) : (
        <>
          <div className="mt-5.5 flex max-w-[620px] items-end gap-2.5">
            {podium.map((entry, position) => (
              <PodiumBlock
                key={entry.episode.youtube_id}
                entry={entry}
                height={PODIUM_HEIGHT[position]}
              />
            ))}
          </div>

          <ol className="mt-5 flex flex-col gap-2">
            {rest.map((entry) => (
              <li key={entry.episode.youtube_id}>
                <Link
                  href={`/e/${entry.episode.youtube_id}`}
                  className="flex min-h-[60px] items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 outline-none"
                >
                  <span className="min-w-[22px] font-mono text-[13.5px] text-subtle-foreground tabular">
                    {entry.rank}
                  </span>
                  <Thumbnail
                    src={entry.episode.thumbnail_url}
                    sizes="66px"
                    className="w-[66px] shrink-0 rounded-[9px]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-title-card line-clamp-2 text-foreground">
                      {entry.episode.title}
                    </p>
                    <p className="mt-1 text-[11.5px] text-subtle-foreground">
                      {copy.leaderboard.ratings(entry.episode.rating_count)}
                    </p>
                  </div>
                  <ScoreChip
                    score={entry.episode.public_score}
                    band={entry.episode.band}
                    size="lg"
                  />
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </Page>
  );
}

function PodiumBlock({
  entry,
  height,
}: {
  entry: Leaderboard["items"][number];
  height: string;
}) {
  const episode = entry.episode;
  const style = bandStyle(episode.band);

  return (
    <Link
      href={`/e/${episode.youtube_id}`}
      className="flex flex-1 flex-col items-center gap-2 outline-none"
    >
      <Thumbnail
        src={episode.thumbnail_url}
        sizes="(min-width: 768px) 200px, 33vw"
        className="w-full rounded-[11px]"
      />
      <div
        className={cn(
          "flex w-full flex-col items-center justify-center gap-0.5 rounded-t-lg rounded-b-md",
          height,
          style.swatch,
        )}
      >
        <span className="font-display text-[20px] font-bold text-ink">
          {entry.rank}
        </span>
        <span className="font-mono text-[13px] font-bold text-ink tabular">
          {formatScore(episode.public_score)}
        </span>
      </div>
      {/* Fixed to exactly two lines. Without it a one-line title makes its
          column shorter, and `items-end` then pulls that podium block DOWN -
          which reads as the podium heights being wrong rather than the title
          being short. */}
      <p className="line-clamp-2 h-[30px] text-center text-[11.5px] leading-snug text-muted-foreground">
        {episode.title}
      </p>
    </Link>
  );
}
