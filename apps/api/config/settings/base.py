"""Settings shared by every environment.

Environment-specific overrides live in dev.py / prod.py. Nothing here may hardcode
a host, port or credential - every data store is addressed by a single URL so the
app moves from local Docker to a managed provider by changing one variable.
"""

from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

from .env import env_bool, env_int, env_list, env_str

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
    # 🔒 Brute-force lockout for the Django Admin login. See the AXES_* block
    # below for why it is keyed on username rather than IP.
    "axes",
    "podcast",
]

# ⚡ GZipMiddleware sits directly under SecurityMiddleware, which is the position
# Django's own middleware-ordering guide specifies: it must wrap every middleware
# that writes a response body, and nothing below it may re-read Content-Length.
#
# 🔒 BREACH assessment (measured 2026-08-09, and the honest version):
# BREACH needs FOUR things at once - a compressed response, a secret INSIDE that
# response body, attacker-controlled text reflected into the SAME response, and
# the ability to measure the compressed size over many attempts.
#   - The Ninja API returns no secret in any body. `podcast/api/schemas.py` has no
#     token / secret / password / key field at all, so the API surface fails the
#     "secret in the body" precondition outright. `/api/search` DOES reflect the
#     user's query back in `query`, but there is nothing next to it worth stealing.
#   - Sessions travel in cookies, never in the body.
#   - Django Admin is the one surface with both reflection (changelist `?q=`) and a
#     body secret (the CSRF token). Django masks the CSRF token with a fresh random
#     salt on EVERY response precisely as a BREACH mitigation, so it is not a stable
#     compressible target.
# Conclusion: enabling it is safe here. If a future endpoint ever returns a token
# in a JSON body, revisit this line rather than assuming it is still fine.
#
# Measured on 1392 episodes: /api/episodes?limit=24 22,494B -> 2,795B (-88%).
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # 🔒 Ahead of everything that touches the database. A NUL byte in a query
    # param or a JSON body is a 500 from psycopg otherwise - see the module
    # docstring for the six endpoints this covers.
    "podcast.middleware.RejectNullBytesMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # 🔒 LAST, and after AuthenticationMiddleware - axes needs `request.user`
    # to already be resolved when it inspects a login attempt.
    "axes.middleware.AxesMiddleware",
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

# ---------------------------------------------------------------------------
# 🔒 Django Admin brute-force lockout
#
# 🚨 `/admin/` is served on the public API host and answered 200 to the whole
# internet with no attempt limiting of any kind. The Ninja `WriteThrottle` does
# NOT cover it - that throttle is attached to the NinjaAPI and never sees a
# Django Admin POST - so the one account that can actually log in was exposed to
# unlimited credential stuffing. The blast radius is a superuser with the whole
# database behind it, and Django Admin is currently the only surface membership
# verification lives on.
#
# 🚨 KEYED ON USERNAME, NOT IP, AND THAT IS THE LOAD-BEARING CHOICE - it is
# also why axes' own `W006` check is silenced below rather than obeyed.
#
# The API sits behind Railway's edge, so `REMOTE_ADDR` is a proxy and the real
# caller is only in `X-Forwarded-For`. That leaves IP keying with two options
# and no good one: read `REMOTE_ADDR` and every visitor shares one address, so
# the FIRST ten failed logins lock out the entire internet including the owner;
# or read `X-Forwarded-For`, which the client sets, so an attacker rotates the
# header and the lockout does nothing. Username keying needs no knowledge of
# the proxy chain and cannot fail in either direction.
#
# W006's stated concern - "attackers bypass rate limits by rotating User-Agents
# or Cookies" - does not apply to this configuration. Those are only lockout
# parameters if you list them, and the only one listed is the username, which
# an attacker targeting a specific account cannot rotate by definition.
#
# ⚠️ The trade-off it accepts: an attacker hammering a known username can keep
# that account locked out. With one operator that is a nuisance, not an outage,
# and it is strictly better than the account being brute-forceable.
#
# 🚨 The real answer is to put `/admin/*` behind Cloudflare Access - but note
# that CLAUDE.md's stack table lists "Cloudflare in front" and, as of
# 2026-08-16, THAT IS NOT TRUE OF EITHER HOST: `api.comedycommunity.club`
# answers with `Server: railway-hikari` and the web with `Server: Vercel`, and
# neither returns a `cf-ray` header. So there is no WAF and no DDoS layer today,
# and "just put it behind Cloudflare Access" is a project, not a checkbox. This
# lockout is the floor that does not depend on that project happening.
#
# 🔧 LOCKED OUT? `manage.py axes_reset` clears every attempt. In production run
# it as a `preDeployCommand` (see CLAUDE.md § Production) - one command, one
# deployment. `axes_reset_username <name>` clears just one.
# ---------------------------------------------------------------------------

