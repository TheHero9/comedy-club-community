import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  Clock,
  Crown,
  LayoutGrid,
  MessageSquare,
  Play,
  Plus,
  Radio,
  Sparkles,
  Star,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";

import { CommentCard } from "@/components/episode/CommentCard";
import { EpisodeDescription } from "@/components/episode/EpisodeDescription";
import { EpisodeRailCard } from "@/components/episode/EpisodeCard";
import { EpisodeViewerProvider } from "@/components/episode/viewer/EpisodeViewerContext";
import {
  EpisodeActionBar,
  EpisodeHeaderScore,
  EpisodeScoreStrip,
  EpisodeSheets,
  EpisodeSidebar,
} from "@/components/episode/viewer/EpisodeViewerParts";
import { EmptyState } from "@/components/shared/EmptyState";
import { LinkPending } from "@/components/shared/LinkPending";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { MetaLine } from "@/components/shell/Page";
import { buttonVariants, LinkButton } from "@/components/ui/button";
import { isApiError } from "@/lib/api/client";
import {
  getEpisode,
  listComments,
  listEpisodes,
  listMoments,
  type Episode,
  type EpisodeBrief,
} from "@/lib/api/podcast";
import { getCopy } from "@/lib/locale";
import {
  formatDate,
  formatDuration,
  formatScore,
  formatTimestamp,
  youtubeMomentUrl,
} from "@/lib/format";
import { bandStyle } from "@/lib/score-bands";
import { GRID_ANCHOR } from "@/components/grid/grid-model";
import { decodeRouteParam } from "@/lib/route-params";
import { cn } from "@/lib/utils";

/**
 * 🚨 No `revalidate`: reading the locale cookie makes this dynamic. The episode,
 * moment and comment fetches stay cached at the fetch layer (`PUBLIC_CACHE`).
 */
const SIMILAR_LIMIT = 8;
const COMMENT_LIMIT = 6;

export async function generateMetadata({
  params,
}: PageProps<"/e/[youtubeId]">): Promise<Metadata> {
  const copy = await getCopy();
  const { youtubeId: raw } = await params;
  try {
    const episode = await getEpisode(decodeRouteParam(raw));
    return {
      title: episode.title,
      description: episode.description || copy.app.description,
      openGraph: {
        title: episode.title,
        description: episode.description || copy.app.description,
        images: episode.thumbnail_url ? [episode.thumbnail_url] : undefined,
      },
    };
  } catch {
    return { title: copy.browse.title };
  }
}

/**
 * "Similar episodes" and, crucially, WHY.
 *
 * A rail of episodes with no stated reason is just a second list. The reason
 * comes from the strongest signal available: a shared topic, then a shared
 * guest, then "same channel" - and each card is tagged with the specific one.
 */
async function loadSimilar(episode: Episode): Promise<{
  reason: string;
  items: Array<{ episode: EpisodeBrief; reason: string }>;
}> {
  const copy = await getCopy();
  const topic = episode.topics[0];
  const guest = episode.participants.find(
    (person) => person.role !== copy.episode.roleHost,
  );

  if (topic) {
    const list = await listEpisodes({ topic: topic.slug, limit: SIMILAR_LIMIT + 1 });
    const items = list.items
      .filter((item) => item.youtube_id !== episode.youtube_id)
      .slice(0, SIMILAR_LIMIT)
      .map((item) => ({
        episode: item,
        reason: copy.episode.similarTagTopic(topic.name),
      }));
    if (items.length > 0) {
      return { reason: copy.episode.similarWhySharedTopics(1), items };
    }
  }

  if (guest) {
    const list = await listEpisodes({ person: guest.slug, limit: SIMILAR_LIMIT + 1 });
    const items = list.items
      .filter((item) => item.youtube_id !== episode.youtube_id)
      .slice(0, SIMILAR_LIMIT)
      .map((item) => ({
        episode: item,
        reason: copy.episode.similarTagGuest(guest.name),
      }));
    if (items.length > 0) {
      return { reason: copy.episode.similarWhySharedPeople(1), items };
    }
  }

  const list = await listEpisodes({
    channel: episode.channel_slug,
    limit: SIMILAR_LIMIT + 1,
  });
  /**
   * 🚨 The per-card reason is the CHANNEL, not the upload date.
   *
   * It used to print a date, which explains nothing about similarity - the
   * owner's words were "I have no clue how the similar episodes are formed".
   * A rail that will not say what it matched on is indistinguishable from a
   * random list, and this is the weakest of the three signals, so it is the one
   * that most needs to admit what it is.
   */
  return {
    reason: copy.episode.similarWhySameChannel,
    items: list.items
      .filter((item) => item.youtube_id !== episode.youtube_id)
      .slice(0, SIMILAR_LIMIT)
      .map((item) => ({
        episode: item,
        reason: item.channel_name,
      })),
  };
}

