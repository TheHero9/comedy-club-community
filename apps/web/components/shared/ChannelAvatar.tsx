import Image from "next/image";

import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A channel's YouTube profile picture, over a gold fallback tile.
 *
 * 🚨 The fallback is layered, not conditional. The gold tile with the channel's
 * initials sits *behind* the image rather than replacing it when `avatarUrl` is
 * empty.
 *
 * The reason: a channel avatar URL is an opaque content hash on
 * yt3.googleusercontent.com that changes whenever the owner changes their
 * picture, so a stored URL can start 404ing between syncs. Handling that with
 * an `onError` handler would force this into a Client Component, and the
 * channel pages are Server Components on purpose.
 *
 * `alt=""` is what makes it work: the channel name is always rendered as text
 * beside this, so the image is decorative, and an empty alt means a broken
 * image renders nothing at all and reveals the tile under it.
 */
const SIZES = {
  /**
   * The two badge sizes are circular where the larger tiles are squircles. That
   * is deliberate: at this scale a rounded square reads as another chip, and the
   * score chip already sits in the opposite corner of the same thumbnail.
   */
  "2xs": { box: "size-[18px] rounded-full", textClass: "text-[8px]", px: 18 },
  xs: { box: "size-7 rounded-full", textClass: "text-[10px]", px: 28 },
  sm: { box: "size-14 rounded-2xl", textClass: "text-[19px]", px: 56 },
  md: { box: "size-16 rounded-3xl", textClass: "text-[21px]", px: 64 },
  lg: { box: "size-16 rounded-[24px] md:size-24", textClass: "text-[21px] md:text-[32px]", px: 96 },
} as const;

interface ChannelAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}

export function ChannelAvatar({
  name,
  avatarUrl,
  size = "sm",
  className,
}: ChannelAvatarProps) {
  const { box, textClass, px } = SIZES[size];

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-gold",
        box,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("font-display font-bold text-ink", textClass)}
      >
        {initials(name)}
      </span>

      {avatarUrl ? (
        // ⚠️ Explicit width/height, NOT `fill`. An avatar is a fixed size, and
        // `fill` needs a `sizes` string - but a fixed `sizes` like "64px" has no
        // vw for Next to filter the ladder against, so it emits every candidate
        // up to 1280w. Explicit dimensions collapse it to a 1x/2x pair.
        <Image
          src={avatarUrl}
          alt=""
          width={px}
          height={px}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}

      <span className="sr-only">{name}</span>
    </span>
  );
}
