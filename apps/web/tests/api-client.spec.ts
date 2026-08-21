/**
 * Matrix section 4 - the typed API client (`lib/api/client.ts`).
 *
 * Every case runs against a real loopback HTTP server (see `mock-api.ts`), so an
 * assertion about "what the client sent" is an assertion about bytes on a socket
 * rather than about a stub's bookkeeping.
 *
 * `API_BASE_URL` is a module-load constant, so tests that need a different base
 * URL re-import the module through `loadApiClient`. Every test is independent
 * and re-runnable in any order.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { copy } from "@/lib/copy";

import {
  closedPortOrigin,
  loadApiClient,
  loadHealthModule,
  sendEmpty,
  sendJson,
  sendRaw,
  sleep,
  startMockApi,
  type MockApi,
} from "./mock-api";

const CYRILLIC_QUERY = "Каспаров";
const CYRILLIC_TITLE = "Евровизия и шахматът - специален епизод";

let mock: MockApi;

beforeAll(async () => {
  mock = await startMockApi();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Fresh client module bound to the mock server. */
function client() {
  return loadApiClient(mock.origin);
}

describe("4.1-4.3 base URL and path resolution", () => {
  it("4.1 strips a trailing slash from NEXT_PUBLIC_API_URL", async () => {
    const { API_BASE_URL } = await loadApiClient("http://api.example.test/");
    expect(API_BASE_URL).toBe("http://api.example.test");
  });

  it("4.1 strips repeated trailing slashes", async () => {
    const { API_BASE_URL } = await loadApiClient("http://api.example.test///");
    expect(API_BASE_URL).toBe("http://api.example.test");
  });

  it("4.1 leaves a URL without a trailing slash untouched", async () => {
    const { API_BASE_URL } = await loadApiClient("http://api.example.test:9000");
    expect(API_BASE_URL).toBe("http://api.example.test:9000");
  });

  it("4.2 falls back to http://localhost:8000 when NEXT_PUBLIC_API_URL is unset", async () => {
    // Needs its own module instance: the constant is evaluated at import time.
    const { API_BASE_URL } = await loadApiClient(undefined);
    expect(API_BASE_URL).toBe("http://localhost:8000");
  });

  it("4.3 resolves a path with no leading slash", async () => {
    const { api } = await client();
    await api.get("api/health");
    expect(mock.lastRequest().path).toBe("/api/health");
  });

  it("4.3 resolves a path that already has a leading slash", async () => {
    const { api } = await client();
    await api.get("/api/health");
    expect(mock.lastRequest().path).toBe("/api/health");
  });
});

