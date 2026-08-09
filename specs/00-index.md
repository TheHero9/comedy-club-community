# Specs Index

One row per spec folder. Add a row whenever you create a new folder.

| Folder | Topic | Status |
| ------ | ----- | ------ |
| [`01-initial-build`](01-initial-build/01-waves.md) | The 13-wave build plan: goals, deliverables, acceptance criteria, dependencies | ✅ Built (waves 1-13) |
| [`02-test-hardening`](02-test-hardening/05-results.md) | Autonomous test campaign: Playwright E2E, Vitest units, backend gaps, contract drift. **Results in `05-results.md`.** | ✅ Executed - 666 tests, 145/149 rows, 5 bugs fixed |
| [`03-redesign`](03-redesign/01-design-brief.md) | Full visual redesign brief for a design tool: product context, data reality, every page mapped, component inventory, prototype deliverables. **Start at `01-design-brief.md`.** | ✅ Handed off, designed, and built - see `07-visual-redesign` |
| [`04-channel-ingestion`](04-channel-ingestion/01-comedyclubpodcast-run.md) | Per-channel backfill runs and their findings. **Includes the silent-throttle trap: a big run reports `0 errors` while losing `duration`/`availability` on 79% of rows.** | ✅ 1,318 ingested, repaired and re-indexed - avatars live |
| [`05-performance`](05-performance/01-baseline.md) | Benchmark harness, measured baseline and per-route performance budgets for the API and the web app. **Budgets are enforced by `apps/web/tests/perf-budget.spec.ts`; waivers are ratchets that must be deleted once a route is fixed.** | ✅ Harness built, baseline captured 2026-08-09 |
| [`06-transcripts`](06-transcripts/02-architecture.md) | Free transcripts from YouTube's own `bg-orig` auto-captions, stored as windowed segments in a **second** Meilisearch index. **Includes the byte-vs-character typo-tolerance bug that made `пица` match `пичове` - 95 of 100 hits were false.** Probe page: `01-caption-probe.html`. | ✅ Built 2026-08-09 - storage, search and CLI live |
| [`07-visual-redesign`](07-visual-redesign/01-implementation.md) | The full visual redesign, built from `Designs/design_handoff_podcast_index/`. **Includes the WCAG failures in the handed-over palette and the density fallback the transposed mobile grid needs at 11 years.** | ✅ Built 2026-08-10 - all 10 routes, 746 tests green |
