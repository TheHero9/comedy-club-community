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
    # 🚨 REQUIRED, not defaulted. A machine suggestion and a member's label mean
    # different things to a reader, and a default of False would silently render
    # every auto label as community-authored the moment a caller forgot to set
    # it. Derived from `added_by`, never stored - see services/labels.py.
    is_auto: bool = Field(
        ...,
        description=(
            "True when this label was suggested by the automatic labeller rather "
            "than added by a community member."
        ),
    )


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
    # 🚨 Nullable, and REQUIRED in the schema (no `= None` default). A moment
    # with no timestamp is a note about the episode rather than a point inside
    # it, and the client renders it differently - so one forgotten assignment
    # must fail loudly here, not silently default every note to "no time".
    timestamp_sec: int | None
    label: str
    score: int
    created_at: datetime
    author: str | None = None
    # 🔒 Computed on the server from request.auth, never from a client-supplied
    # id. `author` is a DISPLAY NAME and cannot answer "is this mine" - two
    # members called Иван are indistinguishable by it, and a display name is
    # also editable, so it is not an identity.
    is_mine: bool = False


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
    # 🔒 "Which of these are mine" lives HERE rather than on the public moment
    # and cast endpoints, because those are cached public reads with no actor.
    # The client marks its own rows by intersecting these ids - the server
    # never has to trust a client-supplied identity to do it.
    my_moment_ids: list[int] = []
    my_proposal_ids: list[int] = []


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
    # ⚠️ Caps mirror the model columns. Without them an over-length value passes
    # Pydantic and dies in psycopg as a DataError - an unhandled 500, not a 422.
    note: str = Field("", max_length=280)


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
    # The channel's YouTube picture, so a membership row looks like the same
    # channel it does everywhere else on the site. "" means unknown; the UI
    # layers an initials tile behind it either way.
    channel_avatar_url: str
    tier: str
    member_since: date | None
    # 🚨 `Field(...)` - REQUIRED and nullable, not optional. `membership_out`
    # always emits all three, and a Pydantic default of None would make them
    # optional in the OpenAPI schema and therefore `number | undefined` in the
    # generated TypeScript. The UI has to branch on "is this null", and a type
    # that also admits `undefined` turns that check into a bug the compiler
    # cannot see: `months === null` is false for undefined, so a legacy row
    # would fall through to the "N months" branch and render "undefined months".
    renewal_day: int | None = Field(
        ..., description="Day of the month the membership renews (1-31)."
    )
    months: int | None = Field(
        ...,
        description=(
            "How many months the membership has run, COMPUTED from member_since "
            "on every read - never a stored column, so it is correct without a "
            "nightly job. Null on rows claimed before renewal_day existed."
        ),
    )
    next_renewal: date | None = Field(
        ..., description="The next renewal date, strictly after today."
    )
    is_verified: bool = Field(
        ...,
        description=(
            "🚨 Admin-set, and the ONLY thing that feeds the elite score. A "
            "self-added membership is a claim: it shows the badge and unlocks "
            "profile icons, but it does not vote."
        ),
    )
    has_screenshot: bool = False
    verified_at: datetime | None


class MembershipIn(Schema):
    """Claim or update a channel membership.

    🚨 The month count is an INPUT, never a stored column. The user knows "I have
    70 months and it renews on the 6th"; the API turns that into the start date
    it implies and counts forward from then on. See
    `podcast/services/memberships.py`.
    """

    channel_id: int
    months: int | None = Field(
        None,
        ge=0,
        le=600,
        description=(
            "COMPLETED months held right now, as the user's badge shows them. "
            "0 is valid and means 'new member' - the first rung of the icon "
            "ladder."
        ),
    )
    renewal_day: int | None = Field(
        None, ge=1, le=31, description="Day of the month it renews."
    )
    # ⚠️ Cap mirrors ChannelMembership.tier (CharField 100); over-length would 500.
    tier: str = Field("", max_length=100)
    # ⚠️ Kept for the pre-2026-08-16 shape, where a claim was just a date. When
    # months + renewal_day are supplied they win, because they are what the user
    # actually typed and the date is derived from them.
    member_since: date | None = None


class AvatarIconOut(Schema):
    """One entry in the profile-icon catalogue, as this viewer sees it."""

    key: str
    label: str = Field(
        ...,
        description=(
            "The catalogue's own name, for the admin and this schema. ⚠️ NOT what "
            "the picker renders - the UI composes a bilingual label from "
            "min_months and channel_name instead."
        ),
    )
    image_url: str
    # Required and nullable, same reasoning as MembershipOut above: null means
    # "no membership needed", and the picker branches on exactly that.
    channel_slug: str | None = Field(...)
    channel_name: str | None = Field(
        ..., description="Resolved from the slug so the picker can group by channel."
    )
    min_months: int = Field(
        0,
        description=(
            "COMPLETED months required. 0 is the 'new member' rung and is a real "
            "tier - it still requires a membership on the channel, just no "
            "elapsed time."
        ),
    )
    unlocked: bool = Field(
        ...,
        description=(
            "Whether this viewer has enough months on the icon's channel. Locked "
            "icons are still listed so the ladder is visible, but selecting one "
            "is a 403."
        ),
    )
    selected: bool = False


