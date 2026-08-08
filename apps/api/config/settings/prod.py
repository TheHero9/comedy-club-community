"""Production settings.

Nothing here may fall back to an insecure default. If a required secret is absent
the app should fail loudly at boot rather than run in a weakened state.
"""

import os

from .base import *  # noqa: F403
from .env import env_list, env_str

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

SENTRY_DSN = env_str("SENTRY_DSN", "")

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
