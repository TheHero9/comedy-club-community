# A toast in the way, a calendar that could not count, and a history with no dates

**Date:** 2026-09-22
**Trigger:** an owner walkthrough of the watch-log feature shipped in `0a6b5ed`
**Status:** fixed

Three reports, all on the same feature, all of the shape "it works and it is
annoying". None of them was a bug in the sense of an error; every one was a
piece of information the product had and did not show, or a control it
covered up.

---

## 1. The toast sat ON the header and blocked it

> "You can't press the profile icon or anything from the top bar while this
> thing is visible... you have to dismiss the notification so you can press
> anything."

The confirmation pill ("Viewing logged") hung at `top: 14px`, which is the
sticky header's own strip. Two things made it worse than it sounds:

- On any viewport under 600px, sonner stretches each toast to the **full
  width** of the screen (`width: calc(100% - 2 * offset)`), and the wrapper
  `<li>` takes pointer events by default. So the pill itself was ~200px wide,
  but the invisible strip it sat in was the whole header, edge to edge.
- Auto-dismiss is 2.2s. That is exactly long enough to tap the avatar, get
  nothing, and tap again.

**Fix, two halves (`components/ui/sonner.tsx`):**

- The toaster is offset **below** the header: 64px + 10 on desktop, 54px + 10
  on mobile via `mobileOffset`. Sonner's mobile breakpoint is 600px and the
  header grows at 768px, so between the two the pill sits 10px lower than it
  strictly needs to - harmless.
- The toast wrapper is `pointer-events-none`; the pill inside already had
  `pointer-events-auto`. Only the visible thing can intercept a tap now.

Hover-to-pause and swipe-to-dismiss still work: the pill's own pointer events
bubble up to sonner's handlers on the wrapper.

## 2. A day with two viewings looked like a day with one

> "I can't see if I have watched two podcasts, visually any difference than
> the other days."

The profile calendar lit a day green and stopped there. The data was already
grouped per day (`byDay`), so the count was one `.length` away.

**Fix (`components/profile/WatchCalendar.tsx`):** a small ink badge in the
cell's top-right corner with the count, rendered only when it is above one.

- **A badge, not a deeper green.** Score bands are the only thing in this
  product allowed to carry meaning through colour alone, and a second shade of
  the "awesome" green next to the first would read as a different score, not a
  count.
- **`aria-hidden` on the badge**, and the count moved into the button's
  `aria-label` (`5 March 2026, 2 viewings`). Otherwise the accessible name of
  the 5th with two viewings is "52".
- The hint copy under the title now mentions the count, in both dictionaries.

## 3. The history page said nothing about WHEN

> "You won't see the date you have watched them on... if I watched it on the
> 30th of December and today, we should see both dates on this podcast."

`/api/me/watched` returned the plain `EpisodeBriefOut`, ordered by the latest
viewing but carrying no viewing at all. A rewatched episode was one card,
indistinguishable from a single viewing.

**Fix, API:** `WatchedEpisodeOut` extends the brief with `watched_on:
list[date]` (newest first) and `watch_count`; `/me/watched` returns
`WatchedListOut`. The dates come from **one second query** over the page's
episode ids, grouped in Python:

- Not a join - joining `watch_events` onto the episode list multiplies the
  rows by their viewings and breaks the pagination that `distinct()` is there
  to protect.
- Not a per-card lookup - that is the N+1 the list endpoints are built to
  avoid.

Two pytest cases pin it: every date comes back newest-first including a
same-day rewatch, and Bob's viewing of the same episode never lands on
Alice's card.

**Fix, web:** the history list wraps each card and prints `Watched: 22 Sep
2026, 30 Dec 2025` under it with a `History` icon. Only the history key
carries dates; ratings and favourites render exactly as before. Types were
regenerated into `packages/api-types` from the OpenAPI schema (dumped via
`api.get_openapi_schema()` since the API was not running locally).

---

## What to carry forward

- **A fixed-position overlay is a hit-test problem before it is a layout
  problem.** Check what is UNDER it, at phone width, where sonner goes
  full-bleed.
- **If the data is grouped, the count is free - show it.** A calendar that
  lights a day but cannot say "twice" is throwing away the one fact the
  grouping computed.
- **A page named "history" must show dates.** Same family as "an endpoint
  with no reader is not a feature": a list ordered by a date it does not print
  is a list the reader cannot verify.