class AvatarSelectionIn(Schema):
    # "" clears the selection back to the default avatar. Same sentinel rule as
    # `handle` on ProfileIn: omitting a field must mean "leave it alone", so
    # "clear" cannot also be None.
    avatar_key: str = Field(..., max_length=64)


class MeOut(Schema):
    id: int
    username: str
    display_name: str
    # 🚨 The YouTube handle, and NULL until we know it. It is deliberately not
    # defaulted to the username: rendering the Django username here is what put
    # the same `user_33Kq...` string on the profile page twice.
    handle: str | None = None
    avatar_url: str = Field(
        ...,
        description=(
            "The image to render. Resolved from avatar_key when one is chosen "
            "AND still unlocked, otherwise the profile's own avatar_url."
        ),
    )
    avatar_key: str = Field("", description="The chosen catalogue key, if any.")
    bio: str
    role: str
    memberships: list[MembershipOut] = []
    rating_count: int = 0
    watched_count: int = 0
    favorite_count: int = 0


class ProfileIn(Schema):
    # ⚠️ display_name/avatar_url caps mirror the model columns (CharField 100,
    # URLField 200) - over-length input would otherwise be a psycopg DataError
    # 500. bio is a TextField, so its cap is a sanity bound, not a column limit.
    display_name: str | None = Field(None, max_length=100)
    # The public nickname. `""` means "clear it"; omitting it leaves it alone,
    # which is why the sentinel has to be the empty string and not None.
    handle: str | None = Field(None, max_length=30)
    bio: str | None = Field(None, max_length=5000)
    avatar_url: str | None = Field(None, max_length=200)


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
    """Either form of timestamp, or NEITHER.

    `timestamp` is what a human typed ("1:30:29"); `timestamp_sec` is kept so
    existing callers keep working. The string wins when both arrive - see
    services/timestamps.resolve_timestamp.

    Both absent is legal and means "a note about this episode, not a point in
    it" (owner ruling 2026-08-16). A malformed string is still a 422 - leaving
    the field blank is a decision, mistyping it is not.
    """

    timestamp: str | None = Field(None, max_length=12, description="e.g. 1:30:29")
    timestamp_sec: int | None = Field(None, ge=0)
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
# Participant proposals (spec 14)
# ---------------------------------------------------------------------------


class UserAdminOut(Schema):
    """A person's account, as the role panel sees it.

    🔒 Deliberately NO email. The panel exists to grant permissions, and that
    does not require exposing everyone's address to every admin session.
    """

    id: int
    username: str
    display_name: str
    handle: str | None = None
    role: str
    date_joined: datetime
    is_me: bool = False


class UserRoleIn(Schema):
    role: str = Field(..., description="member | moderator | admin")


class PersonIn(Schema):
    """Creating or editing a canonical persona. Admin-curated, never user text."""

    name: str = Field(..., min_length=1, max_length=200)
    bio: str = Field("", max_length=2000)
    avatar_url: str = Field("", max_length=200)


class ParticipantProposeIn(Schema):
    """Exactly one of `person_slug` / `name`.

    🚨 `name` is FREE TEXT and never becomes a `Person`. A moderator maps it
    onto a persona that already exists, creating that persona by hand first if
    it is genuinely new. See services/participants.py for why.
    """

    person_slug: str | None = Field(None, max_length=220)
    name: str | None = Field(None, max_length=200)
    role: str = Field("guest", max_length=20)


class ProposalOut(Schema):
    id: int
    display_name: str
    person_slug: str | None = None
    role: str
    status: str
    created_at: datetime
    proposed_by: str | None = None
    # Populated on rejection so the member who filed it learns WHY, the same
    # feedback loop the report queue gives.
    note: str = ""
    verified_at: datetime | None = None
    is_mine: bool = False


class EpisodeCastOut(Schema):
    """Confirmed and pending are separate lists, never merged.

    Only `confirmed` is in EpisodeParticipant, and therefore only `confirmed`
    is what Meilisearch and `?person=` agree with. Merging them in the payload
    would invite a caller to render unverified data as fact.
    """

    confirmed: list[PersonBriefOut] = []
    pending: list[ProposalOut] = []


class ProposalReviewIn(Schema):
    """`person_slug` is the moderator's correction - "this person IS in the
    episode, but under the right name"."""

    person_slug: str | None = Field(None, max_length=220)
    role: str | None = Field(None, max_length=20)
    note: str = Field("", max_length=280)


class ProposalQueueOut(ProposalOut):
    episode_youtube_id: str
    episode_title: str
    proposed_name: str = ""


# ---------------------------------------------------------------------------
# Moderation (wave 13)
# ---------------------------------------------------------------------------


class ReportIn(Schema):
    """A target is OPTIONAL: "the site is broken" and "here is a suggestion"
    point at nothing, and inventing a row to attach them to would be worse."""

    target_type: str | None = Field(
        None, description="episode | comment | moment | episodetopic | rating"
    )
    target_id: int | None = None
    category: str = Field("other", max_length=32)
    reason: str = Field(..., min_length=1, max_length=280)


