import type { NextConfig } from "next";

/**
 * 🚨 NOTHING ON THIS SITE IS OPTIMIZED BY VERCEL. `images.loaderFile` points at
 * `lib/image-loader.ts`, which returns Google CDN URLs directly, so
 * `/_next/image` is never requested and no image transformation is ever billed.
 *
 * That file carries the full reasoning and the incident it came out of (the
 * optimizer's allowance ran out on 2026-08-22 and started answering
 * `402 Payment Required`, which emptied every thumbnail on the site). Read it
 * before changing anything in this block - the two files have to agree.
 */
const nextConfig: NextConfig = {
  images: {
    /**
     * Every `<Image>` goes through here. Removing this line silently restores
     * the paid optimizer, and the symptom (blank thumbnails) shows up only once
     * the allowance runs out again - i.e. long after the change.
     */
    loaderFile: "./lib/image-loader.ts",

    /**
     * Thumbnails are served straight from Google's CDN at a URL derived from the
     * 11-character video id. The project deliberately NEVER uploads or mirrors
     * them: zero API calls, zero storage cost, and Google keeps them fresh.
     *
     * i.ytimg.com is the same CDN under its other hostname - some YouTube
     * responses hand back that form, so both are allowed.
     *
     * ⚠️ A custom loader bypasses this allow-list, so these no longer gate
     * anything at runtime. They stay because they document the only hosts the
     * loader is written to understand, and because they are what would protect
     * the app if the loader were ever removed.
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
     * 🚨 THE LADDER IS THE OTHER HALF OF THE LOADER'S BUCKETING - the two must
     * move together, and neither makes sense read alone.
     *
     * There are exactly THREE distinct files the loader can return, so there
     * are exactly three rungs: 320 -> `mqdefault` (320x180), 828 -> `hqdefault`
     * (480x360), 1280 -> whatever the API verified exists (normally
     * `maxresdefault`, 1280x720).
     *
     * ⚠️ A fourth rung is not a finer choice, it is a DUPLICATE URL in every
     * srcSet on the site - the ladder was [320, 480, 828, 1280] for one build
     * and 480 emitted the same `hqdefault` as 828, costing bytes to say the
     * same thing twice. Add a rung only when the loader gains a real bucket.
     *
     * 828 is the load-bearing one. A phone at 2x asks for roughly double its
     * CSS width, so without a rung just above that the browser jumps straight
     * to the 1,280px source and pays ~208 KB per card instead of ~21 KB.
     *
     * Anything above 1280 would be an upscale - no YouTube thumbnail is wider.
     */
    deviceSizes: [320, 828, 1280],

    /**
     * Concatenated with deviceSizes for any image that passes `sizes`, and used
     * on its own for the fixed-size avatars, which are 18-96px and resolve to a
     * re-derived `=sNNN` on the Google URL rather than to a bucket. 256 is here
     * for the 96px avatar at 2x; 384 was dropped because it only ever produced
     * a second copy of the `hqdefault` that 828 already covers.
     */
    imageSizes: [64, 128, 256],

    /** Required from Next 16. The loader ignores it - Google has no quality knob. */
    qualities: [75],
  },
};

export default nextConfig;
