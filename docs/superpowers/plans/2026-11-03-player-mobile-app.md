# Player Mobile App (Android + iOS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native Android/iOS app for players only: find a venue, pick a slot, book and pay, see and cancel my bookings, manage my account.

**Architecture:** New Expo (React Native, TypeScript, Expo Router) app at `apps/mobile`, a pnpm workspace member that talks to the existing Express API (`/api/v1`) and reuses `@booking/shared` plus the web app's en/ru/bn locale files. The API gains a "native client" refresh-token mode, because the web keeps its refresh token in an httpOnly cookie that a native app cannot rely on. No owner or admin screens.

**Tech Stack:** Expo SDK (latest stable at build time, exact versions pinned), Expo Router, `expo-secure-store`, `expo-location`, `expo-web-browser`, `expo-localization`, `@stripe/stripe-react-native` (PaymentSheet), `i18next` + `react-i18next`, `jest-expo` + `@testing-library/react-native`. API side: existing Express 5 + vitest + supertest.

**Spec:** None. The user skipped the design questions. The decisions are in this plan and are marked "(call)" where they are mine and not the user's.

## Global Constraints

- Player only: no `/owner`, `/admin`, onboarding or "list your venue" screens.
- Every color, font size, spacing, radius and shadow comes from `apps/web/src/styles/tokens.css`, through the generated `apps/mobile/src/theme/tokens.ts`. No hardcoded values in screens. Follow `.superdesign/design-system.md` (flat cards, borders only on selection controls, ball yellow as the dark-mode primary, IBM Plex Sans / Plex Sans Condensed headings / Noto Sans Bengali).
- Light and dark both work, following the system setting (`useColorScheme`).
- Strings come from `apps/web/src/i18n/locales/{en,ru,bn}.json`. Keys used only on mobile go under a top-level `mobile` object in all three files. No fixed-width buttons, tabs or chips: Russian and Bangla run up to 30% longer.
- Touch targets are at least 44pt. Status is never shown by color alone.
- Slot times and dates display in the venue's timezone, not the device's, using the helpers in `@booking/shared` `time.ts`.
- The web auth path stays byte-for-byte unchanged: the refresh token never appears in a response body for cookie clients.
- Pin exact dependency versions in `apps/mobile/package.json`.

## Review Focus

1. **Concurrent refresh.** Two requests get a 401 at once. Only one `/auth/refresh` may go out: a second use of a rotated token revokes the whole family and signs the player out. Test in Task 3.
2. **Cookie + native header together.** Someone on the web adds `X-Client: native` to steal a long-lived token. The body token must never be returned when an `rt` cookie came with the request. Test in Task 1.
3. **Hold expiry during payment.** The player sits on the Stripe sheet or the bKash form past `holdExpiresAt`. The app must show "hold expired, pick again", not a generic error or a stuck spinner. Test in Task 7.
4. **App killed or backgrounded mid-payment** (SSLCommerz browser, Stripe redirect). On return, the booking detail must refetch and show the real status. Test in Task 7.
5. **Venue timezone differs from the device's** (traveller, or emulator set to UTC). The slot grid and booking rows must show venue-local times. Test in Task 6.

---

## File Structure

```
apps/api/src/auth/tokens.ts            modify: native mode in sendAuthResponse
apps/api/src/auth/routes/session.ts    modify: refresh/logout accept body token in native mode
apps/api/test/auth/nativeSession.test.ts  new

apps/mobile/
  app.json, eas.json, package.json, tsconfig.json, babel.config.js, metro.config.js, jest.config.js
  scripts/gen-tokens.ts               tokens.css -> src/theme/tokens.ts
  app/                                Expo Router routes
    _layout.tsx                       providers (Auth, Theme, i18n, Stripe), font loading
    (tabs)/_layout.tsx                tabs: Find, Bookings, Account
    (tabs)/index.tsx                  search
    (tabs)/bookings.tsx               my bookings
    (tabs)/account.tsx                profile, language, sign out
    venue/[slug].tsx                  venue + slots
    venue/[slug]/checkout.tsx         summary, add-ons, promo, book
    booking/[id].tsx                  detail, cancel, pay
    booking/[id]/pay.tsx              payment method chooser
    sign-in.tsx, sign-in/email.tsx, register.tsx
  src/
    theme/tokens.ts (generated), theme/ThemeProvider.tsx, theme/useTheme.ts
    i18n/index.ts
    lib/api.ts                        fetch client, ApiError, single-flight refresh
    lib/secureToken.ts                SecureStore wrapper
    auth/AuthProvider.tsx, auth/useAuth.ts
    ui/                               Button, Text, Card, Chip, Field, Screen, Skeleton, StatusBadge
    search/, venue/, checkout/, bookings/, payment/   feature hooks + components
  test/                               jest tests mirroring src/
docs/mobile.md                        run, build, release notes
```

