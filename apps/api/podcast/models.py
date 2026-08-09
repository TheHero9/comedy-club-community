"""Podcast Community schema.

Derived from docs/01-canonical-models.py. Every deviation from that file is logged
in docs/02-schema-decisions.md with its reason - keep the two in sync.

🇧🇬 All slugs use `bg_slugify` (allow_unicode=True). Django's default slugify strips
Cyrillic and yields an empty string for Bulgarian titles.
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Avg
from django.utils import timezone

from .slugs import bg_slugify

User = settings.AUTH_USER_MODEL


# ---------------------------------------------------------------------------
# CHANNELS & EPISODES  (populated by ingestion, no transcription)
# ---------------------------------------------------------------------------


class Channel(models.Model):
    """One of the podcast channels."""

    youtube_channel_id = models.CharField(max_length=64, unique=True)
    handle = models.CharField(max_length=100, blank=True)  # e.g. @ivankirkov1
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True, allow_unicode=True)
    description = models.TextField(blank=True)
    avatar_url = models.URLField(blank=True)
    banner_url = models.URLField(blank=True)
    subscriber_count = models.PositiveIntegerField(null=True, blank=True)

    is_active = models.BooleanField(
        default=True, help_text="Uncheck to exclude from scheduled syncs."
    )
    last_synced_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = bg_slugify(self.name, max_length=220)
        super().save(*args, **kwargs)


class Episode(models.Model):
    """A video/podcast episode, sourced from YouTube metadata."""

    class ContentKind(models.TextChoices):
        # 🚨 Shorts are NEVER ingested (owner decision 2026-08-08), hence no SHORT member.
        VIDEO = "video", "Video"
        STREAM = "stream", "Live stream"

    class Availability(models.TextChoices):
        PUBLIC = "public", "Public"
        SUBSCRIBER_ONLY = "subscriber_only", "Members only"
        UNLISTED = "unlisted", "Unlisted"

    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name="episodes")
    youtube_id = models.CharField(max_length=32, unique=True)  # primary external key
    title = models.CharField(max_length=300)
    slug = models.SlugField(max_length=320, blank=True, allow_unicode=True)
    description = models.TextField(blank=True)
    upload_date = models.DateField(null=True, blank=True)
    duration_sec = models.PositiveIntegerField(null=True, blank=True)
    thumbnail_url = models.URLField(blank=True)  # derived from youtube_id, never uploaded
    url = models.URLField(blank=True)

    # --- Deviations 2 & 3: see docs/02-schema-decisions.md -------------------
    content_kind = models.CharField(
        max_length=16, choices=ContentKind.choices, default=ContentKind.VIDEO, db_index=True
    )
    availability = models.CharField(
        max_length=32, choices=Availability.choices, default=Availability.PUBLIC
    )
    members_only = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Denormalized from availability so the UI can badge and filter cheaply.",
    )
    language = models.CharField(max_length=8, blank=True)  # e.g. "bg"

    # Denormalized YouTube stats (refreshed on each sync).
    # ⚠️ view_count is NULL on members-only episodes - YouTube does not report it.
    view_count = models.BigIntegerField(null=True, blank=True)
    like_count = models.BigIntegerField(null=True, blank=True)
    yt_comment_count = models.BigIntegerField(null=True, blank=True)

    # --- Deviation 4: denormalized scores ------------------------------------
    # A CACHE over Rating, never a source of truth. NULL means "no ratings yet",
    # which is not the same as zero. Recomputed on rating write plus a Celery sweep.
    public_score = models.FloatField(null=True, blank=True, db_index=True)
    elite_score = models.FloatField(null=True, blank=True, db_index=True)
    rating_count = models.PositiveIntegerField(default=0)
    elite_rating_count = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-upload_date", "-id"]
        constraints = [
            # Episode.slug is not globally unique (two channels may post the same
            # title), but it must be unique WITHIN a channel so /channel/slug resolves.
            models.UniqueConstraint(
                fields=["channel", "slug"], name="uniq_episode_slug_per_channel"
            ),
        ]
        indexes = [
            models.Index(fields=["channel", "-upload_date"]),
            models.Index(fields=["-upload_date"]),
            models.Index(fields=["-public_score"]),
            models.Index(fields=["content_kind", "-upload_date"]),
            # --- Sort indexes that match the API's ORDER BY exactly ----------
            # 🚨 Every list endpoint sorts NULLS LAST, because an unrated episode
            # must not top "top rated". A plain `-column` index is DESC NULLS
            # FIRST, and Postgres CANNOT use it for a NULLS LAST sort - so the
            # four indexes above were dead for /api/episodes and every list query
            # was a full seq scan plus a sort. Measured on a simulated 8,352-row
            # table: cost 1624 -> 24, execution 23ms -> 0.3ms.
            # The trailing `-id` is the pagination tiebreak, and it has to be in
            # the index or the sort cannot be satisfied from it.
            models.Index(
                models.F("upload_date").desc(nulls_last=True),
                models.F("id").desc(),
                name="ep_upload_desc_nl_idx",
            ),
            models.Index(
                models.F("public_score").desc(nulls_last=True),
                models.F("id").desc(),
                name="ep_public_desc_nl_idx",
            ),
            models.Index(
                models.F("elite_score").desc(nulls_last=True),
                models.F("id").desc(),
                name="ep_elite_desc_nl_idx",
            ),
            models.Index(
                models.F("rating_count").desc(),
                models.F("id").desc(),
                name="ep_rating_count_desc_idx",
            ),
            models.Index(
                models.F("duration_sec").desc(nulls_last=True),
                models.F("id").desc(),
                name="ep_duration_desc_nl_idx",
            ),
            # Per-channel browse. Without these, filtering one channel out of
            # eight walks the global sort index and discards ~7/8 of what it
            # reads; the smaller the channel, the worse it gets.
            models.Index(
                models.F("channel_id"),
                models.F("upload_date").desc(nulls_last=True),
                models.F("id").desc(),
                name="ep_ch_upload_desc_nl_idx",
            ),
            models.Index(
                models.F("channel_id"),
                models.F("public_score").desc(nulls_last=True),
                models.F("id").desc(),
                name="ep_ch_public_desc_nl_idx",
            ),
        ]

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = bg_slugify(self.title, max_length=320)
        # Keep the denormalized flag honest no matter who set availability.
        self.members_only = self.availability == self.Availability.SUBSCRIBER_ONLY
        super().save(*args, **kwargs)

    @property
    def watch_url(self) -> str:
        return self.url or f"https://www.youtube.com/watch?v={self.youtube_id}"

    # --- Derived scores -----------------------------------------------------
    # These are the CORRECTNESS REFERENCE for the denormalized columns above.
    # ❌ Never call them in a loop - annotate the queryset or read the columns.

    def compute_public_score(self) -> float | None:
        """Average of ALL ratings, out of 10."""
        return self.ratings.aggregate(v=Avg("score"))["v"]

    def compute_elite_score(self) -> float | None:
        """Average of ratings by VERIFIED members of THIS episode's channel.

        One Rating model, two derived numbers. There is no separate 'elite vote', so
        verifying a user makes their existing ratings count with no data migration.
        """
        return self.ratings.filter(
            user__channel_memberships__channel=self.channel,
            user__channel_memberships__is_verified=True,
        ).aggregate(v=Avg("score"))["v"]


class Chapter(models.Model):
    """Creator-supplied timestamps, when yt-dlp returns structured chapters.

    ⚠️ Opportunistic only. The @ivankirkov1 probe found 0 of 12 episodes with
    chapters, so nothing may depend on these existing. Community `Moment` records
    are the primary timestamp source.
    """

    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="chapters")
    title = models.CharField(max_length=300)
    start_sec = models.PositiveIntegerField()
    end_sec = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["start_sec"]
        constraints = [
            models.UniqueConstraint(
                fields=["episode", "start_sec"], name="uniq_chapter_start_per_episode"
            )
        ]

    def __str__(self):
        return f"{self.start_sec}s - {self.title}"


# ---------------------------------------------------------------------------
# PEOPLE / PERSONAS
# ---------------------------------------------------------------------------


class Person(models.Model):
    """A host, co-host or guest persona. Admin-managed."""

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True, allow_unicode=True)
    bio = models.TextField(blank=True)
    avatar_url = models.URLField(blank=True)
    user = models.OneToOneField(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="persona"
    )
    socials = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "people"

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = bg_slugify(self.name, max_length=220)
        super().save(*args, **kwargs)


class EpisodeParticipant(models.Model):
    """Who took part in an episode, and in what role."""

    class Role(models.TextChoices):
        HOST = "host", "Host"
        COHOST = "cohost", "Co-host"
        GUEST = "guest", "Guest"
        PRODUCER = "producer", "Producer"

    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="participants")
    person = models.ForeignKey(Person, on_delete=models.CASCADE, related_name="appearances")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.GUEST)
    added_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["episode", "person"], name="uniq_participant_per_episode"
            )
        ]
        indexes = [models.Index(fields=["person", "role"])]

    def __str__(self):
        return f"{self.person} as {self.get_role_display()}"


# ---------------------------------------------------------------------------
# USERS, PROFILES & MEMBERSHIP
# ---------------------------------------------------------------------------


class UserProfile(models.Model):
    """Extends the auth user and carries the app-wide role."""

    class Role(models.TextChoices):
        MEMBER = "member", "Member"
        MODERATOR = "moderator", "Moderator"
        ADMIN = "admin", "Admin"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")

    # --- Deviation 1: Clerk identity mapping ---------------------------------
    # Clerk's JWT `sub` claim. Users are provisioned lazily via get_or_create.
    # Nullable so waves 1-7 (and the Django superuser) work with no Clerk account.
    clerk_user_id = models.CharField(
        max_length=64, unique=True, null=True, blank=True, db_index=True
    )

    display_name = models.CharField(max_length=100, blank=True)
    avatar_url = models.URLField(blank=True)
    bio = models.TextField(blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.display_name or self.user.get_username()

    @property
    def is_staff_role(self) -> bool:
        return self.role in {self.Role.MODERATOR, self.Role.ADMIN}


class ChannelMembership(models.Model):
    """A user's membership of a channel, verified by screenshot review.

    🔒 verification_screenshot is PRIVATE. It is proof of a paid membership from a
    real person: admin-only, served via short-lived signed URLs, never a public URL.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="channel_memberships")
    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name="memberships")
    member_since = models.DateField(null=True, blank=True)  # claimed join date
    tier = models.CharField(max_length=100, blank=True)

    is_verified = models.BooleanField(default=False, db_index=True)
    verification_screenshot = models.ImageField(upload_to="verifications/", null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="verifications_done",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "channel"], name="uniq_membership_per_channel"
            )
        ]
        indexes = [models.Index(fields=["channel", "is_verified"])]

    def __str__(self):
        state = "verified" if self.is_verified else "unverified"
        return f"{self.user} @ {self.channel} ({state})"


