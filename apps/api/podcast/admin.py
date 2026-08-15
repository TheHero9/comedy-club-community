"""Django Admin = the entire moderation backend.

Every list view here is tuned to avoid N+1 queries (list_select_related) and to keep
FK widgets usable at ~1,000 episodes (raw_id_fields / autocomplete_fields).
"""

from django.contrib import admin, messages
from django.db.models import Count
from django.utils import timezone
from django.utils.html import format_html

from .models import (
    Channel,
    ChannelMembership,
    Chapter,
    Comment,
    Episode,
    EpisodeParticipant,
    EpisodeTopic,
    EpisodeTopicVote,
    Favorite,
    Moment,
    Person,
    PersonalTag,
    Rating,
    Report,
    Topic,
    Transcript,
    TranscriptSegment,
    UserProfile,
    WatchEvent,
)

admin.site.site_header = "Comedy Club Community"
admin.site.site_title = "Comedy Club Admin"
admin.site.index_title = "Moderation & content"


# ---------------------------------------------------------------------------
# Channels & episodes
# ---------------------------------------------------------------------------


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    # `display_order` is editable straight from the list so the curated order can
    # be nudged without a deploy. `manage.py set_channel_order` rewrites it.
    list_display = (
        "display_order",
        "name",
        "handle",
        "episode_count",
        "is_active",
        "last_synced_at",
    )
    list_editable = ("display_order",)
    list_display_links = ("name",)
    list_filter = ("is_active",)
    search_fields = ("name", "handle", "youtube_channel_id")
    readonly_fields = ("slug", "created_at", "last_synced_at")
    ordering = ("display_order", "name")

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_episodes=Count("episodes"))

    @admin.display(description="Episodes", ordering="_episodes")
    def episode_count(self, obj):
        return obj._episodes


class ChapterInline(admin.TabularInline):
    model = Chapter
    extra = 0


class EpisodeParticipantInline(admin.TabularInline):
    model = EpisodeParticipant
    extra = 1
    autocomplete_fields = ("person",)


@admin.register(Episode)
class EpisodeAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "channel",
        "upload_date",
        "kind_badge",
        "access_badge",
        "duration_display",
        "public_score",
        "rating_count",
    )
    list_filter = ("channel", "content_kind", "availability", "members_only", "upload_date")
    search_fields = ("title", "description", "youtube_id")
    list_select_related = ("channel",)
    date_hierarchy = "upload_date"
    ordering = ("-upload_date",)
    inlines = [ChapterInline, EpisodeParticipantInline]
    readonly_fields = (
        "youtube_id",
        "slug",
        "thumbnail_preview",
        "public_score",
        "elite_score",
        "rating_count",
        "elite_rating_count",
        "created_at",
        "updated_at",
    )
    fieldsets = (
        ("YouTube", {
            "fields": (
                "channel", "youtube_id", "url", "title", "slug", "description",
                "upload_date", "duration_sec", "thumbnail_url", "thumbnail_preview",
            )
        }),
        ("Classification", {
            "fields": ("content_kind", "availability", "members_only", "language")
        }),
        ("YouTube stats", {
            "fields": ("view_count", "like_count", "yt_comment_count"),
            "description": "view_count is NULL on members-only episodes - YouTube does not report it.",
        }),
        ("Derived scores (cache over Rating - do not edit)", {
            "fields": ("public_score", "elite_score", "rating_count", "elite_rating_count"),
            "classes": ("collapse",),
        }),
        ("Timestamps", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )

    @admin.display(description="Kind", ordering="content_kind")
    def kind_badge(self, obj):
        return obj.get_content_kind_display()

    @admin.display(description="Access", ordering="availability")
    def access_badge(self, obj):
        return obj.get_availability_display()

    @admin.display(description="Duration", ordering="duration_sec")
    def duration_display(self, obj):
        if not obj.duration_sec:
            return "-"
        hours, remainder = divmod(obj.duration_sec, 3600)
        minutes, seconds = divmod(remainder, 60)
        if hours:
            return f"{hours}:{minutes:02d}:{seconds:02d}"
        return f"{minutes}:{seconds:02d}"

    @admin.display(description="Thumbnail")
    def thumbnail_preview(self, obj):
        if not obj.thumbnail_url:
            return "-"
        return format_html(
            '<img src="{}" style="max-height:180px;border-radius:6px" />', obj.thumbnail_url
        )


@admin.register(Chapter)
class ChapterAdmin(admin.ModelAdmin):
    list_display = ("episode", "start_sec", "title")
    search_fields = ("title", "episode__title")
    list_select_related = ("episode",)
    raw_id_fields = ("episode",)


@admin.register(Transcript)
class TranscriptAdmin(admin.ModelAdmin):
    """Read-only. Transcripts are fetched, never authored here.

    ⚠️ No segment inline. One episode is ~150 segments, so an inline would render
    150 textareas per page load.
    """

    list_display = (
        "episode", "status", "source", "track_id",
        "segment_count", "word_count", "coverage", "checked_at",
    )
    list_filter = ("status", "source", "language", "episode__channel")
    search_fields = ("episode__title", "episode__youtube_id")
    list_select_related = ("episode",)
    raw_id_fields = ("episode",)
    readonly_fields = (
        "episode", "status", "source", "language", "track_id",
        "segment_count", "word_count", "covered_sec", "checked_at",
        "created_at", "updated_at",
    )
    ordering = ("-updated_at",)

    @admin.display(description="coverage")
    def coverage(self, obj):
        ratio = obj.coverage_ratio
        if ratio is None:
            return "-"
        # ⚠️ Well under 100% means the caption track stopped early: a partial
        # transcript that otherwise looks complete.
        return format_html(
            '<span style="color:{}">{:.0%}</span>',
            "#b00" if ratio < 0.9 else "inherit",
            ratio,
        )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(TranscriptSegment)
class TranscriptSegmentAdmin(admin.ModelAdmin):
    """Spot-checking one passage. Not a browsing surface - there are ~115k rows."""

    list_display = ("transcript", "start_sec", "end_sec", "preview")
    search_fields = ("text",)
    list_select_related = ("transcript__episode",)
    raw_id_fields = ("transcript",)
    readonly_fields = ("transcript", "start_sec", "end_sec", "text")

    @admin.display(description="text")
    def preview(self, obj):
        return obj.text[:120]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------


@admin.register(Person)
class PersonAdmin(admin.ModelAdmin):
    list_display = ("name", "appearance_count", "user")
    search_fields = ("name", "bio")
    raw_id_fields = ("user",)
    readonly_fields = ("slug",)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_appearances=Count("appearances"))

    @admin.display(description="Appearances", ordering="_appearances")
    def appearance_count(self, obj):
        return obj._appearances


