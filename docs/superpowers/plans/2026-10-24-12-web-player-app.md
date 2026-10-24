# Web — Player App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players can use the web app to find a venue, pick slots, check out with add-ons, pay the advance with Stripe, see and cancel their bookings, look up a guest booking, and sign in.

**Architecture:** This plan extends the React 19 / Vite / react-router 8 SPA in `apps/web`. The app talks only to the existing `/api/v1` routes, plus one small API change in Task 1 so booking responses carry the venue and turf names. Code is split by feature folder (`auth/`, `search/`, `venue/`, `checkout/`, `payment/`, `bookings/`, `lookup/`), on top of a shared `lib/` (API client, types, formatting) and `components/ui/` (design-system primitives). Styles are CSS Modules that use only `tokens.css` variables. A test enforces this.

**Tech Stack:**
- React 19, react-router 8, react-i18next.
- CSS Modules.
- Leaflet with OpenStreetMap tiles for the map.
- `@stripe/stripe-js` and `@stripe/react-stripe-js` for the Payment Element.
- Google Identity Services script for Google sign-in.
- Vitest, jsdom and Testing Library for tests.

**Spec:** `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md` (§10–13 and §17 player screens). UI rules: `.superdesign/design-system.md`.

## Global Constraints

**Design system**
- All UI follows `.superdesign/design-system.md`. Read it before building any screen.
- Every color, font size, spacing, radius and shadow is a `var(--…)` from `apps/web/src/styles/tokens.css`. No hex, `rgb()`, `hsl()`, or px/rem font sizes, spacing, radii or shadows in any other file, and none in inline `style`.
  - If a value is missing, add a token to `tokens.css` in both light and dark, and a line to the design doc.
- Light and dark must both work. Theme comes from `data-theme` on `<html>` (`light`/`dark`), or from `prefers-color-scheme` when it is unset.
- `--brand` and `--brand-fg` are used only on public/player pages: CTA accents, the active tab underline and the selected slot.
- Numbers in prices, times and totals use `font-variant-numeric: tabular-nums`.
- Touch targets on player pages are at least 40px tall (`--control-lg`). Layout is mobile-first using `min-width` breakpoints: sm 640, md 768, lg 1024, xl 1280.

**Copy**
- Every user-visible string goes through i18next and exists in both `en.json` and `ru.json`.
- Russian runs 20–30% longer, so there are no fixed-width labels; buttons and tabs grow or wrap.
- Russian plurals use the i18next `_one/_few/_many/_other` keys.

**Data and formatting**
- Money is always integer minor units. Display it with `formatMoney(minor, currency, i18n.language)` from `@booking/shared`, and parse user input with `parseMoney`. No float arithmetic on money.
- Times and dates of a venue or booking are shown in the **venue's timezone**, never the browser's.
  - The slot grid uses the API's `localStart` and `localEnd`.
  - Booking instants go through `Intl.DateTimeFormat` with `timeZone: venue.timezone`.
- Slot statuses are `available | pending | booked | blocked | past`. **Pending is shown distinctly from booked** (warning-soft cell, "Pending" label).
- Booking statuses are `awaiting_payment | pending | confirmed | rejected | cancelled | expired | completed | no_show`.
- Badge colors:
  - confirmed: success
  - awaiting_payment and pending: warning
  - cancelled, rejected and expired: danger
  - completed and no_show: neutral
  - payment status refunded or partially_refunded: info

**Booking rules (from the spec)**
- At most `MAX_SLOTS_PER_BOOKING` (12) **consecutive** slots on **one** turf per booking.
- The advance is computed on the full total (slots plus add-ons).
- Guest booking is offered only when the quote says `guestAllowed: true`. Otherwise the player must sign in.
- A hold lasts `HOLD_MINUTES` (10) from creation, until `holdExpiresAt`.

**Auth**
- The access token is kept **in memory only** and sent as `Authorization: Bearer …`.
- The refresh token stays in the API's httpOnly `rt` cookie (path `/api/v1/auth`). Every `/auth/*` call uses `credentials: 'include'`.
- No token goes in `localStorage`.

**API conventions**
- Errors arrive as `{error:{code,message,details}}` and surface as `ApiError`.
- User-facing messages come from `errors.<code>` i18n keys, falling back to `errors.generic`.

**Commands**
- Tests: `node_modules/.bin/pnpm --filter web exec vitest run <path>` (or `--filter api`). Full suite: `node_modules/.bin/pnpm test`.
- Then run `node_modules/.bin/pnpm typecheck` and `node_modules/.bin/pnpm lint`.

**Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Session refresh races.**
   - Situation: several requests get 401 at once, or two tabs refresh together. Refresh tokens rotate with reuse detection.
   - Expected: one refresh per tab (requests share it), and tabs take turns through `navigator.locks` so the player is never silently logged out.
   - Test: Task 4 `concurrent 401s trigger one refresh`.
2. **`next` redirect after sign-in.**
   - Situation: a crafted `?next=//evil.com` or `?next=https://evil.com`.
   - Expected: it must land on `/`. Only same-app paths are honoured.
   - Test: Task 4 `safeNext`.
3. **Venue timezone differs from the browser's.**
   - Expected: a Dhaka venue viewed from Los Angeles shows Dhaka times and Dhaka's "today" in the date strip, and so does the booking list.
   - Tests: Task 2 `formatTime uses the venue zone`, Task 10 `date strip starts at venue-local today`.
4. **Slot taken between selecting and booking.**
   - Situation: the API returns 409 `slot_taken`.
   - Expected: a clear message, the grid reloaded, the selection cleared, and no half-made booking shown.
   - Test: Task 13 `slot_taken returns to a refreshed grid`.
5. **Payment and its hold.**
   - Hold expires while on the pay page: the form is replaced by an expired message with a way back to the venue, and nothing is charged.
   - Payment succeeded but the webhook is late: the confirmation keeps polling and shows "processing" until it flips to confirmed, then stops.
   - Tests: Task 14 `expired hold hides the payment form`, Task 15 `polls until confirmed`.

---

## File Structure

```
apps/api/src/bookings/playerJson.ts            (Task 1) booking JSON + venue/turf names for players
apps/web/src/lib/apiClient.ts                  (Task 2) auth header, credentials, refresh-on-401 hook, apiPatch
apps/web/src/lib/types.ts                      (Task 2) JSON shapes the web app reads
apps/web/src/lib/format.ts                     (Task 2) money/time/date formatting in venue zone
apps/web/src/lib/errors.ts                     (Task 2) ApiError → i18n message
apps/web/test/helpers/api.ts                   (Task 2) fetch mock by method+path
apps/web/test/helpers/render.tsx               (Task 3) renderApp(path, {user})
apps/web/test/tokens.test.ts                   (Task 2) no hardcoded design values
apps/web/test/i18n.test.ts                     (Task 2) en/ru key parity
apps/web/src/components/ui/*                   (Task 3) Button, TextField, Select, Badge, Card, Alert, Spinner, Dialog (+ .module.css)
apps/web/src/theme/ThemeProvider.tsx, ThemeToggle.tsx   (Task 3)
apps/web/src/components/AppShell.tsx           (Task 3) header + nav + outlet
apps/web/src/routes.tsx                        (Task 3) <AppRoutes/>, grows per task
apps/web/src/auth/AuthProvider.tsx, RequireAuth.tsx, safeNext.ts   (Task 4)
apps/web/src/components/ui/OtpInput.tsx, PhoneInput.tsx           (Task 5)
apps/web/src/auth/LoginPage.tsx, RegisterPage.tsx                  (Task 5)
apps/web/src/auth/GoogleButton.tsx, ForgotPasswordPage.tsx, ResetPasswordPage.tsx, ProfilePage.tsx  (Task 6)
apps/web/src/search/searchParams.ts, SearchForm.tsx                (Task 7)
apps/web/src/search/useSearch.ts, ResultCard.tsx, SearchPage.tsx   (Task 8)
apps/web/src/search/ResultsMap.tsx                                 (Task 9)
apps/web/src/venue/VenuePage.tsx, DateStrip.tsx, PhotoStrip.tsx    (Task 10)
apps/web/src/venue/slotSelection.ts, SlotGrid.tsx                  (Task 11)
apps/web/src/checkout/checkoutParams.ts, CheckoutPage.tsx, AddonPicker.tsx, BookingSummary.tsx  (Task 12)
apps/web/src/checkout/GuestForm.tsx, useSubmitBooking.ts           (Task 13)
apps/web/src/payment/PayPage.tsx, stripeAppearance.ts, useCountdown.ts  (Task 14)
apps/web/src/bookings/BookingStatusBadge.tsx, BookingDetailPage.tsx    (Task 15)
apps/web/src/bookings/MyBookingsPage.tsx, CancelDialog.tsx          (Task 16)
apps/web/src/lookup/LookupPage.tsx                                  (Task 17)
```

