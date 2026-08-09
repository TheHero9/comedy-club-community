"""Fetch YouTube captions for episodes that do not have a transcript yet.

    python manage.py backfill_transcripts --probe 10                  # what coverage looks like
    python manage.py backfill_transcripts --channel @comedyclubpodcast --since 2024-01-01
    python manage.py backfill_transcripts --limit 100 --delay 2
    python manage.py backfill_transcripts --tracks AXnI79sQd3Q        # just list what exists

🎯 Free transcripts. YouTube already holds a Bulgarian ASR track (`bg-orig`) for
a large part of the catalogue, so this costs nothing but time - no GPU, no API
key, no per-minute billing.

⚠️ Coverage is DATE-DEPENDENT, not uniform. Sampled 2024-2026: 9/9 had captions.
Sampled 2019-2022: 0/12. 2023 is mixed. Members-only episodes have none at all
(5 of 5 checked). `--since 2024-01-01` gets almost all of the value for a
fraction of the requests.

🚨 Deliberately serial and slow, same as repair_metadata. A caption fetch is a
SECOND request per episode, and speed is what soft-blocked the 1,318-episode
backfill on 2026-08-09. The run aborts itself once YouTube starts throttling
rather than burning an hour and deepening the block.

⚠️ Output is ASCII only. The Windows console is cp1252 and dies on Cyrillic, so
this command never prints an episode title or a passage.
"""

from django.core.management.base import BaseCommand, CommandError

from podcast.models import Channel, Transcript
from podcast.services.transcripts import backfill_transcripts, pending_queryset


class Command(BaseCommand):
    help = "Fetch and store YouTube captions as searchable transcript segments."

    def add_arguments(self, parser):
        parser.add_argument(
            "--channel", default=None,
            help="Limit to one channel (@handle or youtube channel id). Default: all channels.",
        )
        parser.add_argument(
            "--since", default=None,
            help="Only episodes uploaded on/after this date (YYYY-MM-DD). Caption coverage "
                 "is far higher from 2024 onwards.",
        )
        parser.add_argument(
            "--limit", type=int, default=None,
            help="Only process the first N pending episodes",
        )
        parser.add_argument(
            "--probe", type=int, default=None,
            help="Only test N episodes and report the coverage rate. Use this before "
                 "committing to a long run on a new channel.",
        )
        parser.add_argument(
            "--delay", type=float, default=None,
            help="Seconds between episodes (default TRANSCRIPT_FETCH_DELAY). Raise if throttled.",
        )
        parser.add_argument(
            "--window", type=int, default=None,
            help="Seconds per searchable segment (default TRANSCRIPT_SEGMENT_SECONDS)",
        )
        parser.add_argument(
            "--force", action="store_true",
            help="Re-fetch episodes that already have a stored transcript",
        )
        parser.add_argument(
            "--no-abort", action="store_true",
            help="Do not stop early on a run of throttled responses",
        )
        parser.add_argument(
            "--no-reindex", action="store_true",
            help="Store only; do not queue Meilisearch indexing",
        )
        parser.add_argument(
            "--tracks", default=None,
            help="Diagnostic: list the caption tracks for one YouTube video id and exit",
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
        if options["tracks"]:
            self._show_tracks(options["tracks"])
            return

        channel = self._resolve_channel(options["channel"])
        since = options["since"]
        force = options["force"]

        pending = pending_queryset(channel, since=since, force=force).count()
        scope = channel.name if channel else "all channels"
        self.stdout.write(
            self.style.MIGRATE_HEADING(f"{pending} episode(s) pending in {scope}")
        )
        self._report_state(channel)

        if not pending:
            self.stdout.write(self.style.SUCCESS("Nothing to fetch"))
            return

        probe = options["probe"]
        limit = probe or options["limit"]
        if probe:
            self.stdout.write(self.style.WARNING(f"PROBE - testing {probe} episode(s) only"))

        result = backfill_transcripts(
            channel,
            since=since,
            limit=limit,
            delay=options["delay"],
            force=force,
            window_sec=options["window"],
            abort_after_consecutive_throttles=None if options["no_abort"] else 10,
            reindex=not options["no_reindex"],
            progress=lambda message: self.stdout.write(message),
        )

        self.stdout.write("")
        self.stdout.write(f"  attempted        : {result.attempted}")
        self.stdout.write(f"  transcripts saved: {result.stored}")
        self.stdout.write(f"  segments created : {result.segments_created}")
        self.stdout.write(f"  words            : {result.words}")
        self.stdout.write(f"  no captions      : {result.unavailable}")
        self.stdout.write(f"  throttled        : {result.throttled}")
        self.stdout.write(f"  errors           : {len(result.errors)}")

        if result.attempted:
            rate = 100.0 * result.stored / result.attempted
            self.stdout.write(f"  coverage         : {rate:.0f}% of attempted")

        if result.aborted:
            # 🚨 Not a failure of this code. The remaining episodes are still
            # pending and nothing was written for the throttled ones.
            self.stdout.write(self.style.WARNING(
                "\nRun aborted: YouTube is throttling this IP. Nothing was written for "
                "those episodes and they are still pending. Retry in a few hours - the "
                "block lasts hours, not minutes."
            ))
        elif result.throttled:
            self.stdout.write(self.style.WARNING(
                f"\n{result.throttled} episode(s) hit a degraded response and were left "
                "pending. Re-run later to pick them up."
            ))

        if result.errors:
            self.stdout.write(self.style.WARNING(f"\n{len(result.errors)} error(s):"))
            for error in result.errors[:20]:
                self.stdout.write(f"  {error['youtube_id']}: {error['error']}")
            if len(result.errors) > 20:
                self.stdout.write(f"  ... and {len(result.errors) - 20} more")

        if result.stored and not options["no_reindex"]:
            self.stdout.write(self.style.SUCCESS(
                f"\n{result.stored} transcript(s) stored and queued for indexing. "
                "Run `manage.py reindex --only transcripts` if the worker is not running."
            ))

    def _report_state(self, channel):
        transcripts = Transcript.objects.all()
        if channel is not None:
            transcripts = transcripts.filter(episode__channel=channel)
        stored = transcripts.filter(status=Transcript.Status.OK).count()
        none = transcripts.filter(status=Transcript.Status.UNAVAILABLE).count()
        self.stdout.write(f"  already stored   : {stored}")
        self.stdout.write(f"  known caption-less: {none}")

    def _show_tracks(self, video_id: str):
        from podcast.ingestion.transcripts import available_tracks

        tracks = available_tracks(video_id)
        if tracks["degraded"]:
            # 🚨 The one result that means nothing at all.
            self.stdout.write(self.style.WARNING(
                "Degraded response (no duration) - this listing is NOT trustworthy. "
                "YouTube is throttling; retry in a few hours."
            ))
        self.stdout.write(f"  manual: {', '.join(tracks['manual']) or '(none)'}")
        auto = tracks["auto"]
        preferred = [t for t in auto if t.startswith("bg")]
        self.stdout.write(f"  auto  : {len(auto)} languages, bg tracks: {preferred or '(none)'}")
