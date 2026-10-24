# Plan 07 — Booking Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players (registered or guest) and staff (walk-ins) book one or more consecutive slots of a turf with add-ons. Each booking stores a price snapshot and gets an advance from the payment policy, and the slots are locked so no instant is ever sold twice. Staff confirm or reject pending bookings, check players in or mark them no-show, and record cash payments. The slot grid shows Pending and Booked.

**Architecture:**
- **Pure rules in the shared package.** The status machine, slot selection, advance, initial status, payment status and `quoteBooking()` live in `packages/shared/src/booking.ts`. Tests and the web checkout reuse them.
- **API module `apps/api/src/bookings/`.** It holds the `Booking`, `SlotLock` and `Payment` models and one `createBooking()` service that every entry point calls (public online, owner walk-in).
- **One transaction per booking.** `createBooking()` runs in a single `runInTransaction`: lock the turf (and stock-limited add-ons), expire stale holds, check overlap, compute stock in use, then insert the booking and one `slotLocks` row per slot. The unique `{ turfId, startAt }` index is the final guard.
- **Carry-over fixes come first.** Tasks 1–2 close the D+2 override reach, the BigInt guard and the orphan races from Plans 05–06 before bookings depend on those paths.

**Tech Stack:** Plan 01–06 stack (Express 5, Mongoose 8 on a replica set, Zod 3, Vitest, supertest, MongoMemoryReplSet). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md`:
- §10: payment policy and guest booking.
- §11: booking statuses, slot locking, walk-ins, cash.
- §7: consecutive slots, business day.
- §8: price snapshot.
- §9: add-on snapshot, advance on full total, stock.
- §5: permissions, activity log.
- §16: `bookings`, `payments`.
- §18: tests for creation, locking, pricing and tenancy.

Roadmap: `docs/superpowers/plans/2026-10-23-roadmap.md` (Plan 07; failure modes 1, 2, 3 and 5).

## Global Constraints

- **Earlier plans still apply.**
  - TS strict, ESM, error shape `{ error: { code, message, details? } }`, `/api/v1`, injected `services.now()`.
  - Owner routes mount on `ownerRouter`, and every query carries `ownerId` (`tenantScoped`). Use `.setOptions({ crossTenant: true })` only on public lookups by slug, reference or player.
  - Staff mutations and their `logActivity` run in one `runInTransaction`. Player and guest actions are not logged, because `logActivity` needs a staff actor.
- **Concurrency.** Two concurrent requests for the same slot: exactly one succeeds and the other gets `409 slot_taken` (roadmap failure mode 1).
- **Tenancy.** Another owner's booking, or one at a venue outside the member's scope, gives `404 not_found` "Booking not found", with the same body as a malformed id (roadmap failure mode 2).
- **Business day.** Quoted from spec §7: a slot "belongs to the business day it opened on". All slots of one booking come from one `loadDay` result, so midnight and DST are handled the way Plan 05 handles them (roadmap failure mode 3).
- **Money.** All amounts are integers in minor units of the venue's currency (`assertMinor`, `percentOf`), and no float math is used (roadmap failure mode 5). Quoted from spec §9: "The advance % applies to the **full total** (slot + add-ons)."
- **Spec rules quoted verbatim:**
  - "If any advance is required, guest booking is automatically disabled for that venue."
  - "Guest bookings always start as `pending`."
  - "when a **registered** player books a no-advance venue, the booking is `confirmed` immediately".
  - `awaiting_payment` is a "10-min hold".
  - `cancelled`, `expired` and `rejected` free the slot.
- **No UI in this plan.** Plans 12 and 13 build the checkout and the bookings screens under `.superdesign/design-system.md` and `tokens.css`. Guest names are free text and may be Russian.

## Decisions made in this plan (builder's calls)

- **Statuses.**
  - `SLOT_HOLDING_STATUSES` becomes every status except `rejected`, `cancelled` and `expired`. That adds `completed` and `no_show`: a checked-in booking still occupies its time. Nothing uses the constant yet.
  - Transitions (`BOOKING_TRANSITIONS`):

    | From | Allowed next statuses |
    |------|-----------------------|
    | `awaiting_payment` | `confirmed`, `expired`, `cancelled` |
    | `pending` | `confirmed`, `rejected`, `cancelled` |
    | `confirmed` | `completed`, `no_show`, `cancelled` |
    | `rejected`, `cancelled`, `expired`, `completed`, `no_show` | none (terminal) |

  - A transition is a conditional update (`{ _id, status: from }`) inside the transaction. When two staff act at once, the loser gets `409 invalid_transition`.
  - Moving to `rejected`, `cancelled` or `expired` deletes the booking's `slotLocks` in the same transaction.
- **Initial status.**
  - A walk-in is `confirmed`.
  - A guest is `pending`.
  - A registered player is `awaiting_payment` with `holdExpiresAt = now + 10 min` when `advanceRequired > 0`, and `confirmed` otherwise.
  - The Stripe payment for `awaiting_payment` is Plan 08. Plan 07 creates the hold only.
- **Stale holds expire lazily.** Plan 10's job is not there yet, so an `awaiting_payment` booking whose `holdExpiresAt <= now` is treated as not holding:
  - it is left out of slot status and stock in use;
  - `createBooking()` sets it to `expired` and deletes its locks when it overlaps the new booking, inside the new booking's transaction.
- **Slot selection** (`pickSlots`):
  - The body names `date` (business date) and `startAts` (ISO instants, 1–12, no duplicates).
  - Each one must match a slot of that `loadDay` result with a non-null price and status `available`. Walk-ins may also take a `past` slot whose `endAt > now` (the game in progress).
  - Sorted by `startAt`, each slot's `endAt` must equal the next one's `startAt`.
  - The date must be `inWindow`, and the day not closed.
- **Overlap guard.** Inside the transaction, after `lockTurf`, any holding booking on the turf overlapping `[first.startAt, last.endAt)` → 409 `slot_taken`, even when its slot starts differ from today's grid (for example, slot length changed after it was booked). `lockTurf` serializes bookings of one turf, so this read is safe. A duplicate key on `slotLocks` maps to the same 409.
- **Stock in use.** Sum the units (quantity for `per_unit`, else 1) per `addonId` over holding bookings at the **venue** (any turf) whose `[startAt, endAt)` overlaps the new booking. It is computed after `lockAddon` on every selected add-on with a non-null stock, so two turfs cannot both take the last unit.
- **Amounts.**
  - `subtotal` is the sum of slot prices, `addonsTotal` the sum of add-on lines, and `total = subtotal + addonsTotal`.
  - `advanceRequired` by `paymentPolicy`: `none` → 0, `full` → `total`, `partial_percent` → `percentOf(total, percent)`, `partial_fixed` → `min(amount, total)`.
  - Walk-ins ignore the policy: `advanceRequired: 0`.
  - `amountPaid` is the sum of the booking's succeeded payments.
  - `paymentStatus`: `paid` when `amountPaid >= total`; `unpaid` when `amountPaid` is 0; otherwise `partially_paid`. `refunded` and `partially_refunded` are Plan 09.
- **Who is booking.**
  - Registered online: `playerId` is set and `guest` is null.
  - Guest online: `guest { name, phone }` is set and `playerId` is null.
  - Walk-in: `guest { name, phone }` is always set; `playerId` is set too when staff link an existing user (spec: "name + phone, optional link to existing player").
  - `createdBy` is the user id, or null for a guest.
- **Guests.**
  - Refused with 403 `guest_booking_disabled` when the venue's effective `guestBooking.allowed` is false, **or** when `advanceRequired > 0`. The second check is a defensive repeat of the spec rule.
  - When `requireOtp` is true (the default), the body carries `otpCode`, checked with `verifyOtp(phone, 'guest_booking', …)` before the transaction. `POST /venues/:slug/bookings/otp { phone }` sends the code.
  - Each booking gets a `reference`: 8 characters of Crockford base32 (no I, L, O or U), unique index, regenerated on a duplicate.
  - Guests view a booking with `GET /bookings/lookup?reference=&phone=`. Both must match, or the response is 404.
  - Cancelling (with its refund preview) is Plan 09, for every kind of booking.
- **Staff actions** (owner router, booking venue in scope):
  - `confirm` / `reject` (`booking.confirm`): pending only. `reject` takes an optional `{ reason }` (≤ 300 characters).
  - `check-in` (`booking.checkin`): confirmed → `completed`, allowed from 60 min before the first slot.
  - `no-show` (`booking.checkin`): confirmed → `no_show`, allowed once the first slot has started. Early → 409 `too_early`.
- **Cash** (`payment.mark_cash`):
  - `POST …/bookings/:id/payments/cash { amount? }` takes a status of `pending`, `confirmed`, `completed` or `no_show`. `amount` defaults to the remaining balance and must be between 1 and the remaining balance (else 400 `invalid_amount`); nothing remaining → 409 `already_paid`.
  - Inserts a `payments` row `{ method: 'cash', gateway: null, gatewayAccountId: null, gatewayRef: null, status: 'succeeded', recordedBy }`, updates `amountPaid`/`paymentStatus`, and logs `payment.cash` (who and when, spec §11).
- **Walk-in:** `{ date, startAts, addons, customer: { name, phone, playerId? }, payment: { method: 'cash', amount? } | { method: 'unpaid' } }`. Cash records the payment in the creation transaction; card and payment links are Plan 08.
- **Snapshots** (spec §8, §9, §16):
  - `slots[{ startAt, endAt, price }]`.
  - `addons` = `AddonLine[]`.
  - `currency`.
  - `policySnapshot { paymentPolicy, refundRules }`, taken from effective settings at creation.
- **Error mapping** in `errorHandler`:
  - `AddonQuoteError`: `addon_out_of_stock` → 409, others → 400, with `code = err.code` and `details { addonId }`.
  - `BookingQuoteError` → 400 with its code; `slot_taken` from the API is an `AppError` 409.
  - `InvalidMoneyError` → 400 `invalid_amount`.
- **Turf delete** with any booking (any status) → 409 `turf_has_bookings` "Deactivate the turf instead; it has bookings". Checked after `lockTurf`, so it conflicts with a concurrent `createBooking()`.

## Not in this plan

- Stripe payment for holds, payment links, webhooks and late payments: Plan 08.
- Cancellation by anyone, refund rules and refund preview: Plan 09.
- Jobs (hold expiry, pending auto-reject, auto-complete, reminders) and notifications: Plan 10. The lazy expiry above stays as a safety net.
- Closures or overrides created over existing bookings do not cancel them. Staff resolve those by hand (Plan 13 shows the conflict).
- Deferred Plan 06 minors (no-op PUT logs, `updatedAt` bumps, `catalogue.ts:33` non-null assertion): not folded in.

## Review Focus

1. **Same slot, concurrently.** Two `POST` creates for the same slot (and an overlapping pair: 18:00+19:00 against 19:00+20:00) → statuses `[201, 409]`, one booking and its locks only. (Task 5 tests.)
2. **Guest at an advance venue.** The venue stores `guestBooking.allowed: true` but `paymentPolicy: partial_percent 20` → guest create 403 `guest_booking_disabled`; the quote response says `guestAllowed: false`. (Task 6 tests.)
3. **Midnight and DST.** Night session 18:00–02:00: booking 23:00 + 00:00 → one booking with `businessDate` D, and the next day's grid does not re-offer 00:00. On Europe/London's fall-back night (2026-10-25), two consecutive slots across 01:00 → two locks with different `startAt` instants, and `per_hour` add-on minutes equal to the real elapsed time. (Task 5 tests.)
4. **Tenancy.** Owner B's booking id, a booking at a venue outside a manager's scope, and a malformed id → 404 with an identical body, on detail, confirm, check-in and cash. (Task 7 tests.)
5. **Odd currencies.** A zero-decimal venue (JPY) total 1005 at 33.33% → advance 335; a three-decimal venue (KWD) total 12345 at 12.5% → 1543; `partial_fixed` 5000 on a total of 3000 → 3000. (Task 3 tests.)

---

## File Structure

```
packages/shared/src/
  statuses.ts    # MODIFY: SLOT_HOLDING_STATUSES adds completed, no_show
  addons.ts      # MODIFY: addonLineTotal input guards
  booking.ts     # transitions, BookingQuoteError, pickSlots, advanceFor, initialStatus, paymentStatusFor, quoteBooking
  index.ts       # MODIFY: export booking
