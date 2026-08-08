# ✅ Test Hardening - Exhaustive Test Matrix

Every row is a test to write. Tick it only when the test is **committed and passing**.

Legend: **Lane** = owning agent (see `02-implementation-plan.md`).
`E2E` = Playwright · `Unit` = Vitest · `Py` = pytest.

---

## 1. Route rendering (Lane A, E2E)

| # | Case | Assert |
|---|------|--------|
| 1.1 | `/` renders | 200, `<h1>` present, at least one episode card |
| 1.2 | `/channels` renders | 200, at least one channel link |
| 1.3 | `/channels/ivan-kirkov` renders | 200, channel name, episode count, grid present |
| 1.4 | `/episodes` renders | 200, episode cards, each links to `/e/...` |
| 1.5 | `/e/{real_id}` renders | 200, title, thumbnail, duration |
| 1.6 | `/search?q=Каспаров` renders | 200, results present |
| 1.7 | `/status` renders | 200, "API status" card, dependency rows |
| 1.8 | Every nav link in the header resolves | no 404 from `SiteHeader` |
| 1.9 | Episode card links reach a real episode page | click through, title non-empty |
| 1.10 | `/` metadata | `<title>`, `og:title`, `og:description` present |
| 1.11 | Episode page OG image | uses the YouTube thumbnail URL |

## 2. HTTP status codes (Lane A, E2E) 🚨 regression-critical

| # | Case | Assert |
|---|------|--------|
| 2.1 | `/channels/does-not-exist` | **404** (not 200) |
| 2.2 | `/e/BADIDBADID` | **404** (not 200) |
| 2.3 | `/nope` | 404 |
| 2.4 | 404 page renders real content | "Page not found" text + a link home |
| 2.5 | All 7 real routes | 200 |
| 2.6 | Adding any `loading.tsx` does not break 2.1/2.2 | guard test, comment explaining why |

> **Why this section exists:** a root `loading.tsx` once made 2.1 and 2.2 return 200 with a
> blank body. `typecheck`, `lint` and `build` were all green. Only a status assertion
> catches it.

## 3. Ratings grid (Lane B, E2E)

| # | Case | Assert |
|---|------|--------|
| 3.1 | Orientation | `<tbody>` rows are **years**, `<thead>` columns are episode numbers |
| 3.2 | Row count | equals `seasons.length` from `GET /api/channels/{slug}/grid` |
| 3.3 | Column count | equals `rows.length` from the same response |
| 3.4 | **Every cell value matches the API** | iterate `rows[i].cells[j]`, compare rendered text |
| 3.5 | Null cells render empty | a short year leaves holes, never a zero |
| 3.6 | Year label shows the season average | matches `seasons[j].average` to 1 decimal |
| 3.7 | Sticky year column | scroll container fully right, row header stays at container left edge |
| 3.8 | Grid scrolls internally | `scrollWidth > clientWidth` on the container, **page does not overflow** |
| 3.9 | Band colours | each cell's band class matches the API `band` key |
| 3.10 | Provisional marker | cells with `is_provisional` show the warning icon |
| 3.11 | Members-only marker | cells with `members_only` show the crown icon |
| 3.12 | Stream marker | cells with `content_kind === "stream"` show the radio icon |
| 3.13 | Cell links | `href` equals `/e/{youtube_id}` |
| 3.14 | Public/Elite toggle | clicking Elite changes the URL and re-renders the grid |
| 3.15 | Elite with no verified members | renders without crashing (all unrated is valid) |
| 3.16 | Legend | every band in the API `bands` array has a legend entry |
| 3.17 | Empty grid | a channel with no dated episodes renders the empty copy, no crash |

## 4. Typed API client (Lane C, Unit) - floor: 54 assertions

`apps/web/lib/api/client.ts` against a local HTTP mock.

