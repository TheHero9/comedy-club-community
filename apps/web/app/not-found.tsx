import Link from "next/link";
import { HouseIcon, ListVideoIcon, SearchXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";

/**
 * Rendered whenever a route misses or a page calls `notFound()`. Next serves it
 * with a real 404 status, which matters: this is an indexable content site and
 * soft 404s get crawled as if they were real pages.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
      <SearchXIcon className="size-10 text-muted-foreground" aria-hidden />

      <div className="space-y-2">
        <p className="font-mono text-sm text-muted-foreground">
          {copy.notFound.code}
        </p>
        <h1 className="font-heading text-2xl font-semibold text-balance sm:text-3xl">
          {copy.notFound.title}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {copy.notFound.body}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Base UI composes via `render`, not Radix's `asChild`. These render an
            anchor, so `nativeButton={false}` keeps link semantics instead of
            claiming to be a <button>. */}
        <Button render={<Link href="/" />} nativeButton={false}>
          <HouseIcon className="size-4" aria-hidden />
          {copy.notFound.backHome}
        </Button>
        <Button
          render={<Link href="/episodes" />}
          nativeButton={false}
          variant="outline"
        >
          <ListVideoIcon className="size-4" aria-hidden />
          {copy.notFound.browseEpisodes}
        </Button>
      </div>
    </main>
  );
}
