# 🔐 Auth Decisions

## The problem

Clerk keys were not available, but waves 9-13 (ratings, watch log, favorites,
membership, comments, topics, moments, reports) all need an authenticated actor.
Waiting would have blocked five waves on one API key.

## The decision (2026-08-08)

**Auth is a pluggable backend.** One environment variable picks it:

| `AUTH_BACKEND` | Behaviour | Where |
| -------------- | --------- | ----- |
| `dev` | Trusts `Authorization: Bearer dev:<username>`, provisioning that user on the fly | Local only |
| `clerk` | Verifies a Clerk JWT against JWKS: signature, issuer and expiry | Production |

Both resolve to the same thing: a Django `User` with a `UserProfile`. Every router,
permission check and test is written against that contract, so switching to Clerk is
**one environment variable and zero business-logic changes**.

### Why this is safe

🔒 **The dev backend is impossible to enable in production.** `config/settings/prod.py`
raises at import time:

```python
AUTH_BACKEND = env_str("AUTH_BACKEND", "clerk")
if AUTH_BACKEND != "clerk":
    raise RuntimeError(
        f"AUTH_BACKEND={AUTH_BACKEND!r} is not permitted in production. ..."
    )
```

There is no code path that lets a deployed instance trust a header. `prod.py` also
refuses to boot without `CLERK_JWKS_URL` and `CLERK_ISSUER`.

Three tests pin this (`test_api_auth.py`):
- `test_production_settings_refuse_the_dev_auth_backend`
- `test_production_settings_require_clerk_configuration`
- `test_production_settings_boot_when_properly_configured` (so the guards are not so eager that a correct config fails)

### What is left to do when the Clerk keys arrive

1. Set `CLERK_SECRET_KEY`, `CLERK_JWKS_URL`, `CLERK_ISSUER` in `apps/api/.env`
2. Set `AUTH_BACKEND=clerk`
3. Wire `@clerk/nextjs` on the frontend and attach the session token via the API client
4. Optional: the Clerk webhook endpoint for profile updates and deletions

Nothing in `podcast/api/`, `podcast/services/` or the tests needs to change.

---

## Identity mapping

- Keyed on **`UserProfile.clerk_user_id`** (the JWT `sub`), **never on email**. An
  email can change and is not a stable identity.
- Users are provisioned lazily on first authenticated request via
  `provision_user()`, which is idempotent - repeated calls return the same row.
- `ensure_profile()` covers the Django superuser created by `createsuperuser`,
  which never went through provisioning.
- Username collisions get a numeric suffix rather than failing the request.

## Authorization rules

🔒 **Authorization is always checked on the API.** Never rely on the frontend
hiding a button.

| Helper | Rule |
| ------ | ---- |
| `require_moderator(user)` | 403 unless role is moderator or admin |
| `require_admin(user)` | 403 unless role is admin |
| `require_self_or_moderator(user, owner_id)` | Own row, or any row if you moderate |

- 🔒 **The actor always comes from `request.auth`.** A user id in a request body or
  query string is ignored. Pinned by
  `test_the_actor_comes_from_the_token_not_the_request_body`.
- 🔒 **Role escalation via the API is impossible.** `PATCH /api/me` accepts only
  `display_name`, `bio` and `avatar_url`. Role changes happen in Django Admin.
- Moderators **hide** comments rather than deleting them, so the report trail
  survives. Authors deleting their own comment get a real delete.

## Rejected alternatives

| Option | Why not |
| ------ | ------- |
| Block waves 9-13 until keys arrive | Five waves idle on one API key. |
| Hand-roll JWT issuance | The exact thing the brief says Clerk exists to avoid. |
| Build with no auth, add it later | Auth touches every endpoint. Retrofitting it is how authorization bugs get shipped. |
| Allow `AUTH_BACKEND=dev` in prod behind a flag | A single misconfigured env var would let anyone impersonate anyone. Not worth any convenience. |
