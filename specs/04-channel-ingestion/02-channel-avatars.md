# Channel avatars, banners and subscriber counts

**Date:** 2026-08-09
**Ask:** show each channel's YouTube profile picture on `/channels`, "like the thumbnails".

---

## 1. Why this is NOT like the thumbnails

The instinct was right that it should work the same way, but it can't, and the
difference is the whole design.

| | Episode thumbnail | Channel avatar |
| --- | --- | --- |
| URL | `img.youtube.com/vi/{video_id}/maxresdefault.jpg` | `yt3.googleusercontent.com/{opaque hash}=s480-...` |
| Derivable from data we hold? | ✅ yes, from the video id | ❌ **no** |
| What we store | the 11-char video id | **the URL itself** |
| Mirrored to R2? | ❌ never | ❌ never |
| Goes stale? | no | ⚠️ **yes** - hash changes when the owner changes their picture |

Nothing in the channel id, handle or name produces that hash, so the URL *is* the data.
That is the single reason this one gets persisted while thumbnails deliberately do not.

The part that carries over unchanged: **we still never mirror the image.** Google's CDN
serves it free, exactly as with thumbnails.

---

## 2. What already existed

Almost all of it. `Channel.avatar_url`, `banner_url` and `subscriber_count` were already
on the model, and `ChannelOut` already exposed all three to the API. **No schema change
and no API contract change was needed** - the fields were simply never populated. The
channels page was rendering a `Mic` placeholder for every channel.

So the work was: extract → persist → allow the host → render.

---

## 3. What yt-dlp gives us

The channel-level flat listing already fetched by `fetch_tab_entries` carries everything,
at **no extra request cost**:

| Field | Value on @ivankirkov1 |
| ----- | --------------------- |
| `channel_follower_count` | 7,040 |
| `thumbnails[id="avatar_uncropped"]` | the avatar |
| `thumbnails[id="banner_uncropped"]` | the banner |

Size is a suffix after `=`, and is re-derived rather than trusted. Verified live:

| Spec | Bytes |
| ---- | ----- |
| `=s176-c-k-c0x00ffffff-no-rj` | 13 KB |
| **`=s480-c-k-c0x00ffffff-no-rj`** (chosen) | **81 KB** |
| `=s900-c-k-c0x00ffffff-no-rj` | 184 KB |
| `=s0` (uncropped original) | 277 KB |

480 covers a 44-64 px avatar even at 3x, and `next/image` downscales from there.

---

## 4. Implementation

| File | Role |
| ---- | ---- |
| `podcast/ingestion/channel_images.py` | **new** - picks avatar/banner from the thumbnail list, normalizes size |
| `podcast/ingestion/yt_dlp_backfill.py` | `ChannelPayload` carries the three new values |
| `podcast/services/ingestion.py` | `upsert_channel` persists them; **new** `refresh_channel_metadata()` |
| `podcast/management/commands/refresh_channel_meta.py` | **new** - one cheap request per channel, no episodes |
| `apps/web/next.config.ts` | allows `yt3.googleusercontent.com` |
| `apps/web/components/shared/ChannelAvatar.tsx` | **new** - shared, with a layered fallback |
| `apps/web/app/channels/page.tsx`, `app/channels/[slug]/page.tsx` | render it |

### 🔒 Absent means "unknown", never "clear it"

`upsert_channel` only writes avatar/banner/subscribers **when the payload actually has
them**. This is the throttle lesson from `01-comedyclubpodcast-run.md` applied
pre-emptively: a thin response must never blank a good avatar just because one sync came
back degraded.

### 🎨 The fallback is layered, not conditional

The `Mic` icon sits *behind* the image rather than replacing it when the URL is empty.

Handling a dead URL with `onError` would force `ChannelAvatar` into a Client Component,
and the channel pages are Server Components on purpose - they are the indexable ones.
Stacking covers **both** failure modes (no URL, and a URL that stopped resolving) with
zero client JS. `alt=""` is load-bearing: the channel name is always rendered as text
alongside, so the image is decorative, and an empty alt means a broken image renders
nothing and reveals the icon beneath.

---

## 5. 🐛 Caught during verification: an 8x srcSet blowup

The first version used `fill` + `sizes="44px"`. It rendered correctly and passed
`typecheck`, `lint` and `vitest` - and emitted **8 srcSet candidates up to `w=1280`
for a 44 px avatar**, defaulting `src` to `w=1280`, an upscale of a 480 px source.

Cause: with `fill`, Next needs `sizes`, but a fixed-px `sizes` has no `vw` for Next to
filter the ladder against, so it emits every candidate. This is the same waste the
`deviceSizes` trimming in `next.config.ts` was written to prevent.

Fix: explicit `width`/`height` instead of `fill`, which collapses it to a 1x/2x pair.

| | Before | After |
| --- | --- | --- |
| srcSet candidates | 8 | **2** |
| default `src` | `w=1280` | `w=128` |
| `/channels` HTML (2 channels) | 35,021 B | **32,745 B** |

That is ~2.3 KB saved on two channels; at the 6-8 channels planned it is ~9 KB of pure
attribute text. **Only visible by reading the rendered HTML** - no static gate catches it.

---

## 6. ⚠️ Gotcha: `revalidate = 60` hid the change

After populating the avatars, `/channels` showed them but `/channels/[slug]` did not -
while the API demonstrably returned `avatar_url` for that same channel.

It was not a bug. Both pages set `export const revalidate = 60`, and the detail route
was serving a render cached from **before** the avatars were populated. Two fetches
later, past the window, it revalidated and the avatar appeared.

- 🔍 Tell-tale: the component markup IS present (the fallback icon and `sr-only` name
  render) but the `<img>` is absent, while a direct API call shows the field populated.
- ✅ When data changes behind an ISR route, re-fetch after the revalidate window before
  concluding the render is broken.

---

## 7. Verification

| Check | Result |
| ----- | ------ |
| `refresh_channel_meta` on both channels | ✅ avatar + banner + subs |
| Stored URLs resolve (HEAD) | ✅ 4/4 → 200 |
| `/channels` renders both avatars | ✅ |
| `/channels/[slug]` renders avatar at 64 px | ✅ |
| Next image optimizer serves it | ✅ 200, 2,900 B JPEG |
| `npx turbo typecheck lint` | ✅ 3/3 |
| `vitest run` | ✅ 137 passed |
| `pytest` | ✅ all passed |
| `ruff check` | ✅ clean |

Subscriber counts picked up as a free side effect: **@ivankirkov1 7,040**,
**@comedyclubpodcast 75,800**.

---

## 8. ⏭️ Follow-ups

- Banners are stored but not rendered anywhere yet - a channel header hero is the
  obvious use.
- `subscriber_count` is stored and exposed but not displayed on `/channels`.
- Re-run `refresh_channel_meta` periodically; a stale avatar hash 404s silently and the
  layered fallback will quietly hide it. Worth folding into the daily Celery sync.
