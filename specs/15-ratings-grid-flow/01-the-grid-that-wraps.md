# The ratings grid that wraps

**Date:** 2026-08-16
**Trigger:** owner, on a laptop, on the live site:
> "on /channels i don't see the full episodes especially for the comedy club podcast, i see only a bit of the episodes. fix it so it's a good page on laptop, not for mobile."

---

## 1. The report was literally true

Measured on production at 1440x900 before any change, on
`/channels/комеди-клуб-подкаст-comedy-club-podcast`:

| | |
| --- | --- |
| Grid table width | **3,913px** |
| Its scroll container | **1,150px** |
| Columns visible | **52 of 183** |
| Episodes reachable without scrolling sideways | **~29% of 1,225** |
| Page horizontal overflow | 0 (the page was fine; the grid was not) |

The other 71% sat behind a horizontal scroll **inside a card**, with no visible
scrollbar on a trackpad. Every channel had the same problem to a lesser degree -
even the 71-episode one was 2,088px of matrix in the same 1,150px.

🚨 **The page looked like the site had a few hundred episodes.** That is worse
than a layout bug: it misreports the size of the catalogue on the page whose one
job is to show the catalogue.

---

## 2. Why every previous attempt failed

This is the **third** attempt at "show me the whole channel", and the first two
are recorded in `specs/13-ux-feedback-round-3/01-changes.md`:

1. **`GridFitToggle`** - scaled the inline grid with `transform: scale()`
   without shrinking its container, so the page grew a vertical scrollbar over
   empty space.
2. **`GridFullscreen`** - a transposed fullscreen overlay. It fitted all 1,225
   cells in one frame with no inner scroll, passed six E2E tests, and was
   rejected on sight: at that density the cells are a few pixels of colour and
   the result reads as noise. The owner's word was "awful".

🚨 **Both were the same mistake: they treated "show me everything" as a
SCALING problem.** The note left behind after the second failure was right, and
this change is what it asked for:

> "Show me the whole channel at once" is a **cell-count** problem, and squeezing
> the same 1,225 cells into a smaller viewport cannot solve it.

The third answer does not squeeze anything. It stops assuming a year has to be
one line.

---

## 3. What shipped

`components/grid/RatingsGrid.tsx` renders **`FlowGrid`**: one block per year,
and inside a block the year's episodes **wrap** across the available width at
full cell size.

```
2022  183 episodes  avg 7.4
[][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][]
[][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][]
[][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][][]
[][][][][][][][][][][][][][][][][][][][][]

2023  141 episodes  avg 7.1
...
```

`flex-wrap` on a fixed-size cell is the entire mechanism. The browser fits as
many per line as the container allows, at every width, **with no measurement and
no pixel constant** - which is the other lesson the deleted overlay paid for
twice (`(100dvh - CHROME) / rowCount` was got wrong two different ways).

### What it costs

Cells at the same position in different years no longer line up in a column, so
"compare episode 30 of 2021 against episode 30 of 2022" is gone. That comparison
was already unavailable to anyone who could only see the first 52 of 183, and
the owner chose this trade explicitly when the options were put side by side.

---

## 4. The two density decisions used to be one

`isRoomy` answered both "does the mobile grid transpose?" and "does a cell print
its score?" - because under a matrix both were the same question about WIDTH.
With no width to run out of, they split:

| | Question | Input | Constant |
| --- | --- | --- | --- |
| `hasMobileTranspose` | does mobile get the transposed table? | year count, tallest year | `ROOMY_MAX_SEASONS = 4`, `ROOMY_MAX_ROWS = 48` |
| `printsScores` | does every cell print its score? | **total episodes** | `ROOMY_MAX_EPISODES = 400` |

🚨 **`printsScores` is measured in EPISODES, not years and not rows.** A 54x44
cell wraps ~19 to a line in the 1,120px the card gives it, so the ceiling is
about total page height, and the year count is irrelevant to it. Under the old
single test, a 6-year 243-episode channel was denied printed scores purely for
having 6 years - it prints them now.

Effect on the current catalogue:

