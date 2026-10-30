# Part C — Manual bKash / Nagad / Rocket Payment: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in player pays a venue's advance by sending money to the venue's bKash/Nagad/Rocket number and entering the Transaction ID. Staff check it and confirm or reject in one tap from Today, the booking page or Attention. Money owed back on a wallet payment is tracked as "to send" until staff mark it sent.

**Architecture:** Shared gains the `PaymentMethods` setting, TrxID rules, the `awaiting_payment → pending` transition and a `payment.verify` permission. The API stores a manual payment as a `Payment` with `method: 'wallet'`, `kind: 'manual'` that stays `pending` until staff verify it. New logic lives in `apps/api/src/payments/manual.ts`, which is used by the player and owner routes. Wallet refunds are `Refund` rows with `method: 'wallet'` that are never dispatched to a gateway; staff settle them with "Mark sent". The web side adds a Payment methods group to SettingsForm, method tabs on PayPage, a `verify` action in `availableActions` (so Today, the sheet, Coming up, Attention and the booking page all get it through `useBookingActions`), and "to send" refunds in OwnerRefunds.

**Tech Stack:** Express + Mongoose + zod (api, vitest + mongodb-memory-server), React 19 + react-router + react-i18next (web, vitest + Testing Library), `@booking/shared`.

**Spec:** `docs/superpowers/specs/2026-10-29-local-payments-guest-pay-today-actions-design.md`, Part C. This plan covers **signed-in players only**. Guests paying (the token, OTP and `/pay/:reference`) is spec Part B and gets its own plan, which will reuse `submitManualPayment` from Task 3.

## Global Constraints

- UI follows `.superdesign/design-system.md`, and every visual value is a `var(--…)` from `apps/web/src/styles/tokens.css`. Light and dark mode; 390px wide; 44px touch targets; WCAG 2.2 AA; Russian strings fit and are gender-neutral; every new key goes in both `en.json` and `ru.json`.
- Money is integer minor units (`packages/shared/src/money.ts`).
- Every state change runs inside `runInTransaction`. Booking moves go through `transition()`, except the expired-booking revive, which copies `apply.ts` `confirm()` (it bypasses the transitions on purpose).
- Tenancy: owner queries go through `tenantRepo`/`scopedBooking`, and every new owner route uses `requirePermission`.
- Anti-goals:
  - A manual payment never counts in `amountPaid` before staff verify it.
  - `senderNumber` never appears in a URL, a log line or a player-facing response.
  - No UI says "paid" for an unverified payment.
- Copy is plain and sentence case. Provider names stay as words ("bKash", "Nagad", "Rocket"), with no logos.
- Run tests one package at a time, because concurrent runs flake: `pnpm --filter @booking/shared test`, `pnpm --filter api test -- <file>`, `pnpm --filter web test -- <file>`.

## Decisions taken in this plan (rulings for the reviewer)

- **Payment method value:** reuse the existing, unused `Payment.method` value `'wallet'` instead of adding `'mobile_wallet'`. The reports already label it "Wallet". Rows are told apart by `kind: 'manual'` and `provider`.
- **Permission:** add `payment.verify`. It covers verify, reject and mark-sent. Owner and Manager get it automatically; Staff do not. `/confirm` and `/reject` on a booking with a pending manual payment return 409 `payment_to_verify`, so a booking can't be confirmed while its payment sits unchecked.
- **Late submit when the slots are gone:** the payment is recorded `pending` against the expired booking and appears in Payments to verify. "Received" marks it `succeeded`, `excess: true`, plus a wallet refund to send (`late_payment`); "Not received" marks it `failed`. Nothing counts as paid without a check (anti-goal).
- **Overpayment on verify:**
  - The payment row's `amount` = the amount received.
  - The booking's `amountPaid` grows by the amount due.
  - The difference becomes a wallet refund with the new reason `overpayment`.
- **Group verify with an edited amount:** the amount received is spread across the bookings in time order, each up to its share. Any shortfall stays due on the later bookings, and any excess becomes one refund on the lead booking.
- **Settings validation:** "at least one online method when the advance is not none" is checked only when a patch touches `paymentPolicy` or `paymentMethods`, so older owners can still save their hours.
- **Gateways:** `gateways: ['stripe']` is offered only while the owner's Stripe account is enabled and supports the venue's currency (the same check `startIntent` makes).

