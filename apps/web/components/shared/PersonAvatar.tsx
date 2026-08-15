import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A participant's circular avatar, rendered as initials on a coloured tile.
 *
 * ⚠️ Deliberately NOT an `<Image>`. `Person.avatar_url` is free text on the
 * model and can point at any host, and `next/image` throws a hard error for a
 * host missing from `remotePatterns` - so one person row with an unexpected
 * URL would take down a whole episode page. The design shows initials tiles
 * anyway, and there are three people in the entire database.
 *
 * The colour is derived from the person's slug, never stored: data carries
 * semantic keys, the component layer maps them to visuals. All palette entries
 * are band colours reused as surfaces, so they take the same near-black ink
 * the score chips do.
 */
const PALETTE = [
  "bg-gold",
  "bg-band-masterpiece",
  "bg-band-awesome",
  "bg-band-good",
] as const;

const SIZES = {
  sm: { box: "size-[34px]", textClass: "text-[11.5px]" },
  md: { box: "size-16", textClass: "text-[19px]" },
  lg: { box: "size-[72px]", textClass: "text-[22px]" },
} as const;

/** Stable, order-independent hash so the same person keeps the same colour. */
function paletteFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

interface PersonAvatarProps {
  name: string;
  slug?: string;
  size?: keyof typeof SIZES;
  /** Neutral surface instead of a palette colour, for the signed-in user. */
  neutral?: boolean;
  /**
   * A real picture to show instead of the initials.
   *
   * 🚨 The signed-in user HAS one - Clerk gives us `image_url` from Google and
   * we store it on `UserProfile.avatar_url` - and the profile page ignored it
   * entirely, so people were greeted by two letters on a grey tile while their
   * own photo sat unused in the database.
   *
   * A plain `<img>`, deliberately: see the note above. The URL comes from an
   * identity provider and can move hosts, and `next/image` throws a hard error
   * for a host missing from `remotePatterns` - which would take down the whole
   * profile page rather than degrade one avatar.
   */
  imageUrl?: string | null;
  className?: string;
}

export function PersonAvatar({
  name,
  slug,
  size = "md",
  neutral = false,
  imageUrl,
  className,
}: PersonAvatarProps) {
  const { box, textClass } = SIZES[size];
  const surface = neutral
    ? "bg-elevated border border-border-2 text-muted-foreground"
    : `${paletteFor(slug ?? name)} text-ink`;

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-pill",
        box,
        surface,
        className,
      )}
    >
      {/* Initials sit BEHIND the image rather than instead of it, so a URL
          that stops resolving degrades to the tile with no client JS and no
          layout shift - the same trick ChannelAvatar uses for Google's opaque
          avatar hashes, which do 404 between syncs. */}
      <span aria-hidden className={cn("font-display font-bold", textClass)}>
        {initials(name)}
      </span>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <span className="sr-only">{name}</span>
    </span>
  );
}