---

### Task 1: API native-client refresh-token mode

**Files:**
- Modify: `apps/api/src/auth/tokens.ts` (`sendAuthResponse`)
- Modify: `apps/api/src/auth/routes/session.ts` (`presentedToken`, `/refresh`, `/logout`)
- Test: `apps/api/test/auth/nativeSession.test.ts`

**Interfaces:**
- Produces: a request is a **native request** when it has the header `X-Client: native` **and** carries no `rt` cookie. For native requests, every auth response (`/auth/login`, `/auth/register`, `/auth/otp/verify`, `/auth/google`, `/auth/refresh`, `/auth/password/reset`, whatever already calls `sendAuthResponse`) returns `{ user, accessToken, refreshToken }` and sets no cookie. `/auth/refresh` and `/auth/logout` read `req.body.refreshToken` for native requests. Everything else stays as it is now.
- Add `export function isNativeClient(req: Request): boolean` in `tokens.ts`. `sendAuthResponse` gains `req` as its first parameter; update its callers.

- [ ] **Step 1: Write failing tests** (supertest, reuse the existing helpers in `apps/api/test/auth/`):
  - `native login returns refreshToken in body and sets no cookie`: POST `/api/v1/auth/login` with `X-Client: native`. Expect `body.refreshToken` to be a non-empty string and the `set-cookie` header to be absent.
  - `native refresh rotates the body token`: POST `/auth/refresh` with `X-Client: native` and `{ refreshToken }`. Expect 200, a new `refreshToken` different from the old one, and the old one answering 401 `token_reused` when presented again.
  - `native logout revokes the body token`: after logout (204), refreshing with that token gives 401.
  - `cookie wins over native header`: send both an `rt` cookie and `X-Client: native` to `/auth/refresh`. Expect `body.refreshToken` to be undefined and a `set-cookie` with `rt=`.
  - `body token ignored without native header`: POST `/auth/refresh` with `{ refreshToken }` and no header gives 401 `invalid_refresh_token`.
- [ ] **Step 2: Run** `pnpm --filter api test -- nativeSession`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the existing security comment, and extend it to explain why the cookie check blocks a web XSS from upgrading to a body token.
- [ ] **Step 4: Run** `pnpm --filter api test`. Expected: all PASS, including the existing auth tests.
- [ ] **Step 5: Commit** `feat(api): native-client refresh token mode for the mobile app`

### Task 2: Scaffold `apps/mobile` with theme and i18n

**Files:**
- Create: `apps/mobile/*` config files, `app/_layout.tsx`, `app/(tabs)/_layout.tsx` + three placeholder tab screens, `scripts/gen-tokens.ts`, `src/theme/*`, `src/i18n/index.ts`, `src/ui/*` (Text, Button, Card, Screen)
- Modify: `pnpm-workspace.yaml` (only if needed; `apps/*` already covers it), root `.gitignore` (`apps/mobile/.expo`, `ios/`, `android/`)
- Modify: `apps/web/src/i18n/locales/{en,ru,bn}.json` (add `mobile.tabs.find|bookings|account`)
- Test: `apps/mobile/test/theme/tokens.test.ts`, `apps/mobile/test/ui/Button.test.tsx`

**Interfaces:**
- Produces: `tokens.ts` exports `light` and `dark`: objects keyed by camelCased token name (`--bg-page` becomes `bgPage`). Values are RN-ready: colors as strings, `px`/`rem` as numbers with `1rem = 16`, shadows as RN shadow props, or `null` when the token is `none`. Also `tokenNames: string[]`.
- `useTheme(): { t: typeof light; scheme: 'light' | 'dark' }`.
- `src/i18n/index.ts`: `initI18n(): Promise<void>`. The language is the stored choice (SecureStore key `lang`), else the device locale through `expo-localization`, else `en`. It imports the three JSON files from `../../../web/src/i18n/locales/`.
- UI primitives take only token-backed props (`variant: 'primary' | 'secondary' | 'ghost'`, `tone`), never raw colors.

