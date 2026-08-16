# Why the whole app felt slow, and the moments/cast round that came with it

**Date:** 2026-08-16
**Trigger:** the owner's walkthrough after spec 14 shipped.

> "everything from the app is super super slow and it's not natively loading. I click on
> the search, I type a topic, I click search, and it goes back to the home page for a
> second and I need to wait like 2 seconds to actually go to the search page. When you
> click something to open an episode you don't have any floating indication - it feels
> like nothing happened."

Two independent findings share this document because they arrived in one message: a
site-wide navigation fault, and a round of moment/cast changes.

---

## 1. The navigation fault

### What was actually wrong

**Not the API, and not the render.** Every measured route answers in tens of
milliseconds. The fault was that *none of the waiting was ever shown*, and that Next.js
had been silently opted out of the one optimisation that hides it.

The chain:

1. `lib/locale.ts` reads a cookie, which makes **every route on the site dynamic**.
   That was a priced, documented trade (spec 11) - but only its render cost was priced.
2. Next **skips prefetching dynamic routes entirely**, *unless the route has a
   `loading.tsx`*, in which case it partially prefetches the shell and the fallback.
   (`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`,
   § "Dynamic routes without `loading.tsx`".)
3. This app had **one** `loading.tsx`, on `/status`.

So every link on the site was un-prefetched, and every click blocked on a full server
round trip with the *previous page still on screen and no indication anything had
happened*. The docs describe this outcome in as many words: "this can give the users the
impression that the app is not responding".

🚨 **The reason it stayed hidden for so long is a rule in CLAUDE.md that is correct and
was over-applied.** A root `app/loading.tsx` turns every `notFound()` into a soft 404,
and that bug cost a day on 2026-08-08. The rule written down afterwards was "never
`app/loading.tsx`" - which is right - but it was read as "loading files are dangerous",
and so none were ever added anywhere. The actual rule is narrower: **never at the root,
and never ABOVE a segment that can call `notFound()`.**

### The `/search` two-second gap, specifically

`SearchOverlay.go()` read:

```ts
onOpenChange(false);                                   // close the sheet
router.push(`/search?q=${encodeURIComponent(next)}`);  // ~2s: force-dynamic + 2 Meili trips
```

The sheet closed **first**, revealing the page underneath for the entire navigation.
That is literally the reported symptom - "it goes back to the home page for a second".
The overlay now wraps the push in `useTransition` and holds, with a spinner on the
submit button, until the new route commits.

### What shipped

| Route | Treatment | Why |
| ----- | --------- | --- |
| `/search`, `/episodes`, `/leaderboard`, `/me/memberships`, `/me/people` | `loading.tsx` | Cannot `notFound()`. |
| `/channels` | `loading.tsx` inside a new `(index)` route group | A boundary at `app/channels/` would also wrap `/channels/[slug]`. |
| `/me` | `loading.tsx` inside a new `(overview)` route group | A boundary at `app/me/` would also wrap `/me/[list]`. |
| `/e/[youtubeId]`, `/channels/[slug]`, `/me/[list]` | **No boundary.** `NavProgress` instead | These call `notFound()`. A boundary here is the soft-404 bug. |

🚨 **The route groups are load-bearing, not tidiness.** A `loading.tsx` covers its
segment *and every child*. Moving either index page back up one level silently
reintroduces the soft 404 for its `[slug]` sibling, so
`e2e/status-codes.spec.ts` 2.6 now asserts that `app/channels/` and `app/me/` contain no
loading file, and adds `/me/not-a-list` to the routes that must answer a hard 404.

Verified after the change - the check CLAUDE.md demands whenever a boundary is added:

```
404  /channels/does-not-exist     200  /channels          200  /me/memberships
404  /e/BADID                     200  /me                200  /me/people
404  /me/not-a-list               200  /episodes          200  /search?q=баница
404  /nope-at-all                 200  /leaderboard
```

### `NavProgress`

`components/shared/NavProgress.tsx` uses **`useLinkStatus`** (Next 15.3+) to render a
fixed 3px bar at the top of the viewport while a link is navigating.

- 🚨 **It must be rendered INSIDE a `<Link>`.** The hook reads the nearest Link ancestor
  and returns `{pending:false}` anywhere else, so it cannot be mounted once in the
  layout. It sits in `EpisodeCard`, `SearchResultCard`, `LinkButton`, the home page, the
  leaderboard and the profile rows.
- The CSS starts it invisible with a **120ms animation delay**, so a navigation that
  resolves faster than that shows nothing rather than flashing.
- It stops at **92%, never 100%** - the bar measures nothing, and running it to the end
  would promise a completion it cannot know about. The route swap removes it.
- ❌ **Deliberately NOT on the ratings grid.** 1,225 cells x a client component is
  exactly the payload class that took that page from 2,271 KB to 629 KB.

### Two consequences that looked like bugs

1. 🚨 **Streaming makes a raw DOM read racy.** `e2e/search.spec.ts` started failing with
   a **doubled** result id and a strict-mode violation on `getByText`. Neither is a
   product bug: React streams a completed Suspense boundary into a `<div hidden>` at the
   end of `<body>` and moves it into place with an inline script, so for a few
   milliseconds the document genuinely contains the results twice. The fix is
   `waitForResults()`, which waits for **exactly one** `<h1>` - the heading is right
   because it renders for every query including one that matches nothing, so waiting on
   a result region instead would hang forever on the empty case.
