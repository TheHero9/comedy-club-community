"""Refresh channel-level metadata: name, avatar, banner, subscriber count.

    python manage.py refresh_channel_meta                      # every active channel
    python manage.py refresh_channel_meta @ivankirkov1         # just one

Costs a single flat listing request per channel, so it is cheap enough to run often -
unlike `backfill_channel`, which re-extracts every video.

🚨 A channel avatar URL is an opaque content hash, NOT derivable from the channel id
the way an episode thumbnail is derivable from its video id. So the URL is stored, and
it changes whenever the owner changes their picture. Re-run this to pick that up.
See podcast/ingestion/channel_images.py.
"""

import time

from django.core.management.base import BaseCommand, CommandError

from podcast.ingestion.yt_dlp_backfill import IngestionError
from podcast.models import Channel
from podcast.services.ingestion import refresh_channel_metadata


class Command(BaseCommand):
    help = "Refresh channel name, avatar, banner and subscriber count (no episodes)."

    def add_arguments(self, parser):
        parser.add_argument(
            "channel", nargs="?", default=None,
            help="@handle or channel URL. Omit to refresh every active channel.",
        )
        parser.add_argument(
            "--delay", type=float, default=1.0,
            help="Seconds between channels when refreshing all (default 1.0)",
        )

    def _targets(self, value) -> list[str]:
        if value:
            return [value]
        targets = [
            channel.handle or channel.youtube_channel_id
            for channel in Channel.objects.filter(is_active=True)
        ]
        if not targets:
            raise CommandError("No active channels to refresh")
        return targets

    def handle(self, *args, **options):
        targets = self._targets(options["channel"])
        self.stdout.write(
            self.style.MIGRATE_HEADING(f"Refreshing metadata for {len(targets)} channel(s)")
        )

        failures = 0
        for index, target in enumerate(targets):
            try:
                channel = refresh_channel_metadata(target)
            except IngestionError as exc:
                # One unreachable channel must not stop the sweep.
                failures += 1
                self.stdout.write(self.style.ERROR(f"  {target}: {exc}"))
                continue

            avatar = "avatar ✓" if channel.avatar_url else self.style.WARNING("avatar MISSING")
            banner = "banner ✓" if channel.banner_url else "banner -"
            subscribers = (
                f"{channel.subscriber_count:,} subs"
                if channel.subscriber_count is not None
                else "subs unknown"
            )
            self.stdout.write(f"  {channel.name}: {avatar}, {banner}, {subscribers}")

            if options["delay"] and index < len(targets) - 1:
                time.sleep(options["delay"])

        if failures:
            self.stdout.write(self.style.WARNING(f"\n{failures} channel(s) failed"))
        else:
            self.stdout.write(self.style.SUCCESS("\nAll channels refreshed"))
