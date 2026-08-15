#!/usr/bin/env node
/**
 * Performance benchmark harness (Lane 4).
 *
 * Measures every hot route on BOTH tiers - the Django-Ninja API and the Next.js
 * web app - and reports a warm MEDIAN latency plus the payload size, so an
 * optimisation can be proven and a regression can be caught.
 *
 * Why a median of N and not a single sample: a single warm request on a dev
 * laptop swings by tens of milliseconds depending on what else is running. One
 * number is not a measurement, it is an anecdote. Every route here is warmed
 * first (results discarded), then timed `--runs` times, and the report carries
 * the min and max alongside the median so the spread is visible instead of
 * being averaged away.
 *
 * Two size columns are reported and they mean different things:
 *   kb      decoded bytes - what the browser parses. This is what the app
 *           actually costs in memory and in hydration/parse work, and it is the
 *           dimension the budgets are set on because it is deterministic.
 *   gzipKb  the same body run through gzip locally, as a stand-in for what
 *           crosses a 4G link. Informational only: the server may use brotli
 *           and a different level, so this is an estimate, never a claim about
 *           the wire.
 *
 * Usage:
 *   node scripts/benchmark.mjs
 *   node scripts/benchmark.mjs --runs 9
 *   node scripts/benchmark.mjs --json
 *   node scripts/benchmark.mjs --save perf-baseline.json
 *   node scripts/benchmark.mjs --compare perf-baseline.json
 *   node scripts/benchmark.mjs --budgets            # exit 1 on a breach
 *   node scripts/benchmark.mjs --json --budgets     # what the Vitest test runs
 *
 * Options / environment:
 *   --api-url <url>   BENCH_API_URL   default http://localhost:8000
 *   --web-url <url>   BENCH_WEB_URL   default http://localhost:3200
 *   --runs <n>        BENCH_RUNS      default 7   (minimum 5)
 *   --warmup <n>      BENCH_WARMUP    default 2
 *   --only <substr>   only measure routes whose id contains <substr>
 *   --timeout <ms>    BENCH_TIMEOUT   default 30000 per request
 *
 * Exit codes:
 *   0  measured successfully (and, with --budgets, everything is within budget)
 *   1  a budget was breached, or a comparison found a regression over --threshold
 *   2  a server was unreachable, so nothing could be measured
 *   3  a route failed (non-2xx or a transport error)
 *
 * 🚨 Every URL is built here in node with URLSearchParams / encodeURIComponent.
 * NEVER pass a Cyrillic query through a shell argument on this machine: Git Bash
 * mangles non-ASCII argv into `????`, the search tokenises to nothing, and the
 * endpoint cheerfully returns every document. That looks exactly like a
 * catastrophic relevance bug and is not one.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const EXIT_OK = 0;
export const EXIT_BUDGET_BREACH = 1;
export const EXIT_UNREACHABLE = 2;
export const EXIT_ROUTE_FAILED = 3;

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
export const BUDGETS_PATH = path.join(REPO_ROOT, "scripts", "perf-budgets.json");

/**
 * A real Bulgarian query against real data. Kept as a source literal precisely
 * so it never travels through argv. See the header note.
 */
export const SEARCH_QUERY = "Каспаров";

/**
 * A deliberately BROAD query, benchmarked alongside the narrow one.
 *
 * 🚨 `Каспаров` matches one episode, so it measures an almost empty results
 * page. Sampling only that hid a real regression: wiring transcript results in
 * took a full page from ~101 KB to ~158 KB while this benchmark still reported
 * a comfortable 58 KB, because the sample query never filled the page. A budget
 * is only worth what its worst sampled case is worth.
 */
export const SEARCH_QUERY_BROAD = "ергена";

const DEFAULTS = {
  apiUrl: process.env.BENCH_API_URL ?? "http://localhost:8000",
  webUrl: process.env.BENCH_WEB_URL ?? "http://localhost:3200",
  runs: Number(process.env.BENCH_RUNS ?? 7),
  warmup: Number(process.env.BENCH_WARMUP ?? 2),
  timeout: Number(process.env.BENCH_TIMEOUT ?? 30_000),
};

