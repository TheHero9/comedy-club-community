# 07 - Visual redesign: implementation record

**Built:** 2026-08-09 / 2026-08-10
**Source:** `Designs/design_handoff_podcast_index/` (README + `Prototype.dc.html`, which wins wherever the standalone files disagree)
**Scope:** the visual layer only. No API changes, no new data.

The whole frontend was replaced. Every route in `apps/web/app` was rewritten
against the handoff, the design token layer was rebuilt from scratch, and the
E2E suite was rewritten to test the new UI rather than the old one.

---

## What shipped

| Screen | Route | State |
| ------ | ----- | ----- |
| Home | `/` | ✅ hero, top-rated rows, newest grid, channel cards |
| Channels | `/channels` | ✅ wide card at 1 channel, 2-up grid from 2, year sparkline |
| Channel + ratings grid | `/channels/[slug]` | ✅ **the signature screen**, both orientations |
| Episode detail | `/e/[youtubeId]` | ✅ IMDb-style, sidebar, action bar, rating sheet, watch log |
| Search | `/search` | ✅ empty / results / zero, match-reason rows, overlay |
| Browse | `/episodes` | ✅ filter bar, filter sheet, load more |
| Leaderboard | `/leaderboard` | ✅ podium + ranked rows, three boards |
| Profile | `/me` (+ `/me/[list]`) | ✅ signed-in and signed-out states |
| Status | `/status` | ✅ three states incl. degraded Redis |
| 404 | any dead URL | ✅ hard 404, search escape hatch |

`/u/:handle` from the handoff is **not** built: there is no public user endpoint
in the API (only `/api/me/*`), so a public profile has no data to render. The
profile lives at `/me`.

---

## The two structural decisions

### 1. The mobile grid is transposed, and it has a density fallback

The handoff's transpose (episodes as rows, years as columns) is implemented
exactly as specified and is the right call for `@ivankirkov1`: 3 years, 37
episodes in the busiest one, 44px cells, **no horizontal scroll at all**.

It does not survive the other channel. `@comedyclubpodcast` is 11 years with 184
episodes in its busiest year: transposed that is 11 columns of sideways scroll
under a year header that cannot stay sticky inside a horizontal scroller, and
184 rows of vertical page scroll below it.

So the grid picks its mode from the DATA, not the viewport
(`components/grid/grid-model.ts`):

- **Roomy** (`seasons <= 4 && rows <= 48`): the design as drawn. Transposed on
  mobile, years-as-rows with 54x44 cells on desktop, score printed in every cell.
- **Dense** (anything larger): years-as-rows at every width, colour-only chips,
  score in the accessible name and the preview. This is the behaviour
  `specs/03-redesign` already asked for ("a compressed cell without the number").

Both modes ship the same links, the same accessible names and the same preview.

The mobile table is `table-fixed`, which is what guarantees the promise that the
page never scrolls sideways: columns divide the available width evenly whatever
the year count, instead of being pushed out by a `min-width`.

### 2. The preview is layered on by event delegation

2,024 cells on the big channel. Making each one a Client Component would push
the whole grid into the RSC client payload. Instead the cells stay plain
server-rendered `<a href="/e/...">` elements - crawlable, working without JS,
middle-clickable - and one wrapper (`GridInteraction`) reads `data-*` off
whichever cell was hit, opening a bottom sheet on tap and a floating card on
hover after 120ms.

This is also why dropping deep pagination from `/episodes` does not orphan
anything: every episode of a channel is already a crawlable link on its grid
page. `e2e/public-browse.spec.ts` 1.4c pins that guarantee.

---

## Deviations from the handoff, and why

### Accessibility: the palette failed WCAG AA in several places

The handoff verifies contrast for the seven score bands and nothing else. The
neutrals and brand red did not survive `axe`:

| Token | Handoff | Measured | Shipped | Why |
| ----- | ------- | -------- | ------- | --- |
| `--subtle-foreground` dark | `#7A736C` | 3.9:1 on `--background` | `#968F88` | carries meta lines, grid numbers, footer headings; none of it large text |
| `--faint-foreground` dark | `#5E5852` | 2.6:1 | `#8E8780` | same |
| `--subtle-foreground` light | `#867E75` | 3.8:1 | `#6E665D` | same |
| `--faint-foreground` light | `#9E968D` | 2.8:1 | `#766E65` | same |
| `--unrated-foreground` dark | `#6E6862` | 3.0:1 on `--card` | `#968F88` | the "?" on 22% of episodes |
| `--gold` light | `#A8760C` | 3.3:1 on `--elevated` | `#8A6008` | match-reason badge, moment timestamps, search highlight |
| brand red as text | `#E4232C` | 3.9:1 on `--background` | new `--primary-text` `#F0554D` | "всички", "още", "Оцени", active nav |
| `--primary` dark | `oklch(0.6 0.225 27)` | renders `#E82729`, white on it 4.41:1 | the handoff's own hex `#E4232C` (4.59:1) | the oklch and the hex in the same table are not the same colour |
| `--primary-hover` | `#F0463E` | white on it 3.7:1 | `#B81A22` | hover goes darker; contrast has to hold in every state |

