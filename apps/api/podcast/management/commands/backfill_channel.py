"""One-time bulk backfill of a channel via yt-dlp.

    python manage.py backfill_channel @ivankirkov1
    python manage.py backfill_channel @ivankirkov1 --limit 5
    python manage.py backfill_channel @ivankirkov1 --dry-run

🚨 Ingests the "videos" and "streams" tabs only. Shorts are never ingested.
⚠️ yt-dlp is scraping. Correct here; never for the recurring sync (wave 5).
"""

import time

from django.core.management.base import BaseCommand, CommandError

from podcast.ingestion.yt_dlp_backfill import IngestionError
from podcast.services.ingestion import backfill_channel


class Command(BaseCommand):
    help = "Backfill a YouTube channel's episodes into the database using yt-dlp."

    def add_arguments(self, parser):
        parser.add_argument("channel", help="@handle, bare handle, or any channel URL")
        parser.add_argument(
            "--limit", type=int, default=None,
            help="Only the N most recent entries per tab (useful for a smoke test)",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Fetch and report, but write nothing to the database",
        )
        parser.add_argument(
            "--skip-thumbnail-check", action="store_true",
            help="Assume maxresdefault exists instead of issuing a HEAD per video",
        )

    def handle(self, *args, **options):
        target = options["channel"]
        started = time.monotonic()

        self.stdout.write(self.style.MIGRATE_HEADING(f"Backfilling {target}"))
        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("DRY RUN - nothing will be written"))

        try:
            result = backfill_channel(
                target,
                limit=options["limit"],
                dry_run=options["dry_run"],
                verify_thumbnails=not options["skip_thumbnail_check"],
                progress=lambda message: self.stdout.write(message),
            )
        except IngestionError as exc:
            raise CommandError(str(exc)) from exc

        elapsed = time.monotonic() - started

        if options["dry_run"]:
            self.stdout.write(
                self.style.SUCCESS(f"Would upsert {result.skipped} episodes in {elapsed:.1f}s")
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(f"{result.channel}: {result.summary()} in {elapsed:.1f}s")
            )

        if result.errors:
            self.stdout.write(self.style.WARNING(f"\n{len(result.errors)} error(s):"))
            for error in result.errors[:20]:
                self.stdout.write(f"  {error['youtube_id']}: {error['error']}")
            if len(result.errors) > 20:
                self.stdout.write(f"  ... and {len(result.errors) - 20} more")
