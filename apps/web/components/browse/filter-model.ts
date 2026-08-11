import { copy } from "@/lib/copy";
import { stripControlCharacters } from "@/lib/sanitize";

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

/**
 * 🚨 The API's own ceiling: `MAX_LIMIT = 100` in `podcast/api/public.py`, where
 * `limit` is declared `Query(24, ge=1, le=MAX_LIMIT)`.
 *
 * This constant used to be 200 here, and the mismatch was a real 500. Anything
 * above 100 was forwarded verbatim, Django-Ninja rejected it with a 422, the
 * server component threw, and the page rendered an error. It was not only
 * reachable by hand-editing the URL: "Зареди още" adds PAGE_SIZE to `limit` on
 * every click, so the ELEVENTH click (9 -> 108) crossed the ceiling and served
 * a 500 to an ordinary user browsing a catalogue of 1,393 episodes.
 *
 * If the API's MAX_LIMIT ever moves, this must move with it -
 * `tests/filter-model.spec.ts` parses the Python constant and fails on drift.
 */
export const MAX_API_LIMIT = 100;

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

/**
 * `sort` and `kind` are allow-listed below, but `channel` and `person` are
 * forwarded to the API verbatim - they are slugs, and the app does not hold the
 * list of valid ones on this code path.
 *
 * 🚨 So they are stripped of C0/C1 control characters first. A NUL byte is
 * legal in a URL (`%00`) and reaches the API as an ordinary string; the API now
 * rejects it with a 400, but a 400 from a server component is still an
 * unhandled throw and a 500 page. Removing the character here means a URL a
 * fuzzer produced degrades into an empty result instead of an error.
 *
 * 🇧🇬 The range is control characters ONLY. Cyrillic is far above it and passes
 * through untouched, which the tests pin - a filter that ate Bulgarian slugs
 * would break the actual product.
 */
const sanitizeSlug = stripControlCharacters;

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
    channel: sanitizeSlug(first(query.channel)),
    person: sanitizeSlug(first(query.person)),
    // 🚨 `Math.floor` is not cosmetic. `Number("2.5")` is finite and positive,
    // so a hand-typed `?limit=2.5` used to be forwarded as a float, which the
    // API's `int` parameter rejects with a 422 - and the server component threw
    // rather than degrading, so the page answered 500.
    limit:
      Number.isFinite(rawLimit) && rawLimit >= 1
        ? Math.min(Math.floor(rawLimit), MAX_API_LIMIT)
        : PAGE_SIZE,
  };
}

/** True once "load more" has nothing left to ask the API for. */
export function isAtLimitCeiling(filters: ActiveFilters): boolean {
  return filters.limit >= MAX_API_LIMIT;
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
