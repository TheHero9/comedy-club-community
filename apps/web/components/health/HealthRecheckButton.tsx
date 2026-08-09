"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { getHealth, HEALTH_QUERY_KEY, isFullyHealthy } from "@/lib/api/health";
import { copy } from "@/lib/copy";

/**
 * Client Component. Proves the typed client works from the browser too, and is
 * the first consumer of the TanStack Query provider and the toaster.
 */
export function HealthRecheckButton() {
  const router = useRouter();

  const { refetch, isFetching } = useQuery({
    queryKey: HEALTH_QUERY_KEY,
    queryFn: ({ signal }) => getHealth({ signal }),
    // Fetch only when the user asks.
    enabled: false,
    retry: false,
    gcTime: 0,
  });

  async function handleRecheck() {
    const { data, error } = await refetch();

    if (error || !data) {
      notify.error(copy.status.recheckFailed);
      return;
    }

    if (isFullyHealthy(data)) {
      notify.success(copy.status.recheckSucceeded);
    } else {
      notify.warning(copy.status.recheckDegraded);
    }

    // Re-render the server-rendered card with the fresh snapshot.
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="md"
      onClick={handleRecheck}
      disabled={isFetching}
    >
      {isFetching ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-4" aria-hidden />
      )}
      {isFetching ? copy.status.rechecking : copy.status.recheck}
    </Button>
  );
}