# ---------------------------------------------------------------------------
# PERSONAL ENGAGEMENT
# ---------------------------------------------------------------------------


class Rating(models.Model):
    """A user's 1-10 score for an episode.

    🚨 THE single rating model. Feeds BOTH the public and the elite score - there is
    no separate 'elite vote'. See docs/02-schema-decisions.md.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="ratings")
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="ratings")
    score = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)]
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "episode"], name="uniq_rating_per_episode"),
            models.CheckConstraint(
                condition=models.Q(score__gte=1) & models.Q(score__lte=10),
                name="rating_score_between_1_and_10",
            ),
        ]
        indexes = [models.Index(fields=["episode", "score"])]

    def __str__(self):
        return f"{self.user} rated {self.episode_id}: {self.score}/10"


class WatchEvent(models.Model):
    """A LOG of watches, not a flag, so rewatch history works."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="watch_events")
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="watch_events")
    watched_on = models.DateField(default=timezone.localdate)
    note = models.CharField(max_length=280, blank=True)

    class Meta:
        ordering = ["-watched_on", "-id"]
        indexes = [
            models.Index(fields=["user", "episode"]),
            models.Index(fields=["user", "-watched_on"]),
        ]

    def __str__(self):
        return f"{self.user} watched {self.episode} on {self.watched_on}"


