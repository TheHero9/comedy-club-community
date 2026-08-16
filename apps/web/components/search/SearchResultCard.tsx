import Link from "next/link";

import { ScoreChip } from "@/components/shared/ScoreChip";
import { Thumbnail } from "@/components/shared/Thumbnail";
import type { SearchHit, TranscriptMatch } from "@/lib/api/podcast";
import { getCopy } from "@/lib/locale";
import { formatDate, formatTimestamp, youtubeMomentUrl } from "@/lib/format";
import { highlightRuns } from "@/lib/search-tokens";

/**
 * Passages shown per card, by what the card has to explain.
 *
 * A card in the LABEL region already matched on its title or its community
 * labels, so a passage there is a bonus timestamp and one is enough. A card in
 * the SPOKEN-ONLY region has no other reason to be on the page - the passage IS
 * the match - so it gets two.
 *
 * 🚨 Keyed on the REGION, not on whether the card happens to have topic or
 * moment rows. Community labelling has barely started on this corpus, so almost
 * every card currently has zero label rows; branching on that would silently
 * give every card the spoken-card budget and quietly undo this.
 *
 * ⚡ These are payload dials as much as layout ones. Each cropped snippet is
 * ~150 characters of Bulgarian rendered on ~26 cards, and RSC ships the
 * rendered output twice (HTML plus the flight tree that hydrates it), so a
 * uniform 3 put a broad query at 208 KB. Re-measure `/search?q=ергена` before
 * raising either.
 */
const PASSAGES_ON_LABEL_CARD = 1;
const PASSAGES_ON_SPOKEN_CARD = 2;

/**
 * A search result, in two stacked regions.
 *
 * 🚨 The match-reason region is the entire argument for this site existing. It
 * explains why an episode matched when the words appear nowhere in its title,
 * which is the thing YouTube's own search cannot do here. So the reasons are
 * ROWS, with the matched sentence spelled out and the hit term highlighted -
 * never compressed into a tag strip, which would turn the argument back into
 * decoration.
 *
 * Spoken passages are the strongest form of that argument, because they carry a
 * TIMESTAMP: not "this episode is about X" but "X was said at 1:07:01, here".
 * Their badge is therefore a real link out to that second of the video, while
 * topic and moment badges stay inert text.
 */
export async function SearchResultCard({
  hit,
  query,
  passages = [],
  spokenOnly = false,
}: {
  hit: SearchHit;
  query: string;
  /** Every transcript match for this episode; the card shows a few. */
  passages?: TranscriptMatch[];
  /** True when this card is in the spoken-only region and has no label reason. */
  spokenOnly?: boolean;
}) {
  const copy = await getCopy();
  const episode = hit.episode;
  const reasons = [
    ...hit.matched_topics.map((text) => ({ kind: copy.search.reasonTopic, text })),
    ...hit.matched_moments.map((text) => ({ kind: copy.search.reasonMoment, text })),
  ];
  const shown = passages.slice(
    0,
    spokenOnly ? PASSAGES_ON_SPOKEN_CARD : PASSAGES_ON_LABEL_CARD,
  );
  const overflow = passages.length - shown.length;
  const hasReasons = reasons.length > 0 || shown.length > 0;

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
              {formatDate(episode.upload_date, copy.common.months)}
            </span>
          </div>
        </div>
      </Link>

      {hasReasons ? (
        <div className="flex flex-col gap-2 border-t border-border bg-card-2 px-3 py-2.5">
          {reasons.map((reason, index) => (
            <div key={`${reason.kind}-${index}`} className="flex items-start gap-2.5">
              <span className={BADGE_CLASS}>{reason.kind}</span>
              <span className="text-[13.5px] leading-snug text-muted-foreground">
                <Highlight text={reason.text} term={query} />
              </span>
            </div>
          ))}

          {shown.map((passage) => (
            <div
              key={`${passage.start_sec}-${passage.end_sec}`}
              className="flex items-start gap-2.5"
            >
              {/*
                🚨 The timestamp IS the payload, so it is the link. It opens the
                video at that second rather than the episode page, because the
                user's question was "where do I hear this", and one more hop to
                find it again would waste the only thing this row knows.
              */}
              <a
                href={youtubeMomentUrl(episode.youtube_id, passage.start_sec)}
                target="_blank"
                rel="noopener noreferrer"
                // 🚨 The label is the accessible name only - it is NOT
                // rendered. It used to print before every timestamp, so a card
                // with four passages said the same two words four times in a
                // column already headed by them. A bare timestamp reads as a
                // timestamp; a screen reader still hears what it is.
                aria-label={`${copy.search.reasonSaidAt} ${formatTimestamp(passage.start_sec)}`}
                className={`${BADGE_CLASS} gap-[5px] tabular hover:text-foreground`}
              >
                <span className="font-bold">
                  {formatTimestamp(passage.start_sec)}
                </span>
              </a>
              <span className="text-[13.5px] leading-snug text-muted-foreground">
                <Marked text={passage.text} />
              </span>
            </div>
          ))}

          {overflow > 0 ? (
            <p className="pl-[3px] font-mono text-[11px] text-faint-foreground tabular">
              {copy.search.spokenMore(overflow)}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

const BADGE_CLASS =
  "mt-px inline-flex h-[22px] shrink-0 items-center rounded-[6px] bg-elevated px-[7px] font-mono text-[10px] tracking-[0.06em] whitespace-nowrap text-gold";

/**
 * Renders the API's `<mark>`-wrapped passage.
 *
 * 🔒 This is YouTube auto-caption text - user-adjacent content that has crossed
 * two systems - so it is NEVER handed to `dangerouslySetInnerHTML`. The string
 * is split on the two tags the API documents and every other character is
 * rendered as a text node, so anything else that looks like markup renders as
 * the literal characters it is.
 */
function Marked({ text }: { text: string }) {
  // Capturing split: odd indices are the marked runs, even indices the plain
  // text between them. Deriving the state from the index keeps this pure -
  // tracking an `inMark` flag across `.map` would be a reassignment during
  // render, which `react-hooks/immutability` rejects as an error in this repo.
  const parts = text.split(/<mark>([\s\S]*?)<\/mark>/);

  return (
    <>
      {parts.map((part, index) => {
        if (part.length === 0) return null;
        if (index % 2 === 1) {
          return (
            <span key={index} className="font-bold text-gold">
              {part}
            </span>
          );
        }
        // An unpaired tag never survives to the page as literal text. It should
        // not occur - Meilisearch emits balanced pairs - but a visible
        // "<mark>" would look like the highlighter itself had broken.
        return <span key={index}>{part.replace(/<\/?mark>/g, "")}</span>;
      })}
    </>
  );
}

/**
 * Highlights the query's WORDS inside a matched label.
 *
 * 🚨 Word by word. This used to look for the whole query string, which for a
 * multi-word Bulgarian query is never present verbatim - so on exactly the
 * queries this feature exists for, nothing was ever highlighted. The logic
 * lives in `lib/search-tokens.ts` so the page's title split and this share one
 * definition of "a word that counts".
 *
 * When nothing matches the text renders plain rather than highlighting
 * something arbitrary: search is typo tolerant, and a highlight on the wrong
 * word is worse than none because it claims a match that did not happen.
 */
function Highlight({ text, term }: { text: string; term: string }) {
  if (term.trim().length === 0) return <>{text}</>;

  return (
    <>
      {highlightRuns(text, term).map((run, index) =>
        run.hit ? (
          <span key={index} className="font-bold text-gold">
            {run.text}
          </span>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}