## Review Focus

1. **Two staff verify the same payment at once.** Exactly one wins; the other gets 409, and `amountPaid` grows once. Test in Task 4.
2. **The same TrxID is submitted for two bookings, or twice for one.** Second submit → 409 `trx_id_used`; after "Not received" it can be entered again. Test in Task 3.
3. **The hold lapses between page load and submit, and someone else books the slot.** The payment is recorded and the booking stays expired. The player sees "slots taken, the venue will send your money back once they check it". Test in Task 3.
4. **The auto-reject sweep runs on a pending booking with a submitted manual payment.** It is skipped. Test in Task 3.
5. **A member with only `booking.confirm`, no `payment.verify`.** They see no Verify button and no Confirm/Reject on that booking (only Open), and the API returns 403. Tests in Tasks 4 and 8.

---

### Task 1: Shared rules

**Files:**
- Modify:
  - `packages/shared/src/settings.ts`
  - `packages/shared/src/booking.ts`
  - `packages/shared/src/permissions.ts`
  - `packages/shared/src/index.ts`
- Create: `packages/shared/src/wallets.ts`
- Test: `packages/shared/test/wallets.test.ts`, `settings.test.ts`, `booking.test.ts`, `permissions.test.ts` (add to the existing files)

**Interfaces — Produces:**
- `WALLET_PROVIDERS = ['bkash', 'nagad', 'rocket'] as const` and `type WalletProvider`.
- `type ManualWallet = { provider: WalletProvider; number: string; accountType: 'personal' | 'merchant' | 'agent'; note?: string }`.
- `type PaymentMethods = { manualWallets: ManualWallet[]; gateways: Array<'stripe' | 'sslcommerz'> }`.
- `OwnerSettings.paymentMethods: PaymentMethods`, default `{ manualWallets: [], gateways: [] }`. `VenueSettingsOverride` picks it up automatically, and a venue's value replaces the owner's whole (the existing spread does this).
- `TRX_ID_PATTERN = /^[A-Z0-9]{8,12}$/`.
- `normalizeTrxId(raw: string): string | null`: trim, remove inner spaces, uppercase, then test the pattern; null if it fails.
- `MANUAL_HOLD_MINUTES = 15`.
- `BOOKING_TRANSITIONS.awaiting_payment` gains `'pending'`.
- `PERMISSIONS` gains `'payment.verify'`, placed after `payment.mark_cash`. Staff do not get it.

- [ ] **Step 1: Write failing tests**
  - `normalizeTrxId(' 9a1b 2c3d4e ') === '9A1B2C3D4E'`; `normalizeTrxId('AB12') === null`; `normalizeTrxId('ABCDEFGHIJKLM') === null`; `normalizeTrxId('AB-12345678') === null`.
  - `resolveSettings(owner with paymentMethods A, { paymentMethods: B }).paymentMethods` deep-equals B, and `withOwnerDefaults({}).paymentMethods` deep-equals `{ manualWallets: [], gateways: [] }`.
  - `canTransition('awaiting_payment', 'pending') === true`; `canTransition('expired', 'pending') === false`.
  - `SYSTEM_ROLES.manager` includes `'payment.verify'`; `SYSTEM_ROLES.staff` does not.
- [ ] **Step 2: Run** `pnpm --filter @booking/shared test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the Produces list. Export it from `index.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `pnpm --filter api test -- test/tenancy` and `pnpm --filter web test -- test/owner/staff` (the permission list is rendered there). Expected: PASS, or snapshot/count updates that only reflect the new permission.
- [ ] **Step 5: Commit** `feat(shared): payment methods setting, TrxID rules, payment.verify`

---

### Task 2: Payment methods in settings (API)

**Files:**
- Modify:
  - `apps/api/src/venues/settingsSchema.ts`
  - `apps/api/src/venues/routes/settings.ts`
  - `apps/api/src/venues/routes/venues.ts` (venue settings PATCH)
  - `apps/api/src/bookings/routes/public.ts` (quote response)
  - `apps/api/src/migrations/index.ts`
