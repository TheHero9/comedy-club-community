"""🔒 A NUL byte must never reach Postgres.

Found 2026-08-11 by an edge-case sweep against the live API. `U+0000` is legal
in a URL (`%00`) and legal in a JSON string (`\\u0000`), so it arrives as an
ordinary Python `str` and satisfies every Pydantic constraint the API declares.
It fails only at the bottom, inside psycopg:

    django.db.utils.DataError: PostgreSQL text fields cannot contain NUL bytes

which surfaced as an unhandled **500** on ten endpoints, from a single
unauthenticated request. `podcast.middleware.RejectNullBytesMiddleware` turns
that into a 400.

🚨 The point of the sweep tests below is that they are parametrised over the
whole surface rather than over one example. A NUL check written per endpoint is
one a new endpoint can be added without, and the failure mode of forgetting is a
public 500.
"""

from __future__ import annotations

import json

import pytest

from podcast.models import Comment, Moment, PersonalTag

NUL = "\x00"

# Every query parameter on a public GET that reaches a Postgres text comparison.
# Each of these was a confirmed 500 before the middleware existed.
READ_CASES = [
    ("/api/episodes", "channel"),
    ("/api/episodes", "person"),
    ("/api/episodes", "topic"),
    ("/api/episodes", "q"),
    ("/api/episodes", "kind"),
    ("/api/search/suggest", "q"),
    ("/api/search", "q"),
    ("/api/channels", "q"),
]


@pytest.mark.parametrize("path,param", READ_CASES)
def test_a_nul_in_a_query_param_is_a_400_not_a_500(client, db, path, param):
    response = client.get(path, {param: f"a{NUL}b"})

    assert response.status_code == 400, (
        f"{path}?{param} returned {response.status_code}. A NUL byte must be "
        f"rejected, never handed to the database."
    )
    assert "NUL" in response.json()["detail"]


@pytest.mark.parametrize("path,param", READ_CASES)
def test_the_same_param_still_works_with_ordinary_cyrillic(client, db, path, param):
    """🇧🇬 The guard must reject NUL, not non-ASCII.

    Without this, "reject anything unusual" would pass the test above while
    breaking every Bulgarian query on the site - which is the entire product.
    """
    response = client.get(path, {param: "Каспаров"})

    assert response.status_code == 200, (
        f"{path}?{param}=Каспаров returned {response.status_code}. The NUL guard "
        f"must not touch legitimate Cyrillic."
    )


def test_a_nul_in_a_json_body_is_a_400_not_a_500(client, episode, alice, as_alice):
    response = client.post(
        f"/api/episodes/{episode.youtube_id}/comments",
        data=json.dumps({"body": f"spam{NUL}bad"}),
        content_type="application/json",
        **as_alice,
    )

    assert response.status_code == 400
    assert "NUL" in response.json()["detail"]
    assert Comment.objects.count() == 0, "nothing may be written from a rejected body"


@pytest.mark.parametrize(
    "suffix,payload,model",
    [
        ("comments", {"body": f"a{NUL}b"}, Comment),
        ("tags", {"text": f"a{NUL}b"}, PersonalTag),
        ("moments", {"label": f"a{NUL}b", "timestamp_sec": 30}, Moment),
    ],
)
def test_write_endpoints_reject_a_nul_and_persist_nothing(
    client, episode, alice, as_alice, suffix, payload, model
):
    response = client.post(
        f"/api/episodes/{episode.youtube_id}/{suffix}",
        data=json.dumps(payload),
        content_type="application/json",
        **as_alice,
    )

    assert response.status_code == 400, f"POST .../{suffix} returned {response.status_code}"
    assert model.objects.count() == 0


def test_a_nul_nested_deep_in_a_body_is_still_caught(client, episode, alice, as_alice):
    """The scan walks the whole structure, not just top-level string values."""
    response = client.post(
        f"/api/episodes/{episode.youtube_id}/comments",
        data=json.dumps({"body": "fine", "extra": {"nested": [f"a{NUL}b"]}}),
        content_type="application/json",
        **as_alice,
    )

    assert response.status_code == 400


def test_an_ordinary_bulgarian_comment_still_posts(client, episode, alice, as_alice):
    """The guard must not become a wall in front of every write."""
    response = client.post(
        f"/api/episodes/{episode.youtube_id}/comments",
        data=json.dumps({"body": "Един от най-добрите епизоди."}),
        content_type="application/json",
        **as_alice,
    )

    assert response.status_code in (200, 201), response.content[:200]
    assert Comment.objects.count() == 1


def test_malformed_json_is_left_to_ninja_not_swallowed_as_a_400(
    client, episode, alice, as_alice
):
    """A body the middleware cannot parse is NOT its business to reject.

    If it returned 400 for unparseable JSON it would mask Django-Ninja's own
    validation errors, and a genuine schema mistake would report the wrong
    reason.
    """
    response = client.post(
        f"/api/episodes/{episode.youtube_id}/comments",
        data="{not json at all",
        content_type="application/json",
        **as_alice,
    )

    assert response.status_code != 400 or "NUL" not in response.json().get("detail", "")


def test_a_nul_in_a_path_segment_does_not_500(client, db):
    """Path segments reach `get_object_or_404`, which also queries Postgres."""
    response = client.get("/api/episodes/a%00b")

    assert response.status_code < 500, (
        f"a NUL in a path segment returned {response.status_code}"
    )


def test_the_guard_covers_every_public_read_endpoint(client, db):
    """🚨 Sweep, so a NEW endpoint cannot ship NUL-vulnerable by omission.

    Walks the registered API paths, calls each parameterless GET with a NUL in a
    query string, and asserts none of them 500s. This is the test that catches
    the endpoint nobody remembered to add to READ_CASES above.
    """
    from config.api import api

    checked = 0
    paths = []
    for prefix, router in api._routers:  # noqa: SLF001
        for path, path_view in router.path_operations.items():
            operations = [op for op in path_view.operations if "GET" in op.methods]
            if not operations:
                continue
            full = (prefix.rstrip("/") + "/" + path.lstrip("/")).rstrip("/") or "/"
            if "{" in full:
                continue  # needs a real object id; covered by the path-segment test
            paths.append(full)

    assert paths, "found no parameterless GET endpoints to sweep - the walk is broken"

    for full in paths:
        response = client.get(f"/api{full}", {"q": f"a{NUL}b"})
        assert response.status_code < 500, (
            f"GET /api{full}?q=a%00b returned {response.status_code}"
        )
        checked += 1

    assert checked == len(paths)
