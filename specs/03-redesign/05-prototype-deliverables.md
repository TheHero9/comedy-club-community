# 📦 Redesign - Prototype Deliverables

**What the design tool must produce, and how to tell whether it is usable.**

---

## 1. Breakpoints - both are required

| Breakpoint | Width | Status |
|-----------|-------|--------|
| **Mobile** | **390 x 844** | 🎯 **Required for every screen.** Design this first. |
| **Desktop** | **1280 x 900** | 🎯 **Required for every screen.** |
| Tablet | 768px | Optional. Only where the mobile-to-desktop jump is not obvious. |

📱 **Mobile-first is not a slogan here.** The audience is overwhelmingly on
phones. If a design only works on desktop, it has failed. If it only works on
mobile, it is still 80% of the value.

---

## 2. Screens to deliver

### Tier 1 - required

| # | Screen | Mobile | Desktop |
|---|--------|--------|---------|
| 1 | **Channel detail with ratings grid** | ✅ | ✅ |
| 2 | Ratings grid - cell states and legend detail | ✅ | ✅ |
| 3 | Ratings grid - cell preview (sheet / hover card) | ✅ | ✅ |
| 4 | **Episode detail** - fully populated | ✅ | ✅ |
| 5 | **Episode detail** - sparse (no moments, no topics, unrated) | ✅ | ✅ |
| 6 | **Rating widget** - the 1-10 interaction | ✅ | ✅ |
| 7 | **Search** - empty query (the teaching state) | ✅ | ✅ |
| 8 | **Search** - with results and match reasons | ✅ | ✅ |
| 9 | **Home** | ✅ | ✅ |
| 10 | **Episodes browse** with filters | ✅ | ✅ |
| 11 | Filter sheet / rail | ✅ | ✅ |
| 12 | **Global shell** - header, bottom nav, footer | ✅ | ✅ |

### Tier 2 - strongly wanted

| # | Screen | Mobile | Desktop |
|---|--------|--------|---------|
| 13 | Channels list | ✅ | ✅ |
| 14 | Profile `/me` | ✅ | ✅ |
| 15 | Search - zero results | ✅ | - |
| 16 | Empty states set (8 cases) | ✅ | - |
| 17 | Leaderboard | ✅ | ✅ |
| 18 | Sign-in prompt | ✅ | - |

### Tier 3 - if there is room

404, `/status`, topic page, person page, watch history, personal tags, error
state, skeleton set.

---

## 3. Also deliver

1. 🎨 **Colour palette** - the full token set in `oklch()`, dark theme required,
   light theme optional. Must include the seven score-band colours reworked for
   dark-mode contrast **without colliding with the new brand hue**.
2. 🔤 **Type scale** - families, sizes, weights, line heights, for both
   breakpoints. 🚨 **Every family must cover Cyrillic.**
3. 📏 **Spacing, radius and elevation ladders**, expressed in Tailwind's scale.
4. 🧩 **Component sheet** - each component from
   [`04-component-inventory.md`](04-component-inventory.md) with all its states.
5. 🎬 **Motion notes** - what animates, how long, and what must not animate.
   Respect `prefers-reduced-motion`.

---

## 4. ✅ Acceptance checklist

A prototype is usable when all of these hold.

### Mobile
- [ ] Every screen exists at **390px**.
- [ ] 🚨 **No screen scrolls horizontally.** Wide content (the ratings grid, chip
      rows) scrolls **inside its own container**. This is enforced by an
      automated test on every route.
- [ ] Every tap target is at least **44 x 44px**.
- [ ] Every text input is **16px or larger** (smaller makes iOS Safari zoom and
      never unzoom).
- [ ] Primary actions are reachable by thumb.

### Content
- [ ] 🚨 Every title slot handles a **long Bulgarian title over 2-3 lines** with a
      specified clamp. Compound words must not overflow.
- [ ] 🚨 **Cyrillic renders in the intended typeface**, not a fallback.
- [ ] Every screen is shown with **real Bulgarian content**, not lorem ipsum and
      not English placeholder titles.
