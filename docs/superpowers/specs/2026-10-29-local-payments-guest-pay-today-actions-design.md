# Local payments, guest online pay, actionable Today — design

Date: 2026-10-29. Status: draft for approval.

## Why

Research on 2026-10-29 (10-agent review) found three blockers for a Bangladesh launch:

1. **Online payment does not work in Bangladesh.** Only Stripe is wired (`apps/api/src/payments/gateway.ts:19`, `gatewayFor` returns Stripe only). Stripe has no BD merchants and players rarely hold cards. Today players pay advances by sending money to the owner's bKash/Nagad number and the owner confirms by hand. The Dhaka competitor Turfly already takes bKash/Nagad.
2. **Guests cannot pay online.** `resolveSettings` turns guest booking off whenever an advance is required (`packages/shared/src/settings.ts:68`, spec 2026-10-23 §10), and `guestsAllowed` repeats the rule (`apps/api/src/bookings/routes/public.ts:95`). This breaks PRODUCT.md's promise "book and pay without an account".
3. **The owner Today page is display-only.** Timeline blocks are `<span>`s with a `title` tooltip (`apps/web/src/owner/today/CourtTimeline.tsx`), free time can't be used, the "Coming up" list only offers Confirm/Reject for `pending`, and the page never refreshes (`TodayPage.tsx` loads once via `useResource`). PRODUCT.md principle 2 ("act from where you look") is not met.

Success: a Dhaka player with no account and no card books a 90-minute evening slot, pays the advance by bKash, and the owner verifies and confirms it from Today without leaving the page.

## Decisions made by the user

- bKash/Nagad: **both — manual send-money + TrxID first, then an SSLCommerz gateway**; owner chooses per venue.
- Guest online payment: **phone OTP, then pay**.
- Today v1 includes **all four**: tap a block → action sheet; tap free time → walk-in; live refresh + money-due marker; inline next-step action per "Coming up" row.
- Payment methods and advance are controlled by the **owner, per venue**.
- Submitted manual payments are **never auto-rejected**; staff decide.
- Guest paid online → **confirmed straight away**.
- Manual edge cases: **late TrxID accepted if slots still free** (else refund to send); **staff can edit amount received** (shortfall due at venue, excess refunded).

## Goals

- Players (signed in or guest) can pay a venue's advance by: manual bKash/Nagad/Rocket send-money, SSLCommerz (bKash, Nagad, Rocket, cards), Stripe — whichever the venue has on — or pay at the venue when there is no advance.
- Owners verify manual wallet payments in one tap from Today, the booking page, or Attention.
- Guests complete the whole flow (book → OTP → pay → see status) without an account and without their phone number appearing in any URL.
- Today becomes the place owners run the day from.

## Non-goals (this project)

- Direct bKash Tokenized Checkout or Nagad merchant APIs (SSLCommerz covers them).
- Split payment between players, wallets/credits, promo codes.
- Server-sent events / websockets (polling is enough for v1).
- Drag to move or resize bookings on the timeline.
- Bengali locale (separate project; all new strings still go in en.json and ru.json).
- Automatic refunds of manual wallet payments (no API to send money back).

## Anti-goals (failure even if it "works")

- A manual wallet payment counted as paid before a staff member verifies it.
- A guest able to view or pay another person's booking, or the guest phone in a URL, log line or Referer.
- Payment rules shown to the player only after they commit (the advance amount and accepted methods must show before Continue).
- Owner portal colour that says "paid" for money not yet received (status never by colour alone).

## Constraints

- UI follows `.superdesign/design-system.md` and `apps/web/src/styles/tokens.css` only; light and dark; Russian strings fit; 390px; 44px touch targets; WCAG 2.2 AA.
- Money in integer minor units (`packages/shared/src/money.ts`), BDT has 2 decimals in storage per existing convention.
- Keep the existing transaction + `lockTurf` + SlotLock guarantees; every new state change is a `transition()` in a transaction.
- Tenancy: every new query goes through `tenantRepo` / `tenantScoped`; new routes get `requirePermission`.
- TDD with the existing vitest suites (api uses mongodb-memory-server).

## Build order (builder's call)

1. **Part A — Today actions** (UI-mostly, no payment changes; gives a home for "Verify" later).
2. **Part B — Guest online payment** (Stripe path first, so it is testable with what exists).
3. **Part C — Manual bKash/Nagad payment + verification.**
4. **Part D — SSLCommerz gateway** and a gateway registry.

Each part is shippable alone and gets its own plan section and commits.

---

## Part A — Today you can act from

