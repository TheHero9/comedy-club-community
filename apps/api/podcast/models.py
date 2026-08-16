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

    # --- Deviation 12: curated channel order ---------------------------------
    # 🚨 Editorial, NOT derived. The owner's order is not episode count and not
    # alphabetical - Comedy Club Podcast leads because it is the flagship, and
    # Sport trails because it is barely active. Any computed ordering would keep
    # drifting away from that intent as the corpus grows, so it is stored.
    # Lower sorts first. New channels default to 100, i.e. after everything
    # curated, and are then placed by `manage.py set_channel_order`.
    display_order = models.PositiveIntegerField(
        default=100,
        db_index=True,
        help_text="Lower sorts first. Set by `manage.py set_channel_order`.",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # 🚨 `name` is the TIEBREAK, not the sort. Every channel list in the app
        # inherits this, so a list that wants a different order must say so.
        ordering = ["display_order", "name"]

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


class Transcript(models.Model):
    """One episode's transcript, or a record that it has none.

    🚨 A row with `status=UNAVAILABLE` is DATA, not an absence. Without it the
    backfill would re-fetch every caption-less episode on every run, and the
    catalogue is majority caption-less. `checked_at` is what makes a re-check
    deliberate rather than accidental - YouTube does add captions to older
    videos over time, so "none" is true on a date, not forever.

    ⚠️ NEVER write UNAVAILABLE from a degraded response. A soft-block strips the
    caption list the same way it strips `duration`, so absence only counts when
    the response was complete. `ingestion/transcripts.py` enforces this by
    raising `TranscriptThrottled` instead of returning "none".

    The `source` field is the upgrade path: re-transcribing an episode with
    Whisper later replaces the segments and flips `source`, with no schema
    change and nothing to migrate. One transcript per episode - the current best
    one - rather than a history, because nothing reads an older tier.
    """

    class Status(models.TextChoices):
        OK = "ok", "Transcript stored"
        UNAVAILABLE = "unavailable", "No captions published"

    class Source(models.TextChoices):
        # 🇧🇬 Free, from YouTube's own Bulgarian ASR. Lowercase, unpunctuated,
        # good enough to search, not good enough to read.
        YOUTUBE_AUTO = "youtube_auto", "YouTube auto-captions"
        YOUTUBE_MANUAL = "youtube_manual", "Creator-uploaded captions"
        WHISPER = "whisper", "Whisper"
        SCRIBE = "scribe", "ElevenLabs Scribe"

    episode = models.OneToOneField(Episode, on_delete=models.CASCADE, related_name="transcript")
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.OK, db_index=True
    )
    source = models.CharField(max_length=32, choices=Source.choices, blank=True)
    language = models.CharField(max_length=8, blank=True)  # e.g. "bg"
    track_id = models.CharField(
        max_length=32, blank=True, help_text='YouTube caption track, e.g. "bg-orig".'
    )

    # Denormalized counts so the admin and the API never aggregate over segments.
    segment_count = models.PositiveIntegerField(default=0)
    word_count = models.PositiveIntegerField(default=0)
    covered_sec = models.PositiveIntegerField(
        default=0, help_text="End of the last segment. Compare with Episode.duration_sec."
    )

    checked_at = models.DateTimeField(
        null=True, blank=True, help_text="Last COMPLETE fetch attempt. Never set from a throttled one."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            # The backfill queryset: "which episodes still need checking, and
            # which unavailable ones are stale enough to re-check".
            models.Index(fields=["status", "checked_at"]),
        ]

    def __str__(self):
        if self.status == self.Status.UNAVAILABLE:
            return f"{self.episode_id}: no captions"
        return f"{self.episode_id}: {self.segment_count} segments ({self.source})"

    @property
    def is_usable(self) -> bool:
        return self.status == self.Status.OK and self.segment_count > 0

    @property
    def coverage_ratio(self) -> float | None:
        """Fraction of the episode the transcript spans.

        ⚠️ A value well under 1.0 means the caption track stopped early, which is
        a partial transcript masquerading as a complete one.
        """
        duration = self.episode.duration_sec
        if not duration or not self.covered_sec:
            return None
        return min(self.covered_sec / duration, 1.0)


