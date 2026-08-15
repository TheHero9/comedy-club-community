import type { Metadata } from "next";

import { ApiHealthCard } from "@/components/health/ApiHealthCard";
import { Page } from "@/components/shell/Page";
import { getHealthResult } from "@/lib/api/health";
import { getCopy } from "@/lib/locale";

/**
 * Health is a live reading, so this route is never prerendered. It also keeps
 * `next build` working when the API is not running.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const copy = await getCopy();
  return {
    title: copy.status.title,
    description: copy.app.description,
    robots: { index: false, follow: false },
  };
}

export default async function StatusPage() {
  const copy = await getCopy();
  const health = await getHealthResult();

  return (
    <Page className="max-w-[652px]">
      <h1 className="text-h1">{copy.status.title}</h1>
      <div className="mt-5">
        <ApiHealthCard result={health} />
      </div>
    </Page>
  );
}