Routes, all inside `AppShell`:

| Path | Page | Notes |
|---|---|---|
| `/` | SearchPage | |
| `/venues/:slug` | VenuePage | |
| `/venues/:slug/checkout` | CheckoutPage | |
| `/login` | LoginPage | |
| `/register` | RegisterPage | |
| `/forgot-password` | ForgotPasswordPage | |
| `/reset-password` | ResetPasswordPage | |
| `/profile` | ProfilePage | auth |
| `/me/bookings` | MyBookingsPage | auth |
| `/me/bookings/:id` | BookingDetailPage | auth |
| `/me/bookings/:id/pay` | PayPage | auth |
| `/lookup` | LookupPage | |
| `*` | NotFound | |

---

### Task 1: API — player booking JSON carries venue and turf

The web app shows "Arena Dhaka · Court 2 · 18:00" on its booking pages, but `bookingJson` only has ids.

**Files:**
- Create: `apps/api/src/bookings/playerJson.ts`
- Modify: `apps/api/src/bookings/routes/public.ts`. Every route below that returns a `booking` or `bookings` switches to the new helpers.
- Test: `apps/api/test/bookings/playerJson.test.ts`

**Interfaces:**
- Produces:
  - `type PlayerPlace = { venue: { slug: string; name: string; address: string; city: string; timezone: string }; turf: { name: string } }`
  - `playerBookingsJson(bookings: BookingDoc[]): Promise<(ReturnType<typeof bookingJson> & PlayerPlace)[]>`. It loads the venues and turfs it needs in two `$in` queries with `crossTenant: true`. A missing venue or turf (deleted) yields `venue: null` / `turf: null`, so the type uses `PlayerPlace['venue'] | null`.
  - `playerBookingJson(b: BookingDoc)`, which wraps the list version for a single booking.
- Response changes (additive only): `POST /venues/:slug/turfs/:turfId/bookings`, `GET /bookings/lookup`, `POST /bookings/lookup/cancel`, `GET /me/bookings`, `GET /me/bookings/:id` and `POST /me/bookings/:id/cancel` now return booking objects with `venue` and `turf`.

- [ ] **Step 1: Write the failing test.** Reuse the seeding used by `apps/api/test/bookings/public.test.ts` (seed owner, venue `{name:'Arena', timezone:'Asia/Dhaka'}`, turf `{name:'Court 2'}`, signed-in player books one slot).
  - `GET /me/bookings` → `body.bookings[0]` matches `{ venue: { slug, name: 'Arena', timezone: 'Asia/Dhaka', address, city }, turf: { name: 'Court 2' } }`.
  - `GET /me/bookings/:id` → `body.booking.venue.name === 'Arena'`.
  - Guest create (201) and `GET /bookings/lookup` → `body.booking.turf.name === 'Court 2'`.
  - `playerBookingsJson([])` resolves `[]` and runs no query. Spy on `Venue.find` and expect it not called.
  - A booking whose turf was deleted → `turf: null`, and the venue is still present.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/bookings/playerJson.test.ts`. Expected: FAIL, `venue` undefined / module not found.
- [ ] **Step 3: Implement** `playerJson.ts` and switch the six routes over.
- [ ] **Step 4: Run** the new test plus `test/bookings`. Expected: all PASS. Existing assertions use `toMatchObject` or explicit fields; any exact-keys assertion on these routes gets `venue` and `turf` added.
- [ ] **Step 5: Commit** `feat(bookings): player booking responses name the venue and turf`

---

### Task 2: Web foundation — API client, types, formatting, guard tests

**Files:**
- Modify: `apps/web/src/lib/apiClient.ts`, `apps/web/package.json`, `.env.example`
- Create: `apps/web/src/lib/types.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/errors.ts`, `apps/web/test/helpers/api.ts`
- Test: `apps/web/test/apiClient.test.ts` (extend), `apps/web/test/format.test.ts`, `apps/web/test/tokens.test.ts`, `apps/web/test/i18n.test.ts`

**Dependencies:**
- Add with `node_modules/.bin/pnpm --filter web add leaflet @stripe/stripe-js @stripe/react-stripe-js` and `--filter web add -D @types/leaflet`.
- Add `VITE_GOOGLE_CLIENT_ID=` to `.env.example`, with the comment `# Same value as GOOGLE_CLIENT_ID; the Google button is hidden while empty`.

**Interfaces:**
- Produces, in `apiClient.ts`. Existing `ApiError`, `apiGet` and `apiPost` keep their signatures.
  - `apiPatch<T>(path, body): Promise<T>`
  - `setAccessToken(token: string | null): void`
  - `setRefreshHandler(fn: (() => Promise<string | null>) | null): void`
  - Every request sends `Authorization: Bearer <token>` when a token is set.
  - Every request whose path starts with `/auth/` uses `credentials: 'include'`.
  - On a 401 with code `invalid_token` or `unauthenticated`, for a request that carried a token and is not under `/auth/`: call the refresh handler once. If it returns a token, retry the request once with that token; otherwise throw the original `ApiError`.
- Produces, in `types.ts`. These mirror the API JSON exactly:
  - `PublicUser`: `{ id, name, email|null, emailVerified, phone|null, hasPassword, hasGoogle }`
  - `AuthResponse`: `{ user: PublicUser; accessToken: string; refreshToken: string }`
  - `PublicVenue`: slug, name, address, city, country, currency, timezone, location `{lat,lng}`, photos `{url,alt?}[]`, amenities `Amenity[]`, turfs `PublicTurf[]`
  - `PublicTurf`: `{ id, name, sports: Sport[], indoor: boolean, slotLengthMin: number }`
  - `SlotJson`: `{ startAt, endAt, localStart, localEnd, price: number|null, status: SlotStatus }`
  - `SlotDay`: `{ businessDate, currency, status: 'open'|'closed'|'outside_window', slots: SlotJson[] }`
  - `OfferedAddonJson`: `{ id, name, pricingType, unitPrice, maxQuantity, autoApply: AutoApplyRule|null }`
  - `QuoteJson`: `{ currency, slots:{startAt,endAt,price}[], addons: AddonLine[], subtotal, addonsTotal, total, advanceRequired }`
  - `QuoteResponse`: `{ quote: QuoteJson; guestAllowed: boolean; guestOtpRequired: boolean }`
  - `BookingJson`: every field of api `bookingJson`, plus `venue: PlayerVenue|null` and `turf: {name}|null` from Task 1
  - `RefundJson`
  - `CancellationPreview`: `{ percent, amount, rule: {minHoursBefore: number|null, percent}|null, amountPaid, amountRefunded, currency, card, cash }`
  - `PaymentStart`: `{ payment: { id, amount, currency, gateway:'stripe', clientSecret, publishableKey }, holdExpiresAt }`
  - `OtpSent`: `{ expiresInSec, resendInSec }`
  - `SearchResult` and `SearchResponse` are re-exported from `@booking/shared`.
- Produces, in `format.ts`:
  - `money(minor: number, currency: string, lang: string): string`, which delegates to shared `formatMoney`.
  - `formatTime(iso: string, timeZone: string, lang: string): string`, 2-digit hour and minute, `hourCycle: 'h23'`.
  - `formatDate(isoOrDate: string, timeZone: string, lang: string): string`, weekday short, day and month short. A bare `YYYY-MM-DD` is read as that calendar date, not shifted by zone.
  - `formatDistance(meters: number, lang: string): string`. Under 1000 → `"850 m"`; otherwise one-decimal km via `Intl.NumberFormat(lang, {style:'unit', unit:'kilometer', maximumFractionDigits:1})`. Metres use `unit:'meter'`.
- Produces, in `errors.ts`: `errorMessage(err: unknown, t: TFunction): string`. It returns `t('errors.' + code)` when that key exists, else `t('errors.generic')`. A non-`ApiError` gives `errors.generic`, and status 0 gives `errors.network_error`.
- Produces, in `test/helpers/api.ts`:
  ```ts
  export type Call = { method: string; path: string; query: URLSearchParams; body: unknown; headers: Headers; credentials?: RequestCredentials };
  export type Route = { method?: string; path: string | RegExp; status?: number; body?: unknown | ((call: Call, n: number) => unknown) };
  /** Stubs global fetch; `path` matches the URL path after `/api/v1`. First matching route wins; `n` counts that route's hits from 0. Unmatched → 599 + recorded in `unmatched`. */
  export function mockApi(routes: Route[]): { calls: Call[]; unmatched: Call[] };
  ```
  A `body` function may return `{ status, body }`, which overrides `status` for that hit (used for 401-then-200 sequences). Call `vi.unstubAllGlobals()` in `afterEach`.
- i18n: add `errors.{generic, network_error, slot_taken, slot_unavailable, hold_expired, otp_invalid, otp_expired, otp_required, otp_cooldown, otp_rate_limited, otp_attempts_exceeded, guest_booking_disabled, invalid_credentials, email_in_use, account_exists, too_late, too_early, payment_in_progress, payments_unavailable, outside_window, rate_limited, not_found, validation_error}` in en and ru.

