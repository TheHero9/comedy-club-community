"""Permanently delete episodes that are not podcast episodes, from DB and search.

    python manage.py remove_episodes ../../tmp/to-remove.txt --dry-run
    python manage.py remove_episodes ../../tmp/to-remove.txt --yes

Input is one youtube id per line. Everything after `#` is ignored, so the list
copied straight out of `export_review_page`'s output pastes in unedited.
A JSON file written by that page's "Свали JSON" button is also accepted.

🚨 This DELETES. Django cascades from `Episode`, so a single row takes its
transcript, every transcript segment, its topic links, ratings, comments,
moments, chapters and watch events with it. The command counts all of that up
front and prints it, because "delete 100 episodes" and "delete 100 episodes and
14,000 transcript segments" are different decisions.

✅ A full JSON dump of every deleted row is written BEFORE anything is removed.
There is no undo otherwise: re-running the backfill is the only other way back,
and it would not restore community data.

🚨 Search is cleaned SYNCHRONOUSLY, not through Celery. The worker runs code
baked into its Docker image and may be stale or not running at all; a queued
removal that never executes leaves a deleted episode in the index, and every
search result for it is a 404. Both indexes are cleaned: `episodes` by document
id, `transcript_segments` by `episode_id` filter.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from podcast.models import (
    Chapter,
    Comment,
    Episode,
    EpisodeParticipant,
    EpisodeTopic,
    Favorite,
    Moment,
    Rating,
    Topic,
    TranscriptSegment,
    WatchEvent,
)


def parse_ids(path: Path) -> list[str]:
    """Youtube ids from a plain list or from the review page's JSON export."""
    text = path.read_text(encoding="utf-8")
    if text.lstrip().startswith("{"):
        payload = json.loads(text)
        return [row["youtube_id"] for row in payload.get("excluded", [])]

    ids = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            ids.append(line)
    return ids


