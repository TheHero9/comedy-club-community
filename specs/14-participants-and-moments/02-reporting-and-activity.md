# 14.2 - Reporting, the feedback loop, and admin activity visibility

**Status:** 📋 Design, awaiting schema approval. Nothing built.
**Date:** 2026-08-16
**Follows:** [`01-design.md`](01-design.md) - participants & moments

---

## The brief, in the owner's words

> "We need some way for users to report bugs or any other problems - like we have the personas,
> reporting not proposition."
>
> "We need to be able to see as admin somewhere what's going on - who is adding what moments."
>
> "Some type of reporting which will go to the admins, and they will see something, and we can
> give back to the user that OK, we reviewed your request, it's fixed - or return a message."

Two distinct needs, easy to conflate:

1. **Reporting** - a user flags a *problem*. Different from a participant *proposal*, which
   suggests content. A proposal asks for something to be added; a report says something is wrong.
2. **Activity visibility** - the admin needs to see what the community is contributing as it
   happens, not just what has been flagged.

---

## Verified state of the backend

Checked against the code on 2026-08-16, not assumed.

| Claim | Verdict |
| ----- | ------- |
| `Report` model with reason, status, `resolution_note`, `resolved_by`, `resolved_at` | ✅ True |
| `POST /api/moderation/reports`, duplicate-protected with a 409 | ✅ True - `get_or_create` on (reporter, target, pending) |
| Rate-limited | ✅ True - `WriteThrottle` covers the whole `NinjaAPI` |
| Django Admin queue with bulk resolve/dismiss | ✅ True - `ReportAdmin.mark_resolved` / `mark_dismissed` |
| Only comment / moment / episodetopic / rating are reportable | ✅ True - the `REPORTABLE` dict in `podcast/api/moderation.py` |
| No web UI for reporting | ✅ True |
| Users cannot see what happened to their report | ✅ True - `GET /api/moderation/reports` is `require_moderator`; a user can only `DELETE` their own pending one |

### 🚨 Two gaps the earlier summary missed

**1. The bulk admin action cannot write a note - which is the whole feedback loop.**

`ReportAdmin.mark_resolved` and `mark_dismissed` both do `queryset.update(status=..., resolved_by=...,
resolved_at=...)`. Neither touches `resolution_note`. So the described workflow - "you resolve in
Django Admin with a one-line note" - **does not work through the bulk action**. Bulk-resolving
leaves the note empty, and the user gets a status chip with no message: precisely the "we reviewed
your request, it's fixed" that was the point.

Options, cheapest first:
- Resolve individually (open the report, type the note, save). Works today, zero code, tedious at volume.
- ✅ **Recommended:** an intermediate admin page for the bulk action that asks for one note applied
  to the whole selection. Standard Django `ModelAdmin` action-with-form pattern, ~40 lines.
- A per-report note field editable straight from the changelist (`list_editable`).

**2. `MomentAdmin` cannot answer "what is being added right now".**

`Moment.Meta.ordering = ["timestamp_sec"]` - position inside an episode, which is right for the
episode page and wrong for an activity feed. `MomentAdmin.list_display` is
`(episode, timestamp_display, label, score, user)` with **no `created_at` at all**, and
`list_filter` is channel-only. So today the admin shows moments grouped by where they sit in a
video, never by when a human added them.

Fix is small and needs **no schema change**: add `created_at` to `list_display`, set
`ModelAdmin.ordering = ("-created_at",)` (which overrides `Meta.ordering` for the admin only), and
add `user` + `created_at` to `list_filter`.

---

## Design

### What a user can report

Add `Episode` to `REPORTABLE`, and allow a target-less general report.

Episode reporting matters more than it looks: on 2026-08-15 the owner manually reviewed all 1,962
rows to remove 100 promo clips that were never podcast episodes. **"This shouldn't be listed" is
that same judgement, crowdsourced** - the next batch of junk gets flagged by whoever finds it
instead of by one person scrolling a review page.

Categories (a new `Report.category` field):

| Category | Where it appears |
| -------- | ---------------- |
| `wrong_participants` | episode page |
| `wrong_info` | episode page |
| `not_an_episode` | episode page - "this is a promo clip, not an episode" |
| `bug` | footer, any page |
| `suggestion` | footer, any page |
| `other` | both |

### Where the user reports from

1. **Episode page** - a small flag near the actions, opening a dialog: category picker + short
   free text. Target is the episode, or a specific comment/moment when opened from that row.
