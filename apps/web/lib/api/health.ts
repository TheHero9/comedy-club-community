/**
 * `/api/health` endpoint binding.
 *
 * The return type is pulled from the generated OpenAPI operation, so if the
 * Django schema changes the type breaks here first.
 */
import type { Schema } from "@ccc/api-types";

import {
  api,
  toApiError,
  type ApiErrorKind,
  type ApiRequestOptions,
} from "@/lib/api/client";

export type HealthStatus = Schema<"HealthOut">;
export type DependencyStatus = Schema<"DependencyStatus">;

/** Dependency keys the UI knows how to render, derived from the schema. */
export const HEALTH_DEPENDENCY_KEYS = ["database", "redis"] as const;
export type HealthDependencyKey = (typeof HEALTH_DEPENDENCY_KEYS)[number];

export const HEALTH_PATH = "/api/health";
export const HEALTH_QUERY_KEY = ["health"] as const;

/** Throws an ApiError on any failure. */
export function getHealth(
  options?: Pick<ApiRequestOptions, "signal" | "timeoutMs">,
): Promise<HealthStatus> {
  return api.get<HealthStatus>(HEALTH_PATH, {
    ...options,
    // Health is never worth caching. Always ask the API.
    cache: "no-store",
  });
}

/**
 * Plain, fully serializable description of a failed call.
 *
 * An `ApiError` instance must never be handed to a React component: it carries
 * a `cause` chain of native Error objects, and React's dev-mode RSC debug
 * channel cannot serialize that. Server Components render this instead.
 */
export interface HealthErrorSummary {
  kind: ApiErrorKind;
  status: number;
  /** Safe to show a user. Comes from `copy.errors`. */
  message: string;
}

export type HealthResult =
  | { ok: true; data: HealthStatus; checkedAt: string }
  | { ok: false; error: HealthErrorSummary; checkedAt: string };

/**
 * Non-throwing variant for Server Components: a dead API should render an
 * error state, not blow up the whole route.
 */
export async function getHealthResult(
  options?: Pick<ApiRequestOptions, "signal" | "timeoutMs">,
): Promise<HealthResult> {
  const checkedAt = new Date().toISOString();

  try {
    const data = await getHealth(options);
    return { ok: true, data, checkedAt };
  } catch (caught) {
    const error = toApiError(caught, { method: "GET", url: HEALTH_PATH });
    return {
      ok: false,
      error: {
        kind: error.kind,
        status: error.status,
        message: error.userMessage,
      },
      checkedAt,
    };
  }
}

/** True only when the API answered and every dependency reported up. */
export function isFullyHealthy(status: HealthStatus): boolean {
  return HEALTH_DEPENDENCY_KEYS.every((key) => status[key].ok);
}
