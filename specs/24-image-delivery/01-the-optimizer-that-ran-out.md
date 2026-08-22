# The optimizer that ran out

**Date:** 2026-08-22
**Status:** ✅ Fixed - the paid image optimizer is gone from this app entirely

---

## The report

> "check why on prod the thumbnails dont render what happened"

Every episode thumbnail on the live site had been replaced by the diagonal-stripe
placeholder. Nothing had been deployed. Nothing was erroring.

## What it was

The thumbnails were fine. Google was serving them exactly as always:

```
GET https://img.youtube.com/vi/D2yanlVBl-s/maxresdefault.jpg   ->  200, 162 KB
```

The broken hop was the one in between:

```
GET /_next/image?url=...maxresdefault.jpg&w=640&q=75
HTTP/1.1 402 Payment Required
X-Vercel-Error: OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED
```

Measured against production at the time of the report:

| Width | Result |
| ----- | ------ |
| 384 | ❌ 402 |
| 640 | ❌ 402 |
| 828 | ❌ 402 |
| 1080 | ❌ 402 |
| 1280 | ✅ 200 - but `X-Vercel-Cache: HIT`, `Age: 580555` (6.7 days old) |

**The only images still rendering were stale edge-cache entries.** Anything the
cache did not already hold was refused. A phone picks the 384/640/828 candidate
out of the `srcSet`, so for a real visitor that is every thumbnail on the page.

## Why the allowance went

Two things, and the second is the one that is easy to miss.

1. **The catalogue is the wrong shape for a per-image allowance.** Every episode
   is a *distinct source image* - nothing amortises across them. ~1,961 episodes
   x a srcSet ladder is roughly **9,800 distinct transformations for one full
   crawl**, and search engines crawl.

2. **The ratings grid is an accelerant.** `GridInteraction.tsx` renders a hover
   preview built from `thumbnailUrl()` -> `hqdefault.jpg`, which is a *different
   URL* from the card's `maxresdefault.jpg` and therefore a second billable entry
   per episode. On the flagship channel that is 1,225 cells; one person sweeping
   a mouse across the grid can burn hundreds of transformations in a minute.

## 🚨 The lesson

The ingestion side of this project already had the rule, written down twice:

> ❌ **Do NOT mirror thumbnails to R2.** Google's CDN serves them free and
> forever; mirroring adds cost, a sync job, and staleness for zero gain.

Routing all of them through a paid optimizer is **the same mistake wearing a
different hat** - paying per-image to re-encode a file Google already publishes
in four pre-rendered sizes. The rule was about storage cost; it should always
have been about *any* per-image cost.

It also failed in the shape every incident on this project fails in: **nothing in
the repo could see it.** `typecheck`, `lint` and `build` all pass whether images
are billed or free, and the optimizer never runs out locally. The first signal
was a human looking at the site.

## The fix

`apps/web/lib/image-loader.ts`, wired in as `images.loaderFile`. A loader returns
a URL and Next requests exactly that, so **every return is an absolute Google
URL** and `/_next/image` is never touched. There is nothing left to bill.

### Which file each width resolves to

Measured across 40 real episodes before choosing (`40/40` present for all five):

| Bucket | Dimensions | Avg bytes |
| ------ | ---------- | --------- |
| `mqdefault` | 320x180 (16:9) | 14 KB |
| `hqdefault` | 480x360 | 21 KB |
| `sddefault` | 640x480 | 77 KB |
| `maxresdefault` | 1280x720 | 208 KB |
| `hq720` | 1280x720 | 208 KB |

The loader maps `w <= 320` to `mqdefault`, `w <= 828` to `hqdefault`, and
anything larger to **the URL it was given**.

### 🚨 Three decisions that look wrong and are not

- **The thresholds are deliberately not the source widths.** YouTube's sizes are
  320, 480 and 1280 with nothing in between, so an *honest* ladder sends any
  request above 480px to the 1,280px file: a 390px phone at 2x asks for ~780px,
  which is 208 KB per card. Declaring the 480x360 file as the **828w** candidate
  instead caps a card grid at ~21 KB per image - better than the ~1.2 MB/page the
  paid optimizer was serving - at the cost of some sharpness on dense screens.
  That is the right trade here: the audience is mobile-heavy, the title is always
  rendered as text beside the image, and it is what YouTube's own grid serves.

- **Above the last threshold the loader returns `src` untouched, never
  `maxresdefault` by name.** Only `mqdefault` and `hqdefault` are YouTube
  guarantees. The API already resolved the question per episode -
  `ingestion/thumbnails.py` HEAD-probes `maxresdefault` at ingest and stores
  `hqdefault` when it is absent - so the incoming URL is already the largest size
  *known to exist for that video*. Upgrading it here would be guessing, and a
  wrong guess renders the stripe placeholder with no way to find out.

- **The ladder has exactly three rungs because the loader has exactly three
  outputs.** `deviceSizes` was `[320, 480, 828, 1280]` for one build and 480
  emitted the same `hqdefault` as 828 - a duplicate URL in every srcSet on the
  site, paying bytes to say the same thing twice. **A fourth rung is not a finer
  choice.** Add one only when the loader gains a real bucket.

Avatars are the one non-thumbnail case: their size is a `=s480` suffix on an
opaque content hash, so the loader re-derives it (`=s64` for a 64px tile) and
**only ever shrinks** - asking Google for a size above the stored one buys an
upscale of a file we already have. A banner's `=w1707` token is left alone.

## Verified

- `tests/image-loader.spec.ts` - 14 tests. Pins that no return is ever a
  `/_next/image` URL, that an `hqdefault` source is never upgraded, and that the
  config ladder and the loader thresholds still agree across the two files.
- Built and served locally: **zero `/_next/image` references** in the emitted
  HTML of any route, avatars down to `=s64`.
- Loaded in a real browser at 390x844:

  | Route | DPR 2 | DPR 3 | optimizer calls | failed |
  | ----- | ----- | ----- | --------------- | ------ |
  | `/episodes` | 34 KB | 61 KB | 0 | 0 |
  | `/e/D2yanlVBl-s` | 59 KB | 201 KB | 0 | 0 |
  | `/channels/ivan-kirkov` | 53 KB | 28 KB | 0 | 0 |

  The episode hero correctly escalates to `maxresdefault` on a 3x phone; the card
  grids never do.
- `npm run benchmark` + all 35 perf budgets pass.
- 194 Playwright tests green (`public-browse`, `invisible-failures`, `a11y`).

## ⚠️ A harness trap this run walked into

The first E2E pass was built against the **production** API for convenience and
produced **41 failures**, every one of them the console guard reporting a CORS
error on `https://api.comedycommunity.club/api/me` from `localhost:3200`. None of
them were image-related, and none were real. Same family as the "when everything
fails, suspect the harness" rule: build against `127.0.0.1:8000` for any run whose
result is meant to mean something.
