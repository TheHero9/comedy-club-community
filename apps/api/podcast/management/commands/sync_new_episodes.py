"""Bring the catalogue current: every new upload on the active channels, fully done.

    python manage.py sync_new_episodes --dry-run              # what is new; writes nothing
    python manage.py sync_new_episodes                        # asks about short videos, then does everything
    python manage.py sync_new_episodes --channel @ivankirkov1
    python manage.py sync_new_episodes --limit 200            # look past the newest 50 per tab
    python manage.py sync_new_episodes --exclude ID ID --yes  # decide without prompts

Per active channel:

1. List the newest uploads on the videos + streams tabs (Data API; never shorts).
2. Drop ids already in the DB and ids on `podcast/data/removed-episodes.txt`.
3. 🚨 Ask about the SHORT ones (under `--ask-under` minutes). All 100 promo clips
   removed on 2026-08-15 were under 12 minutes, and nothing else in the metadata
   separates a clip from a real episode - a 1:45 news bulletin was real. A "no"
   goes onto the exclusion list, so it is never asked about again.
4. Write them (Data API metadata + thumbnail URL), refreshing view and like
   counts on the uploads already in.
5. yt-dlp, one request per episode, serially: members-only flag, chapters, and
   the Bulgarian captions as searchable transcript segments.
6. Index both Meilisearch indexes, synchronously.
7. Close on COUNTS: no degraded rows, no excluded video back, both indexes equal
   to Postgres. A failed check exits non-zero.

🔒 Refuses to run without YOUTUBE_API_KEY. The keyless fallback is scraping, and
scraping is the path that degraded 1,171 rows on 2026-08-13.

📌 Topic labels stay a step for a person (Claude in a session, like the existing
2,565): the run ends by printing the export command when there is work for it.
Write-up: specs/26-new-episode-pipeline/02-implementation-plan.md.
"""

import sys

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from podcast.data import add_removed_episodes, clock, exclusion_note
from podcast.models import Channel, Episode, Transcript
from podcast.services.ingestion import (
    IngestionResult,
    finish_channel_sync,
    list_channel_uploads,
    persist_uploads,
)

ADD, EXCLUDE, LATER = "add", "exclude", "later"


def _utf8_output() -> None:
    """🇧🇬 This command prints titles, so it cannot be ASCII-only like its siblings.

    A real Windows console takes Unicode already; a pipe or redirect gets cp1252
    and dies on the first Cyrillic letter. Reconfigure only what needs it.
    """
    for stream in (sys.stdout, sys.stderr):
        encoding = (getattr(stream, "encoding", "") or "").lower().replace("-", "")
        if encoding != "utf8" and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