- [ ] Layouts survive **sparse data**: no topics, no moments, a 40-character
      description, no rating.

### Semantics
- [ ] 🚫 **No emoji anywhere in the UI.** Every icon is a lucide icon.
- [ ] 🚫 **No em-dash or en-dash** in any copy. Plain hyphen only.
- [ ] Unrated reads as "no data", **never as `0`** and never as the `garbage`
      band.
- [ ] Grid holes read as "this year was shorter", never as a zero score.
- [ ] Provisional scores carry a visible qualifier.
- [ ] Public and elite scores are distinguishable, and elite is presented as a
      **different lens, not a better one**.
- [ ] 🔒 Personal tags are visually unmistakable as **private**.
- [ ] 🔒 No verification screenshot appears anywhere.

### States
- [ ] Every list has an **empty** state that is an invitation, not an apology.
- [ ] Every async surface has a **loading skeleton**.
- [ ] There is a designed **error** state for a dead API.
- [ ] Signed-out users see the actions and get a **sign-in prompt**, rather than
      the actions being hidden.

### Accessibility
- [ ] Text meets **4.5:1** contrast against its background - including the score
      number on every one of the seven band colours.
- [ ] Colour is never the **only** carrier of meaning. The band colours need the
      number or a label alongside.
- [ ] Focus states are visible on every interactive element.
- [ ] Every icon-only control has a visible or assistive label. (The header logo
      shipped without one and failed an automated audit.)
- [ ] One `<h1>` per screen, headings in order.

### Buildability
- [ ] Everything maps to **Tailwind v4** and **shadcn/ui** primitives.
- [ ] Nothing requires a component library other than shadcn.
- [ ] Nothing requires data the API does not return - check against
      [`02-data-reality.md`](02-data-reality.md).
- [ ] 🚫 No design depends on **chapters** (0 of 74 episodes have any).
- [ ] 🚫 No design depends on a **long description** (average is 109 characters).
- [ ] 🚫 No design depends on a **channel banner** (not reliably populated).
- [ ] 🚫 No design embeds or plays video. Every watch action opens YouTube.

---

## 5. 🚩 The five hard problems

Worth stating plainly, because these are where a generic prototype will fail.

1. 🎯 **The ratings grid at 390px.** Three years x 37 columns is about 2,100px
   wide. Cells need 44px touch targets, a sticky year column, and up to three
   markers per cell. This is the single hardest problem in the project and the
   most valuable to solve well.
2. 🎯 **A 1-10 rating control on a phone.** Ten 44px targets need 440px and the
   screen is 390px.
3. 🎯 **Making search look like the point of the product.** It currently looks
   like a newsletter signup. The `matched_topics` and `matched_moments` fields
   are the whole argument for this site existing and are rendered as 10px grey
   badges.
4. 🎯 **Designing for sparseness.** 22% of episodes are unrated, most have no
   moments, average description is one short sentence, and only 3 people exist in
   the entire database. **The sparse episode page is the common case, not the
   edge case**, and it must look intentional.
5. 🎯 **Giving a greyscale app an identity** without breaking the seven band
   colours that carry real meaning.

---

## 6. Reference

| File | What it holds |
|------|---------------|
| [`01-design-brief.md`](01-design-brief.md) | Product, audience, constraints, current-state critique |
| [`02-data-reality.md`](02-data-reality.md) | Every API field and how much of it is populated |
| [`03-page-map.md`](03-page-map.md) | Every page in detail |
| [`04-component-inventory.md`](04-component-inventory.md) | Every component, variant and state |

**Live app for reference:** `http://localhost:3100` (dev server), API at
`http://localhost:8000`. The one ingested channel is at
`/channels/ivan-kirkov`, and a real episode is at `/e/utcF7etPyyk`.

⚠️ **The current UI is unstyled shadcn defaults.** Use it to understand structure
and data, not as a visual starting point.
