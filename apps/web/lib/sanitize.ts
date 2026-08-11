/**
 * Normalisation for user input that arrives through a URL.
 *
 * 🚨 Why this exists at all.
 *
 * `U+0000` is legal in a URL as `%00`, and Next hands it to a page as an
 * ordinary string. Forwarded to the API it satisfies every Pydantic constraint
 * and only fails at the bottom, inside psycopg:
 *
 *     django.db.utils.DataError: PostgreSQL text fields cannot contain NUL bytes
 *
 * The API now rejects it with a 400 (`podcast.middleware.RejectNullBytesMiddleware`),
 * but a 400 raised inside a Server Component is still an unhandled throw, and
 * an unhandled throw is a **500 page**. Fixing only the API moved the error one
 * layer up; it did not remove it.
 *
 * So the character is dropped here, at the edge, where the query string is
 * first read. A URL a fuzzer or a broken client produced then degrades into an
 * ordinary empty result instead of an error page.
 */

/**
 * C0 and C1 control characters.
 *
 * 🇧🇬 This range is control characters ONLY. Cyrillic lives far above it and
 * passes through untouched - a filter that ate Bulgarian would break every real
 * channel slug and every real query while still passing a NUL-byte test, which
 * is why `tests/filter-model.spec.ts` pins both directions.
 */
// Written as \u escapes, not literal control characters, so the source stays
// copy-pasteable and `no-control-regex` has nothing to report.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Strip control characters from a value that will be sent to the API. */
export function stripControlCharacters(value: string): string {
  return value.replace(CONTROL_CHARACTERS, "");
}
