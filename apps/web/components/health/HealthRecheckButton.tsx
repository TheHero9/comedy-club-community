"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  getHealth,
  HEALTH_QUERY_KEY,
  isFullyHealthy,
} from "@/lib/api/health";
import { copy } from "@/lib/copy";

/**
 * Client Component. Proves the typed client works from the browser too, and is
 * the first consumer of the TanStack Query provider and the sonner toaster.
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
      toast.error(copy.health.recheckFailed);
      return;
    }

    if (isFullyHealthy(data)) {
      toast.success(copy.health.recheckSucceeded);
    } else {
      toast.warning(copy.health.recheckDegraded);
    }

    // Re-render the server-rendered card with the fresh snapshot.
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleRecheck}
      disabled={isFetching}
    >
      {isFetching ? (
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCwIcon className="size-4" aria-hidden />
      )}
      {isFetching ? copy.health.rechecking : copy.health.recheck}
    </Button>
  );
}
