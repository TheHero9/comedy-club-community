"""🔒 Django Admin brute-force lockout.

`/admin/` is served on the public API host and answered 200 to the whole
internet with no attempt limiting of any kind. The Ninja `WriteThrottle` does
not cover it - that throttle is attached to the NinjaAPI and never sees a Django
Admin POST - so the one account that can actually log in was exposed to
unlimited credential stuffing.

Pinned here because the failure mode is silent in both directions: a lockout
that never triggers looks exactly like one that does, and a lockout keyed on the
wrong thing (see AXES_LOCKOUT_PARAMETERS in settings/base.py) locks out every
visitor at once the first time anyone mistypes a password.
"""

from __future__ import annotations

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.urls import reverse

LOGIN_URL = "/admin/login/"


@pytest.fixture
def superuser(db):
    return get_user_model().objects.create_superuser(
        username="operator", email="operator@example.com", password="a-real-password-123"
    )


@pytest.fixture(autouse=True)
def _clear_attempts(db):
    """Axes counts across tests otherwise, so one test's failures lock the next."""
    from axes.models import AccessAttempt

    AccessAttempt.objects.all().delete()
    yield
    AccessAttempt.objects.all().delete()


@pytest.mark.django_db
def test_the_admin_login_page_is_reachable(client):
    # Not a vulnerability on its own, and this test exists to make the lockout
    # tests below meaningful: they only prove something if the form is live.
    assert client.get(LOGIN_URL).status_code == 200


@pytest.mark.django_db
def test_repeated_wrong_passwords_lock_the_account_out(client, superuser):
    limit = settings.AXES_FAILURE_LIMIT

    for _ in range(limit):
        client.post(
            LOGIN_URL,
            {"username": "operator", "password": "wrong"},
            follow=False,
        )

    # 🚨 The real check: the CORRECT password is now refused too. A "lockout"
    # that only rejects further wrong guesses has stopped nothing - the attacker
    # simply keeps going until they hit the right one.
    #
    # 429, not 403: axes 8 answers a lockout with Too Many Requests, which is
    # the honest status for "you may try again later" and distinguishes it from
    # "these credentials are wrong".
    blocked = client.post(
        LOGIN_URL,
        {"username": "operator", "password": "a-real-password-123"},
        follow=False,
    )
    assert blocked.status_code == 429, blocked.status_code


@pytest.mark.django_db
def test_a_correct_password_still_works_below_the_limit(client, superuser):
    # One typo must not cost anyone their session. AXES_RESET_ON_SUCCESS also
    # means yesterday's fumbles never accumulate into today's lockout.
    client.post(LOGIN_URL, {"username": "operator", "password": "wrong"})

    ok = client.post(
        LOGIN_URL,
        {"username": "operator", "password": "a-real-password-123"},
        follow=False,
    )
    # 302 away from the login form is a successful admin sign-in.
    assert ok.status_code == 302, ok.status_code
    assert client.get(reverse("admin:index")).status_code == 200


@pytest.mark.django_db
def test_locking_one_username_does_not_lock_another(client, superuser):
    """🚨 THE REGRESSION THIS FILE EXISTS FOR.

    If `AXES_LOCKOUT_PARAMETERS` ever gains `ip_address`, this fails - because
    behind Railway's edge every request shares one `REMOTE_ADDR`, so one
    attacker's failures would lock out every other account including the
    owner's. Username keying is what makes the lockout safe to run at all here.
    """
    get_user_model().objects.create_superuser(
        username="second", email="second@example.com", password="another-password-456"
    )

    for _ in range(settings.AXES_FAILURE_LIMIT):
        client.post(LOGIN_URL, {"username": "operator", "password": "wrong"})

    unaffected = client.post(
        LOGIN_URL,
        {"username": "second", "password": "another-password-456"},
        follow=False,
    )
    assert unaffected.status_code == 302, unaffected.status_code


@pytest.mark.django_db
def test_the_api_is_unaffected_by_an_admin_lockout(client, superuser, as_alice):
    """The two auth systems are separate and must stay separate.

    Ninja verifies a bearer token and never calls Django's `authenticate()`, so
    an admin lockout must not make the whole API read-only for members.
    """
    for _ in range(settings.AXES_FAILURE_LIMIT + 5):
        client.post(LOGIN_URL, {"username": "operator", "password": "wrong"})

    assert client.get("/api/me", **as_alice).status_code == 200
    assert client.get("/api/channels").status_code == 200
