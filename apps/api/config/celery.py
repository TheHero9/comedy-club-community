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
    # Pull new episodes once a day, in the quiet hours (Europe/Sofia).
    "sync-channels-daily": {
        "task": "podcast.sync_all_channels",
        "schedule": crontab(hour=4, minute=0),
    },
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
}


@app.task(bind=True)
def debug_task(self):
    print(f"Request: {self.request!r}")
