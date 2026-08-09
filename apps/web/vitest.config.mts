/**
 * Vitest configuration for pure-function and typed-client unit tests.
 *
 * Scope is deliberately narrow. Server Components are covered by Playwright
 * against a real server, never by a component renderer, so there is no jsdom
 * environment and no React testing library here.
 */
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // `e2e/` belongs to Playwright. Without this, Vitest would try to collect
    // those specs and fail on the Playwright-only imports.
    include: ["tests/**/*.spec.ts"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    reporters: ["default"],
    // Some client tests spawn a real HTTP server on a loopback port.
    testTimeout: 20_000,
  },
});