class ReportOut(Schema):
    id: int
    target_type: str | None = None
    target_id: int | None = None
    category: str = "other"
    reason: str
    status: str
    created_at: datetime
    resolution_note: str = ""
    resolved_at: datetime | None = None


class ReportResolveIn(Schema):
    status: str = Field(..., description="resolved | dismissed")
    resolution_note: str = Field("", max_length=280)


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


#: Shared by both search endpoints so the two never drift apart.
MATCH_KIND_DESCRIPTION = (
    "'full' when the hit matched EVERY word of the query, 'partial' when it "
    "matched only some. Matching is deliberately loose (a remembered phrase is "
    "rarely verbatim), so this is what lets the UI show a two-of-three-words hit "
    "without passing it off as a perfect one. Hits are always ordered full first."
)


class SearchHitOut(Schema):
    episode: EpisodeBriefOut
    matched_topics: list[str] = []
    matched_moments: list[str] = []
    match_kind: str = Field("full", description=MATCH_KIND_DESCRIPTION)


class SearchOut(Schema):
    query: str
    hits: list[SearchHitOut]
    total: int = Field(
        ...,
        description=(
            "Episodes matching at least one word, counted EXHAUSTIVELY. This is "
            "`totalHits` from a page-mode search, never `estimatedTotalHits` - "
            "the estimate over-reported one query's 13 episodes as 17."
        ),
    )
    total_full: int = Field(
        0,
        description=(
            "Of `total`, how many matched every word. Also the exact index at "
            "which `hits` stops being full matches, which is how a hit's "
            "`match_kind` stays correct across pagination."
        ),
    )
    word_count: int = Field(
        0, description="Words in the query that can match (stop words excluded)."
    )
    limit: int
    offset: int
    backend: str = Field(..., description="meilisearch | postgres")
    processing_ms: int | None = None


# ---------------------------------------------------------------------------
# Transcript search
# ---------------------------------------------------------------------------


class TranscriptMatchOut(Schema):
    """One passage where the query was spoken."""

    start_sec: int
    end_sec: int
    text: str = Field(
        ...,
        description=(
            "The passage, cropped around the match, with <mark> around the matched "
            "terms. 🔒 Escape on output - this is auto-caption text, not trusted HTML "
            "beyond the <mark> tags the client is expected to render."
        ),
    )
    deep_link: str = Field(..., description="YouTube URL seeked to start_sec")


class TranscriptHitOut(Schema):
    episode: EpisodeBriefOut
    matches: list[TranscriptMatchOut]
    match_kind: str = Field("full", description=MATCH_KIND_DESCRIPTION)


class TranscriptSearchOut(Schema):
    """Where a phrase was SAID, as opposed to which episodes are ABOUT it.

    🚨 `limit`/`offset` page over EPISODES. They paged over SEGMENTS until
    2026-08-16, which meant the episode count in a response was an accident of
    how many passages happened to land on the page - the UI printed "21 passages
    in 13 episodes" and rendered six cards with no way to reach the other seven.
    """

    query: str
    hits: list[TranscriptHitOut]
    total_segments: int = Field(
        ...,
        description=(
            "Matching PASSAGES across the catalogue, counted exhaustively "
            "(clamped at 20,000 by the index's maxTotalHits)."
        ),
    )
    total_episodes: int = Field(
        0,
        description=(
            "Matching EPISODES across the catalogue, counted exhaustively. A "
            "different question from total_segments, and the one the page size "
            "pages over - conflating the two is what made the old UI misleading."
        ),
    )
    total_full_episodes: int = Field(
        0,
        description=(
            "Of `total_episodes`, how many contain EVERY word of the query. Also "
            "the exact index at which `hits` stops being full matches."
        ),
    )
    word_count: int = Field(
        0, description="Words in the query that can match (stop words excluded)."
    )
    limit: int
    offset: int
    available: bool = Field(
        ...,
        description=(
            "False when Meilisearch is down. There is no Postgres fallback here - "
            "an ILIKE over every transcript is a full scan of the catalogue."
        ),
    )
    processing_ms: int | None = None


# ---------------------------------------------------------------------------
# Season grid (IMDb-style ratings heatmap). One calendar year = one season.
# ---------------------------------------------------------------------------


class GridCellOut(Schema):
    """One episode inside the heatmap.

    🚨 Keep this LEAN. Every field is multiplied by the channel's episode count,
    and the biggest channel is already 1,318 episodes. Fields that only a hover
    card or a detail view needs (`slug`, `upload_date`, `duration_sec`,
    `thumbnail_url`) were removed on 2026-08-09: they were 47% of the payload and
    no consumer read them. `thumbnail_url` is derivable from `youtube_id`
    anyway - the project rule is to store the video id and build the CDN URL at
    render time. Anything richer comes from /api/episodes/{youtube_id}.
    """

    youtube_id: str
    title: str
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