- [ ] **Step 1: Write the failing tests**
  - `apiClient.test.ts`:
    - `sends bearer token when set`: after `setAccessToken('abc')`, `calls[0].headers.get('authorization') === 'Bearer abc'`.
    - `auth paths include credentials`: `apiPost('/auth/refresh', {})` → `credentials === 'include'`, and `/search` has no `include`.
    - `401 refreshes once and retries`: the first `/me/bookings` call returns 401 `invalid_token`, then 200. With a handler resolving `'new'`, the result is the 200 body, the second call carries `Bearer new`, and the handler was called once.
    - `refresh failure rethrows`: the handler resolves `null` → rejects with `ApiError` status 401.
    - `no refresh without a token`: no token set → 401 rejects and the handler is not called.
    - `apiPatch sends PATCH with JSON`.
  - `format.test.ts`:
    - `formatTime uses the venue zone`: `formatTime('2026-01-01T12:00:00.000Z', 'Asia/Dhaka', 'en') === '18:00'`, with the process TZ set to `America/Los_Angeles` via `process.env.TZ` before the import.
    - `money handles zero- and three-decimal currencies`: `money(1500, 'JPY', 'en')` contains `1,500` and `money(1500, 'KWD', 'en')` contains `1.500`.
    - `formatDistance`: `850 → '850 m'`, `12_345 → '12.3 km'` (en).
    - `formatDate('2026-01-01', 'Pacific/Kiritimati', 'en')` contains `Jan 1`.
  - `tokens.test.ts`: walk `src/**/*.{css,tsx}` except `styles/tokens.css`.
    - In `.css`, any declaration of `color`, `background`, `background-color`, `border-color`, `fill`, `stroke`, `font-size`, `padding*`, `margin*`, `gap`, `row-gap`, `column-gap`, `border-radius` or `box-shadow` whose value contains `#[0-9a-f]{3,8}`, `rgb(`, `hsl(` or `\d+(px|rem|em)` fails. `0` and `var(--…)` are OK; `calc()` with only vars and unitless numbers is OK.
    - In `.tsx`, `style={{` containing those property names with a literal number or colour fails.
    - The failure message lists `file:line`. It must pass on the current tree, which has only `base.css`.
  - `i18n.test.ts`: flatten the keys of `en.json` and `ru.json`. Strip the plural suffixes `_one|_few|_many|_other|_zero|_two` and compare the sets. Also check every ru value is a non-empty string.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/apiClient.test.ts test/format.test.ts`. Expected: FAIL (missing exports). `tokens` and `i18n` may already pass; that is fine, they are guards.
- [ ] **Step 3: Implement** `apiClient.ts`, `types.ts`, `format.ts`, `errors.ts`, `test/helpers/api.ts` and the i18n keys. The `TZ` must be set before `Intl` caches; use `vi.stubEnv` plus a dynamic import, or a per-file `// @vitest-environment-options`. Ledger whichever works.
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): authed API client, shared JSON types and venue-zone formatting`

---

### Task 3: UI kit, theme, app shell and routes

**Files:**
- Create:
  - `apps/web/src/components/ui/{Button,TextField,Select,Badge,Card,Alert,Spinner,Dialog}.tsx`, each with a `.module.css`
  - `apps/web/src/theme/ThemeProvider.tsx`, `ThemeToggle.tsx`
  - `apps/web/src/components/AppShell.tsx` (+css)
  - `apps/web/src/routes.tsx`
  - `apps/web/src/pages/NotFoundPage.tsx`
  - `apps/web/test/helpers/render.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/LanguageSwitcher.tsx` (restyle with `Select`), `apps/web/src/vite-env.d.ts` (CSS module types if missing)
- Test: `apps/web/test/theme.test.tsx`, `apps/web/test/shell.test.tsx`

**Interfaces:**
- Produces, UI primitives. Props extend the native element's props:
  - `Button`: `variant?: 'primary'|'brand'|'secondary'|'ghost'|'danger'`, `size?: 'sm'|'md'|'lg'`, `block?: boolean`, `loading?: boolean`. `loading` disables the button and shows a `Spinner`. Player pages default to `size='lg'`.
  - `TextField`: `label: string`, `error?: string`, `hint?: string`. It renders `<label>` + `<input>` + `aria-describedby` and is wired with `useId`.
  - `Select`: `label`, `options: {value:string; label:string}[]`.
  - `Badge`: `tone: 'success'|'warning'|'danger'|'info'|'neutral'`.
  - `Card`, `Alert`: `tone`, `role="alert"` for danger.
  - `Spinner`: `label`, which goes into `aria-label`.
  - `Dialog`: `open`, `onClose`, `title`, `children`. It uses native `<dialog>` with `showModal` when available. Escape closes it and focus returns to the opener.
- Produces, theme:
  - `ThemeProvider` holds `theme: 'system'|'light'|'dark'`, persisted in `localStorage['theme']` inside try/catch.
  - It sets `document.documentElement.dataset.theme` to `light`/`dark`, or removes it for `system`.
  - `useTheme(): { theme; setTheme }`.
  - `ThemeToggle` is a `Select` with labels from `theme.{system,light,dark}`.
- Produces, shell:
  - `AppShell` renders a header with the app name (link to `/`), nav and an `<Outlet/>`.
  - Nav when signed out: `nav.lookup` → `/lookup` and `nav.signIn` → `/login`. When signed in: `nav.myBookings` → `/me/bookings` and `nav.profile` → `/profile`.
  - It also shows `LanguageSwitcher` and `ThemeToggle`. The header wraps on narrow screens; there is no hamburger.
  - Until Task 4 exists, AppShell reads `useAuth()` from a stub that returns signed-out. Task 4 replaces the stub.
- Produces, routes:
  - `routes.tsx` exports `AppRoutes()`, a `<Routes>` with an `AppShell` layout route, `/` → the existing `HomePage` for now, and `*` → `NotFoundPage`.
  - `App.tsx` = `<ThemeProvider><AuthProvider><BrowserRouter><AppRoutes/></BrowserRouter></AuthProvider></ThemeProvider>`. `AuthProvider` arrives in Task 4; until then omit it.
- Produces, `test/helpers/render.tsx`: `renderApp(path: string, opts?: { user?: PublicUser }): RenderResult & { user: UserEvent }`. It renders the same providers with `MemoryRouter initialEntries={[path]}`. From Task 4 on it passes `initialUser` to `AuthProvider` (see Task 4).

- [ ] **Step 1: Write the failing tests**
  - `theme.test.tsx`:
    - `dark sets data-theme`: choosing "Dark" in the theme select → `document.documentElement.dataset.theme === 'dark'` and `localStorage.theme === 'dark'`.
    - `system removes data-theme`.
    - `stored theme applies on mount`.
  - `shell.test.tsx`:
    - `unknown path shows not found`: `renderApp('/nope')` → heading `en.notFound.title` and a link to `/`.
    - `signed-out nav`: links `en.nav.signIn` and `en.nav.lookup` are present.
    - `language switch re-renders nav in Russian`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Button heights come from `--control-sm|md|lg`. The `brand` variant uses `--brand` and `--brand-fg`. The focus ring is `--focus-ring`.
  - Badge tones use `--{tone}-soft` for the background and `--{tone}` for the text; neutral uses `--bg-subtle` / `--text-muted`.
  - No new tokens are expected. If one is needed, add it to `tokens.css` (light and dark) and to the design doc.
- [ ] **Step 4: Run** the web suite plus `test/tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): design-system primitives, theme toggle and app shell`

---

### Task 4: Session state, guarded routes and safe redirects

**Files:**
- Create: `apps/web/src/auth/AuthProvider.tsx`, `apps/web/src/auth/RequireAuth.tsx`, `apps/web/src/auth/safeNext.ts`
- Modify: `App.tsx`, `AppShell.tsx` (drop the stub), `test/helpers/render.tsx`
- Test: `apps/web/test/auth/session.test.tsx`, `apps/web/test/auth/safeNext.test.ts`

**Interfaces:**
- Produces:
  - `AuthProvider({ children, initialUser?: PublicUser|null })`.
    - When `initialUser` is `undefined` (the app case), it restores the session on mount with `POST /auth/refresh` (credentials). Success → status `signedIn`; failure → `signedOut`.
    - When `initialUser` is given (tests), it skips the refresh and starts in that state with access token `'test-token'`.
  - `useAuth(): { status: 'loading'|'signedIn'|'signedOut'; user: PublicUser|null; signIn(res: AuthResponse): void; setUser(u: PublicUser): void; signOut(): Promise<void> }`.
    - `signIn` sets the user and token.
    - `signOut` calls `POST /auth/logout` (credentials) and clears state even if that fails.
  - The provider registers `setRefreshHandler`. The handler posts `/auth/refresh` and returns the new token, or signs out and returns `null` on failure.
    - Concurrent calls in one tab share one in-flight promise.
    - The refresh body runs inside `navigator.locks.request('auth-refresh', …)` when `navigator.locks` exists, so two tabs never present the same rotating token at once.
  - `RequireAuth({ children })`: while `loading` it renders a `Spinner`; when `signedOut` it does `<Navigate to={'/login?next=' + encodeURIComponent(pathname + search)} replace/>`.
  - `safeNext(raw: string|null): string` returns `raw` only if it starts with `/`, not `//` and not `/\`, and parses with `new URL(raw, location.origin).origin === location.origin`. Anything else returns `'/'`.
  - `renderApp(path, { user })` now passes `initialUser={opts.user ?? null}`.

