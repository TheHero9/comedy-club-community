# 08 - Demo data, and what filling it up exposed

**Date:** 2026-08-10
**Goal:** fill the dev database with realistic community data so the redesign can be
judged with content in it, then verify the whole app against that data.
**Outcome:** the app verified green, and **two false claims in our own documentation
were caught by the seed data itself.**

---

## Why this is a spec and not a chore

The seeding was routine. What it surfaced was not:

> `@comedyclubpodcast` was recorded on 2026-08-09 as **"metadata complete after
> `repair_metadata`"**, with `availability_corrected: 0` cited as proof that no
> episode had been wrongly flagged public.
>
> On 2026-08-10, **1,076 of its 1,318 rows still had `duration_sec IS NULL`** - the
> documented marker of a degraded row - and re-running the repair reclassified
> **9 episodes from public to members-only**.

Nothing in the app was failing. Every test was green. The wrong claim survived
because it was recorded from the *intent* of a command rather than from a count
taken afterwards.

### How it actually surfaced

`seed_demo` produced **365 `Moment` rows where ~1,700 were expected**. Moments need
a timestamp, so the seeder skips any episode with no `duration_sec`. A quarter of
the expected output was the tell. Nobody was looking for a metadata problem.

That is the transferable lesson: **the seeder is a data-completeness probe**,
because it is the only thing in the repo that reads a broad swathe of columns and
produces a countable result from them.

### The rule this produced

- ❌ `repair_metadata` finishing is not evidence. Neither is `--probe 10` saying
  "block appears lifted" - that means *start the real run*, not *done*.
- ✅ A backfill closes on `Episode.objects.filter(duration_sec__isnull=True).count()`
  reaching 0. Written into `CLAUDE.md` § Ingestion.

---

## What was seeded

`manage.py seed_demo`, DEV ONLY (refuses to run with `DEBUG=False`), across both
channels and all 1,392 episodes:

| Rows | Count |
| ---- | ----- |
| Users (`demo_*`) | 14 |
| Channel memberships | 28 (19 verified) |
| Ratings | 8,081 |
| Comments | 1,715 |
| Topic links / votes | 2,935 / 8,803 |
| Moments | 365 (limited by the missing durations above) |
| Favorites | 1,180 |
| Watch events | 1,748 |
| People / appearances | 7 / 1,797 |

**All of it is reversible: `manage.py seed_demo --clear`.** Every row hangs off a
`demo_`-prefixed user, plus the named topics and people. The clear path recomputes
scores afterwards, so the episodes return to unrated.

⚠️ `--clear` does **not** remove the `demo` user from `NEXT_PUBLIC_DEV_USER` - that
is the dev identity, not seed data, and it is deliberately outside the prefix.

### Changes the seeding needed

| Change | Why |
| ------ | --- |
| `--channel`, `--coverage` | Scope a run; leave a fraction genuinely untouched so empty states stay visible |
| Memberships on **every** channel | Previously only `episodes[0].channel` got them, so the big channel had no elite score at all |
| A **different** verified set per channel | If the same users were verified everywhere, an elite score that ignored the channel join would still look correct |
| `bulk_create` throughout | ~20,000 `get_or_create` round trips replaced by batched inserts |
| Scoped `--clear` | It ran `EpisodeParticipant.objects.all().delete()`, which would take real participants with it |

### `scoring.recompute_many`

Seeding 1,392 episodes through `recompute_episode` would have queued **1,392
single-document Celery reindex tasks**. The new set-based path does two aggregate
queries and one `bulk_update`, and `reindex=False` lets a bulk load finish with one
`manage.py reindex` instead.

🚨 This means `scoring.py` now has **two writers** of the four denormalized columns.
`podcast/tests/test_scoring_bulk.py` (7 tests) compares them **against each other**
rather than against hardcoded numbers, so tuning one alone fails the suite. The
easiest way to break the bulk path is to drop `F("episode__channel")` from the
elite aggregate - every single-channel test still passes without it, so there is a
dedicated cross-channel test.

---

## Verification

| Check | Result |
| ----- | ------ |
| `uv run pytest` | **357 passed** (350 + 7 new) |
| `npx vitest run` | **137 passed** |
| `npx playwright test` (production build) | **258 passed, 5 skipped, 1 flaky** |
| `npx turbo typecheck lint` | clean |
| `npx next build` | clean |
| All 17 routes, status codes | correct, including **real 404s** on dead channel/episode/page URLs |
| Both viewports, both themes | rendered and screenshotted with data |

### Bulgarian search, re-verified against 9,000 new rows

Queried from Python, never through a shell (Git Bash mangles Cyrillic argv):

| Query | Total | Reading |
| ----- | ----- | ------- |
| `пица` | 14 | the byte-vs-character typo fix holds - this was **100, of which 95 false**, before it |
| `Каспаров` | 1 | exact |
| `Евровизия` | 4 | exact |
| `политика` | 231 | the seeded **community topic label** is searchable, which is the whole premise |
| `зжкхдф` | 0 | gibberish returns nothing, so the tokenizer is not collapsing to an empty query |

Transcript search returns `<mark>`-highlighted segments with exact `start_sec` deep
links, from the separate `transcript_segments` index.

### The one flaky test

`3.8 the public/elite toggle recomputes the whole grid` failed once in the full
parallel run and passed on retry. Investigated rather than dismissed:

- The API returns **identical** results back to back for both score kinds.
- The rendered page matches the API **exactly**, 0/74 mismatches, repeatedly, in
  both modes.
- Re-ran the whole grid spec `--repeat-each=3 --retries=0`: **66/66 passed.**
- No E2E spec writes a rating, so the suite is not mutating its own fixture.

**Not reproduced, and not explained.** The mechanism that makes it *possible* is
worth recording: `/channels/[slug]` is `revalidate = 60`, so the test can compare a
render served from up to a minute of ISR cache against an API response fetched now.
Any data change inside that window is a false failure. The run overlapped a live
`repair_metadata` job rewriting 1,076 rows, which is the most likely trigger.

⚠️ Left as an honest open item rather than papered over with a retry or a `waitFor`.
If it recurs on a quiet database, the ISR window is the first place to look.

---

## Deleting it again

```bash
cd apps/api
uv run python manage.py seed_demo --clear
uv run python manage.py reindex
```

Episodes, channels, transcripts and the real ingested metadata are untouched.
