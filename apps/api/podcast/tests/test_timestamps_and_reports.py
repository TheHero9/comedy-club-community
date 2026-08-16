"""The moment timestamp grammar, and the reporting feedback loop."""

import pytest

from podcast.models import Moment
from podcast.services.timestamps import (
    TimestampError,
    format_timestamp,
    parse_timestamp,
    resolve_timestamp,
)

pytestmark = pytest.mark.django_db


class TestTimestampGrammar:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("1:30:29", 5429),
            ("30:29", 1829),
            ("4:05", 245),
            ("45", 45),
            ("0:00", 0),
            ("90:00", 5400),  # a leading part MAY exceed 60 - 90 minutes
            ("  2:03  ", 123),
        ],
    )
    def test_accepted_shapes(self, text, expected):
        assert parse_timestamp(text) == expected

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "   ",
            "abc",
            "1:2:3:4",       # more than hours:minutes:seconds
            "4:75",          # 75 seconds is a typo, not 5:15
            "1:99:00",
            "-5",
            "1.5",
            "５",             # full-width digit: int() would accept it, we must not
            "1:-2",
        ],
    )
    def test_rejected_shapes(self, text):
        with pytest.raises(TimestampError):
            parse_timestamp(text)

    def test_seventy_five_seconds_is_not_silently_reinterpreted(self):
        """🚨 The reason the 60 rule is strict: silently reading "4:75" as 5:15
        would store a second the member never meant and deep-link the video to
        the wrong place."""
        with pytest.raises(TimestampError):
            parse_timestamp("4:75")

    def test_round_trips(self):
        for seconds in (0, 45, 245, 1829, 5429):
            assert parse_timestamp(format_timestamp(seconds)) == seconds

    def test_the_typed_string_wins_over_a_client_computed_number(self):
        """The client is not an authority on its own input."""
        assert resolve_timestamp(timestamp="1:00", timestamp_sec=999) == 60

    def test_falls_back_to_seconds_when_no_string_is_sent(self):
        assert resolve_timestamp(timestamp=None, timestamp_sec=42) == 42

    def test_neither_is_an_error(self):
        """The DEFAULT stays strict, so a caller that has not thought about the
        absent case keeps the old behaviour rather than silently accepting it."""
        with pytest.raises(TimestampError):
            resolve_timestamp(timestamp=None, timestamp_sec=None)

    def test_neither_is_allowed_only_when_the_caller_opts_in(self):
        assert resolve_timestamp(timestamp=None, timestamp_sec=None, required=False) is None
        assert resolve_timestamp(timestamp="", timestamp_sec=None, required=False) is None
        assert resolve_timestamp(timestamp="   ", timestamp_sec=None, required=False) is None

    def test_optional_does_not_mean_forgiving(self):
        """🚨 Blank is a decision; malformed is a typo. `required=False` must
        not turn "4:75" into "no timestamp" - that would store a note where the
        member meant a point in the episode, and lose their input silently."""
        for text in ("4:75", "abc", "1:2:3:4", "-5"):
            with pytest.raises(TimestampError):
                resolve_timestamp(timestamp=text, timestamp_sec=None, required=False)


