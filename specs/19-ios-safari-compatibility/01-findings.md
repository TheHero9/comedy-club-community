# iOS / Safari compatibility sweep

**Date:** 2026-08-18
**Trigger:** the app is about to be released and had never been opened on iOS.
**Method:** the real WebKit engine (`playwright webkit v2336`, WebKit 26.5) at
`devices["iPhone 14"]`, driven over every route, plus 320px, 375px, landscape
and iPad viewports. Everything below was **measured**, not read off the code.

---

## The headline

> **The test suite had 386 tests across two "mobile" viewports and had never
> run a single one on Safari.** Both projects in `playwright.config.ts` were
> Desktop Chrome; the "mobile" one was Chrome resized to 390x844.

That is a perfectly good check of layout at phone width and it is not a check
of iOS. It has Chromium's CSS support, Chromium's rendering and Chromium's
input behaviour. The bug below lived in that gap for the entire build.

**The good news, and it is most of the report:** run on the actual engine, the
app is sound. Across eleven routes at an iPhone viewport WebKit reported **zero
console errors, zero page errors, zero failed requests and zero horizontal
page scroll**, and the same held at 320px, 375px, 844x390 landscape and iPad
768px. Cyrillic renders in the right faces. There are no iframes or `<video>`
elements, which removes a whole class of iOS media problems. Two things were
already right for the right reasons and are worth not breaking: the sheet is
sized in `dvh` rather than `vh`, and the viewport does **not** set
`viewport-fit: cover`.

---

## 1. 🚨 Every form control in the app zoomed the viewport on focus

**Severity: high. This is the one a user would have hit within a minute.**

Safari zooms the whole page when a form control smaller than 16px takes focus,
and **it does not zoom back out on blur**. The page is then left horizontally
scrolled for the rest of the session, which reads as "the layout broke when I
tapped the box".

Measured on WebKit at an iPhone viewport, before the fix:

| Surface | Controls | Computed size |
| ------- | -------- | ------------- |
| Moment composer | timestamp input, label input | **13px** |
| Cast proposer | person select, role select | **13px** |
| `/me/people` | 2 inputs + 4 selects | **13px** |
| Profile editor | display name, handle | **15px** |
| Membership editor | channel select, months, renewal day | **15px** |
| Report dialog, proposal queue, report queue | same `text-small` | **13px** |

### Why it was invisible

The rule preventing this **already existed**, with a comment saying exactly
what it was for:

```css
@layer base {
  /* Inputs must never drop below 16px on mobile or iOS zooms the viewport on
     focus, which then leaves the page horizontally scrolled. */
  input, textarea, select { font-size: 16px; }
}
```

It did nothing. **Cascade layers beat specificity.** Tailwind emits
`@layer theme, base, components, utilities`, so `.text-small` (a `components`
utility, 13px) and `text-[15px]` (a `utilities` arbitrary value) both outrank
anything written in `base`, no matter how the selector is constructed. The
comment described the intent and the browser did the opposite, and no gate in
the repo could see the difference:

- `typecheck`, `lint` and `build` do not evaluate CSS cascade
- Vitest does not run a browser
- Playwright ran two Chromium projects, and **Chromium does not zoom on focus**

### The fix

The rule moved **outside every `@layer`**. An unlayered declaration outranks
every cascade layer, which is the only placement that survives a utility class
on the element:

```css
@media (pointer: coarse), (max-width: 767px) {
  input, textarea, select { font-size: 16px; }
}
```

Scoped to touch pointers and narrow viewports, so the desktop design keeps the
13/15px sizes the handoff specifies - focus zoom is a touch-device behaviour
and there is nothing to fix with a mouse. 16px form text on a phone is also
simply more legible than 13px.

⚠️ **Do not "tidy" this back into `@layer base`.** That is precisely the state
it was already in, and it was inert.

**Verified:** all 15 previously-zooming controls now compute 16px on WebKit,
and no layout moved - re-measured at 320/375/390/768/844px with no new
overflow anywhere.

---

## 2. ⚠️ The persistent header controls were under the 44px touch minimum

Apple's HIG minimum for a touch target is 44x44. The three controls present on
**every single route** measured:

| Control | Drawn box |
| ------- | --------- |
| Logo / home | 28x28 |
| Settings | 38x38 |
| Profile avatar | 34x34 |

Growing the visible boxes would break the 54px header the handoff specifies, so
the **hit** area is grown instead, with a transparent pseudo-element - hit
testing attributes a pseudo to its originating element, so the tap lands on the
link either way and nothing on screen changes:

```css
@utility tap-target {
  position: relative;
  &::after {
    content: "";
    position: absolute;
    top: 50%; left: 50%;
    width: max(100%, 44px);
    height: max(100%, 44px);
    transform: translate(-50%, -50%);
  }
}
```

⚠️ **`max()`, never a fixed 44px** - a control that is already larger must not
be shrunk by its own hit area.

⚠️ **The expansion is invisible, so nothing on screen tells you when two of
them collide** and one starts swallowing the other's taps. Measured on the
header at 390px: settings grows 38→44 (+3 a side) and the avatar 34→44 (+5 a
side) across an 8px gap, so they meet exactly and do not overlap. Re-measure
before reusing this anywhere tighter.

