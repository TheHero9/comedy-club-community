"""Public, unauthenticated endpoints.

Everything here is readable logged out - this is a content site and these pages are
what search engines index. No endpoint in this module may require auth or leak
private data (personal tags, screenshots, emails).
"""

from __future__ import annotations

from django.db.models import Count, F, Q
from django.shortcuts import get_object_or_404
from ninja import Query, Router
from ninja.errors import HttpError

from podcast.models import Channel, Person, Topic

from .schemas import (
    ChannelGridOut,
    ChannelOut,
    EpisodeListOut,
    EpisodeOut,
    PersonDetailOut,
    PersonOut,
    TopicOut,
)
from .serializers import (
    channel_list_queryset,
    channel_out,
    episode_brief,
    episode_detail,
    episode_detail_queryset,
    episode_list_queryset,
    paginated_meta,
    person_out,
)

router = Router(tags=["public"], auth=None)

MAX_LIMIT = 100

SORT_FIELDS = {
    "newest": "-upload_date",
    "oldest": "upload_date",
    "top": "-public_score",
    "top_elite": "-elite_score",
    "most_rated": "-rating_count",
    "longest": "-duration_sec",
}

# Columns that can be NULL. Postgres sorts NULLs FIRST on DESC, which would put every
# unrated episode at the top of "top rated" - the exact opposite of what it means.
NULLABLE_SORT_COLUMNS = {"public_score", "elite_score", "duration_sec", "upload_date"}


def _ordering(sort: str) -> list:
    """Ordering expression for a sort key, with NULLs forced last."""
    order = SORT_FIELDS.get(sort, SORT_FIELDS["newest"])
    descending = order.startswith("-")
    column = order.lstrip("-")

    if column in NULLABLE_SORT_COLUMNS:
        expression = F(column)
        primary = (
            expression.desc(nulls_last=True) if descending
            else expression.asc(nulls_last=True)
        )
    else:
        primary = order

    # "-id" is a stable tiebreak so pagination cannot repeat or drop a row.
    return [primary, "-id"]


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------


@router.get("/channels", response=list[ChannelOut])
def list_channels(request):
    # 🚨 Curated order, not alphabetical. `display_order` is editorial and is set
    # by `manage.py set_channel_order`; `name` is only the tiebreak for channels
    # nobody has placed yet. See the Channel model.
    channels = channel_list_queryset().order_by("display_order", "name")
    return [channel_out(channel) for channel in channels]


@router.get("/channels/{slug}/grid", response=ChannelGridOut)
def get_channel_grid(
    request,
    slug: str,
    score: str = Query("public", description="public | elite"),
):
    """🎬 IMDb-style season grid. One calendar year = one season.

    Columns are years, rows are the episode's position within that year. Reading
    down a column walks the year in order; reading across compares the same point
    across years.
    """
    from podcast.services.grid import build_grid

    channel = get_object_or_404(Channel, slug=slug)
    try:
        grid = build_grid(channel, score_kind=score)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc

    # 🇧🇬 The compact non-escaping JSON this endpoint used to hand-render (the
    # 406 KB \uXXXX tax on the 1,318-episode channel) is now what the global
    # `CompactUnicodeJSONRenderer` in `config/api.py` emits for the whole API,
    # so the normal response path produces byte-identical output.
    return grid


@router.get("/channels/{slug}", response=ChannelOut)
def get_channel(request, slug: str):
    channel = get_object_or_404(channel_list_queryset(), slug=slug)
    return channel_out(channel)


# ---------------------------------------------------------------------------
# Episodes
# ---------------------------------------------------------------------------


