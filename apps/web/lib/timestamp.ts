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
 *            ""        -> null (a note about the episode, not a point in it)
 *
 * ⚠️ Strict about 60 on purpose. "4:75" is a typo, not 5:15 - silently
 * reinterpreting it would deep-link the video to a second the member never
 * meant. Only the LEADING part may exceed 60, so "90:00" is a valid 90 minutes.
 */

const MAX_PARTS = 3;

/** h:mm:ss, so six digits is the whole grammar. */
const MAX_DIGITS = 6;

export interface TimestampParse {
  ok: boolean;
  /** null means "no timestamp", which is a valid answer - not a failure. */
  seconds: number | null;
  /** A copy key, never a rendered sentence - the caller resolves it. */
  errorKey?: "malformed" | "overSixty" | "tooLong" | "pastEnd";
}

export function parseTimestamp(input: string): TimestampParse {
  const cleaned = (input ?? "").trim();
  // 🚨 Blank is OK and means null, since 2026-08-16. It is NOT an error, and
  // the difference matters: leaving the field empty is a decision, mistyping
  // it is not. A malformed value below is still refused.
  if (!cleaned) return { ok: true, seconds: null };

  const parts = cleaned.split(":");
  if (parts.length > MAX_PARTS) {
    return { ok: false, seconds: null, errorKey: "tooLong" };
  }

  const values: number[] = [];
  for (const rawPart of parts) {
    const part = rawPart.trim();
    // ASCII digits only. `Number()` happily accepts "1e3", " 5 ", "0x10" and
    // full-width digits, none of which the member typed.
    if (!/^\d+$/.test(part)) {
      return { ok: false, seconds: null, errorKey: "malformed" };
    }
    values.push(Number(part));
  }

  for (const value of values.slice(1)) {
    if (value > 59) return { ok: false, seconds: null, errorKey: "overSixty" };
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

/**
 * Punctuate what someone is typing, so the colons appear on their own.
 *
 * 🚨 WHY THIS EXISTS. The field carried `inputMode="numeric"`, which on a phone
 * is a DIGITS-ONLY keypad - there is no colon key on it at all. So the one
 * separator the format requires was literally unreachable on the device most of
 * this audience uses. The owner's report was "it's like a number field and I
 * can't add the two dots, it's super annoying".
 *
 * Widening the keyboard to `text` would fix reachability and leave the colon
 * two taps deep behind a symbols page. Inserting it instead means the member
 * types `13029` and reads `1:30:29`, and never reaches for the key.
 *
 * Grouped from the RIGHT, so every prefix of a real time is itself a real time:
 * `4` -> "4", `45` -> "45", `455` -> "4:55", `13029` -> "1:30:29". Typed colons
 * are stripped first, so pasting "1:30:29" also lands correctly.
 *
 * ⚠️ It does NOT validate. `475` becomes "4:75", which `parseTimestamp` then
 * refuses - reinterpreting it as 5:15 is exactly the silent rewrite the strict
 * 60 rule exists to prevent.
 */
export function maskTimestampInput(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "").slice(0, MAX_DIGITS);
  if (digits.length <= 2) return digits;

  const seconds = digits.slice(-2);
  const minutes = digits.slice(-4, -2);
  const hours = digits.slice(0, -4);
  return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}
