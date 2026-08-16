"""Canonical topic resolution.

🚨 The whole value of Topic is that it is CANONICAL. "find every episode about X"
only works if free-text input converges on one row. Two users typing "Политика" and
"политика " must land on the SAME Topic, or the feature quietly rots into 50
spellings of one tag.

🇧🇬 Resolution is by unicode-preserving SLUG, not by raw name, so case and spacing
differences collapse while Cyrillic survives intact.
"""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from django.db.models import Count

from podcast.models import EpisodeTopic, EpisodeTopicVote, Topic
from podcast.slugs import bg_slugify

logger = logging.getLogger("podcast")

MAX_TOPIC_NAME_LENGTH = 80

#: 🚨 An ABUSE CEILING, not a product limit, and deliberately far above what a
#: real episode needs - the most-labelled episode in the catalogue has nowhere
#: near this many. Adding a topic is an authenticated write that mints a
#: CANONICAL `Topic` row on first use and queues a Celery re-index, and the
#: write throttle is keyed per account (60/min), so N sign-ups is N buckets and
#: nothing bounded how many labels one episode could accumulate.
#:
#: A label list past this length has also stopped being useful to a reader: the
#: whole point of canonical topics is that "every episode about X" means
#: something, which it does not when an episode is about forty things.
MAX_TOPICS_PER_EPISODE = 40


class TopicError(Exception):
    """A topic name that cannot be accepted."""


def resolve_topic(name: str) -> Topic:
    """Get or create the canonical Topic for a free-text label.

    Matching is on the slug, so "Политика", "политика" and " ПОЛИТИКА " all resolve
    to one row. The first spelling seen wins as the display name.
    """
    cleaned = " ".join((name or "").split())
    if not cleaned:
        raise TopicError("Topic name cannot be empty")
    if len(cleaned) > MAX_TOPIC_NAME_LENGTH:
        raise TopicError(f"Topic name is longer than {MAX_TOPIC_NAME_LENGTH} characters")

    slug = bg_slugify(cleaned, max_length=100)

    existing = Topic.objects.filter(slug=slug).first()
    if existing:
        return existing

    try:
        with transaction.atomic():
            return Topic.objects.create(name=cleaned, slug=slug)
    except IntegrityError:
        # Another request created it between the check and the insert. The unique
        # constraint is doing its job; just read the winner.
        existing = Topic.objects.filter(slug=slug).first()
        if existing:
            return existing
        raise


def suggest_topics(query: str, limit: int = 8) -> list[Topic]:
    """Existing topics matching a partial input, most-used first.

    Shown while a user types so they pick an existing label instead of minting a
    near-duplicate. This is the main defence against topic sprawl.
    """
    cleaned = " ".join((query or "").split())
    if not cleaned:
        return list(Topic.objects.annotate(n=Count("episodes")).order_by("-n")[:limit])

    return list(
        Topic.objects.filter(name__icontains=cleaned)
        .annotate(n=Count("episodes"))
        .order_by("-n", "name")[:limit]
    )


@transaction.atomic
def add_topic_to_episode(episode, name: str, user) -> tuple[EpisodeTopic, bool]:
    """Attach a canonical topic to an episode. Idempotent per (episode, topic)."""
    topic = resolve_topic(name)

    # ⚠️ Checked BEFORE get_or_create, but only blocks a NEW link: re-adding a
    # topic an episode already carries is idempotent and must stay a no-op
    # rather than becoming an error once the episode is full.
    if not EpisodeTopic.objects.filter(episode=episode, topic=topic).exists():
        if EpisodeTopic.objects.filter(episode=episode).count() >= MAX_TOPICS_PER_EPISODE:
            raise TopicError(
                f"This episode already has the maximum of "
                f"{MAX_TOPICS_PER_EPISODE} topics."
            )

    episode_topic, created = EpisodeTopic.objects.get_or_create(
        episode=episode, topic=topic, defaults={"added_by": user}
    )
    if created:
        # The proposer implicitly endorses their own label.
        EpisodeTopicVote.objects.create(episode_topic=episode_topic, user=user, value=1)
        recompute_topic_score(episode_topic)
    return episode_topic, created


def recompute_topic_score(episode_topic: EpisodeTopic) -> int:
    """Refresh the denormalized net-vote score used for sorting."""
    from django.db.models import Sum

    total = episode_topic.votes.aggregate(total=Sum("value"))["total"] or 0
    EpisodeTopic.objects.filter(pk=episode_topic.pk).update(score=total)
    episode_topic.score = total
    return total


@transaction.atomic
def vote_on_topic(episode_topic: EpisodeTopic, user, value: int) -> int:
    """Cast or change a vote. `value` must be +1 or -1; 0 removes the vote."""
    if value not in (-1, 0, 1):
        raise TopicError("Vote must be +1, -1, or 0 to clear")

    if value == 0:
        EpisodeTopicVote.objects.filter(episode_topic=episode_topic, user=user).delete()
    else:
        EpisodeTopicVote.objects.update_or_create(
            episode_topic=episode_topic, user=user, defaults={"value": value}
        )

    return recompute_topic_score(episode_topic)
