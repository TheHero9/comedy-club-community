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


---

## Production rollout, 2026-08-15

All 31 items are live. The rollout itself surfaced two infrastructure facts that
were wrong in the documentation.

### 🚨 Railway never auto-deployed

`CLAUDE.md` claimed "`git push` to `main` deploys everything". It does not.
Vercel rebuilt the web on the push; Railway created **no deployment at all** for
either of the two commits that touched `apps/api/**`. Not queued, not failed -
never created. The Railway GitHub App is not installed on the repo.

The result was the worst possible shape for about twenty minutes: the web
deployed and the API did not, so the site served a new frontend against an old
schema. `/api/me` had no `handle`, the channel order was still alphabetical, and
nothing anywhere reported a problem.

**Always verify the API independently of the web after a push.** A green Vercel
deploy is not evidence about Railway.

### 🚨 `redeploy` silently ignored a config change

The documented recipe for a one-off production command was to set the worker's
start command to `sh -c "python manage.py <cmd> && celery ..."` and redeploy.
That was done, the config read back correctly, the deployment reported SUCCESS,
and Celery came up healthy - but `set_channel_order` never ran.

`redeploy` re-runs the most recent deployment *reusing its build and its
config*, so the newly-set start command was never used. The only evidence was a
**gap**: nothing at all in the logs between "Starting Container" and Celery's
banner. Had the check been "did the deployment succeed" rather than "did the
data change", this would have been recorded as done while nothing had happened -
exactly the failure mode already recorded for `repair_metadata` on 2026-08-10.

**What worked:** `preDeployCommand`, one command per deployment, triggered as a
genuinely NEW deployment. Its output lands in the deploy log
(`Updated 7 channel(s).`), and a non-zero exit fails the deploy loudly.

### The junk participant was never in production

Item #15 asked for `Гост от публиката` to be deleted from local **and**
production. It was deleted locally (12 participations). Production turned out to
have **zero `Person` rows** - the persona was demo residue that only ever existed
on the dev box. Nothing was deleted in production, and nothing needed to be.

⚠️ This was nearly a self-inflicted outage: the `delete_person` preDeployCommand
was already armed when the check came back empty, and `delete_person` raises
`CommandError` on a missing target - which as a preDeployCommand fails the
deployment. The config was cleared before that deploy reached its pre-deploy
phase. **Confirm the row exists before arming a destructive one-off.**

### Final verified production state

| Check | Result |
| ----- | ------ |
| `api`, `celery-worker`, `celery-beat` | all on `1a19938` |
| Migration `0005` | applied (`... OK` in the deploy log) |
| `/api/health` | `database.ok` + `redis.ok` |
| Channel order | the curated 7, verified against the live API |
| `MeOut.handle` | present in the live OpenAPI schema |
| Web default locale | `<html lang="en">`, "Every episode." |
| `/e/BADID` | still a hard 404 |
| Search split + pagination | both regions render, "load more" present, timing readout gone |


---

## Batch 2, 2026-08-15 (items 32-47)

A second walkthrough after the first batch shipped. 16 items, all built.

| # | Task | Surface |
| - | ---- | ------- |
| 32 | Remove the four example-query chips under the search bar | Home |
| 33 | Remove the same chips | Search |
| 34 | Popular topics collapsed by default | Search |
| 35 | Say what search covers - and that transcripts are most episodes, not all | Search |
| 36 | Remove the header search trigger; it existed in three places | Header |
| 37 | Display name must never fall back to an email | API |
| 38 | Show the real Google avatar instead of two initials | Profile |
| 39 | Let the user edit their handle | Profile + API |
| 40 | Move sign-out out of the navigation stack | Profile |
| 41 | Sticky year column glitched while scrolling | Channel |
| 42 | "Fit to screen" for the whole ratings grid | Channel |
| 43 | Explain how moments get logged | Episode |
| 44 | Community score beside your own, labelled, at the top | Episode |
| 45 | "See every rating" jumped nowhere | Episode |
| 46 | Confirm before removing a logged watch date | Episode |
| 47 | Drop the episode title from the rating sheet | Episode |

### Two diagnoses that changed what got built

**"I can see my email" was not an email field.** `/api/me` has never returned
one and `MeOut` has no such key. What rendered was the DISPLAY NAME, because
`humanize()` fell back to the email's local part when Clerk supplied no name.
The fix is not to hide a field - it is to stop that fallback existing, since the
same value is `author_name` on every public comment.

**"I see two letters" was an ignored avatar.** Clerk gives us `image_url` from
Google and we store it on `UserProfile.avatar_url`, but the profile page passed
only `name` to `PersonAvatar`, which renders initials. The picture was in the
database the whole time. Initials now sit *behind* the image, so a URL that
stops resolving degrades to the tile with no client JS and no layout shift.

### #45 was a bug I shipped in batch 1

The "See every rating" link pointed at `/channels/<slug>#year-<n>` and **no
element carried that id**, so the browser jumped nowhere and the button read as
dead. `GRID_ANCHOR` is now a shared constant rendered by the channel page and
consumed by the episode page, with `scroll-mt-20` so the sticky header does not
land on top of the heading you just jumped to.

### #41: the sticky column was fighting its own container

`position: sticky; left: 0` resolves against the scrollport's padding box. The
scroller carried `px-4`, so the year column parked 16px in and the scrolling
cells slid through the gap beside it. The gutter moved onto the table as a
margin, and the sticky cells gained a `4px` shadow in the same colour to cover
the `border-spacing` gap.

### #42 is a CSS scale, deliberately

The flagship channel is ~2,024 cells and getting that grid to 916 KB was
expensive. "Fit to screen" is `transform: scale()` on a wrapper around the grid
the server already sent - re-rendering at a second size would either double the
payload or need a client round trip.
