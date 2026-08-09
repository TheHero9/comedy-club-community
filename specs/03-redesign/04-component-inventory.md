# 🧩 Redesign - Component Inventory

**Every component to design, with its data, variants and states.**

> Components marked ✅ exist and need redesigning. Components marked 🔨 do not
> exist and must be designed from scratch.

---

## 1. Design tokens

### 1.1 🎨 Colour - the biggest gap

**Current state: there is no brand colour.** Every semantic token is
`oklch(x 0 0)` - zero chroma, pure greyscale. The only colour in the entire
product is the seven score bands.

```
Dark theme (the default and currently the only theme)
--background        oklch(0.145 0 0)   near-black
--foreground        oklch(0.985 0 0)   near-white
--card              oklch(0.205 0 0)
--muted             oklch(0.269 0 0)
--muted-foreground  oklch(0.708 0 0)
--border            oklch(1 0 0 / 10%)
--primary           oklch(0.922 0 0)   ← a light grey, used for primary buttons
--destructive       oklch(0.704 0.191 22.216)  ← the only non-grey token
--radius            0.625rem
```

🎯 **Deliverable: a real palette.** Pick a brand hue that suits a Bulgarian
comedy podcast community - warm and confident, not corporate blue. Define:

- `--primary` and `--primary-foreground` in the brand hue.
- An `--accent` for secondary emphasis.
- Full `--background` / `--card` / `--popover` / `--muted` / `--border` ladders.
- ⚠️ **Do not collide with the seven band colours** - they carry meaning and must
  stay unambiguous against whatever brand hue is chosen.
- Keep `oklch()`. Tailwind v4 and shadcn use it natively.
- Optional: a light theme. Dark is the priority.

### 1.2 🔤 Typography

**Current:** Geist Sans for everything, Geist Mono for timestamps and code.
`--font-heading` just aliases `--font-sans`, so headings have no distinct voice.

🚨 **Any display or heading typeface MUST support Cyrillic.** This is not
negotiable - every episode title, topic and comment is Bulgarian. A font without
the Cyrillic range will silently fall back per-glyph and the content area will
render in a different typeface from the chrome. This has already happened once in
this project.

Deliverable:
- A heading typeface with Cyrillic coverage, or a deliberate decision to keep
  Geist and differentiate by weight and size.
- A type scale for both breakpoints.
- ⚠️ **Bulgarian strings run 20-40% longer than English.** Never let a layout
  depend on a specific text length.

### 1.3 📏 Spacing, radius, elevation

Tailwind v4 defaults, `--radius: 0.625rem`. Everything currently uses
`rounded-lg border bg-card` with no elevation, which is why the whole app reads
flat and samey. Define a small elevation ladder and vary radius by component size.

---

## 2. Existing components to redesign

### 2.1 ✅ `EpisodeCard` - the most reused component in the app

Appears on: home (twice), episodes browse, search results, channel detail, and
every future signed-in list.

**Data:** `EpisodeBriefOut` - thumbnail, title, channel name, upload date,
duration, `public_score`, `elite_score`, `rating_count`, `band`, `members_only`,
`content_kind`.

**Must design these variants:**

| Variant | Where | Notes |
|---------|-------|-------|
| **Standard** | grids | Thumbnail 16:9, title, channel, date, duration, score chip |
| **Compact / list row** | mobile lists, search | Horizontal, small thumbnail |
| **Ranked** | leaderboard, home top-5 | Adds a rank number, podium styling for 1-3 |
| **With match reasons** | search results | 🎯 Adds matched topic and moment labels |
| **With viewer state** | signed-in lists | Adds the user's own score, watched tick, favourite |

**Every state:**
- ⚠️ **Unrated** (22% of episodes) - score chip must read as "no rating", never `0`.
- **Provisional** (under 3 ratings) - a visible qualifier.
- **Members only** - crown badge.
- **Stream** - radio badge.
- ⚠️ **Long Bulgarian title** - specify the clamp (2 lines? 3?) and make sure a
  compound word cannot overflow at 390px.
- **Loading** - skeleton matching the exact card shape.

⚠️ The thumbnail is **always** present and always 16:9 at 1280x720. Use it.