- Create: `apps/api/src/payments/methods.ts`
- Test: `apps/api/test/venues/settings.test.ts`, `apps/api/test/bookings/public.test.ts`, `apps/api/test/migrations.test.ts`

**Interfaces — Produces:**
- `paymentMethodsSchema`:
  - `manualWallets`: max 3, at most one per provider; `number` is put through `normalizePhone` (`apps/api/src/auth/normalize`) and must match `^\+8801[3-9]\d{8}$`; `note` is at most 140 characters.
  - `gateways`: unique values.
  - It sits in `venueFields`, nullable and optional.
- `offeredMethods(ownerId: string, venue: VenueDoc, settings: EffectiveSettings, ctx): Promise<{ wallets: ManualWallet[]; card: boolean }>` in `payments/methods.ts`.
  - `card` is true only when `'stripe'` is in `gateways` and `loadGateway(ownerId, 'stripe', …)` is enabled and `supports(venue.country, currency)`.
- Quote JSON gains `paymentMethods: { wallets: WalletProvider[]; card: boolean }`. It carries provider names only, never numbers.
- Settings save is refused with 400 `no_payment_method` ("Turn on at least one way to pay online, or set the advance to none") when **both** of these hold:
  - the patch has `paymentPolicy` or `paymentMethods`;
  - the resulting effective settings have `paymentPolicy.type !== 'none'`, `manualWallets` empty and `gateways` empty.
- Migration `2026-10-30-payment-methods`: every owner with an enabled Stripe `PaymentGatewayAccount` and no stored `settings.paymentMethods` gets `{ manualWallets: [], gateways: ['stripe'] }`. It is idempotent.

- [ ] **Step 1: Write failing tests**
  - `PATCH owner settings stores paymentMethods with the wallet number normalised`: `'01712345678'` is stored as `'+8801712345678'`.
  - `rejects a wallet number that is not a BD mobile`: `'+8802123456'` → 400.
  - `rejects two wallets for the same provider` → 400.
  - `refuses an advance with no way to pay`: `{ paymentPolicy: { type: 'full' } }` with empty methods → 400 `no_payment_method`.
  - `still saves hours for an owner whose advance has no methods`: an owner seeded straight in the DB with `full` and no methods; `PATCH { hours: … }` → 200.
  - `venue paymentMethods replaces the owner's`: the venue PATCH stores it, and `effectiveSettings.paymentMethods` deep-equals the venue's value.
  - `quote lists offered methods without numbers`: venue wallets bkash + nagad, Stripe off → `paymentMethods` deep-equals `{ wallets: ['bkash', 'nagad'], card: false }`, and the body does not contain `'+8801'`.
  - `payment-methods migration seeds stripe for owners with an enabled account`; running it a second time returns 0.
- [ ] **Step 2: Run** `pnpm --filter api test -- test/venues/settings.test.ts test/bookings/public.test.ts test/migrations.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the Produces list.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): per-venue payment methods setting`

---

### Task 3: Player submits a manual payment

**Files:**
- Modify:
  - `apps/api/src/bookings/payment.model.ts`
  - `apps/api/src/payments/apply.ts` (export `stillFree`)
  - `apps/api/src/bookings/create.ts` (hold length)
  - `apps/api/src/jobs/sweeps.ts` (`autoRejectPending`)
  - `apps/api/src/bookings/routes/public.ts`
  - `apps/api/src/bookings/playerJson.ts`
- Create: `apps/api/src/payments/manual.ts`
- Test: `apps/api/test/payments/manual.test.ts`, `apps/api/test/jobs/sweeps.test.ts`

**Interfaces:**
- Consumes `normalizeTrxId`, `MANUAL_HOLD_MINUTES`, `offeredMethods` and the `awaiting_payment → pending` transition.
- **Payment model:**
  - New fields: `provider` (`WalletProvider | null`), `trxId` (string | null), `senderNumber` (string | null), `verifiedBy` (ObjectId | null), `verifiedAt` (Date | null).
  - `kind` enum gains `'manual'`.
  - New unique index `{ ownerId: 1, provider: 1, trxId: 1 }`, partial on `{ trxId: { $type: 'string' }, status: { $in: ['pending', 'succeeded'] } }`. Mongo partial filters can't use `$in`, so build it as two partial unique indexes, one per status. Note this in a comment.
  - The TrxID goes on the lead row only. The other rows of a group carry `trxId: null` and share the `groupId`.
