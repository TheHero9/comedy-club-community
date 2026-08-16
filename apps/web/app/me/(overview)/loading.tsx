import { Page } from "@/components/shell/Page";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * 🚨 Inside the `(overview)` route group ON PURPOSE. At `app/me/loading.tsx`
 * this boundary would also cover `/me/[list]`, which calls `notFound()` for an
 * unknown list slug and would become a soft 404.
 *
 * See `app/search/loading.tsx` for the full reasoning.
 */
export default function ProfileLoading() {
  return (
    <Page>
      <Skeleton className="h-9 w-40 max-w-full" />
      <Skeleton className="mt-5 h-28 w-full rounded-2xl" />
      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    </Page>
  );
}