apps/api/src/
  errors.ts                         # MODIFY: map AddonQuoteError, BookingQuoteError, InvalidMoneyError
  auth/requireAuth.ts               # MODIFY: optionalAuth()
  schedule/routes/overrides.ts      # MODIFY: reject mapped end > 2880
  schedule/routes/closures.ts       # MODIFY: lock turf/venue in create
  schedule/load.ts                  # MODIFY: taken from bookings
  addons/routes/assignments.ts      # MODIFY: lock turf/venue in PUT
  venues/routes/turfs.ts            # MODIFY: DELETE lockTurf + turf_has_bookings
  venues/routes/venues.ts           # MODIFY: DELETE lockVenue
  bookings/booking.model.ts         # Booking, bookingJson, holdingFilter()
  bookings/slotLock.model.ts        # SlotLock
  bookings/payment.model.ts         # Payment
  bookings/reference.ts             # newReference()
  bookings/create.ts                # createBooking(), quoteFor()
  bookings/transition.ts            # transition()
  bookings/routes/public.ts         # quote, create, otp, lookup, /me/bookings
  bookings/routes/owner.ts          # list, detail, walk-in, confirm, reject, check-in, no-show, cash
  app.ts, tenancy/routes/owner.ts   # MODIFY: mount routers
apps/api/test/
  schedule/carryover.test.ts
  bookings/create.test.ts
  bookings/public.test.ts
  bookings/owner.test.ts
