# 14 - Community participants & moments

**Status:** ✅ **BUILT and deployed 2026-08-16** (`c8be8c0`). Migration `0008` applied to
production. Schema approved by the owner before the build.
**Date:** 2026-08-16

---

## The brief, in the owner's words

> "On each episode we should have a section with participants, and each user should be able
> to add and propose, and then an admin should be able to verify if they're correct."
>
> "We'll define all the personas manually. When someone finds some custom [name] that is not
> participating in our DB, we will look at it, create a new persona manually from the admin
> panel, and then we'll go to the request and say OK this person is in the episode but not the
> correct name, so we'll change it to the correct name."
>
> "For the moment they should be able to add a moment for an episode. Adding a moment is
> basically a free text box - what happened - and a timestamp. We should have some unified way,
> say like `1:30:29`. We don't need to verify a moment. You'll see all the moments from
> different people, and you can add your own."
>
> "We need to have a role for admins... full logs: when we have a request, when was it
> verified, when it was approved."

Decisions taken 2026-08-16: pending participants are **visible but marked**; audit lives in
**fields on the row**, not a separate log table; **spec before build**.

---

## What already exists

Most of this is plumbing that was built and left empty. Read this before estimating anything.

| Piece | State |
| ----- | ----- |
| `Person` (name, slug, bio, avatar_url, user OneToOne, socials) | ✅ Built, **0 rows** |
| `EpisodeParticipant` (episode, person, role, added_by; unique per episode) | ✅ Built, **0 rows** |
| `UserProfile.Role` = member / moderator / admin | ✅ Built |
| `require_moderator` / `require_admin` / `require_self_or_moderator` | ✅ Built (`podcast/auth/permissions.py`) |
| `GET /api/people`, `/api/people/{slug}`, `?person=<slug>` filter | ✅ Built |
| Participants in the Meilisearch episode document (`participants`, `participant_slugs`) | ✅ Built |
| Episode page cast section with avatars + roles | ✅ Built (`app/e/[youtubeId]/page.tsx`) |
| Django Admin for `Person`, `EpisodeParticipant` (+ inline on Episode) | ✅ Built |
| **Participant write endpoint** | ❌ **Missing - reads only** |
| `Moment` (episode, user, timestamp_sec, label, score, created_at, `deep_link`) | ✅ Built, **0 rows** |
| `GET` / `POST` / `DELETE` moment endpoints, throttled, reportable | ✅ **Built** |
| Episode page moment timeline + deep links | ✅ Built |
| **Moment create form on the web** | ❌ **Missing - no POST wrapper, no component** |
| `Report` generic queue (pending → resolved, `resolved_by`, `resolved_at`) | ✅ Built - the precedent this design copies |

**Moments are ~90% done server-side.** The remaining work there is a form, a timestamp parser
and one serializer field. Participants need the whole approval half.

---

## 🚨 The failure mode this design exists to prevent

Users will name the same person several different ways. This is not hypothetical - it is
visible in the transcripts we already store:

> "Аз съм Иван Кирков. >> Аз съм Ники Банков. >> Ива, >> **Донката**."

That is **Тонката**; the auto-captions mishear the T as a D. The same person is **Тони**
elsewhere. Likewise Росен / Роската, Христо Радоев / Ицо, Дени / Деница.

If a user's free-text entry could create a `Person`, the catalogue ends up with Тони, Тонката
and Донката as three separate personas, `/episodes?person=` splits one filmography across three
half-empty pages, and the Meilisearch `participant_slugs` facet is permanently polluted.
**Merging them afterwards is manual work that grows with every proposal.**

### The ruling

**User input never creates a `Person`.** A proposal carries either a chosen persona (picked
from autocomplete) or a *string the user typed*, and an admin resolves the string onto a real
persona - creating that persona by hand first if it does not exist yet. The canonical table
stays clean by construction rather than by discipline.

---

## Design

### Proposals are a separate model, not a status column on `EpisodeParticipant`

The tempting shortcut is `EpisodeParticipant.status = pending|approved|rejected`. It is wrong
here, for the same reason the NUL-byte check lives in middleware and the throttle is attached
to the whole `NinjaAPI`: **a new reader must not be able to leak pending data by omission.**

