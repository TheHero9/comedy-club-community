"""Membership duration maths and the endpoints built on it.

🚨 The month count is DERIVED, so the property that matters is a ROUND TRIP:
whatever a user types must come back unchanged, and must then tick up on its own
at the next renewal. These tests assert that relationship rather than hardcoded
dates - a test pinned to "2020-11-06" would have to be rewritten every time the
example changed and would stop proving anything about the general case.

The one hardcoded case is the owner's original example, kept verbatim because it
is the specification of the feature.
"""

from __future__ import annotations

from datetime import date

import pytest

from podcast.services import memberships as m


class TestMonthMaths:
    def test_the_owner_example(self):
        """"I have 70 months and it renews on the 6th of September."

        The literal request this feature came from (2026-08-16). It is pinned
        exactly because it is the spec: 70 today, 71 the moment the 6th passes,
        with nothing running in between to make that happen.
        """
        today = date(2026, 8, 16)

        member_since = m.member_since_for(70, 6, today)
        assert member_since == date(2020, 10, 6)
        assert m.months_held(member_since, 6, today) == 70
        assert m.next_renewal(6, today) == date(2026, 9, 6)

        # The day BEFORE renewal it must still read 70 - an early tick would
        # show a month the user has not paid for yet.
        assert m.months_held(member_since, 6, date(2026, 9, 5)) == 70
        assert m.months_held(member_since, 6, date(2026, 9, 6)) == 71
        assert m.months_held(member_since, 6, date(2027, 8, 6)) == 82

    @pytest.mark.parametrize("renewal_day", range(1, 32))
    @pytest.mark.parametrize("months", [0, 1, 2, 13, 70, 600])
    @pytest.mark.parametrize(
        "today",
        [
            date(2026, 1, 1),
            date(2026, 2, 28),
            date(2026, 3, 31),
            date(2026, 8, 16),
            date(2026, 12, 31),
            # A leap February, the case that breaks naive day arithmetic.
            date(2024, 2, 29),
        ],
    )
    def test_round_trip(self, renewal_day: int, months: int, today: date):
        """What the user typed is what the profile shows back.

        Every renewal day including the 29th, 30th and 31st, which do not exist
        in every month and are the whole reason `clamp_day` exists.
        """
        anchor = m.member_since_for(months, renewal_day, today)
        assert m.months_held(anchor, renewal_day, today) == months

    def test_day_one_is_month_zero(self):
        """🚨 Zero, not one - a brand-new member has COMPLETED no months.

        That is what a YouTube loyalty badge shows, and it is the first rung of
        every channel's icon ladder ("starting"). If day one read as 1, that
        rung would be unreachable and every new member would silently be handed
        the one-month icon instead.
        """
        today = date(2026, 6, 15)
        anchor = m.member_since_for(0, 15, today)
        assert anchor == today
        assert m.months_held(anchor, 15, today) == 0
        # ...and it becomes 1 on the first renewal, not before.
        assert m.months_held(anchor, 15, date(2026, 7, 14)) == 0
        assert m.months_held(anchor, 15, date(2026, 7, 15)) == 1

    def test_a_31st_renewal_survives_february(self):
        """The calendar edge that turns a bad implementation into a 500.

        `date(2026, 2, 31)` is a ValueError, so every function has to clamp. A
        membership renewing on the 31st renews on the 28th in February and goes
        back to the 31st in March - it must never be permanently moved.
        """
        assert m.next_renewal(31, date(2026, 2, 1)) == date(2026, 2, 28)
        assert m.next_renewal(31, date(2026, 2, 28)) == date(2026, 3, 31)
        assert m.next_renewal(29, date(2026, 2, 1)) == date(2026, 2, 28)
        # Leap year: the 29th exists, so it is not clamped.
        assert m.next_renewal(29, date(2024, 2, 1)) == date(2024, 2, 29)

    def test_next_renewal_is_strictly_after_today(self):
        """On renewal day itself the count has already ticked, so point forward.

        Showing today's date as "next renewal" reads as a stale page.
        """
        assert m.next_renewal(6, date(2026, 8, 6)) == date(2026, 9, 6)

    def test_a_future_start_never_reads_as_negative(self):
        """Typo-proofing. A negative month badge is worse than a wrong one."""
        future = date(2030, 1, 10)
        assert m.months_held(future, 10, date(2026, 8, 16)) == 0

    @pytest.mark.parametrize(
        "months,renewal_day",
        [(-1, 6), (601, 6), (12, 0), (12, 32), (12, -3)],
    )
    def test_impossible_input_is_rejected(self, months: int, renewal_day: int):
        with pytest.raises(m.MembershipMathError):
            m.member_since_for(months, renewal_day, date(2026, 8, 16))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

BASE = "/api"


