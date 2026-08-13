"""Re-fetch episodes that were ingested from a degraded YouTube response.

    python manage.py repair_metadata --api                # Data API: fast, block-immune
    python manage.py repair_metadata --probe 10           # is the yt-dlp block lifted yet?
    python manage.py repair_metadata --channel @comedyclubpodcast
    python manage.py repair_metadata --limit 100 --delay 2

🚨 Run this after any large backfill. A big run gets soft-blocked partway through and
yt-dlp keeps returning reduced metadata WITHOUT erroring, so the backfill reports
"0 errors" while silently losing duration and availability. See
podcast/services/metadata_repair.py for the full story.

⚡ `--api` uses the YouTube Data API (needs YOUTUBE_API_KEY): batches of 50 per quota
unit, works even while yt-dlp is soft-blocked. It cannot see members-only videos, so
those rows stay degraded for a later yt-dlp sweep - which is also the only path that
can CORRECT a wrong availability. The two modes are complementary, not alternatives.

The yt-dlp mode is deliberately serial and slow. Speed is what caused the damage.
"""

from django.core.management.base import BaseCommand, CommandError

from podcast.models import Channel
from podcast.services.metadata_repair import (
    degraded_queryset,
    repair_degraded_metadata,
    repair_degraded_via_api,
)


class Command(BaseCommand):
    help = "Re-fetch episodes whose duration/availability were lost to a throttled backfill."

    def add_arguments(self, parser):
        parser.add_argument(
            "--channel", default=None,
            help="Limit to one channel (@handle or youtube channel id). Default: all channels.",
        )
        parser.add_argument(
            "--limit", type=int, default=None,
            help="Only repair the first N degraded episodes",
        )
        parser.add_argument(
            "--probe", type=int, default=None,
            help="Only test N episodes and report the recovery rate. Writes nothing new "
                 "beyond those N. Use this to check whether the block has lifted.",
        )
        parser.add_argument(
            "--delay", type=float, default=1.0,
            help="Seconds to sleep between videos (default 1.0). Raise if still blocked.",
        )
        parser.add_argument(
            "--no-abort", action="store_true",
            help="Do not stop early on a long run of degraded responses",
        )
        parser.add_argument(
            "--api", action="store_true",
            help="Repair via the YouTube Data API instead of yt-dlp. Immune to the "
                 "soft-block; leaves members-only/deleted videos for the yt-dlp sweep.",
        )

    def _resolve_channel(self, value):
        if not value:
            return None
        handle = value if value.startswith("@") else f"@{value}"
        channel = (
            Channel.objects.filter(handle=handle).first()
            or Channel.objects.filter(youtube_channel_id=value).first()
        )
        if not channel:
            raise CommandError(f"No channel matching {value!r}")
        return channel

    def handle(self, *args, **options):
        channel = self._resolve_channel(options["channel"])

        outstanding = degraded_queryset(channel).count()
        scope = channel.name if channel else "all channels"
        self.stdout.write(
            self.style.MIGRATE_HEADING(f"{outstanding} degraded episode(s) in {scope}")
        )
        if not outstanding:
            self.stdout.write(self.style.SUCCESS("Nothing to repair"))
            return

        probe = options["probe"]
        limit = probe or options["limit"]

        if probe:
            self.stdout.write(self.style.WARNING(f"PROBE - testing {probe} episode(s) only"))

        if options["api"]:
            result = repair_degraded_via_api(
                channel,
                limit=limit,
                progress=lambda message: self.stdout.write(message),
            )
            self.stdout.write(self.style.SUCCESS(result.summary()))
            if result.still_degraded:
                self.stdout.write(self.style.WARNING(
                    f"{result.still_degraded} row(s) are invisible to the Data API "
                    "(members-only or deleted). They stay degraded on purpose - the "
                    "yt-dlp sweep repairs them and states their real availability."
                ))
            self._report_errors(result)
            return

        result = repair_degraded_metadata(
            channel,
            limit=limit,
            delay=options["delay"],
            abort_after_consecutive_failures=None if options["no_abort"] else 25,
            progress=lambda message: self.stdout.write(message),
        )

        self.stdout.write(self.style.SUCCESS(result.summary()))

        if probe:
            if result.repaired:
                remaining = degraded_queryset(channel).count()
                self.stdout.write(self.style.SUCCESS(
                    f"Block appears lifted. Run without --probe to repair the "
                    f"remaining {remaining}."
                ))
            else:
                self.stdout.write(self.style.WARNING(
                    "Still throttled - every response came back degraded. "
                    "Wait longer (hours) and probe again."
                ))

        self._report_errors(result)

    def _report_errors(self, result):
        if result.errors:
            self.stdout.write(self.style.WARNING(f"\n{len(result.errors)} error(s):"))
            for error in result.errors[:20]:
                self.stdout.write(f"  {error['youtube_id']}: {error['error']}")
            if len(result.errors) > 20:
                self.stdout.write(f"  ... and {len(result.errors) - 20} more")
