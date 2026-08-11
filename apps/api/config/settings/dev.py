"""Local development settings."""

from .base import *  # noqa: F403
from .env import env_bool

DEBUG = env_bool("DJANGO_DEBUG", True)

ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "testserver"]

# Any localhost port, so a Next.js dev server on 3001 does not need a config change.
CORS_ALLOWED_ORIGIN_REGEXES = [r"^http://localhost:\d+$", r"^http://127\.0\.0\.1:\d+$"]

# Run Celery tasks inline unless a worker is explicitly wanted. Waves 1-4 have no
# worker running, and an unreachable broker should not break a request.
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_TASK_ALWAYS_EAGER", True)
CELERY_TASK_EAGER_PROPAGATES = True

# ---------------------------------------------------------------------------
# 🚨 Persistent connections are DISABLED under runserver. Do not "restore" this
# to match production.
# ---------------------------------------------------------------------------
# `base.py` sets `conn_max_age=600`, which is right for production: gunicorn has
# a FIXED number of workers, so open connections are bounded at workers x threads.
#
# `manage.py runserver` has no such bound. It spawns a NEW THREAD PER REQUEST,
# and Django keeps one connection per thread, so with a 600s max age every
# concurrent request pins a connection for ten minutes. Postgres ships with
# `max_connections = 100`, and the Celery worker and beat hold some of those
# already.
#
# Measured 2026-08-11: 8 concurrent requests to /api/channels/{slug}/grid were
# enough to start returning
#     django.db.utils.OperationalError: FATAL: sorry, too many clients already
# and the failures ACCUMULATED across runs (1 -> 4 -> 10 failing E2E tests)
# because the leaked connections outlived each run.
#
# 🔍 This is what the "unexplained flaky E2E" in STATUS.md (2026-08-10) actually
# was. It never looked like a 500 because Next.js serves the STALE entry from
# its fetch cache when a revalidation request fails - so the page rendered
# plausible-but-outdated scores and the failure read as a data mismatch rather
# than as an API outage. A test comparing the page against a fresh API call is
# exactly the thing that notices, and nothing else was.
#
# 0 means "close the connection at the end of each request", which is what an
# unbounded-thread server needs.
#
# ⚠️ Rebuilt rather than mutated in place. `from .base import *` binds the SAME
# dict object, so `DATABASES["default"]["CONN_MAX_AGE"] = 0` would edit base's
# configuration too - harmless while only one settings module is live, but it
# makes base a liar to anything that imports both.
DATABASES = {  # noqa: F405
    **DATABASES,  # noqa: F405
    "default": {**DATABASES["default"], "CONN_MAX_AGE": 0},  # noqa: F405
}