`EpisodeParticipant` is already read by the episode serializer, the `?person=` filter, the
person detail endpoint, the Postgres search fallback and the Meilisearch document builder. Add
a status column and every one of those must learn to filter `status="approved"` - and the one
that gets forgotten silently publishes unverified data into search, where it is least visible.

With a separate `ParticipantProposal` table, **every existing query stays correct with no
change at all**, and a pending proposal is structurally incapable of reaching search.

Consequence: `EpisodeParticipant` needs **no schema change whatsoever**. A row in it means
exactly what it means today - a confirmed participant.

### Lifecycle

```
user proposes ──> ParticipantProposal(status=pending)
                        │
        admin reviews in Django Admin
                        │
     ┌──────────────────┼──────────────────┐
     │                  │                  │
  approve            approve as         reject
  (person set)      (map the typed    (note why)
     │               name onto a         │
     │               real Person)        │
     └────────┬───────────┘              │
              ▼                          ▼
   EpisodeParticipant created     status=rejected,
   + reindex_episode queued       stays for the audit trail
```

Approving is idempotent: `get_or_create` on `(episode, person)`, so two users proposing the
same person for the same episode resolve to one participant row and two closed proposals.

### Pending visibility

Pending proposals render on the episode page, visually marked as awaiting review. They are
**not** in `EpisodeParticipant`, therefore automatically absent from Meilisearch, from
`?person=`, and from the person detail page. Search stays trustworthy; the contributor still
sees their contribution landed.

### Moments need no approval

A wrong participant corrupts a canonical entity other pages filter on. A wrong moment is one
bad row on one episode, already reportable through the existing moderation queue, already
deletable by its author or a moderator, already rate-limited by `WriteThrottle`. Approval would
be friction with no protective value.

---

## 🚨 Schema deviations - REQUIRE APPROVAL BEFORE ANY MIGRATION

Per CLAUDE.md these are listed for sign-off and will be generated with `makemigrations`, never
hand-written. Each will be logged in `docs/02-schema-decisions.md` once approved.

### 1. New model `ParticipantProposal` (required)

| Field | Type | Note |
| ----- | ---- | ---- |
| `episode` | FK → Episode, `related_name="participant_proposals"` | |
| `person` | FK → Person, **null/blank** | set when the user picked an existing persona |
| `proposed_name` | CharField(200), blank | set when the user typed a custom name |
| `role` | CharField, reuses `EpisodeParticipant.Role` | host / cohost / guest / producer |
| `proposed_by` | FK → User, `SET_NULL` | survives a deleted account |
| `created_at` | DateTime, auto_now_add | **"when was it requested"** |
| `status` | pending / approved / rejected, default pending | |
| `verified_by` | FK → User, null | **"who verified it"** |
| `verified_at` | DateTime, null | **"when was it approved"** |
| `note` | CharField(280), blank | why rejected, or what the name was mapped to |

- `CheckConstraint`: at least one of `person` / `proposed_name` must be non-empty. A proposal
  that names nobody is not reviewable.
- `UniqueConstraint(episode, person, proposed_by)` **where status = pending** - stops one user
  spamming the same suggestion, without blocking a re-proposal after a rejection.
- `Index(status, -created_at)` - the admin queue's only sort, same as `Report`.

### 2. `EpisodeParticipant` - **no change**

Stated explicitly because it is the point of the design.

### 3. `PersonAlias` (recommended, separable - can ship later)

`person` FK + `alias` CharField(200), unique on a normalised form of the alias.

Its only job is to shrink the admin queue: when a user types "Донката" and an alias maps it to
Тонката, the UI suggests the real persona and no proposal is ever filed. Without it, every
nickname variant reaches the queue forever. **Not required for v1** - say the word and it drops
out of scope.

### 4. `Moment` - **no change**

---

