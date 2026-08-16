import { Page } from "@/components/shell/Page";
import { Skeleton } from "@/components/ui/skeleton";

/** See `app/search/loading.tsx` for why every route needs one of these. */
export default function ManagePeopleLoading() {
  return (
    <Page>
      <Skeleton className="h-9 w-48 max-w-full" />
      <Skeleton className="mt-4 h-11 w-full rounded-pill" />
      <div className="mt-5 flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    </Page>
  );
}
