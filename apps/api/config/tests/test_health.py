"""The health endpoint and API surface."""

import pytest

pytestmark = pytest.mark.django_db


def test_health_reports_ok_when_dependencies_are_up(client):
    response = client.get("/api/health")
    assert response.status_code == 200

    body = response.json()
    assert body["database"]["ok"] is True
    assert body["redis"]["ok"] is True
    assert body["status"] == "ok"


def test_health_needs_no_authentication(client):
    """A health check that requires auth is useless to a load balancer."""
    assert client.get("/api/health").status_code == 200


def test_health_degrades_rather_than_500s_when_redis_is_down(client, monkeypatch):
    from config import api

    monkeypatch.setattr(
        api, "_check_redis", lambda: api.DependencyStatus(ok=False, detail="down")
    )
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"


def test_openapi_schema_is_served(client):
    """packages/api-types is generated from this - it must always be reachable."""
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    assert "paths" in response.json()


def test_admin_is_reachable(client):
    """Django Admin is the entire moderation backend."""
    assert client.get("/admin/").status_code in (200, 302)