- [ ] **Step 1: Write the failing tests**
  - `safeNext`:
    - `'/me/bookings?x=1'` → same.
    - `null`, `''`, `'//evil.com'`, `'https://evil.com'`, `'/\\evil.com'` and `'javascript:alert(1)'` → `'/'`.
  - `session.test.tsx`, rendering `<AuthProvider>` without `initialUser` and a probe component:
    - `restores session from refresh cookie`: refresh 200 → probe shows user name, and `calls[0].credentials === 'include'`.
    - `refresh 401 → signed out`.
    - `concurrent 401s trigger one refresh`: signed in; two parallel `apiGet('/me/bookings')` each first get 401 `invalid_token`, then 200. The `/auth/refresh` route is hit exactly once and both resolve.
    - `signOut posts logout and clears user even when logout fails`: logout 500 → status `signedOut`.
    - `RequireAuth redirects with next`: `renderApp('/me/bookings')` signed out (refresh 401) → login page is shown. Assert on the `MemoryRouter` location via a location probe: `/login?next=%2Fme%2Fbookings`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): session restore, single-flight refresh and guarded routes`

---

### Task 5: Sign-in and register — phone OTP and email

**Files:**
- Create: `apps/web/src/components/ui/OtpInput.tsx` (+css), `apps/web/src/components/ui/PhoneInput.tsx` (+css), `apps/web/src/auth/LoginPage.tsx`, `apps/web/src/auth/RegisterPage.tsx` (+ shared `auth.module.css`)
- Modify: `routes.tsx` (`/login`, `/register`), locales
- Test: `apps/web/test/ui/otpInput.test.tsx`, `apps/web/test/auth/login.test.tsx`

**Interfaces:**
- Produces:
  - `OtpInput({ value, onChange, length = 6, label, error? })`.
    - Six boxes, each `inputMode="numeric"` with `autoComplete="one-time-code"` on the first.
    - Typing advances focus, Backspace on an empty box goes back, and pasting 6 digits fills all.
    - Non-digits are ignored. `onChange` gets the joined string.
    - Wrapped in a group labelled `label`.
  - `PhoneInput({ value, onChange, label, error? })`: a country-code `<select>` plus a number input. `value` and `onChange` use the E.164 string (`'+8801712345678'`).
    - Country list constant `DIAL_CODES = [{code:'BD',dial:'+880'},{code:'RU',dial:'+7'},{code:'IN',dial:'+91'},{code:'GB',dial:'+44'},{code:'US',dial:'+1'},{code:'AE',dial:'+971'}]`, default `+880`.
    - Country names come from `Intl.DisplayNames([lang], {type:'region'})`.
    - Non-digits are stripped from the number part. The API normalises; no client-side validation beyond "not empty".
  - `LoginPage`: tabs `auth.tabs.phone` / `auth.tabs.email` (phone first).
    - Phone flow: `POST /auth/otp/request {phone}` → code step with `OtpInput` and a resend button disabled for `resendInSec` (countdown text) → `POST /auth/otp/verify {phone, code}` → `signIn(res)` → `navigate(safeNext(next), {replace:true})`.
    - Email flow: `POST /auth/login {email,password}` → same.
    - Errors render through `errorMessage` in an `Alert`.
    - Links to `/register?next=…` and `/forgot-password`.
    - `GoogleButton` slot added in Task 6.
  - `RegisterPage`: name, email, password (min 8, hint text) → `POST /auth/register` → `signIn` → `safeNext(next)`. On 409 `email_in_use`, show the message and a link to `/login`.
  - When already `signedIn`, both pages `<Navigate to={safeNext(next)} replace/>`.

- [ ] **Step 1: Write the failing tests**
  - `otpInput.test.tsx`:
    - `paste fills six boxes`: paste `'123456'` → `onChange('123456')`.
    - `typing advances focus`.
    - `backspace on empty box moves back`.
    - `letters ignored`.
  - `login.test.tsx`:
    - `phone OTP signs in and returns to next`: `renderApp('/login?next=%2Fme%2Fbookings')` with `/auth/otp/request` → 202 `{expiresInSec:300,resendInSec:60}`, `/auth/otp/verify` → 200 auth response, and `/me/bookings` mocked empty. After typing phone `1712345678` and code `123456`, the request body is `{phone:'+8801712345678'}`, and the My bookings heading is shown.
    - `resend disabled during cooldown` (fake timers): the resend button is disabled and shows 60 → enabled after 60 s.
    - `wrong code shows otp_invalid message`: verify → 400 `otp_invalid` → text `en.errors.otp_invalid`.
    - `email login`: `/auth/login` 200 → navigates to `/`.
    - `invalid credentials message`.
    - `register then signed in`, and `register email_in_use shows login link`.
    - `signed-in user visiting /login is redirected`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Until Task 16, `/me/bookings` can point at a placeholder page with the `myBookings.title` heading; Task 16 replaces it.
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): phone OTP and email sign-in, registration`

---

### Task 6: Google sign-in, password reset and profile

**Files:**
- Create: `apps/web/src/auth/GoogleButton.tsx`, `apps/web/src/auth/ForgotPasswordPage.tsx`, `apps/web/src/auth/ResetPasswordPage.tsx`, `apps/web/src/auth/ProfilePage.tsx`
- Modify: `LoginPage.tsx`, `RegisterPage.tsx` (render `GoogleButton`), `routes.tsx`, locales
- Test: `apps/web/test/auth/google.test.tsx`, `apps/web/test/auth/profile.test.tsx`

**Interfaces:**
- Produces:
  - `GoogleButton({ onSignedIn(res: AuthResponse): void })`.
    - Renders nothing when `import.meta.env.VITE_GOOGLE_CLIENT_ID` is empty.
    - Otherwise it injects `https://accounts.google.com/gsi/client` once, then calls `google.accounts.id.initialize({ client_id, callback: ({credential}) => POST /auth/google {idToken: credential} })` and `renderButton(div, { theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'continue_with', locale: i18n.language })`.
    - A 409 `account_exists` shows `errors.account_exists`.
    - Declare the minimal `window.google` type in `src/auth/google.d.ts`.
  - `ForgotPasswordPage`: email → `POST /auth/password/forgot` → always shows `auth.forgot.sent` (same text whether or not the account exists).
  - `ResetPasswordPage`: reads `?token=`, takes a new password (min 8) → `POST /auth/password/reset` → success message and link to `/login`. On 400 `invalid_reset_token`, show the message and a link to `/forgot-password`. With no token, show the same invalid message.
  - `ProfilePage` (RequireAuth):
    - Name field → `PATCH /me {name}` → `setUser`.
    - Shows the email (with a verified badge) and phone read-only, plus "Signed in with Google" when `hasGoogle`.
    - A sign-out button → `signOut()` → `/`.

