# Specs Index

One row per spec folder. Add a row whenever you create a new folder.

| Folder | Topic | Status |
| ------ | ----- | ------ |
| [`01-initial-build`](01-initial-build/01-waves.md) | The 13-wave build plan: goals, deliverables, acceptance criteria, dependencies | ✅ Built (waves 1-13) |
| [`02-test-hardening`](02-test-hardening/05-results.md) | Autonomous test campaign: Playwright E2E, Vitest units, backend gaps, contract drift. **Results in `05-results.md`.** | ✅ Executed - 666 tests, 145/149 rows, 5 bugs fixed |
| [`03-redesign`](03-redesign/01-design-brief.md) | Full visual redesign brief for a design tool: product context, data reality, every page mapped, component inventory, prototype deliverables. **Start at `01-design-brief.md`.** | 📋 Ready to hand off |
| [`04-channel-ingestion`](04-channel-ingestion/01-comedyclubpodcast-run.md) | Per-channel backfill runs and their findings. **Includes the silent-throttle trap: a big run reports `0 errors` while losing `duration`/`availability` on 79% of rows.** | ✅ 1,318 ingested, repaired and re-indexed - avatars live |
| [`05-performance`](05-performance/01-baseline.md) | Benchmark harness, measured baseline and per-route performance budgets for the API and the web app. **Budgets are enforced by `apps/web/tests/perf-budget.spec.ts`; waivers are ratchets that must be deleted once a route is fixed.** | ✅ Harness built, baseline captured 2026-08-09 |
