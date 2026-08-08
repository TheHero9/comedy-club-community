import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  Calendar,
  Clock,
  Crown,
  ExternalLink,
  MessageSquare,
  Radio,
  Star,
  Tag,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { isApiError } from "@/lib/api/client";
import { getEpisode, listComments, listMoments } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { bandStyle, formatDate, formatDuration, formatScore } from "@/lib/score-bands";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: PageProps<"/e/[youtubeId]">): Promise<Metadata> {
  const { youtubeId } = await params;
  try {
    const episode = await getEpisode(youtubeId);
    return {
      title: episode.title,
      description: episode.description.slice(0, 200) || copy.app.description,
      openGraph: {
        title: episode.title,
        description: episode.description.slice(0, 200),
        // The YouTube CDN thumbnail doubles as the OG image - no upload needed.
        images: episode.thumbnail_url ? [episode.thumbnail_url] : undefined,
        type: "video.episode",
      },
    };
  } catch {
    return { title: copy.episodes.title };
  }
}

function timestampLink(youtubeId: string, seconds: number) {
  return `https://www.youtube.com/watch?v=${youtubeId}&t=${seconds}`;
}

export default async function EpisodePage({ params }: PageProps<"/e/[youtubeId]">) {
  const { youtubeId } = await params;

  let episode;
  try {
    episode = await getEpisode(youtubeId);
  } catch (error) {
    if (isApiError(error) && error.status === 404) notFound();
    throw error;
  }

  const [moments, comments] = await Promise.all([
    listMoments(youtubeId),
    listComments(youtubeId, { limit: 20 }),
  ]);

  const band = bandStyle(episode.band ?? null);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
            {episode.thumbnail_url ? (
              <Image
                src={episode.thumbnail_url}
                alt=""
                fill
                priority
                sizes="(max-width: 768px) 100vw, 720px"
                className="object-cover"
              />
            ) : null}
          </div>

          <div>
            {/* 🇧🇬 The title is Bulgarian. `break-words` stops long compound words
                from overflowing on a 390px screen. */}
            <h1 className="break-words text-2xl font-bold leading-tight">{episode.title}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <Link
                href={`/channels/${episode.channel_slug}`}
                className="font-medium text-foreground hover:underline"
              >
                {episode.channel_name}
              </Link>
              {episode.upload_date ? (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" aria-hidden />
                  {formatDate(episode.upload_date)}
                </span>
              ) : null}
              {episode.duration_sec ? (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {formatDuration(episode.duration_sec)}
                </span>
              ) : null}
              {episode.members_only ? (
                <Badge variant="secondary" className="gap-1">
                  <Crown className="h-3 w-3" aria-hidden />
                  {copy.episode.membersOnly}
                </Badge>
              ) : null}
              {episode.content_kind === "stream" ? (
                <Badge variant="secondary" className="gap-1">
                  <Radio className="h-3 w-3" aria-hidden />
                  {copy.episode.stream}
                </Badge>
              ) : null}
            </div>
          </div>

          <a
            href={episode.watch_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
            {copy.episode.watchOnYouTube}
          </a>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {copy.episode.publicScore}
              </span>
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-lg font-bold tabular-nums",
                  episode.public_score === null ? "text-muted-foreground" : band.cell,
                )}
              >
                {formatScore(episode.public_score)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {episode.public_score === null
                ? copy.episode.notRated
                : copy.episode.ratings(episode.rating_count)}
            </p>

            {episode.elite_score !== null ? (
              <>
                <div className="mt-4 flex items-center justify-between border-t pt-4">
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {copy.episode.eliteScore}
                  </span>
                  <span
                    className={cn(
                      "rounded px-2 py-0.5 text-lg font-bold tabular-nums",
                      bandStyle(episode.elite_band ?? null).cell,
                    )}
                  >
                    {formatScore(episode.elite_score)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {copy.episode.ratings(episode.elite_rating_count)}
                </p>
              </>
            ) : null}
          </div>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
              <Tag className="h-3.5 w-3.5" aria-hidden />
              {copy.episode.topics}
            </h2>
            {episode.topics.length === 0 ? (
              <p className="text-xs text-muted-foreground">{copy.episode.noTopics}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {episode.topics.map((topic) => (
                  <li key={topic.id}>
                    <Link href={`/episodes?topic=${topic.slug}`}>
                      <Badge variant="secondary" className="hover:bg-accent">
                        {topic.name}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Star className="h-4 w-4" aria-hidden />
          {copy.episode.moments}
          <span className="text-sm font-normal text-muted-foreground">
            ({moments.length})
          </span>
        </h2>
        {moments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.episode.noMoments}</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {moments.map((moment) => (
              <li key={moment.id} className="flex items-center gap-3 p-3">
                <a
                  href={timestampLink(episode.youtube_id, moment.timestamp_sec)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded bg-muted px-2 py-1 font-mono text-xs tabular-nums hover:bg-accent"
                >
                  {formatDuration(moment.timestamp_sec)}
                </a>
                <span className="min-w-0 flex-1 break-words text-sm">{moment.label}</span>
                {moment.author ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {moment.author}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MessageSquare className="h-4 w-4" aria-hidden />
          {copy.episode.comments}
          <span className="text-sm font-normal text-muted-foreground">
            ({comments.meta.total})
          </span>
        </h2>
        {comments.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.episode.noComments}</p>
        ) : (
          <ul className="space-y-3">
            {comments.items.map((comment) => (
              <li key={comment.id} className="rounded-lg border bg-card p-3">
                <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{comment.author_name}</span>
                  <span>{formatDate(comment.created_at)}</span>
                </div>
                {/* Comment bodies are user input. Rendered as TEXT - never as HTML. */}
                <p
                  className={cn(
                    "whitespace-pre-wrap break-words text-sm",
                    comment.is_spoiler &&
                      "select-none blur-sm transition hover:select-auto hover:blur-none focus:blur-none",
                  )}
                  tabIndex={comment.is_spoiler ? 0 : undefined}
                  title={comment.is_spoiler ? copy.episode.spoiler : undefined}
                >
                  {comment.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {episode.description ? (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{copy.episode.description}</h2>
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {episode.description}
          </p>
        </section>
      ) : null}
    </div>
  );
}
