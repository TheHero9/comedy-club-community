"""Gunicorn settings. Gunicorn reads `./gunicorn.conf.py` on its own, so whatever
starts it from this directory (the Dockerfile CMD, Railway's start command) picks
this up with no flag. Command-line arguments such as `--workers` still win.
"""


def post_worker_init(worker):
    """Keep the search indexes warm from this worker. See podcast/search/warm.py.

    Here, and not in `AppConfig.ready()`, so that only a serving process runs it:
    `ready()` also fires for every management command and every test run.
    """
    from podcast.search.warm import start_keep_warm_thread

    start_keep_warm_thread()