The four-step hierarchy (foreground > muted > subtle > faint) is preserved, just
compressed into the range that clears 4.5:1. Band colours are untouched.

### Design elements that need an API change to ship

| Element | Blocker |
| ------- | ------- |
| 1-10 breakdown histogram on the episode page | no endpoint returns the rating distribution; deriving it is one request per rating |
| "Как оценяваш" histogram on the profile | `/api/me/ratings` returns the EPISODES rated, not the scores given |
| ГОДИНА filter on browse | `/api/episodes` has no year parameter; filtering a paginated list client-side would make "показани 9 от 74" lie |
| "Епизод N" in the episode meta line | position-within-year lives only in the grid payload (1 MB for the big channel) |
| Result counts on search-overlay suggestions | `/api/search/suggest` returns `string[]` |

Each of these is omitted rather than faked. The site-wide rating total in the
channels subtitle is replaced by the count of rated episodes, which the grid
payload really carries.

### Other

- **Language.** The handoff states the prototype's Bulgarian copy is final, which
  supersedes the earlier "UI chrome is English" ruling for everything the
  redesign covers. `lib/copy.ts` is the whole surface; `tests/copy.spec.ts`
  fails on any rendered literal that is not in it.
- **Load more** grows `limit` in the URL rather than appending client-side, so
  the deeper list stays server-rendered and shareable.
- **Desktop footer** renders on every route, including the episode page where the
  prototype omits it.

---

## Bugs found and fixed during the build

1. **The search page's example pills prefetched full search renders.** `/search`
   is `force-dynamic`, so every `<Link>` prefetch was a real Meilisearch round
   trip on the server - a dozen fired on paint, and the RSC prefetches never
   settled, so the page never reached network idle. Fixed with
   `prefetch={false}` on every `/search?q=` link.
2. **The theme toggle's `aria-label` was a hydration mismatch.** The icon was
   gated on mount but the label was not, and an attribute mismatch is invisible
   in the rendered page - it only ever surfaces as a console error.
3. **Four effects called `setState` synchronously**, which the React compiler
   lint rejects. All four were restructured into derived state or
   adjust-during-render, not suppressed. `lib/use-hydrated.ts` replaces the
   `useState(false)` + `useEffect(setMounted)` idiom with `useSyncExternalStore`.
4. **Committed API types had drifted** from the live schema (the transcripts
   endpoints from the previous commit were never regenerated). Regenerated.

---

## Verification

| Suite | Command | Result |
| ----- | ------- | ------ |
| Backend | `cd apps/api && uv run pytest` | **350 passed** |
| Frontend unit + contract | `cd apps/web && npx vitest run` | **137 passed** |
| Frontend E2E | `cd apps/web && npx playwright test` | **259 passed**, 0 failed |
| Static gates | `npx tsc --noEmit`, `npx eslint .`, `npx next build` | clean |

E2E was run against a **production build** (`next start`), not `next dev`. The
dev server compiles routes on demand and the failures under parallel load are
compile pressure, not product bugs; the production run is the honest signal.

The E2E suite was rewritten, not relaxed. Notable additions:

- `3.1`-`3.4` walk **both** grid orientations cell by cell against the API.
- `3.10` pins the transpose's three promises at 390px: no page scroll, no grid
  scroll, every cell at least 44px tall.
- `3.11` proves tapping a cell opens the preview instead of navigating, and that
  the preview's CTA is what navigates.
- `9.4` now requires **all three** font families to load a Cyrillic subset.
- `1.4c` proves every episode of a channel is a crawlable link on its grid page.

---

## Files

```
apps/web/
  app/globals.css                     tokens, type scale, motion, reduced-motion
  lib/copy.ts                         every user-facing string
  lib/format.ts                       Bulgarian dates, durations, compact numbers
  lib/score-bands.ts                  band -> colour, unrated is not a band
  lib/auth.ts                         the Clerk seam + opt-in dev identity
  lib/use-hydrated.ts                 server/client snapshot without an effect
  components/shell/                   header, bottom nav, footer, search overlay
  components/grid/                    RatingsGrid, grid-model, GridInteraction
  components/episode/viewer/          rating sheet, watch log, the three placements
  components/browse/                  filter model + bar + sheet
  components/search/                  trigger, result card with match reasons
```