export default async function EpisodePage({ params }: PageProps<"/e/[youtubeId]">) {
  const copy = await getCopy();
  const { youtubeId: raw } = await params;
  const youtubeId = decodeRouteParam(raw);

  let episode: Episode;
  try {
    episode = await getEpisode(youtubeId);
  } catch (error) {
    if (isApiError(error) && error.status === 404) notFound();
    throw error;
  }

  const [moments, comments, similar] = await Promise.all([
    listMoments(youtubeId).catch(() => []),
    listComments(youtubeId, { limit: COMMENT_LIMIT }).catch(() => null),
    loadSimilar(episode),
  ]);

  const duration = formatDuration(episode.duration_sec);

  return (
    <EpisodeViewerProvider
      seed={{
        youtubeId: episode.youtube_id,
        title: episode.title,
        watchUrl: episode.watch_url || episode.url,
        publicScore: episode.public_score,
        ratingCount: episode.rating_count,
        eliteScore: episode.elite_score,
        eliteBand: episode.elite_band ?? null,
      }}
    >
      <div className="mx-auto w-full max-w-[1216px]">
        {/* Header band. The H1 is the canonical location for the title, so it
            is NOT clamped: 3 of 20 real titles need 4 lines at 390px, and
            clipping loses words with no ellipsis to warn you. */}
        <header className="px-4 pt-4 pb-3 md:px-8 md:pt-6 md:pb-4">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-episode-title">{episode.title}</h1>
              {/* 🚨 The bare year used to lead this line, next to the full
                  date that already ends in the same four digits - so it read
                  "2026 . 11 August 2026 . 44:20". The year element is gone;
                  `yearOf` is still used below for the grid deep link. */}
              <MetaLine
                className="mt-2 text-[12px] md:text-[13px]"
                items={[
                  formatDate(episode.upload_date, copy.common.months),
                  duration,
                ]}
              />
            </div>
            <EpisodeHeaderScore />
          </div>
        </header>

        <div className="grid grid-cols-1 gap-0 px-4 pb-0 md:grid-cols-[1fr_320px] md:gap-8 md:px-8 md:pb-10">
          <div className="min-w-0">
            {/* 🚨 No embedded player anywhere in this product. Every watch
                action opens YouTube in a new tab. */}
            <a
              href={episode.watch_url || episode.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={copy.episode.playOnYouTube}
              className="block outline-none"
            >
              <Thumbnail
                src={episode.thumbnail_url}
                sizes="(min-width: 768px) 860px, 100vw"
                priority
                className="rounded-2xl"
              >
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex size-[62px] items-center justify-center rounded-pill bg-[rgba(228,35,44,0.94)] shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                    <Play className="size-6 fill-white text-white" aria-hidden />
                  </span>
                </span>

                <span className="absolute top-2.5 left-2.5 flex gap-1.5">
                  {episode.members_only ? (
                    <Badge icon={<Crown className="size-3" strokeWidth={2.2} />}>
                      {copy.episode.membersOnly}
                    </Badge>
                  ) : null}
                  {episode.content_kind === "stream" ? (
                    <Badge icon={<Radio className="size-3" strokeWidth={2.2} />}>
                      {copy.episode.stream}
                    </Badge>
                  ) : null}
                </span>

                {duration ? (
                  <span className="absolute right-2.5 bottom-2.5 flex h-6 items-center rounded-[7px] bg-[rgba(20,17,15,0.88)] px-2 font-mono text-[12px] text-[#F7F4F0] tabular">
                    {duration}
                  </span>
                ) : null}
              </Thumbnail>
            </a>

            <EpisodeScoreStrip />

            {/*
              Topics. Tapping one runs a real search for it.

              🚨 A MACHINE SUGGESTION AND A MEMBER'S LABEL DO NOT LOOK THE
              SAME. Every one of the catalogue's 2,565 labels today was
              suggested automatically from titles and transcripts, and they
              used to render exactly like a human-authored one. That is wrong
              in both directions: a reader takes a guess for a fact, and a
              member who adds a label sees it disappear into a row of guesses.

              The distinction is `is_auto` off the API - derived from the
              system account `import_topic_labels` attributes its work to, not
              a second stored column that could drift. Auto chips take the
              `dashed` variant, which already means "provisional" everywhere
              else in this design (the unrated grid cell, the add-a-topic
              placeholder), plus a spark. Community chips keep the solid
              border they always had.
            */}
            <Section title={copy.episode.topics} icon={Tags}>
              <div className="mt-3 flex flex-wrap gap-[7px]">
                {episode.topics.map((topic) => (
                  <LinkButton
                    key={topic.slug}
                    href={`/search?q=${encodeURIComponent(topic.name)}`}
                    prefetch={false}
                    variant={topic.is_auto ? "dashed" : "outline"}
                    size="xs"
                    className="font-medium"
                  >
                    {topic.is_auto ? (
                      <Sparkles
                        className="size-3.5 text-faint-foreground"
                        aria-label={copy.episode.topicAuto}
                        strokeWidth={2.2}
                      />
                    ) : null}
                    {topic.name}
                    {/* /search is force-dynamic, so this chip is a real round
                        trip. Without a marker it looked broken for ~300ms. */}
                    <LinkPending />
                  </LinkButton>
                ))}
                {episode.topics.length === 0 ? (
                  <span
                    className={cn(
                      buttonVariants({ variant: "dashed", size: "xs" }),
                      "cursor-default",
                    )}
                  >
                    <Plus className="size-3.5" aria-hidden strokeWidth={2.4} />
                    {copy.episode.addFirstTopic}
                  </span>
                ) : null}
              </div>
              {/* Only when there is actually a spark on screen to explain. */}
              {episode.topics.some((topic) => topic.is_auto) ? (
                <p className="mt-2.5 text-small text-subtle-foreground">
                  {copy.episode.topicsAutoNote}
                </p>
              ) : null}
            </Section>

            {/* The raw description, never a placeholder: an episode with none
                renders nothing here rather than a toggle onto an apology. */}
            <EpisodeDescription text={episode.description} />

            {episode.participants.length > 0 ? (
              <Section
                title={copy.episode.cast}
                icon={Users}
                meta={String(episode.participants.length)}
              >
                <div className="noscroll mt-3 flex gap-2.5 overflow-x-auto pb-0.5">
                  {episode.participants.map((person) => (
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
              </Section>
            ) : null}

            <Section
              title={copy.episode.moments}
              icon={Clock}
              meta={moments.length > 0 ? String(moments.length) : undefined}
            >
              {/* 🚨 Printed whether or not there are moments. The owner's words
                  were "I have no clue how do we log them" - and with moments
                  present the list explained nothing, while with none the empty
                  state only said "nothing labelled yet". */}
              <p className="mt-2.5 text-small text-subtle-foreground">
                {copy.episode.momentsHowTo}
              </p>
              {moments.length > 0 ? (
                <>
                  {/* Timeline. Ticks are positioned by timestamp, so the bar
                      only means something when the duration is known. */}
                  {episode.duration_sec ? (
                    <div className="relative mt-3 h-8">
                      <span className="absolute inset-x-0 top-[13px] h-1.5 rounded-pill bg-elevated" />
                      {moments.map((moment) => (
                        <span
                          key={moment.id}
                          className="absolute top-[7px] h-[18px] w-1 rounded-pill bg-gold"
                          style={{
                            left: `${Math.min(
                              99,
                              (moment.timestamp_sec / episode.duration_sec!) * 100,
                            )}%`,
                          }}
                        />
                      ))}
                    </div>
                  ) : null}

                  <ul className="mt-1 flex flex-col gap-2">
                    {moments.map((moment) => (
                      <li key={moment.id}>
                        <a
                          href={youtubeMomentUrl(
                            episode.youtube_id,
                            moment.timestamp_sec,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-h-[52px] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 outline-none"
                        >
                          <span className="inline-flex h-[27px] shrink-0 items-center rounded-sm bg-elevated px-2 font-mono text-[12.5px] font-bold text-gold tabular">
                            {formatTimestamp(moment.timestamp_sec)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px] leading-snug">
                              {moment.label}
                            </span>
                            {moment.author ? (
                              <span className="mt-0.5 block text-[11px] text-subtle-foreground">
                                {moment.author}
                              </span>
                            ) : null}
                          </span>
                          <span className="font-mono text-[12.5px] text-muted-foreground tabular">
                            {copy.episode.momentVotes(moment.score)}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState
                  className="mt-3"
                  title={copy.episode.momentsEmptyTitle}
                  body={copy.episode.momentsEmptyBody}
                />
              )}
            </Section>

            <Section title={copy.episode.community} icon={MessageSquare}>
              {/* ⚠️ The design also puts a 1-10 breakdown histogram beside this
                  score. It is NOT built: no endpoint returns the distribution -
                  `EpisodeOut` carries `public_score` and `rating_count` and
                  nothing else - and the only way to derive it today is one
                  request per rating. Drawing a plausible-looking histogram from
                  the average would be inventing data on the page whose whole
                  job is reporting what the community actually said. */}
              <div className="mt-3.5 flex items-end gap-4">
                <div className="shrink-0">
                  <p className="flex items-baseline gap-1.5">
                    <Star
                      className="size-5 self-center fill-gold text-gold"
                      aria-hidden
                    />
                    <span className="font-mono text-[30px] font-bold tabular">
                      {formatScore(episode.public_score)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-subtle-foreground">
                    {episode.rating_count > 0
                      ? copy.episode.ratings(episode.rating_count)
                      : copy.episode.noRatings}
                  </p>
                </div>
                {episode.elite_score !== null ? (
                  <div className="shrink-0 border-l border-border pl-4">
                    <p
                      className={cn(
                        "font-mono text-[22px] font-bold tabular",
                        bandStyle(episode.elite_band).swatch,
                        "bg-clip-text text-transparent",
                      )}
                    >
                      {formatScore(episode.elite_score)}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-subtle-foreground">
                      {copy.episode.elite}
                    </p>
                  </div>
                ) : null}
              </div>

              {comments && comments.items.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {comments.items.map((comment) => (
                    <CommentCard key={comment.id} comment={comment} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  className="mt-3"
                  title={copy.episode.commentsEmptyTitle}
                  body={copy.episode.commentsEmptyBody}
                />
              )}
            </Section>

            {similar.items.length > 0 ? (
              <Section
                title={copy.episode.similar}
                icon={LayoutGrid}
                meta={`${copy.episode.similarWhyPrefix} ${similar.reason}`}
              >
                <div className="noscroll mt-3 flex gap-3 overflow-x-auto pb-1">
                  {similar.items.map((item) => (
                    <EpisodeRailCard
                      key={item.episode.youtube_id}
                      episode={item.episode}
                      reason={item.reason}
                    />
                  ))}
                </div>
              </Section>
            ) : null}

            {/* 🚨 The ratings grid is the best page on the site and was
                reachable only from /channels. From an episode you are already
                looking at, the grid is the answer to "how does this compare".

                ⚠️ This used to append `#year-<n>`, and NO element carried that
                id - so the browser jumped nowhere and the button read as
                broken. It now links to the grid itself, which `RatingsGrid`
                anchors with a real `id`. */}
            <Link
              href={`/channels/${encodeURIComponent(episode.channel_slug)}#${GRID_ANCHOR}`}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg", block: true }),
                "mt-5.5 max-w-[400px]",
              )}
            >
              <LayoutGrid className="size-4" aria-hidden strokeWidth={2.2} />
              {copy.episode.allRatings}
            </Link>

            <div className="h-5 md:hidden" />
          </div>

          <EpisodeSidebar />
        </div>
      </div>

      <EpisodeActionBar />
      <EpisodeSheets />
    </EpisodeViewerProvider>
  );
}

/**
 * One section of the episode page.
 *
 * The `icon` is a `lucide-react` component, never an emoji: five same-weight
 * Bulgarian headings stacked down a long page are indistinguishable while
 * scrolling, and the mark to the left of each is what makes them findable.
 */
function Section({
  title,
  icon: Icon,
  meta,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5.5 border-t border-border pt-4.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-section-label flex items-center gap-1.5">
          {Icon ? (
            <Icon
              className="size-[15px] shrink-0 text-subtle-foreground"
              aria-hidden
              strokeWidth={2.4}
            />
          ) : null}
          {title}
        </h2>
        {meta ? (
          <span className="text-[12.5px] text-subtle-foreground">{meta}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Badge({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex h-[26px] items-center gap-1.5 rounded-sm bg-[rgba(20,17,15,0.88)] px-2.5 text-[11.5px] font-semibold text-[#FFC93A]">
      {icon}
      {children}
    </span>
  );
}