class Favorite(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="favorites")
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="favorited_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "episode"], name="uniq_favorite")
        ]

    def __str__(self):
        return f"{self.user} favorited {self.episode}"


class PersonalTag(models.Model):
    """🔒 PRIVATE per-user keywords. Never exposed on any public endpoint."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="personal_tags")
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="personal_tags")
    text = models.CharField(max_length=100)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "episode", "text"], name="uniq_personal_tag"
            )
        ]
        indexes = [models.Index(fields=["user", "text"])]

    def __str__(self):
        return f"{self.text} ({self.user})"


# ---------------------------------------------------------------------------
# COMMUNITY CONTENT  (public)
# ---------------------------------------------------------------------------


class Comment(models.Model):
    """Public comment. Body is user input - escape on output, never render as HTML."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="comments")
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="comments")
    body = models.TextField()
    is_spoiler = models.BooleanField(default=False)
    is_hidden = models.BooleanField(
        default=False, help_text="Hidden by a moderator. Kept for audit, not shown publicly."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["episode", "-created_at"])]

    def __str__(self):
        return f"{self.user} on {self.episode}: {self.body[:40]}"


class Topic(models.Model):
    """A canonical, reusable label.

    Being canonical is what makes 'find every episode about X' work. Free-text input
    must resolve through slug-based get_or_create so 50 spellings never appear.
    """

    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=100, unique=True, blank=True, allow_unicode=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = bg_slugify(self.name, max_length=100)
        super().save(*args, **kwargs)


