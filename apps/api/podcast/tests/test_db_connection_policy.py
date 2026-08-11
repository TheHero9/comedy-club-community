"""🚨 Persistent DB connections must stay OFF under `runserver`.

Found 2026-08-11, and it is the explanation for the "unexplained flaky E2E"
recorded in STATUS.md on 2026-08-10.

`base.py` sets `conn_max_age=600`. That is correct for production, where
gunicorn has a fixed worker count so open connections are bounded at
`workers x threads`. It is wrong for `manage.py runserver`, which spawns a NEW
THREAD PER REQUEST with no bound: Django keeps one connection per thread, so
every concurrent request pins a connection for ten minutes.

Measured before the fix, against Postgres' default `max_connections = 100`:

    8 concurrent requests  -> 14 of 32 responses were
        django.db.utils.OperationalError: FATAL: sorry, too many clients already
    connections leaked     -> 65 still idle after the load stopped
    E2E failures ACCUMULATED across consecutive runs: 1 -> 4 -> 10

After `CONN_MAX_AGE = 0` in dev: 48 concurrent -> 192/192 OK, 1 connection held.

🔍 Why it was invisible for a whole session: Next.js serves the STALE entry from
its fetch cache when a revalidation request fails. So the API 500 never reached
the browser - the page rendered plausible-but-outdated scores, and the failure
surfaced as a ratings-grid data mismatch rather than as an outage.

This test pins the setting itself. The concurrency behaviour it protects cannot
be exercised from pytest (which runs in one process against a test database), so
what is guarded here is the configuration decision, and the reasoning above is
the record of why.
"""

from __future__ import annotations

import importlib


def _settings_module(name: str):
    return importlib.import_module(f"config.settings.{name}")


def test_dev_disables_persistent_connections():
    dev = _settings_module("dev")

    assert dev.DATABASES["default"]["CONN_MAX_AGE"] == 0, (
        "runserver spawns an unbounded number of threads and Django holds one "
        "connection per thread. A non-zero CONN_MAX_AGE exhausts Postgres' 100 "
        "connections under parallel E2E load."
    )


def test_base_keeps_persistent_connections_for_production():
    """The dev override must not be 'fixed' by changing base too.

    Production runs a fixed pool, where reconnecting per request is pure
    latency. The two settings differ on purpose.
    """
    base = _settings_module("base")

    assert base.DATABASES["default"]["CONN_MAX_AGE"] == 600


def test_connection_health_checks_are_on():
    """A pooled connection that died must be detected, not handed out."""
    base = _settings_module("base")

    assert base.DATABASES["default"]["CONN_HEALTH_CHECKS"] is True


# ⚠️ Deliberately NOT tested here: "a request returns its connection to the
# pool". `pytest.mark.django_db` wraps every test in an atomic block and rolls
# it back, so `connection.in_atomic_block` is True for the whole test and any
# such assertion measures pytest's transaction rather than the request's. The
# behaviour is real but it needs a live server and concurrent clients, which is
# what the E2E suite provides; an honest gap beats a green test proving nothing.
