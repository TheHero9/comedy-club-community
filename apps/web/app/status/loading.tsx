import { Skeleton } from "@/components/ui/skeleton";

/**
 * Scoped to /status on purpose.
 *
 * A `loading.tsx` creates a Suspense boundary, which lets Next stream the shell
 * before the page resolves. Once that shell is flushed the HTTP status is
 * committed, so a later `notFound()` can no longer return 404 - it becomes a
 * soft 404 with status 200, which is poison for an SEO-driven content site.
 *
 * So: never put a `loading.tsx` at the app root or above a segment that can call
 * `notFound()` (`/channels/[slug]`, `/e/[youtubeId]`). /status always renders,
 * so a boundary here is safe.
 */
export default function StatusLoading() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </main>
  );
}
