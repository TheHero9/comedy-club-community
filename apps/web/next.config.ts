import type { NextConfig } from "next";

/**
 * Every image on this site is a YouTube thumbnail, and every YouTube thumbnail
 * tops out at 1280x720 (`maxresdefault.jpg`). Nothing is ever served from a
 * source wider than 1280, so the default breakpoint ladder (which runs to
 * 3840) generates srcSet candidates that can only ever upscale.
 *
 * That is not a theoretical cost. Measured on a production build with 24 cards
 * on /episodes, the default ladder emitted 10 srcSet candidates per card, which
 * is 1127 bytes of `srcSet` attribute per card - 27 KB of the page's 173 KB of
 * HTML, spent describing widths the CDN cannot supply.
 */
const YOUTUBE_THUMBNAIL_WIDTH = 1280;

const nextConfig: NextConfig = {
  images: {
    /**
     * Thumbnails are served straight from Google's CDN at a URL derived from the
     * 11-character video id. The project deliberately NEVER uploads or mirrors
     * them: zero API calls, zero storage cost, and Google keeps them fresh.
     *
     * i.ytimg.com is the same CDN under its other hostname - some YouTube
     * responses hand back that form, so both are allowed.
     */
    remotePatterns: [
      { protocol: "https", hostname: "img.youtube.com", pathname: "/vi/**" },
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },

      /**
       * Channel avatars and banners. These live on a different host AND follow a
       * different rule from thumbnails: a thumbnail URL is derived from the video
       * id, but an avatar sits at an opaque content hash that nothing in our data
       * predicts, so the API stores the URL. Still never mirrored - Google's CDN
       * serves it. See apps/api/podcast/ingestion/channel_images.py.
       */
      { protocol: "https", hostname: "yt3.googleusercontent.com" },
    ],

    /**
     * Ladder trimmed to the source ceiling. 640 covers a phone at 1x, 828 a
     * phone at 2x, 1080 a phone at 3x and a card at 2x, 1280 the full-width
     * hero on the episode page. Anything above 1280 would be an upscale.
     */
    deviceSizes: [640, 828, 1080, YOUTUBE_THUMBNAIL_WIDTH],

    /**
     * Concatenated with deviceSizes for any image that passes `sizes`. Only the
     * entries at or above `min(sizes percentage) * deviceSizes[0]` survive into
     * a srcSet, so this list only needs to cover genuinely small thumbnails.
     */
    imageSizes: [64, 128, 256, 384],

    /** Required from Next 16. The app only ever asks for the default quality. */
    qualities: [75],

    /**
     * A YouTube thumbnail effectively never changes, and when it does the change
     * is cosmetic. Caching an optimized variant for 31 days instead of 4 hours
     * removes almost all repeat work from the optimizer.
     */
    minimumCacheTTL: 2678400,
  },
};

export default nextConfig;