class EpisodeTopic(models.Model):
    """Links a Topic to an Episode. Added by admins or community members."""

    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="topics")
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name="episodes")
    added_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    score = models.IntegerField(default=0)  # denormalized net votes, for sorting
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-score", "-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["episode", "topic"], name="uniq_topic_per_episode")
        ]
        indexes = [
            models.Index(fields=["topic", "-score"]),
            models.Index(fields=["episode", "-score"]),
        ]

    def __str__(self):
        return f"{self.topic} on {self.episode} ({self.score:+d})"


class EpisodeTopicVote(models.Model):
    """Community up/down vote on whether a topic label fits."""

    episode_topic = models.ForeignKey(
        EpisodeTopic, on_delete=models.CASCADE, related_name="votes"
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="topic_votes")
    value = models.SmallIntegerField(default=1)  # +1 or -1
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["episode_topic", "user"], name="uniq_topic_vote"),
            models.CheckConstraint(
                condition=models.Q(value__in=[-1, 1]), name="topic_vote_is_plus_or_minus_one"
            ),
        ]

    def __str__(self):
        return f"{self.user} voted {self.value:+d} on {self.episode_topic_id}"


class Moment(models.Model):
    """Community timestamp. The primary searchable structure, standing in for
    transcription and for the chapters this channel does not provide."""

    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="moments")
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    timestamp_sec = models.PositiveIntegerField()
    label = models.CharField(max_length=200)
    score = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["timestamp_sec"]
        indexes = [models.Index(fields=["episode", "timestamp_sec"])]

    def __str__(self):
        minutes, seconds = divmod(self.timestamp_sec, 60)
        return f"{minutes}:{seconds:02d} - {self.label}"

    @property
    def deep_link(self) -> str:
        return f"https://www.youtube.com/watch?v={self.episode.youtube_id}&t={self.timestamp_sec}"


# ---------------------------------------------------------------------------
# MODERATION
# ---------------------------------------------------------------------------


class Report(models.Model):
    """A community report against any target, via a generic FK."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RESOLVED = "resolved", "Resolved"
        DISMISSED = "dismissed", "Dismissed"

    reporter = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="reports_made"
    )
    reason = models.CharField(max_length=280)

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey("content_type", "object_id")

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="reports_resolved"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.CharField(max_length=280, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["content_type", "object_id"]),
        ]

    def __str__(self):
        return f"[{self.get_status_display()}] {self.reason[:60]}"
