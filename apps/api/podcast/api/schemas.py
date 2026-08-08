"""Django-Ninja schemas.

These define the OpenAPI contract, which packages/api-types is generated from, so
the frontend never hand-writes a type. Keep names explicit and suffixed by intent:
`...Out` for responses, `...In` for request bodies.

🔒 No schema here may expose a PersonalTag, a verification screenshot URL, or an
email. Those are private.
"""

from __future__ import annotations

from datetime import date, datetime

from ninja import Field, Schema

# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------


class MessageOut(Schema):
    detail: str


class PaginatedMeta(Schema):
    total: int
    limit: int
    offset: int
    has_more: bool


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------


class ChannelOut(Schema):
    id: int
    youtube_channel_id: str
    name: str
    slug: str
    handle: str
    description: str
    avatar_url: str
    banner_url: str
    subscriber_count: int | None
    episode_count: int = 0
    last_synced_at: datetime | None


class ChannelListOut(Schema):
    items: list[ChannelOut]
    meta: PaginatedMeta


# ---------------------------------------------------------------------------
# Episodes
# ---------------------------------------------------------------------------


class TopicBriefOut(Schema):
    id: int
    name: str
    slug: str
    score: int = 0


class PersonBriefOut(Schema):
    id: int
    name: str
    slug: str
    avatar_url: str
    role: str = ""


class ChapterOut(Schema):
    id: int
    title: str
    start_sec: int
    end_sec: int | None


class MomentOut(Schema):
    id: int
    timestamp_sec: int
    label: str
    score: int
    created_at: datetime
    author: str | None = None


class EpisodeBriefOut(Schema):
    """Card-sized shape for lists. Deliberately excludes description."""

    id: int
    youtube_id: str
    title: str
    slug: str
    channel_id: int
    channel_name: str
    channel_slug: str
    upload_date: date | None
    duration_sec: int | None
    thumbnail_url: str
    content_kind: str
    members_only: bool
    # NULL means "no ratings yet", which is not the same as zero.
    public_score: float | None
    elite_score: float | None
    rating_count: int
    elite_rating_count: int
    # Semantic band key for public_score (masterpiece..garbage), or null when
    # unrated. The API owns the thresholds so web and mobile cannot disagree;
    # mapping a band to a colour is the component's job.
    band: str | None = None
    elite_band: str | None = None


class EpisodeOut(EpisodeBriefOut):
    """Full detail shape."""

    description: str
    url: str
    watch_url: str
    availability: str
    language: str
    view_count: int | None
    like_count: int | None
    topics: list[TopicBriefOut] = []
    chapters: list[ChapterOut] = []
    participants: list[PersonBriefOut] = []
    moment_count: int = 0
    comment_count: int = 0


class EpisodeListOut(Schema):
    items: list[EpisodeBriefOut]
    meta: PaginatedMeta


class ViewerStateOut(Schema):
    """The signed-in user's own relationship to an episode."""

    rating: int | None = None
    is_favorite: bool = False
    watch_count: int = 0
    last_watched_on: date | None = None
    personal_tags: list[str] = []


# ---------------------------------------------------------------------------
# Engagement (wave 9)
# ---------------------------------------------------------------------------


class RatingIn(Schema):
    score: int = Field(..., ge=1, le=10)


class RatingOut(Schema):
    score: int
    episode_id: int
    public_score: float | None
    elite_score: float | None
    rating_count: int
    elite_rating_count: int


class WatchIn(Schema):
    watched_on: date | None = None
    note: str = ""


class WatchEventOut(Schema):
    id: int
    episode_id: int
    watched_on: date
    note: str


class WatchSummaryOut(Schema):
    episode_id: int
    watch_count: int
    last_watched_on: date | None
    events: list[WatchEventOut] = []


class FavoriteOut(Schema):
    episode_id: int
    is_favorite: bool


class PersonalTagIn(Schema):
    text: str = Field(..., min_length=1, max_length=100)


class PersonalTagOut(Schema):
    """🔒 Private to the owning user. Never returned on a public endpoint."""

    id: int
    episode_id: int
    text: str


# ---------------------------------------------------------------------------
# Profile & membership (wave 10)
# ---------------------------------------------------------------------------


class MembershipOut(Schema):
    id: int
    channel_id: int
    channel_name: str
    channel_slug: str
    tier: str
    member_since: date | None
    is_verified: bool
    has_screenshot: bool = False
    verified_at: datetime | None


class MembershipIn(Schema):
    channel_id: int
    tier: str = ""
    member_since: date | None = None


