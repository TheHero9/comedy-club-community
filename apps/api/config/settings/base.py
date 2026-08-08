"""Settings shared by every environment.

Environment-specific overrides live in dev.py / prod.py. Nothing here may hardcode
a host, port or credential - every data store is addressed by a single URL so the
app moves from local Docker to a managed provider by changing one variable.
"""

from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

from .env import env_bool, env_list, env_str

# apps/api/
BASE_DIR = Path(__file__).resolve().parent.parent.parent

load_dotenv(BASE_DIR / ".env")

# ---------------------------------------------------------------------------
# Core
# ---------------------------------------------------------------------------

SECRET_KEY = env_str("DJANGO_SECRET_KEY", "dev-insecure-change-me")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["localhost", "127.0.0.1"])

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    # Required by the generic Report model (GenericForeignKey).
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "podcast",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ---------------------------------------------------------------------------
# Data stores - one URL each, never decomposed into host/port/user/password
# ---------------------------------------------------------------------------

DATABASES = {
    "default": dj_database_url.parse(
        env_str("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/podcast"),
        conn_max_age=600,
        conn_health_checks=True,
    )
}

REDIS_URL = env_str("REDIS_URL", "redis://localhost:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

CELERY_BROKER_URL = env_str("CELERY_BROKER_URL", "redis://localhost:6379/1")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_TASK_TRACK_STARTED = True
CELERY_TIMEZONE = "Europe/Sofia"

# Set False to stop application writes from queueing re-index tasks. Tests turn
# this off so the suite never depends on a running Meilisearch.
SEARCH_INDEXING_ENABLED = env_bool("SEARCH_INDEXING_ENABLED", True)

MEILI_URL = env_str("MEILI_URL", "http://localhost:7700")
MEILI_MASTER_KEY = env_str("MEILI_MASTER_KEY", "")

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# 🚨 Pluggable auth: "dev" (header-based, LOCAL ONLY) or "clerk" (JWT + JWKS).
# prod.py refuses to boot with anything but "clerk". See docs/03-auth-decisions.md.
AUTH_BACKEND = env_str("AUTH_BACKEND", "dev")

# Clerk (wave 8). Django only VERIFIES tokens; it never issues them.
CLERK_SECRET_KEY = env_str("CLERK_SECRET_KEY", "")
CLERK_JWKS_URL = env_str("CLERK_JWKS_URL", "")
CLERK_ISSUER = env_str("CLERK_ISSUER", "")
CLERK_WEBHOOK_SECRET = env_str("CLERK_WEBHOOK_SECRET", "")

# ---------------------------------------------------------------------------
# i18n - content is Bulgarian, UI copy is English for now
# ---------------------------------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Europe/Sofia"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Static & media
# ---------------------------------------------------------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Verification screenshots (wave 10) are PRIVATE. Local dev writes to disk; R2 with
# signed URLs replaces this in wave 10. Never expose MEDIA_ROOT publicly in prod.
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", ["http://localhost:3000"])
CORS_ALLOW_CREDENTIALS = True

# ---------------------------------------------------------------------------
# YouTube ingestion
# ---------------------------------------------------------------------------

YOUTUBE_API_KEY = env_str("YOUTUBE_API_KEY", "")

# 🚨 Shorts are NEVER ingested (owner decision 2026-08-08). Past live streams ARE
# episodes for a podcast, so "streams" is not optional. See CLAUDE.md § Ingestion.
YOUTUBE_INGEST_TABS = ("videos", "streams")
YOUTUBE_INGEST_WORKERS = 8

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "{levelname} {name} {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "podcast": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}
