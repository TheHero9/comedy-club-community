# 🎨 Redesign - Design Brief

**Created:** 2026-08-08
**Status:** 📋 Ready to hand to a design tool
**Audience of this document:** a design AI producing high-fidelity prototypes, and
whoever implements them afterwards.

> **Read this file first, then `02-data-reality.md`, then `03-page-map.md`.**
> This document is written to be understood with **zero prior context**.

---

## 1. What this product is

**Comedy Club Community** is a searchable community hub for a group of
**Bulgarian YouTube podcast channels**.

There are roughly **6-8 channels and about 1,000 episodes** in the finished
product. Today **one channel with 74 episodes** is ingested; the rest are coming.
Around **1,000 users** are expected. This is a small, high-affection community
site, not a mass-market product.

### The problem it solves

**YouTube's search across these channels is bad.** You remember that one episode
where the guest talked about a broken fridge, but you cannot find it. The channel
has 300 videos, the titles are jokes, and the descriptions are two lines long.

This site fixes that by letting the community label episodes themselves:

- **Topics** - canonical, deduplicated subject tags voted on by users
- **Moments** - a timestamp plus a short label, e.g. `1:42:10 - the fridge story`
- **Ratings** - 1 to 10, from everyone, plus a separate score from verified
  paying channel members
- **Participants** - who was in the episode

Then it makes all of that searchable, with **Bulgarian typo tolerance**.

### The one-sentence thesis

> Search for a misspelled Bulgarian phrase describing something that happened in
> an episode, and find the episode - even though those words appear nowhere in
> its title or description.

That already works. The redesign must make it **feel** like the point of the
product, because right now nothing in the UI communicates it.

---

## 2. Who uses it

| | |
|---|---|
| **Size** | ~1,000 users |
| **Language** | Bulgarian speakers. **Content is Bulgarian. UI chrome is English.** |
| **Device** | 📱 **Overwhelmingly mobile.** Design mobile-first and mean it. |
| **Motivation** | Fans of the shows. They rewatch, argue about rankings, and hunt for specific bits. |
| **Sophistication** | Consumer-grade. Not developers. Nothing may require explanation. |

### Three user modes to design for

1. **The browser** - opens the site with no goal, wants something good to watch.
   Needs: what's new, what's highly rated, what's popular.
2. **The hunter** - remembers a specific bit and wants to find it. Needs: search
   that tolerates misspellings, and results that show **why** they matched.
3. **The completist** - tracks what they've seen and rates everything. Needs: the
   ratings grid, their own profile, fast rating from anywhere.

The **ratings grid** (see below) mostly serves modes 1 and 3 and is the single
most distinctive screen in the product.

---

## 3. 🏆 The signature screen: the ratings grid

This is the thing to design best. It is the feature the owner asked for by name.

It is an **IMDb / SeriesGraph-style episode heatmap**, adapted:

- A podcast has no seasons, so **one calendar year = one season**.
- **Rows are years.** **Columns are the episode's position within that year.**
- Each cell is one episode, coloured by its score band, showing the score to one
  decimal.
- Clicking a cell goes to that episode.
- The row header shows the year and that year's average.
- There is a **Public / Elite** toggle that re-renders the whole grid.

Current real shape for the one ingested channel: **3 rows (2024, 2025, 2026) x 37
columns**, 71 filled cells and 37 holes (shorter years leave gaps).

### Seven score bands

The API owns the thresholds and returns a **semantic key**. The design owns the
colour. Current mapping runs blue -> green -> yellow -> orange -> red:

| Key | Label | Min score | Current colour |
|-----|-------|-----------|----------------|
| `masterpiece` | Absolute cinema | 9.5 | sky-400 |
| `awesome` | Awesome | 8.5 | emerald-400 |
| `great` | Great | 7.5 | green-300 |
| `good` | Good | 6.5 | lime-200 |
| `regular` | Regular | 5.5 | amber-300 |
| `bad` | Bad | 4.0 | orange-400 |
| `garbage` | Garbage | 0.0 | red-500 |

Plus three states that are **not** bands and must never be styled as `garbage`:

