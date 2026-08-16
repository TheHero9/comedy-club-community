# 13 - UX feedback, round 3

**Source:** owner walkthrough of the app on **2026-08-16**, immediately after the
search / memberships / profile-icons work in [`12-search-and-memberships`](../12-search-and-memberships/01-search-counts-and-matching.md)
went live. Fourteen items, all approved and all built in one pass.

Two of them undo something shipped hours earlier, which is the point of a
walkthrough: the fullscreen channel grid and the "popular topics" disclosure
both survived review on paper and failed on contact.

---

## The fourteen items

| # | What the owner saw | Fix |
| - | ------------------ | --- |
| 1 | Changing the profile icon left the header avatar showing `PR` | The header reads the same `["me"]` query the picker invalidates |
| 2 | Sections are unlabelled walls of same-weight Bulgarian text | `lucide-react` mark left of every page and section heading |
| 3 | The months field suggests `70` | Placeholder is `5` |
| 4 | A membership row shows the initials tile, not the channel's picture | `channel_avatar_url` on `MembershipOut` |
| 5 | "Edit profile" is where the icon picker hides, and nobody finds it | The avatar itself opens the editor, with a pencil badge |
| 6 | The empty `/search` page is top-aligned with a topics drawer under it | Centred on the field; the drawer is deleted |
| 7 | Nothing on screen says how to submit a search | A real `type="submit"` button in the overlay, and a matching affordance on the closed pill |
| 8 | "More spoken matches" throws you back to the top of the page | `scroll={false}` |
| 9 | Same feedback for the home page field | Same component |
| 10 | Machine-suggested labels are indistinguishable from members' | `is_auto` on the API; dashed chip + spark + a line of copy |
| 11 | The description is sometimes collapsed and sometimes not | Always collapsed; empty renders nothing |
| 12 | "Full view" on the big channel "looks awful" | Removed - component, copy, tests |
| 13 | The sticky year labels clip the first column of cells | The mask is a border, not a box-shadow |
| 14 | An unwatched episode's button says "Watched" with a red tick | Eye + an imperative label; the tick is green and only means done |

---

## The three that were more than a tweak

### 10 - A guess and a fact must not look the same

Every one of the catalogue's **2,565** topic links today was written by
`import_topic_labels`, and they rendered exactly like a label a member had
typed. That is wrong in both directions: a reader takes a machine guess for a
community fact, and a member who adds a real label watches it vanish into a row
of guesses - which removes the reason to add one at all.

🚨 **The flag is DERIVED, not stored.** `import_topic_labels` already attributes
its work to one system account (`AUTO_LABELLER_USERNAME`) precisely so the two
can be told apart and so `--clear` is exact. A parallel `source` column would be
a second answer to the same question and would drift the first time a label was
merged or re-imported. `podcast/services/labels.py` caches that account's id for
ten minutes and `episode_detail` compares `added_by_id` against it once per
response.

🚨 **`added_by IS NULL` is NOT the machine.** NULL already means "added by a
member whose account was deleted". The obvious one-liner - "nobody is named, so
it must be automatic" - would relabel every orphaned human contribution as a
guess, permanently and invisibly. `test_label_provenance.py` pins it, along with
`is_auto` being **required** in the schema: a Pydantic default of `False` would
make one forgotten assignment render every machine label as community-authored.

### 12 - The fullscreen grid is gone, one day old

It replaced "Fit to screen", it passed six E2E tests, it fit 1,225 episodes in
one frame with no inner scroll, and it was still rejected on sight. At that
density the cells are a few pixels of colour and the result reads as noise, not
as a chart.

**The lesson is not "the sizing was wrong" - the sizing was measured and
correct.** The feature was answering the wrong question. "Show me the whole
channel at once" is a *cell count* problem; squeezing the same 1,225 cells into
a smaller viewport cannot solve it, and every version of that attempt has now
failed twice. If a screenshottable whole-channel view is wanted again, it has to
aggregate (by month, by quarter), not shrink.

