import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * A 16:9 episode thumbnail.
 *
 * The diagonal-stripe placeholder sits UNDER the image rather than replacing
 * it, for the same reason the channel avatar layers its fallback: a thumbnail
 * URL can start 404ing (a deleted or made-private video), and handling that
 * with `onError` would force every list page into a Client Component. These
 * pages are Server Components on purpose - they are the indexable ones.
 *
 * Stacking covers both failure modes (no URL, dead URL) with zero client JS,
 * and the placeholder has the same geometry as the real image so nothing
 * shifts when it loads.
 */
interface ThumbnailProps {
  src?: string | null;
  /** Decorative by default: the title is always rendered as text beside it. */
  alt?: string;
  /** Responsive `sizes` hint. Always pass one; the ladder depends on it. */
  sizes: string;
  className?: string;
  /** Above-the-fold hero thumbnails only. */
  priority?: boolean;
  children?: React.ReactNode;
}

export function Thumbnail({
  src,
  alt = "",
  sizes,
  className,
  priority = false,
  children,
}: ThumbnailProps) {
  return (
    <div
      className={cn(
        "relative aspect-video overflow-hidden bg-thumb-1 thumb-placeholder",
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : null}
      {children}
    </div>
  );
}
