# The cast is named as a group, and the dropdown is ours

**Date:** 2026-08-20
**Trigger:** owner walkthrough of the episode page's Cast section.

> "when I click add someone and I click choose a person it's a drop down which
> is like native to the device you're using - we want to have our own. And I
> need to click someone to click suggest, then to click someone else to click
> suggest, it's so slow. I want to click first person his role, second person
> his role and then click suggest for the whole group. And if I'm the admin I
> should be able to approve here the suggestions on the episode. Also we have
> awaiting review and withdraw written, let's make them icons and if you hover
> you see the name of the thing. And for the withdraw we need confirmation as
> well. And everywhere else on the app where we have choose a person we want
> our component, not the native."

Six items, all in one flow. What follows is what each one turned out to be
about, because in three of the six the obvious implementation is the wrong one.

---

## 1. The batch is a SERVER concern, not a form trick

The visible ask is a form with several lines and one button. The trap is
implementing that against the endpoint that already existed:
`POST /episodes/{id}/participants` takes one person, so a multi-line form would
loop it from the browser.

🚨 **That loop half-applies.** The duplicate rules in
`podcast/services/participants.py` are real and fire often - the same person
twice, someone already in the confirmed cast, a name this member already
suggested. On the third of five lines, the browser has created two proposals and
is showing an error about the third, with nothing on screen saying where the
boundary fell. The member's form and the database now disagree, and the only way
to find out how is to reload and read the pending list.

This project has already written that lesson down once, on the other side of the
same feature: the review queue's "approve all" is **disabled** until every row
has a persona, because *"a partial batch applies some and 422s the rest with
nothing on screen saying which"*. A client-side loop here is that same failure,
built deliberately.

So `POST /episodes/{youtube_id}/participants/batch` takes `{items: [...]}`,
runs the existing `propose` service inside **one `transaction.atomic()`**, and
raises on the first bad row - which rolls the whole submission back. The error
names the row (`"Тонката: You have already suggested that person for this
episode"`), the form keeps every line exactly as typed, and the member fixes one
thing and sends it again.

Two smaller consequences worth knowing:

- ⚠️ **The within-batch duplicate check is free.** A transaction reads its own
  writes, so proposing the same person twice in one submission is caught by the
  *existing* rule rather than a second rule that could drift from it.
- ✅ **One request is one throttle slot.** `WriteThrottle` is attached to the
  whole `NinjaAPI` and counts requests, so a five-person cast used to cost five
  slots of the member's 60/min and now costs one. `MAX_CAST_BATCH = 20` bounds
  the other direction - an unbounded list is a write amplifier behind that one
  slot.

The single-item endpoint stays. It is the older contract, it is what the mobile
app would use for a one-off correction, and nine existing tests cover it.

---

## 2. "Our own dropdown" is not a styling job

A native `<select>` on a phone hands the choice to the operating system's wheel
or full-screen list. It cannot show an avatar, it cannot be searched, and it
looks like a different application - which is the visible half of the complaint.

The invisible half is worse: **`/api/people` pages at `MAX_LIMIT = 100`**, and a
`<select>` had no way to reach past the first page at all. With enough personas,
the select is not just ugly, it is a picker that cannot pick most of the
catalogue. The review queue had already noticed this and worked around it with a
page-level filter box feeding every dropdown at once - which meant searching for
one persona **emptied every other row's dropdown**, so a moderator looking
someone up silently lost the ability to approve anyone else.

`components/shared/PersonPicker.tsx` is a listbox with its own search, its own
query, and its own statement of its cap. Both call sites now use it, and the
page-level filter is gone with the class of bug it created.

Notes that cost something:

- 🚨 **The empty-state line lives OUTSIDE the `<ul role="listbox">`.** A listbox
  may only contain options; a bare `<li>` of prose inside one is an
  `aria-required-children` violation, and `e2e/a11y.spec.ts` fails the build on
  any serious axe violation.
- 🚨 **`valueLabel` is passed in, never looked up in the loaded page.** The panel
  searches the server, so the chosen persona is routinely not in the current
  page of results - a lookup would blank the trigger the moment the moderator
  searched for someone else.
- ⚠️ **The panel is positioned, not portalled.** Every call site today is a plain
  card or form row. If it ever needs to live inside a scroll container, portal
  it - do not add `overflow-visible` somewhere and hope.
- 🚨 **The role is three pills, not a fourth dropdown.** There are exactly three
  roles and they never grow with the data, so a menu would hide a choice that
  fits on the line - and it is set on every single line a member adds.

---

## 3. The composer at rest now has NO typable control, and that broke a test honestly

`e2e/ios-safari.spec.ts` 14.3 asserts no form control under 16px, because Safari
zooms the viewport on focus and never zooms back. It failed - not on the font
size, but on its own **vacuity guard**: `input, textarea, select` matched
nothing, because the picker trigger is a `<button>` and so are the three role
pills.

