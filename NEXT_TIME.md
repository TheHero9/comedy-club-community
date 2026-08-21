# 📋 NEXT_TIME - Deferred Tasks

Things consciously postponed. Scan this at session start. Grouped by topic, not
chronologically.

---

## 📥 Ingestion

### ~~Repair the 1,036 degraded `@comedyclubpodcast` rows~~ ✅ DONE 2026-08-09

Completed the same day. The block lifted after ~1 hour; all 1,036 rows repaired, 0
degraded remaining, re-indexed (1,392 docs). **`availability_corrected` was 0** - the
members-only count held at 37, so no episode was wrongly flagged public.

Full write-up: `specs/04-channel-ingestion/01-comedyclubpodcast-run.md`.

### `shape_video` turns unknown availability into a confident `"public"`

**Added:** 2026-08-09
**Context:** `specs/04-channel-ingestion/01-comedyclubpodcast-run.md`

```python
availability = info.get("availability") or "public"   # 🚨 unknown becomes a fact
```

A throttled response omits `availability`, so a members-only episode caught by the
block is stored as confidently public. The `@comedyclubpodcast` repair happened to
come back with **0 corrections**, so nothing is wrong in the DB today - but that was
luck of timing, not a property of the code. A channel throttled at a different point
could silently hide real paywalled episodes.

- Proper fix: make `availability` nullable so "unknown" is representable, and let
  `repair_metadata` fill it. **That is a schema deviation - ask before doing it**
  (`CLAUDE.md` § Database & schema).
- Interim mitigation already in place: `duration_sec IS NULL` reliably identifies every
  row whose availability is untrustworthy, and `repair_metadata` re-fetches them.

### Lower `YOUTUBE_INGEST_WORKERS` before the remaining channels

**Added:** 2026-08-09

8 workers was fine at 74 episodes and tripped the block at ~1,300. Consider lowering it
(or adding a delay inside the backfill) for the 4-6 channels still to come. The repair
pass is far slower than the wall-clock the parallelism saves.

- Also worth revisiting: `shape_video`'s `availability or "public"` coercion turns
  "unknown" into a confident fact. Making it nullable is a schema deviation - ask first.

---

## 🔒 Security

### Signed URLs for verification screenshots

**Added:** 2026-08-08
**Context:** Found while writing `specs/02-test-hardening` (matrix row 18.2).

Verification screenshots are proof-of-membership images from real people and are
supposed to be admin-only behind short-lived signed URLs. Signed URLs are **not
implemented yet** because R2 lands in a later phase. Locally, `config/urls.py`
mounts `MEDIA_URL` only under `DEBUG`, so today Django serves
`/media/verifications/...` to anyone who guesses the filename.

That is correct for local dev and a **real hole if `DEBUG` is ever true on a
deployed host**.

- Depends on: R2 wiring (Phase 3)
- Test that pins the current behaviour: `apps/api/podcast/tests/test_privacy.py`
- When R2 lands, rewrite row 18.2 to assert a signed URL is required.

### `WriteThrottle` shared-instance state

**Added:** 2026-08-08

`ninja.throttling.SimpleRateThrottle` keeps per-request state on `self`, and one
instance is shared across all requests. This is django-ninja's own documented
pattern, but under a threaded WSGI worker two concurrent writes could interleave
and mis-count. Impact is incorrect throttling, not a bypass.

Revisit if the production deployment uses threads rather than processes.

---

## ♿ Accessibility

### Moderate axe findings left unfixed

**Added:** 2026-08-08
**Context:** `specs/02-test-hardening/05-results.md`, "Known issues logged, not fixed".

The a11y suite fails on `critical` and `serious` only. These `moderate` ones are
real but were left alone to avoid unbounded scope creep in a test campaign:

