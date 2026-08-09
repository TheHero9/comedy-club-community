# 🗺️ Redesign - Page Map

**Every page in the app: what it is, what data backs it, what it must show, what
to hide, and how it behaves at 390px and 1280px.**

> Read [`01-design-brief.md`](01-design-brief.md) and
> [`02-data-reality.md`](02-data-reality.md) first.

---

## Legend

| Marker | Meaning |
|--------|---------|
| ✅ **Built** | The page exists and works. Redesign it. |
| 🔨 **Not built** | The API exists, there is no UI. Design it from scratch. |
| 🎯 | Priority element. If time runs out, this still gets designed. |
| 🚫 | Deliberately hidden or omitted. Do not add it. |

Every page inherits the **global shell** described in section 0.

---

## 0. 🌐 Global shell (every page)

### Header ✅ Built, needs redesign

Currently: 56px sticky bar. Logo (mic icon + "Comedy Club", wordmark hidden below
640px), three text nav links (Channels, Episodes, Search), and a search icon
button on the right.

**Problems to fix:**
- The wordmark disappears on mobile, leaving a bare icon.
- Search is a link to a page, not a search affordance. 🎯 **Search is the
  product's core value and deserves a real presence in the header.**
- No sign-in entry point at all.
- No theme toggle, despite `next-themes` being installed.

**Must contain:**
- Logo / wordmark, linking home, with an accessible name at every width.
- Primary nav: **Channels**, **Episodes**, **Search**.
- 🎯 A search entry point that feels like the main event. On desktop consider an
  always-visible input in the header; on mobile an icon that opens a full-screen
  search overlay.
- Signed-out: a **Sign in** action. Signed-in: an avatar menu (Profile, My
  ratings, Watch history, Sign out).
- Optional: theme toggle.

**Mobile (390px):** 🎯 **Strongly consider a bottom navigation bar** (Home,
Episodes, Search, Profile) instead of cramming everything into the top bar.
Thumb reach is the single biggest mobile win available here.

**Desktop (1280px):** one row, content capped at ~1280px, nav inline, search
input visible, account menu right-aligned.

### Footer 🔨 Does not exist

There is no footer at all. Design a minimal one: project name, a link to the
channels, a link to `/status`, and a line explaining what the site is. Keep it
small - this is a utility site, not a marketing page.

### Toasts ✅ Built

`sonner`, top-centre, rich colours. Used for rating saved, watch logged, health
recheck results, errors. Design the four variants: success, warning, error, info.

### Theme

Dark is the default and currently the only theme. `<html>` carries `dark` before
first paint so there is no light flash. **Design dark first.** A light theme is
optional; if provided, every token must have a light counterpart.

---

## 1. 🏠 Home `/` ✅ Built

**Purpose:** orient a returning visitor in five seconds. What is this, what is
new, what is good.

**Rendering:** Server Component, `revalidate = 60`.

**Data:** three parallel calls - `listChannels()`, `listEpisodes({limit:8, sort:"newest"})`,
`getLeaderboard("top_rated", {limit:5})`.

### What it currently shows

1. `<h1>` tagline: "Every episode, every channel, actually searchable."
2. A description paragraph.
3. Two buttons: Search, Browse episodes.
4. Two count badges: total episodes, total channels.
5. **Top rated** - a numbered list of 5, each row: rank, score chip in band
   colour, title, channel + rating count, elite score badge.
6. **Newest** - a grid of 8 episode cards.
7. **Channels** - a grid of channel cards (name + episode count).

### What it should show

Keep the structure, fix the presentation.

- 🎯 **A real hero.** Right now it is a heading and two buttons on a blank
  background. This is the front door of a comedy podcast community. Give it
  personality - artwork, a collage of thumbnails, something with warmth.
- 🎯 **Put search in the hero.** The thesis is searchability. A prominent search
  field on the home page, with example queries as hints, would communicate the
  product instantly. Consider showing 2-3 real Bulgarian example searches as
  tappable chips.
- **Top rated** should feel like a leaderboard - rank typography, podium
  treatment for the top 3, thumbnails.
- **Newest** is a standard card grid. See `04-component-inventory.md`.
- **Channels** - with only 1-8 channels this is a small set. Design it to look
  deliberate at **1 channel** and still work at 8.
- Consider adding: **Recently labelled** (episodes that just got new moments or
  topics), which showcases community activity. The API supports it via episode
  sorting; confirm before relying on it.