2. **Footer link on every page** - same dialog, no target, category defaults to `bug`. This is what
   makes "the app is broken" reportable at all, since it points at nothing.

### The feedback loop

A "My reports" section on the profile. Each row shows the category, what it pointed at, a status
chip (Pending / Fixed / Dismissed) and **your resolution note**. The admin writes one line; the
reporter reads it on their next visit.

✅ No email infrastructure, no notification system, no background jobs. The note is already a
column on a model that already exists - it just has no reader.

### Why not the alternatives

- **`mailto:`** - zero code, but unstructured email, no link to the episode, no status, no
  "it's fixed" loop, and it publishes the owner's address to scrapers.
- **Google Form** - off-site, cannot show status, and the data never reaches the admin queue that
  already exists.

Since the queue, the model, the throttle and the duplicate protection are already built, in-app is
simultaneously the nicest option and the least remaining work.

---

## 🚨 Schema deviations - REQUIRE APPROVAL

Generated with `makemigrations`, never hand-written; logged in `docs/02-schema-decisions.md`.

### 1. `Report.category` (new field)

CharField with the choices above, default `other`, `db_index=True`. Nullable is unnecessary -
existing rows take the default.

### 2. `Report.content_type` / `object_id` become nullable

Today both are required, so a report must point at something. A general "the site is broken"
report points at nothing. Making the pair nullable is what allows it.

- ⚠️ `target_display` in `ReportAdmin` already handles a missing target (it prints `(deleted)`),
  but it dereferences `obj.content_type.model` - **that will raise on a null content_type** and
  must be guarded as part of this change.
- The `REPORTABLE` allow-list stays. A null target is only reachable through a category that
  declares itself target-less; it never becomes an open-ended content type.

### 3. `Episode` added to `REPORTABLE` - no schema change

Dict entry only.

### 4. `Moment` / `ParticipantProposal` - no change

Activity visibility is an admin display change, not a data change.

---

## API surface

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/api/moderation/reports` | user | gains `category`, and `target_type`/`target_id` become optional |
| `GET` | `/api/me/reports` | user | 🆕 your own reports with status + resolution note |
| `DELETE` | `/api/moderation/reports/{id}` | self | ✅ exists - withdraw your own pending report |
| `GET` | `/api/moderation/reports` | `require_moderator` | ✅ exists |
| `POST` | `/api/moderation/reports/{id}/resolve` | `require_moderator` | ✅ exists, already writes the note |

🔒 The actor is always `request.auth`. `GET /api/me/reports` filters on the authenticated user and
never accepts a user id from the client.

---

## Admin surface

**Reports** - the existing queue, plus a note prompt on the bulk action (gap 1 above).

**Activity - "who is adding what"** (the owner's second requirement):

- `MomentAdmin`: `created_at` in `list_display`, `ordering = ("-created_at",)`, filter by user and
  date. This alone answers "what moments are being added and by whom".
- `ParticipantProposalAdmin`: already sorted `-created_at` by design in `01-design.md`.
- 💡 Optional, later: one combined "recent community activity" page merging moments, proposals,
  comments and ratings into a single reverse-chronological feed. Nicer, but three separate admin
  lists sorted by recency already answer the question at a fraction of the cost.

---

## Web UI

- `ReportDialog` component, reused by the episode flag and the footer link.
- "My reports" section on the profile.
- 🇧🇬 All strings into **both** dictionaries in `apps/web/lib/copy.ts` - `tests/copy.spec.ts` parses
  every `.tsx` under `app/` and `components/` and fails on a rendered literal.
- 🔒 `reason` and `resolution_note` are user- and admin-authored text rendered publicly to at least
  one other person. Escape on output; never `dangerouslySetInnerHTML`.

---

## Open questions

Carried from `01-design.md`, still unanswered and blocking:

1. **Which account gets `role = admin`?** Needs the email or `clerk_user_id`, and it must be done in
   **production**. `UserProfile.role` governs the API; Django `is_staff` / `is_superuser` govern the
   admin site - both are needed, they are not the same switch.
2. Ship `PersonAlias` in v1, or defer?
3. Is a rejected participant proposal visible to whoever filed it, with the note? (The report
   feedback loop above says yes for reports; proposals should probably match.)

New here:

4. Should a resolved report notify the user in-app (a badge on the profile), or is "visible next
   time they look" enough? The badge needs an unread flag - one more small field.
