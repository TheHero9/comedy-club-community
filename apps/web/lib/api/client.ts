/**
 * Typed fetch wrapper around the Django-Ninja API.
 *
 * Design constraints:
 * - Works unchanged in Server Components, Route Handlers and Client Components.
 *   It only uses the global `fetch`, which exists in both runtimes.
 * - Every failure surfaces as one shape: `ApiError`. Callers never have to
 *   distinguish a thrown TypeError from a 500.
 * - Response types come from `@ccc/api-types`, which is generated from the
 *   API's OpenAPI schema. No API shape is ever hand-written.
 * - Auth is a seam, not an implementation. Wave 8 supplies a `getToken`
 *   function to `createApiClient`; nothing else has to change.
 */
import type { ApiOperations, OperationResponse } from "@ccc/api-types";

import { copy } from "@/lib/copy";

/** Default when NEXT_PUBLIC_API_URL is unset, matching docker-compose local dev. */
const FALLBACK_API_URL = "http://localhost:8000";

/**
 * Read directly off `process.env` so Next can inline the value into the client
 * bundle at build time. Destructuring or dynamic access would break inlining.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? FALLBACK_API_URL
).replace(/\/+$/, "");

/** Requests give up after this long unless the caller overrides it. */
const DEFAULT_TIMEOUT_MS = 10_000;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Machine-readable classification carried by every ApiError. */
export type ApiErrorKind =
  | "network"
  | "timeout"
  | "aborted"
  | "http"
  | "parse";

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

/**
 * Next.js fetch options. Typed locally rather than imported so this module has
 * no framework dependency and stays usable from a plain browser context.
 */
export interface NextFetchOptions {
  revalidate?: number | false;
  tags?: string[];
}

export interface ApiRequestOptions {
  method?: HttpMethod;
  /** Serialized as JSON. Omit for GET/DELETE. */
  body?: unknown;
  query?: QueryParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Milliseconds before the request is aborted. Pass `false` to disable. */
  timeoutMs?: number | false;
  cache?: RequestCache;
  next?: NextFetchOptions;
  /**
   * Bearer token for this single call. Usually supplied by the client factory
   * instead, see `createApiClient`.
   */
  token?: string | null;
}

