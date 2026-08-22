/**
 * The image loader for every `next/image` on this site.
 *
 * 🚨 THIS FILE EXISTS SO THAT NOTHING IS EVER OPTIMIZED BY VERCEL AGAIN.
 *
 * Every image here is a Google-hosted file - a YouTube thumbnail or a channel
 * avatar - and Google already serves each one pre-rendered at several fixed
 * sizes, free and forever. Routing them through `/_next/image` paid a
 * per-transformation fee to re-encode a file that was already the right shape,
 * and with ~1,961 episodes x a srcSet ladder that is ~9,800 distinct
 * transformations for ONE full crawl of the catalogue.
 *
 * On 2026-08-22 that allowance ran out and the optimizer began answering
 * `402 Payment Required` (`X-Vercel-Error: OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED`)
 * to every width that was not already in the edge cache. Thumbnails vanished
 * site-wide. The only ones still rendering were stale cache entries days old.
 *
 * It is the same rule the ingestion side already follows and says out loud in
 * `apps/api/podcast/ingestion/channel_images.py`: **never mirror a thumbnail,
 * Google's CDN serves it**. Paying an optimizer per image is that same mistake
 * wearing a different hat.
 *
 * A loader returns a URL and Next requests exactly that. So every return here
 * MUST be an absolute Google URL - the moment one returns a `/_next/image`
 * path, the bill and the 402s come straight back.
 */

/**
 * `https://img.youtube.com/vi/{11-char id}/{variant}.jpg`, captured so the
 * variant can be swapped without rebuilding the id. `i.ytimg.com` is the same
 * CDN under its other hostname; some YouTube responses hand back that form.
 */
const YOUTUBE_THUMBNAIL =
  /^(https:\/\/(?:img\.youtube\.com|i\.ytimg\.com)\/vi\/[A-Za-z0-9_-]{11}\/)[a-z0-9]+(\.jpg)$/;

/**
 * 🚨 THE TWO THRESHOLDS ARE DELIBERATELY NOT THE SOURCE WIDTHS, and that is the
 * whole mechanism - do not "correct" them to 320/480.
 *
 * YouTube's buckets are 320, 480 and 1280 wide with NOTHING in between, so an
 * honest ladder would send any request above 480px straight to the 1280 source:
 * a 390px phone at 2x asks for ~780px, which on a 24-card page is 24 x 208 KB
 * = ~5 MB. Declaring the 480x360 file as the 828w candidate instead caps that
 * page at ~500 KB - better than the ~1.2 MB the paid optimizer was serving -
 * at the cost of some sharpness on high-density screens.
 *
 * That is the correct trade for this audience (mobile-heavy) and this layout
 * (the title is always rendered as text beside the image, so the thumbnail is
 * near-decorative). It is also exactly what YouTube's own grid serves.
 *
 * Keep `deviceSizes` in `next.config.ts` aligned with these numbers: the ladder
 * decides which widths the browser is ever offered, and this decides what each
 * of those widths resolves to.
 */
const MQDEFAULT_MAX_WIDTH = 320; // -> 320x180, 16:9, ~14 KB
const HQDEFAULT_MAX_WIDTH = 828; // -> 480x360, ~21 KB

/**
 * Avatars live on a different host and follow a different rule: their size is a
 * suffix on an opaque content hash (`=s480-c-k-c0x00ffffff-no-rj`), so the size
 * is re-derived rather than picked from a fixed set.
 */
const GOOGLE_AVATAR_HOST = "https://yt3.googleusercontent.com/";
const AVATAR_SIZE_TOKEN = /=s(\d+)/;

interface LoaderArgs {
  src: string;
  width: number;
  /** Ignored. Google serves what it has; there is no quality knob. */
  quality?: number;
}

export default function googleCdnImageLoader({
  src,
  width,
}: LoaderArgs): string {
  const thumbnail = YOUTUBE_THUMBNAIL.exec(src);
  if (thumbnail) {
    const [, prefix, extension] = thumbnail;
    if (width <= MQDEFAULT_MAX_WIDTH) return `${prefix}mqdefault${extension}`;
    if (width <= HQDEFAULT_MAX_WIDTH) return `${prefix}hqdefault${extension}`;

    /**
     * 🚨 Above the last threshold, hand back the URL WE WERE GIVEN rather than
     * naming `maxresdefault` ourselves.
     *
     * `mqdefault` and `hqdefault` are the only two YouTube guarantees; the
     * larger files are not promised to exist. The API already resolved that
     * question per episode - `ingestion/thumbnails.py` HEAD-probes
     * `maxresdefault` at ingest and stores `hqdefault` when it is absent - so
     * the incoming `src` is the largest size KNOWN to exist for this video.
     * Upgrading it here would be guessing, and a wrong guess renders the
     * stripe placeholder with no way to find out.
     */
    return src;
  }

  if (src.startsWith(GOOGLE_AVATAR_HOST)) {
    const stored = AVATAR_SIZE_TOKEN.exec(src);
    /**
     * Only ever shrink. Asking Google for a size above the stored one buys
     * an upscale of a file we already have, and banners carry a `=w1707` token
     * instead, which this deliberately leaves alone.
     */
    if (stored && width < Number(stored[1])) {
      return src.replace(AVATAR_SIZE_TOKEN, `=s${width}`);
    }
    return src;
  }

  /** Anything else (a local asset, a host added later) is served as written. */
  return src;
}
