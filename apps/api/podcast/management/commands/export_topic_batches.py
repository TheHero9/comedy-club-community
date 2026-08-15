"""Export transcript digests in reviewable batches, for topic labelling.

    python manage.py export_topic_batches --out ../../tmp/topic-batches
    python manage.py export_topic_batches --channel @ivankirkov1
    python manage.py export_topic_batches --max-chars 90000 --window-chars 200

Only episodes with `transcript__status="ok"` are exported - an episode with no
captions has nothing to label from.

🚨 A digest is a LOSSY view of the transcript, on purpose. The full catalogue is
9.8M words; nothing can read all of it at once. Each ~60s transcript window is
truncated to its first `--window-chars` characters, which is enough to tell what
the window is ABOUT. A topic that runs five minutes appears in five windows, so
big topics survive truncation. A 40-second aside does not - and that is the
intended cut, since those belong in `Moment`, not `Topic`.

⚠️ Batches are filled by CHARACTER budget, not episode count. Word counts run
from 6 to 65,606, so "25 episodes" is a meaningless unit of work; a character
budget makes every batch about equally expensive to read.

✅ Ordering is deterministic (channel, upload date, youtube id), so re-running
produces identical batches and a half-finished labelling run can resume.
📌 Counterpart: `import_topic_labels` reads the JSON written after review.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from podcast.models import Episode, Topic

DEFAULT_WINDOW_CHARS = 140
DEFAULT_MAX_CHARS = 120_000
DEFAULT_EPISODE_CHARS = 45_000
DEFAULT_PART_CHARS = 50_000
MIN_WINDOW_CHARS = 100


def _truncate(text, limit):
    """First `limit` characters, cut back to a word boundary."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    if space > limit // 2:
        cut = cut[:space]
    return cut + "..."