class TranscriptSegment(models.Model):
    """A windowed slice of a transcript. The unit that gets searched.

    🚨 Segments exist because a raw caption cue (~2s, ~7 words) is too granular
    to be a search result - a phrase spanning two cues would match neither.
    ~60s windows trade timestamp precision for recall, and `start_sec` is still
    an exact deep link into the video.

    ⚠️ NEVER add this text to the `episodes` Meilisearch document. A 26,000-word
    field next to a 60-character title makes every episode match almost every
    common Bulgarian word, and a passing mention would outrank an episode
    actually about the subject. It gets its own index - see
    podcast/search/transcript_index.py.
    """

    transcript = models.ForeignKey(
        Transcript, on_delete=models.CASCADE, related_name="segments"
    )
    start_sec = models.PositiveIntegerField()
    end_sec = models.PositiveIntegerField()
    text = models.TextField()

    class Meta:
        ordering = ["start_sec"]
        constraints = [
            models.UniqueConstraint(
                fields=["transcript", "start_sec"], name="uniq_segment_start_per_transcript"
            )
        ]

    def __str__(self):
        minutes, seconds = divmod(self.start_sec, 60)
        return f"{minutes}:{seconds:02d} - {self.text[:50]}"

    @property
    def deep_link(self) -> str:
        return (
            f"https://www.youtube.com/watch?v={self.transcript.episode.youtube_id}"
            f"&t={self.start_sec}"
        )


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
        # A recurring member of the show who is NOT a guest. Owner's words:
        # "for the people that participate that are part of the community - we
        # won't allow for guests". Calling a regular a guest every episode is
        # wrong in the one place the label is supposed to carry meaning.
        REGULAR = "regular", "Regular"
        GUEST = "guest", "Guest"
        # The voice off-camera: heard, never seen. Distinct from PRODUCER,
        # which is a job rather than a presence in the episode.
        OFFCAMERA = "offcamera", "Off-camera"
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


