"""Delete a Person and everything that hangs off them, with the count shown first.

🚨 Why a command instead of a shell one-liner: this has to run in PRODUCTION,
where the only way in is a temporary worker start command whose output is a log
file. A one-liner gives no record of what it removed. This prints the blast
radius, refuses to guess between near-matches, and needs `--yes` to write.

Built for the leftover `Гост от публиката` ("Guest from the audience") persona,
which `seed_demo --clear` could not remove: the name is in neither `GUESTS` nor
`CHANNEL_HOSTS`, so the scoped delete never matched it and it outlived the demo
data by five days, showing up as a real participant filter on /episodes.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from podcast.models import EpisodeParticipant, Person


class Command(BaseCommand):
    help = "Delete a Person by slug, id or exact name, plus their participations."

    def add_arguments(self, parser):
        parser.add_argument(
            "target",
            help="Person slug, numeric id, or exact name.",
        )
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Actually delete. Without it this is a dry run.",
        )

    def handle(self, *args, **options):
        target = options["target"]
        lookup = Q(slug=target) | Q(name=target)
        if target.isdigit():
            lookup |= Q(pk=int(target))

        matches = list(Person.objects.filter(lookup))

        if not matches:
            raise CommandError(f"No Person matches {target!r}.")
        if len(matches) > 1:
            # Never guess: deleting the wrong persona takes real participations.
            listing = ", ".join(f"{p.pk}:{p.slug}" for p in matches)
            raise CommandError(f"{len(matches)} people match {target!r}: {listing}")

        person = matches[0]
        participations = EpisodeParticipant.objects.filter(person=person)
        count = participations.count()

        self.stdout.write(f"Person   id={person.pk} slug={person.slug!r}")
        self.stdout.write(f"Name     {person.name!r}")
        self.stdout.write(f"Linked user  {person.user_id}")
        self.stdout.write(f"Participations that will be deleted: {count}")

        if person.user_id is not None:
            # A persona claimed by a real account is not stray demo data.
            raise CommandError(
                "This Person is linked to a user account. Unlink it in the admin "
                "first if you really mean to delete it."
            )

        for participation in participations.select_related("episode")[:10]:
            self.stdout.write(f"  - {participation.episode.title[:70]}")
        if count > 10:
            self.stdout.write(f"  ... and {count - 10} more")

        if not options["yes"]:
            self.stdout.write(
                self.style.WARNING("\nDry run. Re-run with --yes to delete.")
            )
            return

        with transaction.atomic():
            participations.delete()
            person.delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDeleted Person {person.name!r} and {count} participation(s)."
            )
        )