- **Not rated** - score is `null`. Renders `?`, muted. **Never `0`.**
- **Hole** - the year is shorter than the longest year. Renders **empty**, is not
  a link, has no border. **Never a zero.**
- **Provisional** - fewer than 3 ratings. Shown with its band colour plus a small
  warning marker, because the number is not yet trustworthy.

Two more per-cell markers: **members-only** (crown) and **stream** (radio icon).

> 🎨 **Design task:** the current colours are functional but crude, and at 390px
> the cells are 56x36px which is cramped. Rework the palette for dark mode
> contrast and rethink the mobile presentation. The grid **must scroll inside its
> own container** - the page body must never scroll sideways.

---

## 4. 📐 Current state, honestly

The app works and is fully tested (666 automated tests), but it is
**visually unstyled**. It is shadcn/ui defaults with nothing on top.

### What is wrong right now

| Problem | Detail |
|---------|--------|
| 🎨 **Zero brand identity** | Every colour token is `oklch(x 0 0)` - literally **zero chroma**. The entire app is greyscale except the seven band colours. There is no brand hue, no accent, nothing memorable. |
| 🌑 **Dark only** | `<html className="dark">` is hardcoded. `next-themes` is installed but there is no toggle and no light palette worth shipping. |
| 📄 **Everything is a bordered rectangle** | Cards, lists and panels all use the same `rounded-lg border bg-card`. No hierarchy, no rhythm, no texture. |
| 🔤 **One typeface, one weight ladder** | Geist Sans for everything including headings (`--font-heading` just points at `--font-sans`). Nothing signals "this is a comedy podcast site". |
| 📱 **Mobile is a narrowed desktop** | Layouts collapse to one column but nothing is genuinely designed for a thumb. No bottom navigation, no sticky actions. |
| 🕳️ **No empty, loading or error states** | Most empty states are a single grey sentence. There is one skeleton, on `/status` only. |
| 🖼️ **Thumbnails are underused** | Every episode has a guaranteed 1280x720 image and the design barely uses it. |
| 🔍 **Search does not look like the product's core** | It is a plain input on a plain page, visually identical to every other route. |

### What is already right and must be preserved

- ✅ **Dark-first** is the correct default for this audience. Keep dark as the
  primary design; a light theme is a bonus, not a requirement.
- ✅ **The band colour semantics** (blue = best, red = worst). Refine the hues,
  keep the meaning.
- ✅ **Icons from `lucide-react`.** Already consistent.
- ✅ **Bulgarian text renders correctly** with the Cyrillic font subset loaded.

---

## 5. 🚨 Non-negotiable constraints

These are technical facts, not preferences. A prototype that violates them cannot
be built.

### Stack

- **Next.js App Router + TypeScript.** Public pages are **Server Components**;
  only interactive bits (rating widget, watch button, comment form, theme toggle)
  are Client Components.
- **Tailwind CSS v4.** Design in Tailwind's scale (spacing, radius, breakpoints).
- **shadcn/ui only.** Never MUI, Ant Design, Chakra, Mantine.
- ⚠️ **shadcn's current style is `base-nova`, which is built on **Base UI**, not
  Radix.** Composition uses a `render` prop, not `asChild`. This matters if the
  prototype specifies component behaviour.
- **Icons: `lucide-react` exclusively.**

### Hard rules

- 🚫 **No emoji anywhere in rendered UI.** Not in labels, not in toasts, not in
  empty states. Use a lucide icon. (Emoji in this document is fine - it is not
  shipped.)
- 🚫 **No em-dash (U+2014) or en-dash (U+2013) in any UI copy.** Plain hyphen
  only. This is enforced by an automated test that scans the repo, so a
  prototype's copy must not contain them either.
- 🚫 **Never mirror or re-host a thumbnail.** Every episode image is a derived
  Google CDN URL built from the video id:
  `https://img.youtube.com/vi/{VIDEO_ID}/maxresdefault.jpg` (1280x720). Design
  around a **16:9 image that is always available**.
- 🔒 **Verification screenshots are private.** They appear only in the Django
  admin, never in any public design.