- `submitManualPayment(booking: BookingDoc, input: { provider: WalletProvider; trxId: string; senderNumber: string }, ctx: { services: AppServices }): Promise<{ bookings: BookingDoc[]; payment: PaymentDoc; outcome: 'pending' | 'slots_taken' }>`.
  - **Bookings covered:** the booking itself, or every `awaiting_payment`/`expired` booking of its group for the same player.
  - **Payment rows:** one `pending` wallet payment per booking still owing, with `amount = advanceRequired - amountPaid`, all inside one transaction that locks each turf in sorted order.
  - **Hold still live:** `transition(…, 'pending', …, { holdExpiresAt: null })`, which logs as the player.
  - **Lapsed or expired, slots still free (`stillFree`):** revive the way `apply.ts` `confirm()` does (re-create the SlotLocks), but set `status: 'pending'`.
  - **Slots gone:** keep the booking as it is, still create the payment, and return `outcome: 'slots_taken'`.
  - **Duplicate key** on the TrxID index → 409 `trx_id_used` ("This Transaction ID was already used").
  - **Errors:**
    - provider not in the venue's `manualWallets` → 409 `payments_unavailable`;
    - bad TrxID → 400 `invalid_trx_id`;
    - `senderNumber` not a BD mobile → 400 `invalid_sender`;
    - booking not `awaiting_payment`/`expired` → 409 `invalid_transition`;
    - a pending manual payment already on the booking → 409 `payment_submitted`.
