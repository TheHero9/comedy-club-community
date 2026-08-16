/**
 * The moment timestamp grammar, mirrored from the API.
 *
 * 🚨 This is for INSTANT FEEDBACK ONLY. `podcast/services/timestamps.py` parses
 * the same shapes server-side and is the authority - a client is never an
 * authority on its own input, the same reason `request.auth` is the only
 * accepted actor. If the two ever disagree, the server wins and the member sees
 * a 422; this file existing must never be read as "the API can trust the
 * number we send".
 *
 * Accepted:  "1:30:29" -> 5429   "30:29" -> 1829   "4:05" -> 245   "45" -> 45
 *
 * ⚠️ Strict about 60 on purpose. "4:75" is a typo, not 5:15 - silently
 * reinterpreting it would deep-link the video to a second the member never
 * meant. Only the LEADING part may exceed 60, so "90:00" is a valid 90 minutes.
 */

const MAX_PARTS = 3;

export interface TimestampParse {
  ok: boolean;
  seconds: number;
  /** A copy key, never a rendered sentence - the caller resolves it. */
  errorKey?: "empty" | "malformed" | "overSixty" | "tooLong" | "pastEnd";
}

export function parseTimestamp(input: string): TimestampParse {
  const cleaned = (input ?? "").trim();
  if (!cleaned) return { ok: false, seconds: 0, errorKey: "empty" };

  const parts = cleaned.split(":");
  if (parts.length > MAX_PARTS) {
    return { ok: false, seconds: 0, errorKey: "tooLong" };
  }

  const values: number[] = [];
  for (const rawPart of parts) {
    const part = rawPart.trim();
    // ASCII digits only. `Number()` happily accepts "1e3", " 5 ", "0x10" and
    // full-width digits, none of which the member typed.
    if (!/^\d+$/.test(part)) {
      return { ok: false, seconds: 0, errorKey: "malformed" };
    }
    values.push(Number(part));
  }

  for (const value of values.slice(1)) {
    if (value > 59) return { ok: false, seconds: 0, errorKey: "overSixty" };
  }

  const seconds = values.reduce((total, value) => total * 60 + value, 0);
  return { ok: true, seconds };
}

/** Seconds back to the shortest form that round-trips through parseTimestamp. */
export function formatTimestampInput(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
