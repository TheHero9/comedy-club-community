import { Page } from "@/components/shell/Page";
import { Skeleton } from "@/components/ui/skeleton";

/** See `app/search/loading.tsx` for why every route needs one of these. */
export default function MembershipsLoading() {
  return (
    <Page>
      <Skeleton className="h-9 w-56 max-w-full" />
      <div className="mt-5 flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    </Page>
  );
}