packages/shared/test/booking.test.ts
```

---

### Task 1: Carry-over guards (override D+2 reach, add-on BigInt input)

**Files:**
- Modify: `apps/api/src/schedule/routes/overrides.ts` (`checkExtra`), `packages/shared/src/addons.ts` (`addonLineTotal`)
- Test: `apps/api/test/schedule/overrides.test.ts`, `packages/shared/test/addons.test.ts`

**Interfaces:**
- Consumes: Plan 05 `overrideMinutes`, `checkExtra`.
- Produces:
  - `checkExtra` throws `AppError(400, 'override_too_long', 'An extra slot must end by the end of the next day')` when any weekday's mapped `mine[1] > 2880`.
  - `addonLineTotal` calls `assertMinor(unitPrice)` first, then requires `Number.isSafeInteger(quantity) && quantity >= 1` and `Number.isSafeInteger(minutes) && minutes >= 0`. A bad quantity or minutes throws `RangeError('Add-on quantity and minutes must be whole numbers')`, raised before any `BigInt` call.

- [ ] **Step 1: Write failing tests**
  - `overrides.test.ts › rejects an extra reaching two days ahead`: turf hours 18:00–06:00 every day; POST add `{ start: '05:00', end: '04:00' }` (mapped 1740 → 3120) → 400 `override_too_long`. An add `{ start: '02:00', end: '05:00' }` (mapped end 1740) is unaffected and passes.
  - `addons.test.ts › guards inputs`:
    - `addonLineTotal('per_hour', 10.5, 1, 60)` throws `InvalidMoneyError`.
    - `('per_hour', 1200, 1, 90.5)` and `('per_unit', 150, 1.5, 60)` throw `RangeError` with the message above.
    - `('per_unit', 150, 0, 60)` throws.
    - Existing totals are unchanged.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/schedule/overrides.test.ts` and `node_modules/.bin/pnpm --filter @booking/shared exec vitest run test/addons.test.ts`. Expected: FAIL; the new cases get 201 and a native BigInt `RangeError` message.
- [ ] **Step 3: Implement** both guards.
- [ ] **Step 4: Run** both files. Expected: PASS.
- [ ] **Step 5: Commit**: `fix: reject overrides reaching day D+2, guard add-on totals against non-integers`

---

### Task 2: Carry-over locks against orphan rows

**Files:**
- Modify: `apps/api/src/schedule/routes/closures.ts` (POST), `apps/api/src/addons/routes/assignments.ts` (`put()`), `apps/api/src/venues/routes/turfs.ts` (DELETE), `apps/api/src/venues/routes/venues.ts` (DELETE)
- Test: `apps/api/test/schedule/carryover.test.ts`