@admin.register(EpisodeParticipant)
class EpisodeParticipantAdmin(admin.ModelAdmin):
    list_display = ("episode", "person", "role")
    list_filter = ("role",)
    search_fields = ("episode__title", "person__name")
    list_select_related = ("episode", "person")
    raw_id_fields = ("episode", "person", "added_by")


# ---------------------------------------------------------------------------
# Users & membership
# ---------------------------------------------------------------------------


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    # `handle` is the user's YouTube handle and is assigned HERE - it is the one
    # field on this model no identity provider can supply.
    list_display = ("__str__", "user", "handle", "role", "clerk_user_id")
    list_filter = ("role",)
    search_fields = (
        "display_name",
        "handle",
        "user__username",
        "user__email",
        "clerk_user_id",
    )
    list_select_related = ("user",)
    raw_id_fields = ("user",)
    readonly_fields = ("created_at",)


@admin.register(ChannelMembership)
class ChannelMembershipAdmin(admin.ModelAdmin):
    """🔒 The verification queue. Screenshots are private proof of a paid membership."""

    list_display = ("user", "channel", "is_verified", "tier", "member_since", "verified_at")
    list_filter = ("is_verified", "channel")
    search_fields = ("user__username", "user__email", "channel__name")
    list_select_related = ("user", "channel")
    raw_id_fields = ("user", "channel", "verified_by")
    readonly_fields = ("verified_at", "verified_by", "created_at", "screenshot_preview")
    actions = ("approve_verification", "revoke_verification")

    @admin.display(description="Screenshot")
    def screenshot_preview(self, obj):
        if not obj.verification_screenshot:
            return "No screenshot uploaded"
        return format_html(
            '<a href="{}" target="_blank"><img src="{}" style="max-height:400px" /></a>',
            obj.verification_screenshot.url,
            obj.verification_screenshot.url,
        )

    @admin.action(description="Approve selected memberships")
    def approve_verification(self, request, queryset):
        pending = list(queryset.filter(is_verified=False).values_list("user_id", "channel_id"))
        updated = queryset.filter(is_verified=False).update(
            is_verified=True, verified_at=timezone.now(), verified_by=request.user
        )
        episodes = self._resync_scores(pending)
        self.message_user(
            request,
            f"Verified {updated} membership(s) and recomputed {episodes} episode "
            f"score(s). Their existing ratings now count toward the elite score - "
            f"no backfill needed.",
            messages.SUCCESS,
        )

    @admin.action(description="Revoke verification")
    def revoke_verification(self, request, queryset):
        verified = list(queryset.filter(is_verified=True).values_list("user_id", "channel_id"))
        updated = queryset.filter(is_verified=True).update(
            is_verified=False, verified_at=None, verified_by=None
        )
        episodes = self._resync_scores(verified)
        self.message_user(
            request,
            f"Revoked {updated} membership(s), recomputed {episodes} episode score(s).",
            messages.WARNING,
        )

    @staticmethod
    def _resync_scores(pairs) -> int:
        """Elite scores are derived from verified membership, so a verification
        change must refresh every episode that user rated on that channel."""
        from podcast.services import scoring

        return sum(
            scoring.recompute_for_membership_change(user_id, channel_id)
            for user_id, channel_id in pairs
        )


# ---------------------------------------------------------------------------
# Personal engagement
# ---------------------------------------------------------------------------


