# The moderation surfaces that were never built, and a name that would not save

**Date:** 2026-08-16
**Trigger:** the owner's walkthrough immediately after spec 16 shipped.

The navigation work landed well - *"the loading panel feels pretty good because
you see the bar at the top now"* - and the rest of the pass found seven things.
One is data loss, three are endpoints that were built with no reader, and three
are polish on what shipped hours earlier.

---

## 1. A saved display name survived about one second

> "On my profile I click edit, I change my display name, I click save and I get
> 'profile saved' - but then I go back and it's the same one that it was before.
> I'm logged in with Google, so this is a problem for sure."

**`display_name` had two writers and no owner.** `PATCH /api/me` wrote what the
member typed; `provision_user` refreshed "the mutable fields the identity
provider owns" on **every authenticated request**. Signing in with Google means
Clerk always has a real name to supply, so that refresh always had something to
write - and it silently reverted the edit before the member could navigate back
to the page.

Nothing about it looked like a bug from either side. The PATCH returned 200 with
the new name in the body. The next GET returned 200 with the old one. Both were
behaving exactly as written.

- ✅ **`UserProfile.display_name_is_custom`** is set the moment a member types a
  name, and `provision_user` then skips the row permanently. The flag is checked
  **first**, before the external-id repair branch, so that repair cannot become a
  back door into a name someone chose.
- 🚨 **Clearing the field un-sets the flag.** `""` means "go back to my Google
  name", not "leave me permanently nameless" - the same sentinel `handle`
  already uses. A member who empties the box by accident gets their name back
  instead of a dead end.
- ⚠️ **The flag tracks the NAME, not "this member has used the form".** Setting
  it on any PATCH would freeze the display name of everyone who ever set a
  handle, which is a much wider promise than the one being made.
- 🧪 Pinned from both directions: `test_auth_identity.py` proves an unrelated GET
  no longer erases the edit, and `test_api_handle.py` proves a provider name
  still lands for a member who has not chosen one - otherwise "stop overwriting"
  quietly becomes "never update", and someone who renames themselves at Google
  is stuck forever.

---

## 2. Three endpoints, no callers

The pattern is the same in all three, and it is worth naming: **an endpoint with
no reader is not a feature.** Each of these was built, tested and shipped, and
each was invisible from the product.

### The report queue

> "I reported a problem, sent it - and now where should I see it as an admin? I
> don't see anything anywhere, I have no clue where I got it."

`GET /api/reports` and `POST /api/reports/{id}/resolve` have existed since wave
13. Nothing called either. `resolution_note` - the reply the reporter is already
shown on their profile - had a reader and no writer.

- 🚨 **A content type and a row id are not a report.** The payload could only
  have said "comment 41", which cannot be acted on without leaving the page, and
  that is most of why nothing was ever built on top of it. `ReportOut` now
  carries `target_label`, `target_youtube_id`, `reporter` and `resolved_by`.
- 🚨 **Resolved in BULK, never `report.target` per row.** A generic FK
  dereferenced in a loop is one query per report plus another to reach the
  episode behind a comment - the exact N+1 that produced a 102-query search
  fallback on this project. `_target_context` is at most two queries per distinct
  content type.
- 🚨 **A deleted target degrades to an empty label rather than raising.**
  Deleting the reported row is frequently the *response* to the report, so the
  queue has to survive its own outcome.

### The decision history

> "I click approve, it's approved - and I should have some history, what was
> approved, when. But I see no history at all. What happened?"

An approval left the pending queue and appeared nowhere. The only evidence a
decision had been made was the absence of the row.

- `GET /api/moderation/participant-proposals/reviewed` returns approved and
  rejected as **one timeline**, newest decision first - not `?status=approved`
  twice, which would interleave two client-side pages wrongly at the boundary.
- `ProposalOut.reviewed_by` is new. `verified_at` already answered "when";
  nothing answered "by whom".
- ⚠️ `status` now also drives the ORDER. A history sorted by `created_at` puts a
  proposal decided this morning below one filed yesterday and decided never.

### The reporter's side of the loop

The profile already listed your reports. It did not say what they were *about*,
who answered, or offer any way out of one filed by mistake. All three are there
now, and `DELETE /api/reports/{id}` finally has a caller - it only ever deletes a
**pending** report owned by the caller, so it is "never mind", not a way to erase
a decision after the fact.

---

## 3. Five suggestions for one episode are one submission

> "What people will do is suggest like 5 people for one episode, so I should see
> them as a batch - these people suggested these 5 people for this episode."

The queue was a flat list of rows, which makes one act look like five
independent decisions and buries the context that makes them reviewable.

- Grouped by **episode AND proposer**, not episode alone: two members proposing
  different casts for the same episode are two judgements, and merging them
  would hide a disagreement behind a single "approve all".
