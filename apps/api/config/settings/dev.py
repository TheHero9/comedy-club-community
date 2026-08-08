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
