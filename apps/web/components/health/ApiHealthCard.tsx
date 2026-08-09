import { HealthRecheckButton } from "@/components/health/HealthRecheckButton";
import {
  HEALTH_DEPENDENCY_KEYS,
  isFullyHealthy,
  type HealthResult,
} from "@/lib/api/health";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * Live state of the API and its dependencies.
 *
 * 🟡 "Redis is degraded" is a REAL state this product reports, not a
 * hypothetical: the write throttle fails open on a cache outage precisely so a
 * Redis blip cannot make the site read-only. So the card has three states, not
 * two, and the degraded one has to read as "the rest still works" rather than
 * as an outage.
 */
const DEPENDENCY_LABEL = {
  database: copy.status.database,
  redis: copy.status.redis,
} as const;

export function ApiHealthCard({ result }: { result: HealthResult }) {
  const healthy = result.ok && isFullyHealthy(result.data);
  const degraded = result.ok && !healthy;

  const label = !result.ok
    ? copy.status.unreachable
    : healthy
      ? copy.status.healthy
      : copy.status.degraded;

  const dot = !result.ok
    ? "bg-primary"
    : healthy
      ? "bg-band-awesome"
      : "bg-band-regular";

  return (
    <section className="rounded-2xl border border-border bg-card p-[18px]">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={cn("size-2.5 rounded-pill", dot)} />
        <h2 className="text-[17px] font-semibold">{label}</h2>
        <span className="ml-auto font-mono text-[11.5px] text-subtle-foreground tabular">
          <time dateTime={result.checkedAt}>{result.checkedAt.slice(11, 19)}</time>
        </span>
      </div>

      {result.ok ? (
        <ul className="mt-3.5 flex flex-col gap-2">
          {HEALTH_DEPENDENCY_KEYS.map((key) => {
            const dependency = result.data[key];
            return (
              <li
                key={key}
                className="flex items-center gap-2.5 rounded-lg bg-card-2 p-3"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 rounded-pill",
                    dependency.ok ? "bg-band-awesome" : "bg-band-regular",
                  )}
                />
                <span className="flex-1 text-[13.5px]">
                  {DEPENDENCY_LABEL[key]}
                </span>
                <span
                  className={cn(
                    "font-mono text-[12px] tabular",
                    dependency.ok ? "text-subtle-foreground" : "text-band-regular",
                  )}
                >
                  {dependency.ok
                    ? copy.status.dependencyOk
                    : copy.status.dependencyDown}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3.5 text-small text-subtle-foreground">
          {result.error.message}
        </p>
      )}

      {!result.ok ? (
        <p className="mt-2.5 text-[12.5px] text-faint-foreground">
          {copy.status.unreachableHint}
        </p>
      ) : null}

      {degraded ? (
        <p className="mt-2.5 text-[12.5px] text-subtle-foreground">
          {copy.status.redisDegradedToast}
        </p>
      ) : null}

      <div className="mt-4">
        <HealthRecheckButton />
      </div>
    </section>
  );
}