**Interfaces:**
- Consumes: `lockTurf`, `lockVenue` (`venues/guards.ts`).
- Produces (no new exports), each inside the existing transaction and before any write:
  - Closure POST: turf-level → `lockTurf`; venue-level → `lockVenue`; owner-level → no lock.
  - Assignment `put()`: after `lockAddon`, turf-level → `lockTurf`; venue-level → `lockVenue`.
  - Turf DELETE: `lockTurf` after `lockVenue`.
  - Venue DELETE: `lockVenue` first.
  - When the target is already gone, the lock's 404 ("Turf not found" / "Venue not found") is the response.

- [ ] **Step 1: Write failing tests (`carryover.test.ts`)**. Each runs 10 rounds of `Promise.all` on a fresh turf or venue, and after each round asserts that no row points at a deleted target:
  - `closure create racing turf delete leaves no orphan`: when the turf is gone, `Closure.countDocuments({ ownerId, turfId })` is 0, and the closure POST got 201 (before the delete) or 404.
  - `turf assignment racing turf delete`: same, with `AddonAssignment`.
  - `venue closure racing venue delete`: venue with no turfs; same, with `Closure` `{ venueId }`.
  - `venue assignment racing venue delete`: same, with `AddonAssignment` `{ venueId, turfId: null }`.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/schedule/carryover.test.ts`. Expected: FAIL (an orphan appears in some round). If a run passes by luck, keep the test anyway and record that in the report.
- [ ] **Step 3: Implement** the locks.
- [ ] **Step 4: Run** the file, then `node_modules/.bin/pnpm --filter api test`. Expected: PASS.
- [ ] **Step 5: Commit**: `fix(api): lock turf/venue on closure, assignment and delete paths`

---

### Task 3: Shared booking rules

**Files:**
- Create: `packages/shared/src/booking.ts`, `packages/shared/test/booking.test.ts`
- Modify: `packages/shared/src/statuses.ts`, `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `ComputedSlot`, `DaySlots` (slots.ts); `OfferedAddon`, `AddonSelection`, `AddonLine`, `quoteAddons` (addons.ts); `PaymentPolicy` (settings.ts); `percentOf`, `assertMinor` (money.ts); `BookingStatus`, `PaymentStatus`.
- Produces:
  - `BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]>`, as in Decisions.
  - `canTransition(from: BookingStatus, to: BookingStatus): boolean`.
  - `SLOT_FREEING_STATUSES: readonly BookingStatus[] = ['rejected', 'cancelled', 'expired']`.
  - `MAX_SLOTS_PER_BOOKING = 12`.
  - `HOLD_MINUTES = 10`.
  - `class BookingQuoteError extends Error { code: 'no_slots' | 'too_many_slots' | 'duplicate_slot' | 'slot_unavailable' | 'slots_not_consecutive' | 'day_closed'; startAt: string | null }` with `name = 'BookingQuoteError'`.
  - `pickSlots(day: DaySlots, startAts: Date[], opts: { now: Date; allowInProgress: boolean }): ComputedSlot[]`, sorted. The order of checks: empty → `no_slots`; more than 12 → `too_many_slots`; duplicate → `duplicate_slot`; `day.closed` → `day_closed`; unmatched, null price or bad status → `slot_unavailable` (with `startAt`); gap → `slots_not_consecutive`.
  - `advanceFor(policy: PaymentPolicy, total: number): number`.
  - `initialStatus(input: { source: 'online' | 'walkin'; guest: boolean; advanceRequired: number }): 'awaiting_payment' | 'pending' | 'confirmed'`.
  - `paymentStatusFor(amountPaid: number, total: number): 'unpaid' | 'partially_paid' | 'paid'`.
  - `BookingQuote = { slots: { startAt: Date; endAt: Date; price: number }[]; addons: AddonLine[]; subtotal: number; addonsTotal: number; total: number; advanceRequired: number }`.
  - `quoteBooking(input: { slots: ComputedSlot[]; offered: OfferedAddon[]; indoor: boolean; selection: AddonSelection[]; inUse?: Record<string, number>; paymentPolicy: PaymentPolicy | null }): BookingQuote`. `paymentPolicy: null` means a walk-in (advance 0). `total` is checked with `assertMinor`.

- [ ] **Step 1: Write failing tests (`booking.test.ts`)**. Build days with a helper `day(slots: Partial<ComputedSlot>[])`.
  - `transitions`:
    - `canTransition('pending', 'confirmed')` is true;
    - `('confirmed', 'pending')`, `('completed', 'cancelled')` and `('rejected', 'confirmed')` are false;
    - every terminal status has `[]`.
  - `holding statuses`: `SLOT_HOLDING_STATUSES` equals the `BOOKING_STATUSES` minus `SLOT_FREEING_STATUSES`, and includes `completed` and `no_show`.
  - `pickSlots`:
    - 18:00 and 19:00 (60 min) → both, sorted, even when given reversed;
    - 18:00 + 20:00 → `slots_not_consecutive`;
    - a `pending` slot → `slot_unavailable` with its ISO `startAt`;
    - `price: null` → `slot_unavailable`;
    - 13 starts → `too_many_slots`;
    - `[]` → `no_slots`;
    - the same instant twice → `duplicate_slot`;
    - a closed day → `day_closed`;
    - a `past` slot with `endAt > now`: rejected with `allowInProgress: false`, accepted with `true`; with `endAt <= now`, rejected either way.
  - `advanceFor` (Review Focus 5):
    - `none` → 0;
    - `full`, 4200 → 4200;
    - `partial_percent` 33.33 of 1005 → 335;
    - 12.5 of 12345 → 1543;
    - `partial_fixed` 5000 of 3000 → 3000;
    - `partial_fixed` 500 of 3000 → 500.
  - `initialStatus`:
    - walk-in → `confirmed`;
    - guest with advance 0 → `pending`;
    - registered with advance 0 → `confirmed`;
    - registered with advance 840 → `awaiting_payment`.
  - `paymentStatusFor`: `(0, 1000)` → `unpaid`; `(400, 1000)` → `partially_paid`; `(1000, 1000)` → `paid`; `(0, 0)` → `paid`.
  - `quoteBooking`:
    - two slots at 1500 and 2000, add-on racket `per_unit` 150 ×2, policy `partial_percent` 20 → `subtotal` 3500, `addonsTotal` 300, `total` 3800, `advanceRequired` 760, and `slots` holds only `{ startAt, endAt, price }`;
    - the same with `paymentPolicy: null` → `advanceRequired` 0;
    - an `AddonQuoteError` from the selection propagates unchanged.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter @booking/shared exec vitest run test/booking.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `booking.ts`, update `SLOT_HOLDING_STATUSES` (keep its doc comment true), and export the module.
