# syntax=docker/dockerfile:1

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # 🇧🇬 Content is Bulgarian. Without this the container's stdout is ASCII and
    # logging an episode title raises UnicodeEncodeError.
    PYTHONIOENCODING=utf-8 \
    LANG=C.UTF-8 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# uv is the package manager (same as local dev, so lockfiles match).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Dependency layer first so application edits do not invalidate the install.
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-install-project --no-dev 2>/dev/null \
    || uv sync --no-install-project --no-dev

COPY . .
RUN uv sync --no-dev 2>/dev/null || true

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8000

# Default: the web process. docker-compose overrides this for worker and beat.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
