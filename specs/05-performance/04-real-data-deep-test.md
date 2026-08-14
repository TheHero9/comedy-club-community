# Deep test + benchmark sweep on the real dataset (2026-08-14)

The first full-stack verification pass since the corpus became REAL: 1,961
episodes across 7 channels, 61,452 transcript segments, zero demo data.
Production build, full suites, budget enforcement, and a payload fix that came
out of it.

## Scoreboard

| Gate | Result |
| ---- | ------ |
| typecheck + lint (turbo) | ✅ clean |
| Vitest (incl. live perf-budget suite) | ✅ 186/186 |
| Playwright E2E, prod build, desktop+mobile | ✅ 369 passed, 0 failed, 0 flaky |
| pytest (backend) | ✅ 443 passed (unchanged tonight) |
| `benchmark.mjs --budgets` | ✅ exit 0, every route ok or ratchet-waived |
| Postgres index usage | ✅ expression sort indexes live, hot sorts < 3 ms |
| Meilisearch typo settings | ✅ byte-aware on BOTH indexes (8/16 and 10/18) |
| Bulgarian relevance regressions | ✅ `пица` 17 hits 0 false, `???` 0 hits, `Каспаров` 1 hit |

## 🐛 What the real data caught (fixed tonight)

1. **Two E2E tests met an all-unrated catalogue for the first time** after the
   demo purge:
   - `a11y 12.3` had a never-executed branch asserting the English "Not rated" -
     replaced with `copy.band.unrated` (assert copy values, never literals).
   - `ratings-grid 3.8` asserted elite ≠ public renders, which is a property of
     the DATA - with zero ratings both grids are truthfully identical. The
     assertion now conditions on the API projections differing and re-arms
     automatically once real users rate; the toggle itself stays pinned via
     server-set `aria-current` + UI==API equality.

2. **⚡ The big channel page had regressed OVER its 1,800 KB waiver ceiling
   (1,826.9 KB) - the ratchet caught it.** Cause: the same
   one-string-three-copies class as the 2026-08-11 `title` fix, one attribute
   over: every cell shipped `data-title` (135.5 KB, duplicating `aria-label`)
   and a localized `data-position` sentence (49.2 KB), each serialized AGAIN in
   the RSC flight. Fix: the hover preview derives the title from `aria-label`
   (`titleFromCellLabel` - reverse-strips the finite machine suffixes; round-trip
   tested in `tests/grid-model.spec.ts` including titles containing " - ") and
   formats a compact `year:index` client-side. **1,826.9 → 1,506.6 KB (-17.5%)**,
   and every channel page shrank (Kirkov 419.7 → 387.4, News 413.7 → 350.5).
   Waiver ceiling ratcheted 1800 → 1600.

3. **`web:channels` budget recalibrated 120 → 240 KB.** The old ceiling
   extrapolated "22.6 KB for 2 cards" from before the redesign gave every card
   a per-year sparkline; at the full 7-channel roster the page is 202.2 KB
   decoded / 15.1 KB gzipped of RENDERED content, which is the design working,
   not data leaking. 240 = today's roster + one more decade-deep channel.

4. **The repo's own copy scanner flagged the fix's `getAttribute("aria-label")`
   literal** - resolved with the `ariaLabel` DOM property, not an allow-list
   entry.

## Deep checks that found nothing wrong (worth recording)

- `pg_stat_user_indexes`: `ep_upload_desc_nl_idx` and friends have real scans;
  the elite-sort index is idle only because all scores are currently null.
  `top_rated` walks 1,962 all-null rows in 2.1 ms - fine.
- Soft-404 guard held on the prod build (`/channels/does-not-exist` → real 404).
- All E2E/vitest skips are environment- or data-conditional with written
  reasons; none dodge a failure.

## The full run on the big channel page: 1826.9 -> 916.2 KB (50%)

Four passes, each removing a repeat rather than removing content. Nothing the
user sees changed - the grid still renders all 1,318 episodes.

| Pass | What was repeated | Result |
| ---- | ----------------- | ------ |
| `data-title` + localized `data-position` | the title, a second time per cell | 1826.9 -> 1506.6 |
| exact title recovery | (correctness; `data-flags` on 376 cells) | -> 1519.8 |
| default-valued data attributes | `data-provisional=""` etc. on every cell | -> 1328.9 |
| the cell class list -> CSS descendant rules | 105 identical characters x 1,318 | **-> 916.2** |

Every byte was charged twice, because the RSC flight payload serializes the
whole tree again after the HTML.

**The class-list pass is the one that needed proof, not judgement.** It moves
size, radius, the unrated treatment and all seven band colours out of Tailwind
utilities and into `globals.css` rules keyed on `data-band`. Rather than
eyeball it, the before/after was verified by diffing `getComputedStyle` on a
cell, its `<td>` and an empty hole in BOTH colour schemes - display, width,
height, radius, background, colour, border, box-sizing and bounding rect all
identical - plus the 369-test E2E suite including axe at two viewports.

## Still open (the structural item)

The route is now 1.5x its real 600 KB budget, ceiling ratcheted 1800 -> 1000.
The largest remaining repeat is `aria-label` at 170 KB, and that one is NOT
waste: it is genuine per-cell content and, since the `data-title` removal, the
only copy of the episode title on the page. So the next lever is structural,
exactly as `03-optimization-results.md` said: empty holes must stop being
elements, or the grid paginates by season.
