import { Page } from "@/components/shell/Page";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * 🚨 WHY EVERY ROUTE ON THIS SITE NEEDED ONE OF THESE (2026-08-16).
 *
 * Reading the locale cookie makes a route dynamic (see `lib/locale.ts`), and
 * Next SKIPS prefetching dynamic routes entirely unless they have a
 * `loading.tsx` - with one, the shared shell and this fallback are prefetched
 * and the navigation commits immediately. Without one, every click on the site
 * blocked on a full server round trip showing NO feedback at all, which is
 * exactly what the owner reported: "everything has so much delay, it feels like
 * nothing happened".
 *
 * `/search` was the worst of them: `force-dynamic` plus two Meilisearch round
 * trips, so the previous page stayed on screen for ~2s after the click.
 *
 * ⚠️ WHERE THIS IS BANNED. A Suspense boundary flushes the shell with a 200
 * before the page resolves, so a later `notFound()` becomes a soft 404. Never
 * at the app root, and never above a segment that can call `notFound()` -
 * which is why `/channels` and `/me` had their index pages moved into route
 * groups rather than taking a boundary that would also cover
 * `/channels/[slug]` and `/me/[list]`.
 */
export default function SearchLoading() {
  return (
    <Page>
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="mt-4 h-[54px] w-full rounded-pill" />
      <Skeleton className="mt-6 h-4 w-40" />
      <div className="mt-3 flex flex-col gap-2.5">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[104px] w-full rounded-2xl" />
        ))}
      </div>
    </Page>
  );
}