| # | Case | Assert |
|---|------|--------|
| 4.1 | Base URL strips trailing slash | `http://x/` becomes `http://x` |
| 4.2 | Unset `NEXT_PUBLIC_API_URL` | falls back to `http://localhost:8000` (needs its own process - it is a module-load constant) |
| 4.3 | Path without leading slash | still resolves |
| 4.4-4.8 | 401 / 403 / 404 / 429 / 500 | each maps to `kind:"http"`, right status, right `copy.errors` message |
| 4.9 | Error body preserved | `error.body` equals the JSON the server sent |
| 4.10 | Error records method + url | for logging |
| 4.11 | Connection refused | `kind:"network"`, `status:0` (needs its own process) |
| 4.12 | `cause` preserved | original error retained for logging |
| 4.13 | Timeout via `timeoutMs` | `kind:"timeout"` |
| 4.14 | Caller `AbortSignal` | `kind:"aborted"` |
| 4.15 | Malformed JSON | `kind:"parse"` |
| 4.16 | `text/plain` response | returns the string |
| 4.17 | 204 response | resolves to `null` |
| 4.18 | Numeric + boolean query values | stringified |
| 4.19 | `undefined` / `null` query values | dropped from the URL |
| 4.20 | Array query values | repeat the key |
| 4.21 | 🇧🇬 Cyrillic query value | round-trips intact |
| 4.22 | 🇧🇬 Cyrillic POST body | round-trips intact |
| 4.23-4.27 | GET / POST / PUT / PATCH / DELETE | correct method sent |
| 4.28 | `Content-Type` only when a body exists | GET sends none |
| 4.29 | `Accept: application/json` | always sent |
| 4.30 | `bearerAuthHeader(token)` | returns the header |
| 4.31 | `bearerAuthHeader(null/undefined/"")` | returns `{}` |
| 4.32 | Default client | sends no `Authorization` |
| 4.33 | `createApiClient({ getToken })` sync | attaches the bearer token |
| 4.34 | `createApiClient({ getToken })` async | awaits it (this is the Clerk shape) |
| 4.35 | Per-call `token` | overrides the client token |
| 4.36 | Per-call `token: null` | suppresses the client token |
| 4.37 | `defaultHeaders` | sent on every request |
| 4.38 | Per-call headers | win over `defaultHeaders` |
| 4.39 | `toApiError` on a plain Error | wraps it |
| 4.40 | `toApiError` on an `ApiError` | idempotent, returns the same instance |
| 4.41 | `getHealthResult` when up | `ok:true` |
| 4.42 | `getHealthResult` when down | `ok:false`, never throws |
| 4.43 | 🚨 Health error summary is a **plain object** | `constructor === Object`, survives `JSON.parse(JSON.stringify(x))` unchanged |

> **4.43 is regression-critical.** Passing an `Error` instance into the render tree once
> broke React's RSC debug serialization and hung the request for 60s.

## 5. Pure helpers (Lane C, Unit)

| # | Case | Assert |
|---|------|--------|
| 5.1 | `bandStyle` for every band key | returns a style, never undefined |
| 5.2 | `bandStyle(null/undefined/"garbage-key")` | safe fallback |
| 5.3 | `formatScore(null)` | renders the not-rated marker, never "0" or "NaN" |
| 5.4 | `formatScore(7)` / `formatScore(9.75)` | 1 decimal, no float noise |
| 5.5 | `formatDuration` | seconds to `h:mm:ss` / `m:ss`, null safe |
| 5.6 | `formatDate(null)` | safe |
| 5.7 | `cn()` | later class wins on conflict |
| 5.8 | Band thresholds | each numeric score maps to the band the API would assign |

## 6. Copy discipline (Lane C, Unit + lint-style check)