AUTHENTICATION_BACKENDS = [
    # 🚨 FIRST. Axes short-circuits a locked-out attempt here; behind
    # ModelBackend it would authenticate first and lock afterwards.
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",
]

# Generous on purpose: ten tries against a real password is hopeless, and the
# owner fat-fingering it ten times running is not a scenario worth optimising
# for at the cost of locking them out.
AXES_FAILURE_LIMIT = env_int("AXES_FAILURE_LIMIT", 10)

# Hours. Long enough to make automated guessing pointless, short enough that a
# genuine lockout resolves itself over a coffee.
AXES_COOLOFF_TIME = env_int("AXES_COOLOFF_HOURS", 1)

AXES_LOCKOUT_PARAMETERS = ["username"]

# 🚨 Silenced with a reason, not to make a warning go away. W006 says to add
# 'ip_address'; the block above is why doing that here would either lock out
# every visitor at once or be trivially bypassed with a header. Revisit this
# the day a trusted proxy layer exists and `X-Forwarded-For` can be believed.
SILENCED_SYSTEM_CHECKS = ["axes.W006"]

# A successful login clears the counter, so yesterday's typos never accumulate
# into today's lockout.
AXES_RESET_ON_SUCCESS = True

# ⚠️ Recorded for the ADMIN LOG only - never for the lockout decision, per the
# note above. Knowing which address a burst came from is useful; trusting it to
# decide who gets locked out is not.
AXES_IPWARE_META_PRECEDENCE_ORDER = [
    "HTTP_CF_CONNECTING_IP",
    "HTTP_X_FORWARDED_FOR",
    "REMOTE_ADDR",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# 🔒 Per-actor rate limit applied to every unsafe (POST/PUT/PATCH/DELETE) API call.
# Reads are never throttled - see podcast/api/throttling.py. Set to "" to disable,
# which is for local debugging only and never for a deployed environment.
API_WRITE_RATE_LIMIT = env_str("API_WRITE_RATE_LIMIT", "60/min")

# 🚨 Pluggable auth: "dev" (header-based, LOCAL ONLY) or "clerk" (JWT + JWKS).
# prod.py refuses to boot with anything but "clerk". See docs/03-auth-decisions.md.
AUTH_BACKEND = env_str("AUTH_BACKEND", "dev")

# 🔒 Serve `/api/docs` and `/api/openapi.json`? On locally, OFF in production -
# see the comment in config/api.py. `packages/api-types` is generated from a
# local dev server, so turning these off in production costs nothing.
API_DOCS_ENABLED = env_bool("API_DOCS_ENABLED", True)

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

# 🚨 How many recent entries per tab the DAILY SYNC fetches when it has no
# YOUTUBE_API_KEY and falls back to yt-dlp. The 2026-08-13 incident: the keyless
# fallback re-scraped all 1,318 @comedyclubpodcast videos, tripped YouTube's
# soft-block partway, and (running a pre-protection image) overwrote 1,171 good
# rows with degraded data. A daily sync's job is picking up NEW uploads; it must
# never re-fetch a whole back catalogue. Explicit `limit` args still win.
YOUTUBE_SYNC_FALLBACK_LIMIT = 25

# ---------------------------------------------------------------------------
# Transcripts
# ---------------------------------------------------------------------------

# 🇧🇬 Which caption languages we accept, best first. "bg" also matches the
# "bg-orig" original-ASR track, which is preferred over a plain "bg" that could
# be a machine translation. See podcast/ingestion/transcripts.py.
TRANSCRIPT_LANGUAGES = ("bg",)

# Seconds per searchable passage. 60s => ~154 segments and ~171 words per
# segment on the probed 2h38m episode. Lower means better timestamps and more
# documents; higher means fewer documents and vaguer deep links.
# ⚠️ Changing this invalidates existing windowing - re-run the backfill with
# --force, or old and new segments will coexist at different granularities.
TRANSCRIPT_SEGMENT_SECONDS = 60

# 🚨 Seconds between caption fetches. A caption fetch is a SECOND request per
# episode on top of the metadata one, and parallel requests are exactly what
# soft-blocked the 1,318-episode backfill on 2026-08-09. Serial and slow on
# purpose - this job has no deadline.
TRANSCRIPT_FETCH_DELAY = float(env_str("TRANSCRIPT_FETCH_DELAY", "1.0"))

# Days before an episode recorded as caption-less is checked again. YouTube does
# add captions to older videos over time (the 2023 sample came back mixed), so
# "no captions" is true on a date, not forever.
TRANSCRIPT_RECHECK_DAYS = 90

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