2. **`/search?q=ергена` is 182.9 KB against a 180 KB budget.** Both halves were measured
   rather than assumed: removing `NavProgress` and rebuilding gave **181.1 KB, still
   over**. So 1.8 KB is new (26 spans x ~45 bytes, doubled by the flight tree) and
   22.6 KB was already there - and the page renders 24 cards, inside the budgeted 26, so
   it is ordinary community-data growth per card, not card count. Ceiling raised
   180 -> 190 with that reasoning recorded in `scripts/perf-budgets.json`.

---

## 2. Moments

### The timestamp could not be typed on a phone

> "at the timestamp it's like a number field and I can't add the two dots ':' and it's
> super annoying"

The field carried `inputMode="numeric"`, which on a phone is a **digits-only keypad with
no colon key at all**. The one separator the format requires was unreachable on the
device most of this audience uses.

Widening to `inputMode="text"` would fix reachability and leave the colon two taps deep
behind a symbols page. Instead `maskTimestampInput` **inserts** it: type `13029`, read
`1:30:29`. Grouped from the right, so every prefix of a real time is itself a real time
(`1`, `13`, `1:30`, `13:02`, `1:30:29`) and the field never rejects you mid-word. Typed
or pasted colons are stripped first, so `1:30:29` pastes correctly.

⚠️ **The mask does NOT validate.** `475` becomes `4:75`, which the parser then refuses.
Reinterpreting it as 5:15 is exactly the silent rewrite the strict-60 rule exists to
prevent - it would deep-link the video to a second the member never meant.

### The timestamp is now optional

> "for some things we don't want to have a timestamp - it should be optional"

`Moment.timestamp_sec` is nullable. A moment without one is **a note about the episode**
rather than a point inside it: still searchable text, just not a deep link.

- 🚨 **NULL, not 0.** Zero is a real timestamp meaning "the very start", so reusing it
  would make every note deep-link to 0:00 and be indistinguishable from a genuine
  cold-open label.
- 🚨 **`Moment.deep_link` returns `None`, and the row renders as a `<div>` rather than an
  `<a>`.** A link that quietly drops `&t=` looks like a working deep link and lands at
  0:00, which is worse than offering no link.
- 🚨 **Blank and malformed are different inputs.** `resolve_timestamp` gained
  `required=False`, which only the moment endpoint passes - so a caller that has not
  thought about the absent case keeps the old strict behaviour. `4:75` is still a 422
  either way.
- Ordering is `nulls_last`, stated explicitly rather than left to Postgres' ASC default,
  because the client renders a timeline above the notes and interleaving them would be
  wrong.
- `MomentOut.timestamp_sec` is `int | None` and **required in the schema** - no Pydantic
  default - so one forgotten assignment fails loudly instead of silently labelling every
  note as timestamp-less.

### Two sections, and a cap

> "you need two sections, like one your moments and one everyone else's"
> "I don't know what will happen if you add like 30 moments, if it will flood"

Split by **ownership**, from `my_moment_ids` on the authed viewer-state call - never from
`author`, which is a display name two members can share and either can edit.

- Headings appear **only when both groups exist**. A single heading over the only list on
  screen is noise, and "From everyone else" above every moment on an episode you have
  never touched is wrong, not just noisy.
- Each group caps at **8 rows** behind "Show all N". Per-group on purpose: yours
  collapsing because someone else added twenty would hide your own rows behind a control
  you did not cause.
- The tick bar filters out timestamp-less moments rather than pinning them to 0.

---

## 3. Cast roles

> "we have right now host, co-host, guest and producer. We want a main role for the
> people that participate that are part of the community - we won't allow for guests -
> and one for the voice behind the camera."

`EpisodeParticipant.Role` gains two, ordered by how visible the person is in the episode:

| Key | English | Bulgarian | Why it is not one of the existing four |
| --- | ------- | --------- | -------------------------------------- |
| `regular` | regular | редовен | A recurring member of the show. Calling them a guest every episode is wrong in the one place the label carries meaning. |
| `offcamera` | off-camera | зад кадър | Heard, never seen. `producer` is a job, not a presence in the episode. |

🚨 **A gap was found while adding them: `approve` never validated the role.** Django does
not enforce `choices` at the database level, so a moderator's arbitrary string reached
the column intact and `copy.episode.role()` would render it as "guest" - a wrong answer
rather than a missing one. The propose endpoint validated; approve did not, so **the
unvalidated path was the privileged one.** Both now go through `_checked_role`, derived
from the model's own choices so adding a role stays a one-place change.

---

## Files

| Area | Files |
| ---- | ----- |
| Navigation | `app/*/loading.tsx` (7), `app/channels/(index)/`, `app/me/(overview)/`, `components/shared/NavProgress.tsx`, `app/globals.css`, `components/shell/SearchOverlay.tsx`, `components/ui/button.tsx` |
| Moments | `podcast/models.py`, `podcast/services/timestamps.py`, `podcast/api/{community,schemas}.py`, `podcast/admin.py`, migration `0009`, `lib/timestamp.ts`, `components/episode/{MomentsSection,MomentComposer}.tsx` |
| Cast | `podcast/models.py`, `podcast/services/participants.py`, `components/episode/CastProposer.tsx`, `lib/copy.ts` |
| Tests | `tests/timestamp.spec.ts` (new, 12), `e2e/status-codes.spec.ts`, `e2e/search.spec.ts`, `podcast/tests/test_timestamps_and_reports.py`, `podcast/tests/test_participant_proposals.py` |
