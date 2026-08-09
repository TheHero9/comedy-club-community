import Image from "next/image";
import { Mic } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A channel's YouTube profile picture.
 *
 * 🚨 The fallback is layered, not conditional. The Mic icon sits *behind* the image
 * rather than replacing it when `avatar_url` is empty.
 *
 * The reason: a channel avatar URL is an opaque content hash that changes whenever the
 * owner changes their picture, so a stored URL can start 404ing between syncs. Handling
 * that with an `onError` handler would force this into a Client Component, and these
 * channel pages are Server Components on purpose - they are the indexable ones.
 *
 * Stacking instead gives a pure-CSS fallback that covers BOTH failure modes (no URL,
 * and a URL that stopped resolving) with zero client JS. `alt=""` matters here: the
 * channel name is always rendered as text next to this, so the image is decorative,
 * and an empty alt means a broken image renders nothing and reveals the icon under it.
 */

const SIZES = {
  sm: { box: "h-11 w-11", icon: "h-5 w-5", px: 44 },
  lg: { box: "h-16 w-16", icon: "h-7 w-7", px: 64 },
} as const;

type Props = {
  name: string;
  avatarUrl: string;
  size?: keyof typeof SIZES;
  className?: string;
};

export function ChannelAvatar({ name, avatarUrl, size = "sm", className }: Props) {
  const { box, icon, px } = SIZES[size];

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted",
        box,
        className,
      )}
    >
      <Mic className={cn("text-muted-foreground", icon)} aria-hidden />

      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt=""
          // ⚠️ Explicit width/height, NOT `fill`. An avatar is a fixed size, and
          // `fill` requires a `sizes` string - but a fixed `sizes` like "44px" has
          // no vw for Next to filter the ladder against, so it emits every
          // candidate up to 1280w and defaults `src` to w=1280. That is 8 URLs of
          // srcSet per channel to paint 44 CSS px, upscaled from a 480px source.
          // Explicit dimensions collapse it to a 1x/2x pair. Same reasoning as the
          // deviceSizes trimming in next.config.ts.
          width={px}
          height={px}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}

      <span className="sr-only">{name}</span>
    </span>
  );
}
