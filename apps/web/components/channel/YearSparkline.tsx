import type { ChannelGrid } from "@/lib/api/podcast";
import { getCopy } from "@/lib/locale";
import { bandForScore, bandStyle } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

/**
 * One row per year, each a strip of flush bars coloured by score band.
 *
 * 🚨 The bars SAMPLE the year, they do not truncate it. The prototype drew the
 * first 24 episodes of each year, which is honest at 37 episodes and a lie at
 * 184 - it would show a decade-long channel as if it stopped in February. Here
 * the year is divided into `BAR_COUNT` equal buckets and each bar takes the
 * average of the rated episodes in its bucket, so the strip always describes
 * the whole year.
 *
 * `--elevated` means "this part of the year exists but nothing in it is rated".
 * Transparent means "the year had fewer episodes than this". Neither is ever a
 * band colour, because absent must never read as bad.
 */
const BAR_COUNT = 24;

type Bar = { key: string; className: string };

function bucketBars(grid: ChannelGrid, seasonIndex: number, episodeCount: number): Bar[] {
  const bars: Bar[] = [];
  const perBar = Math.max(1, Math.ceil(episodeCount / BAR_COUNT));

  for (let bar = 0; bar < BAR_COUNT; bar += 1) {
    const start = bar * perBar;
    if (start >= episodeCount) {
      bars.push({ key: `hole-${bar}`, className: "bg-transparent" });
      continue;
    }

    let sum = 0;
    let rated = 0;
    for (let offset = 0; offset < perBar; offset += 1) {
      const cell = grid.rows[start + offset]?.cells[seasonIndex];
      if (cell?.score != null) {
        sum += cell.score;
        rated += 1;
      }
    }

    bars.push({
      key: `bar-${bar}`,
      className:
        rated === 0 ? "bg-elevated" : bandStyle(bandForScore(sum / rated)).swatch,
    });
  }

  return bars;
}

export async function YearSparkline({ grid }: { grid: ChannelGrid }) {
  const copy = await getCopy();
  if (grid.seasons.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {grid.seasons.map((season, seasonIndex) => (
        <div key={season.year} className="flex items-center gap-2.5">
          <span className="w-[38px] shrink-0 font-mono text-[11.5px] text-subtle-foreground tabular">
            {season.label}
          </span>
          <span
            className="flex flex-1 gap-0.5"
            role="img"
            aria-label={copy.channels.sparklineYear(season.year)}
          >
            {bucketBars(grid, seasonIndex, season.episode_count).map((bar) => (
              <span
                key={bar.key}
                className={cn("h-4 flex-1 rounded-[3px]", bar.className)}
              />
            ))}
          </span>
          <span className="w-7 shrink-0 text-right font-mono text-[11.5px] text-muted-foreground tabular">
            {season.average === null ? "" : season.average.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}