- [ ] **Step 1: Write the failing tests**
  - `google.test.tsx`:
    - `hidden without client id` (`vi.stubEnv('VITE_GOOGLE_CLIENT_ID','')`).
    - `credential posts idToken and signs in`: stub `window.google.accounts.id` capturing `callback`, invoke it with `{credential:'tok'}` → body `{idToken:'tok'}`.
    - `account_exists message`.
  - `profile.test.tsx`:
    - `rename saves and shows new name in form` (`PATCH /me` body `{name:'New'}`).
    - `sign out returns home and shows sign-in link`.
    - `reset without token shows invalid link message`.
    - `forgot always shows sent`, both for 202 and for the unknown-email case (same 202).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Google sign-in, password reset and profile`

---

### Task 7: Search criteria — URL model and search form

**Files:**
- Create: `apps/web/src/search/searchParams.ts`, `apps/web/src/search/SearchForm.tsx` (+css)
- Modify: locales (`search.*`, `sports.*` for every `SPORTS` value, `amenities.*` for every `AMENITIES` value)
- Test: `apps/web/test/search/searchParams.test.ts`, `apps/web/test/search/searchForm.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type Criteria = {
    near: { lat: number; lng: number } | null;
    radiusKm: number | null;          // null = any distance
    sport: Sport | null;
    indoor: boolean | null;
    date: string | null;              // null = each venue's today
    from: string | null; to: string | null;
    currency: string | null; minPrice: number | null; maxPrice: number | null; // minor units
    available: boolean;
  };
  export const EMPTY_CRITERIA: Criteria;
  export function criteriaFromParams(p: URLSearchParams): Criteria;   // invalid values dropped, never throws
  export function criteriaToParams(c: Criteria): URLSearchParams;      // omits nulls/false; same names as the API query
  export function apiQuery(c: Criteria, cursor: number, limit = 20): string; // '?…' for GET /search
  ```
  - `criteriaFromParams` enforces the API's pairing rules: lat with lng; radius only with near; from with to and `from !== to`; prices only with currency; `minPrice <= maxPrice`. A broken pair drops both halves.
  - Prices are stored in minor units in the URL.
- Produces: `SearchForm({ value: Criteria; onChange(c: Criteria): void; currencies: string[] })`.
  - **Location:**
    - Button `search.useMyLocation` calls `navigator.geolocation.getCurrentPosition` and sets `near` (rounded to 4 dp).
    - On error it shows `search.locationDenied` and leaves `near` null.
    - When `near` is set, a "Clear" button appears.
    - Picking on the map is Task 9.
  - **Radius:** a `Select` with options any / 10 / 20 / 30 (`SEARCH_RADII_KM`) / custom. Custom shows a number input in km, 1–`MAX_SEARCH_RADIUS_KM`. Disabled while `near` is null, with hint `search.radiusNeedsLocation`.
  - **Sport** select (any + `SPORTS`), **date** (`<input type="date">`, empty = today), **indoor** (any/indoor/outdoor), and **time range** (from/to `<input type="time" step=1800>`, applied only when both are set).
  - **Available only** checkbox.
  - **Price:** `currency` select from `currencies` (the ones seen in results, passed in by the page), with min and max decimal inputs parsed by `parseMoney(input, currency)`. Hidden when `currencies` is empty.
  - Filters beyond location, sport and date sit in a "More filters" disclosure (`<details>`) so the phone layout stays short.
  - The form calls `onChange` on submit (button `search.submit`), not on every keystroke.

- [ ] **Step 1: Write the failing tests**
  - `searchParams.test.ts`:
    - `round-trip`: a full Criteria → params → Criteria is equal.
    - `lat without lng dropped`, `radius without near dropped`, `from equal to dropped`, `price without currency dropped`, `min > max dropped`, `garbage values dropped (sport=chess, date=2026-13-40, radiusKm=-5, radiusKm=501)`.
    - `apiQuery(EMPTY_CRITERIA, 0) === '?limit=20&cursor=0'`.
    - `prices stay minor units`: `apiQuery({...c, currency:'USD', minPrice:1000}, 0)` contains `minPrice=1000`.
  - `searchForm.test.tsx`:
    - `geolocation fills near`: stub `navigator.geolocation.getCurrentPosition` → success `{coords:{latitude:23.81234, longitude:90.41234}}`; after submit, `onChange` receives `near:{lat:23.8123,lng:90.4123}`.
    - `geolocation denied shows message`.
    - `radius disabled without location`.
    - `custom radius 45 → radiusKm 45`.
    - `price parsed to minor units`: currency USD, min `12.50` → `minPrice: 1250`.
    - `price hidden when no currencies`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): search criteria model and search form`

---

### Task 8: Search results list and paging (home page)

**Files:**
- Create: `apps/web/src/search/useSearch.ts`, `apps/web/src/search/ResultCard.tsx` (+css), `apps/web/src/search/SearchPage.tsx` (+css)
- Modify: `routes.tsx` (`/` → `SearchPage`). Delete `apps/web/src/pages/HomePage.tsx` and `apps/web/test/HomePage.test.tsx`; their language-switch coverage lives in `shell.test.tsx`.
- Test: `apps/web/test/search/useSearch.test.tsx`, `apps/web/test/search/searchPage.test.tsx`

**Interfaces:**
- Produces: `useSearch(c: Criteria): { results: SearchResult[]; status: 'loading'|'idle'|'error'; error: unknown; hasMore: boolean; loadMore(): void; retry(): void }`.
  - A new `c` (compared via `criteriaToParams(c).toString()`) resets and fetches cursor 0. A stale response for old criteria is ignored (request id).
  - **Plan 11 deferred minor:** a page may legally come back with `results: []` and a non-null `nextCursor`, because filtered-out venues still advance the cursor. While the accumulated results are fewer than one page (20) and `nextCursor !== null`, the hook keeps fetching the next cursor automatically, up to `AUTO_FOLLOW_MAX = 10` extra requests per load.
    - After that, `hasMore` stays true and the page shows "Load more".
    - `hasMore = nextCursor !== null`.
    - `loadMore()` fetches from `nextCursor` and applies the same auto-follow rule to the newly loaded batch.
  - A 429 `rate_limited` → `status 'error'`, message `errors.rate_limited`.
- Produces: `ResultCard({ r: SearchResult })`, a link to `/venues/${slug}?date=${r.date}`.
  - Shows the photo (or a neutral placeholder block), name, city, sport chips (`sports.*`), and distance (`formatDistance`) when not null.
  - Shows "from {money}" when `fromPrice` is not null, else `search.noPrice`.
  - Next free slot: `search.nextFree` with `localStart`–`localEnd` and turf name, or `search.noFreeSlot`.
- Produces: `SearchPage`.
  - Criteria come from the URL (`useSearchParams`). `SearchForm` `onChange` → `setSearchParams(criteriaToParams(c))`.
  - Currencies for the price filter = distinct `r.currency` of the loaded results.
  - Shows a result count (`search.count`, plural), an empty state (`search.empty`) when `!hasMore && results.length===0`, a loading skeleton and a retry `Alert`.
  - Map toggle placeholder is filled in Task 9.