class Command(BaseCommand):
    help = "Add every new upload on the active channels, with transcripts and search."

    def add_arguments(self, parser):
        parser.add_argument("--channel", help="One channel, by @handle or channel id")
        parser.add_argument(
            "--limit", type=int, default=50, help="Newest uploads to list per tab (default 50)"
        )
        parser.add_argument(
            "--dry-run", action="store_true", help="List what is new; write nothing"
        )
        parser.add_argument(
            "--ask-under",
            type=int,
            default=15,
            metavar="MINUTES",
            help="Ask before adding a new video shorter than this (default 15)",
        )
        parser.add_argument(
            "--yes", action="store_true", help="Add every new video without asking"
        )
        parser.add_argument(
            "--exclude",
            nargs="+",
            default=[],
            metavar="YOUTUBE_ID",
            help="New videos to put on the exclusion list instead of adding",
        )
        parser.add_argument(
            "--no-enrich",
            action="store_true",
            help="Skip the yt-dlp step (members-only flag, chapters, transcripts)",
        )
        parser.add_argument(
            "--enrich-limit",
            type=int,
            default=150,
            help="Most episodes to run through yt-dlp in one go (default 150)",
        )
        parser.add_argument(
            "--delay",
            type=float,
            default=None,
            help="Seconds between yt-dlp requests (default TRANSCRIPT_FETCH_DELAY)",
        )

    def handle(self, *args, **options):
        _utf8_output()

        if not settings.YOUTUBE_API_KEY:
            raise CommandError(
                "YOUTUBE_API_KEY is not set. This command lists uploads through the Data "
                "API only - the keyless fallback is scraping. Set it in apps/api/.env."
            )
        dry_run = options["dry_run"]
        if not dry_run:
            from podcast.search.client import is_available

            if not is_available(force=True):
                raise CommandError(
                    "Meilisearch is not reachable, so new episodes could not be made "
                    "searchable. Start it (docker compose up -d) and run again."
                )

        channels = self._channels(options["channel"])
        listings = self._list(channels, options["limit"], options["ask_under"] * 60)

        new = [candidate for listing in listings for candidate in listing.new]
        if dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                f"DRY RUN: {len(new)} new video(s) found, nothing was written"
            ))
            return

        decisions = self._decide(listings, options)
        self._write_exclusions(listings, decisions)
        created = self._persist(listings, decisions)

        enrich = None
        if not options["no_enrich"]:
            enrich = self._enrich(channels, options)

        self._index(channels, enrich)
        self._report(created, enrich, decisions)
        self._close()

    # ------------------------------------------------------------------
    # Steps
    # ------------------------------------------------------------------

    def _channels(self, target):
        channels = Channel.objects.filter(is_active=True).order_by("name")
        if target:
            handle = target if target.startswith("@") or target.startswith("UC") else f"@{target}"
            channels = Channel.objects.filter(handle=handle) | Channel.objects.filter(
                youtube_channel_id=target
            )
        channels = list(channels)
        if not channels:
            raise CommandError(f"No channel matching {target!r}" if target else "No active channels")
        return channels

    def _list(self, channels, limit, ask_under_sec):
        from podcast.ingestion.youtube_api import YouTubeAPIError

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"Listing the newest {limit} uploads per tab on {len(channels)} channel(s)"
        ))
        listings = []
        for channel in channels:
            try:
                listing = list_channel_uploads(channel, limit=limit)
            except YouTubeAPIError as exc:
                # A bad key or an exhausted quota fails every channel the same way.
                raise CommandError(f"{channel.handle}: {exc}") from exc
            listings.append(listing)

            known = len(listing.candidates) - len(listing.new)
            self.stdout.write("")
            self.stdout.write(
                f"{channel.handle}: {len(listing.new)} new, {known} already in, "
                f"{len(listing.excluded)} on the exclusion list"
            )
            for candidate in listing.new:
                if candidate.is_unfinished:
                    marker = "~"
                elif self._is_short(candidate, ask_under_sec):
                    marker = "?"
                else:
                    marker = " "
                self.stdout.write(
                    f"  {marker} {candidate.upload_date or '?':10s} "
                    f"{clock(candidate.duration_sec):>8s}  {candidate.kind:6s} "
                    f"{candidate.youtube_id}  {candidate.title}"
                )
            if listing.invisible:
                self.stdout.write(
                    f"  {len(listing.invisible)} listed but hidden from the API "
                    f"(deleted or private): {', '.join(listing.invisible)}"
                )
            for tab in listing.window_full:
                self.stdout.write(self.style.WARNING(
                    f"  every one of the newest {limit} on the {tab} tab is new - there may "
                    f"be more. Re-run with --limit {limit * 4}."
                ))

        self.stdout.write("")
        self.stdout.write(
            "  ? = shorter than the --ask-under threshold, asked about before adding\n"
            "  ~ = a scheduled premiere or a stream that is live now, left for a later run"
        )
        return listings

    @staticmethod
    def _is_short(candidate, ask_under_sec) -> bool:
        return candidate.duration_sec is None or candidate.duration_sec < ask_under_sec

    def _decide(self, listings, options):
        ask_under_sec = options["ask_under"] * 60
        excluded_now = set(options["exclude"])
        new_ids = {c.youtube_id for listing in listings for c in listing.new}
        stray = sorted(excluded_now - new_ids)
        if stray:
            self.stdout.write(self.style.WARNING(
                f"--exclude ignored for {len(stray)} id(s) that are not new uploads: "
                f"{', '.join(stray)}. For an episode already in, use remove_episodes."
            ))

        interactive = sys.stdin.isatty() and not options["yes"]
        decisions: dict[str, str] = {}
        held_for_answer = 0
        for listing in listings:
            for candidate in listing.new:
                if candidate.youtube_id in excluded_now:
                    decisions[candidate.youtube_id] = EXCLUDE
                elif candidate.is_unfinished:
                    decisions[candidate.youtube_id] = LATER
                elif not self._is_short(candidate, ask_under_sec) or options["yes"]:
                    decisions[candidate.youtube_id] = ADD
                elif interactive:
                    decisions[candidate.youtube_id] = self._ask(listing.channel, candidate)
                else:
                    decisions[candidate.youtube_id] = LATER
                    held_for_answer += 1

        if held_for_answer:
            self.stdout.write(self.style.WARNING(
                f"\n{held_for_answer} short video(s) held back: no terminal to ask in. "
                "Re-run with --exclude <ids> for the promo clips and --yes for the rest."
            ))
        return decisions

    def _ask(self, channel, candidate) -> str:
        self.stdout.write("")
        self.stdout.write(
            f"  {channel.handle}  {clock(candidate.duration_sec)}  {candidate.upload_date}  "
            f"https://www.youtube.com/watch?v={candidate.youtube_id}"
        )
        self.stdout.write(f"  {candidate.title}")
        while True:
            answer = input("  Add as an episode? [y]es / [n]o, never / [L]ater: ").strip().lower()
            if answer in {"y", "yes"}:
                return ADD
            if answer in {"n", "no"}:
                return EXCLUDE
            if answer in {"", "l", "later"}:
                return LATER

    def _write_exclusions(self, listings, decisions):
        rejected = [
            (
                candidate.youtube_id,
                exclusion_note(listing.channel.slug, candidate.duration_sec, candidate.title),
            )
            for listing in listings
            for candidate in listing.new
            if decisions[candidate.youtube_id] == EXCLUDE
        ]
        if rejected:
            added = add_removed_episodes(rejected, reason="Rejected in manage.py sync_new_episodes")
            self.stdout.write(f"\nexclusion list: {len(added)} id(s) added")

    def _persist(self, listings, decisions):
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Writing episodes (Data API)"))
        created = []
        for listing in listings:
            accepted = [
                candidate
                for candidate in listing.candidates
                if not candidate.is_new or decisions[candidate.youtube_id] == ADD
            ]
            rejected = sum(
                1 for c in listing.new if decisions[c.youtube_id] == EXCLUDE
            )
            result = IngestionResult(
                channel=listing.channel, excluded=len(listing.excluded) + rejected
            )
            created += persist_uploads(listing.channel, accepted, result)
            finish_channel_sync(listing.channel, result)
            self.stdout.write(f"  {listing.channel.handle}: {result.summary()}")
            for error in result.errors:
                self.stdout.write(self.style.ERROR(f"    {error['youtube_id']}: {error['error']}"))
        return created

    def _enrich(self, channels, options):
        from podcast.services.new_episodes import enrich_episodes, enrich_queryset

        pending = list(enrich_queryset(channels)[: options["enrich_limit"]])
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING(
            f"yt-dlp: members-only flag, chapters and transcript for {len(pending)} episode(s)"
        ))
        if not pending:
            return None
        return enrich_episodes(
            pending, delay=options["delay"], progress=lambda line: self.stdout.write(line)
        )

    def _index(self, channels, enrich):
        from podcast.services.new_episodes import index_synced

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Search indexes"))
        stored = enrich.stored_episode_ids if enrich else []
        try:
            episode_docs, segment_docs = index_synced([c.pk for c in channels], stored)
        except Exception as exc:
            raise CommandError(
                f"Indexing failed ({exc}). The episodes are saved; run "
                "`manage.py reindex` once Meilisearch is healthy."
            ) from exc
        self.stdout.write(f"  episodes: {episode_docs} documents sent")
        self.stdout.write(f"  transcript segments: {segment_docs} documents sent")

    def _report(self, created, enrich, decisions):
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Summary"))
        later = sum(1 for decision in decisions.values() if decision == LATER)
        excluded = sum(1 for decision in decisions.values() if decision == EXCLUDE)
        self.stdout.write(f"  new episodes added      : {len(created)}")
        self.stdout.write(f"  put on exclusion list   : {excluded}")
        self.stdout.write(f"  left for a later run    : {later}")

        if created:
            members_only = Episode.objects.filter(
                pk__in=[e.pk for e in created], members_only=True
            ).count()
            self.stdout.write(f"  members-only among them : {members_only}")

        if enrich:
            self.stdout.write(f"  transcripts stored      : {enrich.transcripts_stored} "
                              f"({enrich.segments_created} segments)")
            self.stdout.write(f"  no captions yet (fresh) : {enrich.transcripts_waiting}")
            self.stdout.write(f"  no captions             : {enrich.transcripts_unavailable}")
            self.stdout.write(f"  chapters added          : {enrich.chapters_created}")
            self.stdout.write(f"  availability corrected  : {enrich.availability_changed}")
            self.stdout.write(f"  throttled (still to do) : {len(enrich.throttled)}")
            for error in enrich.errors:
                self.stdout.write(self.style.ERROR(f"    {error['youtube_id']}: {error['error']}"))
            if enrich.aborted or enrich.throttled:
                self.stdout.write(self.style.WARNING(
                    "  YouTube throttled some requests. Nothing was written for those; "
                    "they are picked up by the next run. Wait a few hours - the block "
                    "lasts hours, not minutes."
                ))

        still_pending = Episode.objects.filter(transcript__isnull=True).count()
        self.stdout.write(f"  episodes still waiting on yt-dlp: {still_pending}")

        unlabelled = (
            Episode.objects.filter(transcript__status=Transcript.Status.OK, topics__isnull=True)
            .distinct()
            .count()
        )
        if unlabelled:
            self.stdout.write("")
            self.stdout.write(
                f"Next: {unlabelled} episode(s) have a transcript and no topic labels.\n"
                "  uv run python manage.py export_topic_batches --skip-labelled "
                "--out ../../tmp/topic-batches\n"
                "  then label the batches with Claude and run import_topic_labels."
            )

    def _close(self):
        from podcast.services.new_episodes import catalogue_checks

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Checks"))
        failed = 0
        for check in catalogue_checks():
            style = self.style.SUCCESS if check.ok else self.style.ERROR
            self.stdout.write(style(f"  {'ok  ' if check.ok else 'FAIL'} {check.name}: {check.detail}"))
            failed += int(not check.ok)
        if failed:
            raise CommandError(f"{failed} check(s) failed - the run is NOT complete")
