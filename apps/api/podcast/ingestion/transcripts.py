"""YouTube caption extraction.

🎯 The FREE transcript route, validated on `AXnI79sQd3Q` (Комеди Клуб Подкаст,
2h38m) on 2026-08-09: YouTube already holds a Bulgarian ASR track for a large
part of the catalogue, and yt-dlp hands it over with no API key, no GPU and no
per-minute cost. 3,586 cues / 26,403 words / ~4s for that episode.

🚨 `bg-orig` is the ORIGINAL-language ASR track. A bare `bg` on a Bulgarian
video is the same content, but on a non-Bulgarian video it would be a machine
TRANSLATION into Bulgarian, which is not what we want to index. Preference order
below always puts `-orig` first and treats a translated track as a last resort.

🚨 A missing caption track and a THROTTLED response look identical from here.
The same soft-block that silently strips `duration` from a backfill also strips
`automatic_captions`, so "this episode has no captions" is only believable when
the response also carried a duration. `fetch_transcript` refuses to answer
"none" on a degraded response - it raises `TranscriptThrottled` instead, exactly
like `metadata_repair` refuses to write from one. Recording a false "no
captions" would be permanent: nothing would ever re-check that episode.

⚠️ Members-only episodes have no captions at all (5 of 5 checked). That is a
real absence, not a block, and it is why `availability` is not a filter here.

This module returns plain dicts and touches no Django models. Persistence is the
job of podcast.services.transcripts.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from django.conf import settings

from .yt_dlp_backfill import IngestionError, fetch_video_info

logger = logging.getLogger("podcast")

# yt-dlp exposes several caption formats. json3 is the only one that carries
# per-word offsets and a machine-readable event structure; the rest are display
# formats we would have to re-parse out of markup.
CAPTION_FORMAT = "json3"

# Not a caption track. YouTube lists replayed live chat under `subtitles`, and it
# would otherwise win the "manual beats automatic" preference below.
IGNORED_TRACKS = frozenset({"live_chat"})

# Seconds. Long enough that a segment reads as a thought rather than a fragment,
# short enough that the timestamp still lands the viewer on the right moment.
# 60s => ~154 segments and ~171 words per segment on the probed episode.
DEFAULT_SEGMENT_SECONDS = 60

# A hard ceiling per segment, in case a stretch of dense speech blows past the
# window. Keeps a single Meilisearch document from becoming an outlier.
MAX_SEGMENT_CHARS = 3_000

# The caption URL is signed and short-lived, so it is fetched immediately after
# extraction and never stored.
CAPTION_TIMEOUT_SECONDS = 20
CAPTION_USER_AGENT = "Mozilla/5.0 (compatible; comedy-club-community/1.0)"


class TranscriptUnavailable(IngestionError):
    """The episode genuinely has no caption track we want.

    Safe to record as a permanent 'none' - the response was complete.
    """


class TranscriptThrottled(IngestionError):
    """The response was degraded, so caption absence proves nothing.

    🚨 NEVER record this as 'no captions'. Retry later, hours not minutes.
    """


@dataclass
class Cue:
    start_sec: float
    end_sec: float
    text: str


@dataclass
class TranscriptPayload:
    """Everything one episode's caption fetch produces."""

    youtube_id: str
    source: str
    language: str
    track_id: str = ""
    is_auto: bool = True
    cues: list[Cue] = field(default_factory=list)

    @property
    def word_count(self) -> int:
        return sum(len(cue.text.split()) for cue in self.cues)


# ---------------------------------------------------------------------------
# Track selection
# ---------------------------------------------------------------------------


def _preferred_languages() -> tuple[str, ...]:
    return tuple(getattr(settings, "TRANSCRIPT_LANGUAGES", ("bg",)))


def _rank_track(track_id: str, preferred: tuple[str, ...]) -> int | None:
    """Lower is better. None means "not a language we want".

    `bg-orig` (original ASR) beats `bg` (which may be a translation), and both
    beat `bg-BG`-style regional variants.
    """
    if track_id in IGNORED_TRACKS:
        return None
    base = track_id.split("-")[0].lower()
    for position, language in enumerate(preferred):
        if base != language.lower():
            continue
        if track_id.endswith("-orig"):
            return position * 10
        if track_id.lower() == language.lower():
            return position * 10 + 1
        return position * 10 + 2
    return None


