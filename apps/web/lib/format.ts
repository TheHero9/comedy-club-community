/**
 * Display formatting.
 *
 * Everything here is pure and deterministic so it can run identically in a
 * Server Component and in the browser. No `Intl` date formatting: the runner's
 * locale and timezone must not be able to change what a date reads as, and
 * `bg-BG` short months render as "12.03.2025", not the "12 март 2025" the
 * design specifies.
 */
import { copy } from "@/lib/copy";

/** "2025-03-12" or an ISO datetime -> "12 март 2025". Empty string for null. */
export function formatDate(value: string | null | undefined): string {
  const parts = parseIsoDate(value);
  if (!parts) return "";
  return `${parts.day} ${copy.common.months[parts.month]} ${parts.year}`;
}

/** Year only, or null when there is no upload date. */
export function yearOf(value: string | null | undefined): number | null {
  return parseIsoDate(value)?.year ?? null;
}

/**
 * Parse the leading `YYYY-MM-DD` of an API date without constructing a Date.
 * `new Date("2025-03-12")` is UTC midnight, which in a negative-offset timezone
 * renders as the 11th.
 */
function parseIsoDate(
  value: string | null | undefined,
): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return null;
  return { year: Number(match[1]), month, day: Number(match[3]) };
}

/** Seconds -> "2:14:07" or "44:20". Empty string when the API has no duration. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

/** Seconds -> "1:42:10", always at least mm:ss. Used for moment timestamps. */
export function formatTimestamp(seconds: number): string {
  return formatDuration(Math.max(1, Math.round(seconds))) || "0:00";
}

/** 128000 -> "128 хил.", 1300000 -> "1.3 млн.". Bulgarian short scale. */
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const thousands = value / 1000;
    const rounded = thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10;
    return `${rounded} хил.`;
  }
  const millions = value / 1_000_000;
  return `${Math.round(millions * 10) / 10} млн.`;
}

/** Score -> "8.6". Null renders as "?", never "0" and never the worst band. */
export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? "?" : score.toFixed(1);
}

/** Signed delta against the public score: 0.4 -> "+0.4", -0.6 -> "-0.6". */
export function formatDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

/**
 * Thumbnail URL for a YouTube id.
 *
 * Project rule: never mirror a thumbnail. `hqdefault` is the guaranteed size;
 * `maxresdefault` is better but not always present, and a client-side HEAD
 * probe per card is worse than the resolution difference. The API already
 * returns `thumbnail_url`, so this is the fallback for shapes that only carry
 * a `youtube_id` (the grid cell, for one).
 */
export function thumbnailUrl(youtubeId: string): string {
  return `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
}

/** Canonical watch URL. Every watch action opens YouTube in a new tab. */
export function youtubeWatchUrl(youtubeId: string): string {
  return `https://www.youtube.com/watch?v=${youtubeId}`;
}

/** Deep link into a moment. `t` in seconds is what YouTube expects. */
export function youtubeMomentUrl(youtubeId: string, seconds: number): string {
  return `${youtubeWatchUrl(youtubeId)}&t=${Math.max(0, Math.floor(seconds))}`;
}

/** Two-letter initials for an avatar fallback. Cyrillic-safe. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Local calendar date as `YYYY-MM-DD`, never UTC-shifted. */
export function toIsoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "преди 3 дни" style relative label for a watch-log entry. */
export function relativeDay(iso: string, today: Date): string {
  const parts = parseIsoDate(iso);
  if (!parts) return "";
  const then = new Date(parts.year, parts.month, parts.day);
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000);

  if (days <= 0) return "днес";
  if (days === 1) return "вчера";
  if (days < 7) return `преди ${days} дни`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? "преди седмица" : `преди ${weeks} седмици`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? "преди месец" : `преди ${months} месеца`;
  }
  const years = Math.round(days / 365);
  return years === 1 ? "преди година" : `преди ${years} години`;
}

/** "преди 12 сек" style label for the status page's last-checked line. */
export function relativeSeconds(seconds: number): string {
  if (seconds < 60) return `преди ${Math.max(0, Math.round(seconds))} сек`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `преди ${minutes} мин`;
  const hours = Math.round(minutes / 60);
  return `преди ${hours} ч`;
}
