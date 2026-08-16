import { Page } from "@/components/shell/Page";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * 🚨 Inside the `(index)` route group ON PURPOSE. At `app/channels/loading.tsx`
 * this boundary would also cover `/channels/[slug]`, whose `notFound()` would
 * then flush a 200 shell first and become a soft 404. The group is what keeps
 * the boundary on the listing alone; the URL is unchanged.
 *
 * See `app/search/loading.tsx` for the full reasoning.
 */
export default function ChannelsLoading() {
  return (
    <Page>
      <Skeleton className="h-9 w-52 max-w-full" />
      <div className="mt-5 flex flex-col gap-3">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-[132px] w-full rounded-2xl" />
        ))}
      </div>
    </Page>
  );
}