## API surface

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/api/episodes/{youtube_id}/participants` | public | approved + pending, flagged |
| `POST` | `/api/episodes/{youtube_id}/participants` | user | body: `{person_slug?, name?, role}` - exactly one of the first two |
| `DELETE` | `/api/participant-proposals/{id}` | self or moderator | withdraw your own pending proposal |
| `GET` | `/api/moderation/participant-proposals` | `require_moderator` | the queue |
| `POST` | `/api/moderation/participant-proposals/{id}/approve` | `require_moderator` | body: `{person_slug}` - the persona to map onto |
| `POST` | `/api/moderation/participant-proposals/{id}/reject` | `require_moderator` | body: `{note}` |

Notes:
- `require_moderator` passes for **moderator and admin** (`profile.is_staff_role`); `require_admin`
  is admin-only. Approval uses `require_moderator` so the role can be delegated later without a
  code change.
- Approval queues `tasks.reindex_episode` so the new cast reaches Meilisearch without a full
  reindex.
- Writes are already throttled - `WriteThrottle` is attached to the whole `NinjaAPI`, so these
  endpoints cannot ship unthrottled by omission.

### Moment changes

- `moment_out` currently returns `author` as a **display name only**, so two users called "Иван"
  are indistinguishable and "which are mine" cannot be answered. Add a server-computed
  `is_mine` (never a client-supplied id) and keep `author` for display.
- 🚨 **Timestamp parsing is server-side truth.** The client parses for instant feedback; the API
  re-parses and validates regardless, because a client is not an authority on its own input.

---

## Timestamp input

One shared grammar, accepted in the form the owner asked for:

| Input | Seconds |
| ----- | ------- |
| `1:30:29` | 5429 |
| `30:29` | 1829 |
| `4:05` | 245 |
| `45` | 45 |

Rules: 1-3 colon-separated integer parts; every part except the leading one must be `< 60`;
result must satisfy `0 <= t <= episode.duration_sec` when the duration is known. A moment at
2:15:00 on a 40-minute episode is rejected, not stored.

`formatTimestamp` already exists in `apps/web/lib/format.ts` for rendering.

---

## Admin surface (Django Admin)

- `ParticipantProposalAdmin`: list filtered by status, showing episode, proposed name or person,
  role, proposer and age. Actions **approve** / **reject**, and a `person` field to set the
  correct persona before approving - this is the "change it to the correct name" step.
- Creating a `Person` by hand stays exactly as it is today; the owner seeds the cast first.
- `MomentAdmin` already exists for cleanup.

---

## Web UI

**Episode page - cast section** (extends the existing one):
- "Add participant" for signed-in users: autocomplete over existing personas, plus an explicit
  "can't find them? add a name" path that submits `name` instead of `person_slug`.
- Pending entries render marked as awaiting review.

**Episode page - moments section** (the existing section gains a form):
- Free-text label + timestamp field with the grammar above, inline validation.
- Your own moments are distinguishable; you can delete them.

🇧🇬 Per spec 11 the UI locale is English by default with Bulgarian content; all new strings go in
`apps/web/lib/copy.ts` - `tests/copy.spec.ts` fails the build on a rendered literal, so this is
enforced, not aspirational.

---

## Open questions

1. **Which account gets `role = admin`?** The owner asked for their currently-authenticated
   account to be elevated. This needs the Clerk-linked identity (email or `clerk_user_id`) to
   target, and it must be done in **production**, which is the database that matters. Django
   `is_staff` / `is_superuser` are separate from `UserProfile.role` and both are needed - the
   role governs the API, the Django flags govern the admin site.
2. Ship `PersonAlias` in v1, or defer it?
3. Should a rejected proposal be visible to the person who filed it, with the note?

## Risks

- ⚠️ **An empty cast is the real bottleneck, not the code.** 0 personas exist. Until the owner
  seeds them, autocomplete has nothing to offer and every proposal is a custom name - which is
  the highest-friction path for both sides. Seeding the recurring cast first is what makes this
  feature work on day one.
- ⚠️ Auto-tagging from transcripts is out of scope here and stays a separate decision. Signal is
  strong (85% of the 435 transcribed episodes on the two main channels carry an intro roll-call
  in the first 150s), but only 579 of 1,862 episodes have transcripts at all, and coverage runs
  99% on BFF down to 0% on Sport.
