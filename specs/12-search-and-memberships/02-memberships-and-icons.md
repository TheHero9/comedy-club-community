# Self-managed memberships, and the profile-icon ladder

**Date:** 2026-08-16
**Owner ask:** *"you have many podcasts but the channels have different membership
payment ... we want a section from the profile where you manage your memberships
for the channels. You add when your membership renews - like the 6th of September
- and enter the current streak you have, like I have 70 months. So on the 6th of
September we need automatically to calculate and say it will be 71."*

---

## 1. The one decision everything else follows from

### 🚨 The month count is not a column

The obvious schema is `months = IntegerField()`. It is wrong the next morning:

- stale within 24 hours of being typed
- needs a nightly job over every membership row to stay true
- that job failing silently leaves every badge wrong, with nothing to detect it
- that job running twice double-counts, with no way to tell it already ran

So the two things the user *can* tell us - **"70 months"** and **"renews on the
6th"** - collapse into **one stored anchor**, and the count is derived on read.

```
member_since_for(70, 6, 2026-08-16)  ->  2020-11-06
months_held(2020-11-06, 6, 2026-08-16)  ->  70
months_held(2020-11-06, 6, 2026-09-05)  ->  70    # not yet
months_held(2020-11-06, 6, 2026-09-06)  ->  71    # on its own
```

No Celery task, no cron, no backfill, and correct at whatever instant it is
asked. Verified live end to end - the row the UI wrote for the owner's own
example:

```json
{"member_since": "2020-11-06", "renewal_day": 6,
 "months": 70, "next_renewal": "2026-09-06", "is_verified": false}
```

`podcast/services/memberships.py` holds the four functions; `test_memberships.py`
proves them as a **round trip** across all 31 renewal days x 5 month counts x 6
reference dates (930 cases), not against hardcoded dates.

### ⚠️ `renewal_day` is stored, not derived from `member_since.day`

They agree 28 days out of 31. A membership renewing on the **31st** has a
`member_since` clamped to the 30th in a 30-day month, so reading the day back off
the date would move that user's renewal to the 30th permanently. `date(2026, 2,
31)` is also a `ValueError` - every function clamps through `clamp_day`.

### Day one is month ONE

Not month zero. That is what a YouTube badge means and what the user typed. An
off-by-one here is invisible in testing and wrong on every profile.

---

## 2. What a claim grants

Owner ruling: *"for now badges, the elite will be soon added as condition,
I will think about it."*

| | Self-added | Admin-verified |
| --- | --- | --- |
| Member badge on the profile | ✅ | ✅ |
| Profile icons unlocked | ✅ | ✅ |
| Ratings feed the channel's **Elite score** | ❌ | ✅ |

`is_verified` stays the only input to elite scoring, so turning this on later is
a change to one condition rather than a migration.

🚨 **Claiming does not clear an existing verification.** Restating a month count
is not new evidence; only a new screenshot resets it. Pinned by
`test_claiming_does_not_clear_an_admin_verification`.

### 🚨 `POST /me/memberships` is an upsert

There is a unique constraint on `(user, channel)`, and the endpoint used to be a
bare `get_or_create`. A second POST was therefore a silent no-op that returned
the **old** row - so a user correcting a typo in their month count got their
wrong number handed straight back with a `200`, which reads as the form being
broken. `PATCH /me/memberships/{id}` was added for explicit edits, scoped to
`request.auth` and ignoring any `channel_id` in the body (moving a membership
between channels would silently move an elite vote - that is a delete plus a new
claim).

---

## 3. Profile icons: the machinery, not the art

The artwork does not exist yet. What shipped is everything around it, so the drop
is a data change:

```python
# apps/api/podcast/data/avatar_icons.py
AvatarIcon(key="bff-gold", label="BFF Gold",
           image_url="/static/avatars/bff-gold.png",
           channel_slug="bff-pepi-q", min_months=17),