### 2.2 ✅ `RatingsGrid` 🎯 The signature component

Fully specified in [`03-page-map.md`](03-page-map.md) section 3.1. The hardest
piece of design work in the project, especially at 390px.

Sub-parts to design: the grid cell (7 band states x 3 markers x hover/focus), the
sticky year row header, the column header, the legend, the Public/Elite segmented
control, and the cell preview (hover card on desktop, bottom sheet on mobile).

### 2.3 ✅ `SiteHeader`

See [`03-page-map.md`](03-page-map.md) section 0. Needs: a search affordance with
real presence, an account menu, an accessible logo at every width, and a mobile
answer (likely a bottom nav).

### 2.4 ✅ `ApiHealthCard` + `HealthRecheckButton`

Three states: Operational, Degraded, Down. Dependency rows for database and
redis. A recheck button with loading state and three toast outcomes. Low
priority but the states are real and all reachable.

### 2.5 ✅ shadcn primitives already installed

`avatar`, `badge`, `button`, `card`, `dropdown-menu`, `input`, `separator`,
`skeleton`, `sonner` (toasts), `tabs`.

These are stock shadcn with zero customisation. Theme them to the new palette.

⚠️ Built on **Base UI** (shadcn `base-nova` style), not Radix. Composition uses a
`render` prop. If a prototype specifies component internals, this matters.

---

## 3. 🔨 Components that do not exist

### 3.1 🎯 `RatingWidget` - the highest-value new component

**The primary action of the entire product, and it has no UI.**

**Data:** current rating from `ViewerStateOut.rating` (1-10 or null).
**Writes:** `PUT /api/episodes/{id}/rating` with `{ score: 1-10 }`.

**The design problem:** a 10-point scale on a 390px screen. Ten tap targets at
44px each needs 440px - it does not fit in a row. Options to consider: a slider
with a large value readout, a 5x2 grid, a bottom sheet with big numbers, or a
drag-to-select arc. **Pick one and justify it.**

