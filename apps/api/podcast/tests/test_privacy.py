"""Privacy invariants (matrix section 18).

🔒 Two things in this schema are private and must stay private:

  1. `PersonalTag` - a user's own keywords for an episode. Never on any public
     endpoint, never in the search index.
  2. `ChannelMembership.verification_screenshot` - a real person's proof of a paid
     membership. Admin-only, served through short-lived signed URLs from private
     storage, never a public URL and never in a search document.

The public endpoints are ENUMERATED from the OpenAPI schema rather than
hand-picked, so a new public endpoint is covered the moment it is added.
"""

from __future__ import annotations

import json
from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from podcast.models import (
    ChannelMembership,
    Comment,
    EpisodeParticipant,
    EpisodeTopic,
    Moment,
    Person,
    PersonalTag,
    Rating,
    Topic,
)
from podcast.search.documents import build_document, episode_index_queryset

from .conftest import make_user

pytestmark = pytest.mark.django_db

BASE = "/api"

# Distinctive strings: if one of these ever appears in a public payload, the
# assertion failure points straight at the leak.
PRIVATE_TAG = "лична-бележка-QX7T"
SCREENSHOT_NAME = "membership-proof-7f3a9c.png"


@pytest.fixture(autouse=True)
def no_rate_limit(settings):
    """This module walks whole endpoint tables; limiting is tested elsewhere."""
    settings.API_WRITE_RATE_LIMIT = ""


@pytest.fixture(autouse=True)
def local_search_only():
    """⚠️ Meilisearch is a shared external service. If one happens to be running,
    /search would answer from ITS index instead of this test database, and a
    privacy assertion would be measuring someone else's data. Row 18.3 pins what
    ever reaches that index; here we read only from Postgres."""
    from unittest.mock import patch

    with patch("podcast.api.search._meilisearch_available", return_value=False):
        yield


@pytest.fixture
def private_media(settings, tmp_path):
    """Never write uploads into the repo's media/ directory from a test."""
    settings.MEDIA_ROOT = str(tmp_path)
    return tmp_path


@pytest.fixture
def populated(channel, episode, alice, bob):
    """Enough real content that every public endpoint returns a non-empty body."""
    topic = Topic.objects.create(name="шахмат")
    EpisodeTopic.objects.create(episode=episode, topic=topic, added_by=alice, score=3)

    person = Person.objects.create(name="Иван Кирков")
    EpisodeParticipant.objects.create(episode=episode, person=person, role="regular")

    Comment.objects.create(user=alice, episode=episode, body="страхотен епизод")
    Moment.objects.create(user=alice, episode=episode, timestamp_sec=120, label="началото")

    for index, user in enumerate((alice, bob, make_user("carol"))):
        Rating.objects.create(user=user, episode=episode, score=8 + index % 2)

    from podcast.services import scoring

    scoring.recompute_episode(episode)

    PersonalTag.objects.create(user=alice, episode=episode, text=PRIVATE_TAG)

    return {"channel": channel, "episode": episode, "topic": topic, "person": person}


# ---------------------------------------------------------------------------
# Enumerating the public surface
# ---------------------------------------------------------------------------


def _public_get_paths() -> list[str]:
    """Every GET operation the schema does NOT mark as requiring auth."""
    from config.api import api

    schema = api.get_openapi_schema()
    return [
        path
        for path, operations in schema["paths"].items()
        for method, operation in operations.items()
        if method == "get" and "security" not in operation
    ]


def _fill(path: str, data: dict) -> str:
    """Substitute path params with real objects, disambiguated by the route."""
    episode, channel = data["episode"], data["channel"]
    filled = path.replace("{youtube_id}", episode.youtube_id)
    if "{slug}" in filled:
        if filled.startswith("/api/channels"):
            filled = filled.replace("{slug}", channel.slug)
        elif filled.startswith("/api/topics"):
            filled = filled.replace("{slug}", data["topic"].slug)
        elif filled.startswith("/api/people"):
            filled = filled.replace("{slug}", data["person"].slug)
    filled = filled.replace("{kind}", "top_rated")
    if filled.endswith("/search") or filled.endswith("/search/suggest"):
        filled += "?q=Каспаров"
    if filled.endswith("/topics/suggest"):
        filled += "?q=ша"
    return filled


def test_the_public_surface_is_enumerated_and_not_empty():
    """Guard: an empty enumeration would make every 18.1 assertion vacuous."""
    paths = _public_get_paths()
    assert len(paths) >= 12, paths
    assert "/api/episodes/{youtube_id}" in paths


def test_every_public_endpoint_actually_returns_data(client, populated):
    """If these 404'd, the leak tests below would pass on empty bodies."""
    for path in _public_get_paths():
        response = client.get(_fill(path, populated))
        assert response.status_code == 200, path
        assert response.content, path


# ---------------------------------------------------------------------------
# 18.1 - PersonalTag never appears publicly
# ---------------------------------------------------------------------------


