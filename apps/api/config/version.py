"""Which commit is this process actually running?

🚨 THE PROBLEM. Deploying the API and *knowing* the API deployed are two
different things, and this project has been caught by the gap twice. On
2026-08-15 two commits produced zero Railway deployments while the site looked
fine - it was serving an old schema. The documented check has been "read back
`list-deployments` and confirm the commitHash is yours", but that inspects what
Railway was *asked* to build, not what is *serving*, and it stops working
entirely for an upload-sourced deploy (`railway up` carries no git metadata).

So the running container reports its own commit, and verification becomes one
request that cannot lie about anything:

    curl -s https://api.comedycommunity.club/api/health   # -> {"version": "73c700f", ...}

Three sources, in order of trust:

 1. `BUILD_SHA`, a tracked file the deploy workflow overwrites with the commit
    it is shipping. Works for `railway up`, which is how CI deploys.
 2. `RAILWAY_GIT_COMMIT_SHA`, which Railway injects itself on a git-sourced
    deploy - so this keeps working if the GitHub App is ever installed and CI
    stops being the deploy path.
 3. `""` locally, where the question is meaningless.

⚠️ Read ONCE at import. A deployed commit cannot change under a running
process, and re-reading a file on every health check would put disk I/O on the
one endpoint that has to answer while everything else is broken.
"""

from __future__ import annotations

import os
from pathlib import Path

#: Short SHAs everywhere. Long enough to be unambiguous in this repo, short
#: enough to eyeball against `git log --oneline`.
SHA_LENGTH = 7

#: apps/api/config/version.py -> apps/api/BUILD_SHA
_BUILD_SHA_FILE = Path(__file__).resolve().parent.parent / "BUILD_SHA"

#: The placeholder the file carries in git. Treated as "unknown", so a build
#: that never ran the stamping step reports nothing rather than the word "dev".
_PLACEHOLDER = "dev"


def _read() -> str:
    try:
        stamped = _BUILD_SHA_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        # Missing or unreadable is not an error worth failing health over.
        stamped = ""

    if stamped and stamped != _PLACEHOLDER:
        return stamped[:SHA_LENGTH]

    railway = (os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "").strip()
    return railway[:SHA_LENGTH]


DEPLOYED_SHA: str = _read()

__all__ = ["DEPLOYED_SHA", "SHA_LENGTH"]