@router.get("/episodes", response=EpisodeListOut)
def list_episodes(
    request,
    channel: str | None = Query(None, description="Channel slug"),
    topic: str | None = Query(None, description="Topic slug"),
    person: str | None = Query(None, description="Person slug"),
    kind: str | None = Query(None, description="video | stream"),
    members_only: bool | None = Query(None),
    q: str | None = Query(None, description="Simple title/description contains"),
    sort: str = Query("newest"),
    limit: int = Query(24, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
):
    queryset = episode_list_queryset()

    if channel:
        # Resolve the slug to an id first. `filter(channel__slug=...)` forces a join,
        # and the planner then cannot use the (channel_id, sort_column) index - it
        # walks the global sort index instead and throws away every other channel's
        # rows. One indexed lookup here buys an index scan of exactly `limit` rows.
        channel_id = (
            Channel.objects.filter(slug=channel).values_list("id", flat=True).first()
        )
        if channel_id is None:
            # Same result an unknown slug produced before: an empty page, not a 404.
            queryset = queryset.none()
        else:
            queryset = queryset.filter(channel_id=channel_id)
    if topic:
        queryset = queryset.filter(topics__topic__slug=topic)
    if person:
        queryset = queryset.filter(participants__person__slug=person)
    if kind:
        queryset = queryset.filter(content_kind=kind)
    if members_only is not None:
        queryset = queryset.filter(members_only=members_only)
    if q:
        queryset = queryset.filter(Q(title__icontains=q) | Q(description__icontains=q))

    if topic or person:
        queryset = queryset.distinct()

    queryset = queryset.order_by(*_ordering(sort))

    total = queryset.count()
    items = [episode_brief(episode) for episode in queryset[offset : offset + limit]]
    return {"items": items, "meta": paginated_meta(total, limit, offset)}


@router.get("/episodes/{youtube_id}", response=EpisodeOut)
def get_episode(request, youtube_id: str):
    episode = get_object_or_404(episode_detail_queryset(), youtube_id=youtube_id)
    return episode_detail(episode)


# NOTE: GET /episodes/{id}/comments and /moments live in community.py alongside
# their POST counterparts, with auth=None on the reads.
#
# 🚨 A path may only be owned by ONE router. Django resolves to the first router
# that matches the path, and that router only knows its own methods - so a GET
# declared here plus a POST declared in community.py returned 405 for the POST
# (live bug, 2026-08-08). Same root cause as the /topics/suggest 404.


# ---------------------------------------------------------------------------
# Topics
# ---------------------------------------------------------------------------


@router.get("/topics", response=list[TopicOut])
def list_topics(request, q: str | None = Query(None), limit: int = Query(50, ge=1, le=MAX_LIMIT)):
    queryset = Topic.objects.annotate(_n=Count("episodes"))
    if q:
        queryset = queryset.filter(name__icontains=q)
    queryset = queryset.order_by("-_n", "name")[:limit]
    return [
        {"id": t.id, "name": t.name, "slug": t.slug, "episode_count": t._n} for t in queryset
    ]


@router.get("/topics/suggest", response=list[TopicOut])
def suggest_topics(request, q: str = Query("")):
    """Existing topics matching a partial input, most-used first.

    🚨 This is the main defence against topic sprawl: if users pick an existing
    label, "find every episode about X" keeps working.

    ⚠️ MUST be declared BEFORE /topics/{slug}. Routes match in declaration order, so
    with {slug} first this path resolves as slug="suggest" and 404s. That exact bug
    was live on 2026-08-08.
    """
    from podcast.services.topics import suggest_topics as suggest

    return [
        {
            "id": topic.id,
            "name": topic.name,
            "slug": topic.slug,
            "episode_count": getattr(topic, "n", 0),
        }
        for topic in suggest(q)
    ]


@router.get("/topics/{slug}", response=TopicOut)
def get_topic(request, slug: str):
    topic = get_object_or_404(Topic.objects.annotate(_n=Count("episodes")), slug=slug)
    return {
        "id": topic.id,
        "name": topic.name,
        "slug": topic.slug,
        "episode_count": topic._n,
    }


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------


@router.get("/people", response=list[PersonOut])
def list_people(
    request,
    q: str = Query("", description="Filter by name"),
    limit: int = Query(100, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
):
    """The persona catalogue, searchable and paged.

    🚨 It used to take `limit` alone, which is a cap and not pagination - past
    100 personas the rest were simply unreachable, and every caller rendered
    whichever slice it happened to get as if it were the whole list. The owner
    named the ceiling before it arrived: "the people section will have multiple
    people there, you can't render 1000 people."

    Ordered by appearance count so the personas a moderator actually reaches for
    are on the first page, with `name` breaking ties - a stable second key
    matters here, because an unstable sort under offset paging silently drops
    and duplicates rows between pages.
    """
    people = Person.objects.annotate(_appearance_count=Count("appearances"))
    if q.strip():
        # 🇧🇬 `icontains` on a Cyrillic name is the right tool: this is a
        # moderator picking a known persona from a short list, not the
        # typo-tolerant public search, and it must never depend on Meilisearch
        # being up to approve a proposal.
        people = people.filter(name__icontains=q.strip())
    people = people.order_by("-_appearance_count", "name", "id")[offset : offset + limit]
    return [person_out(person) for person in people]


@router.get("/people/{slug}", response=PersonDetailOut)
def get_person(request, slug: str):
    person = get_object_or_404(
        Person.objects.annotate(_appearance_count=Count("appearances")), slug=slug
    )
    episodes = episode_list_queryset().filter(participants__person=person).distinct()
    data = person_out(person)
    data["episodes"] = [episode_brief(episode) for episode in episodes[:100]]
    return data