- [ ] **Step 1:** Run `pnpm create expo-app apps/mobile --template tabs` (latest), then strip the demo screens. Bundle id and package `com.bookaturf.player` (call). Scheme `bookaturf`. Set `"name": "mobile"` in package.json.
- [ ] **Step 2: Failing test** `tokens.test.ts`: every `--name` declared in `tokens.css` (both the `:root` block and the dark block) appears in `tokenNames`, and `light.bgPage === '#fbfbfa'`, `dark.bgPage === '#0f1317'` (values from the design doc).
- [ ] **Step 3:** Write `gen-tokens.ts` (parse `tokens.css` with a regex over `--x: value;` inside `:root` and the dark selector; resolve `var(--y)` references). Add `"tokens": "tsx scripts/gen-tokens.ts"` and run it. Commit the generated file with a header comment saying it is generated.
- [ ] **Step 4:** ThemeProvider, i18n, fonts (`@expo-google-fonts/ibm-plex-sans`, `ibm-plex-sans-condensed`, `noto-sans-bengali`), and the tab layout with the three tabs labelled from `mobile.tabs.*`.
- [ ] **Step 5: Test** `Button.test.tsx`: renders its label, has `accessibilityRole="button"`, and its min height is at least 44.
- [ ] **Step 6: Verify** `pnpm --filter mobile test` passes, `pnpm --filter mobile typecheck` is clean, and `pnpm --filter mobile start` opens on the iOS simulator and an Android emulator in both themes. If Metro cannot resolve workspace packages under pnpm's isolated layout, add `node-linker=hoisted` to the root `.npmrc` and re-run `pnpm install`; check that web and api still build.
- [ ] **Step 7: Commit** `feat(mobile): scaffold Expo player app with design tokens and i18n`

### Task 3: API client and auth session

**Files:**
- Create: `apps/mobile/src/lib/api.ts`, `src/lib/secureToken.ts`, `src/auth/AuthProvider.tsx`, `src/auth/useAuth.ts`
- Test: `apps/mobile/test/lib/api.test.ts`, `test/auth/AuthProvider.test.tsx`

**Interfaces:**
- Consumes: Task 1 contract.
- Produces: `api.ts` mirrors the web `apps/web/src/lib/apiClient.ts`: `ApiError`, `apiGet/apiPost/apiPatch/apiDelete`, `setAccessToken`, `setRefreshHandler`, with the same retry-once-on-`invalid_token|unauthenticated` rule. It also always sends `X-Client: native`. The base URL comes from `process.env.EXPO_PUBLIC_API_URL`.
- `secureToken.ts`: `getRefreshToken(): Promise<string | null>`, `setRefreshToken(t: string | null): Promise<void>` (SecureStore key `rt`).
- `useAuth(): { status: 'loading' | 'signedIn' | 'signedOut' | 'offline'; user: PublicUser | null; signIn(res: AuthResponse & { refreshToken: string }): Promise<void>; setUser(u): void; signOut(): Promise<void>; retry(): void }`. Same semantics as the web `AuthProvider`: a 401 on refresh clears the session; a network error or 5xx keeps it (`offline` at boot).
- Types `PublicUser` and `AuthResponse`: move them from `apps/web/src/lib/types.ts` into `@booking/shared` if they are not there already, and import them from both apps.

- [ ] **Step 1: Failing tests:**
  - `sends X-Client native on every request`.
  - `two concurrent 401s trigger exactly one refresh`: mock fetch, fire two `apiGet` calls, and assert that `/auth/refresh` was called once and both calls resolve. (Review Focus 1.)
  - `refresh 401 signs out and clears SecureStore`.
  - `refresh network error at boot gives status offline and keeps the stored token`.
  - `signOut posts /auth/logout with the stored token and clears it even if the call fails`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement. Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(mobile): API client with single-flight token refresh`

### Task 4: Sign-in, register, account

**Files:**
- Create: `app/sign-in.tsx` (phone OTP: `/auth/otp/request` then `/auth/otp/verify`), `app/sign-in/email.tsx` (`/auth/login`, plus a link to the web `/forgot-password` through `expo-web-browser`), `app/register.tsx` (`/auth/register/otp/request` then `/auth/register`), `app/(tabs)/account.tsx` (name/email/phone from `/me`, edit name with `PATCH /me`, language switch en/ru/bn, theme follows system, sign out with confirm), `src/ui/Field.tsx`
- Test: `test/auth/signIn.test.tsx`, `test/account/account.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `api.ts`.
- Produces: `requireSignIn(router, next: string)` pushes `/sign-in?next=…` and comes back to `next` after sign-in. Only in-app paths are accepted for `next`: same rule as web `safeNext.ts`.
- Google sign-in is out of scope for v1 (call: it needs separate native OAuth client IDs). Reuse the web's error-code-to-message mapping (`apps/web/src/lib/errors.ts`) by moving it into `@booking/shared` or copying it into `src/lib/errors.ts`.

