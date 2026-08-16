# What the audit fixed - 2026-08-16

Companion to [`01-findings.md`](01-findings.md). Owner ruling during the pass:
**leave membership verification**, fix the rest.

| Finding | Severity | Status |
| ------- | -------- | ------ |
| Membership verification cannot work in production | 🚨 High | ⏸️ **Deferred by owner** |
| `/admin/` open with no brute-force protection | 🚨 High | ✅ Fixed (`django-axes`) |
| `/me/people` "load more" 422 | ⚠️ Medium | ✅ Fixed |
| No error monitoring | ⚠️ Medium | ✅ Fixed on the API; ⏸️ web deferred |
| No `robots.txt` / `sitemap.xml` | ⚠️ Medium | ✅ Fixed |
| No ban/suspend | ⚠️ Medium | ✅ Fixed (API + UI) |
| Clerk deletion doesn't propagate | ⚠️ Medium | ⏸️ Webhook still unbuilt |
| Write throttle is per-account only | ⚠️ Medium | ✅ Partly - abuse ceilings added |
| No `YOUTUBE_API_KEY` in production | ⚠️ Medium | ⏸️ Dashboard, needs owner |
| `display_name` impersonation | ⚠️ Medium | ✅ Fixed |
| `/api/docs` + `openapi.json` public | 💡 Low | ✅ Fixed |
| `avatar_url` unvalidated | 💡 Low | ✅ Fixed |
| `humanize()` inconsistency | 💡 Low | ✅ Fixed |
| Railway repo-source residue | 💡 Low | ℹ️ Verified not firing |

---

## The decisions worth keeping

### Suspension reuses Django's `is_active`, and is checked in the AUTH BACKEND

Not a new column. `is_active` already exists on every account, Django Admin
already renders and filters it, and the admin login already honours it - so a
suspended member is locked out of both halves for free, **with no migration**. A
parallel `UserProfile.is_suspended` would have been a second answer to the same
question, and the two would disagree the first time anyone touched one and not
the other.

🚨 **The check lives in `ClerkAuth`/`DevAuth`, not per-endpoint**, for the same
reason the throttle and the NUL-byte guard are global: a new endpoint must not
be able to ship reachable-by-a-banned-account through nothing but forgetfulness.
`test_suspension.py` asserts it across four unrelated endpoints for exactly that
reason.

⚠️ **Content survives.** Suspending an author is not the same decision as taking
down what they wrote, and conflating them would make every ban a silent mass
deletion. The comment stays public; the report queue is how individual rows come
down. Same principle as `Comment.is_hidden` and a rejected proposal that stays
as the audit trail.

The endpoint is admin-only (a moderator who could suspend accounts could suspend
the admins) and refuses self-suspension - worse than the role self-lockout it
mirrors, because suspending yourself revokes your own token on the next request
and there is no undo from inside the app.

### The admin lockout is keyed on USERNAME, not IP

🚨 This is the load-bearing choice, and it is why axes' own `W006` check is
silenced rather than obeyed.

The API sits behind Railway's edge, so `REMOTE_ADDR` is a proxy and the real
caller only appears in `X-Forwarded-For`. That leaves IP keying with two options
and no good one:

- read `REMOTE_ADDR` → every visitor shares one address, so the **first ten
  failed logins lock out the entire internet**, including the owner;
- read `X-Forwarded-For` → the client sets it, so an attacker rotates the header
  and the lockout does nothing.

Username keying needs no knowledge of the proxy chain and cannot fail in either
direction. W006's stated concern ("attackers bypass rate limits by rotating
User-Agents or Cookies") does not apply: those are only lockout parameters if
you list them, and the only one listed is the username - which an attacker
targeting a specific account cannot rotate by definition.

`test_admin_lockout.py` pins the inverse directly: locking one username must not
lock another. That test fails the day someone adds `ip_address`.

🚨 **Cloudflare is NOT in front of anything, contrary to CLAUDE.md's stack
table.** Verified 2026-08-16: `api.comedycommunity.club` answers `Server:
railway-hikari`, the web answers `Server: Vercel`, and neither returns a
`cf-ray`. So there is no WAF and no DDoS layer today, and "just put `/admin/`
behind Cloudflare Access" is a project rather than a checkbox. This lockout is
the floor that does not depend on that project happening.

🔧 **Locked out?** `manage.py axes_reset` clears every attempt; in production run
it as a `preDeployCommand`, one command per deployment. Limit is 10 failures, a
1-hour cooloff, and a successful login resets the counter.

