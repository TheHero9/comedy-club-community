import { copy } from "@/lib/copy";

/**
 * The browse filter model.
 *
 * ⚠️ The design specifies five groups: ПОДРЕДБА, ВИД, ГОДИНА, КАНАЛ, УЧАСТНИК.
 * ГОДИНА is NOT implemented, and deliberately so: `/api/episodes` takes
 * channel, topic, person, kind, members_only, q, sort, limit and offset - there
 * is no year parameter, and the handoff is explicit that this is a visual layer
 * with no API changes. Filtering a paginated list client-side would produce a
 * page that says "показани 9 от 74" while showing something else, which is
 * worse than not offering the filter. It is listed in the handoff report as the
 * one design element that needs an API change to ship.
 *
 * Everything else lives in the URL, so a filtered view is shareable, indexable
 * and survives a reload.
 */
export type FilterGroup = "sort" | "kind" | "channel" | "person";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterGroupDef {
  group: FilterGroup;
  title: string;
  /** Chip prefix, e.g. "вид Стрийм". Sort chips carry no prefix. */
  chipPrefix: string;
  options: FilterOption[];
  /** Sort always has a value and cannot be toggled off. */
  required?: boolean;
}

export const DEFAULT_SORT = "newest";

/** Page size, and the step "Зареди още" adds. */
export const PAGE_SIZE = 9;

export const SORT_OPTIONS: FilterOption[] = [
  { value: "newest", label: copy.browse.sortNewest },
  { value: "oldest", label: copy.browse.sortOldest },
  { value: "top", label: copy.browse.sortTop },
  { value: "most_rated", label: copy.browse.sortMostRated },
];

export const KIND_OPTIONS: FilterOption[] = [
  { value: "video", label: copy.browse.kindVideo },
  { value: "stream", label: copy.browse.kindStream },
];

export interface ActiveFilters {
  sort: string;
  kind: string;
  channel: string;
  person: string;
  limit: number;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function readFilters(
  query: Record<string, string | string[] | undefined>,
): ActiveFilters {
  const sort = first(query.sort);
  const rawLimit = Number(first(query.limit));
  return {
    sort: SORT_OPTIONS.some((option) => option.value === sort) ? sort : DEFAULT_SORT,
    kind: KIND_OPTIONS.some((option) => option.value === first(query.kind))
      ? first(query.kind)
      : "",
    channel: first(query.channel),
    person: first(query.person),
    limit:
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 200)
        : PAGE_SIZE,
  };
}

/** Query params for `/api/episodes`, omitting everything unset. */
export function toApiQuery(filters: ActiveFilters) {
  return {
    sort: filters.sort,
    kind: filters.kind || undefined,
    channel: filters.channel || undefined,
    person: filters.person || undefined,
    limit: filters.limit,
    offset: 0,
  };
}

/** `?sort=top&kind=stream` for a set of filters, dropping defaults. */
export function toSearchParams(filters: ActiveFilters): string {
  const params = new URLSearchParams();
  if (filters.sort !== DEFAULT_SORT) params.set("sort", filters.sort);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.person) params.set("person", filters.person);
  if (filters.limit !== PAGE_SIZE) params.set("limit", String(filters.limit));
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export function isDefault(filters: ActiveFilters): boolean {
  return (
    filters.sort === DEFAULT_SORT &&
    filters.kind === "" &&
    filters.channel === "" &&
    filters.person === ""
  );
}
