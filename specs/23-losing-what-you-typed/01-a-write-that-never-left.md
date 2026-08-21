# A write that never left, and the text that paid for it

**Date:** 2026-08-21
**Trigger:** owner report - "I added a moment yesterday and now I see no moments at all on it"
**Status:** ✅ Built, deployed and verified serving. 254 Vitest + 422 E2E green,
budgets unchanged. **The original report is resolved** - see the postscript.

---

## What was reported, and what was actually true

The owner reported a moment logged on **"Щеше ли да Простиш Комеди Клуб Подкаст"**
(`uA41ekQ4IEE`) that was no longer there. The investigation is worth recording in
full, because the first answer was **wrong**, and it was wrong in this project's
signature way.

### The first sweep was vacuous, and reported zero with total confidence

To answer "does production have any moments at all", the first pass walked
`/api/episodes` and summed `moment_count` across all 1,862 rows. It returned
**0**, and that number was reported as fact.

🚨 **`/api/episodes` does not return `moment_count`.** The field is `None` on
every row of that endpoint - the annotation exists on the detail serializer, not
the list one. `it.get("moment_count", 0) or 0` therefore summed nothing, 1,862
times, and produced a confident zero.

The owner pushed back with a specific counter-example ("I have moments on
*Историята с колата на Емо*"), which was true: ids 880, 881 and 882, authored
08-16. **The measurement had to be redone by hitting `/moments` on every
episode**, which is the only endpoint that actually answers the question.

> This is the same failure as `invisible-failures.spec.ts` 8.3 asserting the bug,
> and as `web:search` sampling a query that matched one episode. **A sweep that
> reads a field nobody populates cannot fail.** When a sweep returns zero, prove
> the sweep can return non-zero before believing it.

### What the production log actually shows

Once the method was fixed, the record is unambiguous:

| Question | Answer |
| --- | --- |
| Moments in production | Exactly **3**, ids 880-882, all on `WfzkZLc6zbY`, created 2026-08-16 |
| Moments on `uA41ekQ4IEE` | None |
| Is the proxy log trustworthy for this? | **Yes** - `POST .../WfzkZLc6zbY/moments 200` appears at 08-16T19:04:41 and 19:05:03, matching `created_at` on moments 881 and 882 to the millisecond |
| Non-GET requests to any `/moments` path, 08-16 20:00 → 08-21 17:53 | **0**, across 6,478 logged requests of which 608 touched a `/moments` path |

So on production, in that window, no moment was created on that episode and none
was deleted anywhere. What the owner *did* do on that episode on 08-20 was add
four cast members (21:03 local) and approve them (22:14 local) - all four are
still there.

At the time of writing **the moment itself was unexplained**, and this section
deliberately said so rather than inventing a mechanism. The one measurement that
would settle it is the value of `podcast_moment_id_seq`: the next moment created
in production is id **883** if nothing was ever created after 08-16, or **884+**
if rows were created and deleted. That check is one write away and needs no
infrastructure access.

> ✅ **Answered the same day - see the postscript at the end of this file.** The
> next moment came back as **883**. Nothing was ever created and deleted; the
> write simply never reached the database.

### The loss that IS explained

The same evening, on a different episode - **"Иван на Епилация подкаст с Комеди
Клуба"** (`D2yanlVBl-s`) - the log shows:

```
2026-08-20T18:40:01Z  POST /api/episodes/D2yanlVBl-s/participants/batch  401
2026-08-20T19:10:09Z  POST /api/episodes/D2yanlVBl-s/participants/batch  401
```

with Django's own `WARNING django.request Unauthorized` on both. That episode has
zero confirmed and zero pending participants today. **A cast was typed twice,
half an hour apart, and thrown away twice.**

---

## Root cause

Two holes, both of which passed typecheck, lint and build for months.

### 1. A write went out anonymous

`viewerToken()` in `apps/web/lib/auth.ts` returns `null` on every failure it can
hit - Clerk not booted, a session that expired in a tab left open, an offline
refresh:

```ts
try {
  return (await window.Clerk?.session?.getToken()) ?? null;
} catch {
  // Offline or Clerk not yet booted: an anonymous request beats a crash.
  return null;
}
```

🚨 **That comment is correct for a READ and exactly backwards for a WRITE.**
`createApiClient` built the header with `bearerAuthHeader(null)` - which returns
`{}` - and sent the request anyway. The API answered 401, correctly, and the
member was told "you need to sign in" about a form they had been signed in to
open.

### 2. `ready` existed and nothing read it

`ViewerAuthProvider` has exposed `ready` (Clerk's `isLoaded`) since wave 8.
`grep` found it **only in its own definition**. Every composer armed its trigger
on `signedIn` alone, so the save button was live during the window in which
`getToken()` still answers null.

---

## The fix, in three layers

### Layer 1 - a write never leaves the browser without a token

`lib/api/client.ts` refuses before the fetch and throws a new
`ApiErrorKind`, `"unauthenticated"`:

```ts
if (clientOptions.getToken !== undefined && token === null && !isSafeMethod(method)) {
  throw new ApiError({ kind: "unauthenticated", status: 0, ... });
}
```

- ⚠️ **Scoped to clients built WITH a `getToken`.** The public `api` client has
  none, so anonymous reads are unaffected rather than broken. The discriminator
  is "was this client built to carry an identity", never "is there a token".
- ⚠️ **Safe methods still go.** A guard that also blocked GETs would turn every
  signed-out viewer-state read into a throw, and a throw inside a Server
  Component is a 500 page.
- 🚨 The message is **not** `copy.errors.unauthorized`. That one answers a 401
  the server sent. This one answers a write we refused, and the sentence the
  member needs is the second one: *your text is kept*.

### Layer 2 - what you typed outlives the failure

`lib/drafts.ts` + `lib/use-draft.ts`. The rule: **the thing the member typed is
never the thing that pays for a failure** - not a 401, not a 500, not a dropped
connection, not a reload, not a phone killing the tab.

- 🚨 **Restored during render, never in an effect.** `react-hooks/set-state-in-effect`
  is an error in this repo and `useEffect(() => setValue(readDraft()))` is
  exactly the banned shape. `useDraft` uses React's sanctioned adjust-during-render
  branch, which converges after one pass.
- 🚨 **Gated on `useHydrated()`.** `localStorage` is the definition of something
  the server cannot know; reading it during the first client render is a
  guaranteed hydration mismatch for the whole subtree.
- 🚨 **Keys are scoped to the thing being drafted** (`draft.moment.<youtubeId>`).
  A single `moment` key would carry one episode's half-typed label onto the next
  episode opened, which reads as the site putting words in the member's mouth.
- 🚨 **Both caps exist for the ORIGIN, not for drafts.** `localStorage` is a
  shared ~5 MB quota. An unbounded draft store does not fail by losing a draft -
  it fails by making `setItem` throw for the theme, the locale and
  `recent-searches` too.
- 🚨 **An oversized draft is DROPPED, not truncated.** Half a sentence restored
  as though it were whole is worse than an honest nothing: the member submits it
  without noticing.
- 🚨 **Every path is defensive.** `localStorage` throws outright in Safari
  private mode. A draft store that takes the episode page down would be this fix
  causing a worse bug than the one it repairs.
- 🚨 **Only a 2xx forgets a draft.** Clearing optimistically before the `await`
  would reproduce the exact loss this module was written for.
- 🚨 **Closing is not discarding.** Cancel used to call `reset()` on the cast
  form and throw the lines away. It now keeps them; discarding is a separate,
  named action on the restore notice.
- 🚨 **A restore is always said out loud** (`DraftNotice`). A form that silently
  repopulates itself is indistinguishable from a form that submitted something on
  the member's behalf - on a site whose complaint was "it vanished", text
  appearing unexplained is the mirror-image failure.

### Layer 3 - the button is not armed before the session is

Every composer now reads `ready` and disables its trigger until Clerk answers.

🚨 **`!ready` is not `!signedIn`.** Treating "Clerk has not answered yet" as
signed out would throw the sign-in sheet at a member who is already signed in.

---

## Coverage

| Composer | Draft key | Restores by |
| --- | --- | --- |
| `MomentComposer` | `draft.moment.<youtubeId>` | reopening itself |
| `CastProposer` | `draft.cast.<youtubeId>` | reopening itself |
| `ReportForm` | `draft.report.<targetType>.<targetId>` | mounting inside its sheet |

⚠️ **Comments and topic labels have no compose UI at all** - `CommentCard` only
renders, and every topic link in the catalogue was written by
`import_topic_labels`. There is nothing to protect there yet; when either grows a
form, it gets a draft key in the same change.

⚠️ The report form deliberately does **not** reopen anything. It lives inside a
sheet, so it only mounts once the member has asked for it; a report sheet that
opened itself on page load would be an ambush.

---

## Tests

| Where | What |
| --- | --- |
| `tests/drafts.spec.ts` (16) | Round trip incl. Cyrillic, scoping, expiry, both caps, eviction order, and four rows for storage that throws |
| `tests/api-client.spec.ts` 4.44-4.50 (7) | The guard, asserted against `mock.requests.length` so "never sent" is a claim about bytes on a socket |
| `e2e/drafts.spec.ts` 19.1-19.5 (5) | Text typed into a real browser, surviving a real reload |

🚨 **Two near-misses worth recording, both caught by the tests themselves:**

1. `tests/drafts.spec.ts` 15.10 first stamped its fixtures at `1_000 + index` -
   epoch 1970 - so every entry read as **expired**, and the eviction assertion
   would have passed without eviction ever happening. It was only visible because
   a *neighbouring* assertion (`ep1` should survive) failed.
2. `api-client.spec.ts` 4.50 was first written as
   `await promise.catch(error => { expect(...) })`. **A catch block that never
   runs is a test that passes because nothing was checked.** Rewritten with
   `rejects.toMatchObject`.

---

## Adjacent bug fixed in passing

`lib/api/client.ts` imported `copy` - which is hardcoded to `en` - so **every API
error message rendered in English regardless of locale**, even though
`getActiveDictionary()` exists for exactly this and `LocaleProvider` already
calls `setActiveDictionary`. Ten call sites now read the active dictionary. This
is the module-scope-`copy` trap from CLAUDE.md, in the one file that documented
the escape hatch and then did not use it.

---

## Still open

- **The original moment is unexplained.** The id-sequence check above is the way
  to close it, and costs one write.
- **No server-side audit trail.** A deleted or missing moment is still answerable
  only by sweeping the proxy log, which took five days of windows to do here. A
  soft-delete or audit row on `Moment` would make it one query - deferred because
  it is a schema change against production Postgres and was not approved in this
  round. Logged in `NEXT_TIME.md`.

---

## Postscript, same day: the question was answered, and a dead number removed

### The id sequence closed it

The owner added four moments to `uA41ekQ4IEE` right after the deploy. They came
back as ids **883, 884, 885, 886** - contiguous, starting at exactly 883.

🚨 **The sequence had never advanced past 882.** That rules out the frightening
branch: no `Moment` row was ever created after 08-16 and then deleted.
**Yesterday's moment never reached the database at all.** It was not lost from
storage; the write never landed - which is exactly what the proxy log said all
along (zero non-GET requests to any `/moments` path across 6,478 logged
requests) and exactly what the anonymous-write path made possible.

The four writes themselves were clean: `POST .../moments 200` in 135-315ms each,
each followed by the composer's re-fetch, no 401s and no retries. The labels were
searchable within seconds (`мушкато`, `Лайкики` and `сока на боклука` all return
the episode with `matched_moments` populated), so the Celery reindex fired too.

### `Moment.score` was a reader with no writer

The owner then asked what the `0` on the right of each moment was.

- `Moment.score` is a model field, `default=0`
- **No writer anywhere in the codebase.** The only reference was the serializer
  reading it
- **No `MomentVote` model** - unlike `EpisodeTopicVote`, which is real
- **No vote endpoint** on any moment route

So it printed a literal `0` on every moment in the catalogue, permanently, and
nothing could ever change it. Removed from the render.

- ✅ **`score` stays on the model and in `MomentOut`.** That is where real voting
  would land, and removing it from the schema would be an API contract change
  for no gain. `copy.episode.momentVotes` is deleted from both dictionaries so
  the number cannot drift back in by accident; it comes back with the feature.
- 🚨 **This is the mirror of "an endpoint with no reader is not a feature"**
  (spec 17). A reader with no writer is not one either, and it is worse in one
  way: an unused endpoint is invisible, whereas an unwritten field is on screen
  being read as meaningful. **Before rendering a field, name what writes it.**
- ⚠️ **No local test could have caught this, or can guard it now.** The local DB
  holds zero `Moment` rows since the demo clear on 08-13, so the moment row
  never renders locally and any spec asserting on it passes by iterating
  nothing. It was verified against production.
