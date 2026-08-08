"""
Podcast Community — starting Django schema.

Design notes are inline. This is a v1 skeleton meant to be iterated on, not a
final production schema. Everything here works without transcription; a future
Transcript model can attach to Episode later without touching any of this.

Assumes Django 5.x and `django.contrib.contenttypes` in INSTALLED_APPS
(needed for the generic Report model at the bottom).
"""

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models
from django.db.models import Avg, Count
from django.utils import timezone
from django.utils.text import slugify

User = settings.AUTH_USER_MODEL


# ---------------------------------------------------------------------------
# CHANNELS & EPISODES  (populated by the yt-dlp sync, no transcription)
# ---------------------------------------------------------------------------

class Channel(models.Model):
    """One of the podcast channels (you mentioned ~5)."""
    youtube_channel_id = models.CharField(max_length=64, unique=True)
    handle = models.CharField(max_length=100, blank=True)      # e.g. @SomePodcast
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True)
    description = models.TextField(blank=True)
    avatar_url = models.URLField(blank=True)
    banner_url = models.URLField(blank=True)
    subscriber_count = models.PositiveIntegerField(null=True, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Episode(models.Model):
    """A video/podcast episode. All fields come straight from yt-dlp metadata."""
    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name="episodes")
    youtube_id = models.CharField(max_length=32, unique=True)   # primary external key
    title = models.CharField(max_length=300)
    slug = models.SlugField(max_length=320, blank=True)
    description = models.TextField(blank=True)
    upload_date = models.DateField(null=True, blank=True)
    duration_sec = models.PositiveIntegerField(null=True, blank=True)
    thumbnail_url = models.URLField(blank=True)                 # highest-res, mirror later if you want
    url = models.URLField(blank=True)

    # Denormalized YouTube stats (refreshed on each sync — cheap to keep)
    view_count = models.BigIntegerField(null=True, blank=True)
    like_count = models.BigIntegerField(null=True, blank=True)
    yt_comment_count = models.BigIntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-upload_date"]
        indexes = [
            models.Index(fields=["channel", "-upload_date"]),
        ]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.title)[:320]
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title

    # --- Derived scores -----------------------------------------------------
    # NOTE: these are convenience methods. For list pages, annotate in the
    # queryset instead of calling per-object to avoid N+1 queries.

    def public_score(self):
        """Average of ALL ratings, out of 10."""
        return self.ratings.aggregate(v=Avg("score"))["v"]

    def elite_score(self):
        """
        Average of ratings cast by users who are a VERIFIED member of THIS
        episode's channel. (See assumption note in the chat — one Rating model,
        two derived numbers. No separate 'elite vote'.)
        """
        return self.ratings.filter(
            user__channel_memberships__channel=self.channel,
            user__channel_memberships__is_verified=True,
        ).aggregate(v=Avg("score"))["v"]


class Chapter(models.Model):
    """
    Optional: if the creator puts timestamps in the description, yt-dlp returns
    them as structured chapters. Free episode segmentation without transcription.
    """
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="chapters")
    title = models.CharField(max_length=300)
    start_sec = models.PositiveIntegerField()
    end_sec = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["start_sec"]


# ---------------------------------------------------------------------------
# PEOPLE / PERSONAS  (admins create these and attach them to episodes)
# ---------------------------------------------------------------------------

class Person(models.Model):
    """
    A persona: a host, co-host, or guest. Created/managed by admins.
    Optionally linked to a real user account if that person also uses the app.
    """
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True)
    bio = models.TextField(blank=True)
    avatar_url = models.URLField(blank=True)
    # If this persona is also an app user (e.g. a host who signs up):
    user = models.OneToOneField(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="persona"
    )
    socials = models.JSONField(default=dict, blank=True)  # {"instagram": "...", ...}

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class EpisodeParticipant(models.Model):
    """Who took part in an episode, and in what role. Managed by admins."""
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


# ---------------------------------------------------------------------------
# USERS, PROFILES & MEMBERSHIP
# ---------------------------------------------------------------------------

class UserProfile(models.Model):
    """Extends the auth user. Also carries the app-wide role."""
    class Role(models.TextChoices):
        MEMBER = "member", "Member"
        MODERATOR = "moderator", "Moderator"
        ADMIN = "admin", "Admin"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    display_name = models.CharField(max_length=100, blank=True)
    avatar_url = models.URLField(blank=True)
    bio = models.TextField(blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)

    def __str__(self):
        return self.display_name or self.user.get_username()

    @property
    def is_staff_role(self):
        return self.role in {self.Role.MODERATOR, self.Role.ADMIN}