/** The one error shape the whole app deals with. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number;
  readonly method: HttpMethod;
  readonly url: string;
  /** Parsed response body, when there was one. */
  readonly body: unknown;
  /** Message safe to show a user. Comes from `copy.errors`. */
  readonly userMessage: string;

  constructor(init: {
    kind: ApiErrorKind;
    status: number;
    method: HttpMethod;
    url: string;
    body?: unknown;
    message: string;
    userMessage: string;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status;
    this.method = init.method;
    this.url = init.url;
    this.body = init.body;
    this.userMessage = init.userMessage;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * Normalize anything thrown during a request into an ApiError, so callers in
 * both runtimes only ever handle one type.
 */
export function toApiError(
  error: unknown,
  context: { method: HttpMethod; url: string },
): ApiError {
  if (isApiError(error)) {
    return error;
  }

  const isAbort =
    error instanceof DOMException && error.name === "AbortError";
  const isTimeout =
    error instanceof DOMException && error.name === "TimeoutError";

  if (isTimeout) {
    return new ApiError({
      kind: "timeout",
      status: 0,
      method: context.method,
      url: context.url,
      message: `Request timed out: ${context.method} ${context.url}`,
      userMessage: copy.errors.timeout,
      cause: error,
    });
  }

  if (isAbort) {
    return new ApiError({
      kind: "aborted",
      status: 0,
      method: context.method,
      url: context.url,
      message: `Request aborted: ${context.method} ${context.url}`,
      userMessage: copy.errors.generic,
      cause: error,
    });
  }

  return new ApiError({
    kind: "network",
    status: 0,
    method: context.method,
    url: context.url,
    message: `Network request failed: ${context.method} ${context.url}`,
    userMessage: copy.errors.network,
    cause: error,
  });
}

function userMessageForStatus(status: number): string {
  if (status === 401) return copy.errors.unauthorized;
  if (status === 403) return copy.errors.forbidden;
  if (status === 404) return copy.errors.notFound;
  if (status === 429) return copy.errors.rateLimited;
  if (status >= 500) return copy.errors.server;
  return copy.errors.generic;
}

function buildUrl(path: string, query?: QueryParams): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${API_BASE_URL}${normalizedPath}`);

  if (query) {
    for (const [key, rawValue] of Object.entries(query)) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        if (value === undefined || value === null) continue;
        url.searchParams.append(key, String(value));
      }
    }
  }

  return url.toString();
}

/**
 * Auth seam. Returns the Authorization header for a token, or nothing when
 * there is no token. Wave 8 (Clerk) is the first caller with a real token.
 */
export function bearerAuthHeader(
  token: string | null | undefined,
): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Combine caller `signal` with a timeout without leaking either. */
function resolveSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | false,
): AbortSignal | undefined {
  if (timeoutMs === false) return signal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204 || response.status === 205) return null;

  const text = await response.text();
  if (text.length === 0) return null;
  if (!contentType.includes("json")) return text;

  return JSON.parse(text) as unknown;
}

export type TokenProvider = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

export interface ApiClientOptions {
  /**
   * Called once per request. Server Components will pass a Clerk server-side
   * token getter; Client Components will pass the browser equivalent.
   */
  getToken?: TokenProvider;
  /** Headers merged into every request from this client. */
  defaultHeaders?: Record<string, string>;
}

export interface ApiClient {
  request<TResponse>(path: string, options?: ApiRequestOptions): Promise<TResponse>;
  get<TResponse>(
    path: string,
    options?: Omit<ApiRequestOptions, "method" | "body">,
  ): Promise<TResponse>;
  post<TResponse>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, "method" | "body">,
  ): Promise<TResponse>;
  put<TResponse>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, "method" | "body">,
  ): Promise<TResponse>;
  patch<TResponse>(
    path: string,
    body?: unknown,
    options?: Omit<ApiRequestOptions, "method" | "body">,
  ): Promise<TResponse>;
  delete<TResponse>(
    path: string,
    options?: Omit<ApiRequestOptions, "method" | "body">,
  ): Promise<TResponse>;
}

export function createApiClient(clientOptions: ApiClientOptions = {}): ApiClient {
  async function request<TResponse>(
    path: string,
    options: ApiRequestOptions = {},
  ): Promise<TResponse> {
    const method = options.method ?? "GET";
    const url = buildUrl(path, options.query);
    const hasBody = options.body !== undefined;

    const token =
      options.token !== undefined
        ? options.token
        : ((await clientOptions.getToken?.()) ?? null);

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...clientOptions.defaultHeaders,
      ...bearerAuthHeader(token),
      ...options.headers,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(options.body) : undefined,
        signal: resolveSignal(
          options.signal,
          options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ),
        cache: options.cache,
        // `next` is ignored outside the Next.js server runtime.
        next: options.next,
      } as RequestInit);
    } catch (error) {
      throw toApiError(error, { method, url });
    }

    let body: unknown;
    try {
      body = await readBody(response);
    } catch (error) {
      throw new ApiError({
        kind: "parse",
        status: response.status,
        method,
        url,
        message: `Could not parse response body: ${method} ${url}`,
        userMessage: copy.errors.parse,
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ApiError({
        kind: "http",
        status: response.status,
        method,
        url,
        body,
        message: `${method} ${url} responded ${response.status}`,
        userMessage: userMessageForStatus(response.status),
      });
    }

    return body as TResponse;
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: "GET" }),
    post: (path, body, options) =>
      request(path, { ...options, method: "POST", body }),
    put: (path, body, options) =>
      request(path, { ...options, method: "PUT", body }),
    patch: (path, body, options) =>
      request(path, { ...options, method: "PATCH", body }),
    delete: (path, options) => request(path, { ...options, method: "DELETE" }),
  };
}

/**
 * The shared anonymous client. Safe in Server and Client Components.
 * Authenticated calls should use a client built by `createApiClient` with a
 * `getToken` provider once Wave 8 lands.
 */
export const api = createApiClient();

/**
 * Helper for endpoint modules: ties a call to a generated operationId so the
 * return type comes straight from the OpenAPI schema.
 */
export type ApiResponseOf<TOperation extends keyof ApiOperations> =
  OperationResponse<TOperation>;
