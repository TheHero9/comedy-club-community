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
        parser.add_argument(
            "--probe", action="store_true",
            help="Report how many videos/streams/shorts the channel has and exit. "
                 "Costs one cheap flat listing per tab. Run this FIRST on any new channel.",
        )

    def _probe(self, target):
        """Cheap pre-flight: how big is this channel, and is 8 workers safe?

        🚨 Worth its one request per tab. The @comedyclubpodcast backfill was started
        assuming ~100 episodes and turned out to be 1,318, which is what pushed the run
        past YouTube's throttling threshold.
        """
        from podcast.ingestion.yt_dlp_backfill import (
            ALL_TABS,
            fetch_tab_entries,
            normalize_channel_target,
        )

        base_url = normalize_channel_target(target)
        self.stdout.write(self.style.MIGRATE_HEADING(f"Probing {base_url}"))

        counts = {}
        for tab in ALL_TABS:
            playlist, entries = fetch_tab_entries(base_url, tab, None)
            counts[tab] = len(entries)
            if playlist and "name" not in counts:
                counts["name"] = playlist.get("channel") or ""

        ingested = counts.get("videos", 0) + counts.get("streams", 0)
        self.stdout.write(f"  channel : {counts.get('name', '?')}")
        self.stdout.write(f"  videos  : {counts.get('videos', 0)}  (ingested)")
        self.stdout.write(f"  streams : {counts.get('streams', 0)}  (ingested)")
        self.stdout.write(f"  shorts  : {counts.get('shorts', 0)}  (NEVER ingested)")
        self.stdout.write(self.style.SUCCESS(f"  => {ingested} episodes would be ingested"))

        if ingested > 500:
            self.stdout.write(self.style.WARNING(
                f"\n⚠️  {ingested} episodes is a large run. YouTube throttled us at ~1,300 "
                "with the default 8 workers, which silently drops duration/availability.\n"
                "   Consider: YOUTUBE_INGEST_WORKERS=4, and expect to run "
                "`repair_metadata` afterwards."
            ))
        return ingested

    def handle(self, *args, **options):
        target = options["channel"]
        started = time.monotonic()

        if options["probe"]:
            try:
                self._probe(target)
            except IngestionError as exc:
                raise CommandError(str(exc)) from exc
            return

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

        # 🚨 The warning this command lacked on 2026-08-09. The run reported
        # "1318 created, 0 errors" while 1,036 rows had lost duration and
        # availability to a silent throttle. A backfill must never be allowed to
        # look clean when it is not - "0 errors" is not a completeness check.
        if not options["dry_run"] and result.degraded:
            share = result.degraded / result.total * 100 if result.total else 0
            self.stdout.write(self.style.ERROR(
                f"\n🚨 INCOMPLETE: {result.degraded} of {result.total} episodes "
                f"({share:.0f}%) were written from a THROTTLED response."
            ))
            self.stdout.write(
                "   They have no duration, and their `availability` defaulted to\n"
                "   'public' - so a members-only episode may be wrongly public.\n"
                "   This is NOT an error count; yt-dlp never raised.\n\n"
                "   Fix (wait a few hours first - the block lasts hours, not minutes):\n"
                f"     manage.py repair_metadata --probe 10\n"
                f"     manage.py repair_metadata --channel {result.channel.handle or target}"
            )
        elif not options["dry_run"] and result.is_complete:
            self.stdout.write(self.style.SUCCESS("Metadata complete - no repair needed"))