- [ ] **Step 4: Run** `node_modules/.bin/pnpm --filter @booking/shared test`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(shared): booking status machine, slot picking, advance and quoteBooking`

---

### Task 4: Booking, slot lock and payment models; error mapping

**Files:**
- Create: `apps/api/src/bookings/booking.model.ts`, `slotLock.model.ts`, `payment.model.ts`, `reference.ts`
- Modify: `apps/api/src/errors.ts`
- Test: `apps/api/test/bookings/models.test.ts`, `apps/api/test/errors.test.ts` (add cases if the file exists; else create it)

**Interfaces:**
- Consumes: Task 3 types and `BookingQuoteError`; `AddonQuoteError`; `InvalidMoneyError`; `tenantScoped`.
- Produces:
  - **`Booking`** (`tenantScoped`, timestamps, `minimize: false`):
    - `ownerId`, `venueId`, `turfId`, `reference` (unique, global);
    - `businessDate` (`YYYY-MM-DD`), `startAt` (first slot), `endAt` (last slot);
    - `slots [{ startAt, endAt, price }]`, `addons` (Mixed array of `AddonLine`), `currency`;
    - `subtotal`, `addonsTotal`, `total`, `advanceRequired`, `amountPaid` (default 0);
    - `status` (enum `BOOKING_STATUSES`), `paymentStatus` (enum `PAYMENT_STATUSES`);
    - `holdExpiresAt` (default null), `source` (`online` | `walkin`);
    - `playerId` (default null), `guest { name, phone }` (default null);
    - `policySnapshot { paymentPolicy, refundRules }`;
    - `createdBy` (default null), `rejectReason` (default null).
    - Indexes: `{ ownerId, turfId, startAt }`, `{ ownerId, venueId, businessDate }`, `{ ownerId, venueId, startAt, endAt }`, `{ playerId, startAt: -1 }`.
  - **`holdingFilter(now: Date)`**: `{ $or: [ { status: { $in: SLOT_HOLDING_STATUSES minus 'awaiting_payment' } }, { status: 'awaiting_payment', holdExpiresAt: { $gt: now } } ] }`.
  - **`bookingJson(b)`**:
    - `id, reference, venueId, turfId, businessDate`;
    - `slots` (ISO strings), `addons`, `currency`;
    - `subtotal, addonsTotal, total, advanceRequired, amountPaid`;
    - `status, paymentStatus, holdExpiresAt`;
    - `source, playerId, guest, rejectReason, createdAt`.
  - **`SlotLock`** (`tenantScoped`, timestamps): `ownerId, turfId, startAt, bookingId`. Unique index `{ turfId: 1, startAt: 1 }`; index `{ bookingId: 1 }`.
  - **`Payment`** (`tenantScoped`, timestamps): `ownerId, venueId, bookingId`, `gateway` (null), `gatewayAccountId` (null), `method` (`card` | `cash` | `wallet`), `amount`, `currency`, `status` (`succeeded` | `pending` | `failed`), `gatewayRef` (null), `recordedBy` (null).
  - **`newReference(): string`**: 8 Crockford base32 characters from `node:crypto` `randomInt`.
  - **`errorHandler`**: maps `AddonQuoteError`, `BookingQuoteError` (details `{ startAt }`) and `InvalidMoneyError` as in Decisions.

- [ ] **Step 1: Write failing tests**
  - `models.test.ts`:
    - two `SlotLock` rows with the same `{ turfId, startAt }` → second insert is a duplicate key;
    - the same `startAt` on another turf is fine;
    - `holdingFilter(now)` matches `confirmed` and `completed`, matches `awaiting_payment` with `holdExpiresAt` 1 min ahead, and does not match one 1 min behind or `cancelled`;
    - `newReference()` matches `/^[0-9A-HJKMNP-TV-Z]{8}$/`, and 1000 calls are all distinct;
    - `bookingJson` contains no `ownerId` or `policySnapshot`.
  - `errors.test.ts`: a route throwing `new AddonQuoteError('addon_out_of_stock', 'x')` → 409 `{ code: 'addon_out_of_stock', details: { addonId: 'x' } }`; `addon_unavailable` → 400; `BookingQuoteError('slots_not_consecutive')` → 400; `InvalidMoneyError` → 400 `invalid_amount`.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/bookings/models.test.ts test/errors.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(api): booking, slot lock and payment models; map quote errors`

---

### Task 5: `createBooking()` and slot status

**Files:**
- Create: `apps/api/src/bookings/create.ts`
- Modify: `apps/api/src/schedule/load.ts`
- Test: `apps/api/test/bookings/create.test.ts`, `apps/api/test/schedule/slots.test.ts` (one case)

