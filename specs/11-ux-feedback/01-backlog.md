# 11 - Post-launch UX feedback backlog

**Source:** owner walkthrough of the live site, 2026-08-15, four days after launch.
The whole app was exercised signed-in via Google for the first time.

**Ruling:** all 31 items approved for work in one pass. Three blocked items were
resolved in the same message:

| Blocked item | Ruling |
| ------------ | ------ |
| #4 i18n | ✅ **Approved, reversing the CLAUDE.md deferral.** Installing an i18n dependency is fine. **English becomes the DEFAULT locale** - the Bulgarian UI chrome "sounds a bit cringe". Content (episode titles, descriptions, topic labels, moments, transcripts) stays Bulgarian in both locales. |
| #8 channel order | ✅ Approved. Manual curated order, NOT episode count. |
| #15 prod DB delete | ✅ Approved, local and production. |
| #2 handle policy | The display name and the handle are different things. The handle is **the user's YouTube handle**, so subscriptions and memberships can be linked to it later. Assigned by us, not free-form user input. |

---

## The 31 items

Effort: 🟢 small · 🟡 medium · 🔴 large

### Auth and profile

| # | Task | Effort |
| - | ---- | ------ |
| 1 | Google sign-in renders the Clerk `sub` (`user_2abc...`) as the display name | 🟢 |
| 2 | Display name and handle must be different values; handle = YouTube handle | 🟢 |

### Settings

| # | Task | Effort |
| - | ---- | ------ |
| 3 | Settings surface with a light/dark switch | 🟡 |
| 4 | EN/BG language toggle, English default, chrome only | 🔴 |

### Nav and home

| # | Task | Effort |
| - | ---- | ------ |
| 5 | Remove the "Podcast Index" wordmark from the nav | 🟢 |
| 6 | Remove the suggestions dropdown under the search bar | 🟢 |
| 7 | Home drops "newest episodes"; becomes search-first with channels below | 🟡 |
| 8 | Channels render in a fixed curated order | 🟡 |

### Search

| # | Task | Effort |
| - | ---- | ------ |
| 9 | Overlay: bar jumps to the top on typing; keep the bar, animate the transition | 🟡 |
| 10 | Remove the "found in N ms" readout | 🟢 |
| 11 | Split results into title matches first, then everything else | 🟡 |
| 12 | Uncap results (header said 38, only 21 rendered) + virtualise | 🟡 |
| 13 | Drop the repeated Bulgarian prefix before every moment timestamp | 🟢 |

### Episodes list

| # | Task | Effort |
| - | ---- | ------ |
| 14 | Channel filter chips show the icon only, no name | 🟢 |
| 15 | Delete the junk participant row from local and production | 🟢 |
| 16 | Filter clicks feel laggy | 🟡 |
| 17 | Channel avatar badge on episode cards here too | 🟢 |
| 18 | Mobile filter bar overflows horizontally | 🟢 |

### Channel page

| # | Task | Effort |
| - | ---- | ------ |
| 19 | Remove the channel description block | 🟢 |
| 20 | Collapse the ratings-grid legend behind an expander | 🟢 |

### Episode page

| # | Task | Effort |
| - | ---- | ------ |
| 21 | The date renders twice | 🟢 |
| 22 | Description collapsed by default | 🟢 |
| 23 | Topic chip click has a visible delay | 🟡 |
| 24 | "Similar episodes" must say WHY each one is similar | 🟡 |
| 25 | Confirm before removing a rating or un-marking watched | 🟢 |
| 26 | Action bar overflows on mobile; the last button is off-screen | 🟡 |
| 27 | Clicking an already-logged date should remove it | 🟢 |
| 28 | Delay on the watch-log "next" control | 🟢 |
| 29 | Remove the redundant "open episode" button | 🟢 |
| 30 | Link from an episode to the full ratings grid | 🟡 |

### Cross-cutting

| # | Task | Effort |
| - | ---- | ------ |
| 31 | Perceived latency on every interactive control (covers 16, 23, 28) | 🟡 |

---

## Decisions taken while building

### i18n: cookie-driven, pages go dynamic

The site is Server-Component-first, so the locale has to be known **on the
server**. Three options were weighed:

| Option | Verdict |
| ------ | ------- |
| `app/[locale]/` route segment + proxy rewrite | Correct and keeps ISR, but moves all 13 route files and puts the hard-won `notFound()` behaviour at risk. Rejected on risk, not on merit. |
| Client-side swap after hydration (the `next-themes` pattern) | Cheap, but Server Components cannot re-render on the client, so half the page would stay English. **Does not actually work here.** |
| ✅ Cookie read via `next/headers`, pages dynamic | Chosen. |

The cost is that page-level `revalidate = 60` goes away and HTML is rendered per
request. **Data fetching is unaffected** - `lib/api/podcast.ts` already carries
its own `PUBLIC_CACHE = { next: { revalidate: 60 } }` at the fetch layer, so the
API round trips stay cached exactly as before. `/search` and `/status` were
already `force-dynamic`, so this is an existing pattern, not a new one.

⚠️ Watch `medianMs` in the perf budgets after this lands. `payloadKb` is
unaffected (same HTML), but TTFB now includes a render.

### The copy module stays scannable

`tests/copy.spec.ts` enforces "no hardcoded user-facing string" by parsing every
`.tsx` and matching `copy.<key>` references. The migration therefore keeps the
local variable named `copy` in every component:

```ts
// server component
const copy = await getCopy();
// client component
const copy = useCopy();
```

so the scanner keeps working with no change to the test. `lib/copy.ts` still
exports a plain `copy` (the English dictionary) for the test and for non-React
modules such as `lib/api/client.ts`.