**Hide:** 🚫 nothing currently rendered needs removing.

### Layout

- **Mobile:** single column. Hero, then search, then Top rated as a vertical
  list, then Newest as a 1-column card list (or 2-up if cards are compact), then
  Channels.
- **Desktop:** hero full width capped at ~1280px. Top rated and Newest can sit
  side by side, or Top rated as a narrow rail beside a 3-4 column card grid.

### States

- **Loading:** skeletons for each section. None exist today.
- **Empty (no episodes at all):** should not happen in practice, but design a
  fallback rather than three empty sections.
- **API down:** currently the page throws. Design a friendly full-page error with
  a retry and a link to `/status`.

---

## 2. 📺 Channels `/channels` ✅ Built

**Purpose:** list every tracked channel.

**Rendering:** Server Component, `revalidate = 60`.

**Data:** `listChannels()` -> `ChannelOut[]`.

### What it currently shows

`<h1>` "Channels", a subtitle, then a card per channel with name and episode
count. That is all.

### What it should show

Per channel card:
- 🎯 **Channel avatar** - `avatar_url` exists but is unreliable. **Design a
  fallback**: initials or a generated mark. Do not assume an image.
- Channel name, `handle` (e.g. `@ivankirkov1`).
- Episode count.
- 🎯 **A mini version of the ratings grid**, or a sparkline of scores by year.
  This is a strong hook and the data is already available per channel.
- Average score across the channel (`overall_average` from the grid endpoint).
- `subscriber_count` if present.
- `last_synced_at` as a quiet "updated X ago".

**Hide:** 🚫 `youtube_channel_id`, 🚫 `banner_url` unless it is reliably
populated (it is not today).

### Layout

- **Mobile:** one card per row, full width. Card is tall enough to carry the
  avatar, name, stats and mini-grid.
- **Desktop:** 2-3 column grid.

### States