def test_18_1_no_public_endpoint_leaks_a_personal_tag(client, populated):
    leaks = []
    for path in _public_get_paths():
        url = _fill(path, populated)
        body = client.get(url).content.decode("utf-8")
        if PRIVATE_TAG in body:
            leaks.append(url)
    assert not leaks, f"🔒 personal tags leaked on: {leaks}"


def test_18_1_no_public_endpoint_leaks_a_personal_tag_when_searched_for(
    client, populated
):
    """The tag text as a query must not turn the tag itself into a public hit."""
    response = client.get(f"{BASE}/search", {"q": PRIVATE_TAG})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 0
    assert payload["hits"] == []

    # `query` is the caller's own input echoed back, so it is not a leak. Strip
    # it and require the tag to be absent from everything else.
    #
    # 🚨 This assertion was previously made against the raw body, where it could
    # never have caught a real leak: the API escaped Cyrillic as \uXXXX, so a
    # substring search for Bulgarian text always missed. The API now emits real
    # UTF-8 and this check works for the first time.
    payload.pop("query")
    assert PRIVATE_TAG not in json.dumps(payload, ensure_ascii=False)


def test_18_1_personal_tags_are_scoped_to_their_owner(
    client, episode, populated, alice, bob, as_alice, as_bob
):
    assert client.get(f"{BASE}/me/tags", **as_bob).json() == []
    owner_tags = [tag["text"] for tag in client.get(f"{BASE}/me/tags", **as_alice).json()]
    assert PRIVATE_TAG in owner_tags

    other_state = client.get(f"{BASE}/episodes/{episode.youtube_id}/me", **as_bob).json()
    assert other_state["personal_tags"] == []


def test_18_1_the_schema_exposes_personal_tags_only_behind_auth():
    """Structural: no public operation may even reference the PersonalTag shape."""
    from config.api import api

    schema = api.get_openapi_schema()
    components = schema.get("components", {}).get("schemas", {})

    def referenced(node, seen: set[str]) -> set[str]:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if ref:
                name = ref.rsplit("/", 1)[-1]
                if name not in seen:
                    seen.add(name)
                    referenced(components.get(name, {}), seen)
            for value in node.values():
                referenced(value, seen)
        elif isinstance(node, list):
            for item in node:
                referenced(item, seen)
        return seen

    offenders = []
    for path, operations in schema["paths"].items():
        for method, operation in operations.items():
            if "security" in operation:
                continue
            names = referenced(operation.get("responses", {}), set())
            if any("PersonalTag" in name for name in names):
                offenders.append(f"{method.upper()} {path}")

    assert not offenders, f"🔒 personal tags reachable without auth: {offenders}"


def test_18_1_public_payloads_carry_no_per_user_state_at_all(client, populated, episode):
    """No ratings-by-user, no watch history, no favourites on a public shape."""
    body = client.get(f"{BASE}/episodes/{episode.youtube_id}").json()
    for forbidden in ("personal_tags", "my_rating", "is_favorite", "watch_count", "email"):
        assert forbidden not in body, forbidden


def test_18_1_public_comment_payloads_never_carry_an_email(client, populated, episode):
    body = client.get(f"{BASE}/episodes/{episode.youtube_id}/comments").content.decode()
    assert "@dev.local" not in body
    assert "email" not in body


# ---------------------------------------------------------------------------
# 18.2 - the verification screenshot is unreachable
# ---------------------------------------------------------------------------


def _png() -> SimpleUploadedFile:
    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (8, 8), "red").save(buffer, format="PNG")
    return SimpleUploadedFile(SCREENSHOT_NAME, buffer.getvalue(), content_type="image/png")


@pytest.fixture
def uploaded_membership(client, channel, alice, as_alice, private_media):
    membership = ChannelMembership.objects.create(user=alice, channel=channel)
    response = client.post(
        f"{BASE}/me/memberships/{membership.id}/screenshot",
        {"file": _png()},
        **as_alice,
    )
    assert response.status_code == 200, response.content
    membership.refresh_from_db()
    assert membership.verification_screenshot, "the fixture must actually store a file"
    return membership


def test_18_2_the_owners_own_membership_payload_hides_the_file(
    client, uploaded_membership, as_alice
):
    body = client.get(f"{BASE}/me/memberships", **as_alice).content.decode()

    assert SCREENSHOT_NAME.split(".")[0] not in body
    assert "verifications/" not in body
    assert client.get(f"{BASE}/me/memberships", **as_alice).json()[0]["has_screenshot"] is True


def test_18_2_no_endpoint_anywhere_returns_the_screenshot_path(
    client, uploaded_membership, populated, as_alice, as_bob
):
    stored = uploaded_membership.verification_screenshot.name
    leaks = []

    for path in _public_get_paths():
        url = _fill(path, populated)
        if stored in client.get(url).content.decode("utf-8"):
            leaks.append(url)

    for url, headers in (
        (f"{BASE}/me", as_alice),
        (f"{BASE}/me/memberships", as_alice),
        (f"{BASE}/me", as_bob),
        (f"{BASE}/me/memberships", as_bob),
    ):
        if stored in client.get(url, **headers).content.decode("utf-8"):
            leaks.append(url)

    assert not leaks, f"🔒 screenshot path leaked on: {leaks}"


