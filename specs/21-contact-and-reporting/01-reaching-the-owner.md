# Reaching the owner: a contact card and a report button that is always there

**Date:** 2026-08-18
**Status:** ✅ Built

---

## The ask

> "can we add to the app somewhere how to contact me if something happens for
> contact? we need somewhere so i can put my instagram or email"

and, minutes later:

> "the report button would be amazing if we have it also on the profile so they
> can report random problems from the app in general or even better place it on
> the top navbar actually with small button which opens form on the current
> [page]"

Two halves of one problem: **the site had no way to reach a human, and its one
way to say "this is broken" was almost unreachable.**

---

## What was actually wrong

### 1. There was no contact detail anywhere in the product

Not on the profile, not in the footer, not in the settings sheet. A member who
hit a bug the report form does not cover - "I paid for a membership and the
badge never appeared", "you have the wrong person tagged in 40 episodes" - had
nowhere to go.

### 2. Reporting was reachable from two places, and one of them does not exist on a phone

`ReportDialog` shipped in wave 13 with exactly two call sites:

| Where | Visible at 390px? |
| ----- | ----------------- |
| `SiteFooter` (site-wide, targetless) | ❌ the footer is `hidden md:block` |
| the episode page (targeted) | ✅ but only while standing on that episode |

So on a phone - which is most of this audience - **the only way to report
anything was to be on the episode that was wrong.** "The search returns
nothing", "the site is slow", "I cannot sign in": none of those has an episode
to attach to, and the one entry point built for exactly that case was on a
surface phones never render.

---

## What was built

### `lib/contact.ts` - the values, once

```ts
export const CONTACT = {
  instagram: "dimi.v.9",   // without the "@" - the UI adds it, the URL must not have it
  email: "dimitrios.v.2002@gmail.com",
} as const;
```

- 🚨 **NOT in `lib/copy.ts`.** A handle and an address read identically in
  English and in Bulgarian, so putting them in the dictionary means two
  duplicate entries that can drift apart, and changing an address becomes a
  two-file edit with one half easy to forget. **The label around a value is
  copy; the value is data.**
- 🚨 **An empty string means "not published".** `HelpContact` drops the row
  rather than rendering a dead link, so unpublishing a channel is a one-line
  change in this file and nowhere else.
- 🔒 **These are public values in a public repo.** They ship in the client
  bundle, in the rendered HTML and in git history forever. Nothing goes in here
  that is not already meant to be handed out. The owner was told this before the
  address was written down and chose their personal address anyway - that is a
  decision on record, not an oversight.

### `components/profile/HelpContact.tsx` - on `/me`, in BOTH branches

The owner picked the profile over a dedicated `/help` route. That is the right
call for one reason that has nothing to do with the profile: **the desktop
footer does not exist below `md`, and `/me` is one of the four things in the
mobile bottom bar.** It is the only always-reachable page on a phone that is not
a content listing.

- 🚨 **It renders in the signed-OUT branch too.** `/me` returns early when there
  is no viewer, and someone who cannot sign in is precisely the person who needs
  the address. Rendering it only in the signed-in branch would have hidden it
  from the visitor it was written for.
- 🚨 **The Instagram icon is an inline SVG, not an import.** `lucide-react` v1
  removed every BRAND icon, so `import { Instagram }` fails typecheck outright.
  It is drawn to lucide geometry (24 box, `currentColor`, round caps) so it
  carries the same visual weight as the `Mail` beside it. This is not a licence
  to hand-roll icons generally - lucide stays the source for everything it still
  ships.
- The `mailto:` carries a prefilled subject, so a message arriving among a
  thousand others still says which site it came from.

### `ReportSheetButton` - one flag in the header, on every route

- 🚨 **A sheet, not the inline form, and not a link to another page.** The whole
  value of reporting from the header is that it is filed from wherever the
  problem is: navigating away loses the page being described, and the inline
  form cannot expand inside a 54px sticky header.
- 🚨 **`ReportForm` was extracted so there is ONE implementation.** Two copies of
  a form posting to a throttled, deduplicated write endpoint are two places for
  the 409 handling to drift apart, and the duplicate branch is the half nobody
  re-tests. `layout` decides only who draws the chrome - `inline` draws its own
  card and heading, `sheet` lets the Sheet own the title and description it
  already renders, so the same two lines do not appear twice.
- 🚨 **It carries no target, so its categories are the two site-wide ones**
  (`bug`, `suggestion`). That is not a limitation, it is the definition: a
  header report is by construction about the site. The API enforces the same
  split.
- 🚨 **`size="icon"` exactly like the settings button beside it.** `.tap-target`
  grows the hit area to 44px with an **invisible** pseudo-element: at 390px a
  38px control grows 3px a side into an 8px gap, so two of them meet at 6px and
  do not overlap. A larger control here would silently start swallowing its
  neighbour's taps with nothing on screen to show it. `ios-safari.spec.ts` 14.5
  measures the union of box and pseudo for every header control and passed
  unchanged with the third button added.

---

## The trap this nearly walked into

While moving the form, its `select` and `textarea` were "fixed" from
`text-small` to `text-base`, reasoning about the iOS focus-zoom bug from
[`19-ios-safari-compatibility`](../19-ios-safari-compatibility/01-findings.md).

**That was wrong, and it was wrong in the direction that looks careful.** The
iOS fix is not a class on the element - it is the unlayered rule in
`globals.css` that raises every `input`/`textarea`/`select` to 16px **scoped to
`(pointer: coarse), (max-width: 767px)`**. Hardcoding 16px on the element wins
on desktop too, where the handoff specifies 13px and where focus zoom is not a
behaviour that exists. Reverted, with the reasoning written next to the class so
the next person does not re-derive it wrong.

⚠️ Generalisable: **when a global rule already handles a case, restating it
locally does not add safety - it silently widens the scope the global rule was
deliberately narrowed to.**

---

## Verification

| Check | Result |
| ----- | ------ |
| `npm run typecheck`, `eslint` on the five touched files | ✅ clean |
| `npx vitest run` (incl. the copy-discipline scanner) | ✅ 231 passed |
| `e2e/ios-safari.spec.ts` + `e2e/a11y.spec.ts`, all projects | ✅ 74 passed - incl. 14.5 header touch targets on real WebKit with the third button |
| Driven at 390x844 against the production build | ✅ header flag opens the sheet over the page, two site-wide categories, zero console errors |
| Both links resolved from the DOM | ✅ `https://www.instagram.com/dimi.v.9/`, `mailto:...?subject=Comedy%20Community` |
| `npm run benchmark` + `tests/perf-budget.spec.ts` | ✅ 35 budgets green |

---

## Left undone, deliberately

- **No `/help` route.** Offered and declined in favour of the profile. If a FAQ
  is ever wanted, that is the moment to add one - a contact card does not need
  its own page.
- **The report form is still not on `/me` as its own section.** The header
  button is on `/me` like everywhere else, so a second trigger on that page
  would be two controls doing one thing within 400px of each other.
- **No contact detail in the settings sheet.** Same reasoning: the header flag
  is already adjacent to the gear.