| # | Case | Assert |
|---|------|--------|
| 6.1 | No hardcoded user-facing string in a component | scan `components/` + `app/` for JSX text literals not sourced from `copy` (allow-list: icons, punctuation, `{" "}`) |
| 6.2 | Every `copy` key is reachable | no dead entries (warn only) |
| 6.3 | 🚫 No em-dash or en-dash anywhere | scan repo source for U+2014 / U+2013, excluding `node_modules`, `.next`, and Next-generated `AGENTS.md` |
| 6.4 | 🚫 No emoji in rendered UI code | scan `.tsx` for emoji codepoints |

## 7. Search (Lane B, E2E)

| # | Case | Assert |
|---|------|--------|
| 7.1 | 🇧🇬 `Каспаров` | at least one `/e/` result link |
| 7.2 | 🇧🇬 `Каспарв` (dropped letter) | still finds it - typo tolerance |
| 7.3 | 🇧🇬 `евровизия` and `еврвизия` | both return the same result count |
| 7.4 | `zzznothingzzz` | zero results, empty state renders, no crash |
| 7.5 | Empty `/search` with no query | renders the form, no crash |
| 7.6 | Cyrillic in results | not mojibake, `Ѐ-ӿ` present in the DOM |
| 7.7 | Search is a GET form | the query lands in the URL, so results are shareable |

## 8. Mobile + layout (Lane E, E2E, 390x844 project)

| # | Case | Assert |
|---|------|--------|
| 8.1 | All 7 routes at 390px | `documentElement.scrollWidth <= clientWidth` |
| 8.2 | 404 page at 390px | no overflow |
| 8.3 | Grid at 390px | page does not overflow, container does scroll |
| 8.4 | No element extends past the viewport | query all elements, assert `right <= viewportWidth` |

## 9. Theme + fonts (Lane E, E2E) 🚨 regression-critical

| # | Case | Assert |
|---|------|--------|
| 9.1 | Dark theme on first paint | `<html>` has `dark` before hydration, no light flash |
| 9.2 | Body background is dark | computed `background-color` is the dark token |
| 9.3 | 🚨 Sans font resolves to Geist, **not** a serif fallback | computed `font-family` on `<h1>` contains the Geist family |
| 9.4 | 🇧🇬 Cyrillic text uses the same family as Latin | compare computed `font-family` on a Bulgarian title vs an English heading |
| 9.5 | Mono font on the endpoint line | computed family is the mono token |

> **9.3 and 9.4 exist because both already broke once:** a circular
> `--font-sans: var(--font-sans)` silently fell back to serif, and `subsets: ["latin"]`
> excluded Cyrillic.

## 10. Console cleanliness (Lane E, E2E) 🚨 regression-critical

| # | Case | Assert |
|---|------|--------|
| 10.1 | Every route logs no unexpected console error | shared fixture fails the test |
| 10.2 | Allow-list is explicit and documented | currently only the known next-themes inline-script warning |
| 10.3 | No React hydration mismatch warning | on any route |
| 10.4 | No Base UI `nativeButton` accessibility error | specifically on the 404 page |

## 11. Resilience (Lane E, E2E, Playwright route interception)

| # | Case | Assert |
|---|------|--------|
| 11.1 | API unreachable | `/status` shows "API unreachable", page still renders, no crash |
| 11.2 | API degraded (redis down) | `/status` shows the Degraded badge and a Down dependency row |
| 11.3 | Recheck button when healthy | success toast |
| 11.4 | Recheck button when degraded | warning toast |
| 11.5 | Recheck button when unreachable | error toast |
| 11.6 | API slow | request aborts at the client timeout, error state renders |
| 11.7 | `build` succeeds with the API down | `/status` is `force-dynamic`, must not be prerendered |

## 12. Accessibility (Lane E, E2E + axe)

| # | Case | Assert |
|---|------|--------|
| 12.1 | axe scan, all 7 routes | zero critical or serious violations |
| 12.2 | Grid has a caption / accessible name | screen readers can identify it |
| 12.3 | Grid cells have accessible labels | title + score, not just a number |
| 12.4 | One `<h1>` per page | correct heading order |
| 12.5 | Keyboard navigation | tab reaches every grid cell link and the Recheck button |
| 12.6 | Focus is visible | focus ring present on interactive elements |
| 12.7 | Icons are `aria-hidden` | decorative lucide icons not announced |

