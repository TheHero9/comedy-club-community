"""Membership duration: months held, and when the next renewal lands.

🚨 THE MONTH COUNT IS DERIVED, NEVER STORED. A user tells us "I have 70 months
and it renews on the 6th"; we turn that into the single date their membership
must have started on, and every later read counts forward from it. Storing 70
would make the profile wrong the morning after they typed it and would need a
nightly job to keep it honest - a job that, if it ever failed or double-ran,
would corrupt the number with no way to tell.

One stored anchor, one pure function, no scheduled work, and a value that is
correct at any instant it is asked for - including for a request served in a
different timezone from the one it was created in.

⚠️ `renewal_day` is stored ALONGSIDE `member_since` rather than being read off
`member_since.day`, and the difference only shows up on the calendar's edges. A
membership renewing on the 31st has a `member_since` in a 30-day month clamped
to the 30th; deriving the day back from it would silently move the renewal to
the 30th forever. The user said 31, so 31 is what we keep.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date

#: A membership cannot have run longer than the platform has existed, and a
#: four-digit month count in the UI is a typo, not a subscription.
MAX_MONTHS = 600

#: 🚨 ZERO, not one. `months` means COMPLETED months - the number printed on a
#: YouTube loyalty badge - so somebody who joined this week has 0 of them and is
#: a "new member". That tier is real: it is the first rung of every channel's
#: icon ladder (starting -> 1m -> 2m -> 6m -> 1y -> ...), and a floor of 1 would
#: make it unreachable, silently handing every brand-new member the 1-month
#: icon. Changed 2026-08-16 when the artwork arrived and named that rung.
MIN_MONTHS = 0
MIN_RENEWAL_DAY = 1
MAX_RENEWAL_DAY = 31


class MembershipMathError(ValueError):
    """Input that cannot describe a real membership."""


def clamp_day(day: int, year: int, month: int) -> int:
    """The given day-of-month, pulled back to the last day the month actually has.

    🚨 The reason every function here goes through this: a membership renewing on
    the 31st renews on the 28th of February, and `date(2026, 2, 31)` is a
    ValueError, not a date. Getting this wrong turns one user's profile into a
    500 for eleven months of the year.
    """
    return min(day, monthrange(year, month)[1])


def _shift_months(anchor: date, months: int, day: int) -> date:
    """Move `anchor` by `months` calendar months, landing on `day` (clamped)."""
    total = anchor.year * 12 + (anchor.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    return date(year, month, clamp_day(day, year, month))


def validate(months: int, renewal_day: int) -> None:
    if not MIN_MONTHS <= months <= MAX_MONTHS:
        raise MembershipMathError(
            f"months must be between {MIN_MONTHS} and {MAX_MONTHS}"
        )
    if not MIN_RENEWAL_DAY <= renewal_day <= MAX_RENEWAL_DAY:
        raise MembershipMathError(
            f"renewal_day must be between {MIN_RENEWAL_DAY} and {MAX_RENEWAL_DAY}"
        )


def last_renewal(renewal_day: int, today: date) -> date:
    """The most recent renewal on or before `today`."""
    this_month = date(today.year, today.month, clamp_day(renewal_day, today.year, today.month))
    if this_month <= today:
        return this_month
    return _shift_months(this_month, -1, renewal_day)


def next_renewal(renewal_day: int, today: date) -> date:
    """The next renewal strictly after `today`.

    Strictly after, so on renewal day itself the profile shows the NEXT one. The
    month count has already ticked up by then, and pointing at a date that has
    just passed reads as the page being stale.
    """
    return _shift_months(last_renewal(renewal_day, today), 1, renewal_day)


def member_since_for(months: int, renewal_day: int, today: date) -> date:
    """The start date implied by "I have `months` months, renewing on the Nth".

    The inverse of `months_held`, and `test_memberships.py` proves it by round
    trip rather than against hardcoded dates.

    Worked example, from the request that produced this feature: on 2026-08-16 a
    user says 70 months renewing on the 6th. The last renewal was 2026-08-06 and
    it was their 70th, so they joined 70 renewals earlier, on 2020-10-06. Come
    2026-09-06 the count reads 71 on its own.
    """
    validate(months, renewal_day)
    return _shift_months(last_renewal(renewal_day, today), -months, renewal_day)


def months_held(member_since: date, renewal_day: int, today: date) -> int:
    """COMPLETED months, which is the number a YouTube loyalty badge shows.

    🚨 Day one is month ZERO. Someone who joined this week has completed no
    months and is a "new member" - and that is a real rung on every channel's
    icon ladder, so an off-by-one here does not merely misprint a number, it
    hands every new member the wrong icon and skips the first tier entirely.

    ⚠️ This changed on 2026-08-16, when the artwork arrived and named that rung.
    It is invisible to users: "70 months" still reads 70 today and 71 on the
    next renewal. All that moved is what `member_since` means internally - the
    join date rather than the date of the first renewal.

    Never negative: a `member_since` in the future (a typo, or a row from before
    this field existed) reads as 0 rather than as a negative badge.
    """
    elapsed = (today.year - member_since.year) * 12 + (today.month - member_since.month)
    if today.day < clamp_day(renewal_day, today.year, today.month):
        elapsed -= 1
    return max(0, elapsed)