```

No migration, no backfill, no code. `UserProfile.avatar_key` stores the **key**;
where the image lives and what it costs are catalogue data.

Three rules the code enforces:

- 🚨 **Months do not pool across channels.** 17 months on one channel unlocks
  nothing on another - that is the entire point - so the unlock check is keyed by
  channel slug and never summed.
- 🚨 **The unlock is re-checked on every read.** A membership can lapse after an
  icon was chosen; a profile still showing an icon it no longer qualifies for
  makes the ladder meaningless.
- 🚨 **A re-locked key is not erased.** It stops rendering; renewing restores it.
  Deleting it would silently discard something the user earned.

🔒 The unlock is enforced in `PUT /api/me/avatar` (403), not by the disabled
button. Locked icons are still **listed** - an icon you cannot have yet is the
reason to keep a membership, and hiding it turns a ladder into a list of the two
things you already own.

---

## 4. The channel "Full view", and the two ways it was got wrong

`GridFitToggle` is gone. It scaled the inline grid with `transform: scale()` but
left its container at full height, so the page grew a vertical scrollbar over
mostly-empty space - the opposite of what "fit to screen" promises.

Its replacement is a fullscreen overlay, **transposed**: years across, episodes
down each column, so the whole channel fits one frame and can be screenshotted.
Owner call: thin colour strips are fine, no numbers needed at that scale.

### 🚨 It is fetched, not passed as a prop

It is a Client Component, so anything handed to it is serialized into the RSC
flight payload on **every** page load, opened or not - and the flagship channel's
grid is 322 KB of JSON on a page already measured at 916 KB. Fetching on first
open costs the page zero bytes.

### 🚨 The cells are flex-sized, and that is the second attempt

The first version computed `(100dvh - CHROME_HEIGHT_PX) / rowCount`. It
overflowed twice, and both failures were the same shape - **a number standing in
for a layout the browser was going to compute anyway**:

1. it ignored the 1px gap between cells. On 184 rows that is **184px** of
   unaccounted height, so the tallest years ran off the bottom of an overlay
   whose entire promise is that nothing scrolls.
2. the chrome constant was measured at 1280px wide, where the legend is one line.
   At 390px it wraps to three, and the **small** channel overflowed by 22px.

Any fixed chrome constant has that second bug permanently. So the chrome takes
the height it needs, the cell column takes what is left (`flex-1 min-h-0`), and
each cell takes an equal share of that. Every column renders
`grid.rows.length` children - a short year renders spacers, not fewer cells - so
equal shares keeps the years aligned, which is the whole point of a heatmap.

Measured after the fix (`scrollHeight - clientHeight` of the scroll container):

| channel | viewport | cells | cell size | inner scroll |
| --- | --- | --- | --- | --- |
| Comedy Club Podcast | 1280x800 | 1,225 | 108 x 5.6 | **0** |
| Comedy Club Podcast | 1440x700 | 1,225 | 123 x 5.1 | **0** |
| Comedy Club Podcast | 390x844 | 1,225 | 27 x 5.7 | **0** |
| Ivan Kirkov | 390x844 | 71 | 115 x 19.8 | **0** |
| Ivan Kirkov | 1280x800 | 71 | 412 x 19.6 | **0** |

`e2e 3.13b` runs against the flagship channel at both viewports and fails on more
than 1px of overflow - it is the test that would have caught either bug.

---

## 5. Files

| Path | What |
| --- | --- |
| `apps/api/podcast/services/memberships.py` | the month maths |
| `apps/api/podcast/data/avatar_icons.py` | the icon catalogue - **add artwork here** |
| `apps/api/podcast/api/me.py` | claim/patch/delete, `/me/avatars`, `/me/avatar` |
| `apps/api/podcast/tests/test_memberships.py` | round trips + endpoint rules |
| `apps/web/app/me/memberships/page.tsx` | the management page |
| `apps/web/components/profile/MembershipEditor.tsx` | the add/edit sheet |
| `apps/web/components/profile/AvatarPicker.tsx` | the icon picker |
| `apps/web/components/grid/GridFullscreen.tsx` | the fullscreen grid |

Migration: `0007_channelmembership_renewal_day_userprofile_avatar_key` - two
additive nullable/blank columns.