The guard was right and the test needed to grow. Both fields it used to cover
still exist - the panel's search box and the free-text name field - they are
just one interaction away now, so 14.3 opens each of them and asserts there.
Asserting on the resting state would have proved nothing.

> 🚨 This is the shape to watch for whenever a control stops being a native
> element: a test that passes because its selector stopped matching is a test
> that has quietly retired. The guard is the only reason it announced itself.

---

## 4. Approving on the episode page is not a duplicate of the queue

The review queue on `/me/people` groups a submission and is where a batch is read
as a batch. It is not where a wrong cast is *noticed*. The person who spots it is
looking at the episode, and making them leave the page to act is how a queue
grows.

- A proposal that already names a persona approves in **one click**.
- A **typed name** cannot: there is no persona to attach it to, and the server
  422s without one. The row renders an "approve as" picker, and the approve
  control stays disabled until it is answered. 🚨 The hint lives on the picker,
  not as a `title` on the disabled button - `disabled:pointer-events-none` means
  a tooltip there can never be hovered.
- 🔒 `isStaff` decides what is **rendered**. Every endpoint behind it re-checks
  the role on the server, because a hidden button is not a permission.
- It reads the same `["me"]` query key the header and the profile page use, so
  it is deduped rather than a second round trip.

---

## 5. Icons with hover labels, and one confirmation

"Awaiting review" and "Withdraw" spelled out beside every pending row were most
of the line. They are now a clock and an undo arrow, with
`components/shared/Tooltip.tsx` supplying the name on hover and on keyboard
focus.

- 🚨 **The bubble is `hidden` when closed, not `opacity-0`.** An absolutely
  positioned element still contributes to `scrollWidth` while transparent, so a
  permanently mounted label on a right-edge icon would widen the document and
  give the page a horizontal scrollbar - invisible on screen, and exactly what
  `ios-safari.spec.ts` 14.4 exists to catch. Measured at 390px while hovering
  the right-most icon: `scrollWidth` 390, viewport 390.
- ⚠️ **Hover is a pointer behaviour.** On a phone the label never appears, which
  is why every trigger carries its own accessible name (`aria-label`, or an
  `sr-only` span) and the bubble is `aria-hidden` so it is not announced twice.
- 🚨 **Withdraw asks first.** It deletes the row outright with no undo, and the
  trigger just shrank from a word to a 30px icon - which is precisely when a
  mis-tap becomes likely. Approve and reject do not ask: they are reversible in
  the sense that matters (the row survives, the decision is in the history), and
  they are the moderator's own deliberate action.

---

## What changed

| File | Change |
| ---- | ------ |
| `apps/api/podcast/api/schemas.py` | `MAX_CAST_BATCH`, `ParticipantProposeBatchIn` |
| `apps/api/podcast/api/community.py` | `POST /episodes/{id}/participants/batch`, atomic |
| `apps/api/podcast/tests/test_participant_proposals.py` | `TestBatchProposing` - 9 cases, four of them about the rollback |
| `apps/web/components/shared/PersonPicker.tsx` | new - the searchable listbox |
| `apps/web/components/shared/Tooltip.tsx` | new - CSS-only hover/focus label |
| `apps/web/components/episode/CastProposer.tsx` | multi-line composer, role pills, icon actions, in-place approve/reject/withdraw |
| `apps/web/components/episode/CastSection.tsx` | reads `["me"]` for the staff branch |
| `apps/web/components/manage/ProposalQueue.tsx` | picker replaces the `<select>`; the page-level filter is deleted |
| `apps/web/lib/copy.ts` | `copy.picker` group + nine cast keys, both locales |
| `apps/web/e2e/cast-composer.spec.ts` | new - section 18, 5 tests x 2 viewports |
| `apps/web/e2e/ios-safari.spec.ts` | 14.3 now opens the two controls it used to find at rest |

## Verified

- `pytest podcast/tests/test_participant_proposals.py` - 43 passed (34 existing + 9 new)
- `tsc --noEmit`, `eslint`, `vitest run` - 196 passed, incl. the OpenAPI drift check against the live schema
- `playwright e2e/cast-composer.spec.ts` - 10 passed (desktop + mobile)
- `playwright e2e/ios-safari.spec.ts` - 12 passed on **real WebKit**
- `playwright e2e/a11y.spec.ts e2e/public-browse.spec.ts` - 92 passed
- A scripted click-through against a production build on both viewports: pick a
  person, search it, add a second line, one submit, two pending rows, approve one
  as admin, withdraw the other through its confirmation. Zero console errors.

⚠️ **The click-through needed three `Person` rows, which the local database does
not have** (it holds only real ingested data, and personas are curated by hand).
They were created, used and deleted; the database is back to 0 people, 0
proposals, 0 participants. This is also why `cast-composer.spec.ts` asserts
nothing that requires a persona to exist - such a test would pass vacuously on
the real corpus.