Must handle:
- Not yet rated vs already rated (showing the user's score).
- Changing an existing rating (updates, never duplicates).
- Clearing a rating.
- Signed-out (prompt to sign in, do not hide).
- Saving / saved / failed.
- Showing how the user's score compares to the public score.

### 3.2 🔨 `WatchButton`

`POST /api/episodes/{id}/watch`, optional date and note. **Rewatches are
allowed**, so this is not a binary toggle - it is a log. Show watch count and
last watched date. Needs a compact form (just log it) and an expanded one (pick a
date, add a note).

### 3.3 🔨 `FavoriteButton`

Simple toggle, `PUT`/`DELETE`. Needs on, off, pending, signed-out.

### 3.4 🎯 `MomentList` + `MomentForm` + timeline

Moments are the product's distinctive content.

- **List row:** timestamp chip (monospace, links out to YouTube at that second),
  the Bulgarian label, author, vote score.
- 🎯 **Timeline visualisation:** plot moments as markers along the episode
  duration. `duration_sec` is always present, so this is buildable and would be
  a standout.
- **Form:** timestamp input (mm:ss or h:mm:ss) plus a short label. Make it fast -
  this is how the product's value gets created.
- ⚠️ **Empty is common** (~1.6 per episode, very uneven). The empty state must be
  an invitation, not an apology.

### 3.5 🔨 `TopicChips` + `TopicVote` + `TopicSuggest`

Public, community-voted subject tags. Chip links to the topic page, shows the
vote score, and offers up/down voting when signed in. Suggesting resolves to a
canonical topic server-side, so the input needs autocomplete against the existing
15 topics plus a "create new" path.

⚠️ Must be **visually distinct from personal tags**, which are private.

### 3.6 🔨 `PersonalTagInput` 🔒

🔒 **Private to the author.** **Zero exist** - the UI is the reason. Design it so
the privacy is unmistakable, and so it feels like a personal organiser rather
than a public post.

### 3.7 🔨 `CommentThread` + `CommentForm`

Author avatar, name, relative date, body, edit and delete for your own, report
for others.

⚠️ 🎯 **Spoiler comments.** Currently a CSS blur that clears on `:hover` - which
**does not work on touch at all**. Design a real tap-to-reveal with a clear
"contains spoilers" affordance.

Bodies are user input rendered publicly: **always plain text, never HTML**.

### 3.8 🔨 `ScoreDisplay`

The public / elite pair. Needs: both present, elite null (20 of 74 episodes),
both null (16 of 74), provisional qualifier, and a compact variant for cards.
The elite score needs a one-line explanation of what "elite" means.

### 3.9 🔨 `FilterBar` / `FilterSheet`

Sorts: newest, oldest, top rated, top elite, most rated.
Filters: channel, content kind, members-only, topic, year.

**Mobile:** a bottom sheet behind a sticky Filters button, with active filters as
removable chips above the results. **Desktop:** a left rail or a top bar.

### 3.10 🔨 `Pagination` / `InfiniteScroll`

`meta.has_more` is returned by every list endpoint and **currently unused** -
there is no way to reach episode 25 of 74. Pick one pattern and apply it
consistently.

### 3.11 🔨 `SearchInput` 🎯

Needs three forms: the header version (compact), the hero version (large, with
example-query chips), and the full-screen mobile overlay.

⚠️ Input font size must be **16px or larger** or iOS Safari zooms the viewport on
focus and never zooms back.

Should support recent searches and suggestions (`/api/search/suggest` exists).

### 3.12 🔨 `EmptyState`

There is effectively no empty-state design in the app - most are a single grey
sentence. Needed for: no episodes match filters, no search results, no moments,
no topics, no comments, no ratings yet, empty watch history, no personal tags.

Each needs an icon, a headline, a sentence, and where relevant a call to action.

### 3.13 🔨 `ErrorState`

The API can be down or degraded. Needed: a full-page error with retry, an inline
section error, and an offline state. There is currently no designed error page at
all - a failed API call throws.

### 3.14 🔨 Skeletons

Only one exists (`/status`). Needed for: episode card grid, the ratings grid,
search results, moment list, comment list, channel cards.

### 3.15 🔨 `SignInPrompt`

Shown when a signed-out user taps Rate, Favourite, Watch or Comment. Must explain
what they get, not just demand a login.

### 3.16 🔨 `ReportDialog`

Small menu item plus a confirm dialog, on comments, moments and topics. Reason
selection. Low prominence by design - it should not invite frivolous use.

### 3.17 🔨 `BottomNav` (mobile) 🎯

Strongly recommended. Home, Episodes, Search, Profile. Thumb reach is the biggest
single mobile improvement available.

### 3.18 🔨 `ChannelHeader`

Avatar, name, handle, description, subscriber count, episode count, link out to
YouTube.

⚠️ **`avatar_url` and `banner_url` are unreliable.** Design a fallback (initials
or a generated mark) and a layout that works with **no banner at all**.

---

## 4. 📋 Component checklist

| Component | Status | Priority |
|-----------|--------|----------|
| `RatingsGrid` (+ cell, legend, toggle, preview) | ✅ redesign | 🎯 1 |
| `RatingWidget` | 🔨 new | 🎯 1 |
| `EpisodeCard` (5 variants) | ✅ redesign | 🎯 1 |
| `SearchInput` (3 forms) | 🔨 new | 🎯 1 |
| `SiteHeader` + `BottomNav` | ✅ / 🔨 | 🎯 2 |
| `MomentList` + form + timeline | 🔨 new | 🎯 2 |
| `ScoreDisplay` | 🔨 new | 2 |
| `EmptyState` (8 cases) | 🔨 new | 2 |
| `FilterBar` / `FilterSheet` | 🔨 new | 3 |
| `TopicChips` + vote + suggest | 🔨 new | 3 |
| `CommentThread` (+ spoiler reveal) | 🔨 new | 3 |
| `WatchButton`, `FavoriteButton` | 🔨 new | 3 |
| Skeletons | 🔨 new | 3 |
| `ChannelHeader` | 🔨 new | 4 |
| `Pagination` | 🔨 new | 4 |
| `ErrorState`, `SignInPrompt` | 🔨 new | 4 |
| `PersonalTagInput` | 🔨 new | 5 |
| `ReportDialog` | 🔨 new | 5 |
| `ApiHealthCard` | ✅ redesign | 5 |
