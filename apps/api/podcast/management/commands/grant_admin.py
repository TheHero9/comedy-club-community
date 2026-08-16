"""Give an account full administrative access, in any environment.

    python manage.py grant_admin --list
    python manage.py grant_admin xxjimy9999xx@gmail.com --dry-run
    python manage.py grant_admin xxjimy9999xx@gmail.com
    python manage.py grant_admin user_33Kq... --revoke

🔒 Admin access is TWO switches, not one, and granting only one leaves a
half-privileged account that fails in a confusing place:

  - `UserProfile.role = "admin"` governs the API. `require_admin` reads it, and
    `require_moderator` accepts admin or moderator via `is_staff_role`.
  - Django's `is_staff` + `is_superuser` govern the Django Admin site, which is
    where the moderation queues, the report inbox and the activity lists live.

A superuser can also promote other people, which is what "full access" means
here - the grant is not just for one person, it is the ability to delegate.

🚨 Matching is deliberately broad. Accounts are keyed on
`UserProfile.clerk_user_id`, never on email - `provision_user` says so, because
an email can change. Worse, the update path refreshes only `display_name` and
`avatar_url`, so an account provisioned before Clerk supplied an email keeps a
BLANK email forever. Looking up by email alone would then find nobody, on an
account that plainly exists. So an identifier may be an email, a Django
username or a Clerk id, and `--list` exists to show what is actually stored
when a lookup surprises you.

⚠️ Production has no shell (Railway MCP has no exec). Run this as a
`preDeployCommand` on a NEW deployment - never `redeploy`, which reuses the old
config - and read the deploy logs. Confirm the target exists with `--list`
BEFORE arming the real grant: a `CommandError` in a preDeployCommand fails the
deployment.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from podcast.models import UserProfile

User = get_user_model()


def describe(user) -> str:
    profile = getattr(user, "profile", None)
    flags = []
    if user.is_superuser:
        flags.append("superuser")
    if user.is_staff:
        flags.append("staff")
    return (
        f"id={user.id:<5} username={user.get_username()!r:<28} "
        f"email={user.email or '(blank)'!r:<32} "
        f"role={(profile.role if profile else '(no profile)'):<10} "
        f"clerk={(profile.clerk_user_id if profile else None) or '(none)':<34} "
        f"[{', '.join(flags) or 'plain'}]"
    )


class Command(BaseCommand):
    help = "Grant (or revoke) full admin access for one account."

    def add_arguments(self, parser):
        parser.add_argument(
            "identifier",
            nargs="?",
            help="Email, Django username, or Clerk user id",
        )
        parser.add_argument(
            "--list",
            action="store_true",
            help="List every account and exit. Use this first in production.",
        )
        parser.add_argument(
            "--dry-run", action="store_true", help="Report the change, write nothing"
        )
        parser.add_argument(
            "--verify-email",
            default=None,
            help=(
                "Refuse unless Clerk confirms this address owns the matched account. "
                "Use when granting by Clerk id, so the grant rests on proof rather "
                "than on an inference about which row is whose."
            ),
        )
        parser.add_argument(
            "--revoke",
            action="store_true",
            help="Take the access away again (role=member, staff/superuser off)",
        )
        parser.add_argument(
            "--diagnose",
            action="store_true",
            help=(
                "Report this service's Clerk configuration and whether the lookup "
                "works, then exit 0 - changes nothing. Safe to arm as a "
                "preDeployCommand, which a failing verification is not."
            ),
        )

    def handle(self, *args, **options):
        if options["list"]:
            return self._list()

        identifier = (options["identifier"] or "").strip()
        if not identifier:
            raise CommandError("Pass an email, username or Clerk id - or --list")

        matches = list(
            User.objects.select_related("profile")
            .filter(
                Q(email__iexact=identifier)
                | Q(username__iexact=identifier)
                | Q(profile__clerk_user_id=identifier)
            )
            .order_by("id")
        )

        if not matches:
            # Loud on purpose. As a preDeployCommand this fails the deployment
            # rather than silently leaving nobody in charge - and the deployment
            # failing is the correct signal that the account was never there.
            self.stdout.write(f"No account matches {identifier!r}. Known accounts:")
            self._list()
            raise CommandError(
                f"No account matches {identifier!r} by email, username or Clerk id. "
                f"The person must sign in at least once before they can be granted "
                f"anything - provisioning is lazy, on first authenticated request."
            )

        if len(matches) > 1:
            for user in matches:
                self.stdout.write(f"  {describe(user)}")
            raise CommandError(
                f"{len(matches)} accounts match {identifier!r}. Re-run with the Clerk "
                f"id, which is the only stable identity."
            )

        user = matches[0]
        self.stdout.write(f"before: {describe(user)}")

        if options["diagnose"]:
            from podcast.auth import clerk_api

            profile = getattr(user, "profile", None)
            clerk_id = getattr(profile, "clerk_user_id", None)
            if not clerk_id:
                self.stdout.write("no clerk_user_id on this account; nothing to ask Clerk")
                return
            fetched = clerk_api.fetch_user(clerk_id)
            if fetched is None:
                self._report_clerk_config(clerk_id)
                self.stdout.write("RESULT: Clerk lookup FAILED (see the warning above)")
            else:
                self.stdout.write(
                    f"RESULT: Clerk lookup OK - email={fetched.get('email') or '(none)'!r} "
                    f"name={fetched.get('display_name') or '(none)'!r}"
                )
            return

        if options["verify_email"]:
            self._verify_against_clerk(user, options["verify_email"], options["dry_run"])

        target_role = UserProfile.Role.MEMBER if options["revoke"] else UserProfile.Role.ADMIN
        target_flag = not options["revoke"]

        already = (
            user.is_staff == target_flag
            and user.is_superuser == target_flag
            and getattr(user, "profile", None) is not None
            and user.profile.role == target_role
        )
        if already:
            # Idempotent: this is the desired state, so it is a success. The
            # command is meant to survive being re-run on every deployment.
            verb = "revoked" if options["revoke"] else "granted"
            self.stdout.write(f"nothing to do - access is already {verb}")
            return

        if options["dry_run"]:
            self.stdout.write(
                f"DRY RUN: would set role={target_role}, "
                f"is_staff={target_flag}, is_superuser={target_flag}"
            )
            return

        with transaction.atomic():
            user.is_staff = target_flag
            user.is_superuser = target_flag
            user.save(update_fields=["is_staff", "is_superuser"])

            # ensure_profile covers an account created by `createsuperuser`,
            # which never went through Clerk provisioning and so has no profile.
            from podcast.auth.backends import ensure_profile

            profile = ensure_profile(user)
            profile.role = target_role
            profile.save(update_fields=["role"])

        user.refresh_from_db()
        self.stdout.write(f"after : {describe(user)}")
        self.stdout.write("")
        if options["revoke"]:
            self.stdout.write("Access revoked.")
        else:
            self.stdout.write(
                "Granted. This account can now use the Django Admin site AND promote "
                "other accounts from there (Podcast > User profiles > role)."
            )

    def _verify_against_clerk(self, user, expected_email, dry_run):
        """Prove the matched row belongs to `expected_email`, or refuse.

        🚨 Why this is needed at all: a Clerk-provisioned account can hold a
        BLANK email. `provision_user` keys on `clerk_user_id` and its update
        path refreshes only display_name and avatar_url, so an account created
        before Clerk supplied an email never gets one. Production's only real
        account is exactly that - blank email, username equal to the raw Clerk
        id - so the row cannot be identified from our own database.

        Asking Clerk closes the gap with proof instead of an inference. The
        identity provider is authoritative about which address owns which id,
        and granting superuser on a guess is not acceptable.
        """
        from podcast.auth import clerk_api

        profile = getattr(user, "profile", None)
        clerk_id = getattr(profile, "clerk_user_id", None)
        if not clerk_id:
            raise CommandError(
                "--verify-email needs a Clerk-provisioned account; this row has no "
                "clerk_user_id, so Clerk cannot be asked about it."
            )

        fetched = clerk_api.fetch_user(clerk_id)
        if fetched is None:
            self._report_clerk_config(clerk_id)
            # Fails CLOSED, unlike the sign-in path which fails soft. There the
            # token was already cryptographically verified so the user is
            # authentic regardless; here the lookup IS the verification.
            raise CommandError(
                f"Clerk lookup failed for {clerk_id}. Not granting on an unverified "
                f"identity. Check CLERK_SECRET_KEY is set in this environment."
            )

        actual = (fetched.get("email") or "").strip()
        if actual.lower() != expected_email.strip().lower():
            raise CommandError(
                f"Clerk says {clerk_id} belongs to {actual or '(no email)'!r}, "
                f"not {expected_email!r}. Refusing."
            )

        self.stdout.write(f"verified: Clerk confirms {clerk_id} is {actual}")

        # Opportunistic repair. We hold the address that the provisioning path
        # could not, and a blank email is why this account was unfindable in the
        # first place. Writing it back makes the next lookup work by email.
        if not user.email and not dry_run:
            user.email = actual[:254]
            user.save(update_fields=["email"])
            self.stdout.write(f"backfilled the blank email to {user.email}")

    def _report_clerk_config(self, clerk_id):
        """Name the instance each side belongs to, without printing any secret.

        🔒 Only the key TYPE is logged - `sk_live_` / `sk_test_` are fixed public
        prefixes, not secret material, and the rest is replaced by its length.
        That is enough to answer the only question that matters here: a
        `sk_test_` key cannot read a user that lives in the production instance,
        and Clerk answers that with 403 rather than 401, because the key itself
        is perfectly valid - just not for that resource.
        """
        from django.conf import settings

        secret = getattr(settings, "CLERK_SECRET_KEY", "") or ""
        if not secret:
            key_type = "MISSING"
        elif secret.startswith("sk_live_"):
            key_type = f"sk_live_… ({len(secret)} chars)"
        elif secret.startswith("sk_test_"):
            key_type = f"sk_test_… ({len(secret)} chars)"
        else:
            key_type = f"unrecognised prefix ({len(secret)} chars)"

        issuer = getattr(settings, "CLERK_ISSUER", "") or "(unset)"
        jwks = getattr(settings, "CLERK_JWKS_URL", "") or "(unset)"

        self.stdout.write("")
        self.stdout.write("Clerk configuration seen by THIS service:")
        self.stdout.write(f"  CLERK_SECRET_KEY : {key_type}")
        self.stdout.write(f"  CLERK_ISSUER     : {issuer}")
        self.stdout.write(f"  CLERK_JWKS_URL   : {jwks}")
        self.stdout.write(f"  looking up       : {clerk_id}")
        self.stdout.write(
            "  → A 403 with a VALID key means the key and the user are in "
            "different Clerk instances. The issuer above names the instance the "
            "user signed in to; the key must belong to that same instance."
        )
        self.stdout.write("")

    def _list(self):
        users = User.objects.select_related("profile").order_by("id")
        total = users.count()
        self.stdout.write(f"{total} account(s):")
        for user in users[:200]:
            self.stdout.write(f"  {describe(user)}")
        if total > 200:
            self.stdout.write(f"  ... and {total - 200} more")