/** A median of fewer than 5 samples is still an anecdote. */
const MIN_RUNS = 5;

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    ...DEFAULTS,
    json: false,
    budgets: false,
    save: null,
    compare: null,
    only: null,
    threshold: 20,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--api-url":
        options.apiUrl = next();
        break;
      case "--web-url":
        options.webUrl = next();
        break;
      case "--runs":
        options.runs = Number(next());
        break;
      case "--warmup":
        options.warmup = Number(next());
        break;
      case "--timeout":
        options.timeout = Number(next());
        break;
      case "--only":
        options.only = next();
        break;
      case "--threshold":
        options.threshold = Number(next());
        break;
      case "--save":
        options.save = next();
        break;
      case "--compare":
        options.compare = next();
        break;
      case "--json":
        options.json = true;
        break;
      case "--budgets":
        options.budgets = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.runs) || options.runs < MIN_RUNS) {
    throw new Error(`--runs must be at least ${MIN_RUNS} (got ${options.runs})`);
  }
  return options;
}

// ---------------------------------------------------------------------------
// URL building - always encoded, never string-concatenated
// ---------------------------------------------------------------------------

/** Join a base and a path, percent-encoding each path segment. */
function buildUrl(base, segments, query) {
  const encoded = segments.map((segment) => encodeURIComponent(segment)).join("/");
  const url = new URL(`${base.replace(/\/+$/, "")}/${encoded}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Route discovery
// ---------------------------------------------------------------------------

/**
 * Channels are read from the live API rather than hardcoded, so this harness
 * keeps working as the remaining 5-7 channels are ingested. Slugs are Cyrillic
 * for most of them, which is exactly why buildUrl encodes every segment.
 */
async function discoverChannels(apiUrl, timeout) {
  const response = await fetch(buildUrl(apiUrl, ["api", "channels"]), {
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    throw new Error(`GET /api/channels responded ${response.status}`);
  }
  const channels = await response.json();
  return channels.map((channel) => ({
    slug: channel.slug,
    name: channel.name,
    episodeCount: channel.episode_count ?? null,
  }));
}

/** One real episode id, so /e/[youtubeId] is measured against real data. */
async function discoverEpisode(apiUrl, timeout) {
  const url = buildUrl(apiUrl, ["api", "episodes"], { limit: 1, sort: "newest" });
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) return null;
  const body = await response.json();
  return body.items?.[0]?.youtube_id ?? null;
}

/**
 * Build the full route list.
 *
 * `budgetKey` is a TEMPLATE key (e.g. `api:channel-grid`), shared by every
 * channel, so a newly ingested channel inherits the budget automatically and
 * cannot sneak in unmeasured. `id` is per-instance, so a waiver can name one
 * specific offending channel without excusing the rest.
 */
export function buildRoutes({ apiUrl, webUrl, channels, episodeId }) {
  const routes = [
    { id: "api:health", budgetKey: "api:health", tier: "api", label: "/api/health", url: buildUrl(apiUrl, ["api", "health"]) },
    { id: "api:channels", budgetKey: "api:channels", tier: "api", label: "/api/channels", url: buildUrl(apiUrl, ["api", "channels"]) },
    {
      id: "api:episodes-newest",
      budgetKey: "api:episodes-list",
      tier: "api",
      label: "/api/episodes?limit=24&sort=newest",
      url: buildUrl(apiUrl, ["api", "episodes"], { limit: 24, sort: "newest" }),
    },
    {
      id: "api:episodes-top-rated",
      budgetKey: "api:episodes-list",
      tier: "api",
      label: "/api/episodes?limit=24&sort=top_rated",
      url: buildUrl(apiUrl, ["api", "episodes"], { limit: 24, sort: "top_rated" }),
    },
    {
      id: "api:search",
      budgetKey: "api:search",
      tier: "api",
      label: `/api/search?q=${SEARCH_QUERY}`,
      url: buildUrl(apiUrl, ["api", "search"], { q: SEARCH_QUERY }),
    },
    {
      id: "api:leaderboard-top-rated",
      budgetKey: "api:leaderboard",
      tier: "api",
      label: "/api/leaderboards/top_rated",
      url: buildUrl(apiUrl, ["api", "leaderboards", "top_rated"]),
    },
  ];

  for (const channel of channels) {
    routes.push({
      id: `api:channel-detail:${channel.slug}`,
      budgetKey: "api:channel-detail",
      tier: "api",
      label: `/api/channels/${channel.slug}`,
      url: buildUrl(apiUrl, ["api", "channels", channel.slug]),
      note: `${channel.episodeCount ?? "?"} episodes`,
    });
    routes.push({
      id: `api:channel-grid:${channel.slug}`,
      budgetKey: "api:channel-grid",
      tier: "api",
      label: `/api/channels/${channel.slug}/grid`,
      url: buildUrl(apiUrl, ["api", "channels", channel.slug, "grid"]),
      note: `${channel.episodeCount ?? "?"} episodes`,
    });
  }

  routes.push(
    { id: "web:home", budgetKey: "web:home", tier: "web", label: "/", url: buildUrl(webUrl, []) },
    { id: "web:channels", budgetKey: "web:channels", tier: "web", label: "/channels", url: buildUrl(webUrl, ["channels"]) },
    { id: "web:episodes", budgetKey: "web:episodes", tier: "web", label: "/episodes", url: buildUrl(webUrl, ["episodes"]) },
    {
      id: "web:search",
      budgetKey: "web:search",
      tier: "web",
      label: `/search?q=${SEARCH_QUERY}`,
      url: buildUrl(webUrl, ["search"], { q: SEARCH_QUERY }),
    },
    {
      id: "web:search-broad",
      budgetKey: "web:search-broad",
      tier: "web",
      label: `/search?q=${SEARCH_QUERY_BROAD}`,
      url: buildUrl(webUrl, ["search"], { q: SEARCH_QUERY_BROAD }),
    },
    { id: "web:status", budgetKey: "web:status", tier: "web", label: "/status", url: buildUrl(webUrl, ["status"]) },
  );

  for (const channel of channels) {
    routes.push({
      id: `web:channel-page:${channel.slug}`,
      budgetKey: "web:channel-page",
      tier: "web",
      label: `/channels/${channel.slug}`,
      url: buildUrl(webUrl, ["channels", channel.slug]),
      note: `${channel.episodeCount ?? "?"} episodes`,
    });
  }

  if (episodeId) {
    routes.push({
      id: "web:episode-page",
      budgetKey: "web:episode-page",
      tier: "web",
      label: `/e/${episodeId}`,
      url: buildUrl(webUrl, ["e", episodeId]),
    });
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** One request, timed end to end including reading the whole body. */
async function timeOnce(url, timeout) {
  const started = performance.now();
  // No cache-busting headers. A real browser navigation sends none, and this
  // harness is meant to measure the warm path a real user gets, including any
  // server-side cache the app legitimately relies on.
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  const body = Buffer.from(await response.arrayBuffer());
  const ms = performance.now() - started;
  return { ms, status: response.status, body };
}

async function measureRoute(route, { runs, warmup, timeout }) {
  try {
    let last = null;
    for (let i = 0; i < warmup; i += 1) {
      last = await timeOnce(route.url, timeout);
    }

    const samples = [];
    for (let i = 0; i < runs; i += 1) {
      last = await timeOnce(route.url, timeout);
      samples.push(last.ms);
    }

    const bytes = last.body.byteLength;
    return {
      id: route.id,
      budgetKey: route.budgetKey,
      tier: route.tier,
      label: route.label,
      note: route.note ?? null,
      status: last.status,
      ok: last.status >= 200 && last.status < 300,
      runs,
      medianMs: Number(median(samples).toFixed(1)),
      minMs: Number(Math.min(...samples).toFixed(1)),
      maxMs: Number(Math.max(...samples).toFixed(1)),
      kb: Number((bytes / 1024).toFixed(1)),
      gzipKb: Number((gzipSync(last.body).byteLength / 1024).toFixed(1)),
      error: null,
    };
  } catch (error) {
    return {
      id: route.id,
      budgetKey: route.budgetKey,
      tier: route.tier,
      label: route.label,
      note: route.note ?? null,
      status: 0,
      ok: false,
      runs: 0,
      medianMs: null,
      minMs: null,
      maxMs: null,
      kb: null,
      gzipKb: null,
      error: String(error?.message ?? error),
    };
  }
}

async function reachable(url, timeout) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return response.status > 0;
  } catch {
    return false;
  }
}

/**
 * Run the whole harness. Exported so the Vitest budget test can reuse the exact
 * same measurement code path rather than growing a second, drifting copy.
 */
export async function runBenchmark(options = {}) {
  const config = { ...DEFAULTS, ...options };

  const [apiUp, webUp] = await Promise.all([
    reachable(buildUrl(config.apiUrl, ["api", "health"]), 5_000),
    reachable(buildUrl(config.webUrl, []), 5_000),
  ]);

  if (!apiUp || !webUp) {
    return {
      reachable: false,
      apiUp,
      webUp,
      apiUrl: config.apiUrl,
      webUrl: config.webUrl,
      results: [],
    };
  }

  const channels = await discoverChannels(config.apiUrl, config.timeout);
  const episodeId = await discoverEpisode(config.apiUrl, config.timeout);

  let routes = buildRoutes({
    apiUrl: config.apiUrl,
    webUrl: config.webUrl,
    channels,
    episodeId,
  });
  if (config.only) {
    routes = routes.filter((route) => route.id.includes(config.only));
  }

  // Process-level warmup. Without this the FIRST route measured absorbs the
  // cost of opening the connection pool and of whatever the servers lazily
  // import on their first request, and reports a median 2-3x everyone else's.
  // Observed on /api/health: 45 ms as the first route, 12 ms once pre-warmed.
  for (let i = 0; i < 3; i += 1) {
    await Promise.all([
      timeOnce(buildUrl(config.apiUrl, ["api", "health"]), config.timeout).catch(() => {}),
      timeOnce(buildUrl(config.webUrl, []), config.timeout).catch(() => {}),
    ]);
  }

  const results = [];
  for (const route of routes) {
    results.push(await measureRoute(route, config));
  }

  return {
    reachable: true,
    apiUp,
    webUp,
    generatedAt: new Date().toISOString(),
    apiUrl: config.apiUrl,
    webUrl: config.webUrl,
    runs: config.runs,
    warmup: config.warmup,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    channels,
    episodeId,
    results,
  };
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export async function loadBudgets(budgetsPath = BUDGETS_PATH) {
  return JSON.parse(await readFile(budgetsPath, "utf8"));
}

/**
 * Evaluate one measured route against the budget file.
 *
 * Three verdicts matter:
 *   pass    within budget.
 *   fail    over budget with no waiver. This is the regression signal.
 *   waived  over budget, but the route is on the waiver list with a recorded
 *           ratchet ceiling. A waiver does NOT mean "ignore": going past the
 *           recorded ceiling still fails, so a known-bad route can never get
 *           worse. And a waived route that comes in UNDER budget also fails,
 *           with "delete this waiver" - a stale waiver is how a fixed problem
 *           silently becomes permitted again.
 */
export function evaluate(result, budgets) {
  const budget = budgets.budgets[result.budgetKey];
  if (!budget) {
    return {
      ...result,
      verdict: "unbudgeted",
      messages: [
        `${result.id}: no budget entry for key "${result.budgetKey}". Add one to scripts/perf-budgets.json.`,
      ],
    };
  }

  if (!result.ok) {
    return {
      ...result,
      verdict: "fail",
      budget,
      messages: [`${result.id} (${result.label}): request failed - status ${result.status}${result.error ? ` (${result.error})` : ""}`],
    };
  }

  const waiver = budgets.waivers?.[result.id] ?? null;
  const messages = [];

  const overKb = result.kb > budget.payloadKb;
  const overMs = result.medianMs > budget.medianMs;

  if (!waiver) {
    if (overKb) {
      messages.push(
        `${result.id} (${result.label}): payload ${result.kb} KB exceeds the ${budget.payloadKb} KB budget by ${(result.kb - budget.payloadKb).toFixed(1)} KB.`,
      );
    }
    if (overMs) {
      messages.push(
        `${result.id} (${result.label}): median ${result.medianMs} ms exceeds the ${budget.medianMs} ms budget (min ${result.minMs}, max ${result.maxMs} over ${result.runs} runs).`,
      );
    }
    return { ...result, budget, verdict: messages.length ? "fail" : "pass", messages };
  }

  // Waived route. Two ways to fail, both of them ratchets.
  if (!overKb && !overMs) {
    return {
      ...result,
      budget,
      waiver,
      verdict: "fail",
      messages: [
        `${result.id} (${result.label}): STALE WAIVER. This route is now within budget (${result.kb} KB / ${result.medianMs} ms vs ${budget.payloadKb} KB / ${budget.medianMs} ms). Delete its entry from "waivers" in scripts/perf-budgets.json so the budget starts being enforced.`,
      ],
    };
  }

  if (waiver.maxKb != null && result.kb > waiver.maxKb) {
    messages.push(
      `${result.id} (${result.label}): payload ${result.kb} KB is WORSE than the waived ceiling of ${waiver.maxKb} KB. This route is already over its ${budget.payloadKb} KB budget and just regressed further.`,
    );
  }
  if (waiver.maxMs != null && result.medianMs > waiver.maxMs) {
    messages.push(
      `${result.id} (${result.label}): median ${result.medianMs} ms is WORSE than the waived ceiling of ${waiver.maxMs} ms (min ${result.minMs}, max ${result.maxMs} over ${result.runs} runs).`,
    );
  }

  return { ...result, budget, waiver, verdict: messages.length ? "fail" : "waived", messages };
}

export function evaluateAll(report, budgets) {
  return report.results.map((result) => evaluate(result, budgets));
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function pad(value, width, align = "left") {
  const text = String(value);
  if (text.length >= width) return text;
  const fill = " ".repeat(width - text.length);
  return align === "right" ? fill + text : text + fill;
}

const VERDICT_MARK = {
  pass: "ok",
  fail: "FAIL",
  waived: "waived",
  unbudgeted: "NO BUDGET",
};

function printTable(rows, { withVerdict }) {
  const columns = [
    { key: "label", header: "route", align: "left" },
    { key: "medianMs", header: "median ms", align: "right" },
    { key: "spread", header: "min-max ms", align: "right" },
    { key: "kb", header: "KB", align: "right" },
    { key: "gzipKb", header: "gzip KB", align: "right" },
    { key: "status", header: "status", align: "right" },
  ];
  if (withVerdict) {
    columns.push({ key: "budgetText", header: "budget KB/ms", align: "right" });
    columns.push({ key: "verdictText", header: "verdict", align: "left" });
  }

  const printable = rows.map((row) => ({
    label: row.label,
    medianMs: row.medianMs ?? "-",
    spread: row.minMs == null ? "-" : `${row.minMs}-${row.maxMs}`,
    kb: row.kb ?? "-",
    gzipKb: row.gzipKb ?? "-",
    status: row.status || "ERR",
    budgetText: row.budget ? `${row.budget.payloadKb}/${row.budget.medianMs}` : "-",
    verdictText: VERDICT_MARK[row.verdict] ?? "",
  }));

  const widths = columns.map((column) =>
    Math.max(column.header.length, ...printable.map((row) => String(row[column.key]).length)),
  );

  const line = (cells) =>
    cells.map((cell, index) => pad(cell, widths[index], columns[index].align)).join("  ");

  console.log(line(columns.map((column) => column.header)));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));

  let tier = null;
  for (let i = 0; i < printable.length; i += 1) {
    if (rows[i].tier !== tier) {
      tier = rows[i].tier;
      console.log(`[${tier.toUpperCase()}]`);
    }
    console.log(line(columns.map((column) => printable[i][column.key])));
  }
}

function printComparison(current, baseline, threshold) {
  const byId = new Map(baseline.results.map((row) => [row.id, row]));
  console.log("");
  console.log(`Comparison vs baseline captured ${baseline.generatedAt ?? "(unknown)"}`);
  console.log("");

  const rows = [];
  let regressed = 0;

  for (const row of current.results) {
    const before = byId.get(row.id);
    if (!before || !before.ok || !row.ok) {
      rows.push([row.label, "-", "-", "-", "-", before ? "unmeasured" : "new route"]);
      continue;
    }
    const msDelta = ((row.medianMs - before.medianMs) / before.medianMs) * 100;
    const kbDelta = ((row.kb - before.kb) / before.kb) * 100;
    const worse = msDelta > threshold || kbDelta > threshold;
    if (worse) regressed += 1;
    rows.push([
      row.label,
      `${before.medianMs} -> ${row.medianMs}`,
      `${msDelta >= 0 ? "+" : ""}${msDelta.toFixed(1)}%`,
      `${before.kb} -> ${row.kb}`,
      `${kbDelta >= 0 ? "+" : ""}${kbDelta.toFixed(1)}%`,
      worse ? "REGRESSED" : "",
    ]);
  }

  const headers = ["route", "median ms", "d ms", "KB", "d KB", ""];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length)),
  );
  const line = (cells) => cells.map((cell, index) => pad(cell, widths[index])).join("  ");
  console.log(line(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));

  console.log("");
  if (regressed) {
    console.log(`${regressed} route(s) regressed by more than ${threshold}%.`);
  } else {
    console.log(`No route regressed by more than ${threshold}%.`);
  }
  return regressed;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBenchmark(options);

  if (!report.reachable) {
    const detail = [
      `benchmark SKIPPED: a server under test is unreachable.`,
      `  API ${options.apiUrl}  ${report.apiUp ? "up" : "DOWN"}`,
      `  web ${options.webUrl}  ${report.webUp ? "up" : "DOWN"}`,
      "",
      "Start them and re-run:",
      "  cd apps/api && uv run python manage.py runserver",
      "  cd apps/web && npm run build && npm run start -- --port 3200",
    ].join("\n");
    if (options.json) {
      console.log(JSON.stringify({ ...report, skipped: true }, null, 2));
      console.error(detail);
    } else {
      console.error(detail);
    }
    return EXIT_UNREACHABLE;
  }

  let rows = report.results;
  let exitCode = EXIT_OK;

  if (options.budgets) {
    const budgets = await loadBudgets();
    rows = evaluateAll(report, budgets);
    report.budgetsVersion = budgets.version ?? null;
    report.evaluated = rows;
  }

  if (options.json) {
    console.log(JSON.stringify({ ...report, results: rows }, null, 2));
  } else {
    console.log("");
    console.log(`API ${report.apiUrl}   web ${report.webUrl}`);
    console.log(
      `${report.runs} timed runs per route after ${report.warmup} warmup requests   node ${report.node}   ${report.platform}`,
    );
    console.log(`${report.channels.length} channel(s) discovered from /api/channels`);
    console.log("");
    printTable(rows, { withVerdict: options.budgets });
  }

  if (report.results.some((row) => !row.ok)) {
    exitCode = EXIT_ROUTE_FAILED;
  }

  if (options.budgets) {
    const failures = rows.filter((row) => row.verdict === "fail" || row.verdict === "unbudgeted");
    if (failures.length) {
      if (!options.json) {
        console.error("");
        console.error("PERFORMANCE BUDGET BREACH");
        for (const failure of failures) {
          for (const message of failure.messages) console.error(`  - ${message}`);
        }
      }
      exitCode = EXIT_BUDGET_BREACH;
    }
  }

  if (options.save) {
    const target = path.resolve(options.save);
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (!options.json) console.log(`\nBaseline saved to ${target}`);
  }

  if (options.compare) {
    const baseline = JSON.parse(await readFile(path.resolve(options.compare), "utf8"));
    const regressed = printComparison(report, baseline, options.threshold);
    if (regressed) exitCode = EXIT_BUDGET_BREACH;
  }

  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = EXIT_ROUTE_FAILED;
    });
}
