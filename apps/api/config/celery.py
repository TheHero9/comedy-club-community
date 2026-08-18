"""Celery application.

Tasks are thin wrappers over podcast/services/ - never put logic in a task body, so
the management command and the scheduler always run identical code.
"""

import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("comedy_club")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
    # 🚨 The daily channel sync is DELIBERATELY NOT SCHEDULED (owner decision,
    # 2026-08-15). 100 promo clips and stand-up excerpts were reviewed and
    # deleted from the catalogue; ingestion is `update_or_create(youtube_id=...)`,
    # so a scheduled sync would recreate every one of them the next morning and
    # silently undo that pass. Re-enabling this entry without an exclusion list
    # first WILL resurrect them - see `remove_episodes` and tmp/to-remove.txt.
    #
    # New episodes are pulled deliberately instead: `manage.py sync_channels`.
    # The trade-off is a catalogue that goes stale until someone runs it.
    # Self-healing score sweep. Ratings recompute on write, so this only repairs
    # drift from a missed signal or a verification change - hourly is plenty.
    "recompute-scores-hourly": {
        "task": "podcast.recompute_all_scores",
        "schedule": crontab(minute=20),
    },
    # Keep the search index honest even if an indexing task was lost.
    "reindex-search-nightly": {
        "task": "podcast.rebuild_search_index",
        "schedule": crontab(hour=5, minute=0),
    },
    # Same self-heal for the transcript index. Without it, segments of a deleted
    # episode (or a transcript later marked unavailable) would linger in
    # /search/transcripts until someone manually ran `manage.py reindex`.
    "reindex-transcripts-nightly": {
        "task": "podcast.rebuild_transcript_index",
        "schedule": crontab(hour=5, minute=30),
    },
    # 🚨 Keeps both Meilisearch indexes RESIDENT. Not a health check - the
    # health endpoint answered fine 30 seconds before the 2026-08-18 incident,
    # because a healthy server and a paged-in index are different claims. See
    # podcast/search/warm.py for the 5ms-of-work-inside-14.5s-of-waiting log
    # line that this exists for.
    #
    # Every 4 minutes: often enough that the transcript index has no quiet
    # stretch to be evicted in, cheap enough that it is one round trip and a
    # single-digit-millisecond count. On the WORKER, not in a request - the page
    # cache it warms lives in the Meilisearch container, so it does not matter
    # who asks.
    "warm-search-indexes": {
        "task": "podcast.warm_search_indexes",
        "schedule": crontab(minute="*/4"),
    },
}


@app.task(bind=True)
def debug_task(self):
    print(f"Request: {self.request!r}")
