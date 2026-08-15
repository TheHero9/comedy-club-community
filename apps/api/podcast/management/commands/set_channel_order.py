"""Apply the owner's curated channel order to `Channel.display_order`.

🚨 This order is EDITORIAL and is not derivable from the data:

    | position | channel                      | episodes |
    | -------- | ---------------------------- | -------- |
    | 1        | @comedyclubpodcast           | 1,318    |
    | 2        | @ivankirkov1                 | 75       |
    | 3        | @BFFPepiQ                    | 80       |
    | 4        | @delo404podcast              | 57       |
    | 5        | @ComedyClubNews              | 245      |
    | 6        | @КомедиКлубКлюкиПодкаст      | 139      |
    | 7        | @comedyclubsport7786         | 47       |

Sorting by episode count would give 1, 5, 6, 3, 2, 4, 7 - a completely
different list. Alphabetical is different again. So the order is stored, and
this command is the one place that knows it.

Idempotent, and safe to run in production: it only writes `display_order`.
A channel not named here keeps the model default (100) and therefore sorts
after every curated one, which is the correct behaviour for a channel nobody
has placed yet.
"""

from django.core.management.base import BaseCommand
from django.db.models import Q

from podcast.models import Channel

# Handles are matched case-insensitively and with the leading "@" optional,
# because the stored value has drifted between ingestion runs.
CURATED_ORDER = [
    "@comedyclubpodcast",
    "@ivankirkov1",
    "@BFFPepiQ",
    "@delo404podcast",
    "@ComedyClubNews",
    "@КомедиКлубКлюкиПодкаст",
    "@comedyclubsport7786",
]

# Step by 10 so a channel can later be slotted between two without a full
# renumber.
STEP = 10


class Command(BaseCommand):
    help = "Apply the curated channel order to Channel.display_order."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would change and write nothing.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        placed: set[int] = set()
        updates: list[Channel] = []

        for index, handle in enumerate(CURATED_ORDER):
            bare = handle.lstrip("@")
            channel = Channel.objects.filter(
                Q(handle__iexact=handle) | Q(handle__iexact=bare)
            ).first()

            if channel is None:
                # Not an error: a curated handle may simply not be ingested yet.
                self.stdout.write(self.style.WARNING(f"  skip (not found): {handle}"))
                continue

            target = (index + 1) * STEP
            placed.add(channel.pk)
            if channel.display_order == target:
                self.stdout.write(f"  ok   {target:>4}  {channel.name}")
                continue

            self.stdout.write(
                self.style.SUCCESS(
                    f"  set  {target:>4}  {channel.name} "
                    f"(was {channel.display_order})"
                )
            )
            channel.display_order = target
            updates.append(channel)

        # Anything not curated is pushed behind the curated block rather than
        # left interleaved at whatever value it happens to hold.
        tail = Channel.objects.exclude(pk__in=placed).exclude(display_order__gte=1000)
        for channel in tail:
            self.stdout.write(
                self.style.WARNING(f"  tail 1000  {channel.name} (uncurated)")
            )
            channel.display_order = 1000
            updates.append(channel)

        if dry_run:
            self.stdout.write(self.style.WARNING(f"\nDry run: {len(updates)} unwritten."))
            return

        if updates:
            Channel.objects.bulk_update(updates, ["display_order"])

        self.stdout.write(self.style.SUCCESS(f"\nUpdated {len(updates)} channel(s)."))
        self.stdout.write("Order is now:")
        for channel in Channel.objects.all():
            self.stdout.write(f"  {channel.display_order:>4}  {channel.name}")
