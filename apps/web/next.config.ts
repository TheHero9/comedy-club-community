import type { NextConfig } from "next";

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
    ],
  },
};

export default nextConfig;
