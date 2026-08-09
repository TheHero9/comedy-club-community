"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { Button } from "@/components/ui/button";
import type { Comment } from "@/lib/api/podcast";
import { copy } from "@/lib/copy";
import { relativeDay } from "@/lib/format";

/**
 * A community review.
 *
 * 🚨 Spoilers are TAP TO REVEAL, and the body is not in the DOM until the
 * reveal. A hover blur is invisible on touch, survives in a screenshot, and
 * still ships the text to anyone who opens view-source - which is to say it
 * does not hide a spoiler at all, it just makes it inconvenient on a laptop.
 *
 * Client Component: the reveal is the whole point, and the body must stay out
 * of the server-rendered HTML.
 */
export function CommentCard({ comment }: { comment: Comment }) {
  const [revealed, setRevealed] = useState(false);
  const hidden = comment.is_spoiler && !revealed;

  return (
    <article className="flex gap-3 rounded-xl border border-border bg-card p-3">
      <PersonAvatar
        name={comment.author_name}
        slug={String(comment.author_id)}
        size="sm"
        neutral
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-semibold">{comment.author_name}</span>
          <span className="font-mono text-[11px] text-subtle-foreground">
            {relativeDay(comment.created_at.slice(0, 10), new Date())}
          </span>
        </div>

        {hidden ? (
          <div className="mt-2 flex items-center gap-2.5 rounded-md border border-border-3 bg-elevated px-3 py-2.5">
            <Lock className="size-[15px] shrink-0 text-gold" aria-hidden strokeWidth={2.2} />
            <span className="flex-1 text-[12.5px] text-muted-foreground">
              {copy.episode.spoilerNotice}
            </span>
            <Button
              variant="elevated"
              size="xs"
              shape="rounded"
              className="h-8 bg-border-2 px-3 text-[12.5px]"
              onClick={() => setRevealed(true)}
            >
              {copy.episode.spoilerReveal}
            </Button>
          </div>
        ) : (
          <div className="mt-1.5">
            <p className="text-[14px] leading-snug text-muted-foreground">
              {comment.body}
            </p>
            {comment.is_spoiler ? (
              <Button
                variant="outline"
                size="xs"
                shape="rounded"
                className="mt-2 h-[30px] px-3 text-[12px] font-normal text-muted-foreground"
                onClick={() => setRevealed(false)}
              >
                {copy.episode.spoilerHide}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}
