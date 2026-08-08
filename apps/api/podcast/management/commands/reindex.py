"""Rebuild the Meilisearch episode index from Postgres.

    python manage.py reindex            # upsert every episode, drop stale docs
    python manage.py reindex --drop     # delete the index first, rebuild from nothing
    python manage.py reindex --batch-size 200

🚨 Postgres is the source of truth. A wiped Meilisearch must be fully
rebuildable with this one command - that is what `--drop` proves.

⚠️ Output is deliberately ASCII only. The Windows console is cp1252 and dies on
Cyrillic, so this command never prints an episode title. Anything that does
needs `PYTHONIOENCODING=utf-8`.

📌 Celery wrappers this command shares its code path with (owned by tasks.py,
see the wave report): `reindex_episode`, `remove_episode_from_index`,
`rebuild_search_index`. They call podcast.search directly - never this command.
"""

from django.core.management.base import BaseCommand, CommandError

from podcast.search import client as search_client
from podcast.search import index as search_index


class Command(BaseCommand):
    help = "Rebuild the Meilisearch 'episodes' index from Postgres."

    def add_arguments(self, parser):
        parser.add_argument(
            "--drop",
            action="store_true",
            help="Delete the index before rebuilding (proves a from-empty rebuild)",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=search_index.DEFAULT_BATCH_SIZE,
            help=f"Documents per Meilisearch batch (default {search_index.DEFAULT_BATCH_SIZE})",
        )

    def handle(self, *args, **options):
        batch_size = options["batch_size"]
        if batch_size < 1:
            raise CommandError("--batch-size must be at least 1")

        drop = options["drop"]

        self.stdout.write(self.style.MIGRATE_HEADING("Rebuilding the Meilisearch index"))
        self.stdout.write(f"  target: {search_client.EPISODES_INDEX} @ {self._meili_url()}")

        # The CLI is the one place that wants a loud failure, so check up front
        # instead of silently no-opping like the request path does.
        if not search_client.is_available(force=True):
            raise CommandError(
                f"Meilisearch is unreachable at {self._meili_url()}. "
                "Start it (docker compose up -d meilisearch) and try again."
            )

        if drop:
            self.stdout.write(self.style.WARNING("  --drop: deleting the index first"))

        try:
            result = search_index.rebuild_all(
                drop=drop,
                batch_size=batch_size,
                progress=lambda message: self.stdout.write(f"  {message}"),
            )
        except search_client.SEARCH_ERRORS as exc:
            raise CommandError(f"Reindex failed: {exc}") from exc

        elapsed = result["elapsed_sec"]
        indexed = result["documents_indexed"]
        rate = indexed / elapsed if elapsed > 0 else 0.0

        self.stdout.write("")
        self.stdout.write(f"  episodes in Postgres : {result['episodes_in_db']}")
        self.stdout.write(f"  documents indexed    : {indexed}")
        self.stdout.write(f"  stale docs removed   : {result['stale_removed']}")
        self.stdout.write(f"  elapsed              : {elapsed:.2f}s ({rate:.0f} docs/s)")

        index_stats = search_index.stats()
        if index_stats:
            self.stdout.write(
                f"  documents in index   : {index_stats.get('number_of_documents', '?')}"
            )

        if indexed != result["episodes_in_db"]:
            self.stdout.write(
                self.style.WARNING("  WARNING: indexed count does not match the database count")
            )

        self.stdout.write(self.style.SUCCESS(f"Reindex complete: {indexed} episodes searchable"))

    @staticmethod
    def _meili_url() -> str:
        from django.conf import settings

        return settings.MEILI_URL
