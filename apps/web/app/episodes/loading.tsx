import { Page } from "@/components/shell/Page";
import { Skeleton } from "@/components/ui/skeleton";

/** See `app/search/loading.tsx` for why every route needs one of these. */
export default function EpisodesLoading() {
  return (
    <Page>
      <Skeleton className="h-9 w-56 max-w-full" />
      <Skeleton className="mt-4 h-11 w-full rounded-pill" />
      <div className="mt-5 flex flex-col gap-2.5">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-[104px] w-full rounded-2xl" />
        ))}
      </div>
    </Page>
  );
}
