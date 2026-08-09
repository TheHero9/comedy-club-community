import Link from "next/link";

import { ScoreChip } from "@/components/shared/ScoreChip";
import { Thumbnail } from "@/components/shared/Thumbnail";
import type { SearchHit } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { formatDate } from "@/lib/format";

/**
 * A search result, in two stacked regions.
 *
 * 🚨 The match-reason region is the entire argument for this site existing. It
 * explains why an episode matched when the words appear nowhere in its title,
 * which is the thing YouTube's own search cannot do here. So the reasons are
 * ROWS, with the matched sentence spelled out and the hit term highlighted -
 * never compressed into a tag strip, which would turn the argument back into
 * decoration.
 */
export function SearchResultCard({
  hit,
  query,
}: {
  hit: SearchHit;
  query: string;
}) {
  const episode = hit.episode;
  const reasons = [
    ...hit.matched_topics.map((text) => ({ kind: copy.search.reasonTopic, text })),
    ...hit.matched_moments.map((text) => ({ kind: copy.search.reasonMoment, text })),
  ];

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      <Link href={`/e/${episode.youtube_id}`} className="flex gap-3 p-3 outline-none">
        <Thumbnail
          src={episode.thumbnail_url}
          sizes="(min-width: 768px) 220px, 112px"
          className="w-[112px] shrink-0 rounded-[11px] md:w-[220px]"
        />
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-[15px] leading-snug font-semibold text-foreground md:text-[17px]">
            {episode.title}
          </h2>
          <div className="mt-2 flex items-center gap-2">
            <ScoreChip
              score={episode.public_score}
              band={episode.band}
              size="sm"
            />
            <span className="font-mono text-[11px] text-subtle-foreground tabular">
              {formatDate(episode.upload_date)}
            </span>
          </div>
        </div>
      </Link>

      {reasons.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border bg-card-2 px-3 py-2.5">
          {reasons.map((reason, index) => (
            <div key={`${reason.kind}-${index}`} className="flex items-start gap-2.5">
              <span className="mt-px inline-flex h-[22px] shrink-0 items-center rounded-[6px] bg-elevated px-[7px] font-mono text-[10px] tracking-[0.06em] whitespace-nowrap text-gold">
                {reason.kind}
              </span>
              <span className="text-[13.5px] leading-snug text-muted-foreground">
                <Highlight text={reason.text} term={query} />
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Highlights the query inside a matched label.
 *
 * Search is typo tolerant, so the matched text often does NOT contain the query
 * literally. When there is no exact hit the text renders plain rather than
 * highlighting something arbitrary - a highlight on the wrong word is worse
 * than none, because it claims a match that did not happen.
 */
function Highlight({ text, term }: { text: string; term: string }) {
  const needle = term.trim();
  if (needle.length === 0) return <>{text}</>;

  const at = text.toLocaleLowerCase("bg").indexOf(needle.toLocaleLowerCase("bg"));
  if (at === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, at)}
      <span className="font-bold text-gold">{text.slice(at, at + needle.length)}</span>
      {text.slice(at + needle.length)}
    </>
  );
}