| Channel | Episodes | Before | After |
| --- | --- | --- | --- |
| Comedy Club Podcast | 1,225 | dense matrix | dense flow |
| Comedy Club News | 243 | dense matrix | **roomy flow** (scores printed) |
| Клюки | 139 | dense matrix | **roomy flow** |
| BFF с Пепи Кю | 80 | dense matrix | **roomy flow** |
| Ivan Kirkov | 71 | roomy matrix | roomy flow (+ mobile transpose) |
| Дело 404 | 57 | roomy matrix | roomy flow (+ mobile transpose) |
| Comedy Club Sport | 47 | roomy matrix | roomy flow (+ mobile transpose) |

---

## 5. The payload fell 31% as a side effect

| | Before | After |
| --- | --- | --- |
| `/channels/комеди-клуб-подкаст-...` | 916.2 KB | **629.2 KB** |
| median | 149.5 ms | 71.9 ms |

🚨 **This is the structural lever the perf waiver had already named**
("holes stop being elements"). The matrix padded every year to the tallest one,
so the flagship channel shipped **788 empty spacer cells** plus 2,013 `<td>` and
11 `<tr>` wrappers **purely to keep columns aligned across years**. A wrapped
year has no columns to align, so `seasonCells` drops the holes and the table
wrappers are gone: only the 1,225 real cells remain.

Waiver ratcheted 1000 -> 700 KB in `scripts/perf-budgets.json`. The route is now
1.05x its real 600 KB budget; the last big repeat is `aria-label` (~170 KB),
which is genuine per-cell content and the only copy of the title.

⚠️ **The layout change was made for legibility. The payload was a side effect.**
Do not read this as "wrapping is a payload optimisation" - it is a
"stop rendering things nobody can see" one, which is a different lesson.

---

## 6. Traps found and pinned

- 🚨 **`items-start`, not the default `stretch`.** A wrapped flex line stretches
  its items to the tallest one, and the roomy cell sets its height with `h-11`
  on a flex child - which loses to stretch on any line whose neighbours grew.
- 🚨 **`flex: 0 0 auto` on the dense cell.** These are flex children now, and a
  flex line will happily squeeze a 20px cell to fit rather than wrap it - which
  would silently reintroduce the exact "cells are a few pixels of colour"
  failure the wrap exists to avoid.
- 🚨 **`seasonCells` keeps the API's own `row.index`,** never the position in the
  array it returns. They agree today because holes only ever trail, but deriving
  one from the other would renumber a whole year the day that stops being true -
  and the number is what the hover preview reports as "episode N of 2021".
- 🚨 **The `<caption>` had to be replaced, not dropped.** A table is named by its
  caption; a wrapped run of 1,225 links has nowhere to put one and would have
  become an unlabelled pile. The flow grid is `role="group"` with the same string
  as `aria-label`, and `a11y.spec.ts` 12.2 now reads **both** sources - checking
  only one passes vacuously on whichever layout it does not cover.

---

## 7. Tests

Rewritten, not weakened. The old suite asserted the matrix's shape, and one test
asserted **the bug itself**:

> `invisible-failures.spec.ts` 8.3 required the grid container to be WIDER than
> its viewport - *"the grid must actually be wider than its container, or this
> test proves nothing"*. It now asserts the inverse.

| Spec | Change |
| --- | --- |
| `e2e/ratings-grid.spec.ts` | `readGrid("desktop")` -> `readFlow()`; 3.1, 3.3, 3.5, 3.6, 3.8, 3.9 rewritten against year blocks. 3.1b (every episode present, none duplicated) and **3.12 added, running against the 1,225-episode channel** - the small one fitted even under the old layout, so it could never have caught this. |
| `e2e/invisible-failures.spec.ts` | 8.3 inverted; 9.5 selector widened to `[data-grid]`. |
| `e2e/public-browse.spec.ts` | 1.3 asserts the accessible name instead of a `<caption>`; 1.4c selector widened. |
| `e2e/a11y.spec.ts` | 12.2 reads caption **or** `aria-label`; 12.5/12.6 walk `a[data-cell]` instead of `tbody a`. |
| `e2e/fixtures.ts` | `visibleGrid` is attribute-only - the flow grid is a `div`. |
| `tests/grid-model.spec.ts` | `seasonCells` (holes dropped, index preserved, missing season) and the two independent density decisions. |

Copy: `channel.hintDesktop` -> `channel.hintFlow` ("Every episode, grouped by
year, oldest first"), `channel.yearColumn` deleted. Both dictionaries.