- **Routes (`requireAuth`, the player's own booking, same lookup as `/bookings/:bookingId/payment`):**
  - `GET /bookings/:bookingId/payment-options` → `{ wallets: ManualWallet[]; card: boolean; amount: number; currency: string; holdExpiresAt: string | null }`. The venue's numbers go only to the booking's player. `amount` is the group sum.
  - `POST /bookings/:bookingId/payments/manual` with `{ provider, trxId, senderNumber }` → 201 `{ booking: PlayerBooking, outcome }`.
- **Player booking JSON** gains `manualPayment: { provider: WalletProvider; trxId: string; amount: number; status: 'pending' | 'succeeded' | 'failed'; submittedAt: string } | null`. This is the latest manual payment on the booking or its group lead, with no `senderNumber`.
- **Hold length:** a new online player booking whose venue offers wallets and `card === false` gets `holdExpiresAt = now + MANUAL_HOLD_MINUTES`; otherwise `HOLD_MINUTES` as now.
- **`autoRejectPending`:** its `due` filter drops bookings with a pending `kind: 'manual'` payment, checked by one `$in` query per page, like `warnExpiringHolds`.

- [ ] **Step 1: Write failing tests** in `manual.test.ts`:
  - `submit moves the hold to pending and records a pending wallet payment`: the booking is `pending`, `holdExpiresAt` is null and `amountPaid` is 0. The payment has `method: 'wallet'`, `kind: 'manual'`, `status: 'pending'`, `trxId: '9A1B2C3D4E'`, `senderNumber: '+8801812345678'`.
  - `submit for a group makes one row per booking with the TrxID on the lead only`, and the amounts sum to the group advance.
  - `same TrxID twice is 409 trx_id_used`, on two different bookings of the same owner.
  - `TrxID can be reused after the payment was marked not received`: set the first row to `failed` directly, then submit again → 201.
  - `late submit revives the booking when slots are free`: the hold has passed and `expireHolds` has run, so the booking is `expired`. Submit → `pending`, and the SlotLocks are back.
  - `late submit when slots are taken records the payment and keeps the booking expired`: `outcome: 'slots_taken'`.
  - `rejects a provider the venue does not offer` → 409 `payments_unavailable`.
  - `payment-options shows the venue numbers to the booking's player only`: another player → 404.
  - `player JSON never includes senderNumber`: `JSON.stringify(body)` does not contain `'8801812345678'`.
  - `manual-only venue holds for 15 minutes`.

  And in `sweeps.test.ts`: `autoRejectPending skips a booking with a submitted manual payment`.
- [ ] **Step 2: Run** `pnpm --filter api test -- test/payments/manual.test.ts test/jobs/sweeps.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the Interfaces above.
- [ ] **Step 4: Run** the same command, then `pnpm --filter api test`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(api): players submit a bKash/Nagad/Rocket transaction ID`

---

### Task 4: Staff verify or reject (API)

**Files:**
- Modify:
  - `apps/api/src/payments/manual.ts`
  - `apps/api/src/payments/refund.model.ts`
  - `apps/api/src/bookings/routes/owner.ts`
  - `apps/api/src/bookings/ownerJson.ts`
  - `apps/api/src/notifications/templates.ts` and `outbox.ts` (event list)
- Test: `apps/api/test/payments/manualVerify.test.ts`, `apps/api/test/notifications/templates.test.ts`

**Interfaces:**
- **Refund model:**
  - `REFUND_REASONS` gains `'overpayment'`; `REFUND_METHODS` gains `'wallet'`.
  - New field `trxId` (string | null), the outgoing transaction ID recorded by Mark sent.
  - `RefundPart.method` widens to `'card' | 'cash' | 'wallet'`.
- `verifyManualPayment(t: TenantContext, booking: BookingDoc, input: { amountReceived?: number }, now: Date): Promise<BookingDoc[]>`.
  - **Payment:** the lead pending manual payment and its group rows become `succeeded` with `verifiedBy`/`verifiedAt`. The lead row's amount becomes the amount received, and the amounts are spread as in the rulings above.
  - **Booking:** `amountPaid` and `paymentStatus` are updated, then `transition(t, b, 'confirmed', …)` and `noticeBooking('payment_received', …)`.
  - **Expired booking (slots were taken):** the payment becomes `succeeded`, `excess: true`, plus a wallet refund `late_payment` to send, and no transition.
  - **Excess received:** a wallet refund `overpayment` for the difference, added through `reserveRefunds`.
  - **Activity log:** one `payment.verified` entry with `{ trxId, provider, amountDue, amountReceived }`.
  - **Concurrency:** every write is guarded on `status: 'pending'`; a miss → 409 `invalid_transition`.
- `rejectManualPayment(t, booking, now): Promise<BookingDoc[]>`.
  - The rows become `failed` with `failureCode: 'not_received'`.
  - Each `pending` booking moves to `rejected` with `rejectReason: 'payment_not_received'`, which frees its slots, and gets `noticeBooking('payment_not_found', …)`.
  - The activity log gets `payment.not_received`.
- **Routes**, each with `requirePermission('payment.verify')`:
  - `POST /bookings/:bookingId/payments/manual/verify` with `{ amountReceived?: number }` (integer minor units, ≥ 1) → `{ booking: OwnerBooking }`.
  - `POST /bookings/:bookingId/payments/manual/reject` → `{ booking: OwnerBooking }`.
- **Existing `/confirm` and `/reject`:** 409 `payment_to_verify` when the booking has a pending manual payment.
- **`OwnerBooking`** gains `manualPayment: { id; provider; trxId; amount; senderNumber; status; submittedAt } | null`. It is loaded with one `$in` query in `ownerBookingsJson` and looks up the group lead's row for group members. The `paymentJson` of the booking detail adds `provider`, `trxId` and `kind`.
- **`NOTICE_EVENTS`** gains `payment_received` ("Payment received — your booking {{reference}} is confirmed") and `payment_not_found` ("We couldn't find your payment for {{reference}}"), each in en and ru with the same structure as `booking_confirmed`/`booking_rejected`.

- [ ] **Step 1: Write failing tests:**
  - `verify confirms the booking and counts the payment`: `amountPaid` = advance, status `confirmed`, `verifiedBy` = the member, `payment_received` queued.
  - `verify with less received leaves the rest due`: `amountReceived` = advance − 10000 → `amountPaid` = advance − 10000, booking `confirmed`.
  - `verify with more received creates a wallet refund to send`: excess 5000 → one Refund with `method: 'wallet'`, `status: 'pending'`, `reason: 'overpayment'`, `amount: 5000`.
  - `verify a group confirms every booking`.
  - `verify a late payment whose slots were taken refunds it in full`: the booking stays `expired`; refund `late_payment`; payment `excess: true`.
  - `reject frees the slots and tells the player`: booking `rejected`, SlotLocks gone, payment `failed`, `payment_not_found` queued.
  - `two verifies at once: one wins` with `Promise.allSettled`: one 200 and one 409, and `amountPaid` counted once.
  - `confirm on a booking with a pending manual payment is 409 payment_to_verify`.
  - `staff role without payment.verify gets 403`.
  - `verify is tenant-scoped`: another owner's member → 404.
  - `owner booking list includes manualPayment with the sender number`.
  - Templates: `payment_received and payment_not_found render in en and ru`.
- [ ] **Step 2: Run** `pnpm --filter api test -- test/payments/manualVerify.test.ts test/notifications`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the Interfaces above.
- [ ] **Step 4: Run** the same command, then `pnpm --filter api test`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(api): staff verify or reject manual wallet payments`

---

### Task 5: Wallet refunds to send (API)

**Files:**
- Modify:
  - `apps/api/src/payments/refunds.ts`
  - `apps/api/src/payments/routes/refunds.ts`
  - `apps/api/src/bookings/cancel.ts` (only if it narrows the method types)
- Test: `apps/api/test/payments/walletRefunds.test.ts`

**Interfaces:**
- `allocateRefund` accepts succeeded `wallet` payments. Order: card first, then wallet, then cash, newest first within each. It produces `method: 'wallet'` parts.
- `reserveRefunds` leaves `gateway` null for wallet refunds.
- `dispatchRefund` and the reconcile sweep already filter on `method: 'card'`. Confirm with a test that a wallet refund is never dispatched.
- `POST /refunds/:refundId/mark-sent` with `{ trxId: string }`, `requirePermission('payment.verify')`:
  - only for a `wallet` refund in `pending` status;
  - stores `trxId` (through `normalizeTrxId`, 400 `invalid_trx_id`) and `by`;
  - `settleRefund(…, { status: 'succeeded' })`;
  - queues the existing `refund_issued` notice;
  - otherwise → 409 `invalid_transition`.
- The owner `refundJson` gains `trxId`, `provider` (from the payment) and `sendTo` (the payment's `senderNumber`) for wallet refunds only, so staff see "Send ৳X back to +8801… by bKash".

- [ ] **Step 1: Write failing tests:**
  - `cancelling a booking paid by wallet makes a refund to send` (staff cancel with a full refund): Refund `method: 'wallet'`, `status: 'pending'`, and the dispatcher was not called.
  - `mark sent settles the refund and tells the player`: status `succeeded`, `trxId` stored, `refund_issued` queued.
  - `mark sent twice is 409`.
  - `mark sent needs payment.verify` → 403 for staff.
  - `owner refund JSON shows where to send it`: `sendTo: '+8801812345678'`, `provider: 'bkash'`.
- [ ] **Step 2: Run** `pnpm --filter api test -- test/payments/walletRefunds.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then `pnpm --filter api test`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(api): wallet refunds staff send by hand`

---

### Task 6: Payment methods in owner and venue settings (web)

**Files:**
- Modify:
  - `apps/web/src/owner/settings/SettingsForm.tsx`
  - `settings.module.css`
  - `settingsPatch.ts`
  - en/ru locales
  - `.superdesign/design-system.md` (Settings section)
- Create: `apps/web/src/owner/settings/PaymentMethodsFields.tsx`
- Test: `apps/web/test/owner/settings.test.tsx`

**Interfaces:**
- Consumes `PaymentMethods` and `ManualWallet` from shared, and the `no_payment_method` error.
- `PaymentMethodsFields({ value, onChange, disabled, stripeReady }: { value: PaymentMethods; onChange(v: PaymentMethods): void; disabled: boolean; stripeReady: boolean })`.
  - **Wallets:** one row per provider: a checkbox labelled "bKash", "Nagad" or "Rocket"; when checked, a number input (`inputmode="tel"`), an account type select and a note.
  - **Card:** a "Card (Stripe)" checkbox, disabled with a hint "Connect Stripe first" when `!stripeReady`.
- SettingsForm renders the "Payment methods" card under the advance-payment card, with the same inherit/override pattern as `paymentPolicy` at venue level. `paymentMethods` is part of the patch.
- Stored numbers show formatted as `+880 17XX-XXXXXX` when not being edited.

- [ ] **Step 1: Write failing tests:**
  - `owner turns on bKash with a number and saves`: the PATCH body includes `paymentMethods.manualWallets[0]` deep-equal to `{ provider: 'bkash', number: '01712345678', accountType: 'personal' }`.
  - `venue inherits payment methods until overridden`.
  - `save error no_payment_method shows its message next to the group`.
  - `card is disabled until Stripe is connected`.
- [ ] **Step 2: Run** `pnpm --filter web test -- test/owner/settings.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the existing form controls and tokens. Add a design doc line: "Payment methods: one row per wallet, number shown formatted."
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(owner): choose payment methods per venue`

---

### Task 7: Player pays by wallet (web)

**Files:**
- Modify:
  - `apps/web/src/payment/PayPage.tsx`
  - `PayPage.module.css`
  - `apps/web/src/lib/types.ts`
  - `apps/web/src/bookings/BookingDetailPage.tsx`
  - `apps/web/src/checkout/BookingSummary.tsx`
  - en/ru locales
  - design doc (Pay page)
- Create: `apps/web/src/payment/WalletPayForm.tsx`
- Test: `apps/web/test/payment/payPage.test.tsx`, `apps/web/test/bookings/detail.test.tsx`, `apps/web/test/checkout/checkout.test.tsx`

**Interfaces:**
- Consumes `GET /bookings/:id/payment-options`, `POST /bookings/:id/payments/manual`, the quote's `paymentMethods`, and the player `manualPayment`.
- **PayPage:**
  - Loads the booking, then the payment options.
  - **Tabs:** a "Card" tab when `card` is true, plus one tab per wallet ("bKash", "Nagad", "Rocket"), using a `role="tablist"` row of buttons.
  - The Stripe intent (`POST /payment`) starts only when the Card tab is chosen. When card is the only method it opens first, which keeps today's behaviour.
  - The hold countdown is shared by every tab.
- **`WalletPayForm({ booking, wallet, amount, currency, onDone })`:**
  - **Header:** the amount to send, the venue number with a Copy button (`navigator.clipboard.writeText`, then "Copied" in a polite live region), "bKash personal", and the owner's note.
  - **Steps** (exact copy): "Open {{provider}} → Send Money → {{number}} → {{amount}} → copy the Transaction ID". Use "Cash Out" instead of "Send Money" when `accountType === 'agent'` and "Payment" when `'merchant'`.
  - **Inputs:** "Transaction ID" (`autocapitalize="characters"`; checked on the client against `TRX_ID_PATTERN` after `normalizeTrxId`) and "Sent from" (`inputmode="tel"`, `autocomplete="tel"`).
  - **On submit:** navigate to `/me/bookings/:id?submitted=1`. With `outcome === 'slots_taken'`, add `&late=1` instead.
- **BookingDetailPage:** when `manualPayment?.status === 'pending'`, an info Alert reads "Waiting for the venue to check your payment ({{provider}} {{trxId}})". With `?late=1` it reads "These times were taken while you paid. The venue will send your money back once they check it."
- **BookingSummary:** when the advance is greater than 0, a line reads "Pay {{amount}} now by {{methods}} · rest at venue". `{{methods}}` is a list formatted with `Intl.ListFormat` (`type: 'disjunction'`), with "card" localised. With no methods it reads "Online payment isn't set up at this venue yet", and the Continue button is disabled.

- [ ] **Step 1: Write failing tests:**
  - `wallet tab shows the amount and number and submits the TrxID`: the POST body deep-equals `{ provider: 'bkash', trxId: '9A1B2C3D4E', senderNumber: '01812345678' }`, then navigates to `?submitted=1`.
  - `invalid TrxID is flagged before submit`: there is no POST, and the field has `aria-invalid="true"`.
  - `card tab starts the Stripe intent only when chosen`: the `/payment` mock is not called until the Card tab is clicked.
  - `card-only venue opens on card as before`: the existing pay tests still pass.
  - `trx_id_used error shows next to the Transaction ID field`.
  - `booking detail shows waiting for the venue while a manual payment is pending`.
  - `summary shows how to pay before Continue`: "Pay ৳500.00 now by bKash or card · rest at venue" (normalise NBSP in the matcher).
  - `ru strings exist for every new key`, by key-set comparison of the `payment.wallet.*` keys.
- [ ] **Step 2: Run** `pnpm --filter web test -- test/payment test/bookings/detail.test.tsx test/checkout`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** The tabs use `--control-md` height (≥ 44px). The number and TrxID use `--font-mono`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): pay a booking by bKash, Nagad or Rocket`

---

### Task 8: Staff verify from everywhere (web)

**Files:**
- Modify:
  - `apps/web/src/owner/bookings/availableActions.ts`
  - `BookingActions.tsx`
  - `apps/web/src/owner/types.ts`
  - `apps/web/src/owner/today/Attention.tsx`
  - `apps/web/src/owner/today/TodayPage.tsx` (Coming-up primary action)
  - `apps/web/src/owner/bookings/OwnerRefunds.tsx`
  - en/ru locales
  - design doc (Today, Booking page)
- Create: `apps/web/src/owner/bookings/VerifyPaymentDialog.tsx`
- Test:
  - `apps/web/test/owner/bookingActions.test.tsx`
  - `apps/web/test/owner/verifyPayment.test.tsx`
  - `apps/web/test/owner/today.test.tsx`
  - `apps/web/test/owner/bookingDetail.test.tsx`

**Interfaces:**
- `Action` gains `'verify'`. In `availableActions`:
  - when `b.manualPayment?.status === 'pending'`, emit `'verify'` first if `can('payment.verify')`, and **leave out** `confirm`/`reject` whatever the permission;
  - otherwise behave as now.
- The Coming-up and BookingSheet primary for such a booking is `verify` ("Verify payment").
- **`VerifyPaymentDialog({ booking, onDone })`:**
  - Shows provider, TrxID (Copy), "Sent from" number, amount due, and the submitted time.
  - "Amount received" field defaults to the amount due.
  - **"Received · confirm"** posts `…/manual/verify`, sending `{ amountReceived }` only when it differs from the amount due.
  - **"Not received"** asks for confirmation inside the dialog, then posts `…/manual/reject`.
  - **Hints:**
    - less received → "{{rest}} stays due at the venue";
    - more received → "{{extra}} will be listed to send back".
  - A 409 reloads the booking, the same as the other actions.
- **Attention:** a new first row, "{{count}} payments to verify" (en and ru plural forms). Its detail is the oldest submitted, and its primary is `verify`. The tone is `danger` when that booking starts within 60 min, otherwise `warning`. Bookings in this row are left out of the "waiting for confirmation" count.
- **OwnerRefunds:** a pending wallet refund shows "Send {{amount}} back to {{number}} by {{provider}}", with a "Mark sent" button (only with `payment.verify`). The button opens a small dialog with a TrxID field and posts `/refunds/:id/mark-sent`.

- [ ] **Step 1: Write failing tests:**
  - `availableActions offers verify instead of confirm when a manual payment is pending`: with all permissions the list is `['verify', 'cancel']`; with `booking.confirm` only it is `[]`.
  - `verify dialog confirms with the default amount`: the POST body deep-equals `{}`, and `onDone` runs.
  - `verify dialog sends an edited amount and shows the shortfall hint`.
  - `not received asks first, then rejects`.
  - `Today attention lists payments to verify and verifies inline`: the row shows "1 payment to verify", and clicking "Verify payment" opens the dialog.
  - `Coming up primary action is Verify payment for a submitted wallet payment`.
  - `wallet refund shows where to send and marks it sent`.
  - `ru plural forms exist for paymentsToVerify`.
- [ ] **Step 2: Run** `pnpm --filter web test -- test/owner/bookingActions.test.tsx test/owner/verifyPayment.test.tsx test/owner/today.test.tsx test/owner/bookingDetail.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** The status badge for a pending booking with a submitted payment reads "Payment to check", not "Paid" (anti-goal).
- [ ] **Step 4: Run** the same command, then each package's suite one at a time: shared, api, web. Then `pnpm lint` and `pnpm --filter web typecheck`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(owner): verify wallet payments from Today, bookings and refunds`

---

## Out of scope here

- Guest payments: the token, OTP and `/pay/:reference` (spec Part B).
- SSLCommerz and the gateway registry (spec Part D).
- Changes to the reports' payment breakdown, beyond the existing "Wallet" label now getting real rows.