**Interfaces:**
- Consumes: Task 3 `pickSlots`, `quoteBooking`, `initialStatus`, `paymentStatusFor`, `HOLD_MINUTES`; Task 4 models, `holdingFilter`, `newReference`; `loadDay`, `inWindow`; `offeredAddons`; `lockTurf`, `lockAddon`; `runInTransaction`, `isDuplicateKeyError`.
- Produces:
  - **`quoteFor(input: { venue: VenueDoc; turf: TurfDoc; date: string; startAts: Date[]; selection: AddonSelection[]; source: 'online' | 'walkin'; now: Date }): Promise<{ quote: BookingQuote; settings: EffectiveSettings; picked: ComputedSlot[] }>`**
    - Runs `loadDay`. Outside the window → `AppError(400, 'outside_window', 'That date cannot be booked yet')`.
    - Then `pickSlots` (`allowInProgress` = walk-in), and the `inUse` computed outside a transaction (a preview only).
    - Then `quoteBooking` with `paymentPolicy` = `settings.paymentPolicy` online, `null` for walk-ins.
  - **`createBooking(input: { venue; turf; date; startAts; selection; source; now; who: { playerId: string | null; guest: { name: string; phone: string } | null; createdBy: string | null }; cash?: { amount: number; recordedBy: string } }): Promise<BookingDoc>`**
    - First calls `quoteFor` outside the transaction to fail fast.
    - Then, in one `runInTransaction`, in order:
      1. `lockTurf`;
      2. expire stale holds overlapping the range (status → `expired`, delete their locks);
      3. overlap check (any holding booking on the turf overlapping the range) → 409 `slot_taken` "That slot was just booked";
      4. `lockAddon` on each selected add-on whose offered stock is non-null;
      5. compute `inUse` with `holdingFilter`;
      6. re-run `quoteBooking` with it;
      7. `initialStatus`;
      8. insert the booking (retry `reference` up to 5 times on a duplicate);
      9. insert the `SlotLock`s;
      10. insert the cash `Payment` when `cash` is given (amount 1..total, else `InvalidMoneyError`), and set `amountPaid`/`paymentStatus`.
    - A duplicate key on `slotLocks` → 409 `slot_taken`.
    - The hold is `holdExpiresAt = now + HOLD_MINUTES` for `awaiting_payment`.
    - It never calls `logActivity`; routes do that for staff.
  - **`loadDay`** passes `taken` to `computeSlots`: every slot of the turf's bookings matching `holdingFilter(now)` within the day's span, with status `confirmed`/`completed`/`no_show` → `'booked'` and `pending`/`awaiting_payment` → `'pending'`. The "Plan 07 adds `taken`" comment is removed.
  - **`offeredAddons`** is unchanged; stock in use is only computed in `create.ts`.

- [ ] **Step 1: Write failing tests (`create.test.ts`)**. Call the service directly. Use a seeded turf with `pricing { base: 1500, rules: [] }`, hours 08:00–23:00, `bookingWindowDays` 365, and the clock at 2026-01-01.
  - `registered player at a no-advance venue is confirmed`:
    - two slots → status `confirmed`, `paymentStatus` `unpaid`;
    - `slots` prices 1500 each, `total` 3000, `businessDate` matches;
    - 2 `SlotLock` rows;
    - `policySnapshot.paymentPolicy.type` is `none`.
  - `advance venue makes a 10-minute hold`:
    - policy `partial_percent` 20 → `awaiting_payment`, `advanceRequired` 600, `holdExpiresAt` = now + 10 min;
    - the grid shows that slot `pending`;
    - after `clock.advance(11 min)` the grid shows `available`;
    - a second booking of it succeeds, and the first is now `expired` with no locks.
  - `guest starts pending`: `who.guest` set → `pending`, and the grid shows `pending`.
  - `concurrent same slot` (Review Focus 1):
    - `Promise.all` of two `createBooking` calls for 18:00 → one fulfilled, one rejected with `AppError` 409 `slot_taken`;
    - `Booking.countDocuments` is 1 and `SlotLock.countDocuments` is 1;
    - overlapping pair 18:00+19:00 vs 19:00+20:00 → same outcome, 2 locks.
  - `overlap with an off-grid booking`: insert a confirmed booking 18:30–19:30 directly (with its lock), then book 18:00 → 409 `slot_taken`.
  - `stock across turfs`:
    - racket stock 1, enabled at the venue; T1 books 18:00 with racket ×1 → ok;
    - T2 books 18:00 with racket → `AddonQuoteError` `addon_out_of_stock`;
    - T2 at 20:00 → ok;
    - concurrent T1/T2 for 21:00 each with racket → exactly one gets `addon_out_of_stock`.
  - `walk-in`:
    - source `walkin` at a `full`-policy venue → `confirmed`, `advanceRequired` 0;
    - with `cash { amount: 3000 }` → one `Payment` `{ method: 'cash', status: 'succeeded', amount: 3000 }`, `amountPaid` 3000, `paid`;
    - cash 1000 → `partially_paid`; cash 0 or 3001 → `InvalidMoneyError`, and nothing is inserted;
    - a slot that started 20 min ago is accepted for a walk-in and refused online (`slot_unavailable`).
  - `midnight` (Review Focus 3): hours 18:00–02:00; book 23:00 + 00:00 of D → succeeds, `businessDate` D; `loadDay(D+1)` has no 00:00 slot.
  - `DST fall-back` (Review Focus 3):
    - venue `Europe/London`, hours 00:00–04:00 on 2026-10-25, clock at 2026-10-20;
    - book the two consecutive slots from `loadDay` that cover 01:00 BST and 01:00 GMT → 2 locks with distinct `startAt`;
    - a `per_hour` add-on line has `minutes` equal to `(endAt − startAt)` summed.
  - `outside window or closed`: date beyond `bookingWindowDays` → 400 `outside_window`; a day with a venue closure → `BookingQuoteError` `day_closed`.
  - `slots.test.ts › shows pending and booked`: one confirmed booking and one pending booking → the owner and public grids show `booked` and `pending` for those slots, and `available` elsewhere.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/bookings/create.test.ts test/schedule/slots.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `create.ts` and the `loadDay` change.