- [ ] **Step 1: Failing tests:** `OTP flow signs in and returns to next`; `wrong code shows the translated error`; `resend is disabled during cooldown` (use the same cooldown seconds as web `useCooldown`); `next=https://evil.com is ignored`; `sign out asks to confirm and lands on the Find tab`.
- [ ] **Steps 2–4:** run (FAIL), implement, run (PASS). Add any new strings under `mobile.auth.*` in en/ru/bn.
- [ ] **Step 5: Commit** `feat(mobile): phone OTP and email sign-in, account screen`

### Task 5: Find tab (search)

**Files:**
- Create: `app/(tabs)/index.tsx`, `src/search/useSearch.ts`, `src/search/VenueCard.tsx`, `src/search/SportChips.tsx`
- Test: `test/search/search.test.tsx`

**Interfaces:**
- Consumes: `GET /sports`, `GET /search` with the same query parameters as the web `apps/web/src/search/searchParams.ts` (`criteriaToParams`). Move `criteriaToParams` and the `Criteria` type into `@booking/shared/search.ts` if they are not already shared, and use them from both apps.
- Produces: tapping a card navigates to `/venue/[slug]`.
- List view only in v1, no map (call). Near-me uses `expo-location` foreground permission. If permission is denied, show the city search field instead and don't ask again.

- [ ] **Step 1: Failing tests:** `shows results for the chosen sport`; `load more appends the next page`; `location denied falls back to the text search`; `empty result shows the translated empty state`; `network error shows retry`.
- [ ] **Steps 2–4:** run, implement, run.
- [ ] **Step 5: Commit** `feat(mobile): find venues by sport and location`

### Task 6: Venue screen and slot picking

**Files:**
- Create: `app/venue/[slug].tsx`, `src/venue/CourtTabs.tsx`, `src/venue/DateStrip.tsx`, `src/venue/SlotGrid.tsx`, `src/venue/useSlots.ts`
- Test: `test/venue/venue.test.tsx`, `test/venue/slotSelection.test.ts`

**Interfaces:**
- Consumes: `GET /venues/:slug`, `GET /venues/:slug/turfs/:turfId/slots?date=`, `GET /venues/:slug/reviews` (summary and first 3 only).
- Selection rules: reuse `apps/web/src/venue/slotSelection.ts` by moving it into `@booking/shared/slots.ts` (or importing from there if it already lives there).
- Produces: "Continue" navigates to `/venue/[slug]/checkout?turfId=&date=&startAts=` (comma-joined ISO), the same params as web `checkoutParams.ts`.
- The owner brand color (`--brand` from the venue) is used only on this screen and checkout: CTA, active court tab, selected slot.

- [ ] **Step 1: Failing tests:** `times render in the venue timezone`: venue `Asia/Dhaka`, test process `TZ=UTC`, slot `2026-11-05T13:00:00Z` shows `19:00` (Review Focus 5); `taken slots are not selectable and say "Booked" in text`; `selecting non-adjacent slots follows the shared selection rule`; `changing date clears the selection`; `closed day shows the closed message`.
- [ ] **Steps 2–4:** run, implement, run.
- [ ] **Step 5: Commit** `feat(mobile): venue page with court tabs, dates and slot grid`

### Task 7: Checkout and payment

**Files:**
- Create: `app/venue/[slug]/checkout.tsx`, `app/booking/[id]/pay.tsx`, `src/checkout/useQuote.ts`, `src/checkout/AddonPicker.tsx`, `src/checkout/PromoCode.tsx`, `src/payment/stripe.ts`, `src/payment/WalletForm.tsx`
- Test: `test/checkout/checkout.test.tsx`, `test/payment/pay.test.tsx`

