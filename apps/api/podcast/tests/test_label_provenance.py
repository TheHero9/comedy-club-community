"""A machine-suggested topic label must be distinguishable from a member's.

🚨 THE TRAP THIS PINS: `added_by` is nullable, and NULL already means "a member
whose account was deleted". So the obvious implementation - "no `added_by` means
nobody typed it, so it must be the machine" - would relabel every orphaned
human contribution as an automatic guess, permanently and invisibly.

The other half is `is_auto` being a REQUIRED field on `TopicBriefOut`: a
Pydantic default of `False` would make a forgotten assignment render every
machine label as community-authored, which is the failure the flag exists to
prevent.
"""

import pytest
from django.contrib.auth.models import User
from django.core.cache import cache

from podcast.management.commands.import_topic_labels import get_auto_labeller
from podcast.models import EpisodeTopic, Topic

BASE = "/api"


@pytest.fixture(autouse=True)
def _clear_labeller_cache():
    """`auto_labeller_id()` caches for ten minutes; tests create the account."""
    cache.delete("podcast:auto-labeller-id")
    yield
    cache.delete("podcast:auto-labeller-id")


def _link(episode, name, added_by):
    topic = Topic.objects.create(name=name)
    return EpisodeTopic.objects.create(episode=episode, topic=topic, added_by=added_by)


def _topics_by_name(client, episode):
    body = client.get(f"{BASE}/episodes/{episode.youtube_id}").json()
    return {topic["name"]: topic for topic in body["topics"]}


def test_an_auto_label_is_flagged_and_a_member_label_is_not(client, episode, alice):
    _link(episode, "Машинна тема", get_auto_labeller())
    _link(episode, "Човешка тема", alice)

    topics = _topics_by_name(client, episode)
    assert topics["Машинна тема"]["is_auto"] is True
    assert topics["Човешка тема"]["is_auto"] is False


def test_a_label_with_no_author_is_not_treated_as_automatic(client, episode):
    """🚨 NULL `added_by` is a DELETED MEMBER, never the machine."""
    get_auto_labeller()  # the account exists, so this is not a vacuous pass
    _link(episode, "Осиротяла тема", None)

    topics = _topics_by_name(client, episode)
    assert topics["Осиротяла тема"]["is_auto"] is False


def test_nothing_is_automatic_when_the_labeller_has_never_run(client, episode, alice):
    """A site that never imported labels has no machine account to match."""
    assert not User.objects.filter(username="auto-labeller").exists()
    _link(episode, "Само човешка", alice)
    _link(episode, "Без автор", None)

    topics = _topics_by_name(client, episode)
    assert [t["is_auto"] for t in topics.values()] == [False, False]


def test_the_schema_requires_is_auto_rather_than_defaulting_it():
    """A default of False would silently mislabel guesses as human labels."""
    from config.api import api

    schema = api.get_openapi_schema()["components"]["schemas"]["TopicBriefOut"]
    assert "is_auto" in schema["required"]
