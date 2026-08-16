"""Production settings.

Nothing here may fall back to an insecure default. If a required secret is absent
the app should fail loudly at boot rather than run in a weakened state.
"""

import os

from config.version import DEPLOYED_SHA

from .base import *  # noqa: F403
from .env import env_bool, env_float, env_list, env_str

DEBUG = False

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]  # deliberately no default
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")
if not ALLOWED_HOSTS:
    raise RuntimeError("DJANGO_ALLOWED_HOSTS must be set in production")

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
CORS_ALLOWED_ORIGIN_REGEXES = []

# Behind Cloudflare / a platform proxy that terminates TLS.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", CORS_ALLOWED_ORIGINS)

CELERY_TASK_ALWAYS_EAGER = False

# 🔒 No interactive docs and no raw OpenAPI schema in production. Overridable so
# it can be turned back on briefly to debug, but the default is off.
API_DOCS_ENABLED = env_bool("API_DOCS_ENABLED", False)

# ---------------------------------------------------------------------------
# 🔒 Auth: the dev backend trusts a plain header. It must be UNREACHABLE here.
# ---------------------------------------------------------------------------

AUTH_BACKEND = env_str("AUTH_BACKEND", "clerk")
if AUTH_BACKEND != "clerk":
    raise RuntimeError(
        f"AUTH_BACKEND={AUTH_BACKEND!r} is not permitted in production. "
        "The dev backend trusts an unverified header and would let anyone "
        "impersonate any user. Only 'clerk' is allowed."
    )

for _name in ("CLERK_JWKS_URL", "CLERK_ISSUER"):
    if not env_str(_name):
        raise RuntimeError(f"{_name} must be set in production")

# ---------------------------------------------------------------------------
# 🚨 Error reporting
#
# This was read into a variable and never used - so production ran with NO error
# reporting at all, on both halves. That matters more here than on most projects
# because of how this codebase is deliberately built to degrade quietly:
# `clerk_api.fetch_user` FAILS SOFT by design (the JWT is already verified, so a
# Clerk outage must degrade the display name rather than block a sign-in), the
# write throttle fails OPEN on a cache outage, and every `schedule_*_reindex`
# swallows its exception so search freshness can never fail a user's write.
#
# Every one of those is the right call, and together they mean a broken
# dependency leaves nothing behind but a WARNING in a log nobody is watching.
# That is exactly how the Clerk 403 hid for a day on 2026-08-16. Sentry is what
# makes the quiet failures audible.
#
# ⚠️ Absent DSN = no-op, deliberately. Sentry is not a hard requirement to boot;
# a missing DSN must degrade to "no reporting", never to a crash loop.
# ---------------------------------------------------------------------------

SENTRY_DSN = env_str("SENTRY_DSN", "")

if SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        # 🔒 OFF. Ninja bodies carry comments, topic labels and moment text -
        # real people's words - and the membership endpoints carry a claim about
        # a paid subscription. An error report is not a place for any of that.
        send_default_pii=False,
        environment=env_str("SENTRY_ENVIRONMENT", "production"),
        # Ties an event to the commit actually serving it - the SAME value
        # `/api/health` reports, so a Sentry event and a health check can never
        # disagree about which build produced it. That is the question every
        # deployment incident on this project has come down to.
        release=DEPLOYED_SHA or None,
        # Sampled, not off: tracing every request on a low-traffic site is
        # affordable but pointless, and the free tier is a real ceiling.
        traces_sample_rate=env_float("SENTRY_TRACES_SAMPLE_RATE", 0.1),
    )