def test_18_2_the_schema_declares_no_screenshot_url_field():
    """MembershipOut may only say whether one exists, never where it is."""
    from config.api import api

    membership_out = api.get_openapi_schema()["components"]["schemas"]["MembershipOut"]
    properties = set(membership_out["properties"])

    assert "has_screenshot" in properties
    assert not {p for p in properties if "screenshot" in p and p != "has_screenshot"}
    assert "verification_screenshot" not in properties


def test_18_2_another_user_cannot_upload_onto_someone_elses_membership(
    client, uploaded_membership, as_bob, bob, private_media
):
    response = client.post(
        f"{BASE}/me/memberships/{uploaded_membership.id}/screenshot",
        {"file": _png()},
        **as_bob,
    )
    assert response.status_code == 404, "🔒 scoped to the actor, not just the id"


def test_18_2_another_user_cannot_see_that_a_membership_exists(
    client, uploaded_membership, as_bob
):
    assert client.get(f"{BASE}/me/memberships", **as_bob).json() == []


def test_18_2_no_read_endpoint_serves_the_screenshot(client, uploaded_membership):
    """The only screenshot route in the whole API is an authenticated upload."""
    from config.api import api

    schema = api.get_openapi_schema()
    screenshot_routes = {
        (method.upper(), path)
        for path, operations in schema["paths"].items()
        for method, operation in operations.items()
        if "screenshot" in path
    }
    assert screenshot_routes == {
        ("POST", "/api/me/memberships/{membership_id}/screenshot")
    }
    for _method, path in screenshot_routes:
        assert "security" in schema["paths"][path]["post"]


def test_18_2_django_does_not_serve_media_outside_debug(settings):
    """🔒 In production the file lives in private storage behind signed URLs.
    config/urls.py only mounts MEDIA_URL under DEBUG - this pins that guard."""
    from django.conf.urls.static import static

    settings.DEBUG = False
    assert static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT) == []


def test_18_2_reuploading_a_screenshot_resets_verification(
    client, channel, alice, as_alice, private_media, verify_membership
):
    """New evidence has not been reviewed, so elite standing must drop until it is."""
    membership = verify_membership(alice, channel)
    assert membership.is_verified is True

    response = client.post(
        f"{BASE}/me/memberships/{membership.id}/screenshot",
        {"file": _png()},
        **as_alice,
    )
    assert response.status_code == 200

    membership.refresh_from_db()
    assert membership.is_verified is False
    assert membership.verified_at is None


def test_18_2_a_non_image_upload_is_refused(client, channel, alice, as_alice, private_media):
    membership = ChannelMembership.objects.create(user=alice, channel=channel)
    response = client.post(
        f"{BASE}/me/memberships/{membership.id}/screenshot",
        {"file": SimpleUploadedFile("payload.exe", b"MZ", content_type="application/x-msdownload")},
        **as_alice,
    )
    assert response.status_code == 415
    membership.refresh_from_db()
    assert not membership.verification_screenshot


# ---------------------------------------------------------------------------
# 18.3 - nothing private reaches a search document
# ---------------------------------------------------------------------------


ALLOWED_DOCUMENT_KEYS = {
    "id",
    "youtube_id",
    "slug",
    "url",
    "thumbnail_url",
    "title",
    "description",
    "channel_name",
    "topics",
    "moments",
    "participants",
    "channel_id",
    "channel_slug",
    "channel_handle",
    "topic_slugs",
    "participant_slugs",
    "content_kind",
    "availability",
    "members_only",
    "language",
    "upload_date",
    "upload_date_iso",
    "upload_year",
    "duration_sec",
    "public_score",
    "elite_score",
    "rating_count",
    "elite_rating_count",
    "view_count",
    "topic_count",
    "moment_count",
}


def test_18_3_a_search_document_has_no_private_keys(populated, uploaded_membership):
    """🔒 An indexed document is world-readable in practice. Pin its shape."""
    episode = episode_index_queryset().get(pk=populated["episode"].pk)
    document = build_document(episode)

    assert set(document) == ALLOWED_DOCUMENT_KEYS
    for key in document:
        assert "screenshot" not in key
        assert "personal" not in key
        assert "email" not in key


def test_18_3_a_search_document_contains_no_private_values(
    populated, uploaded_membership
):
    import json

    episode = episode_index_queryset().get(pk=populated["episode"].pk)
    payload = json.dumps(build_document(episode), ensure_ascii=False, default=str)

    assert PRIVATE_TAG not in payload
    assert SCREENSHOT_NAME.split(".")[0] not in payload
    assert "verifications/" not in payload
    assert "@dev.local" not in payload


def test_18_3_the_indexed_text_is_community_labels_not_private_ones(populated):
    episode = episode_index_queryset().get(pk=populated["episode"].pk)
    document = build_document(episode)

    assert document["topics"] == ["шахмат"], "public topic labels are indexed"
    assert document["moments"] == ["началото"], "public moment labels are indexed"
    assert PRIVATE_TAG not in document["topics"]
    assert PRIVATE_TAG not in document["moments"]