Removed: `components/grid/GridFullscreen.tsx`, its call site, four `copy.ts`
keys in both locales, and the six tests in `e2e/ratings-grid.spec.ts`. The tests
went with the feature rather than being skipped. Side effect: the flagship
channel page dropped **916 KB → 841 KB**, because the overlay was a Client
Component in the bundle.

### 13 - A box-shadow is not a spacer

The sticky year column masked the cells sliding under it with
`shadow-[4px_0_0_0_var(--card-2)]`. A box-shadow paints **outside** the border
box and occupies no layout space, so those 4px sat permanently on top of the
first data column - at *every* scroll position, including zero. On the dense
grid that is 3px of a 20px cell, so column 1 looked narrower than every other
column and its dashed border disappeared entirely.

`border-r-4 border-card-2` looks identical and pushes the cells clear.

Measured after: `th.right = 149.8`, `cell.left = 150.8`. One pixel of
`border-spacing`, nothing overlapping.

---

## What was NOT done

- **No `EpisodeTopic.source` column.** See #10 above - the provenance already
  exists on `added_by` and a second copy of it would drift.
- **No client-side pagination for "load more".** The links stay real links, so
  a longer page is still shareable and server-rendered; `scroll={false}` was the
  whole fix.
- **The `noDescription` copy key is deleted, not repurposed.** An episode with
  no description now renders nothing rather than a disclosure that opens onto an
  apology.

---

## Verification

| Gate | Result |
| ---- | ------ |
| `uv run pytest` | ✅ 1,489 passed (4 new in `test_label_provenance.py`) |
| `ruff` / `makemigrations --check` | ✅ clean, **no migration** |
| `npm run typecheck` / `lint` | ✅ clean |
| `npx vitest run` | ✅ 210 passed |
| `npx playwright test` (production build, both viewports) | ✅ 381 passed, 5 pre-existing skips |
| `npm run benchmark` + perf budgets | ✅ 35/35 within budget |

⚠️ **Two false alarms during verification, both worth remembering.**

1. A `next start --port 3200` **left over from a previous session** owned the
   port, so `next start` failed with `EADDRINUSE` in the background and every
   probe ran against a build from hours earlier. The symptom was a real-looking
   bug: `scroll={false}` "not working", plus `subtree intercepts pointer events`
   on cards. **Always read the server's own log after backgrounding it** - the
   `EADDRINUSE` was sitting there the whole time.
2. The long-running `next dev` on port 3000 had exhausted its heap
   (`Jest worker encountered 2 child process exceptions`) and was 500ing pages
   that render fine. That is the documented dev-mode heap trap, not a
   regression.

✅ **Fixed rather than noted.** `scripts/serve-local.mjs` (`npm run serve`) now
frees the port by pid, builds, starts, and **compares the build id in the served
HTML against `apps/web/.next/BUILD_ID`, exiting non-zero on a mismatch**. Same
idea as `/api/health` reporting its commit: a green "started" message proves a
process spawned, and the build id proves the *right* one answered. Starting a
local server by hand is now a documented mistake.

---

## Process rulings taken the same day

Prompted by the batch taking about an hour. Recorded in CLAUDE.md § Testing.

| Ruling | Why |
| ------ | --- |
| 🚨 **The full E2E suite is for a push, not an iteration.** While iterating, run only the specs covering the change - even for `lib/copy.ts`. | The "a copy change touches everything" rule is a pre-push gate, not a per-edit one. |
| 🚨 **No visual screenshot walkthrough.** The owner reviews the rendered result. | It was ~8 minutes of the hour and duplicated a review that was happening anyway. Screenshot ONE thing when a specific claim needs proving. |
| ✅ **Keep the benchmark.** | ~3 minutes, and the only thing that catches a payload regression - it caught 916 KB → 841 KB here. |
