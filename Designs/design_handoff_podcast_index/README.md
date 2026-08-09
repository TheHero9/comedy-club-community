# Handoff: Bulgarian Podcast Index - full visual redesign

## Overview

A searchable community hub for Bulgarian YouTube podcast channels. Users browse every episode, rate them 1-10, log what they watched and when, and label episodes with topics and timestamped moments so the archive becomes findable. Content is Bulgarian; UI chrome is a mix of Bulgarian (user-facing) and English (structural labels like Public/Elite).

The app already works and is fully tested. It is visually unstyled: shadcn/ui defaults with zero-chroma greyscale tokens and no brand identity. **This handoff is the visual layer only.** No API changes, no new data, no new features beyond what the designs show.

Audience is roughly 1,000 people, overwhelmingly on phones. **Mobile 390x844 is the primary target. Desktop 1280x900 is secondary. Dark theme is the default; light theme is fully specified and must ship too.**

---

## About the design files

The files in `design_files/` are **design references created in HTML**. They are prototypes showing intended look and behaviour, not production code to copy directly. They are authored in a custom template runtime (`support.js`, `.dc.html`) that does not exist in the target codebase and must not be introduced.

**Your task is to recreate these designs in the existing app** using its established stack: **Tailwind CSS v4, shadcn/ui, lucide-react**. No other component library. Read the HTML for exact values (colours, sizes, spacing, copy) and re-express them as Tailwind utilities and shadcn component variants.

Open `design_files/Prototype.dc.html` in a browser first. It is the complete interactive prototype and the source of truth for behaviour. The toolbar above the device frame switches Mobile/Desktop and Dark/Light and jumps between all ten routes. Everything inside the frame is clickable.

### Which file is what

| File | Contents |
|---|---|
| `Prototype.dc.html` | **Primary reference.** Full clickable app, all routes, both breakpoints, both themes, 74 episodes of seeded data |
| `Foundations.dc.html` | Colour palette in oklch, type scale, Cyrillic clamp rules, spacing/radius/elevation/motion ladders |
| `Channel Grid.dc.html` | The ratings grid in isolation, all cell states, the legend, cell preview, and the rationale for the mobile transpose |
| `Episode Detail.dc.html` | Earlier episode-page exploration plus the full 1-10 rating control state set (empty, picked, signed out, saving, saved, failed, changing, removed) |
| `Search Home Browse.dc.html` | Search empty/results/zero, home, browse, filter sheet |
| `Shell and Components.dc.html` | Header, bottom nav, search overlay, footer, EpisodeCard variants, buttons, chips, toasts, 8 empty states, error, sign-in, spoiler reveal |
| `Tier 2 Screens.dc.html` | Channels list, profile, leaderboard, zero results, 404, status |
| `original_specs/` | The five source spec documents this design was built against. `02-data-reality.md` is the one to obey most strictly |

Note: the standalone files predate the final episode-page redesign. Where they disagree with `Prototype.dc.html`, **`Prototype.dc.html` wins**.

---

## Fidelity

**High-fidelity.** Final colours, typography, spacing, and interactions. Recreate pixel-accurately. Every value below is exact.

---

## Design tokens

### Colour

Authored in oklch. Hex shown for reference; prefer oklch in the Tailwind v4 `@theme` block so the palette stays perceptually consistent if you adjust it later.

#### Brand

| Token | oklch | Hex | Use |
|---|---|---|---|
| `--primary` | `oklch(0.600 0.225 27)` | `#E4232C` | Buttons, active nav, focus ring, logo mark, search field border |
| `--primary-hover` | `oklch(0.665 0.205 27)` | `#F0463E` | Hover only |
| `--accent` | `oklch(0.855 0.165 88)` | `#FFC93A` | Search match highlight, marker icons, star glyph, channel avatar fallback |
| `--accent-quiet` | `oklch(0.560 0.100 88)` | `#8A6B1E` | Rarely used; accent on light surfaces where gold would blow out |

**Rule that keeps brand out of the score scale's way:** red is the interactive colour and appears only as chrome (buttons, focus, logo). Gold is the highlight colour and appears only as an emphasis mark. **Neither is ever used as a filled score chip.** That is the entire separation strategy - see "Score bands" below.

#### Neutrals, dark theme (default)

| Token | oklch | Hex |
|---|---|---|
| `--background` | `oklch(0.155 0.008 55)` | `#191614` |
| `--card` | `oklch(0.205 0.010 55)` | `#23201D` |
| `--card-2` | `oklch(0.190 0.010 55)` | `#1E1B19` |
| `--elevated` | `oklch(0.245 0.011 55)` | `#2C2825` |
| `--border` | `oklch(0.225 0.010 55)` | `#2C2825` |
| `--border-2` | `oklch(0.320 0.010 55)` | `#3D3935` |
| `--border-3` | `oklch(0.375 0.010 55)` | `#4A4540` |
| `--foreground` | `oklch(0.970 0.004 85)` | `#F7F4F0` |
| `--muted-foreground` | `oklch(0.745 0.008 60)` | `#ADA69F` |
| `--subtle-foreground` | `oklch(0.575 0.008 60)` | `#7A736C` |
| `--faint-foreground` | `oklch(0.480 0.008 60)` | `#5E5852` |
| `--thumb-1` | - | `#26221F` |
| `--thumb-2` | - | `#2C2825` |
| `--overlay` | - | `rgba(11,10,9,.72)` |