- [ ] **Step 4: Run** the files, then `node_modules/.bin/pnpm --filter api test`. Expected: PASS. A MongoMemoryServer "Port already in use" failure is a known flake; rerun.
- [ ] **Step 5: Commit**: `feat(api): createBooking with slot locks, holds, stock and slot status`

---

### Task 6: Public booking routes

**Files:**
- Create: `apps/api/src/bookings/routes/public.ts`
- Modify: `apps/api/src/auth/requireAuth.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/bookings/public.test.ts`

**Interfaces:**
- Consumes: Task 5 `quoteFor`, `createBooking`; Task 4 `bookingJson`; `publicVenueBySlug`; `requestOtp`, `verifyOtp`; `normalizePhone`; `otpCodeSchema`, `nameSchema`; `requireAuth`.
- Produces:
  - **`optionalAuth(config, services): RequestHandler`**. With no `Authorization` header it calls `next()` and leaves `req.auth` unset. With a header it behaves exactly like `requireAuth`: a bad token → 401, never a silent guest.
  - **`publicBookingsRouter(config, services)`**, mounted on `api`. The turf lookup is the same as `publicSlots.ts` (published venue, active owner, active turf, else 404):
    - `POST /venues/:slug/turfs/:turfId/quote { date, startAts, addons? }` → 200 `{ quote: { currency, slots, addons, subtotal, addonsTotal, total, advanceRequired }, guestAllowed, guestOtpRequired }`. Instants go out as ISO strings. `guestAllowed` = `settings.guestBooking.allowed && advanceRequired === 0`.
    - `POST /venues/:slug/bookings/otp { phone }` → `requestOtp(normalizePhone(phone), 'guest_booking')` → 200 `{ expiresInSec, resendInSec }`. Guest booking disabled at the venue → 403 `guest_booking_disabled`.
    - `POST /venues/:slug/turfs/:turfId/bookings` (`optionalAuth`) `{ date, startAts, addons?, guest?: { name, phone, otpCode? } }`:
      - Signed in: `guest` is ignored (400 if present, `.strict()`), and the booking is made as `playerId = createdBy = userId`.
      - Not signed in: `guest` is required (else 401 `unauthenticated`), checked with the guest rules from Decisions, phone normalized.
      - → 201 `{ booking: bookingJson }`.
    - `GET /bookings/lookup?reference=&phone=` → 200 `{ booking }` when the reference matches and the normalized phone equals `guest.phone`; else 404 "Booking not found". Uses `crossTenant`.
    - `GET /me/bookings` (`requireAuth`) → `{ bookings }` with `playerId = userId`, newest `startAt` first, limit 100.
    - `GET /me/bookings/:bookingId` → 404 unless it is the user's booking.

- [ ] **Step 1: Write failing tests (`public.test.ts`)**. Use a published venue, active turf, priced 1500, hours 08:00–23:00, and the OTP code `123456` from `makeTestServices`.
  - `quote`: two slots plus towel → 200 with `total` 3050, `advanceRequired` 0, `guestAllowed: true`, `guestOtpRequired: true`; unknown slug, unpublished venue or inactive turf → 404.
  - `registered booking`: Bearer token → 201 `confirmed`, `playerId` = user; `GET /me/bookings` lists it; another user's `GET /me/bookings/:id` → 404; a bad token → 401 `invalid_token` (not treated as a guest).
  - `guest booking with OTP`:
    - request the OTP → SMS sent;
    - create with `otpCode: '123456'` → 201 `pending`, `guest.phone` in E.164, 8-character `reference`;
    - a wrong code → 400 `otp_invalid` and no booking;
    - no code while `requireOtp` → 400 `otp_required`;
    - `requireOtp: false` → no code needed.
  - `guest lookup`: the right reference and phone (in any accepted format) → 200; a wrong phone or unknown reference → 404 with an identical body.
  - `guest disabled` (Review Focus 2):
    - venue `paymentPolicy: partial_percent 20` with stored `guestBooking.allowed: true` → quote `guestAllowed: false`, guest create 403 `guest_booking_disabled`, OTP request 403;
    - `guestBooking.allowed: false` with no advance → 403;
    - a registered player at the same advance venue → 201 `awaiting_payment`.
  - `quote errors reach the client`: non-consecutive → 400 `slots_not_consecutive`; out of stock → 409 `addon_out_of_stock` with `details.addonId`; same slot twice concurrently over HTTP → `[201, 409]`, and the 409 code is `slot_taken`.
  - `validation`: 13 `startAts`, a bad date, a guest name of 0 or 101 characters, an extra key → 400 `validation_error`; a Russian guest name round-trips.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/bookings/public.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, mounting `publicBookingsRouter` beside `publicSlotsRouter`.
