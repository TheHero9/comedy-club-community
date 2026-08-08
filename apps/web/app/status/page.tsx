import type { Metadata } from "next";

import { ApiHealthCard } from "@/components/health/ApiHealthCard";
import { getHealthResult } from "@/lib/api/health";
import { copy } from "@/lib/copy";

/**
 * Health is a live reading, so this route is never prerendered. It also keeps
 * `next build` working when the API is not running.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: copy.home.systemSectionTitle,
  description: copy.health.cardDescription,
  robots: { index: false, follow: false },
};

export default async function StatusPage() {
  const health = await getHealthResult();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-balance sm:text-3xl">
          {copy.home.systemSectionTitle}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {copy.health.cardDescription}
        </p>
      </header>

      <ApiHealthCard result={health} />
    </main>
  );
}