### Sentry exists because this codebase degrades quietly on purpose

`SENTRY_DSN` was read into a variable and never used. That matters more here
than on most projects: `clerk_api.fetch_user` fails soft by design, the write
throttle fails open on a cache outage, and every `schedule_*_reindex` swallows
its exception. All three are the right call, and together they mean a broken
dependency leaves nothing but a `WARNING` in a log nobody is watching - which is
exactly how the Clerk 403 hid for a day.

PII off (bodies carry real people's comments and a claim about a paid
subscription), and `release` is the **same** `DEPLOYED_SHA` that `/api/health`
reports, so a Sentry event and a health check can never disagree about which
build produced it.

⏸️ **The web half is deliberately not done.** `@sentry/nextjs` ships a client
bundle, and this project enforces payload budgets that a route-level regression
fails. Adding it needs a benchmark run and a budget decision, which is the
owner's call rather than a fix.

### The sitemap pages, because `/api/episodes` caps at 100

The first request doubles as the count and the rest are fetched in parallel -
the same shape `/search` already uses, and a direct consequence of the cap that
produced the `/me/people` 422 in the first place. Verified: **1,873 URLs, all
1,862 episodes, zero `localhost` leaks.**

⚠️ Deliberately **not** wrapped in a try/catch. A build that silently shipped a
sitemap of six static routes would look exactly like a working one while
de-listing the entire catalogue - the "reports success, serves the old thing"
failure this project keeps hitting. If the API is down the build should say so.

`metadataBase` was also missing, so Next was resolving every canonical and Open
Graph URL against `localhost:3000` and only **warning** about it.

### Abuse ceilings, not product limits

40 topics per episode and 200 moments per member per episode. Both are far above
real use; the point is that each write mints rows and queues a Celery re-index
against a throttle keyed **per account**, so N sign-ups was N buckets and nothing
bounded the total. The topic cap only blocks a *new* link - re-adding a topic an
episode already carries stays the idempotent no-op it was.

⚠️ This does not close the finding. A per-account throttle still cannot stop a
botnet; Clerk's own bot protection remains the only gate on account creation.

### The reserved-name list is bilingual and matched WHOLE

`display_name` is published as `author_name` under every comment, so `Admin` and
`Модератор` were names anyone could take. NFKC-normalised first, because
`Ａdmin` renders identically to `Admin`. Matched against the whole name, never as
a substring - `Adminka` and `Модератора Петър` are ordinary nicknames and a
substring rule would reject both.

⚠️ It blocks impersonation of the **site**, not of another **member**. Display
names are deliberately not unique (two people called Иван is normal), so a
uniqueness rule would reject honest names far more often than dishonest ones.
`handle` is the unique field.

Applied only to the name a member **types**, never to the one Clerk supplies - a
Google account whose real name collides is at least backed by an identity
provider, and silently rejecting it would break sign-in for that person.

---

## A flake this pass closed on the way past

`test_label_provenance` failed once and then passed twice on its own.

🚨 **The suite runs against `config.settings.dev`, so its cache is
`redis://localhost:6379/0` - the same Redis the local dev server uses.** Any
live request served while pytest runs writes to the very keys the tests assert
on. `auto_labeller_id()` caches for ten minutes; the test's own fixture deletes
that key on setup, and a concurrent request from the dev server repopulated it
with the **dev** database's account id - a different row from the test
database's - inside the window before the assertion.

`conftest.py` now gives every test its own LocMem cache. Per-test rather than
per-session, so a leaked throttle counter cannot make one test's writes count
against the next.

⚠️ Worth knowing generally: **a test that an unrelated process on the same
machine can break is not a flake to re-run, it is shared state to remove.**

---

## Still open, and why

1. **Membership verification** - deferred by the owner. Four independent breaks;
   see `01-findings.md`.
2. **Clerk webhook** - deleting a user in Clerk still does nothing here.
   Suspension now covers the *urgent* half of this (a bad actor can be stopped
   from the app), so what remains is propagation, not capability.
3. **Web-side Sentry** - needs a payload-budget decision.
4. **`YOUTUBE_API_KEY` on Railway** and **`SENTRY_DSN` on both hosts** -
   dashboard values only the owner can set. Nothing ships broken without them:
   Sentry no-ops without a DSN, and the daily sync is unscheduled.
5. **No Cloudflare in front of either host** - newly discovered during this
   pass, and a correction to CLAUDE.md's stack table rather than a regression.
