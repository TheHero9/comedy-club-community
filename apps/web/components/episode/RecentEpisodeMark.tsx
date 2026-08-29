"use client";

import { useEffect } from "react";

import { rememberEpisode } from "@/lib/recent-episodes";

/**
 * Records "this episode was opened" into the device's recent-episodes list,
 * which the search overlay offers back as one-tap re-entries.
 *
 * Renders nothing. An effect, not a render-time write: localStorage is an
 * external system, and writing it during render would run twice under strict
 * mode and on every re-render besides. The effect re-fires only when the
 * episode itself changes, which is exactly the event being recorded.
 */
export function RecentEpisodeMark({
  youtubeId,
  title,
  channelName,
}: {
  youtubeId: string;
  title: string;
  channelName: string;
}) {
  useEffect(() => {
    rememberEpisode({ youtubeId, title, channelName });
  }, [youtubeId, title, channelName]);

  return null;
}