### A1. Live refresh
- Reuse the 60 s visibility-aware poll from `owner/schedule/SchedulePage.tsx:53-61`, extracted into a shared hook (e.g. `owner/usePoll.ts`) used by both pages. Also refetch on `visibilitychange` (visible) and `online`.
- Refetch is silent: keep showing current data, no skeleton. Show a quiet "Updated 18:42" line in the toolbar; on failure show "Couldn't refresh · Retry" there, not a page-level error.
- Rows/blocks that are new since the previous fetch get a brief highlight (respect `prefers-reduced-motion`: no animation, just the end state for one cycle).

### A2. Timeline you can tap
- Each booking block becomes a `<button>` with an `aria-label` like "Court 2, 19:00–20:30, Rahim, confirmed, ৳1,200 due".
- Fix `kindOf()` (`CourtTimeline.tsx:75`): colour by **status** only (waiting / confirmed / walk-in as today), and add a separate **money-due marker**: a text chip "৳ due" (currency symbol from the venue) on blocks where `amountPaid < total` and status is pending/confirmed. Legend gets "Payment due" with the same chip. Remove the "Paid" legend wording; the confirmed legend reads "Confirmed".
- Tapping a block opens a **BookingSheet**: side sheet ≥ 768px, bottom sheet below. Contents: customer name + phone (tap-to-call link), time, court, status badge, amounts (total, paid, due), payment rows (incl. a pending manual TrxID once Part C lands), and action buttons from `availableActions()` (`owner/bookings/availableActions.ts`) using the existing `useBookingAction`, `CashDialog`, `PaymentLinkDialog`, `OwnerCancelDialog`, `ReasonDialog`. Plus "Open booking" link. Closing returns focus to the block.
- Free time: each gap ≥ one slot length within opening hours on each lane renders as a `<button>` ("Court 2, free 20:30–22:00, add walk-in"). Tap navigates to the existing walk-in flow pre-filled with venue, court, date and start time — reuse whatever the Schedule grid passes today (`?start=`). Only shown when the member `can('booking.create')`.
- Phone (< 768px): on mount, scroll the strip so the now line is in view; pin the court-name column.

### A3. "Coming up" rows act inline
- Each row gets one **primary next-step button** following the booking's path, plus an overflow menu with the rest of `availableActions()`:
  - `pending` → Confirm (or "Verify payment" when a manual payment is pending, Part C)
  - `awaiting_payment` walk-in → Payment link
  - `confirmed`, not checked in, start within 30 min or started → Check in
  - `confirmed` and `amountPaid < total` → "Collect ৳X" (opens CashDialog)
- Respect permissions exactly as `availableActions()` does. Column header "Actions" shows whenever the member has any of the involved permissions (not only `booking.confirm`).
- Below 768px the table becomes stacked rows (time · court on line 1, customer on line 2, action at right).

### A4. Attention panel
- Add rows (each with an inline button, not just "Open"):
  - Pending confirmations (count + oldest)
  - Payments to verify (Part C)
  - Starting within 30 min with money due
  - Started > 15 min ago and not checked in
- Staff without the permission for a row's action see the row without the button.

### A5. Small fixes folded in
- Remove the "→" from "See trends" (`TodayPage.tsx:58`) and from the design doc's Today section.
- The "pending" StatCard tile is hidden for members without `booking.confirm`.

---

## Part B — Guest online payment (OTP, then pay)