class Command(BaseCommand):
    help = "Delete non-podcast episodes from the database and both search indexes."

    def add_arguments(self, parser):
        parser.add_argument("file", help="File of youtube ids (or the page's JSON)")
        parser.add_argument(
            "--dry-run", action="store_true", help="Report what would go, delete nothing"
        )
        parser.add_argument(
            "--yes", action="store_true", help="Skip the interactive confirmation"
        )
        parser.add_argument(
            "--backup",
            default=None,
            help="Where to write the pre-delete dump (default: <file>.backup.json)",
        )
        parser.add_argument(
            "--no-search",
            action="store_true",
            help="Leave the Meilisearch indexes alone (rebuild later with reindex)",
        )

    def handle(self, *args, **options):
        path = Path(options["file"]).expanduser()
        if not path.exists():
            raise CommandError(f"No such file: {path}")

        ids = parse_ids(path)
        if not ids:
            raise CommandError(f"No youtube ids found in {path}")
        unique = list(dict.fromkeys(ids))
        if len(unique) != len(ids):
            self.stdout.write(f"note: {len(ids) - len(unique)} duplicate ids collapsed")

        episodes = list(
            Episode.objects.filter(youtube_id__in=unique).select_related("channel")
        )
        found = {episode.youtube_id for episode in episodes}
        missing = [yid for yid in unique if yid not in found]

        self.stdout.write(f"{len(unique)} ids requested, {len(episodes)} matched")
        if missing:
            self.stdout.write(f"WARNING: {len(missing)} not in the database: {missing}")
        if not episodes:
            # Success, not an error: every requested id is already absent, which
            # IS the desired state. This matters because the command is armed as
            # a Railway `preDeployCommand`, which re-runs on EVERY deployment -
            # raising here would fail the second deploy and take the service down
            # for having already done its job.
            self.stdout.write("nothing to delete - all requested ids are already gone")
            return

        pks = [episode.pk for episode in episodes]
        cascade = self._cascade_counts(pks)

        self.stdout.write("")
        self.stdout.write("per channel:")
        per_channel: dict[str, int] = {}
        for episode in episodes:
            per_channel[episode.channel.handle] = per_channel.get(episode.channel.handle, 0) + 1
        for handle, count in sorted(per_channel.items(), key=lambda kv: -kv[1]):
            self.stdout.write(f"  {handle:28s} {count:5d}")

        self.stdout.write("")
        self.stdout.write("cascade - these rows go too:")
        for label, count in cascade.items():
            self.stdout.write(f"  {label:24s} {count:6d}")

        # A topic used ONLY by deleted episodes becomes an unreachable /t/ page.
        orphan_topics = self._orphan_topics(pks)
        if orphan_topics:
            self.stdout.write(
                f"  {'topics left orphaned':24s} {len(orphan_topics):6d}  "
                f"(deleted too: {', '.join(t.name for t in orphan_topics[:5])}"
                f"{'...' if len(orphan_topics) > 5 else ''})"
            )

        if options["dry_run"]:
            self.stdout.write("")
            self.stdout.write("DRY RUN: nothing was deleted")
            return

        if not options["yes"]:
            self.stdout.write("")
            answer = input(f"Permanently delete {len(episodes)} episodes? [y/N] ")
            if answer.strip().lower() not in {"y", "yes"}:
                self.stdout.write("aborted")
                return

        backup_path = Path(
            options["backup"] or path.with_suffix(".backup.json")
        ).expanduser()
        self._write_backup(backup_path, episodes, cascade, orphan_topics)
        self.stdout.write(f"backup written: {backup_path}")

        # Search first: a document pointing at a row that still exists is
        # recoverable, one pointing at a deleted row is a 404 in production.
        if not options["no_search"]:
            self._clean_search(pks)

        with transaction.atomic():
            deleted, breakdown = Episode.objects.filter(pk__in=pks).delete()
            orphan_ids = [topic.pk for topic in orphan_topics]
            orphan_deleted = 0
            if orphan_ids:
                orphan_deleted = Topic.objects.filter(pk__in=orphan_ids).delete()[0]

        self.stdout.write("")
        self.stdout.write(f"deleted {deleted} rows total:")
        for model_label, count in sorted(breakdown.items()):
            self.stdout.write(f"  {model_label:34s} {count:6d}")
        if orphan_deleted:
            self.stdout.write(f"  orphan topics                      {orphan_deleted:6d}")
        self.stdout.write("")
        self.stdout.write(f"episodes remaining: {Episode.objects.count()}")

    def _cascade_counts(self, pks):
        return {
            "transcript segments": TranscriptSegment.objects.filter(
                transcript__episode_id__in=pks
            ).count(),
            "topic links": EpisodeTopic.objects.filter(episode_id__in=pks).count(),
            "chapters": Chapter.objects.filter(episode_id__in=pks).count(),
            "moments": Moment.objects.filter(episode_id__in=pks).count(),
            "ratings": Rating.objects.filter(episode_id__in=pks).count(),
            "comments": Comment.objects.filter(episode_id__in=pks).count(),
            "favorites": Favorite.objects.filter(episode_id__in=pks).count(),
            "watch events": WatchEvent.objects.filter(episode_id__in=pks).count(),
            "participants": EpisodeParticipant.objects.filter(episode_id__in=pks).count(),
        }

    def _orphan_topics(self, pks):
        """Topics whose every episode is in the delete set."""
        topic_ids = set(
            EpisodeTopic.objects.filter(episode_id__in=pks).values_list("topic_id", flat=True)
        )
        if not topic_ids:
            return []
        survivors = set(
            EpisodeTopic.objects.filter(topic_id__in=topic_ids)
            .exclude(episode_id__in=pks)
            .values_list("topic_id", flat=True)
        )
        return list(Topic.objects.filter(pk__in=topic_ids - survivors).order_by("name"))

    def _write_backup(self, backup_path, episodes, cascade, orphan_topics):
        rows = []
        for episode in episodes:
            transcript = getattr(episode, "transcript", None)
            rows.append(
                {
                    "youtube_id": episode.youtube_id,
                    "channel": episode.channel.handle,
                    "title": episode.title,
                    "slug": episode.slug,
                    "description": episode.description,
                    "upload_date": (
                        episode.upload_date.isoformat() if episode.upload_date else None
                    ),
                    "duration_sec": episode.duration_sec,
                    "content_kind": episode.content_kind,
                    "availability": episode.availability,
                    "members_only": episode.members_only,
                    "view_count": episode.view_count,
                    "like_count": episode.like_count,
                    "public_score": (
                        float(episode.public_score) if episode.public_score is not None else None
                    ),
                    "rating_count": episode.rating_count,
                    "had_transcript": bool(transcript and transcript.status == "ok"),
                    "topics": [
                        link.topic.name
                        for link in episode.topics.select_related("topic").all()
                    ],
                }
            )
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        backup_path.write_text(
            json.dumps(
                {
                    "deleted_count": len(rows),
                    "cascade": cascade,
                    "orphan_topics": [topic.name for topic in orphan_topics],
                    "episodes": rows,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def _clean_search(self, pks):
        """Two requests, not two per episode.

        ⚠️ The per-episode helpers (`remove_episode`, `remove_episode_segments`)
        are built for the incremental path, where one episode changes. Calling
        them in a loop issues 2N HTTP round trips; at N=100 that stalled long
        enough to look like a hang. Meilisearch deletes a whole id list in one
        call, and filters accept `IN`, so the batch path is two requests
        regardless of N.
        """
        from podcast.search.client import (
            EPISODES_INDEX,
            TRANSCRIPTS_INDEX,
            get_client,
        )
        from podcast.search.transcript_index import ensure_index_once

        try:
            client = get_client()
            client.index(EPISODES_INDEX).delete_documents([int(pk) for pk in pks])
            self.stdout.write(f"search: queued removal of {len(pks)} episode documents")
        except Exception as exc:  # index down - the DB delete must still proceed
            self.stdout.write(
                f"WARNING: episodes index removal failed ({exc}); "
                f"run manage.py reindex afterwards"
            )

        try:
            # Deleting by filter, never by computed id: segment ids depend on the
            # window size, so an id list built now would miss an older windowing.
            ensure_index_once()
            ids = ",".join(str(int(pk)) for pk in pks)
            client.index(TRANSCRIPTS_INDEX).delete_documents(
                filter=f"episode_id IN [{ids}]"
            )
            self.stdout.write("search: queued removal of their transcript segments")
        except Exception as exc:
            self.stdout.write(
                f"WARNING: transcript index removal failed ({exc}); "
                f"run manage.py reindex --only transcripts afterwards"
            )