class ChannelMembership(models.Model):
    """
    A user's membership of a channel. Handles all three of your requirements at
    once: 'am I a member', 'member of MULTIPLE channels', and 'for how long'.
    Verification is by screenshot, reviewed by an admin.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="channel_memberships")
    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name="memberships")
    member_since = models.DateField(null=True, blank=True)          # claimed join date
    tier = models.CharField(max_length=100, blank=True)             # YouTube membership tier, if any

    is_verified = models.BooleanField(default=False)
    verification_screenshot = models.ImageField(
        upload_to="verifications/", null=True, blank=True
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="verifications_done"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "channel"], name="uniq_membership_per_channel"
            )
        ]


# ---------------------------------------------------------------------------
# PERSONAL ENGAGEMENT  (per-user, mostly private)
# ---------------------------------------------------------------------------

class Rating(models.Model):
    """A user's 1–10 score for an episode. Feeds BOTH public and elite scores."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="ratings")
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="ratings")
    score = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(10)]
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "episode"], name="uniq_rating_per_episode")
        ]


class WatchEvent(models.Model):
    """
    A LOG of watches (not a single flag), so you get rewatch history:
    'watched 3×, last on 12 Mar'. Directly serves the 'did I already watch this?'
    use case.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="watch_events")
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="watch_events")
    watched_on = models.DateField(default=timezone.now)
    note = models.CharField(max_length=280, blank=True)

    class Meta:
        ordering = ["-watched_on"]
        indexes = [models.Index(fields=["user", "episode"])]


class Favorite(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="favorites")
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="favorited_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "episode"], name="uniq_favorite")
        ]


class PersonalTag(models.Model):
    """
    Private keywords a user attaches to an episode for their OWN search.
    Distinct from community Topics below — these are never shown to others.
    """
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


# ---------------------------------------------------------------------------
# COMMUNITY CONTENT  (public — comments, topic labels, moments)
# ---------------------------------------------------------------------------

class Comment(models.Model):
    """Public comment describing what happened, discussion, etc."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="comments")
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="comments")
    body = models.TextField()
    is_spoiler = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]


class Topic(models.Model):
    """
    A canonical, reusable label/topic ('Football', 'Politics', 'Startups'...).
    Being canonical is what makes 'find every episode about X' work. Community
    free-text input should resolve to an existing Topic or create a new one
    (slugify + get_or_create) so you don't end up with 50 spellings of one tag.
    """
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(max_length=100, unique=True, blank=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class EpisodeTopic(models.Model):
    """
    Links a Topic to an Episode. Added by admins OR community members.
    `score` lets consensus surface good tags and bury bad ones (via the votes
    below); reports flag bad ones to moderators.
    """
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="topics")
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name="episodes")
    added_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    score = models.IntegerField(default=0)   # denormalized net votes, for sorting
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["episode", "topic"], name="uniq_topic_per_episode")
        ]
        indexes = [models.Index(fields=["topic", "-score"])]


class EpisodeTopicVote(models.Model):
    """Community up/down vote on whether a topic label fits (optional for v1)."""
    episode_topic = models.ForeignKey(EpisodeTopic, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    value = models.SmallIntegerField(default=1)  # +1 or -1

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["episode_topic", "user"], name="uniq_topic_vote")
        ]


class Moment(models.Model):
    """
    Community timestamp: 'hilarious bit at 34:12'. Community-sourced
    searchability that stands in for transcription for now.
    """
    episode = models.ForeignKey(Episode, on_delete=models.CASCADE, related_name="moments")
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    timestamp_sec = models.PositiveIntegerField()
    label = models.CharField(max_length=200)
    score = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["timestamp_sec"]


# ---------------------------------------------------------------------------
# MODERATION  (the 'report' queue)
# ---------------------------------------------------------------------------

class Report(models.Model):
    """
    A community report ('this label is wrong', 'this comment is abusive', ...).
    Generic target so ONE model can flag a Topic label, a Comment, a Moment,
    a Rating, etc. Lands in an admin/moderator queue.
    """
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RESOLVED = "resolved", "Resolved"
        DISMISSED = "dismissed", "Dismissed"

    reporter = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="reports_made")
    reason = models.CharField(max_length=280)

    # Generic pointer to whatever is being reported
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
        indexes = [models.Index(fields=["status", "-created_at"])]