- 🚨 **"Approve all" is disabled until every row has a persona picked.** A
  partial batch approve would apply some and 422 the rest, and the queue would
  then show the leftovers with no sign that the others went through.
- ⚠️ **Sequential writes, not `Promise.all`.** Five simultaneous writes is the
  shape most likely to trip the API-wide write throttle, which would leave the
  batch half-applied with no way to tell which half.
- 🚨 **The persona picker owns its own query, separate from the roster.** Sharing
  one list looked tidier and was a trap: filtering the roster to find someone
  would empty every "approve as" dropdown on the page. The picker is capped at
  the API's `MAX_LIMIT` of 100 **and says so on screen** - a silently truncated
  picker reads as "that person does not exist yet" and invites a duplicate.

---

## 4. The people list had a cap, not pagination

> "The people section will have multiple people there, so we should optimise
> that - you have 1000, I can't render 1000 people."

`GET /api/people` took `limit` alone. Past it the remaining personas were simply
unreachable, and every caller rendered whichever slice it received as though it
were the whole catalogue. It now takes `q` and `offset`.

⚠️ The ordering gained `id` as a final tiebreaker. Personas with equal appearance
counts had no stable order, and an unstable sort under offset paging silently
**drops and duplicates rows between pages**.

---

## 5. Cast roles: three, and the default is `regular`

> "We don't need host and co-host, just remove them - only regular, guest,
> off-camera, and the default to be regular."

`host` and `cohost` ranked the people who are simply on the show every week, and
this catalogue has no use for that ranking. `producer` was a credit rather than a
presence in the episode, which is why it never sat well beside the others.

- 🚨 **Migration 0011 remaps the removed keys rather than trusting the table to
  be empty.** Django does not enforce `choices` at the database level, so a
  leftover `host` would survive happily and render through the web's `?? regular`
  fallback - a wrong answer, not a missing one. `host`/`cohost` → `regular`;
  `producer` → `offcamera`, which is the only judgement call in the file.
- 🐛 **Found while removing them:** `app/e/[youtubeId]/page.tsx` picked the
  "similar episodes" guest with `person.role !== copy.episode.roleHost` - a wire
  value compared against a **translated label**. It happened to work in English
  and matched the first participant in the list in Bulgarian. Both role keys are
  module-scope constants now.

---

## 6. Two moments fixes

### The one that vanished

> "I still see nothing on the moment - I'm pretty sure I added something, why is
> it gone? ... now it appears apparently, which was super strange."

It was not gone. `listMoments` was fetched with `revalidate: 60`, so returning to
the episode page re-rendered from a response captured **before** the write. The
member's own contribution was missing for up to a minute and then returned on its
own, which reads as the site losing data.

- ✅ Moments, cast and comments now use `LIVE_CACHE` (`no-store`). These are the
  reads a member can change from the page they are looking at.
- ⚠️ `router.refresh()` is not a fix here - it explicitly does not invalidate the
  server-side fetch cache. Nor can a write hook: the writes go from the browser
  straight to Django, so Next never learns about them.
- The cost is one uncached call per episode render against endpoints answering in
  single-digit milliseconds. Measured after: `/e/D2yanlVBl-s` at 85.2ms median,
  89.8 KB - inside budget. Payload is unchanged, because caching is not what the
  budgets measure.

### The timestamp keypad, and the "yours" chip

> "On Android I just see the keypad with only numbers, I don't see the two dots -
> this is absurd."

The masking behaviour was right and **nothing on screen said so**. The hint under
the field explained that blank was allowed and never mentioned that the colon is
inserted for you. It now reads "Type digits only - 13029 becomes 1:30:29."

> "I see a 'yours' label on the right which is super useless."

Deleted. The row already names its author under the label, and the delete button
only ever renders on a row you own - so the chip restated the one thing the
control beside it already proved.

---

## Files

| Area | Files |
| ---- | ----- |
| Display name | `podcast/models.py`, `podcast/auth/backends.py`, `podcast/api/me.py`, migration `0010` |
| Cast roles | `podcast/models.py`, `podcast/services/participants.py`, migrations `0010` + `0011`, `components/episode/CastProposer.tsx`, `app/e/[youtubeId]/page.tsx`, `lib/copy.ts` |
| Moderation | `podcast/api/{moderation,community,schemas,serializers}.py`, `components/manage/ProposalQueue.tsx`, `components/manage/ReportQueue.tsx`, `app/me/people/page.tsx`, `components/shared/MyReports.tsx` |
| People paging | `podcast/api/public.py`, `app/me/people/page.tsx` |
| Moments | `lib/api/podcast.ts`, `components/episode/MomentComposer.tsx`, `lib/copy.ts` |
| Tests | `test_auth_identity.py`, `test_api_handle.py`, `test_timestamps_and_reports.py`, `test_participant_proposals.py`, `test_people_admin.py` |