- **1 channel** (today's reality) - must not look like a broken grid. Consider a
  wider "featured" treatment when there is only one.
- **Loading:** card skeletons.

---

## 3. 🏆 Channel detail `/channels/[slug]` ✅ Built - **THE SIGNATURE PAGE**

**Purpose:** everything about one channel, anchored by the ratings grid.

**Rendering:** Server Component, dynamic. Calls `notFound()` on an unknown slug -
this **must** stay a real 404.

**Data:** `getChannel(slug)` + `getChannelGrid(slug, score)` where `score` is
`"public"` or `"elite"` from the `?score=` query param.

### What it currently shows

1. Back link to `/channels`.
2. `<h1>` channel name.
3. A metadata row: handle, episode count, overall average with a star, "N of M
   rated".
4. A **Public / Elite** toggle rendered as two links.
5. The **ratings grid**.
6. The grid legend.

### What it should show

- 🎯 **A proper channel header.** Avatar, name, handle, description, subscriber
  count, a link out to the YouTube channel. Currently there is no avatar and no
  description even though both are in the payload.
- 🎯 **The ratings grid, redesigned.** See section 3.1 below - this is the most
  important single piece of design work in the project.
- 🎯 **The Public / Elite toggle**, redesigned as a real segmented control. It
  currently looks like two ordinary links. It must be obvious that it re-renders
  the grid, and the elite view needs a one-line explanation of what "elite"
  means (verified paying members of this channel).
- Channel-level stats: total episodes, rated count, overall average, best year,
  best episode.
- Below the grid: a **recent episodes** list for this channel, so the page is not
  only a grid.

**Hide:** 🚫 `youtube_channel_id`, 🚫 `last_synced_at` beyond a quiet timestamp.

### 3.1 🎯 The ratings grid - detailed spec

The centrepiece. Read section 3 of `01-design-brief.md` for the semantics.

**Structure**
- A `<table>`. `<thead>` columns are episode numbers within the year (1, 2, 3...).
  `<tbody>` rows are years, newest or oldest first (currently oldest first).
- Row header (sticky, left): the year label, and beneath it that year's average.
- Cells: score to one decimal, background in the band colour.

**Current dimensions:** cells are 56 x 36px with 2px gaps. Real grid is 3 rows x
37 columns for the one channel, so about 2,100px wide - it **must** scroll
horizontally inside its own container while the page does not.

**Every cell state that must be designed:**

| State | Condition | Current treatment | Needs |
|-------|-----------|-------------------|-------|
| Rated | `score` present | Band colour, score text | Refined palette, better contrast |
| **Not rated** | `score === null` | Muted grey, shows `?` | 🎯 Must read as "no data", never as a bad score |
| **Hole** | cell is `null` | Empty `<td>`, no link | Must read as "this year had fewer episodes" |
| **Provisional** | `is_provisional`, under 3 ratings | 10x10px triangle, top-right | 🎯 Redesign. Currently almost invisible |
| **Members only** | `members_only` | 10x10px crown, bottom-right | Redesign |
| **Stream** | `content_kind === "stream"` | 10x10px radio, bottom-left | Redesign |
| Hover / focus | - | Scale 1.1 + ring | Keep, plus a tooltip/preview |

⚠️ **Three markers can appear on one 56x36px cell simultaneously.** That is the
current design's biggest failure. Solve it - maybe a single corner indicator, a
hover card, or a bottom sheet on mobile.

**Interactions**
- Click / tap a cell -> `/e/{youtube_id}`.
- 🎯 **Design a preview.** Desktop: hover card with thumbnail, full title, date,
  score, rating count. Mobile: tap opens a bottom sheet with the same, plus
  "Open episode".
- Every cell must have an accessible name: title plus score.

**Mobile (390px)** 🎯 **This is the hard problem.**
- The page must not scroll sideways; the grid container must.
- 44x44px touch targets conflict with fitting a useful number of columns.
- The sticky year column must stay pinned while cells scroll under it.
- **Consider alternatives for mobile:** a vertical year-by-year list of colour
  bars, a compressed cell without the number (colour only, number on tap), or a
  pinch-zoomable grid. Propose one and justify it.

**Legend**
Currently a flat wrap of seven colour swatches plus four marker explanations.
Redesign as something scannable; consider collapsing it behind an info affordance
on mobile.

### Layout

- **Mobile:** header block, then the segmented Public/Elite control, then the
  grid in a horizontal scroller, then the legend, then recent episodes.
- **Desktop:** channel header full width. Grid gets the full content width.
  Stats can sit as a sidebar or a stat row above the grid.

### States

- **Unknown slug:** real 404. 🚨 Non-negotiable - this is an indexed content site
  and a soft 404 would get dead pages crawled.
- **Channel with no dated episodes:** grid renders an empty-state message. Rare
  but must not crash.
- **Elite view with no verified members:** every cell is unrated. Must still look
  like a grid, and should explain why it is empty.
- **Loading:** grid skeleton.

---

## 4. 📚 Episodes `/episodes` ✅ Built

**Purpose:** browse and filter every episode across every channel.

**Rendering:** Server Component, dynamic.

**Data:** `listEpisodes({ limit, offset, sort, ...filters })` -> `EpisodeListOut`
with `items[]` and `meta { total, limit, offset, has_more }`.

### What it currently shows

`<h1>`, subtitle, and a grid of episode cards. Page size 24.

### What it should show

- 🎯 **Real filter and sort controls.** The API supports them and the UI exposes
  almost nothing. Available sorts: `newest`, `oldest`, `top_rated`, `top_elite`,
  `most_rated`. Available filters: channel, content kind (video / stream),
  members-only, topic.
- 🎯 **Pagination or infinite scroll.** `meta.has_more` is returned and currently
  unused - there is no way to reach episode 25.
- A result count: "Showing 24 of 74".
- Episode cards. See `04-component-inventory.md`.

**Mobile filter pattern:** filters belong in a **bottom sheet** opened by a
sticky "Filters" button, not crammed above the list. Show active filters as
removable chips above the results.

**Desktop:** a left filter rail plus a 3-4 column card grid, or a filter bar
across the top.

### States

- **Empty (filters match nothing):** 🎯 a real empty state with the active
  filters shown and a "clear filters" action. Currently one grey sentence.
- **Loading:** card skeletons in the grid shape.
- **End of list:** "That's everything" rather than silence.

---

## 5. 🎬 Episode detail `/e/[youtubeId]` ✅ Built - **THE MOST IMPORTANT CONTENT PAGE**

**Purpose:** everything about one episode, and the place where a signed-in user
rates, logs and labels it.

**Rendering:** Server Component, `revalidate = 60`. `notFound()` on unknown id -
must stay a real 404.

**Data:** `getEpisode(id)` + `listMoments(id)` + `listComments(id, {limit:20})`.
For a signed-in user, also `ViewerStateOut` (**not wired up yet**).

### What it currently shows

Two-column on desktop (`1fr` + 280px sidebar), one column on mobile:

**Main column:** 16:9 thumbnail, `<h1>` title, a meta row (channel link, date,
duration, members-only badge, stream badge), a "Watch on YouTube" button.
**Sidebar:** a score card (public score, rating count, elite score, elite count),
and a topics card.
**Below, full width:** Moments list, Comments list, Description.

### What it should show

**Header**
- 🎯 The thumbnail is the best asset on the page and it is currently a plain
  rectangle. Make it the anchor - consider a large hero with the title overlaid,
  or a blurred-thumbnail backdrop behind the header block.
- Title. ⚠️ Bulgarian, long, compound words. **Design for 2-3 lines at 390px.**
- Channel link with avatar, upload date, duration.
- Badges: members-only (crown), stream (radio).
- `view_count` when present - ⚠️ **absent on all 9 members-only episodes**, so it
  must vanish cleanly rather than showing `0`.

**Scores** 🎯
- Public score, its band colour, and the rating count.
- Elite score, visually distinguished, with a one-line explanation of what elite
  means. ⚠️ **`null` on 20 of 74 episodes** - design that absence.
- If a score is provisional (under 3 ratings), say so in words, not just an icon.

**🎯 Viewer actions - completely undesigned, highest-value new work**

None of this has any UI. All of it exists in the API:

| Action | API | Notes |
|--------|-----|-------|
| **Rate 1-10** | `PUT /api/episodes/{id}/rating` | 🎯 The primary action. A 10-point scale is a real design problem on a 390px screen - solve it properly. Rating again updates, never duplicates. |
| Remove rating | `DELETE .../rating` | |
| **Mark watched** | `POST /api/episodes/{id}/watch` | Optional date and note. Can be logged multiple times (rewatches). |
| **Favourite** | `PUT/DELETE .../favorite` | Simple toggle. |
| **Personal tag** | `POST .../tags` | 🔒 **Private to the author.** Must be visually distinct from public topics so nobody thinks they are posting publicly. **0 have ever been created** - the UI is why. |
| **Add a moment** | `POST .../moments` | Timestamp + label. 🎯 This is how the product's core value gets created. Make it easy - ideally a timestamp field prefilled from a "what time?" input. |
| **Suggest a topic** | `POST .../topics` | Resolves to a canonical topic server-side. |
| **Vote on a topic** | `POST /api/episode-topics/{id}/vote` | Up or down. |
| **Comment** | `POST .../comments` | With a spoiler flag. |
| **Report** | `POST /api/reports` | On a comment, moment or topic. Small menu item plus confirm. |

**Mobile pattern:** 🎯 a **sticky bottom action bar** with the primary actions
(Rate, Watched, Favourite) and Watch on YouTube. Rating opens a sheet.

**Signed-out:** every action must show but prompt sign-in on tap. Do not hide
them - they advertise what the site is for.

**Topics**
- Public, community-voted. Chips linking to that topic's episodes.
- Show the vote score, and voting controls when signed in.
- ⚠️ Average is ~2.6 topics per episode and many have none. Design the empty
  state as an invitation: "No topics yet - add the first one".

**Moments** 🎯 **The signature content of the page**
- A list of `timestamp -> label`, each linking out to YouTube at that second.
- ⚠️ ~1.6 per episode on average and **very** unevenly spread. Many episodes have
  zero. Design both a rich list and a compelling empty state.
- Show the author and the vote score.
- 🎯 Consider a **timeline visualisation** along the episode duration - moments
  plotted as markers on a bar. `duration_sec` is always present, so this is
  buildable and would look excellent.

**Comments**
- Author, avatar, relative date, body.
- ⚠️ **Spoiler comments** currently blur and clear on hover, which **does not
  work on touch**. 🎯 Design a real tap-to-reveal.
- Comment bodies are user input rendered publicly - always plain text, never HTML.
- Needs: a compose box, edit and delete for your own, report for others.

**Participants**
- `participants[]` with name, avatar, role (host/guest). Only 3 people exist
  today. Small avatar row linking to the person page.

**Description**
- ⚠️ **Average 109 characters.** A footnote, not content. Keep it low on the page
  and design it to look fine at 40 characters.

**Chapters**
- 🚫 **`chapters[]` is ALWAYS EMPTY - 0 of 74 episodes.** Do not design a chapter
  UI as a primary element. If you include one, it must disappear entirely when
  empty.

**Hide:** 🚫 `id`, 🚫 `slug`, 🚫 `availability`, 🚫 `language`,
🚫 `like_count` (unreliable), 🚫 raw `channel_id`.

### Layout

- **Mobile:** hero thumbnail, title block, scores, sticky action bar, then
  tabbed or stacked sections: Moments, Topics, Comments, Description. 🎯
  **Consider tabs** - the page is long and moments/comments both matter.
- **Desktop:** two columns. Main gets thumbnail, title, moments, comments.
  Sidebar gets scores, viewer actions, topics, participants.

### States

- **Unknown id:** real 404.
- **No moments / no topics / no comments:** three separate empty states, each an
  invitation to contribute.
- **Unrated episode (16 of 74):** the score block must look intentional, not
  broken.
- **Members-only episode:** the crown badge, no view count, and everything else
  works normally. We never gate our own content.

---

## 6. 🔍 Search `/search` ✅ Built - **THE PRODUCT'S REASON TO EXIST**

**Purpose:** find an episode by anything - title, description, channel, topic
label, moment label, or participant name - with Bulgarian typo tolerance.

**Rendering:** Server Component, `dynamic = "force-dynamic"` (a stale search
result is worse than a slow one).

**Data:** `search({ q, limit })` -> `SearchOut`.

### What it currently shows

`<h1>`, subtitle, a GET form with one input and a Search button, then a result
count with a "powered by meilisearch - 3ms" badge, then a card grid where each
card may have tiny grey outline badges for matched topics and moments.

### What it should show

- 🎯 **A search field with real presence.** It is the core of the product and
  currently looks like a newsletter signup.
- 🎯 **Make `matched_topics` and `matched_moments` the star.** These explain
  **why** a result matched when the query words appear nowhere in the title -
  that is the entire argument for this site existing. Currently 10px grey
  outline badges. They should be prominent, with the matched term highlighted.
- Result count and query echo.
- The `backend` + `processing_ms` badge is developer-facing. Keep it subtle or
  move it behind a detail toggle. 🚫 Do not make it prominent.
- 🎯 **Filters on results**: channel, content kind, year, has-moments.
- 🎯 **Empty-query state.** Currently one grey line. This is the page's most
  common state and the best teaching opportunity: show example Bulgarian queries
  as tappable chips, popular topics, and recent searches.
- **Zero results:** suggest checking spelling (while noting typos are tolerated),
  offer to browse instead, show popular topics.

**Search must remain a GET form.** The query lives in the URL so results are
shareable and work without JavaScript.

⚠️ **Never design an interaction that puts Cyrillic through a shell or an
unencoded URL.** Queries must be URL-encoded.

### Layout

- **Mobile:** full-width search field pinned near the top, filter chips in a
  horizontal scroller beneath, results as a single-column list. Consider a
  full-screen search overlay launched from the header.
- **Desktop:** centred search field, filters as a left rail or a top bar, results
  in a 2-3 column grid.

### States

- **No query** (most common) - the teaching state described above.
- **Loading** - skeletons, and keep the query visible.
- **Zero results.**
- **Search backend down** - Meilisearch can fall back to Postgres. If search is
  entirely unavailable, say so rather than showing zero results, because "zero
  results" is a lie that looks like a relevance bug.

---

## 7. 🩺 Status `/status` ✅ Built

**Purpose:** is the API up. Developer- and owner-facing.

**Rendering:** Server Component, `dynamic = "force-dynamic"`. Excluded from
search indexing (`robots: noindex`).

**Data:** `getHealthResult()` - never throws; returns `ok:true` with data or
`ok:false` with a plain error summary.

### What it shows

`<h1>` "System status", a card with an overall badge (Operational / Degraded /
Down), dependency rows for database and redis, a checked-at timestamp, and a
**Recheck** button (a Client Component using TanStack Query, showing a success,
warning or error toast).

### What it should show

Mostly fine. Just make it look designed: a clear status hero, proper dependency
rows with icons, and a real timestamp treatment. Low priority.

**Hide:** 🚫 raw error `detail` strings if they could leak internals - show a
friendly message and keep detail behind a toggle.

### States

Three, all real and all reachable: **Operational**, **Degraded** (one dependency
down - genuinely happens when Redis stops), **Down** (API unreachable).

---

## 8. 🚫 404 `not-found.tsx` ✅ Built

**Purpose:** dead URL.

Currently: a search-x icon, "404", "Page not found", a sentence, and two buttons
(Back home, Browse episodes).

**Should show:** the same, designed. 🎯 Consider adding a search field - someone
landing on a dead episode link is exactly the person who wants to search.

🚨 **This page must be served with a real HTTP 404 status.** A regression once
made it return 200 with a blank body, which would have had crawlers indexing
every dead episode link. There is now an automated test guarding it.

⚠️ Note the two buttons currently announce as `role="button"`, not links. Fix in
implementation.

---

# 🔨 Pages that do not exist yet

The API is complete for all of these. There is **no UI whatsoever**. Design them
from scratch.

---

## 9. 👤 Profile `/me` 🔨 Not built

**Purpose:** the signed-in user's home.

**Data:** `MeOut` - `username, display_name, avatar_url, bio, role, memberships[],
rating_count, watched_count, favorite_count`.

**Should show:**
- Avatar, display name, bio, role badge (member / moderator / admin).
- 🎯 Stat tiles: ratings given, episodes watched, favourites.
- 🎯 **A personal ratings distribution** - a histogram of the scores they give.
  This is the kind of thing this audience loves.
- **Memberships**: per channel, the tier, member-since date, and a
  **verified** badge. Unverified ones need a clear "submit proof" path.
- Edit profile: display name, bio, avatar URL only. 🔒 **Role is never editable
  from the UI** - the API rejects it.
- Tabs or links to: My ratings, Watch history, Favourites, My tags.

🔒 **Never design a screenshot preview.** The API exposes only a `has_screenshot`
boolean.

---

## 10. 📝 My ratings / Watch history / Favourites 🔨 Not built

**Data:** `GET /api/me/ratings`, `/api/me/watch`, `/api/me/favorites` - all
return `EpisodeListOut`.

**Should show:** the same episode card grid as `/episodes`, plus the user's own
score on each card, and sort controls. Watch history additionally shows
`watched_on` and any note, grouped by date, with rewatches visible.

---

## 11. 🏷️ My tags `/me/tags` 🔨 Not built

**Data:** `GET /api/me/tags` -> `PersonalTagOut[]`.

🔒 **Private.** These never appear on any public page.

⚠️ **Zero personal tags exist.** Nobody has made one, because there is no UI.
Design it as a genuinely useful private organiser - the user's own labels for
episodes - and make the privacy obvious so nobody confuses it with public topics.

---

## 12. 🔖 Topic page `/t/[slug]` 🔨 Not built

**Data:** `GET /api/topics/{slug}` -> `TopicOut` + episodes filtered by topic.

**Should show:** topic name, episode count, and the episode list. ⚠️ Only **15
topics** exist. A topic index page will look sparse - design for that.

---

## 13. 🎤 Person page `/p/[slug]` 🔨 Not built

**Data:** `PersonDetailOut` - `name, slug, bio, avatar_url, socials{},
appearance_count, episodes[]`.

**Should show:** avatar, name, bio, social links, and every episode they appear
in. ⚠️ **Only 3 people exist** with 95 appearances. Design for very few people
with many appearances each.

---

## 14. 🥇 Leaderboards 🔨 Not built as a page

**Data:** `GET /api/leaderboards/{kind}` - `top_rated`, `top_elite`, `most_rated`
and similar. Currently only used for the home page's top-5 list.

**Should show:** a full leaderboard page with a kind selector, ranked rows with
rank, thumbnail, title, channel, score and rating count. 🎯 Podium treatment for
the top 3.

---

## 15. 🔐 Sign in / Sign up 🔨 Not built

Auth is **Clerk**, wired but awaiting keys. Clerk provides its own components,
which must be themed to match. Design the signed-out state of every page that has
one, plus the "you need an account to do that" prompt that appears when a
signed-out user taps Rate, Favourite or Comment.

---

## 📋 Page priority for prototyping

If effort must be rationed, this is the order:

| Priority | Page | Why |
|----------|------|-----|
| 1 | **Channel detail + ratings grid** | The signature screen. Hardest mobile problem. |
| 2 | **Episode detail** | The most-visited page, and all the undesigned viewer actions live here. |
| 3 | **Search** | The product's reason to exist, currently invisible as such. |
| 4 | **Home** | The front door. |
| 5 | **Episodes browse** | Needs filters and pagination that do not exist. |
| 6 | **Global shell** (header, bottom nav, footer) | Affects every page. |
| 7 | **Profile + signed-in surfaces** | Entirely new. |
| 8 | Channels list, 404, Status | Smaller wins. |