class MeOut(Schema):
    id: int
    username: str
    display_name: str
    avatar_url: str
    bio: str
    role: str
    memberships: list[MembershipOut] = []
    rating_count: int = 0
    watched_count: int = 0
    favorite_count: int = 0


class ProfileIn(Schema):
    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None


class PublicProfileOut(Schema):
    """🔒 What ANY user may see about another. No email, no personal tags."""

    id: int
    display_name: str
    avatar_url: str
    bio: str
    role: str
    rating_count: int = 0
    verified_channels: list[str] = []


# ---------------------------------------------------------------------------
# Community (wave 11)
# ---------------------------------------------------------------------------


class CommentIn(Schema):
    body: str = Field(..., min_length=1, max_length=10000)
    is_spoiler: bool = False


class CommentOut(Schema):
    id: int
    episode_id: int
    body: str
    is_spoiler: bool
    created_at: datetime
    edited_at: datetime | None
    author_id: int
    author_name: str
    author_avatar: str


class CommentListOut(Schema):
    items: list[CommentOut]
    meta: PaginatedMeta


class TopicIn(Schema):
    name: str = Field(..., min_length=1, max_length=80)


class TopicOut(Schema):
    id: int
    name: str
    slug: str
    episode_count: int = 0


class EpisodeTopicOut(Schema):
    id: int
    topic: TopicOut
    score: int
    created_at: datetime
    my_vote: int | None = None


class VoteIn(Schema):
    value: int = Field(..., ge=-1, le=1)


class MomentIn(Schema):
    timestamp_sec: int = Field(..., ge=0)
    label: str = Field(..., min_length=1, max_length=200)


# ---------------------------------------------------------------------------
# People (wave 13)
# ---------------------------------------------------------------------------


class PersonOut(Schema):
    id: int
    name: str
    slug: str
    bio: str
    avatar_url: str
    socials: dict = {}
    appearance_count: int = 0


class PersonDetailOut(PersonOut):
    episodes: list[EpisodeBriefOut] = []


# ---------------------------------------------------------------------------
# Moderation (wave 13)
# ---------------------------------------------------------------------------


class ReportIn(Schema):
    target_type: str = Field(..., description="comment | moment | episodetopic | rating")
    target_id: int
    reason: str = Field(..., min_length=1, max_length=280)


class ReportOut(Schema):
    id: int
    target_type: str
    target_id: int
    reason: str
    status: str
    created_at: datetime
    resolution_note: str = ""


class ReportResolveIn(Schema):
    status: str = Field(..., description="resolved | dismissed")
    resolution_note: str = ""


# ---------------------------------------------------------------------------
# Leaderboards (wave 13)
# ---------------------------------------------------------------------------


class LeaderboardEntryOut(Schema):
    episode: EpisodeBriefOut
    value: float | None
    rank: int


class LeaderboardOut(Schema):
    kind: str
    items: list[LeaderboardEntryOut]


# ---------------------------------------------------------------------------
# Search (wave 12)
# ---------------------------------------------------------------------------


class SearchHitOut(Schema):
    episode: EpisodeBriefOut
    matched_topics: list[str] = []
    matched_moments: list[str] = []


class SearchOut(Schema):
    query: str
    hits: list[SearchHitOut]
    total: int
    limit: int
    offset: int
    backend: str = Field(..., description="meilisearch | postgres")
    processing_ms: int | None = None


# ---------------------------------------------------------------------------
# Season grid (IMDb-style ratings heatmap). One calendar year = one season.
# ---------------------------------------------------------------------------


class GridCellOut(Schema):
    youtube_id: str
    slug: str
    title: str
    upload_date: date | None
    duration_sec: int | None
    thumbnail_url: str
    content_kind: str
    members_only: bool
    # NULL score means "not rated yet", which is NOT zero.
    score: float | None
    rating_count: int
    band: str | None
    is_provisional: bool = False


class GridRowOut(Schema):
    index: int
    # One entry per season, aligned to `seasons`. None = that season is shorter.
    cells: list[GridCellOut | None]


class GridSeasonOut(Schema):
    year: int
    label: str
    episode_count: int
    rated_count: int
    average: float | None


class GridBandOut(Schema):
    key: str
    label: str
    min_score: float


class ChannelGridOut(Schema):
    channel_name: str
    channel_slug: str
    score_kind: str
    seasons: list[GridSeasonOut]
    rows: list[GridRowOut]
    overall_average: float | None
    rated_count: int
    total_count: int
    bands: list[GridBandOut]
