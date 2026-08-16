#!/usr/bin/env node
/**
 * Start a local web server for E2E and the benchmark, and PROVE it is serving
 * the build you just made.
 *
 * 🚨 THE INCIDENT THIS EXISTS FOR (2026-08-16).
 *
 * A `next start --port 3200` left running by an earlier session still owned the
 * port. The new `next start` died with `EADDRINUSE` into a backgrounded log
 * nobody read, and every check for the next fifteen minutes ran against a build
 * from hours earlier. It did not look like a stale server. It looked like two
 * real bugs:
 *
 *   - `scroll={false}` "not working" (the old build did not have it)
 *   - `<a> subtree intercepts pointer events` on cards (the old build's CSS
 *     chunks were gone from disk, so the grid collapsed and elements overlapped)
 *
 * That is the same failure shape as every deployment incident on this project:
 * something reported success and served the old thing. The API answers it with
 * `/api/health` returning its commit; this is the web half of the same idea.
 *
 * WHAT IT GUARANTEES
 *
 *   1. Nothing else owns the port - an orphan is killed, by pid, before we start.
 *   2. The server actually answered, not just spawned.
 *   3. The build id in the served HTML equals `apps/web/.next/BUILD_ID` on disk.
 *      A mismatch EXITS NON-ZERO. That is the whole point: it is impossible to
 *      walk away believing a stale server is the new one.
 *
 * USAGE
 *
 *   node scripts/serve-local.mjs --build          # build, then serve on 3200
 *   node scripts/serve-local.mjs                  # serve the existing build
 *   node scripts/serve-local.mjs --port 3100
 *   node scripts/serve-local.mjs --kill-only      # just free the port
 *
 * Then: `E2E_PORT=3200 npx playwright test <spec>` and `npm run benchmark`.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps", "web");

/**
 * The Next binary, invoked through `node` directly rather than through `npx`.
 *
 * `npx` on Windows needs `shell: true`, which Node deprecates when arguments
 * are passed separately (DEP0190) - and a shell in the middle is also what
 * makes a spawned pid the shell's rather than the server's, which would break
 * the orphan-killing this script exists to do.
 */
const NEXT_BIN = [
  join(ROOT, "node_modules", "next", "dist", "bin", "next"),
  join(WEB, "node_modules", "next", "dist", "bin", "next"),
].find((candidate) => existsSync(candidate));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};

const PORT = Number(value("--port", 3200));
const LOG_DIR = join(ROOT, ".local");
const LOG = join(LOG_DIR, `web-${PORT}.log`);
const READY_TIMEOUT_MS = 120_000;

const say = (message) => process.stdout.write(`${message}\n`);
const die = (message) => {
  process.stderr.write(`\nERROR: ${message}\n`);
  process.exit(1);
};

/**
 * Every pid listening on the port.
 *
 * 🚨 By pid, not by name. `taskkill /im node.exe` would take out the Django
 * tooling, the Playwright runner and whatever else happens to be node - and
 * on this machine port 3000 belongs to an unrelated project that must survive.
 */
function listenersOn(port) {
  if (process.platform === "win32") {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
      ],
      { encoding: "utf8" },
    );
    return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
  }
  try {
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
  } catch {
    return []; // lsof exits 1 when nothing matches
  }
}

function describe(pid) {
  try {
    if (process.platform === "win32") {
      return execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
        ],
        { encoding: "utf8" },
      )
        .trim()
        .slice(0, 120);
    }
    return execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
    })
      .trim()
      .slice(0, 120);
  } catch {
    return "(gone)";
  }
}

function killPid(pid) {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    /* already gone */
  }
}

async function freePort(port) {
  const pids = listenersOn(port);
  if (pids.length === 0) {
    say(`port ${port} is free`);
    return;
  }
  for (const pid of pids) {
    say(`killing orphan on ${port}: pid ${pid} - ${describe(pid)}`);
    killPid(pid);
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (listenersOn(port).length === 0) {
      say(`port ${port} freed`);
      return;
    }
  }
  die(`port ${port} is still held by ${listenersOn(port).join(", ")}`);
}

function buildIdOnDisk() {
  const path = join(WEB, ".next", "BUILD_ID");
  if (!existsSync(path)) {
    die("apps/web/.next/BUILD_ID is missing. Run with --build first.");
  }
  return readFileSync(path, "utf8").trim();
}

/**
 * The build id the RUNNING server is serving.
 *
 * Next puts it in the RSC flight payload as `"b":"<id>"`. Reading it from the
 * response rather than from disk is the entire guarantee - disk is what you
 * built, this is what answered.
 */
async function servedBuildId(port) {
  const response = await fetch(`http://localhost:${port}/status`, {
    signal: AbortSignal.timeout(30_000),
  });
  const html = await response.text();
  const match = html.match(/\\?"b\\?":\\?"([A-Za-z0-9_-]{8,})\\?"/);
  return match?.[1] ?? null;
}

async function waitForAnswer(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/status`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  die(
    `the server never answered on ${port} within ${READY_TIMEOUT_MS / 1000}s.\n` +
      `Read its log: ${LOG}`,
  );
}

// ---------------------------------------------------------------------------

await freePort(PORT);
if (flag("--kill-only")) process.exit(0);

if (flag("--build")) {
  // 🚨 Build AFTER freeing the port, never while a server is serving that
  // build: `next start` holds the chunk manifest it booted with, and
  // rebuilding replaces the hashed files underneath it. The running server
  // then serves HTML referencing chunks that no longer exist, which shows up
  // as 404s on `_next/static/chunks/*.css` and reads like a z-index bug.
  say("\nbuilding...");
  if (!NEXT_BIN) die("could not find node_modules/next/dist/bin/next");
  execFileSync(process.execPath, [NEXT_BIN, "build"], {
    cwd: WEB,
    stdio: "inherit",
  });
}

const expected = buildIdOnDisk();
mkdirSync(LOG_DIR, { recursive: true });
const logFd = openSync(LOG, "a");

if (!NEXT_BIN) die("could not find node_modules/next/dist/bin/next");
const child = spawn(
  process.execPath,
  [NEXT_BIN, "start", "--port", String(PORT)],
  { cwd: WEB, detached: true, stdio: ["ignore", logFd, logFd] },
);
child.unref();

say(`\nstarting next start --port ${PORT} (pid ${child.pid})`);
say(`log: ${LOG}`);
await waitForAnswer(PORT);

const serving = await servedBuildId(PORT);
if (serving === null) {
  die(
    `the server answered but no build id was found in its HTML.\n` +
      `Next may have changed where it emits one - fix this check rather than\n` +
      `deleting it, or the stale-server trap comes straight back.`,
  );
}
if (serving !== expected) {
  die(
    `STALE SERVER on port ${PORT}.\n` +
      `  serving:  ${serving}\n` +
      `  on disk:  ${expected}\n` +
      `Something else answered on this port. Read ${LOG}.`,
  );
}

say(`\nOK  port ${PORT} is serving build ${serving} (matches .next/BUILD_ID)`);
say(`    E2E_PORT=${PORT} npx playwright test <spec>`);
say(`    npm run benchmark`);