The neutrals carry a warm hue (55-85) at very low chroma. They are not grey. This is deliberate and is most of what makes the dark theme feel like a room rather than a dashboard.

#### Neutrals, light theme

| Token | Hex |
|---|---|
| `--background` | `#FBF8F4` |
| `--card` | `#FFFFFF` |
| `--card-2` | `#F6F2EC` |
| `--elevated` | `#EDE8E1` |
| `--border` | `#E6DFD5` |
| `--border-2` | `#D8D0C5` |
| `--border-3` | `#C4BBAE` |
| `--foreground` | `#1A1614` |
| `--muted-foreground` | `#57504A` |
| `--subtle-foreground` | `#867E75` |
| `--faint-foreground` | `#9E968D` |
| `--primary` | `#D0202A` (darkened 0.03 L to hold contrast on paper white) |
| `--accent` | `#A8760C` (gold becomes bronze; `#FFC93A` fails on white) |
| `--thumb-1` | `#E9E3DA` |
| `--thumb-2` | `#DDD5C9` |
| `--overlay` | `rgba(26,22,20,.45)` |

Light theme also needs a different **unrated** chip: `bg #F1ECE4`, `fg #8A8279`, `border 1px dashed #C4BBAE`.

#### Score bands (identical in both themes)

Seven bands, all at L 0.66-0.87 with chroma held 0.13-0.16, so they read as one family and always take near-black `#1A1614` text.

| Band | Threshold | oklch | Hex | Contrast on `#1A1614` |
|---|---|---|---|---|
| Absolute cinema | `>= 9.5` | `oklch(0.800 0.130 235)` | `#5CB8E8` | 8.1:1 |
| Awesome | `>= 8.5` | `oklch(0.800 0.150 155)` | `#46C68F` | 8.0:1 |
| Great | `>= 7.5` | `oklch(0.830 0.160 140)` | `#6FD16A` | 8.9:1 |
| Good | `>= 6.5` | `oklch(0.870 0.150 118)` | `#ABDC5F` | 9.9:1 |
| Regular | `>= 5.5` | `oklch(0.840 0.140 85)` | `#E9BE4B` | 9.1:1 |
| Bad | `>= 4.0` | `oklch(0.750 0.150 55)` | `#E2914F` | 6.7:1 |
| Garbage | `< 4.0` | `oklch(0.660 0.160 28)` | `#D66A5B` | 5.1:1 |

**Why garbage red and brand red never collide:** garbage sits at L 0.660 / C 0.160 and always carries near-black text inside a rounded chip. Brand red sits at L 0.600 / C 0.225 and always carries white text on a pill button. Different lightness, much lower chroma, opposite text colour, and mutually exclusive shapes. On top of that, the number is always printed inside the chip, so colour is never the only carrier of the value.

**Unrated is not a band.** Score `null` renders as `?` on `--card` with a `1px dashed --border-3` border. Never `0`, never the garbage band, never a filled colour. This is 22% of episodes.

### Typography

Three families, all with full Cyrillic coverage. This is non-negotiable: Bulgarian titles must not fall back per glyph.

- **Unbounded** (500/600/700/800) - display and headings. Geometric, slightly odd, reads as a club poster.
- **Onest** (400/500/600/700) - UI and body. Designed Cyrillic-first.
- **JetBrains Mono** (500/700) - scores, timestamps, counts, dates. Tabular by default, which stops a column of grid numbers wobbling.

| Token | Mobile | Desktop | Family |
|---|---|---|---|
| `display` | 30 / 1.06 / -0.03em | 52 / 1.06 / -0.03em | Unbounded 800 |
| `episode-title` | 24 / 1.14 / -0.02em | 36 / 1.14 / -0.02em | Unbounded 700 |
| `h1` | 23 / 1.12 / -0.025em | 34 / 1.12 / -0.025em | Unbounded 700 |
| `h2` | 18 / 1.2 / -0.015em | 22 / 1.2 / -0.015em | Unbounded 700 |
| `section-label` | 14 / 1.3 | 14 / 1.3 | Onest 700 |
| `title-card` | 14 / 1.3 | 15 / 1.3 | Onest 600 |
| `body` | 14.5 / 1.55 | 16 / 1.55 | Onest 400 |
| `small` | 13 / 1.45 | 13.5 / 1.5 | Onest 400 |
| `micro` | 11.5 / 1.3 | 12 / 1.3 | Onest 500 |
| `numeric` | 15 tabular | 14 tabular | JetBrains Mono 700 |
| `input` | **16 minimum** | 16 | Onest 400 |