- [ ] **Step 1: Write the failing tests**
  - `useSearch.test.tsx` (`renderHook` + `mockApi`):
    - `keeps fetching while empty pages have a cursor`: responses are cursor 0 → `{results:[], nextCursor:100}`, cursor 100 → `{results:[], nextCursor:200}`, cursor 200 → `{results:[A], nextCursor:null}`. Three `/search` calls with cursors `0,100,200`; results `[A]`; `hasMore false`.
    - `stops auto-following after 10 extra requests`: every response is `{results:[], nextCursor:n+100}`. Exactly 11 calls, `hasMore true`, status `idle`.
    - `loadMore appends next page`.
    - `criteria change discards stale response`: the first request resolves after the second (deferred promise) → results come from the second criteria only.
    - `rate limited shows error`.
  - `searchPage.test.tsx`:
    - `renders results from URL criteria`: `renderApp('/?sport=futsal')` → the call's query has `sport=futsal`, and a card shows the name, `from` price formatted `money(1000,'BDT','en')` and the next free `08:00`.
    - `submitting form updates URL and refetches`.
    - `empty state`.
    - `result links to venue with date`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): search results with auto-follow paging on the home page`

---

### Task 9: Results map and pick-a-place

The spec leaves the map provider to the builder. **Decision:** Leaflet with OpenStreetMap tiles. It needs no API key, so no geocoding service is used. A "picked place" is chosen by panning the map and pressing "Search this area", which sets `near` to the map centre. Pins are `L.divIcon` elements (no image assets) styled with tokens.

**Files:**
- Create: `apps/web/src/search/ResultsMap.tsx` (+css)
- Modify: `SearchPage.tsx` (list/map layout and toggle), locales
- Test: `apps/web/test/search/resultsMap.test.tsx`, plus additions to `searchPage.test.tsx`

**Interfaces:**
- Produces: `ResultsMap({ results: SearchResult[]; center: {lat,lng}|null; onSearchArea(center:{lat,lng}): void; onSelect(slug: string): void })`.
  - Loaded with `React.lazy` from `SearchPage`, so Leaflet and its CSS stay out of the main chunk.
  - One pin per result, labelled `money(fromPrice)` or the venue name when there is no price. Clicking a pin calls `onSelect`, and `SearchPage` navigates to the venue.
  - It fits bounds to the results, or centres on `center` at zoom 12, or shows the world view when there is neither.
  - The OSM attribution control is required: `© OpenStreetMap contributors`.
  - `export function pinLabel(r: SearchResult, lang: string): string` is pure and tested directly.
- `SearchPage` layout:
  - Below `lg`: a segmented toggle `search.view.list` / `search.view.map`, with one visible at a time.
  - At `lg` and up: list and map side by side, with the map sticky. Map height uses a new token `--map-height` (light/dark same value), added to `tokens.css` and the design doc.
  - `onSearchArea` sets `near` to the centre and keeps the radius; if the radius is null it sets 10.

- [ ] **Step 1: Write the failing tests**
  - `resultsMap.test.tsx`: `pinLabel` → money for a priced result, the name for `fromPrice:null`.
  - `searchPage.test.tsx`, with `vi.mock('../../src/search/ResultsMap', …)` rendering a button that calls `onSearchArea({lat:1,lng:2})`:
    - `map toggle shows map`.
    - `search this area sets near and default radius`: URL gets `lat=1&lng=2&radiusKm=10`, and the next call's query contains them.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Import `leaflet/dist/leaflet.css` inside `ResultsMap.tsx`. In the tokens test, skip files under `node_modules` (already excluded by walking `src/` only).
- [ ] **Step 4: Run** the web suite and `node_modules/.bin/pnpm --filter web build`. Expected: PASS, and the build emits a separate chunk containing `leaflet`.
- [ ] **Step 5: Commit** `feat(web): results map with search-this-area`

---

### Task 10: Venue page — details, turfs and date strip

**Files:**
- Create: `apps/web/src/venue/VenuePage.tsx` (+css), `apps/web/src/venue/DateStrip.tsx` (+css), `apps/web/src/venue/PhotoStrip.tsx` (+css)
- Modify: `routes.tsx`, locales
- Test: `apps/web/test/venue/venuePage.test.tsx`, `apps/web/test/venue/dateStrip.test.tsx`

**Interfaces:**
- Consumes: `GET /venues/:slug` → `{ venue: PublicVenue }`, 404 → not-found state.
- Produces: `VenuePage`.
  - URL state: `?turf=<id>&date=YYYY-MM-DD`. Turf defaults to the first turf and date to venue-local today. Changing either uses `setSearchParams(…, {replace:true})`.
  - Header: name, address and city, sport chips, and an amenities list (`amenities.*`) shown as chips.
  - `PhotoStrip`: horizontally scrollable images with `alt` (fallback = venue name), and a placeholder when there are none.
  - Turf tabs (`role="tablist"`): name plus an indoor/outdoor label. The active tab underline uses `--brand`.
  - A slot grid area below. Task 11 fills it; for now it shows the selected turf and date.
- Produces: `DateStrip({ today: string; value: string; onChange(d: string): void; days = 14; timeZone: string })`.
  - Day chips from `today` for `days` days, built with shared `addDays`. Labels come from `formatDate(d, 'UTC', lang)`, since the date is already venue-local.
  - Selected chip = primary. Today's chip has a dot and `aria-current="date"`. Each chip is a button ≥ `--control-lg`. The strip scrolls horizontally.
  - A `value` outside the strip (from a URL) is shown as an extra first chip so it stays visible.
  - Venue-local today is `localParts(new Date(), venue.timezone).date` from `@booking/shared`.

- [ ] **Step 1: Write the failing tests**
  - `dateStrip.test.tsx`:
    - `14 chips starting today`.
    - `today has aria-current`.
    - `click selects`.
    - `date strip starts at venue-local today`: `vi.setSystemTime(new Date('2026-01-01T20:00:00Z'))`. On the VenuePage with timezone `Asia/Dhaka`, the first chip is Jan 2 (Dhaka is +6, so 02:00 on Jan 2), whatever the process TZ.
  - `venuePage.test.tsx`:
    - `renders venue details and amenities` (Russian amenity label after a language switch).
    - `turf tab switch updates URL`.
    - `unknown slug shows not found`.
    - `no photos shows placeholder`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): venue page with turf tabs and date strip`

---

### Task 11: Slot grid and slot selection

**Files:**
- Create: `apps/web/src/venue/slotSelection.ts`, `apps/web/src/venue/SlotGrid.tsx` (+css)
- Modify: `VenuePage.tsx` (grid plus a sticky selection bar), locales
- Test: `apps/web/test/venue/slotSelection.test.ts`, `apps/web/test/venue/slotGrid.test.tsx`

**Interfaces:**
- Consumes: `GET /venues/:slug/turfs/:turfId/slots?date=` → `{ day: SlotDay }`.
- Produces, in `slotSelection.ts`: `toggleSlot(slots: SlotJson[], selected: string[], startAt: string): string[]`. `selected` holds `startAt` values kept sorted.
  - A non-available slot → returns `selected` unchanged.
  - Clicking a selected slot at either end of the run removes it. Clicking a selected slot in the middle → `[startAt]` (restart from it).
  - An available slot adjacent to the run, where `slot.endAt === first.startAt` or `slot.startAt === last.endAt`, extends the run, unless that would exceed `MAX_SLOTS_PER_BOOKING`, in which case `selected` is returned unchanged.
  - Anything else → `[startAt]`.
- Produces: `SlotGrid({ day: SlotDay; selected: string[]; onToggle(startAt: string): void })`.
  - Responsive grid: 3 columns on phone, 4 at `sm`, 6 at `lg`.
  - Each cell shows `localStart` (14/500 tabular) and the price (12, muted, `money`) and is at least `--control-lg` tall.
  - States:
    - available: surface + border, clickable `button`
    - selected: `--brand` / `--brand-fg`, `aria-pressed=true`
    - booked: `--bg-subtle`, `--text-subtle`, label `slots.booked`, disabled
    - pending: `--warning-soft` with `--warning` text, label `slots.pending`, disabled
    - blocked: 45° stripes via `repeating-linear-gradient(45deg, var(--bg-subtle) 0 var(--space-1), var(--bg-surface) var(--space-1) var(--space-2))`, label `slots.blocked`, disabled
    - past: `--text-subtle`, disabled
  - Each disabled cell's state is in its accessible name (`aria-label` = time + state), so it is not conveyed by colour alone.
  - A slot with `price === null` is shown but disabled.
  - Day `status: 'closed'` → `slots.closed`. `'outside_window'` → `slots.outsideWindow`. No slots → `slots.none`.
  - A legend under the grid explains available, selected, pending, booked and blocked.
- `VenuePage` keeps `selected` in state.
  - It is cleared when the turf or date changes.
  - The sticky bottom bar (phone) or side card (`lg`) shows the slot count (`slots.selectedCount`, plural), the time range `first.localStart–last.localEnd`, the sum of prices (`money`) and a `brand` Button `slots.continue`.
  - The button links to `/venues/:slug/checkout?turf=…&date=…&slots=<startAt>,<startAt>…` (built by Task 12's `checkoutParams`). Until Task 12, build the query inline.

- [ ] **Step 1: Write the failing tests**
  - `slotSelection.test.ts`, with 30-minute slots s0..s13 all available plus s3 booked:
    - `first click selects`.
    - `adjacent extends forward and backward`.
    - `non-adjacent restarts`.
    - `end click shrinks`.
    - `middle click restarts`.
    - `cannot pass a booked slot`: selected [s1, s2], click s4 → [s4].
    - `max 12`: s0..s11 selected, click s12 → unchanged.
    - `pending slot ignored`.
  - `slotGrid.test.tsx`:
    - `pending is distinct from booked`: both disabled; the pending cell's accessible name contains `en.slots.pending` and the booked one `en.slots.booked`; their class names differ.
    - `available click calls onToggle`.
    - `closed day message`.
    - `outside window message`.
    - `venue page: selecting two slots shows count and total then continue links to checkout with both startAts`.
    - `changing date clears selection`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): slot grid with distinct pending state and consecutive selection`

---

### Task 12: Checkout — quote, add-ons, totals and advance

**Files:**
- Create: `apps/web/src/checkout/checkoutParams.ts`, `apps/web/src/checkout/CheckoutPage.tsx` (+css), `apps/web/src/checkout/AddonPicker.tsx` (+css), `apps/web/src/checkout/BookingSummary.tsx` (+css)
- Modify: `routes.tsx`, `VenuePage.tsx` (use `checkoutHref`), locales
- Test: `apps/web/test/checkout/checkout.test.tsx`

**Interfaces:**
- Produces:
  - `checkoutHref(slug, turfId, date, startAts: string[]): string`
  - `readCheckout(p: URLSearchParams): { turfId: string; date: string; startAts: string[] } | null`. Returns null when anything is missing or malformed.
- Consumes:
  - `GET /venues/:slug`
  - `GET /venues/:slug/turfs/:turfId/addons` → `{ currency, addons: OfferedAddonJson[] }`
  - `POST /venues/:slug/turfs/:turfId/quote {date, startAts, addons}` → `QuoteResponse`
- Produces: `AddonPicker({ offered: OfferedAddonJson[]; quoteLines: AddonLine[]; value: AddonSelection[]; onChange(v: AddonSelection[]): void; currency })`.
  - Addons with `autoApply` are not selectable. They appear in the summary from `quote.addons` where `auto: true`, labelled `checkout.autoAdded`.
  - Others show as a checkbox (`per_booking`) or a quantity stepper 0..`maxQuantity` (`per_unit`, `per_hour`), with the unit price and pricing-type label (`addons.per_booking|per_unit|per_hour`).
- Produces: `BookingSummary({ venue: PublicVenue; turf: PublicTurf; date; quote: QuoteJson; children? })`.
  - Lists each slot as `formatTime(startAt, tz)–formatTime(endAt, tz)` with its price, then add-on lines (name × qty, total), the subtotal, the add-ons total, and the **total** (20/600 tabular).
  - When `advanceRequired > 0`: rows `checkout.advanceDue` (= `advanceRequired`) and `checkout.payLater` (= `total − advanceRequired`).
  - `children` holds the CTA area.
- Produces: `CheckoutPage`.
  - Invalid params → `Alert` with a link back to the venue.
  - It fetches the venue and add-ons, then re-quotes on mount and on every add-on change (debounced 250 ms, latest response wins).
  - Quote errors (`slot_unavailable`, `outside_window`, `slot_taken`, …) → `Alert` via `errorMessage` plus a link "Choose other slots" back to `/venues/:slug?turf=&date=`.
  - CTA area, decided from `useAuth().status` and `quote`:
    - signed in → `brand` Button `checkout.book` (`advanceRequired > 0` → label `checkout.bookAndPay` with the advance amount). Task 13 wires it.
    - signed out and `guestAllowed` → the guest form placeholder (Task 13), plus a link `checkout.signInInstead` → `/login?next=<this checkout URL>`.
    - signed out and not `guestAllowed` → text `checkout.signInRequired` (explains that an advance payment needs an account) and a `brand` Button link to `/login?next=…`, plus `/register?next=…`.

- [ ] **Step 1: Write the failing tests** (`checkout.test.tsx`)
  - `shows slots, totals and advance`: quote `{subtotal:2000, addonsTotal:300, total:2300, advanceRequired:1150}` in BDT → the summary has `money(2300,'BDT','en')`, advance `money(1150…)` and pay-later `money(1150…)`. Times are in venue tz: `startAt 2026-01-01T12:00:00Z`, Dhaka → `18:00`.
  - `auto add-on shown as included and not selectable`.
  - `choosing quantity re-quotes with selection`: after the stepper goes to 2 (fake timers advance 250 ms), the last quote call body is `addons:[{addonId:'a1', quantity:2}]`.
  - `stale quote ignored`: the first quote resolves after the second.
  - `signed out + advance → sign-in required with next back to checkout`: the link href is `/login?next=` + the encoded current path and search.
  - `signed out + guestAllowed → guest option and sign-in link`.
  - `quote error offers to choose other slots`.
  - `malformed params → alert`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): checkout with live quote, add-ons and advance due`