### B1. Policy change
- Delete the rule "any advance turns guest booking off": remove the override in `resolveSettings` (`settings.ts:68`), and `guestsAllowed` becomes `s.guestBooking.allowed`. The quote's `guestAllowed` drops the `advanceRequired === 0` condition (`public.ts:216`).
- When an advance is due, **OTP is required for guests regardless of `guestBooking.requireOtp`** (a verified phone is the guest's only identity and the refund contact).
- Update spec 2026-10-23 §10 with a note pointing here.
- Guest multi-booking groups (several days/courts in one checkout) are allowed for guests too. Caps: `MAX_GUEST_PENDING` as today, plus a new guest hold cap — open `awaiting_payment` holds counted by **verified phone** at the same `MAX_OPEN_HOLDS` as players. (`assertHoldRoom` from a37485f counts by `playerId` only, so guests are uncapped today; extend it. *Claude's call.*)
- **A guest booking whose advance is paid online (card or SSLCommerz) is `confirmed` straight away**, same as a signed-in player: verified phone + real payment. `initialStatus` (`packages/shared/src/booking.ts:90`) keeps guest bookings with no advance `pending` as today. *User decision.*

### B2. Guest pay token
- On guest booking create (and on a successful guest lookup), the API returns a **guest pay token**: an HMAC-signed, opaque string binding `{ bookingId or groupId, phone hash, exp }`, signed with a new config secret. Expiry: booking end time (so it also works for paying a balance later), max 30 days.
- The web app keeps it in `sessionStorage` keyed by reference and in router state; it is never put in the URL and never contains the phone in clear.
- New guest pay endpoints mirror the player ones but authorize by header `X-Guest-Token` instead of a session:
  - `GET /guest/bookings/:reference` (booking JSON as the guest lookup returns it)
  - `POST /guest/bookings/:reference/payments/intent` (Stripe), and the Part C / Part D equivalents
- Rate-limit them with the existing shared limiter (`lookup` bucket or a new `guest-pay` bucket).

### B3. Web flow
- Checkout (signed out, advance due): guest form collects name + phone → "Continue" sends the OTP and reveals the code field in place (one button, `autocomplete="one-time-code"`), auto-submits at 6 digits → booking created → navigate to `/pay/:reference` (new guest route) with the token in state.
- `/pay/:reference` reuses `PayPage` with a guest data source. Hold countdown, method choice (Parts C/D), success → lookup-style confirmation with "Save this booking" (create account with name and phone prefilled).
- Lookup page: when the booking is `awaiting_payment`, show "Pay now" (uses the token it just obtained).
- Show the payment rule **before** Continue on the venue page selection bar and checkout summary: "Pay ৳500 now by bKash, Nagad or card · rest at venue".

---

## Part C — Manual bKash / Nagad / Rocket payment

### C1. Venue payment methods setting
- New settings key `paymentMethods`, stored at owner level as the default and overridable per venue (same pattern as `paymentPolicy`; venue key replaces owner key whole):
  ```ts
  type WalletProvider = 'bkash' | 'nagad' | 'rocket';
  type ManualWallet = { provider: WalletProvider; number: string; accountType: 'personal' | 'merchant' | 'agent'; note?: string };
  type PaymentMethods = {
    manualWallets: ManualWallet[]; // 0..3, one per provider
    gateways: Array<'stripe' | 'sslcommerz'>; // enabled gateway accounts this venue offers
  };
  ```
- No separate pay-at-venue switch: `paymentPolicy.type === 'none'` already means pay at the venue. *Claude's call.*
- Migration: owners with an enabled Stripe gateway account get `gateways: ['stripe']` seeded so existing checkouts keep working. *Claude's call.*
- Validation: BD mobile number format for wallet numbers (reuse `normalizePhone`); at least one online method must be on when `paymentPolicy.type !== 'none'` (otherwise the settings save is rejected with a clear message).
- Owner settings UI: a "Payment methods" group in Settings (owner) and the venue settings override, using existing form patterns. Wallet numbers show as `+880 17…` formatted.

### C2. Data model
- `Payment.method` enum adds `'mobile_wallet'`; new fields `provider` (`WalletProvider | null`), `trxId` (string | null, uppercased, trimmed), `senderNumber` (full wallet number the player paid from, required, normalised; staff-only — never in URLs, logs or player-facing lookups; used to check the payment and as the refund destination). *Claude's call.*, `kind` adds `'manual'`, `verifiedBy`, `verifiedAt`.
- One transaction ID cannot pay two things: unique index `{ ownerId, provider, trxId }`, partial on `trxId` being a string **and status in `pending`/`succeeded`**. A TrxID marked "Not received" (`failed`) can be entered again (typo recovery). For a group, the TrxID is stored on the lead booking's payment row only; the other rows reference it via `groupId`. *Claude's call.*
- TrxID format check: 8–12 uppercase letters/digits (covers bKash 10-char and Nagad 8-char IDs). Builder's call; document the exact regex.
- Booking transitions: allow `awaiting_payment → pending` (`packages/shared/src/booking.ts` `BOOKING_TRANSITIONS`).

### C3. Player flow
- Pay page shows method tabs for what the venue offers. Manual wallet tab:
  1. Amount to send (the advance due) and the venue's number with a Copy button, provider logo-free label ("bKash personal"), and the owner's note.
  2. Short steps: "Open bKash → Send Money → this number → ৳500 → copy the Transaction ID".
  3. Inputs "Transaction ID" and "Sent from" (wallet number) → Submit.
- Submit (one transaction): creates a `pending` manual payment (amount = advance due for the booking or group), moves the booking(s) `awaiting_payment → pending`, clears the hold timer.
- **Auto-reject never fires on a booking with a submitted manual payment** (`autoRejectPending`, `apps/api/src/jobs/sweeps.ts:116`, skips it). It stays in "Payments to verify"; the Attention panel flags it as urgent when start time is near. Staff must decide. *User decision.*
- **Late submit:** if the hold already expired, the TrxID is still accepted when the slots are still free (booking re-held and moved to `pending` in one transaction). If the slots are gone, the payment is recorded and becomes a "to send" refund (C5) and the player is told. *User decision.*
- Group checkout: one TrxID pays the whole group's advance; one payment row per booking sharing `groupId`, amounts split per booking; verify/reject the group together.
- Player sees "Waiting for the venue to check your payment" and gets the existing notifications on confirm/reject (new template text "Payment received" / "Payment not found").
- Hold length for a booking whose venue only offers manual wallets: 15 min instead of `HOLD_MINUTES` (10) — sending money takes longer. Builder's call; keep it a named constant.

### C4. Owner verification
- On a `pending` booking with a pending manual payment, the primary action is **"Verify payment"** (Today sheet, Coming up row, Attention row, booking page). It shows provider, TrxID (copyable), amount, sender digits, submitted time. Two buttons:
  - **"Received · confirm"** → payment `succeeded` (`verifiedBy/At`), `amountPaid` updated, booking `confirmed`. Staff can edit the **amount actually received** (defaults to the amount due): a shortfall stays as due at the venue; an excess becomes a "to send" refund (C5). *User decision.* Requires `booking.confirm` and `payment.mark_cash` (or a new `payment.verify` permission added to Owner/Manager system roles — builder's call, document it).
  - **"Not received"** → payment `failed`, booking `rejected` with reason "payment not received", slots freed.
- Activity log entries for both.

### C5. Refunds of manual payments
- A refund owed on a manual wallet payment creates a refund row in a new `manual` state "to send": staff see "Send ৳X back to <sender number> by bKash" (the stored `senderNumber`) with a "Mark sent" action recording the outgoing TrxID. Reuse the existing record-cash refund route pattern (`payments/routes/refunds.ts`). Player notified when marked sent.

---

## Part D — SSLCommerz gateway

- Generalise the gateway layer:
  - `PaymentGateway.key: 'stripe' | 'sslcommerz'`; a registry `Record<GatewayKey, factory>` replaces `gatewayFor`'s single branch.
  - Per-gateway credential types (Stripe: secretKey/webhookSecret/publishableKey; SSLCommerz: storeId/storePassword) behind the existing sealed `credentialsEncrypted`.
  - `createPayment` returns a client action: `{ type: 'stripe_intent', clientSecret } | { type: 'redirect', url }`.
  - The webhook route lets the adapter read its own signature/validation input.
- SSLCommerz adapter (sandbox = test mode, live = live mode):
  - `supports('BD','BDT')` only.
  - `createPayment` → session API, returns redirect `GatewayPageURL`; success/fail/cancel URLs point back to the pay page, which polls payment status.
  - IPN endpoint → validate with the Order Validation API (never trust the IPN body alone), verify amount and currency match, then feed `applyEvent` as `succeeded`/`attempt_failed`; idempotent via the existing `WebhookEvent` row keyed by `val_id`/`tran_id`.
  - `refund` / `findRefund` via the refund API; `cancelPayment` is a no-op (sessions expire).
  - Reconcile pending SSLCommerz payments older than hold + 15 min via the transaction query API in a job (covers missed IPNs).
- Owner Settings → Payments: an SSLCommerz card next to `StripeGatewayCard.tsx` (store id, password, test/live), same verify-on-save pattern.
- Pay page: "Pay with bKash, Nagad, Rocket or card" button for SSLCommerz → redirect.

---

## Testing

- shared: transitions, settings resolution (no more guest-off rule; `paymentMethods` merge), TrxID validation.
- api: guest token sign/verify/expiry/tamper; guest pay endpoints authz (wrong token, other booking, expired); manual submit (hold cleared, status pending, duplicate TrxID → 409, group split); verify/reject transitions + permissions + tenant isolation; auto-reject skips bookings with a submitted manual payment; late submit (slots free → pending, slots gone → refund to send); verify with edited amount (shortfall due, excess refund); TrxID reuse after failed allowed, while pending/succeeded → 409; guest hold cap by phone; paid guest booking confirmed; manual refund "mark sent"; SSLCommerz adapter with mocked HTTP (session, IPN validation, amount mismatch, duplicate IPN, refund).
- web: Today sheet opens from a block and runs actions; free gap → walk-in link; poll refetch keeps data and updates "Updated"; money-due chip and legend; Coming-up next-step logic per status/permission; guest checkout OTP-in-place → pay page; manual wallet tab submit; method tabs reflect venue settings; ru strings exist for every new key.

## Left to the builder

Exact component names and file split; sheet component (reuse Dialog primitives if suitable); poll hook API; token format details; SSLCommerz HTTP client; exact copy (plain, sentence case, Russian fits); migration for new indexes/enums via `apps/api/src/migrations`.