**Verified by hit test, not by inspection:** `elementFromPoint` at a coordinate
3px outside the drawn box of the logo and the avatar returns the link.

### Not fixed - recorded instead

Other sub-44px targets exist inside dense content: topic chips and sort tabs
(34-38px tall), search-result timestamp chips (60x22), and inline text buttons
("see all" 40x20, "Description" 93x20, "Add a handle" 90x19). Expanding those
is a design change, not a compatibility fix - several sit in tight vertical
rhythm where an invisible 44px box would overlap its neighbour and steal taps,
which is a worse bug than the one it fixes. They are listed here so the next
person knows they were seen and left, not missed.

---

## 3. ⚠️ Safari tinted its own toolbars the wrong colour in the light theme

`<meta name="theme-color">` was a single static `#191614` from the `viewport`
export. **iOS Safari tints its toolbars with that value** (desktop Chrome
ignores it entirely, which is why this is invisible off a phone), so a member
who switched to the light theme got a cream page framed top and bottom in near
black.

`components/shell/ThemeColorMeta.tsx` now rewrites the tag from
`resolvedTheme`. Verified on WebKit: `#191614` → `#fbf8f4` after switching.

🚨 **Not a `prefers-color-scheme` pair.** `ThemeProvider` runs with
`enableSystem={false}`, so the active theme is a stored choice with no
relationship to the phone's system setting. Keying the tint off the system
would tint light for a user looking at the dark theme - the same bug pointing
the other way.

---

## 4. ⚠️ "Add to Home Screen" opened in Safari chrome, not as an app

`app/manifest.ts` declared `display: "standalone"`, but iOS reads the
Apple-specific tags on the versions it still ships to. `appleWebApp` is now
declared in the root metadata.

`statusBarStyle` is **`"black"`, not `"black-translucent"`**: translucent draws
the page *under* the status bar, which would put the 54px header behind the
clock unless every top surface also grew `env(safe-area-inset-top)` padding.

ℹ️ Next emits the standardised `mobile-web-app-capable` rather than the legacy
`apple-mobile-web-app-capable`. iOS 16.4+ honours the manifest's `display`, so
this is left alone rather than hand-injected against Next's metadata system.

---

## 5. ✅ Things that were already right - and why not to "fix" them

- **No `viewportFit: "cover"`, deliberately.** Without it iOS insets the layout
  viewport to the safe area, so the fixed bottom nav and the episode action bar
  clear the home indicator on their own. Turning it on extends the page into
  that strip and **buries both bars under the indicator** until every fixed
  surface grows `env(safe-area-inset-bottom)` padding. This is the single most
  tempting wrong move in this area: `viewport-fit=cover` looks like the modern
  default and here it would create the bug it appears to prevent. A comment in
  `app/layout.tsx` now says so.
- **The sheet is `max-h-[92dvh]`, not `vh`.** `vh` in Safari resolves against
  the *large* viewport - the one with the toolbars collapsed - so a sheet sized
  in `vh` is taller than the screen for as long as they are expanded, which is
  exactly the moment the user has just tapped something. Pinned by 14.6.
- **`text-size-adjust: 100%`** comes from Tailwind's preflight, so Safari does
  not inflate text in landscape.
- **No date parsing through `new Date(string)` for display.** `lib/format.ts`
  regex-parses the leading `YYYY-MM-DD` instead, which sidesteps both the
  timezone-shift bug and Safari's stricter parser.
- **No regex lookbehind in shipped code.** The only two uses are in
  `tests/copy.spec.ts`, which runs in Node.

---

## What now protects this

A third Playwright project, `ios`, running `devices["iPhone 14"]` - which
selects **WebKit** - over one file, `e2e/ios-safari.spec.ts` (12 tests, ~11s):

| Test | Asserts |
| ---- | ------- |
| 14.1 / 14.1b | no control under 16px on `/me/people` and in the profile editor (the 13px and 15px families) |
| 14.2 / 14.3 | the same for the moment composer and cast proposer |
| 14.4 | six public routes never scroll sideways in Safari |
| 14.5 | every header control clears 44px of **touch** area (box ∪ pseudo) |
| 14.6 | the settings sheet comes to rest inside the viewport |

⚠️ Scoped with `testMatch` to that one file, and `testIgnore`d from the other
two projects. Running the whole suite a third time is ~3 minutes for coverage
the existing projects already give; this project exists for the assertions that
are engine-specific. The desktop project would also *fail* 14.1-14.3, correctly
- the 13/15px sizes are right with a mouse.

### The spec was verified against the bug, not just run

Disabling the CSS guard and rebuilding fails **exactly** the four focus-zoom
tests and nothing else. A regression test that has never been seen red is a
claim, not a check.

`expectNoZoomingFields` also refuses to pass on an empty result set: every call
site is a surface that demonstrably has controls, so a selector that stops
matching fails loudly instead of iterating nothing. That guard fired for real
during authoring - `/me/people` renders a skeleton until the `me` query
resolves, and the first version of 14.1 read the controls too early.

---

## Results

- **404 E2E tests, 400 passed, 4 skipped, 0 failed** (desktop + mobile + ios)
- **227 Vitest**, 35 perf budgets green; flagship channel page 630.6 KB, in line
- `typecheck` and `turbo lint` clean
