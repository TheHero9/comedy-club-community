import {
  ActivityIcon,
  CircleCheckIcon,
  CircleXIcon,
  DatabaseIcon,
  PlugZapIcon,
  ServerIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

import { HealthRecheckButton } from "@/components/health/HealthRecheckButton";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { API_BASE_URL } from "@/lib/api/client";
import {
  HEALTH_DEPENDENCY_KEYS,
  HEALTH_PATH,
  isFullyHealthy,
  type HealthDependencyKey,
  type HealthResult,
} from "@/lib/api/health";
import { copy } from "@/lib/copy";

/**
 * Semantic dependency key to icon. The API sends keys, never glyphs; the
 * mapping to an icon belongs here in the component layer.
 */
const DEPENDENCY_ICONS: Record<HealthDependencyKey, LucideIcon> = {
  database: DatabaseIcon,
  redis: ServerIcon,
};

function DependencyRow({
  dependencyKey,
  ok,
  detail,
}: {
  dependencyKey: HealthDependencyKey;
  ok: boolean;
  detail: string;
}) {
  const Icon = DEPENDENCY_ICONS[dependencyKey];

  return (
    <div className="flex items-center gap-3 py-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {copy.health.dependencies[dependencyKey]}
        </p>
        {detail ? (
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </div>
      <Badge variant={ok ? "secondary" : "destructive"} className="shrink-0 gap-1">
        {ok ? (
          <CircleCheckIcon className="size-3" aria-hidden />
        ) : (
          <CircleXIcon className="size-3" aria-hidden />
        )}
        {ok ? copy.health.dependencyUp : copy.health.dependencyDown}
      </Badge>
    </div>
  );
}

function OverallBadge({ result }: { result: HealthResult }) {
  if (!result.ok) {
    return (
      <Badge variant="destructive" className="gap-1">
        <PlugZapIcon className="size-3" aria-hidden />
        {copy.health.overallUnreachable}
      </Badge>
    );
  }

  if (!isFullyHealthy(result.data)) {
    return (
      <Badge variant="outline" className="gap-1">
        <TriangleAlertIcon className="size-3" aria-hidden />
        {copy.health.overallDegraded}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1">
      <CircleCheckIcon className="size-3" aria-hidden />
      {copy.health.overallHealthy}
    </Badge>
  );
}

/**
 * Server Component. Renders the health snapshot fetched on the server so the
 * page is meaningful with JavaScript disabled.
 */
export function ApiHealthCard({ result }: { result: HealthResult }) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ActivityIcon className="size-4 shrink-0" aria-hidden />
          {copy.health.cardTitle}
        </CardTitle>
        <CardDescription>{copy.health.cardDescription}</CardDescription>
        <CardAction>
          <OverallBadge result={result} />
        </CardAction>
      </CardHeader>

      <CardContent>
        {result.ok ? (
          <div className="divide-y divide-border">
            {HEALTH_DEPENDENCY_KEYS.map((key) => (
              <DependencyRow
                key={key}
                dependencyKey={key}
                ok={result.data[key].ok}
                detail={result.data[key].detail}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg bg-destructive/10 p-3">
            <TriangleAlertIcon
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden
            />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{result.error.message}</p>
              <p className="text-xs break-words text-muted-foreground">
                {copy.health.unreachableHint}
              </p>
            </div>
          </div>
        )}

        <Separator className="my-3" />

        <dl className="space-y-1 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-medium">{copy.health.endpointLabel}</dt>
            <dd className="break-all font-mono">
              {API_BASE_URL}
              {HEALTH_PATH}
            </dd>
          </div>
          <div>
            <dd>{copy.health.checkedAt(result.checkedAt)}</dd>
          </div>
        </dl>
      </CardContent>

      <CardFooter>
        <HealthRecheckButton />
      </CardFooter>
    </Card>
  );
}