@admin.register(Rating)
class RatingAdmin(admin.ModelAdmin):
    list_display = ("user", "episode", "score", "updated_at")
    list_filter = ("score", "episode__channel")
    search_fields = ("user__username", "episode__title")
    list_select_related = ("user", "episode")
    raw_id_fields = ("user", "episode")


@admin.register(WatchEvent)
class WatchEventAdmin(admin.ModelAdmin):
    list_display = ("user", "episode", "watched_on")
    list_filter = ("watched_on", "episode__channel")
    search_fields = ("user__username", "episode__title")
    list_select_related = ("user", "episode")
    raw_id_fields = ("user", "episode")


@admin.register(Favorite)
class FavoriteAdmin(admin.ModelAdmin):
    list_display = ("user", "episode", "created_at")
    search_fields = ("user__username", "episode__title")
    list_select_related = ("user", "episode")
    raw_id_fields = ("user", "episode")


@admin.register(PersonalTag)
class PersonalTagAdmin(admin.ModelAdmin):
    """🔒 Private to each user. Visible here for moderation only, never via the API."""

    list_display = ("user", "episode", "text")
    search_fields = ("text", "user__username")
    list_select_related = ("user", "episode")
    raw_id_fields = ("user", "episode")


# ---------------------------------------------------------------------------
# Community content
# ---------------------------------------------------------------------------


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("user", "episode", "excerpt", "is_spoiler", "is_hidden", "created_at")
    list_filter = ("is_hidden", "is_spoiler", "created_at", "episode__channel")
    search_fields = ("body", "user__username", "episode__title")
    list_select_related = ("user", "episode")
    raw_id_fields = ("user", "episode")
    actions = ("hide_comments", "unhide_comments")

    @admin.display(description="Comment")
    def excerpt(self, obj):
        return obj.body[:80] + ("..." if len(obj.body) > 80 else "")

    @admin.action(description="Hide selected comments")
    def hide_comments(self, request, queryset):
        self.message_user(request, f"Hid {queryset.update(is_hidden=True)} comment(s).")

    @admin.action(description="Unhide selected comments")
    def unhide_comments(self, request, queryset):
        self.message_user(request, f"Restored {queryset.update(is_hidden=False)} comment(s).")


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "usage_count")
    search_fields = ("name", "slug")
    readonly_fields = ("slug",)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_uses=Count("episodes"))

    @admin.display(description="Episodes", ordering="_uses")
    def usage_count(self, obj):
        return obj._uses


@admin.register(EpisodeTopic)
class EpisodeTopicAdmin(admin.ModelAdmin):
    list_display = ("episode", "topic", "score", "added_by", "created_at")
    list_filter = ("topic", "episode__channel")
    search_fields = ("episode__title", "topic__name")
    list_select_related = ("episode", "topic", "added_by")
    raw_id_fields = ("episode", "topic", "added_by")


@admin.register(EpisodeTopicVote)
class EpisodeTopicVoteAdmin(admin.ModelAdmin):
    list_display = ("episode_topic", "user", "value")
    list_filter = ("value",)
    list_select_related = ("episode_topic", "user")
    raw_id_fields = ("episode_topic", "user")


@admin.register(Moment)
class MomentAdmin(admin.ModelAdmin):
    list_display = ("episode", "timestamp_display", "label", "score", "user")
    list_filter = ("episode__channel",)
    search_fields = ("label", "episode__title")
    list_select_related = ("episode", "user")
    raw_id_fields = ("episode", "user")

    @admin.display(description="At", ordering="timestamp_sec")
    def timestamp_display(self, obj):
        minutes, seconds = divmod(obj.timestamp_sec, 60)
        return f"{minutes}:{seconds:02d}"


# ---------------------------------------------------------------------------
# Moderation
# ---------------------------------------------------------------------------


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ("id", "status", "reason", "target_display", "reporter", "created_at")
    list_filter = ("status", "content_type", "created_at")
    search_fields = ("reason", "resolution_note", "reporter__username")
    list_select_related = ("reporter", "content_type", "resolved_by")
    raw_id_fields = ("reporter", "resolved_by")
    readonly_fields = ("content_type", "object_id", "target_display", "created_at")
    actions = ("mark_resolved", "mark_dismissed")

    @admin.display(description="Target")
    def target_display(self, obj):
        target = obj.target
        return f"{obj.content_type.model}: {target}" if target else "(deleted)"

    @admin.action(description="Mark as resolved")
    def mark_resolved(self, request, queryset):
        updated = queryset.exclude(status=Report.Status.RESOLVED).update(
            status=Report.Status.RESOLVED, resolved_by=request.user, resolved_at=timezone.now()
        )
        self.message_user(request, f"Resolved {updated} report(s).", messages.SUCCESS)

    @admin.action(description="Dismiss")
    def mark_dismissed(self, request, queryset):
        updated = queryset.exclude(status=Report.Status.DISMISSED).update(
            status=Report.Status.DISMISSED, resolved_by=request.user, resolved_at=timezone.now()
        )
        self.message_user(request, f"Dismissed {updated} report(s).", messages.SUCCESS)