class TestMomentApi:
    def test_a_moment_can_be_logged_with_a_typed_timestamp(
        self, client, episode, alice, as_alice
    ):
        response = client.post(
            f"/api/episodes/{episode.youtube_id}/moments",
            # Within the fixture episode's 3935s. The hours form is the point.
            data={"timestamp": "1:00:29", "label": "Историята за билета"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200, response.content
        body = response.json()
        assert body["timestamp_sec"] == 3629
        assert body["is_mine"] is True

    def test_a_malformed_timestamp_is_a_422_not_a_500(self, client, episode, alice, as_alice):
        response = client.post(
            f"/api/episodes/{episode.youtube_id}/moments",
            data={"timestamp": "4:75", "label": "nope"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 422

    def test_a_moment_can_be_logged_with_no_timestamp_at_all(
        self, client, episode, alice, as_alice
    ):
        """A note about the episode rather than a point inside it."""
        response = client.post(
            f"/api/episodes/{episode.youtube_id}/moments",
            data={"label": "Целият епизод е за храна"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200, response.content
        assert response.json()["timestamp_sec"] is None

    def test_an_empty_timestamp_string_is_the_same_as_omitting_it(
        self, client, episode, alice, as_alice
    ):
        """The web form sends "" for an untouched field, not `undefined`."""
        response = client.post(
            f"/api/episodes/{episode.youtube_id}/moments",
            data={"timestamp": "", "label": "бележка"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200, response.content
        assert response.json()["timestamp_sec"] is None

    def test_timestampless_moments_sort_after_the_timeline(
        self, client, episode, alice, as_alice
    ):
        """🚨 Postgres' ASC default is NULLS LAST and the endpoint states it
        explicitly. If notes sorted first they would interleave with the
        timeline the client renders above them."""
        for payload in (
            {"label": "бележка"},
            {"timestamp": "10:00", "label": "късно"},
            {"timestamp": "1:00", "label": "рано"},
        ):
            assert (
                client.post(
                    f"/api/episodes/{episode.youtube_id}/moments",
                    data=payload,
                    content_type="application/json",
                    **as_alice,
                ).status_code
                == 200
            )

        listed = client.get(f"/api/episodes/{episode.youtube_id}/moments").json()
        assert [row["timestamp_sec"] for row in listed] == [60, 600, None]

    def test_a_moment_with_no_timestamp_has_no_deep_link(self, episode, alice):
        """🚨 None, never the bare episode URL. A link that quietly drops `&t=`
        looks like a working deep link and lands at 0:00."""
        note = Moment.objects.create(episode=episode, user=alice, label="бележка")
        assert note.deep_link is None
        assert "(no time)" in str(note)

    def test_a_timestamp_past_the_end_is_refused(self, client, episode, alice, as_alice):
        assert episode.duration_sec, "fixture needs a duration for this to mean anything"
        response = client.post(
            f"/api/episodes/{episode.youtube_id}/moments",
            data={"timestamp": "99:00:00", "label": "way past the end"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 422

    def test_which_moments_are_mine_comes_from_the_viewer_state(
        self, client, episode, alice, as_alice, bob, as_bob
    ):
        """🔒 Not from the public list, which is cached and has no actor."""
        mine = client.post(
            f"/api/episodes/{episode.youtube_id}/moments",
            data={"timestamp": "1:00", "label": "mine"},
            content_type="application/json",
            **as_alice,
        ).json()
        client.post(
            f"/api/episodes/{episode.youtube_id}/moments",
            data={"timestamp": "2:00", "label": "theirs"},
            content_type="application/json",
            **as_bob,
        )

        state = client.get(f"/api/episodes/{episode.youtube_id}/me", **as_alice).json()
        assert state["my_moment_ids"] == [mine["id"]]


class TestReporting:
    def test_an_episode_can_be_reported_as_not_an_episode(
        self, client, episode, alice, as_alice
    ):
        """The crowdsourced version of the manual 100-clip purge."""
        response = client.post(
            "/api/reports",
            data={
                "target_type": "episode",
                "target_id": episode.id,
                "category": "not_an_episode",
                "reason": "This is a promo clip",
            },
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200, response.content
        assert response.json()["category"] == "not_an_episode"

    def test_a_general_report_needs_no_target(self, client, alice, as_alice):
        response = client.post(
            "/api/reports",
            data={"category": "bug", "reason": "Search is broken on mobile"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200, response.content
        body = response.json()
        assert body["target_type"] is None
        assert body["target_id"] is None

    def test_a_targetless_report_in_a_target_category_is_refused(self, client, alice, as_alice):
        """"Wrong participants" with no episode would be valid and useless."""
        response = client.post(
            "/api/reports",
            data={"category": "wrong_participants", "reason": "someone is missing"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 422

    def test_listing_a_general_report_does_not_500(self, client, alice, as_alice):
        """🚨 Regression: `_report_out` used to dereference
        `report.content_type.model` unconditionally, which raises on a null
        content_type - so the first general report ever filed would have taken
        the whole list down."""
        client.post(
            "/api/reports",
            data={"category": "bug", "reason": "something broke"},
            content_type="application/json",
            **as_alice,
        )
        response = client.get("/api/me/reports", **as_alice)
        assert response.status_code == 200, response.content
        assert response.json()[0]["target_type"] is None

    def test_a_reporter_sees_the_resolution_note(
        self, client, episode, alice, as_alice, moderator, as_moderator
    ):
        """🔁 The feedback loop. `resolution_note` has existed since wave 13 and
        had no reader until now."""
        report = client.post(
            "/api/reports",
            data={
                "target_type": "episode",
                "target_id": episode.id,
                "category": "wrong_info",
                "reason": "The date is wrong",
            },
            content_type="application/json",
            **as_alice,
        ).json()

        client.post(
            f"/api/reports/{report['id']}/resolve",
            data={"status": "resolved", "resolution_note": "Fixed, date corrected"},
            content_type="application/json",
            **as_moderator,
        )

        mine = client.get("/api/me/reports", **as_alice).json()
        assert mine[0]["status"] == "resolved"
        assert mine[0]["resolution_note"] == "Fixed, date corrected"
        assert mine[0]["resolved_at"] is not None

    def test_my_reports_shows_only_my_own(
        self, client, episode, alice, as_alice, bob, as_bob
    ):
        """🔒 Filtered on request.auth, never on a client-supplied id."""
        client.post(
            "/api/reports",
            data={"category": "bug", "reason": "alice's report"},
            content_type="application/json",
            **as_alice,
        )
        client.post(
            "/api/reports",
            data={"category": "bug", "reason": "bob's report"},
            content_type="application/json",
            **as_bob,
        )

        mine = client.get("/api/me/reports", **as_alice).json()
        assert [row["reason"] for row in mine] == ["alice's report"]

    def test_an_unknown_target_type_is_still_refused(self, client, alice, as_alice):
        """The allow-list survives the target becoming optional."""
        response = client.post(
            "/api/reports",
            data={"target_type": "userprofile", "target_id": 1, "reason": "nope"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 422


class TestReportTargetContext:
    """A moderator has to be able to see WHAT was reported.

    🚨 Until `target_label` existed the queue could only have said
    "comment 41", which cannot be acted on without leaving the page - and that
    is a large part of why `GET /api/reports` sat implemented with no caller
    for a whole wave. A content type and a row id are not a report.
    """

    def test_an_episode_report_carries_its_title_and_a_link(
        self, client, episode, alice, as_alice, moderator, as_moderator
    ):
        client.post(
            "/api/reports",
            data={
                "target_type": "episode",
                "target_id": episode.id,
                "category": "not_an_episode",
                "reason": "promo clip",
            },
            content_type="application/json",
            **as_alice,
        )

        response = client.get("/api/reports", **as_moderator)
        assert response.status_code == 200, response.content
        row = response.json()[0]
        assert row["target_label"] == episode.title
        assert row["target_youtube_id"] == episode.youtube_id
        assert row["reporter"]

    def test_a_moment_report_links_to_the_episode_behind_it(
        self, client, episode, alice, as_alice, moderator, as_moderator
    ):
        """The label comes from the moment; the link comes from its episode.

        These are two different rows, and a queue that could only reach one of
        them would either be unactionable or mislabelled.
        """
        moment = Moment.objects.create(
            episode=episode, user=alice, timestamp_sec=61, label="кучето лае"
        )

        client.post(
            "/api/reports",
            data={
                "target_type": "moment",
                "target_id": moment.id,
                "category": "wrong_info",
                "reason": "wrong timestamp",
            },
            content_type="application/json",
            **as_alice,
        )

        row = client.get("/api/reports", **as_moderator).json()[0]
        assert row["target_label"] == "кучето лае"
        assert row["target_youtube_id"] == episode.youtube_id

    def test_a_deleted_target_degrades_instead_of_raising(
        self, client, episode, alice, as_alice, moderator, as_moderator
    ):
        """Deleting the reported row is frequently the RESPONSE to the report.

        So the queue must survive its own outcome: a dangling generic FK
        resolves to an empty label rather than 500ing the whole page.
        """
        moment = Moment.objects.create(
            episode=episode, user=alice, timestamp_sec=61, label="ще го изтрия"
        )
        client.post(
            "/api/reports",
            data={
                "target_type": "moment",
                "target_id": moment.id,
                "category": "wrong_info",
                "reason": "nonsense",
            },
            content_type="application/json",
            **as_alice,
        )
        moment.delete()

        response = client.get("/api/reports", **as_moderator)
        assert response.status_code == 200, response.content
        row = response.json()[0]
        assert row["target_label"] == ""
        assert row["target_youtube_id"] is None

    def test_the_reporter_is_told_who_answered(
        self, client, episode, alice, as_alice, moderator, as_moderator
    ):
        """🔁 The feedback loop, end to end: a note AND a name behind it."""
        report_id = client.post(
            "/api/reports",
            data={
                "target_type": "episode",
                "target_id": episode.id,
                "category": "wrong_info",
                "reason": "wrong date",
            },
            content_type="application/json",
            **as_alice,
        ).json()["id"]

        client.post(
            f"/api/reports/{report_id}/resolve",
            data={"status": "resolved", "resolution_note": "Fixed, thanks"},
            content_type="application/json",
            **as_moderator,
        )

        mine = client.get("/api/me/reports", **as_alice).json()[0]
        assert mine["status"] == "resolved"
        assert mine["resolution_note"] == "Fixed, thanks"
        assert mine["resolved_by"]
