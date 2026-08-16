# Pre-launch full-app audit - 2026-08-16

Unattended sweep of registration, authorization, the admin surfaces, every
episode action, and the production infrastructure. Every claim below was
**verified by running something**, against the local stack and against live
production - not read off the code and assumed.

## Gates, all green before and after this pass

| Gate | Result |
| ---- | ------ |
| `uv run pytest` | 1,679 passed |
| `npx turbo typecheck lint` | 3/3 successful |
| `npx playwright test` (desktop + mobile, production build) | 388 passed, 4 skipped |

So nothing here is something a test was going to catch. That is the point of the
exercise: **every finding below is invisible to the suite**, which is the same
lesson `02-test-hardening` recorded about the three bugs that passed
`typecheck`, `lint` AND `build`.

---

## What is genuinely solid

Stated first because it is the larger half of the answer, and because a report
that only lists problems misrepresents the security posture.

**Authentication holds under attack.** Probed live against
`api.comedycommunity.club`:

| Attempt | Result |
| ------- | ------ |
| No token → `/api/me`, `/api/reports`, `/api/moderation/users` | `401` |
| `Authorization: Bearer dev:admin` (the dev backend's format) | `401` |
| `alg: none` forged JWT with `sub: user_admin` | `401` |
| Unauthenticated `POST` of a comment | `401` |

`ClerkAuth` verifies signature, issuer **and** expiry, and `prod.py` refuses to
boot with `AUTH_BACKEND` set to anything but `clerk` - so the dev backend is not
merely unused in production, it is unreachable.

**Authorization is server-side everywhere.** Every write derives its actor from
`request.auth`; no endpoint reads a user id from a body or query string.
Ownership is enforced by `require_self_or_moderator`, membership and tag reads
are scoped to `request.auth` rather than to a guessable id, the
moderator/admin split is real (`/moderation/users` is admin-only precisely so a
moderator cannot promote themselves), and an admin cannot change their own role.
The avatar unlock is re-checked on `PUT /me/avatar`, not left to the disabled
button.

**Injection surface is clean.** No raw SQL anywhere; Meilisearch filter values
go through `escape_filter_value`, and the one interpolated filter
(`episode_id IN [...]`) is built from ints. No `dangerouslySetInnerHTML` in the
entire web app - the `<mark>` passages from Meilisearch are split and rendered
as text nodes. `RejectNullBytesMiddleware` and the API-wide `WriteThrottle` are
both attached once, globally, so a new endpoint cannot ship unprotected by
omission.

**No secrets in the repo.** `git ls-files` returns only `.env.example` files;
`.gitignore` covers `.env*`, `*.pem`, `*.key`, `credentials.json`. No live key
pattern appears in any tracked file.

**No private data in any schema.** No email, no personal tag, and no screenshot
URL is reachable from any endpoint - `membership_out` exposes `has_screenshot`
as a bool and nothing more.

**Security headers are set** on the API: HSTS with `preload`, `nosniff`,
`X-Frame-Options: DENY`, COOP, and `SECURE_SSL_REDIRECT`.

---

## 🚨 HIGH - membership verification cannot work in production

Not one bug. **Four independent breaks in the same flow**, each of which alone
would stop it, which is why no single test noticed.

1. **The upload has nowhere to live.** `ChannelMembership.verification_screenshot`
   is an `ImageField(upload_to="verifications/")` writing to
   `MEDIA_ROOT = BASE_DIR / "media"`. There is **no `STORAGES` setting, no
   `django-storages`, and no `boto3`** anywhere in the project -
   `apps/api/pyproject.toml` lists neither. R2 was planned in wave 10 and never
   wired. So the file lands on the Railway container's own disk.
2. **That disk is ephemeral.** No volume is mounted on the `api` service. Every
   deploy discards every screenshot uploaded since the last one.
3. **Nothing can serve it back.** `config/urls.py` only serves `MEDIA_URL` when
   `DEBUG` is true. `ChannelMembershipAdmin.screenshot_preview` renders
   `<img src="{obj.verification_screenshot.url}">`, which resolves to
   `/media/verifications/…`. Verified live:
   `GET https://api.comedycommunity.club/media/verifications/test.png` → **404**.
   The admin's verification queue shows a broken image.
4. **`is_verified` has exactly one writer, and it is Django Admin.** Grepped:
   only `admin.py`'s two bulk actions set it. There is no API endpoint for it,
   and the in-app moderation page (`/me/people`) covers proposals, reports,
   roles and personas - but not verification.

**And admins promoted through the app cannot reach Django Admin at all.**
`provision_user` calls `User.objects.create_user(username, email)` with no
password, so Django assigns an unusable one. `set_user_role` grants
`is_staff`/`is_superuser`, but a Clerk-provisioned account has no password to
log in with. Only an account made by `createsuperuser` can open `/admin/`.

Net effect at launch: a member uploads proof of a paid membership, the file is
lost on the next deploy, no admin can view it, and the elite score - the feature
the whole verification flow exists to feed - can never be turned on.

**Decisions needed:** wire R2 (`django-storages[s3]` + a private bucket +
signed URLs, as CLAUDE.md § Storage already specifies), or move verification
into the app behind `require_admin` and drop the Django Admin dependency, or
explicitly defer the whole flow and hide the upload control until it works.
Shipping the button as-is promises something the system cannot do.

---

## 🚨 HIGH - `/admin/` is publicly reachable with no brute-force protection

`GET https://api.comedycommunity.club/admin/` → **200**, Django's login form.

There is no `django-axes`, no IP allowlist, no rate limit. `WriteThrottle` is
attached to the `NinjaAPI` only - it never sees a Django Admin POST. So the one
account that *can* log in (the `createsuperuser` one, per the finding above) is
exposed to unlimited credential-stuffing attempts, and that account is a
`is_superuser` with the whole database behind it.

The blast radius is unusually large here because Django Admin is currently the
**only** surface for membership verification.

**Recommendation:** at minimum a strong unique password on that account plus
`django-axes` (or a Cloudflare rule on `/admin/*`). Better: put `/admin/` behind
Cloudflare Access, since it is an operator tool with a single user.

---

## ⚠️ MEDIUM

### No error monitoring anywhere

`SENTRY_DSN` is read in `prod.py` but is **not set on any Railway service**
(`api`, `celery-worker`, `celery-beat` - variable names checked directly). The
web has no `instrumentation.ts` and no Sentry package. CLAUDE.md § Shared lists
Sentry on both sides; neither half is wired.

This matters more than usual because of the failure modes this project already
documents: `clerk_api.fetch_user` **fails soft by design**, so a broken Clerk
key leaves nothing but a `WARNING` in a log nobody is watching - which is
exactly how the production 403 hid. Launching with real users and no error
reporting means the next one hides the same way.

### No `robots.txt` and no `sitemap.xml`

Verified live: both **404**. There is no `app/robots.ts` and no `app/sitemap.ts`.

For a site whose stated core value is "searchability" and whose architecture
note says Server Components are used "for SEO (this is a content site)",
launching ~1,961 episode pages with no sitemap means Google discovers them only
by crawling internal links - slowly, and with the deepest pages last.

### `/me/people` "load more" served a 422 on the third click - FIXED

The page asked for `limit: PEOPLE_PAGE * pages`, so the third click requested
`limit=150` against `/api/people`, which caps `limit` at `MAX_LIMIT` (100).
Verified directly:

```
GET /api/people?limit=100 → 200
GET /api/people?limit=150 → 422
```

Exactly the drift class `MAX_API_LIMIT` in `filter-model.ts` exists to prevent,
and the same shape as the "eleventh click serves a 500" bug in `09-edge-case-hardening`.

**Fixed** in `apps/web/app/me/people/page.tsx`: the query now fetches `pages`
parallel offset pages of `PEOPLE_PAGE` each and flattens them - the same pattern
`/search` already uses for asks larger than the API's per-request ceiling. The
accumulation stays inside one `queryFn`, so the "one query key holds one visible
list" property the original comment describes is preserved.

### A user can never be banned, and deleting them in Clerk does nothing here

There is no ban, suspend or delete-account path in the API, in the services, or
in the in-app moderation page. `CLERK_WEBHOOK_SECRET` is defined in `base.py`
and **no webhook endpoint exists** - grepped the whole API, there is no route.
So a user deleted or banned in Clerk keeps their Django account, their content,
and their ability to keep posting with an unexpired session.

Moderators can hide a comment. They cannot stop the person writing the next one.

### The write throttle cannot stop a botnet

`WriteThrottle` keys on `request.auth.pk`, so the limit is 60/min **per account**.
There is no global ceiling and no per-IP limit on authenticated writes. N Clerk
sign-ups is N independent buckets, and Clerk's own bot protection is the only
thing standing between the site and automated account creation.

Compounding it: `POST /episodes/{id}/topics` and `/moments` have **no per-episode
or per-user cap**, and each one queues a Celery re-index task. A spammer with a
handful of accounts can mint canonical `Topic` rows and flood the worker queue.

### No `YOUTUBE_API_KEY` on any Railway service

Checked all three services' variable names. `sync_channel` falls back to yt-dlp
scraping when the key is absent - capped at `YOUTUBE_SYNC_FALLBACK_LIMIT` (25),
but scraping nonetheless, and that is the exact mechanism that degraded 1,171
rows on 2026-08-13. `repair_metadata --api`, the block-immune repair path, also
cannot run in production at all.

The daily sync is deliberately unscheduled in `config/celery.py`, so nothing
fires automatically today. This is a trap armed for whoever re-enables it.

### `display_name` is unvalidated free text on every public comment

`PATCH /api/me` accepts any 100-character string, and `comment_out` publishes it
as `author_name`. Nothing stops a member calling themselves `Admin`,
`Модератор`, or another member's exact name. `humanize()` guards against an
email or a Clerk `sub` reaching that field, but not against deliberate
impersonation.

---

## 💡 LOW / hardening

- **`/api/docs` and `/api/openapi.json` are public** (200, 86 KB). Not a
  vulnerability - every endpoint behind them is authorized - but it hands an
  attacker the complete moderation surface as a map. Consider gating both in
  `prod.py`.
- **`avatar_url` accepts any 200-character string** on both `ProfileIn` and
  `PersonIn`. Django does not run `URLField` validators on `save()`. It renders
  through a plain `<img>` (never `next/image`), so it is not XSS - but an
  arbitrary third-party URL on a public page is an IP-logging beacon fired at
  every viewer. Validate the scheme and host.
- **`moment_out` and `proposal_out` render `profile.display_name` raw**, while
  `comment_out` routes the same value through `humanize()`. A legacy profile row
  carrying a raw Clerk `sub` would publish it from those two and not the third.
  Make it consistent.
- **Railway services still carry `source.repo` + `watchPatterns: ["apps/api/**"]`**
  while `deploy-api.yml` is armed - the double-deploy race CLAUDE.md says to
  delete the workflow for. **Checked, and it is not firing:** every push today
  produced exactly one snapshot deploy (`railway up`), and the only
  commit-triggered deployment in the recent history predates the workflow being
  armed. Residual config, not a live problem - but it is one dashboard toggle
  from running `migrate --noinput` against production on an unreviewed push.
- **`CLERK_WEBHOOK_SECRET` is configured and unused.** Either build the webhook
  (it is the fix for the ban/delete gap above) or drop the setting, so it stops
  reading as a feature that exists.

---

## Suggested order before launch

1. Decide the membership-verification story (HIGH #1). It is the only finding
   that makes a shipped feature dishonest rather than merely absent.
2. Lock down `/admin/` (HIGH #2).
3. Wire Sentry on both halves - so that whatever this audit missed is visible
   when real users find it.
4. Add `robots.ts` + `sitemap.ts`.
5. Ban/suspend, via the Clerk webhook.
6. The LOW items, at leisure.

Items 3-5 are features rather than defects, so they were left unbuilt: the audit
was the requested scope, and choosing how the site handles bans or what its
sitemap covers is a product decision.
