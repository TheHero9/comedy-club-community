"""Data that ships with the code rather than living in the database.

🚨 In the Docker image, not in `tmp/`. `removed-episodes.txt` is here for exactly
that reason - the purge list has to be readable by the same management command
running in production. Anything added here is subject to the same rule.
"""