describe("4.4-4.10 HTTP error mapping", () => {
  const cases: Array<{ row: string; status: number; userMessage: string }> = [
    { row: "4.4", status: 401, userMessage: copy.errors.unauthorized },
    { row: "4.5", status: 403, userMessage: copy.errors.forbidden },
    { row: "4.6", status: 404, userMessage: copy.errors.notFound },
    { row: "4.7", status: 429, userMessage: copy.errors.rateLimited },
    { row: "4.8", status: 500, userMessage: copy.errors.server },
  ];

  for (const { row, status, userMessage } of cases) {
    it(`${row} maps ${status} to kind "http" with the right copy.errors message`, async () => {
      const { api, isApiError, ApiError } = await client();
      mock.setHandler((_request, response) => {
        sendJson(response, status, { detail: `boom ${status}` });
      });

      const caught = await api.get("/api/thing").then(
        () => null,
        (error: unknown) => error,
      );

      expect(caught).toBeInstanceOf(ApiError);
      expect(isApiError(caught)).toBe(true);
      const error = caught as InstanceType<typeof ApiError>;
      expect(error.kind).toBe("http");
      expect(error.status).toBe(status);
      expect(error.userMessage).toBe(userMessage);
    });
  }

  it("4.8 maps any 5xx, not just 500, to the server message", async () => {
    const { api, ApiError } = await client();
    mock.setHandler((_request, response) => sendJson(response, 503, { detail: "down" }));

    const error = (await api
      .get("/api/thing")
      .catch((caught: unknown) => caught)) as InstanceType<typeof ApiError>;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(503);
    expect(error.userMessage).toBe(copy.errors.server);
  });

  it("maps an unclassified 4xx to the generic message", async () => {
    const { api, ApiError } = await client();
    mock.setHandler((_request, response) => sendJson(response, 418, { detail: "teapot" }));

    const error = (await api
      .get("/api/thing")
      .catch((caught: unknown) => caught)) as InstanceType<typeof ApiError>;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(418);
    expect(error.userMessage).toBe(copy.errors.generic);
  });

  it("4.9 preserves the JSON error body the server sent", async () => {
    const { api, ApiError } = await client();
    const payload = { detail: "Not found", code: "episode_missing", extra: [1, 2, 3] };
    mock.setHandler((_request, response) => sendJson(response, 404, payload));

    const error = (await api
      .get("/api/episodes/nope")
      .catch((caught: unknown) => caught)) as InstanceType<typeof ApiError>;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.body).toEqual(payload);
  });

  it("4.10 records the method and the full URL for logging", async () => {
    const { api, ApiError } = await client();
    mock.setHandler((_request, response) => sendJson(response, 500, { detail: "x" }));

    const error = (await api
      .post("/api/ratings", { score: 9 })
      .catch((caught: unknown) => caught)) as InstanceType<typeof ApiError>;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.method).toBe("POST");
    expect(error.url).toBe(`${mock.origin}/api/ratings`);
    expect(error.message).toContain("POST");
    expect(error.message).toContain("500");
    expect(error.name).toBe("ApiError");
  });
});