- 🔒 **Personal tags are private to their author.** Never shown on a public page.
- 🌍 **All UI copy lives in `lib/copy.ts`**, never inline in a component. A BG/EN
  toggle is a likely v2, so **avoid designs where English text length is
  load-bearing** - Bulgarian strings are frequently 20-40% longer.

### Language

- **UI chrome: English.** Nav, buttons, labels, empty states.
- **Content: Bulgarian.** Episode titles, descriptions, topic names, moment
  labels, comments, people names.
- ⚠️ **Bulgarian titles are long and full of compound words.** Design every title
  slot for **two lines minimum** at 390px and specify the truncation rule. Never
  assume a title fits on one line.

---

## 6. 📱 Mobile-first, concretely

**Primary target: 390 x 844** (iPhone 14 / Pixel-class). Design this first, in
full, for every page. Desktop is the adaptation, not the other way round.

| Breakpoint | Width | Role |
|-----------|-------|------|
| **Mobile** | **390px** | 🎯 **Primary.** Every prototype must exist here. |
| Tablet | 768px | Transitional. Two columns where it helps. |
| **Desktop** | **1280px** | 🎯 **Required.** Wider content, persistent sidebars, denser grid. |
| Wide | 1536px+ | Cap the content width. Do not let text lines run long. |

### Mobile rules

1. **No horizontal page scroll, ever.** Wide things (the ratings grid, tag rows,
   tables) scroll **inside their own container**. This is enforced by an
   automated test on every route.
2. **Touch targets 44x44px minimum.** The current grid cells are 56x36px, which
   fails this. Solve it.
3. **Text inputs must be 16px or larger.** Anything smaller makes iOS Safari zoom
   the viewport on focus and never zoom back.
4. **Thumb reach matters.** Primary actions belong in the bottom half of the
   screen. Consider a bottom nav bar and a sticky action bar on the episode page.
5. **The header is sticky and 56px tall.** It may be redesigned but must stay out
   of the way when scrolling a long episode list.

---

## 7. 🎯 What the redesign must achieve

In priority order:

1. **Give the app an identity.** It is a community site for comedy podcasts. It
   should feel warm, a bit playful and confident - not a corporate dashboard, not
   a generic dark SaaS template. Pick a real brand hue and use it.
2. **Make the ratings grid a showpiece.** It is the most distinctive thing here.
   It should be the screenshot someone shares.
3. **Make search feel central.** Give it presence in the header on every page and
   design a results page that shows **why** each result matched (the matched
   topic and moment labels are returned by the API and are currently rendered as
   tiny grey outline badges).
4. **Design for sparse data.** See `02-data-reality.md`. Many episodes have no
   topics, no moments, and a 40-character description. **An episode page with
   almost nothing on it must still look intentional**, because most of them are.
5. **Design the states nobody designed.** Empty, loading, error, unrated,
   not-signed-in. There are currently almost none.
6. **Design the signed-in surface.** Rating, watch-logging, favourites, personal
   tags and profiles all exist in the API but have **no UI at all** yet.

---

## 8. What is out of scope

- ❌ **No transcription.** There are no transcripts and none are planned for v1.
- ❌ **No video playback on-site.** Every watch action opens YouTube in a new tab.
  We never host or embed the media.
- ❌ **No mobile app design.** The API is built so a React Native app can come
  later, but that is not this.
- ❌ **No admin or moderation UI.** Moderation happens in the Django admin.
  Exception: the user-facing **report** action (a small menu item plus a confirm
  dialog) is in scope.

---

## 9. Where to go next

| File | What it holds |
|------|---------------|
| [`02-data-reality.md`](02-data-reality.md) | Every field the API returns, and **how much of it is actually populated**. Read before designing any page. |
| [`03-page-map.md`](03-page-map.md) | 🎯 **The core deliverable.** Every page: purpose, data, every element, what to show and hide, mobile and desktop layout, every state. |
| [`04-component-inventory.md`](04-component-inventory.md) | Every component to design, with variants and states. |
| [`05-prototype-deliverables.md`](05-prototype-deliverables.md) | Exactly what to produce, at which breakpoints, and the acceptance checklist. |