- [ ] **Step 4: Run** the file, then the api suite. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(api): public quote, booking, guest OTP and lookup routes`

---

### Task 7: Owner booking routes, walk-ins, cash, turf delete guard

**Files:**
- Create: `apps/api/src/bookings/transition.ts`, `apps/api/src/bookings/routes/owner.ts`
- Modify: `apps/api/src/tenancy/routes/owner.ts`, `apps/api/src/venues/routes/turfs.ts` (DELETE)
- Test: `apps/api/test/bookings/owner.test.ts`, `apps/api/test/venues/turfs.test.ts` (one case)

**Interfaces:**
- Consumes: Task 3 `canTransition`, `SLOT_FREEING_STATUSES`, `paymentStatusFor`; Task 4 models and `bookingJson`; Task 5 `createBooking`; `requirePermission`, `tenantOf`, `tenantRepo`, `scopedTurf`, `logActivity`, `runInTransaction`.
- Produces:
  - **`scopedBooking(t, bookingId): Promise<BookingDoc>`**: a malformed id, another owner or a venue outside scope → `AppError(404, 'not_found', 'Booking not found')`. Uses `tenantRepo(Booking, t, { venueField: 'venueId' })`.
  - **`transition(t, booking, to, at, session, extra?: Record<string, unknown>): Promise<BookingDoc>`**:
    - `canTransition` false, or the conditional update matching nothing → 409 `invalid_transition` "This booking is already <status>";
    - deletes the locks when `to` is a freeing status;
    - logs `booking.<to>` with `before { status }` and `after { status, ...extra }`.
  - **`ownerBookingsRouter(services)`** on `ownerRouter`:
    - `GET /bookings?venueId&turfId&from&to&status` (`booking.view`): `from`/`to` are business dates (with `venueId`, each defaults to today in that venue's timezone; without `venueId`, both are required, else 400 `validation_error`), the span is at most 31 days, results are limited to the member's scope and sorted by `startAt`, limit 500 → `{ bookings }`.
    - `GET /bookings/:bookingId` (`booking.view`) → `{ booking, payments }`.
    - `POST /venues/:venueId/turfs/:turfId/bookings` (`booking.create`), walk-in body as in Decisions:
      - `customer.playerId` must be an existing user, else 400 `player_not_found`;
      - logs `booking.create` (`after { reference, status, total }`) and, with cash, `payment.cash`;
      - the log is written in a follow-up transaction that uses the returned booking (`createBooking` owns its own transaction) → 201 `{ booking }`.
    - `POST /bookings/:bookingId/confirm` (`booking.confirm`): pending → confirmed.
    - `POST /bookings/:bookingId/reject` (`booking.confirm`) `{ reason? }`: pending → rejected, sets `rejectReason`.
    - `POST /bookings/:bookingId/check-in` (`booking.checkin`): confirmed → completed; `now < startAt − 60 min` → 409 `too_early`.
    - `POST /bookings/:bookingId/no-show` (`booking.checkin`): confirmed → no_show; `now < startAt` → 409 `too_early`.
    - `POST /bookings/:bookingId/payments/cash` (`payment.mark_cash`) `{ amount? }`: as in Decisions, in one transaction with a conditional `$inc` on `amountPaid` guarded by `amountPaid: <read value>` (a race → 409 `invalid_transition`) → 201 `{ booking, payment }`.
  - **Turf DELETE**: after `lockTurf` (Task 2), `Booking.exists({ ownerId, turfId })` → 409 `turf_has_bookings`; the "Plan 07 must refuse" comment is removed.

- [ ] **Step 1: Write failing tests (`owner.test.ts`)**
  - `walk-in with cash`:
    - staff POST with `payment { method: 'cash' }` → 201 `confirmed`, `paid`;
    - `GET /bookings/:id` returns one cash payment with `recordedBy` = staff;
    - activity rows `booking.create` and `payment.cash` with `actorId` = staff;
    - `customer.playerId` of an unknown user → 400 `player_not_found`;
    - with a real user → the booking appears in that user's `/me/bookings`.
  - `walk-in unpaid, then cash later`:
    - `method: 'unpaid'` → `unpaid`;
    - cash 1000 of 3000 → `partially_paid`;
    - cash with no amount → 2000 recorded, `paid`;
    - cash again → 409 `already_paid`;
    - amount 0 or more than the remaining balance → 400 `invalid_amount`.
  - `confirm and reject a pending guest booking`:
    - confirm → `confirmed`, logged `booking.confirmed`;
    - confirm again → 409 `invalid_transition`;
    - another pending booking rejected with a reason → `rejected`, its locks are gone, and its slot is `available` in the public grid;
    - concurrent confirm + reject → one 200, one 409.
  - `check-in and no-show`:
    - check-in 2 h before start → 409 `too_early`; 30 min before → `completed`, and the slot still shows `booked`;
    - no-show before start → 409 `too_early`; after → `no_show`;
    - check-in of a `pending` booking → 409 `invalid_transition`.
  - `permissions`: staff confirm/reject → 403; staff check-in and cash → 200; staff walk-in → 201; the manager can confirm.
  - `list`:
    - two venues; a manager limited to V1 lists only V1 bookings;
    - `status=pending` filters; `from`/`to` spanning 32 days → 400;
    - sorted by `startAt`.
  - `tenancy` (Review Focus 4): owner B's booking id, a V2 booking for the V1-limited manager, and `not-an-id` → 404 with an identical body on `GET`, `confirm`, `check-in` and `payments/cash`.
  - `turfs.test.ts › refuses delete when the turf has bookings`: any booking (even `cancelled`) → 409 `turf_has_bookings`, and the turf remains; with no bookings the delete still works.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/bookings/owner.test.ts test/venues/turfs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, mounting `ownerBookingsRouter(services)` after `assignmentsRouter`.
- [ ] **Step 4: Run** `node_modules/.bin/pnpm test`, `node_modules/.bin/pnpm -r typecheck` and `node_modules/.bin/pnpm lint`. Expected: all PASS and clean.
- [ ] **Step 5: Commit**: `feat(api): owner booking actions, walk-ins, cash payments; refuse deleting booked turfs`