---

### Task 13: Placing the booking — signed-in and guest

**Files:**
- Create: `apps/web/src/checkout/GuestForm.tsx` (+css), `apps/web/src/checkout/useSubmitBooking.ts`
- Modify: `CheckoutPage.tsx`, locales
- Test: `apps/web/test/checkout/submit.test.tsx`

**Interfaces:**
- Consumes:
  - `POST /venues/:slug/turfs/:turfId/bookings {date, startAts, addons, guest?}` → 201 `{ booking: BookingJson }`
  - `POST /venues/:slug/bookings/otp {phone}` → `OtpSent`
- Produces: `useSubmitBooking(slug, turfId): { submit(input: { date; startAts; addons; guest?: { name; phone; otpCode? } }): Promise<BookingJson>; pending: boolean }`.
- Produces: `GuestForm({ otpRequired: boolean; onSubmit(guest): void; pending; slug })`.
  - Name (`TextField`) and phone (`PhoneInput`).
  - If `otpRequired`: button `checkout.sendCode` → OTP request → `OtpInput` and a resend cooldown (same behaviour as Task 5; reuse the cooldown hook, extracted there as `useCooldown(seconds)` in `src/auth/useCooldown.ts` if not already).
  - Submit is disabled until the name, phone and (if required) a 6-digit code are filled.
- After a successful create:
  - Signed in and `booking.status === 'awaiting_payment'` → `navigate('/me/bookings/' + id + '/pay')`.
  - Signed in otherwise → `navigate('/me/bookings/' + id + '?new=1')`.
  - Guest → `navigate('/lookup?reference=' + ref + '&phone=' + encodeURIComponent(phone) + '&new=1')`.
- On 409 `slot_taken` (or a quote-time `slot_unavailable`): navigate to `/venues/:slug?turf=&date=` with router state `{ notice: 'slot_taken' }`. `VenuePage` shows that notice in an `Alert` above the grid. The grid is fetched fresh on mount, and the selection starts empty.
- Other errors: an `Alert` in the checkout with `errorMessage`. Specifically, `otp_invalid` / `otp_expired` keep the form filled and clear only the code.

- [ ] **Step 1: Write the failing tests** (`submit.test.tsx`)
  - `signed-in no-advance booking goes to booking page`: 201 `{status:'confirmed'}` → BookingDetail route at `/me/bookings/b1?new=1`. Use a location probe; the page body comes in Task 15.
  - `signed-in advance booking goes to pay page`: `awaiting_payment` → `/me/bookings/b1/pay`.
  - `guest without OTP books and lands on lookup`: the request body `guest` is `{name:'Ana', phone:'+8801712345678'}` with no `otpCode`; the location is `/lookup?reference=AB12CD&phone=%2B8801712345678&new=1`.
  - `guest with OTP sends code then books`: the OTP call body is `{phone:'+880…'}`; the create body has `otpCode:'123456'`.
  - `otp_invalid keeps name and phone, clears code`.
  - `slot_taken returns to a refreshed grid`: create → 409 `slot_taken`. The venue page shows `en.errors.slot_taken`, the slots endpoint is called again after the error, and no slot is selected (no continue bar).
  - `signed-in request carries bearer, guest request does not`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): place bookings as player or guest with OTP`

---

### Task 14: Payment page — Stripe Payment Element and hold countdown

**Files:**
- Create: `apps/web/src/payment/PayPage.tsx` (+css), `apps/web/src/payment/stripeAppearance.ts`, `apps/web/src/payment/useCountdown.ts`
- Modify: `routes.tsx` (`/me/bookings/:id/pay`, RequireAuth), locales
- Test: `apps/web/test/payment/pay.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /me/bookings/:id` → `{ booking, refunds }`
  - `POST /bookings/:id/payment` → `PaymentStart`. Its errors are 409 `hold_expired`, `invalid_transition`, `payments_unavailable`, `already_paid`.
- Produces: `useCountdown(until: string | null): { msLeft: number; expired: boolean }`, ticking every second.
- Produces: `stripeAppearance(): Appearance`. It reads the computed values of `--primary`, `--bg-surface`, `--text-default`, `--text-muted`, `--danger`, `--border-default`, `--radius-md` and `--font-sans` from `document.documentElement`, and sets `theme: dark ? 'night' : 'stripe'`. This is the only way Stripe receives colours, so no literals are needed.
- Produces: `PayPage`.
  - It loads the booking. If the status is not `awaiting_payment`, it redirects to `/me/bookings/:id`.
  - Otherwise it posts `/bookings/:id/payment`, then `loadStripe(publishableKey)` (memoised per key; the key is per owner).
  - It renders `<Elements stripe options={{ clientSecret, appearance: stripeAppearance(), locale: i18n.language }}>` with `<PaymentElement/>`, a `BookingSummary`-style amount line ("Pay {money(payment.amount)} now"), and the countdown `payment.holdEndsIn` as mm:ss.
  - Submit: `stripe.confirmPayment({ elements, confirmParams: { return_url: origin + '/me/bookings/' + id + '?paid=1' }, redirect: 'if_required' })`.
    - With no error → `navigate('/me/bookings/' + id + '?paid=1')`.
    - On an error → show `error.message` (Stripe's message is already localised) and keep the form.
  - When the countdown expires, or the API says `hold_expired`: unmount the Payment Element and show `payment.expired` with a Button back to `/venues/:slug` (the slug comes from `booking.venue`).

- [ ] **Step 1: Write the failing tests** (`pay.test.tsx`)
  - Mock `@stripe/stripe-js` (`loadStripe` → `{}`) and `@stripe/react-stripe-js`: `Elements` renders its children, `PaymentElement` renders `<div data-testid="payment-element"/>`, and `useStripe` / `useElements` return stubs whose `confirmPayment` is a `vi.fn`.
  - `renders element with client secret and amount`: `Elements` receives `options.clientSecret === 'cs_1'`, and the amount text is `money(1150,'BDT','en')`.
  - `loadStripe called with owner's publishable key`.
  - `successful confirm navigates to booking with paid flag`.
  - `card error is shown and form stays`.
  - `expired hold hides the payment form`: `holdExpiresAt` = now + 2 s with fake timers; after 3 s the `payment-element` is gone, `en.payment.expired` is shown, and `confirmPayment` is never called.
  - `hold_expired from API shows expired state`.
  - `already confirmed booking redirects to detail`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Stripe Payment Element checkout with hold countdown`

---

### Task 15: Booking detail and confirmation

**Files:**
- Create: `apps/web/src/bookings/BookingStatusBadge.tsx`, `apps/web/src/bookings/BookingDetailPage.tsx` (+css), `apps/web/src/bookings/BookingFacts.tsx` (shared by the detail and lookup pages)
- Modify: `routes.tsx`, locales (`status.*` for every booking status, `paymentStatus.*` for every payment status)
- Test: `apps/web/test/bookings/detail.test.tsx`

**Interfaces:**
- Produces:
  - `BookingStatusBadge({ status: BookingStatus })` with the tone map from Global Constraints. `PaymentStatusBadge({ status: PaymentStatus })`: refunded and partially_refunded → info, paid → success, partially_paid → warning, unpaid → neutral.
  - `BookingFacts({ booking: BookingJson })`:
    - reference (monospace, large, copy button using `navigator.clipboard`, guarded)
    - venue name linking to `/venues/:slug`, turf name, the date (`formatDate(businessDate, 'UTC')`) and times in `booking.venue.timezone`
    - add-on lines, total, amount paid, amount refunded (when > 0), and both badges
    - when `status === 'pending'`: the `booking.pendingNote` text ("The venue will confirm your booking")
- Produces: `BookingDetailPage` (RequireAuth).
  - `?new=1` → a success heading `booking.received`. `?paid=1` → `booking.paymentReceived`.
  - **Polling:** while `paid=1` and the status is `awaiting_payment`, it re-fetches every 2 s for up to 60 s and shows `booking.processing` with a Spinner. It stops as soon as the status changes. On timeout it shows `booking.processingSlow` with a refresh button.
  - When the status is `awaiting_payment` without `paid=1`: a `brand` Button `booking.payNow` → `/pay`.
  - The cancel entry point is added in Task 16.
  - 404 → not-found state.

- [ ] **Step 1: Write the failing tests** (`detail.test.tsx`)
  - `shows reference, venue-zone times and badges`.
  - `pending shows venue-will-confirm note`.
  - `polls until confirmed` (fake timers): the first two GETs return `awaiting_payment` and the third `confirmed`. Expect 3 calls, `en.booking.processing` then the confirmed badge, and no 4th call after another 10 s.
  - `polling gives up after 60s`.
  - `awaiting payment without paid flag offers pay now`.
  - `russian status labels`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): booking detail with payment confirmation polling`

