/**
 * Performance budget enforcement.
 *
 * `scripts/perf-budgets.json` states what each route is allowed to cost. This
 * spec runs `scripts/benchmark.mjs` against the live servers and fails when a
 * route exceeds its budget, so an optimisation cannot be silently undone by a
 * later change.
 *
 * Two design rules, both learned from the contract suite:
 *
 *  1. It SKIPS when the servers are down. The unit suite has to work offline
 *     and on a laptop with nothing running.
 *  2. It must NOT skip when they are up. Reachability is probed here directly
 *     rather than inferred from the benchmark's exit code, because "the script
 *     exited non-zero" is exactly what a real breach looks like too.
 *
 * The measurement lives in the benchmark script, not here. One implementation,
 * so the number a developer sees in the terminal is the number CI enforces.
 *
 * Servers expected:
 *   API  http://localhost:8000   (BENCH_API_URL)
 *   web  http://localhost:3200   (BENCH_WEB_URL, a PRODUCTION build - a dev
 *                                 server compiles on demand and its timings
 *                                 mean nothing)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_ROOT = path.resolve(WEB_ROOT, "..", "..");
const BENCHMARK = path.join(REPO_ROOT, "scripts", "benchmark.mjs");

const API_URL = process.env.BENCH_API_URL ?? "http://localhost:8000";
const WEB_URL = process.env.BENCH_WEB_URL ?? "http://localhost:3200";

/** Enough for an honest median, few enough that CI does not crawl. */
const RUNS = 5;

interface BudgetRef {
  payloadKb: number;
  medianMs: number;
  why: string;
}

interface EvaluatedRoute {
  id: string;
  label: string;
  tier: string;
  status: number;
  ok: boolean;
  medianMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  kb: number | null;
  gzipKb: number | null;
  verdict: "pass" | "fail" | "waived" | "unbudgeted";
  budget?: BudgetRef;
  messages: string[];
}

interface BenchmarkReport {
  reachable: boolean;
  results: EvaluatedRoute[];
}

async function isUp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return response.status > 0;
  } catch {
    return false;
  }
}

const [apiUp, webUp] = await Promise.all([
  isUp(`${API_URL}/api/health`),
  isUp(WEB_URL),
]);
const serversUp = apiUp && webUp;

if (!serversUp) {
  console.warn(
    [
      "perf-budget: SKIPPED, the servers under test are not running.",
      `  API ${API_URL}  ${apiUp ? "up" : "DOWN"}`,
      `  web ${WEB_URL}  ${webUp ? "up" : "DOWN"}`,
      "  Start both and re-run to actually enforce the budgets.",
    ].join("\n"),
  );
}

/**
 * Run the harness once. Its exit code is deliberately ignored: a breach exits
 * non-zero, and the per-route assertions below are what should report it, with
 * the route name in the failure message.
 */
function runBenchmark(): BenchmarkReport {
  const result = spawnSync(
    process.execPath,
    [BENCHMARK, "--json", "--budgets", "--runs", String(RUNS)],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 240_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, BENCH_API_URL: API_URL, BENCH_WEB_URL: WEB_URL },
    },
  );

  const stdout = result.stdout ?? "";
  if (!stdout.trim()) {
    throw new Error(
      `scripts/benchmark.mjs produced no output (status ${result.status}):\n${result.stderr ?? ""}`,
    );
  }
  return JSON.parse(stdout) as BenchmarkReport;
}

const report = serversUp ? runBenchmark() : null;

describe.skipIf(!serversUp)("performance budgets", () => {
  it("measured every route it discovered", () => {
    expect(report).not.toBeNull();
    expect(report?.reachable).toBe(true);
    // If route discovery silently returned nothing, every per-route assertion
    // below would vacuously pass. Pin the floor instead.
    expect(report?.results.length ?? 0).toBeGreaterThanOrEqual(10);
  });

  const routes = report?.results ?? [];

  for (const route of routes) {
    it(`${route.id} is within budget (${route.label})`, () => {
      const detail = [
        `route:    ${route.label}`,
        `budget:   ${route.budget ? `${route.budget.payloadKb} KB / ${route.budget.medianMs} ms` : "(none)"}`,
        `measured: ${route.kb ?? "-"} KB / ${route.medianMs ?? "-"} ms median` +
          (route.minMs == null ? "" : ` (${route.minMs}-${route.maxMs} ms over ${RUNS} runs)`),
        `status:   ${route.status}`,
        ...route.messages.map((message) => `  ${message}`),
      ].join("\n");

      expect(route.verdict, detail).not.toBe("fail");
      expect(route.verdict, detail).not.toBe("unbudgeted");
    });
  }
});