def select_track(info: dict, preferred: tuple[str, ...] | None = None) -> tuple[str, str, bool]:
    """Pick the best caption track. Returns (track_id, url, is_auto).

    Creator-uploaded captions (`subtitles`) beat auto-generated ones
    (`automatic_captions`) at equal language rank - a human transcript is
    punctuated and far more accurate than ASR.
    """
    preferred = preferred or _preferred_languages()

    best: tuple[int, str, str, bool] | None = None
    for is_auto, bucket in ((False, info.get("subtitles")), (True, info.get("automatic_captions"))):
        for track_id, formats in (bucket or {}).items():
            rank = _rank_track(track_id, preferred)
            if rank is None:
                continue
            url = next(
                (f.get("url") for f in (formats or []) if f.get("ext") == CAPTION_FORMAT), None
            )
            if not url:
                continue
            # is_auto is the tiebreak: manual (False) sorts before automatic.
            candidate = (rank, track_id, url, is_auto)
            if best is None or (rank, is_auto) < (best[0], best[3]):
                best = candidate

    if best is None:
        raise TranscriptUnavailable(
            f"No {'/'.join(preferred)} {CAPTION_FORMAT} caption track on this video"
        )
    return best[1], best[2], best[3]


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def parse_json3(raw: bytes) -> list[Cue]:
    """json3 caption events -> clean cues.

    ⚠️ Auto-captions are a ROLLING WINDOW. Roughly half the events are
    `{"aAppend": 1, "segs": [{"utf8": "\\n"}]}` scroll fillers that carry no new
    text; keeping them doubles the row count and injects blank documents. They
    are dropped here, which is what takes 7,171 raw events down to 3,586 cues.
    """
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TranscriptUnavailable(f"Caption payload was not valid json3: {exc}") from exc

    cues: list[Cue] = []
    for event in data.get("events") or []:
        if event.get("aAppend"):
            continue
        segments = event.get("segs") or []
        text = " ".join("".join(s.get("utf8", "") for s in segments).split())
        if not text:
            continue
        start = float(event.get("tStartMs") or 0) / 1000.0
        duration = float(event.get("dDurationMs") or 0) / 1000.0
        cues.append(Cue(start_sec=start, end_sec=start + duration, text=text))

    cues.sort(key=lambda cue: cue.start_sec)
    return cues


def chunk_cues(
    cues: list[Cue],
    *,
    window_sec: int = DEFAULT_SEGMENT_SECONDS,
    max_chars: int = MAX_SEGMENT_CHARS,
) -> list[Cue]:
    """Group cues into fixed windows.

    A cue is ~2s of speech, which is too granular to be a search result: a
    phrase spanning two cues would match neither. Windowing trades timestamp
    precision for recall, and the window start is still an exact deep link.
    """
    if not cues:
        return []

    chunks: list[Cue] = []
    buffer: list[str] = []
    start = cues[0].start_sec
    end = cues[0].end_sec
    size = 0

    def flush() -> None:
        nonlocal buffer, size
        if buffer:
            chunks.append(Cue(start_sec=start, end_sec=max(end, start), text=" ".join(buffer)))
        buffer = []
        size = 0

    for cue in cues:
        too_long = cue.start_sec - start >= window_sec
        too_big = size + len(cue.text) > max_chars
        if buffer and (too_long or too_big):
            flush()
            start = cue.start_sec
        buffer.append(cue.text)
        size += len(cue.text) + 1
        end = max(end, cue.end_sec)

    flush()
    return chunks


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------


def download_caption_track(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": CAPTION_USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=CAPTION_TIMEOUT_SECONDS) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        # A signed caption URL that 403s is the throttle wearing a different hat.
        if exc.code in (403, 429):
            raise TranscriptThrottled(
                f"Caption download rejected with HTTP {exc.code} - back off and retry later"
            ) from exc
        if exc.code >= 500:
            # A Google-side failure is transient. It proves nothing about whether
            # the episode has captions, so it must never become "unavailable".
            raise TranscriptThrottled(
                f"Caption download failed with HTTP {exc.code} - transient, retry later"
            ) from exc
        raise TranscriptUnavailable(f"Caption download failed with HTTP {exc.code}") from exc
    except OSError as exc:
        # 🚨 A timeout or connection reset is OUR network failing, not YouTube
        # stating "no captions". The track was already FOUND by select_track, so
        # recording unavailable here would be a false negative that sticks for
        # TRANSCRIPT_RECHECK_DAYS - and under --force it would delete a stored
        # transcript. Raise the retryable error instead; nothing gets written.
        raise TranscriptThrottled(
            f"Caption download failed: {exc} - transient, retry later"
        ) from exc


def fetch_transcript(
    youtube_id: str,
    *,
    info: dict | None = None,
    preferred: tuple[str, ...] | None = None,
) -> TranscriptPayload:
    """Fetch and parse one episode's captions.

    Raises `TranscriptThrottled` when the response is degraded and
    `TranscriptUnavailable` when the episode genuinely has none.

    Pass `info` to reuse a metadata response the caller already paid for.
    """
    info = info if info is not None else fetch_video_info(youtube_id)

    # 🚨 Same marker `metadata_repair` trusts: a full player response always
    # carries a duration. Without one, an empty `automatic_captions` means
    # "YouTube did not tell us", not "there are none".
    if info.get("duration") is None:
        raise TranscriptThrottled(
            f"Degraded response for {youtube_id} (no duration) - caption absence is not "
            "trustworthy. Retry in a few hours."
        )

    track_id, url, is_auto = select_track(info, preferred)
    cues = parse_json3(download_caption_track(url))
    if not cues:
        raise TranscriptUnavailable(f"Caption track {track_id!r} parsed to zero cues")

    logger.info(
        "Fetched %d cues from %s track %r for %s", len(cues), "auto" if is_auto else "manual",
        track_id, youtube_id,
    )
    return TranscriptPayload(
        youtube_id=youtube_id,
        source="youtube_auto" if is_auto else "youtube_manual",
        language=track_id.split("-")[0].lower(),
        track_id=track_id,
        is_auto=is_auto,
        cues=cues,
    )


def available_tracks(youtube_id: str, *, info: dict | None = None) -> dict[str, list[str]]:
    """What caption tracks exist. Diagnostic helper for probing a new channel."""
    info = info if info is not None else fetch_video_info(youtube_id)
    return {
        "manual": sorted(t for t in (info.get("subtitles") or {}) if t not in IGNORED_TRACKS),
        "auto": sorted(info.get("automatic_captions") or {}),
        "degraded": info.get("duration") is None,
    }
