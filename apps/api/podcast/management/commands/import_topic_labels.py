"""Attach reviewed topic labels to episodes, and queue them for reindexing.

    python manage.py import_topic_labels labels/batch-01.json
    python manage.py import_topic_labels labels/*.json --dry-run
    python manage.py import_topic_labels --clear            # remove ALL auto labels

Counterpart to `export_topic_batches`. Input is the JSON written after review:

    {"batch": "batch-01",
     "labels": [{"youtube_id": "...", "topics": ["Тревожност", "Първа среща"]}]}

🚨 Auto labels are attributed to a real Django user (`AUTO_LABELLER_USERNAME`),
never to `added_by=NULL`. NULL already means "added by a member whose account was
deleted", so reusing it would make machine labels indistinguishable from human
ones - and un-revertible. With a system user, `--clear` is exact.

✅ Topics resolve through `Topic.objects.get_or_create` on the SLUG, not the
name. That is what stops "Връзка с женен" and "връзка с женен" becoming two
canonical topics. 🇧🇬 `bg_slugify` keeps Cyrillic readable (`allow_unicode`).

✅ Score starts at 0. An auto label is a SUGGESTION; community votes are what
move it. Never seed a score to express model confidence - the number means
"what members think", and nothing else may write it.

⚠️ Reindexing is queued per episode through the same Celery task the API uses,
so a label is searchable without a full `manage.py reindex`. With no worker
running, pass --no-reindex and rebuild later; the labels themselves still land.
"""

import json
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from podcast.models import Episode, EpisodeTopic, Topic

AUTO_LABELLER_USERNAME = "auto-labeller"


def get_auto_labeller():
    """The system account every machine-generated label is attributed to."""
    User = get_user_model()
    user, created = User.objects.get_or_create(
        username=AUTO_LABELLER_USERNAME,
        defaults={"is_active": False, "first_name": "Автоматични етикети"},
    )
    if created:
        user.set_unusable_password()
        user.save(update_fields=["password"])
    return user


class Command(BaseCommand):
    help = "Attach reviewed topic labels from a batch JSON file to episodes."

    def add_arguments(self, parser):
        parser.add_argument("files", nargs="*", help="Batch label JSON files")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change, write nothing",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Delete every auto-generated label (exact inverse of an import)",
        )
        parser.add_argument(
            "--no-reindex",
            action="store_true",
            help="Skip queueing search reindex tasks (no Celery worker running)",
        )

    def handle(self, *args, **options):
        if options["clear"]:
            return self._clear(options["dry_run"])

        if not options["files"]:
            raise CommandError("Pass at least one batch JSON file, or --clear")

        labeller = get_auto_labeller()
        created_topics = 0
        created_links = 0
        existing_links = 0
        missing = []
        touched = set()

        for raw_path in options["files"]:
            path = Path(raw_path).expanduser()
            if not path.exists():
                raise CommandError(f"No such file: {path}")
            payload = json.loads(path.read_text(encoding="utf-8"))
            entries = payload.get("labels", [])

            for entry in entries:
                youtube_id = entry["youtube_id"]
                episode = Episode.objects.filter(youtube_id=youtube_id).first()
                if episode is None:
                    missing.append(youtube_id)
                    continue

                for name in entry.get("topics", []):
                    name = " ".join(name.split())
                    if not name:
                        continue
                    topic, topic_created = self._resolve_topic(name, options["dry_run"])
                    created_topics += int(topic_created)
                    if options["dry_run"] or topic is None:
                        created_links += 1
                        continue
                    _link, link_created = EpisodeTopic.objects.get_or_create(
                        episode=episode,
                        topic=topic,
                        defaults={"added_by": labeller},
                    )
                    if link_created:
                        created_links += 1
                        touched.add(episode.pk)
                    else:
                        existing_links += 1

            self.stdout.write(f"{path.name}: {len(entries)} episodes read")

        if options["dry_run"]:
            self.stdout.write("")
            self.stdout.write(
                f"DRY RUN: would create {created_topics} topics, {created_links} links"
            )
        else:
            self.stdout.write("")
            self.stdout.write(
                f"{created_topics} new topics, {created_links} new links, "
                f"{existing_links} already present"
            )
            if touched and not options["no_reindex"]:
                self._reindex(touched)

        if missing:
            self.stdout.write(f"WARNING: {len(missing)} unknown youtube ids: {missing[:5]}")

    def _resolve_topic(self, name, dry_run):
        """Canonical topic by slug. Returns (topic|None, created)."""
        from podcast.slugs import bg_slugify

        slug = bg_slugify(name, max_length=100)
        existing = Topic.objects.filter(slug=slug).first()
        if existing:
            return existing, False
        if dry_run:
            # Nothing is written, so remember what a real run would have made -
            # otherwise every repeat of a topic counts as another new topic and
            # the dry run reports one topic per link.
            seen = getattr(self, "_dry_run_slugs", None)
            if seen is None:
                seen = self._dry_run_slugs = set()
            was_new = slug not in seen
            seen.add(slug)
            return None, was_new
        with transaction.atomic():
            topic = Topic.objects.create(name=name, slug=slug)
        return topic, True

    def _reindex(self, episode_ids):
        try:
            from podcast import tasks
        except ImportError:  # pragma: no cover - Celery not installed
            self.stdout.write("celery tasks unavailable; run manage.py reindex")
            return
        queued = 0
        for episode_id in episode_ids:
            try:
                tasks.reindex_episode.delay(episode_id)
                queued += 1
            except Exception as exc:  # broker down - labels are still saved
                self.stdout.write(f"reindex queue failed ({exc}); run manage.py reindex")
                return
        self.stdout.write(f"queued {queued} reindex tasks")

    def _clear(self, dry_run):
        labeller = get_user_model().objects.filter(username=AUTO_LABELLER_USERNAME).first()
        if labeller is None:
            self.stdout.write("no auto-labeller account; nothing to clear")
            return
        links = EpisodeTopic.objects.filter(added_by=labeller)
        count = links.count()
        if dry_run:
            self.stdout.write(f"DRY RUN: would delete {count} auto labels")
            return
        links.delete()
        orphans = Topic.objects.filter(episodes__isnull=True)
        orphan_count = orphans.count()
        orphans.delete()
        self.stdout.write(f"deleted {count} auto labels and {orphan_count} orphan topics")
