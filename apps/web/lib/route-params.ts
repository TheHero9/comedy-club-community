/**
 * Dynamic route parameter decoding.
 *
 * 🇧🇬 Next hands dynamic segments back **percent-encoded** for non-ASCII values.
 * Bulgarian channel, topic and person slugs are Cyrillic, so `params.slug` for
 * `/channels/комеди-клуб-подкаст` arrives as `%D0%BA%D0%BE...`.
 *
 * The typed API client already percent-encodes path segments, so passing that
 * value straight through produced a DOUBLE-encoded URL (`%25D0%25BA...`), which
 * the API answered with a 404. Every Cyrillic-slugged channel 404'd while the
 * ASCII-slugged one worked, which is exactly the kind of bug that looks like bad
 * data rather than bad plumbing.
 *
 * Decoding here is idempotent for our slugs: an already-decoded Cyrillic slug
 * contains no `%`, so `decodeURIComponent` returns it unchanged.
 */

/**
 * Decode one route parameter.
 *
 * A malformed sequence (`%zz`) makes `decodeURIComponent` throw. That must not
 * become a 500 - a nonsense URL is a 404, so the raw value is returned and the
 * lookup fails normally.
 */
export function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