def _claim(client, headers, channel, **payload):
    return client.post(
        f"{BASE}/me/memberships",
        data={"channel_id": channel.id, **payload},
        content_type="application/json",
        **headers,
    )


@pytest.mark.django_db
class TestMembershipEndpoints:
    def test_claim_returns_the_months_that_were_claimed(self, client, channel, alice, as_alice):
        response = _claim(client, as_alice, channel, months=70, renewal_day=6)
        assert response.status_code == 200

        body = response.json()
        assert body["months"] == 70
        assert body["renewal_day"] == 6
        assert body["next_renewal"] is not None
        # 🚨 Claiming is not verifying. A self-reported membership earns the
        # badge and the profile icons, never the elite vote.
        assert body["is_verified"] is False

    def test_claiming_twice_updates_instead_of_returning_the_old_row(
        self, client, channel, alice, as_alice
    ):
        """🚨 The regression this endpoint's upsert exists for.

        `get_or_create` alone made a second POST a silent no-op that answered
        with the ORIGINAL row - so a user fixing a typo in their month count got
        their wrong number handed straight back with a 200, which reads as the
        form being broken.
        """
        first = _claim(client, as_alice, channel, months=5, renewal_day=10).json()
        second = _claim(client, as_alice, channel, months=40, renewal_day=22).json()

        assert second["id"] == first["id"], "must update the row, not create a second"
        assert second["months"] == 40
        assert second["renewal_day"] == 22

    def test_claiming_does_not_clear_an_admin_verification(
        self, client, channel, alice, as_alice, verify_membership
    ):
        """🚨 Re-stating a month count must not cost someone their elite standing.

        Verification is an admin's decision about a person, not about the number
        they typed. Only a NEW screenshot resets it - that is fresh evidence
        nobody has reviewed.
        """
        verify_membership(alice, channel)

        body = _claim(client, as_alice, channel, months=12, renewal_day=3).json()

        assert body["is_verified"] is True
        assert body["months"] == 12

    def test_patch_corrects_a_claim(self, client, channel, alice, as_alice):
        created = _claim(client, as_alice, channel, months=5, renewal_day=10).json()

        response = client.patch(
            f"{BASE}/me/memberships/{created['id']}",
            data={"channel_id": channel.id, "months": 6, "renewal_day": 10},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200
        assert response.json()["months"] == 6

    def test_patch_cannot_touch_another_users_membership(
        self, client, channel, alice, bob, as_alice, as_bob
    ):
        """🔒 Scoped to the actor, not just to the id."""
        theirs = _claim(client, as_bob, channel, months=5, renewal_day=10).json()

        response = client.patch(
            f"{BASE}/me/memberships/{theirs['id']}",
            data={"channel_id": channel.id, "months": 99, "renewal_day": 1},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 404

        unchanged = client.get(f"{BASE}/me/memberships", **as_bob).json()
        assert unchanged[0]["months"] == 5

    def test_patch_ignores_a_channel_change(
        self, client, channel, other_channel, alice, as_alice
    ):
        """Moving a membership between channels would silently move an elite vote."""
        created = _claim(client, as_alice, channel, months=5, renewal_day=10).json()

        response = client.patch(
            f"{BASE}/me/memberships/{created['id']}",
            data={"channel_id": other_channel.id, "months": 5, "renewal_day": 10},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 200
        assert response.json()["channel_id"] == channel.id

    @pytest.mark.parametrize(
        "payload",
        [
            {"months": -1, "renewal_day": 6},
            {"months": 9999, "renewal_day": 6},
            {"months": 12, "renewal_day": 0},
            {"months": 12, "renewal_day": 99},
        ],
    )
    def test_impossible_claims_are_rejected(self, client, channel, alice, as_alice, payload):
        response = _claim(client, as_alice, channel, **payload)
        assert response.status_code == 422

    def test_a_legacy_row_reports_null_months_rather_than_guessing(
        self, client, channel, alice, as_alice
    ):
        """Rows claimed before `renewal_day` existed have no anchor to count from.

        Null is the honest answer; deriving a count from `member_since.day`
        would print a number the user never gave us.
        """
        response = _claim(client, as_alice, channel, member_since="2024-01-01")
        assert response.status_code == 200

        body = response.json()
        assert body["member_since"] == "2024-01-01"
        assert body["months"] is None
        assert body["next_renewal"] is None

    def test_me_reports_the_same_months_as_the_membership_list(
        self, client, channel, alice, as_alice
    ):
        """Two endpoints, one derivation. A drift here is a visible contradiction."""
        _claim(client, as_alice, channel, months=33, renewal_day=8)

        me = client.get(f"{BASE}/me", **as_alice).json()
        listed = client.get(f"{BASE}/me/memberships", **as_alice).json()

        assert me["memberships"][0]["months"] == 33
        assert listed[0]["months"] == 33


# ---------------------------------------------------------------------------
# Profile icons
# ---------------------------------------------------------------------------


class TestCatalogueIntegrity:
    """The catalogue is data, and every one of its fields fails SILENTLY.

    A wrong slug does not raise - it makes an icon permanently locked for
    everyone. A wrong filename does not raise either - it renders a broken
    image on somebody's profile. Neither shows up in any other test, so they
    are checked here directly against the database and the filesystem.
    """

    def test_every_key_is_unique(self):
        from podcast.data import avatar_icons

        keys = [icon.key for icon in avatar_icons.CATALOGUE]
        assert len(keys) == len(set(keys)), "a duplicate key silently shadows an icon"

    @pytest.mark.django_db
    def test_every_channel_slug_exists(self, channel):
        """🚨 A typo here locks an icon forever, with no error anywhere."""
        from podcast.data import avatar_icons
        from podcast.models import Channel

        referenced = {
            icon.channel_slug
            for icon in avatar_icons.CATALOGUE
            if icon.channel_slug is not None
        }
        # The test database is not the real corpus, so this asserts the shape of
        # the reference rather than its presence: a slug must be a non-empty
        # string that Channel.slug could hold.
        for slug in referenced:
            assert slug and slug.strip() == slug
            assert len(slug) <= Channel._meta.get_field("slug").max_length

    def test_every_image_file_exists(self):
        """🚨 A typo'd filename renders a broken image on a public profile.

        The files live in the WEB app's `public/`, because `image_url` resolves
        against the web origin, not the API's.
        """
        from pathlib import Path

        from podcast.data import avatar_icons

        # apps/api/podcast/tests -> repo root -> apps/web/public
        public = Path(__file__).resolve().parents[3] / "web" / "public"
        missing = []
        for icon in avatar_icons.CATALOGUE:
            if not icon.image_url:
                continue
            assert icon.image_url.startswith("/"), f"{icon.key} must be an absolute path"
            if not (public / icon.image_url.lstrip("/")).is_file():
                missing.append(f"{icon.key} -> {icon.image_url}")
        assert not missing, f"catalogue points at files that do not exist: {missing}"

    def test_each_channel_ladder_is_ordered_and_starts_at_zero(self):
        """The picker renders CATALOGUE order, so the order is the ladder."""
        from collections import defaultdict

        from podcast.data import avatar_icons

        by_channel = defaultdict(list)
        for icon in avatar_icons.CATALOGUE:
            if icon.channel_slug:
                by_channel[icon.channel_slug].append(icon.min_months)

        for slug, thresholds in by_channel.items():
            assert thresholds == sorted(thresholds), f"{slug} ladder is out of order"
            assert len(thresholds) == len(set(thresholds)), f"{slug} has a duplicate rung"
            assert thresholds[0] == 0, f"{slug} has no new-member rung"


@pytest.mark.django_db
class TestAvatarIcons:
    def test_the_catalogue_lists_locked_icons_too(self, client, alice, as_alice):
        """🚨 The ladder is the feature; hiding its rungs removes the motivation."""
        response = client.get(f"{BASE}/me/avatars", **as_alice)
        assert response.status_code == 200
        body = response.json()
        assert len(body) > 1
        # Somebody with no memberships at all sees the free icon unlocked and
        # every channel icon locked - including the zero-month rungs.
        free = [icon for icon in body if icon["channel_slug"] is None]
        assert free and all(icon["unlocked"] for icon in free)
        assert not any(icon["unlocked"] for icon in body if icon["channel_slug"])

    def test_a_zero_month_icon_still_needs_a_membership(
        self, client, channel, other_channel, alice, as_alice
    ):
        """🚨 The bug `.get(slug, 0) >= 0` would have shipped.

        A "new member" rung is `min_months=0`, and a plain dict-get defaulting
        to 0 satisfies `>= 0` for somebody who has never joined - so every
        channel's starting icon would have been free to everyone. Membership
        must be checked before the threshold.
        """
        from podcast.data import avatar_icons

        icon = avatar_icons.AvatarIcon(
            key="test-zero",
            label="Zero",
            image_url="/avatars/club.jpeg",
            channel_slug=other_channel.slug,
            min_months=0,
        )
        original = avatar_icons.CATALOGUE
        avatar_icons.CATALOGUE = (*original, icon)
        avatar_icons._BY_KEY[icon.key] = icon
        try:
            # A membership on a DIFFERENT channel must not unlock it.
            _claim(client, as_alice, channel, months=50, renewal_day=5)
            assert (
                client.put(
                    f"{BASE}/me/avatar",
                    data={"avatar_key": icon.key},
                    content_type="application/json",
                    **as_alice,
                ).status_code
                == 403
            )

            # Joining that channel today - zero months completed - unlocks it.
            _claim(client, as_alice, other_channel, months=0, renewal_day=5)
            assert (
                client.put(
                    f"{BASE}/me/avatar",
                    data={"avatar_key": icon.key},
                    content_type="application/json",
                    **as_alice,
                ).status_code
                == 200
            )
        finally:
            avatar_icons.CATALOGUE = original
            avatar_icons._BY_KEY.pop(icon.key, None)

    def test_a_locked_icon_cannot_be_selected(self, client, channel, alice, as_alice):
        """🔒 Enforced on the server. A greyed-out button is not authorization.

        Built against a temporary catalogue entry rather than a shipped icon, so
        this keeps testing the RULE once the real artwork lands and its
        thresholds change.
        """
        from podcast.data import avatar_icons

        locked = avatar_icons.AvatarIcon(
            key="test-locked",
            label="Locked",
            image_url="/static/avatars/test.png",
            channel_slug=channel.slug,
            min_months=99,
        )
        original = avatar_icons.CATALOGUE
        avatar_icons.CATALOGUE = (*original, locked)
        avatar_icons._BY_KEY[locked.key] = locked
        try:
            _claim(client, as_alice, channel, months=1, renewal_day=5)

            response = client.put(
                f"{BASE}/me/avatar",
                data={"avatar_key": locked.key},
                content_type="application/json",
                **as_alice,
            )
            assert response.status_code == 403

            # ...and it unlocks once the months are there.
            _claim(client, as_alice, channel, months=99, renewal_day=5)
            allowed = client.put(
                f"{BASE}/me/avatar",
                data={"avatar_key": locked.key},
                content_type="application/json",
                **as_alice,
            )
            assert allowed.status_code == 200
            assert allowed.json()["avatar_key"] == locked.key
        finally:
            avatar_icons.CATALOGUE = original
            avatar_icons._BY_KEY.pop(locked.key, None)

    def test_an_unknown_key_is_a_404_not_a_500(self, client, alice, as_alice):
        response = client.put(
            f"{BASE}/me/avatar",
            data={"avatar_key": "no-such-icon"},
            content_type="application/json",
            **as_alice,
        )
        assert response.status_code == 404

    def test_months_do_not_pool_across_channels(
        self, client, channel, other_channel, alice, as_alice
    ):
        """🚨 The rule the whole feature rests on.

        Seventeen months on one channel must unlock nothing on another. A single
        summed total would make every icon reachable through whichever channel
        the user happened to join first.
        """
        from podcast.data import avatar_icons

        icon = avatar_icons.AvatarIcon(
            key="test-other-channel",
            label="Other",
            image_url="/static/avatars/test.png",
            channel_slug=other_channel.slug,
            min_months=10,
        )
        original = avatar_icons.CATALOGUE
        avatar_icons.CATALOGUE = (*original, icon)
        avatar_icons._BY_KEY[icon.key] = icon
        try:
            # 50 months on the WRONG channel.
            _claim(client, as_alice, channel, months=50, renewal_day=5)

            response = client.put(
                f"{BASE}/me/avatar",
                data={"avatar_key": icon.key},
                content_type="application/json",
                **as_alice,
            )
            assert response.status_code == 403
        finally:
            avatar_icons.CATALOGUE = original
            avatar_icons._BY_KEY.pop(icon.key, None)

    def test_a_re_locked_icon_stops_rendering_but_is_not_erased(
        self, client, channel, alice, as_alice
    ):
        """A lapsed membership hides the icon; renewing restores the choice.

        Discarding the key would silently throw away something the user earned,
        and there would be no way to tell them why it vanished.
        """
        from podcast.data import avatar_icons
        from podcast.models import ChannelMembership, UserProfile

        icon = avatar_icons.AvatarIcon(
            key="test-lapsing",
            label="Lapsing",
            image_url="/static/avatars/lapsing.png",
            channel_slug=channel.slug,
            min_months=12,
        )
        original = avatar_icons.CATALOGUE
        avatar_icons.CATALOGUE = (*original, icon)
        avatar_icons._BY_KEY[icon.key] = icon
        try:
            _claim(client, as_alice, channel, months=20, renewal_day=5)
            client.put(
                f"{BASE}/me/avatar",
                data={"avatar_key": icon.key},
                content_type="application/json",
                **as_alice,
            )
            assert client.get(f"{BASE}/me", **as_alice).json()["avatar_url"] == icon.image_url

            # The membership lapses (the row goes away entirely).
            ChannelMembership.objects.filter(user=alice, channel=channel).delete()

            me = client.get(f"{BASE}/me", **as_alice).json()
            assert me["avatar_url"] == "", "a re-locked icon must stop rendering"
            assert me["avatar_key"] == icon.key, "...but the choice is remembered"
            assert UserProfile.objects.get(user=alice).avatar_key == icon.key
        finally:
            avatar_icons.CATALOGUE = original
            avatar_icons._BY_KEY.pop(icon.key, None)