## 13-19. Backend gaps (Lane D, Py)

| # | Case | Assert |
|---|------|--------|
| 13.1 | Unauthenticated call to a protected route | 401 |
| 13.2 | 🔒 Forged / tampered token | rejected, 401 |
| 13.3 | Expired token | rejected |
| 13.4 | Valid token provisions a `User` + `UserProfile` lazily | one row, not duplicated on repeat calls |
| 14.1 | Role matrix: `member` on moderator routes | 403 |
| 14.2 | Role matrix: `moderator` on admin-only actions | 403 |
| 14.3 | Role matrix: every write endpoint x every role | table-driven test |
| 15.1 | Rate limit on each write endpoint | Nth request in the window returns 429 |
| 15.2 | Rate limit is per user, not global | two users do not share a bucket |
| 16.1 | 🚨 Verifying a membership changes the elite score | no data migration, **no duplicate `Rating` rows** |
| 16.2 | Elite score ignores unverified members | |
| 16.3 | Elite score is scoped to that episode's channel | membership in channel A must not affect channel B |
| 16.4 | Public score counts everyone | |
| 16.5 | Denormalized columns match a recompute | sweep is self-healing |
| 17.1 | Backfill run twice | 0 created, N updated, row counts unchanged |
| 17.2 | Ingestion never creates Shorts | |
| 18.1 | 🔒 `PersonalTag` never appears on any public endpoint | iterate all `public` tag endpoints |
| 18.2 | 🔒 Verification screenshot unreachable without a signed URL | |
| 18.3 | 🔒 Screenshots never in a Meilisearch document | |
| 19.1 | 🔒 Client-supplied `user_id` in a body is ignored | actor comes from the token |
| 19.2 | Rating the same episode twice | updates, never duplicates (unique constraint holds) |

## 20-21. Contract (Lane C, Unit + script)

| # | Case | Assert |
|---|------|--------|
| 20.1 | 🚨 Committed `generated.ts` matches the live OpenAPI | regenerate to a temp file, diff, fail on drift |
| 20.2 | Drift failure message | tells the developer to run `npm run generate:types` |
| 20.3 | Generation is deterministic | running twice produces identical bytes |
| 21.1 | 🚫 Zero hand-written API types in `apps/web` | grep for `interface .*Out`/`type .*Out` shapes outside `packages/api-types` |
| 21.2 | Types actually bite | a compile-time probe proves tsc rejects a misspelled field, a wrong primitive, an unknown schema name, and an unknown operationId |

---

## 📊 Scoreboard

Fill this in as lanes land. **Do not mark a row done without a passing committed test.**

| Section | Rows | Lane | Done |
|---------|------|------|------|
| 1. Route rendering | 11 | A | ⬜ |
| 2. HTTP status codes | 6 | A | ⬜ |
| 3. Ratings grid | 17 | B | ⬜ |
| 4. Typed client | 43 | C | ⬜ |
| 5. Pure helpers | 8 | C | ⬜ |
| 6. Copy discipline | 4 | C | ⬜ |
| 7. Search | 7 | B | ⬜ |
| 8. Mobile + layout | 4 | E | ⬜ |
| 9. Theme + fonts | 5 | E | ⬜ |
| 10. Console cleanliness | 4 | E | ⬜ |
| 11. Resilience | 7 | E | ⬜ |
| 12. Accessibility | 7 | E | ⬜ |
| 13-19. Backend gaps | 21 | D | ⬜ |
| 20-21. Contract | 5 | C | ⬜ |
| **Total** | **149** | | |

> Section 4 counts 43 because two rows are ranges (`4.4-4.8` and `4.23-4.27` are 5 cases
> each). If you add rows, update this table so the total stays honest.
