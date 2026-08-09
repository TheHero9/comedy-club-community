#!/usr/bin/env node
/**
 * Contract drift guard (test matrix rows 20.1 - 20.3).
 *
 * `packages/api-types/src/generated.ts` is a COMMITTED snapshot of the types
 * generated from the Django-Ninja OpenAPI schema. Committing it is what lets
 * `npm run build` work with the API switched off. The cost of that convenience
 * is that the snapshot can silently fall behind the real schema: nothing fails,
 * the types simply start describing an API that no longer exists.
 *
 * This script regenerates the types from the LIVE schema using exactly the same
 * `openapi-typescript` invocation as `packages/api-types`'s `generate:types`
 * script, then compares the bytes against the committed snapshot.
 *
 * Usage:
 *   node scripts/check-api-types-drift.mjs
 *   node scripts/check-api-types-drift.mjs --emit <file>   # generate only
 *
 * Environment overrides (used by the test suite):
 *   API_TYPES_SCHEMA_URL   default http://localhost:8000/api/openapi.json
 *   API_TYPES_SNAPSHOT     default packages/api-types/src/generated.ts
 *
 * Exit codes:
 *   0  snapshot matches the live schema (or --emit succeeded)
 *   1  DRIFT - the snapshot is stale
 *   2  the API is unreachable, so nothing could be checked
 *   3  generation failed for some other reason
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const EXIT_OK = 0;
export const EXIT_DRIFT = 1;
export const EXIT_API_UNREACHABLE = 2;
export const EXIT_GENERATION_FAILED = 3;

/** The exact wording the drift failure must contain. Asserted by the suite. */
export const REGENERATE_COMMAND = "npm run generate:types";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

const SCHEMA_URL =
  process.env.API_TYPES_SCHEMA_URL ?? "http://localhost:8000/api/openapi.json";

const SNAPSHOT_PATH = path.resolve(
  REPO_ROOT,
  process.env.API_TYPES_SNAPSHOT ?? "packages/api-types/src/generated.ts",
);

/** Resolve the CLI entry point rather than the .bin shim, so Windows behaves. */
function resolveGeneratorCli() {
  const pkgPath = require.resolve("openapi-typescript/package.json");
  const pkg = require("openapi-typescript/package.json");
  return path.join(path.dirname(pkgPath), pkg.bin["openapi-typescript"]);
}

async function apiIsReachable() {
  try {
    const response = await fetch(SCHEMA_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function runGenerator(outputPath) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [resolveGeneratorCli(), SCHEMA_URL, "--output", outputPath],
      { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => resolve({ code: 1, stderr: String(error) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/** Line-level summary, capped so a schema rewrite does not flood the terminal. */
function summarizeDrift(committed, fresh) {
  const committedLines = committed.split(/\r?\n/);
  const freshLines = fresh.split(/\r?\n/);
  const committedSet = new Set(committedLines);
  const freshSet = new Set(freshLines);

  const added = freshLines.filter((line) => line.trim() && !committedSet.has(line));
  const removed = committedLines.filter((line) => line.trim() && !freshSet.has(line));

  const lines = [];
  for (const line of added.slice(0, 15)) lines.push(`  + ${line.trim()}`);
  if (added.length > 15) lines.push(`  + ... and ${added.length - 15} more added lines`);
  for (const line of removed.slice(0, 15)) lines.push(`  - ${line.trim()}`);
  if (removed.length > 15) lines.push(`  - ... and ${removed.length - 15} more removed lines`);
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const emitIndex = argv.indexOf("--emit");
  const emitTarget = emitIndex === -1 ? null : argv[emitIndex + 1];

  if (emitIndex !== -1 && !emitTarget) {
    console.error("--emit needs a target file path");
    return EXIT_GENERATION_FAILED;
  }

  if (!(await apiIsReachable())) {
    console.error(
      [
        `API types drift check SKIPPED: could not reach ${SCHEMA_URL}`,
        "",
        "The committed snapshot exists precisely so builds work offline, so this",
        "is not a failure. Start the API and re-run to actually check for drift:",
        "  cd apps/api && uv run python manage.py runserver",
      ].join("\n"),
    );
    return EXIT_API_UNREACHABLE;
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "ccc-api-types-"));
  const generated = path.join(workDir, "generated.ts");

  try {
    const result = await runGenerator(generated);
    if (result.code !== 0) {
      console.error(`openapi-typescript failed (exit ${result.code}):\n${result.stderr}`);
      return EXIT_GENERATION_FAILED;
    }

    const fresh = await readFile(generated, "utf8");

    if (emitTarget) {
      const absolute = path.resolve(emitTarget);
      await mkdir(path.dirname(absolute), { recursive: true });
      await copyFile(generated, absolute);
      return EXIT_OK;
    }

    const committed = await readFile(SNAPSHOT_PATH, "utf8");

    // Normalize line endings only. Anything else would hide real drift.
    if (fresh.replace(/\r\n/g, "\n") === committed.replace(/\r\n/g, "\n")) {
      console.log(
        `API types are in sync: ${path.relative(REPO_ROOT, SNAPSHOT_PATH)} matches ${SCHEMA_URL}`,
      );
      return EXIT_OK;
    }

    console.error(
      [
        "API TYPES DRIFT DETECTED.",
        "",
        `  live schema: ${SCHEMA_URL}`,
        `  snapshot:    ${path.relative(REPO_ROOT, SNAPSHOT_PATH)}`,
        "",
        "The committed TypeScript types no longer describe the API.",
        `Run \`${REGENERATE_COMMAND}\` and commit the result.`,
        "",
        "Differences:",
        summarizeDrift(committed, fresh),
      ].join("\n"),
    );
    return EXIT_DRIFT;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// Only self-execute when invoked as a script, so the constants stay importable.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = EXIT_GENERATION_FAILED;
    });
}
