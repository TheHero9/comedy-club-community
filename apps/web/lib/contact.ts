/**
 * How to reach the person who runs the site.
 *
 * 🔒 These are PUBLIC values in a PUBLIC repo. They ship in the client bundle,
 * in the rendered HTML and in git history forever, so scrapers will find them.
 * Nothing goes in here that is not already meant to be handed out.
 *
 * 🚨 NOT copy. An address reads identically in English and in Bulgarian, so
 * putting it in `lib/copy.ts` would mean two duplicate entries that can
 * silently drift apart - and changing it would then be a two-file edit with one
 * half easy to forget. The LABEL around a value is copy; the value is data.
 *
 * An empty string means "not published": `HelpContact` drops the row rather
 * than rendering a dead link, so unpublishing a channel is a one-line change
 * here and nowhere else.
 */
export const CONTACT = {
  email: "dimitrios.v.2002@gmail.com",
} as const;

/**
 * `mailto:` with a prefilled subject, so a message that arrives among a
 * thousand others still says which site it came from.
 */
export function mailtoUrl(address: string, subject: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`;
}
