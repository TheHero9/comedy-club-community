"""Reports and leaderboards (wave 13).

The report queue is generic: one model flags a comment, a moment, a topic label or
a rating. Resolution happens here or in Django Admin - both write the same fields.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Query, Router
from ninja.errors import HttpError

from podcast.auth import get_auth
from podcast.auth.permissions import require_admin, require_moderator
from podcast.models import (
    Comment,
    Episode,
    EpisodeTopic,
    Moment,
    Rating,
    Report,
    UserProfile,
)

from .schemas import (
    LeaderboardOut,
    MessageOut,
    ReportIn,
    ReportOut,
    ReportResolveIn,
    UserAdminOut,
    UserRoleIn,
)
from .serializers import episode_brief, episode_list_queryset

router = Router(tags=["moderation"], auth=get_auth())
public_router = Router(tags=["leaderboards"], auth=None)

# Only these may be reported. An open-ended content type would let anyone create
# report rows pointing at arbitrary tables.
REPORTABLE = {
    # 🚨 "This should not be listed" is the crowdsourced version of the manual
    # pass that removed 100 promo clips on 2026-08-15. The next batch of junk
    # gets flagged by whoever finds it instead of by one person scrolling a
    # review page.
    "episode": Episode,
    "comment": Comment,
    "moment": Moment,
    "episodetopic": EpisodeTopic,
    "rating": Rating,
}

# Categories that describe the SITE rather than a row, so they carry no target.
TARGETLESS_CATEGORIES = {Report.Category.BUG, Report.Category.SUGGESTION}


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


@router.post("/reports", response=ReportOut)
def create_report(request, payload: ReportIn):
    """File a report. The target is OPTIONAL - a broken page or a suggestion
    points at nothing, and forcing a target would mean inventing a row."""
    category = payload.category if payload.category in Report.Category.values else (
        Report.Category.OTHER
    )

    if payload.target_type is None:
        # 🚨 The absence of a target is not an open-ended content type. It is a
        # report ABOUT THE SITE, and only these categories may be filed that
        # way - otherwise "wrong participants" with no episode would be a
        # perfectly valid, perfectly useless row.
        if category not in TARGETLESS_CATEGORIES:
            raise HttpError(
                422,
                f"A {category!r} report needs something to point at; only "
                f"{sorted(TARGETLESS_CATEGORIES)} may be filed without a target",
            )
        report = Report.objects.create(
            reporter=request.auth,
            category=category,
            reason=payload.reason.strip(),
        )
        return _report_out(report)  # no target, so no context to resolve

    model = REPORTABLE.get(payload.target_type.lower())
    if model is None:
        raise HttpError(422, f"Cannot report a {payload.target_type!r}")
    if payload.target_id is None:
        raise HttpError(422, "target_id is required when target_type is given")

    if not model.objects.filter(id=payload.target_id).exists():
        raise HttpError(404, "Reported item not found")

    report, created = Report.objects.get_or_create(
        reporter=request.auth,
        content_type=ContentType.objects.get_for_model(model),
        object_id=payload.target_id,
        status=Report.Status.PENDING,
        defaults={"reason": payload.reason.strip(), "category": category},
    )
    if not created:
        raise HttpError(409, "You have already reported this item")

    # Context on a single row too, so a POST response is never a poorer version
    # of the same report than the list that renders next to it.
    return _report_out(report, _target_context([report]))


@router.get("/reports", response=list[ReportOut])
def list_reports(
    request,
    status: str = Query("pending"),
    limit: int = Query(50, ge=1, le=200),
):
    """🔒 Moderators only."""
    require_moderator(request.auth)

    queryset = Report.objects.select_related(
        "content_type",
        # Named in every row of the queue; without these it is one query per
        # report just to print who filed it.
        "reporter",
        "reporter__profile",
        "resolved_by",
        "resolved_by__profile",
    ).order_by("-created_at")
    if status != "all":
        queryset = queryset.filter(status=status)
    reports = list(queryset[:limit])
    context = _target_context(reports)
    return [_report_out(report, context) for report in reports]


@router.post("/reports/{report_id}/resolve", response=ReportOut)
def resolve_report(request, report_id: int, payload: ReportResolveIn):
    """🔒 Moderators only."""
    moderator = require_moderator(request.auth)

    if payload.status not in {Report.Status.RESOLVED, Report.Status.DISMISSED}:
        raise HttpError(422, "Status must be 'resolved' or 'dismissed'")

    report = get_object_or_404(Report.objects.select_related("content_type"), id=report_id)
    report.status = payload.status
    report.resolution_note = payload.resolution_note[:280]
    report.resolved_by = moderator.user
    report.resolved_at = timezone.now()
    report.save(update_fields=["status", "resolution_note", "resolved_by", "resolved_at"])
    return _report_out(report, _target_context([report]))


@router.delete("/reports/{report_id}", response=MessageOut)
def withdraw_report(request, report_id: int):
    deleted, _ = Report.objects.filter(
        id=report_id, reporter=request.auth, status=Report.Status.PENDING
    ).delete()
    if not deleted:
        raise HttpError(404, "Report not found or already handled")
    return {"detail": "Report withdrawn"}


def _report_out(report: Report, context: dict | None = None) -> dict:
    # 🚨 content_type is NULLABLE now (a general "the site is broken" report
    # points at nothing), so it must not be dereferenced blind. This exact line
    # used to read `report.content_type.model` and would have 500'd on the first
    # general report ever filed.
    label, youtube_id = (context or {}).get(
        (report.content_type_id, report.object_id), ("", None)
    )
    reporter = getattr(report.reporter, "profile", None) if report.reporter_id else None
    resolver = getattr(report.resolved_by, "profile", None) if report.resolved_by_id else None
    return {
        "id": report.id,
        "target_type": report.content_type.model if report.content_type_id else None,
        "target_id": report.object_id,
        "category": report.category,
        "reason": report.reason,
        "status": report.status,
        "created_at": report.created_at,
        "resolution_note": report.resolution_note,
        "resolved_at": report.resolved_at,
        "target_label": label,
        "target_youtube_id": youtube_id,
        # ⚠️ The PROFILE name on both. `user.get_username()` is the Clerk `sub`
        # for anyone signed in with Google, and these strings are shown to a
        # moderator and to the reporter respectively.
        "reporter": (reporter.display_name if reporter else None) or None,
        "resolved_by": (resolver.display_name if resolver else None) or None,
    }


# How much of a comment or a reason is enough for a moderator to recognise it
# without the queue turning into a wall of text.
TARGET_LABEL_CHARS = 120


def _target_context(reports: list[Report]) -> dict[tuple[int | None, int | None], tuple[str, str | None]]:
    """Resolve every report's target to `(label, episode youtube id)` in bulk.

    🚨 BULK, not `report.target` per row. A generic FK dereferenced in a loop is
    one query per report, plus another to reach the episode behind a comment or
    a moment - the same N+1 shape that produced a 102-query search fallback on
    this project. This is at most two queries per distinct content type, and the
    queue is capped at 200 rows.

    A missing target resolves to an empty label rather than raising: the row it
    pointed at may since have been deleted, which is frequently the very thing
    the moderator did in response to the report.
    """
    by_type: dict[int, list[int]] = {}
    for report in reports:
        if report.content_type_id and report.object_id:
            by_type.setdefault(report.content_type_id, []).append(report.object_id)

    context: dict[tuple[int | None, int | None], tuple[str, str | None]] = {}
    for content_type_id, object_ids in by_type.items():
        model = ContentType.objects.get_for_id(content_type_id).model_class()
        if model is None:
            continue

        # Every reportable model either IS an episode or points at one, so the
        # link a moderator needs is always reachable in a single select_related.
        related = () if model is Episode else ("episode",)
        rows = model.objects.filter(id__in=object_ids)
        if related:
            rows = rows.select_related(*related)

        for row in rows:
            episode = row if model is Episode else getattr(row, "episode", None)
            context[(content_type_id, row.id)] = (
                _label_for(row, model)[:TARGET_LABEL_CHARS],
                getattr(episode, "youtube_id", None),
            )
    return context


def _label_for(row, model) -> str:
    """The one line that tells a moderator what they are looking at."""
    if model is Episode:
        return row.title
    if model is Comment:
        return row.body
    if model is Moment:
        return row.label
    if model is EpisodeTopic:
        # The topic is the point; the episode is already carried separately.
        return getattr(row.topic, "name", "") if row.topic_id else ""
    if model is Rating:
        return str(row.score)
    return ""


@router.get("/me/reports", response=list[ReportOut])
def list_my_reports(request, limit: int = Query(50, ge=1, le=200)):
    """Your own reports, with what a moderator decided and why.

    🔁 THIS IS THE FEEDBACK LOOP. `resolution_note` has existed on the model
    since wave 13 and had no reader, so a member filed a report and never
    learned anything. A moderator writes one line; the reporter sees it here.

    🔒 Filters on `request.auth`. It never accepts a user id from the client -
    that would let anyone read anyone's reports.
    """
    queryset = (
        Report.objects.filter(reporter=request.auth)
        .select_related(
            "content_type", "reporter", "reporter__profile", "resolved_by", "resolved_by__profile"
        )
        .order_by("-created_at")
    )
    reports = list(queryset[:limit])
    context = _target_context(reports)
    return [_report_out(report, context) for report in reports]


# ---------------------------------------------------------------------------
# Leaderboards (public)
# ---------------------------------------------------------------------------

LEADERBOARDS = {
    "top_rated": ("public_score", "Highest public score"),
    "top_elite": ("elite_score", "Highest elite score"),
    "most_rated": ("rating_count", "Most ratings"),
    "most_watched": ("_watch_count", "Most watched"),
    "most_commented": ("_comment_count", "Most commented"),
}

# An episode with two 10s is not "the best episode". Require a floor so the board
# reflects consensus rather than a single enthusiastic rater.
MIN_RATINGS_FOR_SCORE_BOARD = 3


@public_router.get("/leaderboards/{kind}", response=LeaderboardOut)
def get_leaderboard(
    request,
    kind: str,
    channel: str | None = Query(None, description="Channel slug"),
    limit: int = Query(20, ge=1, le=100),
):
    if kind not in LEADERBOARDS:
        raise HttpError(404, f"Unknown leaderboard {kind!r}")

    field, _label = LEADERBOARDS[kind]
    queryset = episode_list_queryset()
    if channel:
        queryset = queryset.filter(channel__slug=channel)

    if kind in {"top_rated", "top_elite"}:
        queryset = queryset.filter(**{f"{field}__isnull": False})
        count_field = "elite_rating_count" if kind == "top_elite" else "rating_count"
        queryset = queryset.filter(**{f"{count_field}__gte": MIN_RATINGS_FOR_SCORE_BOARD})
    elif kind == "most_watched":
        queryset = queryset.annotate(
            _watch_count=Count("watch_events__user", distinct=True)
        ).filter(_watch_count__gt=0)
    elif kind == "most_commented":
        queryset = queryset.annotate(
            _comment_count=Count("comments", filter=Q(comments__is_hidden=False))
        ).filter(_comment_count__gt=0)
    else:
        queryset = queryset.filter(**{f"{field}__gt": 0})

    queryset = queryset.order_by(F(field).desc(nulls_last=True), "-id")[:limit]

    return {
        "kind": kind,
        "items": [
            {
                "episode": episode_brief(episode),
                "value": _leaderboard_value(episode, field),
                "rank": index,
            }
            for index, episode in enumerate(queryset, start=1)
        ],
    }


def _leaderboard_value(episode: Episode, field: str) -> float | None:
    value = getattr(episode, field, None)
    return float(value) if value is not None else None


# ---------------------------------------------------------------------------
# Roles (spec 14) - granting moderator, without Django Admin
# ---------------------------------------------------------------------------


@router.get("/moderation/users", response=list[UserAdminOut])
def list_users(
    request,
    q: str = Query(""),
    limit: int = Query(50, ge=1, le=200),
):
    """🔒 ADMINS ONLY - not moderators.

    A moderator being able to see and change roles would let them promote
    themselves to admin, which makes the distinction between the two roles
    decorative. Only an admin grants permissions.
    """
    actor = require_admin(request.auth)

    User = get_user_model()
    queryset = User.objects.select_related("profile").order_by("-date_joined")
    if q.strip():
        term = q.strip()
        queryset = queryset.filter(
            Q(username__icontains=term)
            | Q(profile__display_name__icontains=term)
            | Q(profile__handle__icontains=term)
        )

    return [
        _user_admin_out(user, user.profile, actor)
        for user in queryset[:limit]
        if getattr(user, "profile", None) is not None
    ]


@router.patch("/moderation/users/{user_id}", response=UserAdminOut)
def set_user_role(request, user_id: int, payload: UserRoleIn):
    """🔒 ADMINS ONLY. Promote to moderator/admin, or demote to member.

    🚨 AN ADMIN CANNOT CHANGE THEIR OWN ROLE. Not a nicety - it is the only
    thing standing between a mis-click and a site with no administrator at all,
    which is unrecoverable from the app and would need a shell on production to
    fix. Demoting someone else is fine; there is always you left.
    """
    actor = require_admin(request.auth)

    if payload.role not in UserProfile.Role.values:
        raise HttpError(422, f"Role must be one of {sorted(UserProfile.Role.values)}")

    User = get_user_model()
    user = get_object_or_404(User.objects.select_related("profile"), id=user_id)

    if user.id == actor.user_id:
        raise HttpError(
            409,
            "You cannot change your own role. Ask another admin, so the site "
            "can never be left without one.",
        )

    profile = getattr(user, "profile", None)
    if profile is None:
        raise HttpError(404, "That account has no profile yet")

    profile.role = payload.role
    profile.save(update_fields=["role"])

    # 🔒 Django's admin site is a SEPARATE switch from UserProfile.role: the
    # role governs this API, is_staff/is_superuser govern /admin/. Keeping them
    # in step here means "admin" means one thing rather than two.
    user.is_staff = payload.role == UserProfile.Role.ADMIN
    user.is_superuser = payload.role == UserProfile.Role.ADMIN
    user.save(update_fields=["is_staff", "is_superuser"])

    return _user_admin_out(user, profile, actor)


def _user_admin_out(user, profile, actor) -> dict:
    return {
        "id": user.id,
        "username": user.get_username(),
        "display_name": getattr(profile, "display_name", "") or "",
        "handle": getattr(profile, "handle", None),
        "role": getattr(profile, "role", UserProfile.Role.MEMBER),
        "date_joined": user.date_joined,
        "is_me": user.id == actor.user_id,
        "is_active": bool(user.is_active),
    }


@router.post("/moderation/users/{user_id}/suspend", response=UserAdminOut)
def suspend_user(request, user_id: int):
    """🔒 ADMINS ONLY. Stop an account from acting, without destroying anything.

    🚨 THIS IS THE ONLY WAY TO STOP A BAD ACTOR, and until 2026-08-16 there was
    none. Moderators could hide a comment but could not stop the person writing
    the next one, and deleting the account in Clerk did nothing here - Django
    keeps its own row, and a session token that has not expired keeps working
    against it. Suspension is enforced in the auth backend, so it applies to
    every endpoint at once rather than per-route.

    ⚠️ Content SURVIVES. Same principle as hiding a comment rather than deleting
    it: the record is what a moderator needs later. Use the report queue to take
    down individual rows.

    🚨 Admin-only, not moderator - the same reasoning as role granting. A
    moderator who could suspend accounts could suspend the admins.
    """
    actor = require_admin(request.auth)
    user, profile = _target_account(user_id)

    # 🚨 The same self-lockout guard `set_user_role` carries, for a worse
    # outcome: suspending yourself revokes your own token on the NEXT request,
    # so there is no undo from inside the app at all.
    if user.id == actor.user_id:
        raise HttpError(
            409,
            "You cannot suspend your own account. Ask another admin, so the "
            "site can never be left without one.",
        )

    if user.is_active:
        user.is_active = False
        user.save(update_fields=["is_active"])
    return _user_admin_out(user, profile, actor)


@router.post("/moderation/users/{user_id}/restore", response=UserAdminOut)
def restore_user(request, user_id: int):
    """🔒 ADMINS ONLY. Lift a suspension.

    Their existing ratings start counting again immediately, exactly as a
    verified membership promotes existing ratings - nothing was deleted, so
    nothing has to be rebuilt.
    """
    actor = require_admin(request.auth)
    user, profile = _target_account(user_id)

    if not user.is_active:
        user.is_active = True
        user.save(update_fields=["is_active"])
    return _user_admin_out(user, profile, actor)


def _target_account(user_id: int):
    User = get_user_model()
    user = get_object_or_404(User.objects.select_related("profile"), id=user_id)
    profile = getattr(user, "profile", None)
    if profile is None:
        raise HttpError(404, "That account has no profile yet")
    return user, profile