def _hms(seconds):
    seconds = int(seconds or 0)
    return f"{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def build_digest(episode, window_chars, episode_chars):
    """One episode's digest as a list of lines. Pure function - no IO."""
    segments = list(episode.transcript.segments.order_by("start_sec"))
    if not segments:
        return None

    # Adaptive: a 6-hour episode must not eat the whole batch budget.
    per_window = window_chars
    if len(segments) * window_chars > episode_chars:
        per_window = max(MIN_WINDOW_CHARS, episode_chars // len(segments))

    lines = [
        f"## {episode.youtube_id}",
        f"TITLE: {episode.title}",
        f"CHANNEL: {episode.channel.name}",
        f"DATE: {episode.upload_date}  DURATION: {_hms(episode.duration_sec)}  "
        f"WORDS: {episode.transcript.word_count}  WINDOWS: {len(segments)}",
        "",
    ]
    for segment in segments:
        start = int(segment.start_sec)
        stamp = f"{start // 60}:{start % 60:02d}"
        lines.append(f"[{stamp}] {_truncate(segment.text, per_window)}")
    lines.append("")
    return lines


class Command(BaseCommand):
    help = "Export transcript digests in batches, ready for topic labelling."

    def add_arguments(self, parser):
        parser.add_argument(
            "--out",
            default="topic-batches",
            help="Directory to write batch files into (created if missing)",
        )
        parser.add_argument(
            "--channel",
            action="append",
            default=None,
            help="Limit to a channel handle or youtube id. Repeat for several.",
        )
        parser.add_argument(
            "--window-chars",
            type=int,
            default=DEFAULT_WINDOW_CHARS,
            help=f"Characters kept per ~60s window (default {DEFAULT_WINDOW_CHARS})",
        )
        parser.add_argument(
            "--episode-chars",
            type=int,
            default=DEFAULT_EPISODE_CHARS,
            help=f"Soft cap on one episode's digest (default {DEFAULT_EPISODE_CHARS})",
        )
        parser.add_argument(
            "--max-chars",
            type=int,
            default=DEFAULT_MAX_CHARS,
            help=f"Character budget per batch (default {DEFAULT_MAX_CHARS})",
        )
        parser.add_argument(
            "--batches",
            type=int,
            default=None,
            help="Split into exactly N equal-cost batches, overriding --max-chars",
        )
        parser.add_argument(
            "--part-chars",
            type=int,
            default=DEFAULT_PART_CHARS,
            help=(
                f"Split each batch into part files of this size (default "
                f"{DEFAULT_PART_CHARS}). One part is one readable chunk."
            ),
        )
        parser.add_argument(
            "--min-words",
            type=int,
            default=200,
            help="Skip transcripts shorter than this (default 200). Reported, never silent.",
        )
        parser.add_argument(
            "--skip-labelled",
            action="store_true",
            help="Exclude episodes that already carry at least one topic",
        )

    def handle(self, *args, **options):
        window_chars = options["window_chars"]
        if window_chars < MIN_WINDOW_CHARS:
            raise CommandError(f"--window-chars must be at least {MIN_WINDOW_CHARS}")

        out_dir = Path(options["out"]).expanduser().resolve()
        out_dir.mkdir(parents=True, exist_ok=True)

        episodes = (
            Episode.objects.filter(transcript__status="ok")
            .select_related("channel", "transcript")
            .order_by("channel__handle", "upload_date", "youtube_id")
        )
        if options["channel"]:
            wanted = Q()
            for target in options["channel"]:
                wanted |= Q(channel__handle__iexact=target) | Q(
                    channel__youtube_channel_id=target
                )
            episodes = episodes.filter(wanted)
            if not episodes.exists():
                raise CommandError(f"No transcribed episodes for {options['channel']}")
        if options["skip_labelled"]:
            episodes = episodes.filter(topics__isnull=True)

        skipped = []
        digests = []
        for episode in episodes:
            if (episode.transcript.word_count or 0) < options["min_words"]:
                skipped.append((episode.youtube_id, episode.transcript.word_count or 0))
                continue
            lines = build_digest(episode, window_chars, options["episode_chars"])
            if lines is None:
                skipped.append((episode.youtube_id, 0))
                continue
            digests.append((episode, lines, sum(len(line) + 1 for line in lines)))

        # A batch is a character budget, never an episode count: word counts run
        # 200..65,606, so "56 episodes" is not a unit of work but "900k chars" is.
        if options["batches"]:
            total = sum(size for _e, _l, size in digests)
            max_chars = total // options["batches"] + 1
        else:
            max_chars = options["max_chars"]

        batches = []
        current, current_chars = [], 0
        for entry in digests:
            if current and current_chars + entry[2] > max_chars:
                batches.append(current)
                current, current_chars = [], 0
            current.append(entry)
            current_chars += entry[2]
        if current:
            batches.append(current)

        # Greedy filling overshoots by one short tail batch. Fold it back so
        # `--batches 10` means ten, not "ten and a stub".
        if options["batches"]:
            while len(batches) > options["batches"]:
                batches[-2].extend(batches.pop())

        manifest = {
            "window_chars": window_chars,
            "max_chars": max_chars,
            "min_words": options["min_words"],
            "batch_count": len(batches),
            "episode_count": sum(len(b) for b in batches),
            "skipped": [{"youtube_id": yid, "word_count": wc} for yid, wc in skipped],
            "batches": [],
        }

        part_chars = options["part_chars"]
        for number, batch in enumerate(batches, start=1):
            name = f"batch-{number:02d}"
            batch_dir = out_dir / name
            batch_dir.mkdir(exist_ok=True)

            # Parts exist so one file is one readable chunk. An episode is never
            # split across two parts - a half-read episode would be mislabelled.
            parts, current, current_chars = [], [], 0
            for entry in batch:
                if current and current_chars + entry[2] > part_chars:
                    parts.append(current)
                    current, current_chars = [], 0
                current.append(entry)
                current_chars += entry[2]
            if current:
                parts.append(current)

            part_meta = []
            for part_number, part in enumerate(parts, start=1):
                part_name = f"part-{part_number:02d}.md"
                header = [
                    f"# {name} / {part_name}  ({len(part)} episodes)",
                    "Label the BIG topics only - what the episode is actually about,",
                    "not every joke. Reuse a vocabulary topic whenever one fits;",
                    "invent a new one only for a genuinely new subject.",
                    "",
                ]
                body = []
                for _episode, lines, _size in part:
                    body.extend(lines)
                (batch_dir / part_name).write_text(
                    "\n".join(header + body), encoding="utf-8"
                )
                part_meta.append(
                    {
                        "file": f"{name}/{part_name}",
                        "episodes": [e.youtube_id for e, _l, _s in part],
                        "chars": sum(s for _e, _l, s in part),
                    }
                )

            manifest["batches"].append(
                {
                    "name": name,
                    "parts": part_meta,
                    "episodes": [e.youtube_id for e, _l, _s in batch],
                    "chars": sum(s for _e, _l, s in batch),
                }
            )
            self.stdout.write(
                f"{name}: {len(batch):3d} episodes, {len(parts):2d} parts, "
                f"{sum(s for _e, _l, s in batch):,} chars"
            )

        vocabulary = list(Topic.objects.order_by("name").values("name", "slug"))
        (out_dir / "vocabulary.json").write_text(
            json.dumps(vocabulary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (out_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        self.stdout.write("")
        self.stdout.write(
            f"{manifest['episode_count']} episodes in {len(batches)} batches -> {out_dir}"
        )
        self.stdout.write(f"vocabulary: {len(vocabulary)} existing topics")
        if skipped:
            self.stdout.write(
                f"skipped {len(skipped)} transcripts under {options['min_words']} words "
                f"(listed in manifest.json)"
            )
