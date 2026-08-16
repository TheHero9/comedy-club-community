"""Reports and leaderboards (wave 13).

The report queue is generic: one model flags a comment, a moment, a topic label or
a rating. Resolution happens here or in Django Admin - both write the same fields.
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Query, Router
from ninja.errors import HttpError

from podcast.auth import get_auth
from podcast.auth.permissions import require_moderator
from podcast.models import Comment, Episode, EpisodeTopic, Moment, Rating, Report

from .schemas import (
    LeaderboardOut,
    MessageOut,
    ReportIn,
    ReportOut,
    ReportResolveIn,
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
        return _report_out(report)

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

    return _report_out(report)


@router.get("/reports", response=list[ReportOut])
def list_reports(
    request,
    status: str = Query("pending"),
    limit: int = Query(50, ge=1, le=200),
):
    """🔒 Moderators only."""
    require_moderator(request.auth)

    queryset = Report.objects.select_related("content_type").order_by("-created_at")
    if status != "all":
        queryset = queryset.filter(status=status)
    return [_report_out(report) for report in queryset[:limit]]


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
    return _report_out(report)


@router.delete("/reports/{report_id}", response=MessageOut)
def withdraw_report(request, report_id: int):
    deleted, _ = Report.objects.filter(
        id=report_id, reporter=request.auth, status=Report.Status.PENDING
    ).delete()
    if not deleted:
        raise HttpError(404, "Report not found or already handled")
    return {"detail": "Report withdrawn"}


def _report_out(report: Report) -> dict:
    # 🚨 content_type is NULLABLE now (a general "the site is broken" report
    # points at nothing), so it must not be dereferenced blind. This exact line
    # used to read `report.content_type.model` and would have 500'd on the first
    # general report ever filed.
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
    }


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
        .select_related("content_type")
        .order_by("-created_at")
    )
    return [_report_out(report) for report in queryset[:limit]]


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
