"""Who added a topic label: a member, or the machine.

🚨 THIS IS DERIVED FROM `added_by`, NOT FROM A NEW COLUMN, and that is
deliberate. `import_topic_labels` already attributes every machine-generated
label to one real Django account (`AUTO_LABELLER_USERNAME`) precisely so the two
can be told apart and so `--clear` is exact. A parallel `source` column would be
a second answer to the same question, and the two would drift the first time a
label was moved, merged or re-imported.

The distinction has to reach the UI because the two kinds of label mean
different things to a reader. The catalogue's 2,565 labels today are all
machine-suggested from titles and transcripts; the whole point of the community
layer is that members add and correct them. A page that renders both identically
tells a member their contribution is indistinguishable from a guess - and tells
a reader a guess is a fact.
"""

from django.contrib.auth import get_user_model
from django.core.cache import cache

from podcast.management.commands.import_topic_labels import AUTO_LABELLER_USERNAME

CACHE_KEY = "podcast:auto-labeller-id"
CACHE_SECONDS = 600

# 🚨 A real user id is never 0, so 0 is safe as "we looked and there is no such
# account". Caching `None` is indistinguishable from a cache miss, which would
# make every request re-query on a site that has never run the labeller.
_ABSENT = 0


def auto_labeller_id() -> int | None:
    """The id of the system account machine labels are attributed to, or None.

    Cached because it is read once per episode-detail response and the answer
    changes at most once in the lifetime of the deployment. The TTL is short
    enough that creating the account (the labeller's first run) shows up within
    ten minutes rather than needing a restart.
    """
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return None if cached == _ABSENT else cached

    found = (
        get_user_model()
        .objects.filter(username=AUTO_LABELLER_USERNAME)
        .values_list("id", flat=True)
        .first()
    )
    cache.set(CACHE_KEY, found if found is not None else _ABSENT, CACHE_SECONDS)
    return found