Input must never drop below 16px on mobile or iOS zooms the viewport on focus.

### Cyrillic title clamps

Bulgarian titles are long compound words. Every title slot has an explicit clamp and every one carries `overflow-wrap: anywhere` so a compound word breaks instead of overflowing.

| Slot | Size | Clamp | Notes |
|---|---|---|---|
| **Episode detail H1** | 24px mobile / 36px desktop | **none** | Canonical location for the title. Wraps to 4+ lines. Do not clamp this - 3 of 20 real titles need 4 lines at 390px and clipping loses words with no ellipsis |
| Card title | 14-15px | 2 lines | Reserve 40px so the grid does not jump |
| Search result title | 15-17px | 2 lines | Match rows sit below |
| Grid cell preview sheet | 18px | 3 lines | Sheet grows to fit |
| List row title | 14.5px | 2 lines | |
| Similar-episode rail card | 13px | 2 lines | |

### Spacing

4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48.
Page gutter: 16 mobile, 32 desktop. Section rhythm: 28-36 mobile, 36-52 desktop. Card padding: 12-16 mobile, 16-22 desktop.

### Radius

| Value | Use |
|---|---|
| 8px | Score chips, desktop grid cell |
| 10-11px | Small buttons, segmented items |
| 12px | Inputs, mobile grid cell |
| 14px | Base token, cards (replaces shadcn's 10px default) |
| 18-20px | Panels, large cards |
| 26px | Bottom sheets |
| 99px | **Pills.** Primary buttons, filter chips, topic chips, nav pills, search fields. This is a signature of the redesign - almost every interactive surface is a pill |

### Elevation

| Name | Shadow | Use |
|---|---|---|
| flat | none | Cards and lists. Border only. **This is the default** |
| raised | `0 1px 2px rgba(0,0,0,.45)` | Sticky header / bottom nav once scrolled |
| floating | `0 6px 16px rgba(0,0,0,.45)` | Dropdowns, popovers, toasts |
| overlay | `0 20px 44px rgba(0,0,0,.5)` | Bottom sheets, hover cards, dialogs |

### Motion

| Timing | What | Notes |
|---|---|---|
| 120ms ease-out | Hover and focus | Colour and ring only |
| 160ms ease-out | Button press | Scale 0.97, no shadow change |
| 240ms `cubic-bezier(.32,.72,0,1)` | Bottom sheet in | translateY from 100% |
| 180ms ease-in | Bottom sheet out | Faster out than in |
| 120ms delay | Grid hover card (desktop) | Opens after 120ms, closes with no delay |
| 1200ms loop | Skeleton | **Opacity pulse 0.5 to 1 only.** Never a moving gradient - a sweep across 20 cards reads as the page loading 20 times |
| 0ms | Band colours | **Never transition.** A colour that moves reads as a value that changed |
| 200ms ease-out | Toast | Slide down from top-centre, auto-dismiss at 2.2s |

Under `prefers-reduced-motion: reduce`, drop every transform and every pulse. Keep opacity and colour transitions, capped at 100ms.

---

## Theming implementation

The prototype sets CSS custom properties on the frame element and every child references them with a dark-theme fallback, e.g. `background: var(--card, #23201D)`. In the real app use Tailwind v4's `@theme` with a `.dark` / `:root` split, or `data-theme="light|dark"` on `<html>`.

Dark is the default. Persist the choice in `localStorage` and respect `prefers-color-scheme` on first visit only. The toggle lives in the app header as a sun/moon icon button (38x38, radius 11, `--elevated` background).

**Band colours do not change between themes.** They carry meaning. Only the neutrals, brand red, accent gold, and the unrated chip flip.

---

## Screens

There are ten routes. Every one is implemented in `Prototype.dc.html` at both breakpoints in both themes.

### 1. Home (`/`)

**Purpose:** land, understand what the site is for, search, or dive into the best episodes.

**Mobile layout:** 16px gutter, single column.
- H1 `display` size, three lines, with the third word "Намираем." in `--primary`. Copy: "Всеки епизод. Всеки момент. Намираем."
- Subhead `body`, `--muted-foreground`, max 520px: "74 епизода, обозначени от общността с теми, моменти и оценки."
- Search trigger: full-width pill, height 56, `--card` background, **2px `--primary` border**, search icon in `--primary`, placeholder "Търси момент, тема или гост". Opens the search overlay sheet, does not navigate.
- Example query chips: pill, min-height 38, `1px --border-2`, transparent, `--muted-foreground`. Four of them. Each runs a real query.
- Section "Най-високо оценени" with an "всички" link to the leaderboard. Five rows, min-height 64, radius 14. Rank number in Unbounded 700 - #1 is 21px in `--accent`, #2-3 are 19px in `--muted-foreground`, #4-5 are 16px in `--subtle-foreground`. #1's row gets a tinted background (`#2A2521` dark / `#FFF9EC` light). Then a 70px 16:9 thumbnail, title clamped 2 lines, rating count, and a right-aligned gold star + score in JetBrains Mono 15/700.
- Section "Най-нови": 2-column card grid (4 cards), 10px gap. Card = 16:9 thumbnail radius 13, score chip top-left (h24, radius 7), duration bottom-right in mono 11 on `rgba(20,17,15,.86)`, then title 14/600 clamped 2, then date 11.5 in `--subtle-foreground`.
- Section "Канали": one wide row card, 56px gold avatar with "ИК", name, "74 епизода / 7.4 средно", chevron.

**Desktop:** same content, `contentMax` 1216px, 32px gutter. Hero H1 at 52px. Newest becomes a 4-column grid of 8 cards. Footer appears below (see Shell).

### 2. Channels (`/channels`)

**Purpose:** list the indexed channels. There is currently exactly **one**.

Designed for one channel and for eight. With one channel it is a single **wide card**, never a grid with one filled cell and empty space beside it. From two channels up, switch to a 2-3 column grid.

Card contains: 64px gold avatar, name in Unbounded 600/19, handle + episode count in mono 12, description, then a **year sparkline** - three rows (2024/2025/2026), each a flex of 24 flush 16px-tall 3px-radius bars coloured by band, `--elevated` for unrated, `transparent` for holes, with the year label left (38px, mono 11.5) and the year average right (28px, mono 11.5). Then a full-width primary pill "Виж решетката".

### 3. Channel detail + ratings grid (`/channels/:slug`) - THE SIGNATURE SCREEN

**Purpose:** see the whole archive at a glance and find any episode by year and position.

Header: avatar (64 mobile / 96 desktop, radius 24, gold, Unbounded 700 initials), H1, mono meta line separated by dimmed periods (`@ivankirkov1 . 74 епизода . 128 хил. абонати`), description max 620px.

Stats strip: 3 columns mobile / 5 desktop. Each is `--card`, radius 14, padding 12/14, big number in JetBrains Mono 21/700, label 11.5 in `--subtle-foreground`. Values: average, rated/total, best (in `#5CB8E8`), best year, total ratings given.

Public/Elite toggle: segmented pill, 3px padding, `--card` background, `1px --border-2`, items height 34, radius 99. Active is `--primary` with white text. **Switching recomputes every cell, every year average, and the stats strip.** Elite is the score from verified paying members only; many episodes have `elite === null` and must render as unrated in that mode.

#### The grid - and why it transposes

**Desktop:** rows are years, columns are the episode's position in that year. Wrapped in a `--card-2` panel, radius 20, 16px vertical padding. Inside, one `overflow-x: auto` container. Year label column is 88px and `position: sticky; left: 0` with a matching background. Cells are **54x44**, radius 8, 4px gap. Column header row shows the position numbers in mono 10.5.

**Mobile: the grid is transposed. Episodes become rows, years become columns.**

This is the single most important structural decision in the redesign. Reasoning, which you should preserve if you change anything:

> Years-as-rows at 390px makes a 2,100px strip for three years. Reaching episode 30 of 2025 means scrolling sideways past 29 cells with no landmarks, the sticky year column eats 90px of a 390px screen, and cells must shrink to about 56x36 to feel worth scrolling - which fails the 44px touch target. Three markers then have to stack in the corners of a chip smaller than a fingertip.
>
> Transposing turns the wide axis into the short one. Three years is three columns of about 98px, so the grid fits with **no horizontal scroll at all**, and the long axis becomes ordinary vertical page scroll. Cells get 44px of height and enough width for the score plus all three markers laid out in a row.

Measured: at 390px the row is 348px wide with `scrollWidth === clientWidth`. Episode-number column 36px, three cells at 98px, 5px gaps.

Mobile cell: **min-width 92 (flex:1), height 44**, radius 10, score in JetBrains Mono 15/700 left-aligned, markers in a 4px-gap row right-aligned. Sticky column header row (year label Unbounded 700/14 + average mono 10.5) with `position: sticky; top: 0; z-index: 3`. Episode-number gutter is `position: sticky; left: 0`.

**When more channels arrive** and a year has more episodes than fits, the cell area scrolls horizontally **inside its own container** while the episode-number column stays pinned. The page body must stay `overflow-x: hidden` at all times. The cell area is the only `overflow-x` container on the page.

#### Cell states

| State | Rendering |
|---|---|
| Rated | Band fill, `#1A1614` score text |
| Unrated | `--card` fill, `1px dashed --border-3`, `?` in `--faint-foreground` |
| Hole (year had fewer episodes) | `transparent`, no border, no number, not a link |
| Provisional (`< 3` ratings) | Keeps its band colour, adds a triangle-alert marker |
| Members only | Adds a crown marker |
| Stream | Adds a radio marker |

Markers are `#2A211C` strokes drawn on the band fill: 13px on mobile in a right-aligned row with 4px gaps, 9px on desktop clustered bottom-right at 3px. All three can appear on one cell.

**Tap/click a cell** opens the preview - a bottom sheet on mobile, a hover card on desktop (120ms open delay, instant close, cell lifts 2px and takes a 2px `--primary` ring; drop the lift under reduced motion).

Preview contains: 16:9 thumbnail, score chip + band label + rating count, a provisional warning row if applicable, title clamped 3 lines, mono meta (`2025 / епизод 14 . 12 март 2025 . 2:14:07`), and a primary pill "Отвори епизода".

Legend sits below the grid: seven swatches (18x12, radius 4) plus the dashed unrated swatch, 12px labels, wrapping row.

Then "Скорошни епизоди": five list rows, thumbnail 120 mobile / 180 desktop.

### 4. Episode detail (`/e/:videoId`) - modelled on IMDb

This is the screen most recently redesigned, at the user's request, after the IMDb title page. Read top to bottom:

**Header block** (own padding band, `16px 16px 12px` mobile / `24px 32px 16px` desktop):
- **H1**: Unbounded 700, 24px mobile / 36px desktop, line-height 1.14, letter-spacing -0.02em, `overflow-wrap: anywhere`, **no clamp**. This is the canonical place for the title.
- **Metadata line** directly under it, JetBrains Mono 12/13, `--subtle-foreground`, items separated by a period at 50% opacity: `2025 . 12 март 2025 . 2:14:07 . Епизод 14`.
- **Desktop only:** the score block sits top-right of the header, right-aligned - a "ОЦЕНКА" mono label, then gold star + score in mono 24/700 + `/10` in mono 13, then the rating count. Beside it a vertical rating button: star glyph (filled if the user has rated) over a 12.5px label reading "Оцени" or "Твоята 9".

**Media + body**, two columns on desktop (`1fr 320px`, 32px gap), single column on mobile:
- **Thumbnail**: 16:9, radius 16, opens YouTube in a new tab. Centred 62px red circular play button with a white triangle, `rgba(228,35,44,.94)`, shadow `0 8px 24px rgba(0,0,0,.4)`. Members/Stream badges top-left on `rgba(20,17,15,.88)`. Duration bottom-right. **No embedded player anywhere in the product.**
- **Mobile only:** a score strip card below the thumbnail - `--card`, radius 16, padding 14, containing the gold star + score + `/10` + count on the left, a 1px divider, the vertical rate button, and (if elite exists) another divider and the elite score in its band colour with an "Elite" label.
- **Topic pills**: height 34, radius 99, `1px --border-2`, transparent, tapping runs a search for that topic. If the episode has none, a single dashed "Добави първата тема" pill.
- **Description, collapsed to 2 lines** with an "още" / "по-малко" toggle in `--primary` with a rotating chevron. Descriptions average 109 characters, so the toggle only appears when the text exceeds ~90 characters. Nobody reads these, so they never take vertical space by default.
- **Участници**: section label + count, then a horizontally scrolling row of 92px cards - 64px circular avatar with Unbounded 700 initials in a per-person colour, name 12.5/600, role 11 in `--subtle-foreground` (домакин / гост). Scrollbar hidden. **Only 3 people exist in the whole database**; do not build a "full cast" page.
- **Моменти**: a timeline bar (6px tall, `--elevated`, radius 99) with 4x18 gold ticks positioned by timestamp, then rows - mono timestamp chip in `--accent` on `--elevated`, label, author, vote count. Empty state is a dashed 14-radius box: "Още нищо не е отбелязано" + explanation + "Добави първия момент".
- **Оценки от общността**: big gold star + score in mono 30/700 + count on the left, and a **1-10 breakdown histogram** on the right - 10 bars, 62px tall container, each bar coloured by its own band, mono 9.5 numeral beneath. Then featured review cards: 34px avatar, name, an inline mono score badge with a small gold star, relative time, and the body. One review is spoiler-gated.
- **Подобни епизоди**: horizontal rail of 168px cards, each tagged with **why** it is similar ("тема: хладилници" or "с Даниел Петров"), falling back to the date. Section header shows the reason ("по тема и участници" / "от същия канал").

**Desktop sidebar** (sticky, 320px):
1. Primary pill button height 50 - "Отбележи като гледано" in `--primary`/white, or "Гледано 3x" in `--elevated`/`--foreground` once logged.
2. Row: "Запиши дата" pill (calendar icon) + a 52px heart pill.
3. **Гледано от теб** card: watch count, then one row per logged date - green check, date, relative label, and an x to remove. Empty state explains you can add past dates.
4. **Твоята оценка** card: score in mono 32/700, delta vs the public score ("+0.4 спрямо публичната"), a "Промени" pill and an "Изчисти" pill.
5. "Гледай в YouTube" outline pill.

**Mobile action bar** (fixed, replaces bottom nav on this route): watched pill (flex 1) + 46px calendar pill + 46px heart pill + 46px YouTube pill.

**Sparse episodes are the common case, not an edge case.** 22% are unrated, many have no moments, no topics, and a 44-character description. The page keeps every section slot and turns each empty one into an invitation. It never collapses into a different, shorter layout. There is **no chapter UI anywhere** - 0 of 74 episodes have chapters.

#### The watch log - the piece IMDb does not have

Users rewatch. The log records **each viewing as its own dated entry**, including backdated ones.

The sheet contains:
- Four quick-date pills: Днес, Вчера, Тази седмица, Миналия месец.
- A **31-day month calendar**, 7 columns, 5px gap, 38px cells, radius 9. Logged days fill `#46C68F` with `#1A1614` text and 700 weight. Past days are `--card` with a `--border-2` border. **Future days are transparent with `--faint-foreground` text and refuse the tap**, showing the toast "Не може да запишеш бъдеща дата".
- The list of recorded viewings, each removable.
- A "Готово" primary pill.

Adding a duplicate date is rejected with "Вече е записано за тази дата". The watched button label and the sidebar count both derive from `watchLog.length`.

### 5. Search (`/search`)

**Making search look like the point of the product.** It previously looked like a newsletter signup.

**No query:** the search field is a full-width pill, 54-56 tall, `--card`, **2px `--primary` border**, red icon. Below it a `display`-size H1 "Търси нещо, което се е случило", the explanation "Не само заглавия. Търсенето минава през теми, моменти и гости.", four example-query pills at 42px min-height, and a "ПОПУЛЯРНИ ТЕМИ" mono label over topic pills carrying counts.

**With results:** H1 shows `3 епизода за „хладилникa"` with a right-aligned mono `3ms`, then the line that makes the argument: **"Думата не се среща в нито едно заглавие."**

**Each result card** is two stacked regions:
1. The clickable episode region - thumbnail (112 mobile / 220 desktop), title clamped 2, score chip, date.
2. A separate **match-reason region** on `--card-2` with a top border. Each reason is a row: a mono kind badge in `--accent` on `--elevated` (`МОМЕНТ 1:42:10` or `ТЕМА`) followed by the matched text with the hit term in `--accent` at 700 weight.

Reasons are rows, not badges, because they are the entire argument for the site existing - they explain why an episode matched when the words appear nowhere in the title. Do not compress them into a tag strip.

**Zero results:** "Нищо не съвпада" + "Правописните грешки вече се прощават, така че думата най-вероятно още не е отбелязана." + a browse-instead pill. Never blame the user's spelling; the engine already tolerates typos.

**Search overlay** (from any header): a sheet with the field, a "ПРЕДЛОЖЕНИЯ" list of 50px rows (query + result count, matched prefix bolded), and recent searches as pills.

### 6. Episodes browse (`/episodes`)

H1 + "показани 9 от 74". A horizontally scrolling filter bar: a primary "Филтри N" pill, then one removable pill per active filter showing its group label in `--subtle-foreground` then its value then an x.

Card grid: 2 columns mobile / 4 desktop. "Зареди още" pill appends 9 at a time and disappears when exhausted.

**Filters (all functional, all combinable):**

| Group | Options |
|---|---|
| ПОДРЕДБА | Най-нови, Най-стари, Най-високо оценени, Най-ниско оценени, Най-много оценки |
| ВИД | Видео, Стрийм |
| ГОДИНА | 2026, 2025, 2024 |
| КАНАЛ | Иван Кирков |
| УЧАСТНИК | Иван Кирков, Даниел Петров, Мартин Христов |

Sort is single-select and always has a value (defaults to Най-нови, and its chip is hidden when default). The others are toggle-off single-select. Every option shows its result count. The apply button reads the live filtered total: "Покажи 42 епизода". Highest/lowest-rated sorts exclude unrated episodes rather than sorting `null` to an end.

**Filter sheet:** bottom sheet on mobile, centred 460px dialog on desktop. Options are 42px-min pills. Desktop browse can alternatively use a 236px left sidebar with checkbox rows - that variant is in `Search Home Browse.dc.html`.

**Empty result state:** when a combination matches nothing (2025 + Стрийм does), show "Нищо не съвпада с филтрите", name the active filters in prose, and offer "Изчисти филтрите". Never leave a stale grid.

### 7. Profile (`/u/:handle`)

72px circular avatar, name, handle, a "Member" pill. Three stat cards (оценки, изгледани, любими). A "Как оценяваш" card with the user's own 1-10 histogram, bars coloured by band, 110px tall, plus "Средна твоя оценка 7.8, което е 0.4 над средното за сайта." Then four navigation rows (52px min) with counts and chevrons.

Desktop adds a 320px sidebar with the watch-history feed.

**Private tags** get a treatment that can never be confused with public topics: dashed `#6A5A8C` border, `#B9A6DC` violet text, and a lock icon. That violet appears nowhere else in the product.

### 8. Leaderboard (`/leaderboard`)

Three filter pills (Най-високи, Elite, Най-оценявани). A podium of the top three - 2nd, 1st, 3rd left to right, with block heights 62/84/50 filled with the band colour and the rank + score in `#1A1614`. Then ranked rows 4-10.

### 9. Status (`/status`)

Overall state dot + label + relative time, then one row per dependency. Redis degraded is a real state the app reports: the dot goes `#E9BE4B`, the value reads "не отговаря", and the rest of the site keeps working.

### 10. 404

58px Unbounded 800 numeral in `--primary`, "Няма такава страница", the note that search will probably find it, a search pill, and a home pill.

---

## Global shell

**Mobile header, 54px:** logo mark (28px, radius 10, `--primary`) + "Podcast Index" wordmark in Unbounded 700/13, then right-aligned theme toggle, search button, and 34px avatar. All icon buttons are 38x38 minimum with 44px effective touch targets.

**Mobile bottom nav, 66px:** four items (Начало, Епизоди, Търсене, Профил). Active gets `--primary` for both the icon and the 10.5px label at 600 weight. **The bottom nav is replaced by the action bar on the episode route** - they never both show.

**Desktop header, 64px:** logo + wordmark, text nav pills (Канали, Епизоди, Класация), a 400px search trigger, theme toggle, avatar.

**Desktop footer:** logo, the line "Общностен индекс на български подкаст епизоди. Видеата остават в YouTube.", and two link columns (BROWSE / SITE).

**Bottom sheets:** mobile is bottom-aligned, full width, radius `26px 26px 0 0`, with a 40x4 grab handle. Desktop is a centred 460px dialog at radius 20. Backdrop is `--overlay` and closes on tap.

**Toasts:** top-centre pill, `--elevated` background, `1px --border-3`, a coloured status dot, 13.5px text, auto-dismiss at 2.2s.

---

## Component inventory

| Component | Variants / states |
|---|---|
| `ScoreChip` | 7 bands, unrated, provisional (with marker), 3 sizes (24 / 26-28 / 34+) |
| `EpisodeCard` | standard, unrated, provisional, members, stream, with-viewer-state, compact list row, loading skeleton |
| `RatingGrid` | mobile transposed, desktop, public/elite, loading, single-year |
| `GridCell` | rated, unrated, hole, provisional, members, stream, hover, focus |
| `RatingControl` | empty, picked, saving, saved, failed, changing, removed, signed-out |
| `WatchLogSheet` | quick dates, calendar, logged list, future-date guard, duplicate guard |
| `SearchResult` | with moment reasons, with topic reasons, with both, unrated |
| `FilterSheet` | mobile sheet, desktop dialog, desktop sidebar, active-chip bar |
| `TopicChip` | public (solid, with count), suggest (dashed), private tag (violet dashed with lock) |
| `Button` | primary, hover, secondary, outline, ghost, disabled, focused (3px `--accent` ring) |
| `EmptyState` | 8 written variants - moments, topics, comments, filters, search, ratings, history, tags |
| `Toast` | success, warning, error, info |
| `Skeleton` | card, list row, grid |

Every empty state is written copy, not a generic "No data". They are all in `Shell and Components.dc.html`.

---

## Interactions and behaviour

- **Every watch action opens YouTube in a new tab.** No embeds anywhere.
- Grid cell tap -> preview sheet/hover card -> "Отвори епизода" -> episode route.
- Rating: opens the sheet pre-selected with the existing score. Picking replaces, never creates a second rating. Save closes after 400ms with a toast; failure keeps the sheet open with the value intact and an inline retry above Save.
- Search overlay opens over the current page and returns to it on cancel; it does not navigate.
- Example chips and topic pills run real queries.
- **Spoilers are tap-to-reveal, never blur-on-hover.** A hover blur is invisible on touch and leaks in a screenshot. The body is not in the DOM until "Покажи" is pressed.
- Signed-out users still see every rating affordance; tapping opens the sign-in sheet. The button is never hidden.
- Load more appends 9; the button disappears when the list is exhausted.

---

## The 1-10 rating control on a phone

Ten 44px targets need 440px. The screen is 390px.

**Chosen approach: a 5x2 grid of 58-60px-tall buttons in a bottom sheet.** Each button shows the numeral in JetBrains Mono 20/700 and, beneath it, an 18x3 stripe in that value's band colour. The picked button fills with its band colour, takes `#1A1614` text, and a 2px `--foreground` border.

Rejected alternatives and why: a **slider** turns a discrete ten-point judgement into a drag, which is imprecise with a thumb and gives no target for the value you already know you want. A **single row of ten** cannot exist at 390px without failing the touch target. **Five stars with halves** changes the scale the database stores.

The band stripe under each numeral is what connects the score you are about to give to the colour it will take in the grid.

Sheet also shows the live comparison "Публична оценка 8.6 / твоята 9", a Save primary pill and a Remove outline pill.

---

## State

```
device        'mobile' | 'desktop'        // prototype only, drop in production
theme         'dark' | 'light'            // persist to localStorage
route         current page
epId          selected episode
scoreMode     'public' | 'elite'          // recomputes the whole grid
query         search string
myRating      1-10 | null
watchLog      [{ date, rel }]             // ordered newest first
fav           boolean
spoiler       boolean per comment
descOpen      boolean
filters       { sort, year, kind, channel, person }
limit         pagination cursor
sheet         'rate' | 'log' | 'cell' | 'filters' | 'search' | null
toast         string
```

Only one sheet is open at a time. The toast auto-clears on a 2.2s timer that must be cleared on unmount.

---

## Data reality - do not design for data that does not exist

Read `original_specs/02-data-reality.md` before building. The critical facts:

- **74 episodes, 1 channel, 3 people, 267 ratings.** That is the entire database.
- **22% of episodes are unrated.** `score === null`. Never render as 0 or as the worst band.
- **0 of 74 episodes have chapters.** Build no chapter UI at all.
- **Descriptions average 109 characters.** No long-description layout. Collapse to 2 lines.
- **No channel banner exists.** Do not design one.
- Members-only episodes have **no view count**. Show "без данни за гледания", not "0".
- `elite` is frequently `null`. Handle it as unrated in elite mode, not as a zero.
- Provisional means fewer than 3 ratings. Keep the band colour, add the marker, say so in words in the preview.

The prototype seeds 74 episodes deterministically from these ratios, so what you see is representative of the real sparsity.

---

## Hard constraints

- Tailwind CSS v4 and shadcn/ui. **No other component library.**
- **lucide-react only. No emoji anywhere in the UI.**
- **No em-dash (U+2014) or en-dash (U+2013) in any copy.** Plain hyphen only. This applies to Bulgarian and English alike.
- Every typeface must cover Cyrillic.
- All Bulgarian copy in the prototype is final. Do not translate it to English and do not rewrite it.
- Unrated reads as "no data". Never 0, never the worst band.
- No video embeds. Every watch action opens YouTube in a new tab.
- Mobile page never scrolls sideways. The grid cell area is the only `overflow-x` container.
- Minimum 44px touch targets throughout.
- Dark theme is the default and the priority.

---

## Assets

None to transfer. All icons are inline SVG paths matching lucide-react shapes - replace each with the real `lucide-react` import:

`Mic` (logo), `Search`, `Star`, `Check`, `Heart`, `Calendar`, `ExternalLink`, `Play`, `ChevronDown`, `ChevronRight`, `ChevronLeft`, `Plus`, `X`, `AlertTriangle` (provisional), `Crown` (members), `Radio` (stream), `Clock`, `Lock` (spoilers, private tags), `SlidersHorizontal` (filters), `Sun`, `Moon`, `Info`, `Home`, `List`, `User`.

Thumbnails are diagonal-stripe placeholders (`repeating-linear-gradient(135deg, --thumb-1 0 9px, --thumb-2 9px 18px)`). Real thumbnails come from the YouTube API at 1280x720. Keep a placeholder of the same geometry for load and error states.

---

## Files in this bundle

```
design_files/
  Prototype.dc.html            PRIMARY REFERENCE - full clickable app
  Foundations.dc.html          tokens, type scale, ladders
  Channel Grid.dc.html         ratings grid, cell states, transpose rationale
  Episode Detail.dc.html       rating control state set
  Search Home Browse.dc.html   search, home, browse, filter sheet
  Shell and Components.dc.html shell + component sheet + empty states
  Tier 2 Screens.dc.html       channels, profile, leaderboard, 404, status
  support.js                   runtime for the .dc.html files - reference only, do not port

original_specs/
  01-design-brief.md           product, audience, current-state critique
  02-data-reality.md           every API field and how populated it is - READ THIS
  03-page-map.md               every page: data, elements, show/hide, both breakpoints
  04-component-inventory.md    every component with variants and states
  05-prototype-deliverables.md the original acceptance checklist
```

Open the HTML files directly in a browser. They need no build step and no server.

## Suggested order of work

1. Tokens first - both themes, the `@theme` block, the theme toggle and its persistence.
2. Shell - header, bottom nav, action-bar swap, sheets, toasts.
3. `ScoreChip` and `EpisodeCard`, since almost every screen is built from them.
4. The ratings grid, both orientations. Budget real time here; it is the signature screen and the transpose is the hardest single piece.
5. Episode detail including the watch log.
6. Search and its match-reason rows.
7. Browse and the filter system.
8. Profile, leaderboard, channels, status, 404.
9. Empty, loading and error states across the board - the sparse page is the common case, so treat these as first-class, not cleanup.