describe("4.11-4.15 transport failures", () => {
  it('4.11 maps a refused connection to kind "network" with status 0', async () => {
    // Needs its own module instance: the base URL must point at a dead port.
    const dead = await closedPortOrigin();
    const { api, ApiError } = await loadApiClient(dead);

    const error = (await api
      .get("/api/health")
      .catch((caught: unknown) => caught)) as InstanceType<typeof ApiError>;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("network");
    expect(error.status).toBe(0);
    expect(error.userMessage).toBe(copy.errors.network);
  });

  it("4.12 keeps the original error as `cause` for logging", async () => {
    const dead = await closedPortOrigin();
    const { api, ApiError } = await loadApiClient(dead);

    const error = (await api
      .get("/api/health")
      .catch((caught: unknown) => caught)) as InstanceType<typeof ApiError>;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.cause).toBeDefined();
    expect(error.cause).not.toBe(error);
  });

  it('4.13 maps a timeoutMs expiry to kind "timeout"', async () => {
    const { api, ApiError } = await client();
    mock.setHandler(async (_request, response) => {
      await sleep(500);
      if (!response.writableEnded) sendJson(response, 200, { ok: true });
    });

    const error = (await api
      .get("/api/slow", { timeoutMs: 60 })
      .catch((caught: unknown) => caught)) as InstanceType<typeof ApiError>;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("timeout");
    expect(error.status).toBe(0);
    expect(error.userMessage).toBe(copy.errors.timeout);
  });

  it('4.14 maps a caller AbortSignal to kind "aborted", not "timeout"', async () => {
    const { api, ApiError } = await client();
    mock.setHandler(async (_request, response) => {
      await sleep(500);
      if (!response.writableEnded) sendJson(response, 200, { ok: true });
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const error = (await api
      .get("/api/slow", { signal: controller.signal })
      .catch((caught: unknown) => caught)) as InstanceType<typeof ApiError>;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("aborted");
    expect(error.status).toBe(0);
  });

  it('4.15 maps a malformed JSON body to kind "parse" and keeps the HTTP status', async () => {
    const { api, ApiError } = await client();
    mock.setHandler((_request, response) => {
      sendRaw(response, 200, "application/json; charset=utf-8", '{"not":json,');
    });

    const error = (await api
      .get("/api/broken")
      .catch((caught: unknown) => caught)) as InstanceType<typeof ApiError>;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("parse");
    expect(error.status).toBe(200);
    expect(error.userMessage).toBe(copy.errors.parse);
  });
});

describe("4.16-4.17 response body handling", () => {
  it("4.16 returns a text/plain body as a string", async () => {
    const { api } = await client();
    mock.setHandler((_request, response) => {
      sendRaw(response, 200, "text/plain; charset=utf-8", "pong");
    });

    await expect(api.get<string>("/api/ping")).resolves.toBe("pong");
  });

  it("4.17 resolves a 204 to null without trying to parse a body", async () => {
    const { api } = await client();
    mock.setHandler((_request, response) => sendEmpty(response, 204));

    await expect(api.delete<null>("/api/me/rating")).resolves.toBeNull();
  });

  it("resolves an empty 200 body to null rather than throwing", async () => {
    const { api } = await client();
    mock.setHandler((_request, response) => {
      sendRaw(response, 200, "application/json; charset=utf-8", "");
    });

    await expect(api.get<null>("/api/empty")).resolves.toBeNull();
  });

  it("parses a JSON object body into a plain value", async () => {
    const { api } = await client();
    mock.setHandler((_request, response) => sendJson(response, 200, { status: "ok", n: 3 }));

    await expect(api.get("/api/health")).resolves.toEqual({ status: "ok", n: 3 });
  });
});

describe("4.18-4.22 query serialization and Cyrillic round-trips", () => {
  it("4.18 stringifies numeric and boolean query values", async () => {
    const { api } = await client();
    await api.get("/api/episodes", { query: { limit: 24, offset: 0, members_only: true, rated: false } });

    const { query } = mock.lastRequest();
    expect(query.get("limit")).toBe("24");
    expect(query.get("offset")).toBe("0");
    expect(query.get("members_only")).toBe("true");
    expect(query.get("rated")).toBe("false");
  });

  it("4.19 drops undefined and null query values entirely", async () => {
    const { api } = await client();
    await api.get("/api/episodes", {
      query: { channel: "ivan-kirkov", topic: undefined, kind: null, sort: "newest" },
    });

    const { query, rawUrl } = mock.lastRequest();
    expect(query.has("topic")).toBe(false);
    expect(query.has("kind")).toBe(false);
    expect(rawUrl).not.toContain("topic");
    expect(rawUrl).not.toContain("undefined");
    expect(rawUrl).not.toContain("null");
    expect(query.get("channel")).toBe("ivan-kirkov");
    expect(query.get("sort")).toBe("newest");
  });

  it("4.20 repeats the key for an array query value, skipping holes", async () => {
    const { api } = await client();
    await api.get("/api/episodes", { query: { tag: ["a", "b", null, "c", undefined] } });

    expect(mock.lastRequest().query.getAll("tag")).toEqual(["a", "b", "c"]);
  });

  it("drops an array whose every entry is nullish", async () => {
    const { api } = await client();
    await api.get("/api/episodes", { query: { tag: [null, undefined] } });

    expect(mock.lastRequest().query.has("tag")).toBe(false);
  });

  it("4.21 round-trips a Cyrillic query value intact", async () => {
    const { api } = await client();
    await api.get("/api/search", { query: { q: CYRILLIC_QUERY } });

    const request = mock.lastRequest();
    // The wire form must be percent-encoded UTF-8, and decode back to the exact
    // Bulgarian string. A `?`-per-character result means an encoding bug.
    expect(request.rawUrl).toContain(encodeURIComponent(CYRILLIC_QUERY));
    expect(request.query.get("q")).toBe(CYRILLIC_QUERY);
    expect(request.query.get("q")).not.toContain("?");
  });

  it("4.22 round-trips a Cyrillic POST body intact", async () => {
    const { api } = await client();
    mock.setHandler((request, response) => {
      sendJson(response, 200, { echo: JSON.parse(request.rawBody) as unknown });
    });

    const result = await api.post<{ echo: { title: string } }>("/api/moments", {
      title: CYRILLIC_TITLE,
    });

    expect(JSON.parse(mock.lastRequest().rawBody)).toEqual({ title: CYRILLIC_TITLE });
    expect(result.echo.title).toBe(CYRILLIC_TITLE);
    expect(result.echo.title).not.toContain("?");
  });
});

describe("4.23-4.29 verbs and headers", () => {
  it("4.23 GET sends GET and no body", async () => {
    const { api } = await client();
    await api.get("/api/thing");
    expect(mock.lastRequest().method).toBe("GET");
    expect(mock.lastRequest().rawBody).toBe("");
  });

  it("4.24 POST sends POST with a JSON body", async () => {
    const { api } = await client();
    await api.post("/api/thing", { a: 1 });
    expect(mock.lastRequest().method).toBe("POST");
    expect(JSON.parse(mock.lastRequest().rawBody)).toEqual({ a: 1 });
  });

  it("4.25 PUT sends PUT with a JSON body", async () => {
    const { api } = await client();
    await api.put("/api/thing", { score: 8 });
    expect(mock.lastRequest().method).toBe("PUT");
    expect(JSON.parse(mock.lastRequest().rawBody)).toEqual({ score: 8 });
  });

  it("4.26 PATCH sends PATCH with a JSON body", async () => {
    const { api } = await client();
    await api.patch("/api/thing", { display_name: "x" });
    expect(mock.lastRequest().method).toBe("PATCH");
    expect(JSON.parse(mock.lastRequest().rawBody)).toEqual({ display_name: "x" });
  });

  it("4.27 DELETE sends DELETE and no body", async () => {
    const { api } = await client();
    mock.setHandler((_request, response) => sendEmpty(response, 204));
    await api.delete("/api/thing");
    expect(mock.lastRequest().method).toBe("DELETE");
    expect(mock.lastRequest().rawBody).toBe("");
  });

  it("request() honours an explicit method", async () => {
    const { api } = await client();
    await api.request("/api/thing", { method: "PUT", body: { a: 1 } });
    expect(mock.lastRequest().method).toBe("PUT");
  });

  it("4.28 sends Content-Type only when there is a body", async () => {
    const { api } = await client();

    await api.get("/api/thing");
    expect(mock.lastRequest().headers["content-type"]).toBeUndefined();

    await api.post("/api/thing", { a: 1 });
    expect(mock.lastRequest().headers["content-type"]).toBe("application/json");
  });

  it("4.29 always sends Accept: application/json", async () => {
    const { api } = await client();

    await api.get("/api/thing");
    expect(mock.lastRequest().headers.accept).toBe("application/json");

    await api.post("/api/thing", { a: 1 });
    expect(mock.lastRequest().headers.accept).toBe("application/json");

    await api.delete("/api/thing");
    expect(mock.lastRequest().headers.accept).toBe("application/json");
  });
});

describe("4.30-4.38 the auth seam and header composition", () => {
  it("4.30 bearerAuthHeader returns an Authorization header for a token", async () => {
    const { bearerAuthHeader } = await client();
    expect(bearerAuthHeader("abc123")).toEqual({ Authorization: "Bearer abc123" });
  });

  it("4.31 bearerAuthHeader returns {} for null, undefined and empty string", async () => {
    const { bearerAuthHeader } = await client();
    expect(bearerAuthHeader(null)).toEqual({});
    expect(bearerAuthHeader(undefined)).toEqual({});
    expect(bearerAuthHeader("")).toEqual({});
  });

  it("4.32 the default shared client sends no Authorization header", async () => {
    const { api } = await client();
    await api.get("/api/health");
    expect(mock.lastRequest().headers.authorization).toBeUndefined();
  });

  it("4.33 createApiClient({ getToken }) attaches a synchronously returned token", async () => {
    const { createApiClient } = await client();
    const authed = createApiClient({ getToken: () => "sync-token" });

    await authed.get("/api/me");
    expect(mock.lastRequest().headers.authorization).toBe("Bearer sync-token");
  });

  it("4.34 createApiClient({ getToken }) awaits an async token (the Clerk shape)", async () => {
    const { createApiClient } = await client();
    const authed = createApiClient({
      getToken: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return "async-token";
      },
    });

    await authed.get("/api/me");
    expect(mock.lastRequest().headers.authorization).toBe("Bearer async-token");
  });

  it("getToken is called once per request, not once per client", async () => {
    const { createApiClient } = await client();
    const getToken = vi.fn(() => "t");
    const authed = createApiClient({ getToken });

    await authed.get("/api/me");
    await authed.get("/api/me");

    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("a getToken returning null sends no Authorization header", async () => {
    const { createApiClient } = await client();
    const authed = createApiClient({ getToken: () => null });

    await authed.get("/api/me");
    expect(mock.lastRequest().headers.authorization).toBeUndefined();
  });

  it("4.35 a per-call token overrides the client token", async () => {
    const { createApiClient } = await client();
    const authed = createApiClient({ getToken: () => "client-token" });

    await authed.get("/api/me", { token: "call-token" });
    expect(mock.lastRequest().headers.authorization).toBe("Bearer call-token");
  });

  it("4.36 a per-call token of null suppresses the client token", async () => {
    const { createApiClient } = await client();
    const authed = createApiClient({ getToken: () => "client-token" });

    await authed.get("/api/public", { token: null });
    expect(mock.lastRequest().headers.authorization).toBeUndefined();
  });

  it("4.37 defaultHeaders are sent on every request from that client", async () => {
    const { createApiClient } = await client();
    const tagged = createApiClient({ defaultHeaders: { "X-Client": "web-test" } });

    await tagged.get("/api/a");
    expect(mock.lastRequest().headers["x-client"]).toBe("web-test");

    await tagged.post("/api/b", { a: 1 });
    expect(mock.lastRequest().headers["x-client"]).toBe("web-test");
  });

  it("4.38 per-call headers win over defaultHeaders", async () => {
    const { createApiClient } = await client();
    const tagged = createApiClient({ defaultHeaders: { "X-Client": "web-test" } });

    await tagged.get("/api/a", { headers: { "X-Client": "override" } });
    expect(mock.lastRequest().headers["x-client"]).toBe("override");
  });

  it("per-call headers cannot be clobbered by the auth seam", async () => {
    const { createApiClient } = await client();
    const authed = createApiClient({ getToken: () => "client-token" });

    await authed.get("/api/me", { headers: { Authorization: "Bearer explicit" } });
    expect(mock.lastRequest().headers.authorization).toBe("Bearer explicit");
  });
});

describe("4.39-4.40 toApiError normalization", () => {
  it("4.39 wraps a plain Error into an ApiError with network semantics", async () => {
    const { toApiError, ApiError } = await client();
    const original = new Error("socket exploded");

    const wrapped = toApiError(original, { method: "GET", url: "/api/x" });

    expect(wrapped).toBeInstanceOf(ApiError);
    expect(wrapped.kind).toBe("network");
    expect(wrapped.status).toBe(0);
    expect(wrapped.cause).toBe(original);
    expect(wrapped.userMessage).toBe(copy.errors.network);
  });

  it("4.39 classifies a TimeoutError DOMException as a timeout", async () => {
    const { toApiError } = await client();
    const wrapped = toApiError(new DOMException("too slow", "TimeoutError"), {
      method: "GET",
      url: "/api/x",
    });

    expect(wrapped.kind).toBe("timeout");
    expect(wrapped.userMessage).toBe(copy.errors.timeout);
  });

  it("4.39 classifies an AbortError DOMException as aborted", async () => {
    const { toApiError } = await client();
    const wrapped = toApiError(new DOMException("stopped", "AbortError"), {
      method: "GET",
      url: "/api/x",
    });

    expect(wrapped.kind).toBe("aborted");
    expect(wrapped.userMessage).toBe(copy.errors.generic);
  });

  it("4.40 is idempotent: an ApiError passes through as the same instance", async () => {
    const { toApiError, ApiError } = await client();
    const original = new ApiError({
      kind: "http",
      status: 404,
      method: "GET",
      url: "/api/x",
      message: "nope",
      userMessage: copy.errors.notFound,
    });

    const once = toApiError(original, { method: "POST", url: "/api/y" });
    const twice = toApiError(once, { method: "POST", url: "/api/y" });

    expect(once).toBe(original);
    expect(twice).toBe(original);
    // The passthrough must not rewrite the original context.
    expect(once.method).toBe("GET");
    expect(once.status).toBe(404);
  });

  it("isApiError rejects non-ApiError values", async () => {
    const { isApiError } = await client();
    expect(isApiError(new Error("plain"))).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError({ kind: "http", status: 500 })).toBe(false);
  });
});

describe("4.41-4.43 getHealthResult", () => {
  const healthyPayload = {
    status: "ok",
    database: { ok: true, detail: "select 1" },
    redis: { ok: true, detail: "PONG" },
  };

  it("4.41 returns ok:true with the payload when the API is up", async () => {
    mock.setHandler((_request, response) => sendJson(response, 200, healthyPayload));
    const { getHealthResult } = await loadHealthModule(mock.origin);

    const result = await getHealthResult();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a healthy result");
    expect(result.data.status).toBe("ok");
    expect(typeof result.checkedAt).toBe("string");
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
  });

  it("4.42 returns ok:false and never throws when the API is down", async () => {
    const dead = await closedPortOrigin();
    const { getHealthResult } = await loadHealthModule(dead);

    const result = await getHealthResult();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed result");
    expect(result.error.kind).toBe("network");
    expect(result.error.status).toBe(0);
    expect(result.error.message).toBe(copy.errors.network);
  });

  it("4.42 returns ok:false for an HTTP error rather than throwing", async () => {
    mock.setHandler((_request, response) => sendJson(response, 503, { detail: "down" }));
    const { getHealthResult } = await loadHealthModule(mock.origin);

    const result = await getHealthResult();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed result");
    expect(result.error.kind).toBe("http");
    expect(result.error.status).toBe(503);
  });

  /**
   * 4.43 - REGRESSION TEST.
   *
   * An `ApiError` instance carries a `cause` chain of native Error objects.
   * Handing one to a React Server Component broke React's dev-mode RSC debug
   * serialization (`chunk.reason.enqueueModel is not a function`) and hung the
   * request for 60 seconds. Nothing in typecheck, lint or build sees it.
   *
   * The invariant: what `getHealthResult` hands the render tree is a PLAIN,
   * fully JSON-serializable object - never an Error.
   */
  it("4.43 hands React a plain serializable object, never an Error instance", async () => {
    const dead = await closedPortOrigin();
    const { getHealthResult } = await loadHealthModule(dead);

    const result = await getHealthResult();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed result");

    const summary = result.error;

    expect(summary).not.toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(summary)).toBe(Object.prototype);
    expect(summary.constructor).toBe(Object);
    expect(Object.keys(summary).sort()).toEqual(["kind", "message", "status"]);
    expect("cause" in summary).toBe(false);
    expect("stack" in summary).toBe(false);
    // A JSON round trip must be lossless - that is exactly what RSC does.
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
    for (const value of Object.values(summary)) {
      expect(["string", "number"]).toContain(typeof value);
    }
    // The whole result, not just the error branch, has to survive the trip.
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("4.43 the success branch is equally plain", async () => {
    mock.setHandler((_request, response) => sendJson(response, 200, healthyPayload));
    const { getHealthResult } = await loadHealthModule(mock.origin);

    const result = await getHealthResult();
    expect(result.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("isFullyHealthy reflects every dependency, not just the overall status", async () => {
    const { isFullyHealthy } = await loadHealthModule(mock.origin);

    expect(
      isFullyHealthy({
        status: "ok",
        database: { ok: true, detail: "" },
        redis: { ok: true, detail: "" },
        // The deployed commit. Present but irrelevant here - health is about
        // dependencies, and a version string must never sway the verdict.
        version: "73c700f",
      }),
    ).toBe(true);

    expect(
      isFullyHealthy({
        status: "ok",
        database: { ok: true, detail: "" },
        redis: { ok: false, detail: "connection refused" },
        version: "73c700f",
      }),
    ).toBe(false);
  });
});

describe("4.44-4.50 a write never goes out anonymous", () => {
  /**
   * 🚨 THE REGRESSION THESE EXIST FOR. On 2026-08-20 two cast submissions left
   * this client with no Authorization header, because `viewerToken()` returns
   * null on every failure it can hit (Clerk not booted, session expired in a
   * tab left open, an offline refresh). The API answered 401 - correctly - and
   * the member's typed cast was gone.
   *
   * `null` is the RIGHT answer for a read: an anonymous request beats a crash.
   * It is the wrong answer for a write, and the difference is what these pin.
   *
   * Every row asserts against `mock.requests.length`, so "the request was never
   * sent" is a claim about bytes on a socket rather than about a stub.
   */
  it("4.44 refuses a POST when getToken yields null, and sends NOTHING", async () => {
    const { createApiClient, isApiError } = await client();
    const authed = createApiClient({ getToken: () => null });

    await expect(authed.post("/api/episodes/uA41ekQ4IEE/moments", { label: "x" })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.kind === "unauthenticated" && error.status === 0,
    );
    // The point of the guard: no round trip at all.
    expect(mock.requests).toHaveLength(0);
  });

  it("4.45 refuses every unsafe verb, not just POST", async () => {
    const { createApiClient } = await client();
    const authed = createApiClient({ getToken: async () => null });

    await expect(authed.put("/api/me/avatar", {})).rejects.toThrow();
    await expect(authed.patch("/api/me", {})).rejects.toThrow();
    await expect(authed.delete("/api/moments/1")).rejects.toThrow();
    expect(mock.requests).toHaveLength(0);
  });

  it("4.46 still sends a GET with no token - reads stay anonymous-capable", async () => {
    // 🚨 The guard must not turn every signed-out read into an error. The
    // episode page fetches viewer state opportunistically and a thrown read
    // inside a Server Component is a 500 page.
    const { createApiClient } = await client();
    const authed = createApiClient({ getToken: () => null });

    await authed.get("/api/episodes/uA41ekQ4IEE/me");
    expect(mock.requests).toHaveLength(1);
    expect(mock.lastRequest().headers.authorization).toBeUndefined();
  });

  it("4.47 sends the write normally once a token exists", async () => {
    const { createApiClient } = await client();
    const authed = createApiClient({ getToken: () => "real-token" });

    await authed.post("/api/episodes/uA41ekQ4IEE/moments", { label: "x" });
    expect(mock.requests).toHaveLength(1);
    expect(mock.lastRequest().headers.authorization).toBe("Bearer real-token");
  });

  it("4.48 leaves a client with NO getToken alone", async () => {
    // ⚠️ The discriminator is "was this client built to carry an identity",
    // not "is there a token". The public `api` client has no getToken, so its
    // requests are anonymous by design and must not start throwing.
    const { createApiClient } = await client();
    const anonymous = createApiClient();

    await anonymous.post("/api/anything", { a: 1 });
    expect(mock.requests).toHaveLength(1);
  });

  it("4.49 honours an explicit per-call token even when getToken is null", async () => {
    const { createApiClient } = await client();
    const authed = createApiClient({ getToken: () => null });

    await authed.post("/api/episodes/x/moments", { label: "y" }, { token: "explicit" });
    expect(mock.lastRequest().headers.authorization).toBe("Bearer explicit");
  });

  it("4.50 carries the localised 'your text is kept' message, not the 401 one", async () => {
    // 🚨 Deliberately NOT copy.errors.unauthorized. That answers a 401 the
    // server sent; this answers a write we refused, and the sentence the
    // member needs is that nothing was thrown away.
    const { createApiClient } = await client();
    const authed = createApiClient({ getToken: () => null });

    // ⚠️ `rejects`, never a `.catch()` carrying the assertions. A catch block
    // that never runs is a test that passes because nothing was checked - the
    // exact shape `e2e/fixtures.ts` and this repo's testing rules ban.
    await expect(authed.post("/api/reports", { reason: "x" })).rejects.toMatchObject({
      kind: "unauthenticated",
      userMessage: copy.errors.signedOut,
    });
    expect(copy.errors.signedOut).not.toBe(copy.errors.unauthorized);
  });
});