class ParticipantProposal(models.Model):
    """A member's suggestion that someone took part in an episode.

    🚨 SEPARATE FROM `EpisodeParticipant` ON PURPOSE - see specs/14 §Design.
    The obvious shortcut is a `status` column on EpisodeParticipant, but that
    model is already read by the episode serializer, the `?person=` filter, the
    person detail endpoint, the Postgres search fallback and the Meilisearch
    document builder. A status column means every one of those must learn to
    filter it, and the one that gets forgotten silently publishes unverified
    data into SEARCH, where it is least visible. Same principle as the NUL-byte
    middleware and the API-wide throttle: a new reader must not be able to leak
    by omission. With a separate table, a pending proposal is structurally
    incapable of reaching any of them, and EpisodeParticipant keeps its exact
    current meaning - a confirmed participant.

    🚨 A PROPOSAL NEVER CREATES A `Person` (owner ruling, 2026-08-16). Personas
    are admin-curated; a member either picks an existing one or types a name,
    and a moderator maps that text onto the right persona - creating it by hand
    first if it is genuinely new. Free-text personas would be catastrophic here:
    the auto-captions mishear `Тонката` as `Донката`, and the same person is
    also `Тони`, so user input would split one filmography across three pages
    and permanently pollute the `participant_slugs` facet.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    episode = models.ForeignKey(
        Episode, on_delete=models.CASCADE, related_name="participant_proposals"
    )
    # Set when the member picked an existing persona from autocomplete. NULL
    # when they typed a name instead - that is what `proposed_name` carries.
    person = models.ForeignKey(
        Person, on_delete=models.CASCADE, null=True, blank=True, related_name="proposals"
    )
    proposed_name = models.CharField(
        max_length=200,
        blank=True,
        help_text="Free text typed by the member when no persona matched.",
    )
    role = models.CharField(
        max_length=20,
        choices=EpisodeParticipant.Role.choices,
        default=EpisodeParticipant.Role.GUEST,
    )

    proposed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="participant_proposals"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    verified_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="participant_proposals_reviewed",
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(
        max_length=280,
        blank=True,
        help_text="Why it was rejected, or which persona a typed name was mapped to.",
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # A proposal that names nobody cannot be reviewed, so it must not
            # exist. Enforced in the DB, not just in the serializer - the same
            # rule the rest of this schema follows.
            models.CheckConstraint(
                condition=~models.Q(person__isnull=True, proposed_name=""),
                name="proposal_names_someone",
            ),
            # One pending suggestion per person per episode per member. Scoped
            # to PENDING deliberately: a rejected proposal must not block the
            # same member from proposing again once something changes.
            models.UniqueConstraint(
                fields=["episode", "person", "proposed_by"],
                condition=models.Q(status="pending"),
                name="uniq_pending_proposal_per_user",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["episode", "status"]),
        ]

    def __str__(self):
        who = self.person.name if self.person else (self.proposed_name or "?")
        return f"[{self.get_status_display()}] {who} in {self.episode.youtube_id}"

    @property
    def display_name(self) -> str:
        """What to show for this proposal, whichever way it was made."""
        return self.person.name if self.person else self.proposed_name


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

    # --- Deviation 13: the public handle -------------------------------------
    # 🚨 This is NOT the Django username, which for a Clerk-provisioned account
    # IS the `sub` - rendering that here is what put the same `user_33Kq...`
    # string on the profile page twice.
    #
    # ⚠️ Ownership changed on 2026-08-15. It was originally "the YouTube handle,
    # assigned by us" so a membership could be linked to a real subscriber. The
    # owner overruled that: "users can and will edit it, it's their name
    # basically". So it is now a self-chosen nickname and CANNOT be treated as
    # proof of a YouTube identity - if that linkage is ever wanted, it needs a
    # separate verified field, not this one.
    #
    # NULL until the user picks one, and the UI renders nothing rather than
    # inventing a value. NULL rather than "" so the unique constraint keeps
    # allowing many users without a handle.
    handle = models.CharField(
        max_length=30,
        blank=True,
        null=True,
        unique=True,
        db_index=True,
        help_text="Self-chosen public nickname, e.g. @someone. Not verified.",
    )

    avatar_url = models.URLField(blank=True)

    # --- Deviation 15: the chosen profile icon -------------------------------
    # 🚨 A KEY, not a URL, and the distinction is the whole design. Icons are
    # unlocked by how long someone has been a member of a given channel, so the
    # thing worth storing is WHICH icon they picked; where its image lives, what
    # it is called, and what it costs to unlock are catalogue data that must be
    # editable without a migration or a backfill. See podcast/data/avatar_icons.py.
    #
    # ⚠️ An unknown key resolves to nothing rather than 404ing a profile - a
    # retired icon must degrade to the default avatar, never break the page.
    # Likewise a key whose unlock condition the user no longer meets: the API
    # reports it as locked and the UI falls back, but the choice is not erased,
    # because a lapsed membership renewed next month should restore the icon
    # rather than having silently thrown it away.
    avatar_key = models.CharField(
        max_length=64,
        blank=True,
        help_text="Key into the avatar-icon catalogue. Not a URL.",
    )

    bio = models.TextField(blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.display_name or self.user.get_username()

    @property
    def is_staff_role(self) -> bool:
        return self.role in {self.Role.MODERATOR, self.Role.ADMIN}


class ChannelMembership(models.Model):
    """A user's membership of a channel, self-reported and optionally verified.

    🚨 THE MONTH COUNT IS NOT A COLUMN. Users tell us "70 months, renews on the
    6th"; `podcast/services/memberships.py` turns that into `member_since` +
    `renewal_day`, and the count is computed on every read. Storing 70 would be
    wrong the next morning and would need a nightly job to stay honest - a job
    whose failure or double-run would corrupt the value silently. See
    docs/02-schema-decisions.md, deviation 14.

    🚨 A row here is a CLAIM, not proof. `is_verified` is the only thing that
    feeds the elite score, and it is set by an admin. A self-added membership
    shows the badge and unlocks profile icons; it does not vote. (Owner ruling,
    2026-08-16: "for now badges, the elite will be added as a condition later.")

    🔒 verification_screenshot is PRIVATE. It is proof of a paid membership from a
    real person: admin-only, served via short-lived signed URLs, never a public URL.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="channel_memberships")
    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name="memberships")
    member_since = models.DateField(null=True, blank=True)  # derived join date

    # --- Deviation 14: the renewal anchor -----------------------------------
    # ⚠️ Stored SEPARATELY from member_since.day, and the difference only shows
    # on the calendar's edges: a membership renewing on the 31st has a
    # member_since clamped to the 30th in a 30-day month, so deriving the day
    # back from it would move the renewal to the 30th permanently. The user said
    # 31, so 31 is kept. NULL on rows that predate this field.
    renewal_day = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(31)],
        help_text="Day of the month the membership renews (1-31).",
    )

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
    # 🚨 NULLABLE since 2026-08-16 (owner ruling: "for some things we don't
    # want to have a timestamp, it should be optional"). A moment without one
    # is a NOTE ABOUT THE EPISODE rather than a point inside it - still
    # searchable text, just not a deep link.
    #
    # NULL is the right shape and 0 is not: 0 is a real timestamp meaning "the
    # very start", so reusing it would make every note deep-link to 0:00 and
    # would be impossible to tell apart from a genuine cold-open label.
    timestamp_sec = models.PositiveIntegerField(null=True, blank=True)
    label = models.CharField(max_length=200)
    score = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # ⚠️ Postgres sorts ASC as NULLS LAST, which is exactly what we want:
        # timestamped moments in episode order, notes after them. Stated here
        # because it is load-bearing, not incidental - flipping to DESC or
        # adding `nulls_first` would scatter notes through the timeline.
        ordering = ["timestamp_sec"]
        indexes = [models.Index(fields=["episode", "timestamp_sec"])]

    def __str__(self):
        if self.timestamp_sec is None:
            return f"(no time) - {self.label}"
        minutes, seconds = divmod(self.timestamp_sec, 60)
        return f"{minutes}:{seconds:02d} - {self.label}"

    @property
    def deep_link(self) -> str | None:
        """The YouTube deep link, or None for a moment with no timestamp.

        🚨 Returns None rather than the plain episode URL. A link that silently
        drops the `&t=` looks like a working deep link and lands at 0:00, which
        is worse than offering no link at all.
        """
        if self.timestamp_sec is None:
            return None
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

    class Category(models.TextChoices):
        WRONG_PARTICIPANTS = "wrong_participants", "Wrong participants"
        WRONG_INFO = "wrong_info", "Wrong information"
        NOT_AN_EPISODE = "not_an_episode", "Not an episode"
        BUG = "bug", "Something is broken"
        SUGGESTION = "suggestion", "Suggestion"
        OTHER = "other", "Other"

    reporter = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, related_name="reports_made"
    )
    reason = models.CharField(max_length=280)
    category = models.CharField(
        max_length=32, choices=Category.choices, default=Category.OTHER, db_index=True
    )

    # 🚨 NULLABLE so a general report can point at nothing. "The site is broken"
    # and "this suggestion" have no target, and forcing one would mean inventing
    # a fake row to attach them to. The REPORTABLE allow-list in
    # podcast/api/moderation.py still governs what a target MAY be - a null
    # target is not an open-ended content type, it is the absence of one.
    content_type = models.ForeignKey(
        ContentType, on_delete=models.CASCADE, null=True, blank=True
    )
    object_id = models.PositiveIntegerField(null=True, blank=True)
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