1. **Nested `<main>` landmarks.** `app/layout.tsx` wraps children in `<main>`,
   and `status/page.tsx`, `not-found.tsx` and `status/loading.tsx` each render
   their own. Trips `landmark-no-duplicate-main`, `landmark-unique` and
   `landmark-main-is-top-level`. Fix: make the inner ones `<div>` and keep the
   classes.
2. **Heading order skips h1 -> h3.** `EpisodeCard.tsx` uses `<h3>` directly
   under the page `<h1>` on `/episodes` and `/search`. Changing the level
   affects every surface the card appears on, so it needs a deliberate pass.
3. **`<Button render={<Link/>} nativeButton={false}>` announces as
   `role="button"`.** The comment in `not-found.tsx` claims it "keeps link
   semantics". It does not. Screen-reader users get button semantics on a real
   navigation, so no links-list entry.

---

## 🧪 Testing

### Matrix rows still uncovered

**Added:** 2026-08-08
**Reference:** `specs/02-test-hardening/05-results.md`

- **3.17 (empty ratings grid).** Needs a second seeded channel with undated
  episodes, or a Vitest component test of the `seasons.length === 0` branch.
- **11.1 / 11.2 (API unreachable / degraded on `/status`).** Blocked because
  `/status` is a Server Component, so its health fetch never crosses the browser
  and `page.route()` cannot intercept it. A `DOCUMENTED LIMIT` test guards the
  boundary and will fail if `/status` ever becomes a Client Component, at which
  point these become writable.
- **11.7 (`build` succeeds with the API down).** Needs a real `next build` in a
  scratch directory, which cannot run while the E2E dev server owns `.next/`.
  Currently asserted at source level via the `force-dynamic` export.

### CI wiring

**Added:** 2026-08-08

The suite is CI-ready (`npm run test` works from a cold start, Playwright's
`webServer` boots the dev server) but no CI pipeline exists yet. It needs
Postgres, Redis and Meilisearch services plus the Django server before E2E can
run.

---

## 🌐 Internationalisation

### BG/EN toggle

**Added:** 2026-08-08
**Context:** Owner decision on 2026-08-08 was "English only for now".

Every user-facing string already lives in `apps/web/lib/copy.ts`, and
`tests/copy.spec.ts` enforces that with an exact-match ratchet, so this stays a
one-day retrofit rather than a two-week one. Do **not** install `next-intl` or
any i18n library before this is actually scheduled.

---

## 🔑 Blocked on credentials

**Added:** 2026-08-08

- **Wave 5** - YouTube Data API v3 daily sync needs `YOUTUBE_API_KEY`. Celery
  worker, beat and the yt-dlp fallback are all live.
- **Wave 8** - Clerk needs real keys. The architecture is done and pluggable
  (`AUTH_BACKEND=dev|clerk`), with `prod.py` refusing to boot on anything but
  `clerk`. Backend rejection of forged and expired tokens is already tested
  against the Clerk path.
- **Channels** - only `@ivankirkov1` is ingested. The remaining 5-7 channel URLs
  are needed before the grid has anything to compare.

## Moment/community-content audit trail (added 2026-08-21)

**Deferred:** a server-side audit trail for community content, so "my moment
vanished" is answerable in one query instead of a multi-day sweep of the Railway
proxy log.

**Context:** `specs/23-losing-what-you-typed/01-a-write-that-never-left.md`. The
client-side protections shipped (drafts + the anonymous-write guard) *prevent*
loss; they cannot *explain* a row that is already missing. Answering the original
report took windowed queries across five days of logs and still ended
unexplained.

**Shape:** a soft-delete (`deleted_at`) or a small audit row on `Moment`,
`Comment` and `EpisodeTopic`, written by the delete endpoints and by admin
actions.

**Why it was not done now:** it is a schema change against production Postgres,
and CLAUDE.md requires that to be asked for explicitly. The owner chose the
client-side scope in this round.

**Cheap precursor, no migration:** the next moment created in production reveals
whether any row was ever created and deleted - id **883** means the sequence
never moved past 882, **884+** means rows are missing and the gap counts them.