**Interfaces:**
- Consumes: `POST /venues/:slug/turfs/:turfId/quote`, `GET /venues/:slug/turfs/:turfId/addons`, `POST /venues/:slug/turfs/:turfId/bookings` (signed in only, no guest object, with an `Idempotency-Key` header generated once per checkout screen through `expo-crypto` `randomUUID`), `GET /bookings/:id/payment-options`, `POST /bookings/:id/payment`, `POST /bookings/:id/payments/manual`.
- Booking in the app requires sign-in (call: phone OTP is quick, and it makes My bookings work). An unsigned "Book" press goes through `requireSignIn` and returns to checkout with the selection intact.
- Payment by gateway:
  - `stripe`: `initPaymentSheet({ paymentIntentClientSecret, merchantDisplayName: venue name, returnURL: 'bookaturf://stripe-redirect' })`, then `presentPaymentSheet()`. `StripeProvider` gets the `publishableKey` from the response, not from env.
  - `sslcommerz`: `WebBrowser.openAuthSessionAsync(url, 'bookaturf://payment-return')`.
  - Manual wallets (bKash/Nagad etc. from payment-options): the form takes the sender number and transaction ID, with the same fields as the web `PayPage`.
  - Pay at venue, when offered: no payment step.
- After any payment attempt, or on app foreground (`AppState` becoming `active`) while on the pay screen, refetch `GET /me/bookings/:id` and route by `status`.

- [ ] **Step 1: Failing tests:** `quote updates when add-ons change`; `invalid promo shows its error and keeps the old total`; `Book sends one Idempotency-Key, and a retry after a network error reuses it`; `hold expired (409 or status expired) shows "hold expired, pick again" with a button back to the venue` (Review Focus 3); `returning to foreground refetches the booking and shows confirmed` (Review Focus 4); `Stripe cancel leaves the booking awaiting_payment with a Pay button`; `manual wallet submit shows "waiting for venue to verify"`.
- [ ] **Steps 2–4:** run, implement, run. Mock `@stripe/stripe-react-native` and `expo-web-browser` in jest.
- [ ] **Step 5: Manual check** on a dev build (`npx expo run:ios` / `run:android`; Stripe needs a dev build, not Expo Go) with the Stripe test card `4242 4242 4242 4242`.
- [ ] **Step 6: Commit** `feat(mobile): checkout with Stripe, SSLCommerz, wallet and pay-at-venue`

### Task 8: My bookings, detail, cancel

**Files:**
- Create: `app/(tabs)/bookings.tsx`, `app/booking/[id].tsx`, `src/bookings/BookingRow.tsx`, `src/bookings/StatusBadge.tsx`, `src/bookings/CancelSheet.tsx`
- Test: `test/bookings/bookings.test.tsx`

**Interfaces:**
- Consumes: `GET /me/bookings` (upcoming/past, same params as web `MyBookingsPage`), `GET /me/bookings/:id`, `GET /me/bookings/:id/cancellation` (refund preview), `POST /me/bookings/:id/cancel`.
- Status labels and badge tones: same keys as web `BookingStatusBadge.tsx`.
- Detail shows the reference, venue, court, venue-local time, amount, status, an "Open in Maps" link (`Linking.openURL` with the venue coordinates), "Pay now" when `awaiting_payment`, and "Book again" (to the venue with the same court preselected).
- Out of scope for v1 (call): reschedule, reviews, series, saved venues, receipts PDF, add to calendar.

- [ ] **Step 1: Failing tests:** `upcoming and past tabs list the right bookings`; `signed out shows the sign-in prompt, not an error`; `cancel shows the refund preview before confirming`; `cancel not allowed shows the reason from the API`; `pull to refresh refetches`.
- [ ] **Steps 2–4:** run, implement, run.
- [ ] **Step 5: Commit** `feat(mobile): my bookings, booking detail and cancel`

### Task 9: Build, release setup, docs

**Files:**
- Create: `apps/mobile/eas.json` (profiles `development`, `preview` (internal APK / TestFlight), `production`), app icon and splash from the existing logo mark, `docs/mobile.md`
- Modify: `apps/mobile/app.json` (`ios.bundleIdentifier`, `android.package`, permission strings for location in en, `userInterfaceStyle: automatic`), `.env.example` (`EXPO_PUBLIC_API_URL`), root `README` if one exists

- [ ] **Step 1:** `docs/mobile.md` covers running on a simulator and a device against the local API (LAN IP, not `localhost`), dev build vs Expo Go (Stripe needs a dev build), `eas build -p android --profile preview`, `eas build -p ios`, and the store accounts needed (Apple Developer, Google Play Console). Those are the user's to create.
- [ ] **Step 2: Verify** `pnpm -r typecheck`, `pnpm -r test` and `pnpm lint` all pass. Then do a manual end-to-end run on one Android and one iOS simulator: find venue → book → pay (Stripe test) → see it in Bookings → cancel. Check light, dark and ru.
- [ ] **Step 3: Commit** `chore(mobile): EAS build profiles and mobile docs`