---

### Task 16: My bookings and cancel with refund preview

**Files:**
- Create: `apps/web/src/bookings/MyBookingsPage.tsx` (+css), `apps/web/src/bookings/CancelDialog.tsx` (+css), `apps/web/src/bookings/BookingRow.tsx`
- Modify: `BookingDetailPage.tsx` (cancel button), `routes.tsx` (replace the Task 5 placeholder), locales
- Test: `apps/web/test/bookings/myBookings.test.tsx`, `apps/web/test/bookings/cancel.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /me/bookings` → `{ bookings: BookingJson[] }` (newest start first, up to 100)
  - `GET /me/bookings/:id/cancellation` → `{ preview: CancellationPreview }`. Its errors are 409 `too_late`, `invalid_transition`, `payment_in_progress`.
  - `POST /me/bookings/:id/cancel {reason?}` → `{ booking, refunds }`
- Produces: `MyBookingsPage` (RequireAuth).
  - Tabs `myBookings.upcoming` / `myBookings.past`.
  - Upcoming = status in `awaiting_payment|pending|confirmed` **and** last slot `endAt` > now, sorted soonest first. Past = everything else, newest first.
  - Each `BookingRow` links to the detail page and shows the venue, turf, date, time range in the venue zone, total and status badge.
  - Empty states: `myBookings.noUpcoming` with a link to search, and `myBookings.noPast`.
- Produces: `CancelDialog({ open; onClose; loadPreview(): Promise<CancellationPreview>; cancel(reason?: string): Promise<{booking: BookingJson; refunds: RefundJson[]}>; onCancelled(b: BookingJson): void; extra?: ReactNode })`. The guest flow reuses it in Task 17, putting the OTP field in `extra`.
  - On open it loads the preview and shows:
    - paid so far (`amountPaid − amountRefunded`)
    - the refund (`money(amount)`, `percent`%)
    - the rule (`cancel.rule`: "{{hours}}+ hours before start: {{percent}}%"), or `cancel.noRule`
    - the split: card refund → `cancel.toCard`; cash > 0 → `cancel.cashAtVenue` ("collect {{amount}} in cash at the venue")
    - for `amount === 0`: `cancel.noRefund`
  - An optional reason textarea (max 300, counter).
  - Buttons: `danger` "Cancel booking" and `secondary` "Keep booking".
  - Preview errors (`too_late` etc.) show the message and no confirm button.
- Detail page: a cancel button is shown for `awaiting_payment|pending|confirmed`. After cancelling it shows the updated booking with a `cancelled` badge and the refunds list (amount, method, status).

- [ ] **Step 1: Write the failing tests**
  - `myBookings.test.tsx`:
    - `splits upcoming and past by end time and status` (`vi.setSystemTime`): a confirmed booking yesterday → past; a cancelled booking tomorrow → past; a pending booking tomorrow → upcoming.
    - `rows show venue-zone time`.
    - `empty upcoming links to search`.
  - `cancel.test.tsx`:
    - `preview shows percent, amount and rule`: preview `{percent:50, amount:575, rule:{minHoursBefore:24, percent:50}, amountPaid:1150, amountRefunded:0, currency:'BDT', card:575, cash:0}` → texts `money(575…)` and `50%`, plus the rule rendered with hours 24.
    - `cash part explained`.
    - `zero refund says no refund`.
    - `too_late hides confirm`.
    - `confirm cancels with reason and shows cancelled badge`: POST body `{reason:'Rain'}`.
    - `keep booking closes without calling cancel`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): my bookings with refund-preview cancellation`

---

### Task 17: Guest booking lookup and guest cancel

**Files:**
- Create: `apps/web/src/lookup/LookupPage.tsx` (+css)
- Modify: `routes.tsx`, locales
- Test: `apps/web/test/lookup/lookup.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /bookings/lookup?reference=&phone=` → `{ booking }`. 404 means wrong reference or phone.
  - `GET /bookings/lookup/cancellation?reference=&phone=` → `{ preview }`
  - `POST /bookings/lookup/otp {reference, phone}` → `OtpSent`
  - `POST /bookings/lookup/cancel {reference, phone, otpCode, reason?}` → `{ booking, refunds }`
- Produces: `LookupPage`.
  - The form has reference (uppercased as typed) and `PhoneInput`. It is prefilled from `?reference=&phone=`, and when both are present it looks up automatically.
  - 404 → `lookup.notFound`, which deliberately does not say which field is wrong.
  - A found booking renders `BookingFacts`. `?new=1` → heading `booking.received`, plus `lookup.saveReference` explaining that the reference and phone are needed to view or cancel later, and a "copy link" button for the current URL without `new=1`.
  - Cancel (for `pending|confirmed`) opens `CancelDialog` with `loadPreview` → the lookup cancellation endpoint. `extra` = a "Send code" button → `/bookings/lookup/otp`, then `OtpInput` with the resend cooldown. Confirm is disabled until the code has 6 digits, and `cancel(reason)` posts with `otpCode`.
  - A booking linked to a player (`playerId !== null`) shows `lookup.signInToManage` instead of cancel. The API 404s guest cancel for those.

- [ ] **Step 1: Write the failing tests** (`lookup.test.tsx`)
  - `prefilled URL looks up automatically and shows booking`: the query has `reference=AB12CD` and `phone=%2B880…`.
  - `typed reference is uppercased`.
  - `not found message is generic`.
  - `new booking shows save-reference note`.
  - `guest cancel needs code`: confirm is disabled → send code (OTP body `{reference, phone}`) → type `123456` → confirm → cancel body `{reference:'AB12CD', phone:'+880…', otpCode:'123456'}`; the cancelled badge is shown.
  - `otp_invalid keeps dialog open with message`.
  - `player-linked booking shows sign in to manage`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite: `node_modules/.bin/pnpm test`, `node_modules/.bin/pnpm typecheck`, `node_modules/.bin/pnpm lint` and `node_modules/.bin/pnpm --filter web build`. Expected: all green.
- [ ] **Step 5: Commit** `feat(web): guest booking lookup and OTP-verified cancel`

---

## Out of scope (recorded so nobody builds it by accident)

- **Linking extra sign-in methods from the profile.** The API exists (`/me/link/*`); the UI is deferred.
- **Geocoding search by typed place name.** It would need a third-party geocoder. The picked place is map-based (Task 9).
- **Dark-mode map tiles.** OSM tiles are light-only, and a filter would be a hardcoded value.
- **Per-owner `--brand` colours.** The venue JSON has no brand field yet, so `--brand` keeps its token default.
