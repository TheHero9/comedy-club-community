/**
 * A real loopback HTTP server for exercising `lib/api/client.ts`.
 *
 * Why a real server rather than a stubbed `globalThis.fetch`:
 * the interesting rows in the test matrix (query serialization, Cyrillic
 * round-trips, per-verb behaviour, header composition, 204 handling, malformed
 * JSON) are all claims about *what actually went over the wire*. A stub can only
 * prove what the client believed it sent. A socket proves what the server got.
 *
 * The server listens on port 0, so the OS assigns a free port and nothing here
 * ever collides with the dev stack on :8000 or :3100.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { vi } from "vitest";

/** One request as the server actually received it. */
export interface RecordedRequest {
  method: string;
  /** Raw request target, e.g. `/api/x?a=1&a=2`. */
  rawUrl: string;
  path: string;
  query: URLSearchParams;
  /** Lower-cased header names, exactly as Node parsed them. */
  headers: Record<string, string>;
  /** Body decoded as UTF-8. Empty string when there was none. */
  rawBody: string;
}

export type MockHandler = (
  request: RecordedRequest,
  response: ServerResponse,
) => void | Promise<void>;

export interface MockApi {
  /** e.g. `http://127.0.0.1:53211` - no trailing slash. */
  origin: string;
  port: number;
  /** Every request the server has seen since the last `reset()`. */
  requests: RecordedRequest[];
  /** The most recent request. Throws when there was none, so a silent zero-request pass is impossible. */
  lastRequest(): RecordedRequest;
  setHandler(handler: MockHandler): void;
  reset(): void;
  close(): Promise<void>;
}

/** Default reply: a boring 200 JSON body. */
const defaultHandler: MockHandler = (_request, response) => {
  sendJson(response, 200, { ok: true });
};

/** Write a JSON body as UTF-8. The charset matters for the Cyrillic rows. */
export function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.byteLength),
  });
  response.end(body);
}

/** Write a body verbatim, so a test can send bytes that are not valid JSON. */
export function sendRaw(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  const bytes = Buffer.from(body, "utf8");
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": String(bytes.byteLength),
  });
  response.end(bytes);
}

/**
 * Hold a response open. Handlers must AWAIT this: the server auto-ends a
 * response once its handler resolves, so a fire-and-forget `setTimeout` would
 * be answered instantly with an empty 200 instead of stalling.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Write a status with no body at all (204 / 205). */
export function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status);
  response.end();
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
  } catch {
    // The client aborted mid-upload. The timeout and abort rows do this on
    // purpose, and a half-read body is not a test failure.
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startMockApi(): Promise<MockApi> {
  const requests: RecordedRequest[] = [];
  let handler: MockHandler = defaultHandler;

  const server: Server = createServer((request, response) => {
    // The timeout and abort rows deliberately kill the socket mid-flight. Without
    // these listeners Node would raise the resulting ECONNRESET as an unhandled
    // 'error' event and crash the worker.
    request.on("error", () => {});
    response.on("error", () => {});

    void (async () => {
      const rawUrl = request.url ?? "/";
      // A base is required to parse a relative target; it is never sent anywhere.
      const parsed = new URL(rawUrl, "http://mock.invalid");
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
      }

      const recorded: RecordedRequest = {
        method: request.method ?? "GET",
        rawUrl,
        path: parsed.pathname,
        query: parsed.searchParams,
        headers,
        rawBody: await readRequestBody(request),
      };
      requests.push(recorded);

      try {
        await handler(recorded, response);
      } catch {
        if (!response.headersSent) {
          sendJson(response, 500, { detail: "mock handler threw" });
        }
      }
      if (!response.writableEnded) response.end();
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  const port = address.port;

  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    requests,
    lastRequest() {
      const last = requests.at(-1);
      if (!last) {
        throw new Error("mock api recorded no request - the client never called it");
      }
      return last;
    },
    setHandler(next) {
      handler = next;
    },
    reset() {
      requests.length = 0;
      handler = defaultHandler;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

/**
 * An origin that is guaranteed to refuse connections: bind a port, learn its
 * number, then release it. Used for the "connection refused" row, which cannot
 * be simulated by a server that is listening.
 */
export async function closedPortOrigin(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return `http://127.0.0.1:${port}`;
}

export type ClientModule = typeof import("@/lib/api/client");
export type HealthModule = typeof import("@/lib/api/health");

/**
 * `API_BASE_URL` is evaluated once, at module load, so that Next can inline
 * `process.env.NEXT_PUBLIC_API_URL` into the client bundle. Every test that
 * needs a different base URL therefore needs a *fresh module instance*, which is
 * what `vi.resetModules()` plus a dynamic import buys us.
 *
 * Pass `undefined` to exercise the unset-variable fallback.
 */
export async function loadApiClient(baseUrl: string | undefined): Promise<ClientModule> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", baseUrl);
  return import("@/lib/api/client");
}

/** Same trick for the health binding, which closes over the module-level client. */
export async function loadHealthModule(baseUrl: string | undefined): Promise<HealthModule> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", baseUrl);
  return import("@/lib/api/health");
}
