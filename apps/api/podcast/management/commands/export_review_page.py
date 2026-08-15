"""Export a standalone HTML page for eyeballing the catalogue and marking junk.

    python manage.py export_review_page --out ../../tmp/review.html
    python manage.py export_review_page --max-duration 900   # only short ones

The catalogue was ingested from the `videos` and `streams` tabs, which on these
channels also carry promo clips, trailers and stand-up excerpts that are not
podcast episodes. Nothing in the metadata reliably separates those from a real
episode - duration is a hint, not a rule (a 4-minute news bulletin is real; a
12-minute promo reel is not). So this is a human pass, and the page exists to
make 1,962 of them bearable.

✅ Output is ONE self-contained file. Data is baked in as JSON, so it opens from
`file://` with no server, no build step and no network except YouTube's
thumbnail CDN. Nothing here is part of the app.

✅ Marks persist in `localStorage`, keyed by youtube id. A pass over 1,962 items
is not one sitting, and losing it to a closed tab would be the whole cost of the
task. `--out` may be regenerated after a sync; existing marks survive because
the key is the youtube id, never a row position.

🚨 The page MARKS, it does not delete. Deleting rows would not stick: ingestion
is `update_or_create(youtube_id=...)`, so the next `sync_channels` recreates
every deleted episode. The exported id list is the input to a real exclusion
mechanism, which has to be a flag the ingester respects.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, Q

from podcast.models import Episode

PAGE_TITLE = "Преглед на каталога"


def _hms(seconds):
    seconds = int(seconds or 0)
    if seconds >= 3600:
        return f"{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"
    return f"{seconds // 60}:{seconds % 60:02d}"


class Command(BaseCommand):
    help = "Write a standalone HTML page for marking non-podcast videos."

    def add_arguments(self, parser):
        parser.add_argument(
            "--out",
            default="review.html",
            help="Path of the HTML file to write (default ./review.html)",
        )
        parser.add_argument(
            "--channel",
            action="append",
            default=None,
            help="Limit to a channel handle or youtube id. Repeat for several.",
        )
        parser.add_argument(
            "--max-duration",
            type=int,
            default=None,
            help="Only include episodes shorter than N seconds",
        )

    def handle(self, *args, **options):
        out_path = Path(options["out"]).expanduser().resolve()

        episodes = (
            Episode.objects.select_related("channel", "transcript")
            .annotate(topic_count=Count("topics", distinct=True))
            .order_by("channel__name", "-upload_date", "youtube_id")
        )
        if options["channel"]:
            wanted = Q()
            for target in options["channel"]:
                wanted |= Q(channel__handle__iexact=target) | Q(
                    channel__youtube_channel_id=target
                )
            episodes = episodes.filter(wanted)
            if not episodes.exists():
                raise CommandError(f"No episodes for {options['channel']}")
        if options["max_duration"] is not None:
            episodes = episodes.filter(duration_sec__lt=options["max_duration"])

        channels = {}
        rows = []
        for episode in episodes:
            channel = episode.channel
            if channel.pk not in channels:
                channels[channel.pk] = {
                    "slug": channel.slug,
                    "name": channel.name,
                    "handle": channel.handle,
                    "count": 0,
                }
            channels[channel.pk]["count"] += 1

            transcript = getattr(episode, "transcript", None)
            rows.append(
                {
                    "id": episode.youtube_id,
                    "ch": channel.slug,
                    "t": episode.title,
                    "d": episode.duration_sec or 0,
                    "dh": _hms(episode.duration_sec),
                    "k": episode.content_kind,
                    "u": episode.upload_date.isoformat() if episode.upload_date else "",
                    "v": episode.view_count,
                    "m": episode.members_only,
                    # Signals that help judge a borderline card without opening it:
                    # a real episode usually has captions and community labels.
                    "tr": bool(transcript and transcript.status == "ok"),
                    "tc": episode.topic_count,
                }
            )

        payload = {
            "channels": list(channels.values()),
            "episodes": rows,
        }
        html = _render(payload)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(html, encoding="utf-8")

        self.stdout.write(f"{len(rows)} episodes in {len(channels)} channels")
        for channel in payload["channels"]:
            self.stdout.write(f"  {channel['handle']:28s} {channel['count']:5d}")
        self.stdout.write("")
        self.stdout.write(f"wrote {out_path}  ({out_path.stat().st_size / 1024:.0f} KB)")
        self.stdout.write("Open it in a browser. Marks are saved in localStorage.")


def _render(payload):
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    # The JSON sits INSIDE a <script> tag, where the HTML parser still honours
    # "</". One episode titled "...</script>..." would end the block early and
    # silently blank the page. No title contains it today; escaping costs
    # nothing and does not change what JSON.parse reads.
    data = data.replace("</", "<\\/")
    return _TEMPLATE.replace("__DATA__", data).replace("__TITLE__", PAGE_TITLE)


_TEMPLATE = r"""<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
  :root{
    --bg:#12100f; --card:#1c1917; --card2:#231f1d; --line:#332d2a;
    --fg:#f5f1ee; --muted:#a29892; --red:#e4232c; --redtext:#ff6b6b;
    --green:#3fb950; --gold:#d4a72c;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  header{position:sticky;top:0;z-index:10;background:rgba(18,16,15,.97);
         border-bottom:1px solid var(--line);backdrop-filter:blur(8px)}
  .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 16px}
  .bar h1{font-size:15px;margin:0 8px 0 0;font-weight:650}
  .count{font-variant-numeric:tabular-nums;font-weight:700;color:var(--redtext)}
  button,select,input{font:inherit;color:var(--fg);background:var(--card2);
    border:1px solid var(--line);border-radius:99px;padding:6px 13px;cursor:pointer}
  input{cursor:text;min-width:190px}
  button:hover{border-color:var(--muted)}
  button.primary{background:var(--red);border-color:var(--red);color:#fff;font-weight:600}
  button.ghost{background:transparent}
  .navrow{display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 10px}
  .navrow a{color:var(--muted);text-decoration:none;font-size:12px;
    border:1px solid var(--line);border-radius:99px;padding:4px 10px;white-space:nowrap}
  .navrow a:hover{color:var(--fg);border-color:var(--muted)}
  .navrow a b{color:var(--fg);font-variant-numeric:tabular-nums}
  #out{display:none;padding:12px 16px;border-top:1px solid var(--line);background:var(--card)}
  #out.open{display:block}
  #out textarea{width:100%;height:150px;background:var(--bg);color:var(--fg);
    border:1px solid var(--line);border-radius:10px;padding:10px;font-family:ui-monospace,monospace;
    font-size:12px;cursor:text}
  main{padding:16px}
  section{margin-bottom:34px}
  section h2{font-size:15px;margin:0 0 4px;display:flex;gap:9px;align-items:baseline}
  section h2 span{color:var(--muted);font-weight:400;font-size:12px}
  .grid{display:grid;gap:10px;
        grid-template-columns:repeat(auto-fill,minmax(215px,1fr));margin-top:11px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
        overflow:hidden;cursor:pointer;position:relative;transition:border-color .12s}
  .card:hover{border-color:var(--muted)}
  .thumb{position:relative;aspect-ratio:16/9;background:#000;display:block}
  .thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .dur{position:absolute;right:5px;bottom:5px;background:rgba(0,0,0,.85);
       border-radius:5px;padding:1px 5px;font-size:11px;font-variant-numeric:tabular-nums}
  .meta{padding:8px 9px 9px}
  .title{font-size:12.5px;line-height:1.35;max-height:3.4em;overflow:hidden;margin-bottom:6px}
  .tags{display:flex;gap:4px;flex-wrap:wrap;font-size:10.5px;color:var(--muted)}
  .tag{border:1px solid var(--line);border-radius:99px;padding:1px 6px;white-space:nowrap}
  .tag.stream{color:var(--gold);border-color:#4a3d1c}
  .tag.tr{color:var(--green);border-color:#1f3d24}
  .tag.mem{color:var(--redtext);border-color:#4a2020}
  /* Marked state has to be unmissable at a glance while scanning hundreds. */
  .card.marked{border-color:var(--red);background:#2a1516}
  .card.marked .thumb img{opacity:.28;filter:grayscale(1)}
  .card.marked .title{text-decoration:line-through;color:var(--muted)}
  .card.marked::after{content:"✕ ПРЕМАХНАТ";position:absolute;top:8px;left:8px;
    background:var(--red);color:#fff;font-size:11px;font-weight:700;
    padding:3px 8px;border-radius:99px;letter-spacing:.3px}
  .yt{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.8);border-radius:6px;
      padding:3px 7px;font-size:11px;color:#fff;text-decoration:none;opacity:0;transition:opacity .12s}
  .card:hover .yt{opacity:1}
  .yt:hover{background:var(--red)}
  .empty{color:var(--muted);font-size:13px;padding:6px 0}
</style>
</head>
<body>
<header>
  <div class="bar">
    <h1>__TITLE__</h1>
    <span>маркирани: <span class="count" id="n">0</span> / <span id="total">0</span></span>
    <input id="q" placeholder="търси в заглавията...">
    <select id="kind">
      <option value="">всички видове</option>
      <option value="video">само video</option>
      <option value="stream">само stream</option>
    </select>
    <select id="dur">
      <option value="">всяка дължина</option>
      <option value="60">под 1 мин</option>
      <option value="300">под 5 мин</option>
      <option value="600">под 10 мин</option>
      <option value="1200">под 20 мин</option>
      <option value="-1800">над 30 мин</option>
    </select>
    <select id="show">
      <option value="">покажи всички</option>
      <option value="marked">само маркирани</option>
      <option value="unmarked">само немаркирани</option>
    </select>
    <button id="markAll" class="ghost">Маркирай всички видими</button>
    <button id="unmarkAll" class="ghost">Размаркирай видимите</button>
    <button id="toggleOut" class="primary">Покажи списъка</button>
  </div>
  <div class="navrow" id="nav"></div>
  <div id="out">
    <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <button id="copy">Копирай ID-тата</button>
      <button id="download">Свали JSON</button>
      <button id="clear" class="ghost">Изчисти всички маркирания</button>
    </div>
    <textarea id="ids" readonly spellcheck="false"></textarea>
  </div>
</header>
<main id="main"></main>
<script>
const DATA = __DATA__;
const KEY = "ccc-review-marks-v1";
const marks = new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
const byId = new Map(DATA.episodes.map(e => [e.id, e]));

function save(){ localStorage.setItem(KEY, JSON.stringify([...marks])); }

function esc(s){ return String(s).replace(/[&<>"]/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function cardHTML(e){
  const tags = [`<span class="tag">${e.u || "?"}</span>`];
  if (e.k === "stream") tags.push(`<span class="tag stream">stream</span>`);
  if (e.m) tags.push(`<span class="tag mem">members</span>`);
  if (e.tr) tags.push(`<span class="tag tr">транскрипт</span>`);
  if (e.tc) tags.push(`<span class="tag">${e.tc} теми</span>`);
  if (e.v != null) tags.push(`<span class="tag">${e.v.toLocaleString("bg")} гл.</span>`);
  return `<article class="card${marks.has(e.id)?" marked":""}" data-id="${e.id}">
    <div class="thumb">
      <img loading="lazy" src="https://img.youtube.com/vi/${e.id}/mqdefault.jpg" alt="">
      <span class="dur">${e.dh}</span>
      <a class="yt" href="https://www.youtube.com/watch?v=${e.id}" target="_blank"
         rel="noreferrer" title="Отвори в YouTube">YT ↗</a>
    </div>
    <div class="meta">
      <div class="title">${esc(e.t)}</div>
      <div class="tags">${tags.join("")}</div>
    </div>
  </article>`;
}

function visible(){
  const q = document.getElementById("q").value.trim().toLowerCase();
  const kind = document.getElementById("kind").value;
  const dur = document.getElementById("dur").value;
  const show = document.getElementById("show").value;
  return DATA.episodes.filter(e => {
    if (q && !e.t.toLowerCase().includes(q)) return false;
    if (kind && e.k !== kind) return false;
    if (dur){
      const n = Number(dur);
      if (n > 0 && !(e.d < n)) return false;
      if (n < 0 && !(e.d >= -n)) return false;
    }
    if (show === "marked" && !marks.has(e.id)) return false;
    if (show === "unmarked" && marks.has(e.id)) return false;
    return true;
  });
}

function render(){
  const list = visible();
  const grouped = new Map(DATA.channels.map(c => [c.slug, []]));
  for (const e of list) grouped.get(e.ch)?.push(e);

  document.getElementById("main").innerHTML = DATA.channels.map(c => {
    const items = grouped.get(c.slug) || [];
    const marked = items.filter(e => marks.has(e.id)).length;
    return `<section id="ch-${c.slug}">
      <h2>${esc(c.name)} <span>${esc(c.handle)} · ${items.length} от ${c.count}${
        marked ? ` · ${marked} маркирани` : ""}</span></h2>
      ${items.length ? `<div class="grid">${items.map(cardHTML).join("")}</div>`
                     : `<div class="empty">нищо не съвпада с филтъра</div>`}
    </section>`;
  }).join("");

  document.getElementById("nav").innerHTML = DATA.channels.map(c => {
    const items = grouped.get(c.slug) || [];
    const marked = items.filter(e => marks.has(e.id)).length;
    return `<a href="#ch-${c.slug}">${esc(c.handle)} <b>${items.length}</b>${
      marked ? ` · <b style="color:var(--redtext)">${marked}</b>` : ""}</a>`;
  }).join("");

  updateCount();
}

function updateCount(){
  document.getElementById("n").textContent = marks.size;
  document.getElementById("total").textContent = DATA.episodes.length;
  const rows = [...marks].map(id => byId.get(id)).filter(Boolean)
    .sort((a,b) => a.ch.localeCompare(b.ch) || a.u.localeCompare(b.u));
  document.getElementById("ids").value = rows.length
    ? rows.map(e => `${e.id}  # ${e.ch} | ${e.dh} | ${e.t}`).join("\n")
    : "(нищо маркирано)";
}

// One listener on main, not one per card - 1,962 cards re-render on every filter.
document.getElementById("main").addEventListener("click", ev => {
  if (ev.target.closest(".yt")) return;          // opening YouTube must not toggle
  const card = ev.target.closest(".card");
  if (!card) return;
  const id = card.dataset.id;
  if (marks.has(id)) marks.delete(id); else marks.add(id);
  card.classList.toggle("marked");
  save();
  updateCount();
  // Section headers carry per-channel counts, so refresh just this one.
  const section = card.closest("section");
  const slug = section.id.replace("ch-", "");
  const channel = DATA.channels.find(c => c.slug === slug);
  const items = visible().filter(e => e.ch === slug);
  const marked = items.filter(e => marks.has(e.id)).length;
  section.querySelector("h2 span").textContent =
    `${channel.handle} · ${items.length} от ${channel.count}` +
    (marked ? ` · ${marked} маркирани` : "");
});

for (const id of ["q","kind","dur","show"]){
  document.getElementById(id).addEventListener("input", render);
}
document.getElementById("markAll").addEventListener("click", () => {
  const list = visible();
  if (!confirm(`Маркирай ${list.length} видими епизода като премахнати?`)) return;
  list.forEach(e => marks.add(e.id)); save(); render();
});
document.getElementById("unmarkAll").addEventListener("click", () => {
  const list = visible();
  if (!confirm(`Размаркирай ${list.length} видими епизода?`)) return;
  list.forEach(e => marks.delete(e.id)); save(); render();
});
document.getElementById("toggleOut").addEventListener("click", () => {
  document.getElementById("out").classList.toggle("open");
});
document.getElementById("copy").addEventListener("click", async () => {
  const ids = [...marks].join("\n");
  try { await navigator.clipboard.writeText(ids); alert(`Копирани ${marks.size} ID-та.`); }
  catch { const t = document.getElementById("ids"); t.select(); alert("Натисни Ctrl+C."); }
});
document.getElementById("download").addEventListener("click", () => {
  const rows = [...marks].map(id => byId.get(id)).filter(Boolean)
    .map(e => ({youtube_id:e.id, channel:e.ch, title:e.t, duration_sec:e.d, kind:e.k}));
  const blob = new Blob([JSON.stringify({excluded:rows}, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "excluded-episodes.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById("clear").addEventListener("click", () => {
  if (!confirm(`Изчисти всички ${marks.size} маркирания?`)) return;
  marks.clear(); save(); render();
});

render();
</script>
</body>
</html>
"""
