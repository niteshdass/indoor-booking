# Cancellation & Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players, guests and staff can cancel bookings with a refund preview; refunds follow the booking's snapshotted tiered rules (staff cancel = 100%), go back through the gateway account that took the card payment or are recorded as cash by staff, and every refund (including Plan 08's late/duplicate ones) is two-phase and reconcilable.

**Architecture:** Pure refund maths lives in `@booking/shared`. A refund service in `apps/api/src/payments/refunds.ts` splits every refund into two phases: (1) inside the business transaction, `reserveRefunds` inserts `pending` Refund rows and reserves the money on the payment and booking; (2) after commit, `dispatchRefund` calls the gateway with a key derived from the Refund id and `settleRefund` records the outcome (a failed refund releases its reservation). `reconcileRefunds` re-dispatches card refunds left `pending`; Plan 10 schedules it. Plan 08's in-transaction gateway call in `applyEvent` moves onto this path, which closes the commit-after-refund window.

**Tech Stack:** Express 5, Mongoose 8 (replica-set transactions), Zod 3, Vitest + MongoMemoryReplSet, Stripe SDK (behind `StripeApi`, faked in tests by `makeFakeStripe`).

**Spec:** `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md` (§11 lifecycle, §12 cancellation and refunds, §14 payments architecture, §16 `refunds` data model). Roadmap row 09 in `docs/superpowers/plans/2026-10-23-roadmap.md`.

## Global Constraints

- Tiered rules: "if cancelled at least X before slot start, refund Y%"; otherwise no refund. Evaluated top-down by largest threshold; first match wins. (§12)
- Venue rules override owner rules — already resolved into `booking.policySnapshot.refundRules` at creation (`create.ts:233`); cancellation reads only the snapshot. (§12, §16)
- Owner/staff cancel refunds 100% of what was paid. (§12)
- Refund % applies to the amount actually paid (`amountPaid`), not the total. (§12)
- Stripe refunds are issued automatically through the gateway; cash refunds are recorded manually by staff. (§12)
- Refunds always go through the gateway + account that took the original payment. (§14)
- `cancelled` frees the slot; payment status values `refunded` / `partially_refunded` come into use. (§11)
- `refunds` row: `{ ownerId, bookingId, paymentId, amount, reason, ruleApplied, gatewayRef, by }`. (§16)
- Money is integer minor units; a computed refund is rounded **down** (`Math.floor`), so it never exceeds the percentage.
- Every owner-scoped query carries `ownerId` (tenantScoped plugin); cross-tenant reads use `.setOptions({ crossTenant: true })`.
- API only. No web UI in this plan (owner dashboard is Plan 13, player web Plan 12), so the CLAUDE.md UI rules don't apply here.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `node_modules/.bin/pnpm --filter api exec vitest run <files>`, `node_modules/.bin/pnpm --filter @booking/shared exec vitest run <files>`, whole suite `node_modules/.bin/pnpm test`, plus `node_modules/.bin/pnpm -r typecheck` and `node_modules/.bin/pnpm lint` before each commit.

## Review Focus

1. **A card payment taken on a Stripe account the owner has since replaced.** The old credentials are gone, so the refund can't be sent. Expected: the Refund ends `failed` with failureCode `account_changed`, the reservation is released, and staff can `record-cash`. It must not be sent through the new account, and it must not stay `pending` forever. Test in Task 4.
2. **A player cancels while their payment is mid-flight.** Expected: if Stripe refuses to cancel the intent (it already succeeded), answer 409 `payment_in_progress` and leave the booking unchanged. The webhook then confirms it as usual. The booking must never end `cancelled` with an untracked charge. Test in Task 6.
3. **Two cancels at once (player and staff), or a cancel racing a cash payment.** Expected: exactly one cancel wins; the loser gets 409; refunds are created once. A cash payment that commits first is included in the refundable amount. Test in Task 6.
4. **Rules stored unsorted, or the clock exactly on a threshold** (`hoursBefore === minHoursBefore`). Expected: the threshold counts as met, and order in storage doesn't matter. Test in Task 1.
5. **A refund whose result was lost, re-dispatched more than 24h later** (Stripe's idempotency key has expired). Expected: `findRefund` adopts the earlier refund and never sends a second one. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/refunds.ts` (new) | Pure maths: rule matching, cancellation amount, booking payment status after refunds |
| `apps/api/src/payments/refund.model.ts` | Refund schema: methods, reasons, rule, failure, dispatch bookkeeping |
| `apps/api/src/bookings/booking.model.ts` | `amountRefunded`, cancellation fields, `bookingJson` |
| `apps/api/src/payments/gateway.ts`, `stripe.ts` | `refund` gets `refundId`/declines; `findRefund`; `refund_updated` events |
| `apps/api/src/payments/refunds.ts` (new) | allocate, reserve, dispatch, settle, reconcile, `refundJson` |
| `apps/api/src/payments/apply.ts`, `routes/webhooks.ts` | Webhook refunds on the two-phase path; mismatch, duplicate tag, refund updates |
| `apps/api/src/bookings/cancel.ts` (new) | Preview and cancel, shared by all three callers |
| `apps/api/src/bookings/transition.ts` | Actor may be a player or nobody (guest) |
| `apps/api/src/bookings/routes/owner.ts`, `routes/public.ts`, `payments/routes/refunds.ts` (new) | Endpoints |

---

### Task 1: Refund maths in `@booking/shared`

**Files:**
- Create: `packages/shared/src/refunds.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Test: `packages/shared/test/refunds.test.ts`

**Interfaces:**
- Consumes: `RefundRule = { minHoursBefore: number; percent: number }` (`settings.ts:14`), `paymentStatusFor` (`booking.ts:98`), `PaymentStatus` (`statuses.ts`).
- Produces:
  - `matchRefundRule(rules: readonly RefundRule[], startAt: Date, now: Date): RefundRule | null`
  - `cancellationRefund(input: { rules: readonly RefundRule[]; startAt: Date; now: Date; refundable: number; byStaff: boolean }): { percent: number; amount: number; rule: RefundRule | null }`
  - `bookingPaymentStatus(amountPaid: number, amountRefunded: number, total: number): PaymentStatus`

- [ ] **Step 1: Write the failing tests** in `packages/shared/test/refunds.test.ts`. Use the spec's example rules: `[{minHoursBefore:96,percent:100},{minHoursBefore:72,percent:40},{minHoursBefore:48,percent:20}]`. Fix `startAt = 2026-11-10T18:00:00Z`.
  - `matchRefundRule`:
    - 100 h before gives the 96 rule;
    - 80 h gives the 72 rule;
    - exactly 72 h gives the 72 rule (threshold inclusive);
    - 47 h gives `null`;
    - after `startAt` (negative hours) gives `null`;
    - the same rules passed in shuffled order give the same answers;
    - `[]` gives `null`.
  - `cancellationRefund`:
    - with `refundable: 5000` at 80 h: `{ percent: 40, amount: 2000, rule: {72,40} }`;
    - with `refundable: 999` at 50 h (20%): amount `199` (floor of 199.8);
    - `byStaff: true` at 1 h with `[]` rules: `{ percent: 100, amount: refundable, rule: null }`;
    - `refundable: 0`: amount `0`.
  - `bookingPaymentStatus`:
    - `(5000, 0, 5000)` gives `'paid'`;
    - `(2000, 0, 5000)` gives `'partially_paid'`;
    - `(5000, 2000, 5000)` gives `'partially_refunded'`;
    - `(5000, 5000, 5000)` gives `'refunded'`;
    - `(0, 0, 5000)` gives `'unpaid'`.

- [ ] **Step 2: Run the tests and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter @booking/shared exec vitest run test/refunds.test.ts`
  Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement the three functions in `packages/shared/src/refunds.ts` and re-export them from `index.ts`.**
  - `matchRefundRule`:
    - computes `hoursBefore = (startAt - now) / 3_600_000`;
    - sorts a copy of the rules by `minHoursBefore` descending;
    - returns the first rule with `hoursBefore >= minHoursBefore`;
    - returns `null` when `hoursBefore < 0` or no rule matches.
  - `cancellationRefund`:
    - percent is `100` when `byStaff`, otherwise the matched rule's percent (or `0`);
    - amount is `Math.floor(refundable * percent / 100)`.
  - `bookingPaymentStatus`: if `amountRefunded > 0`, return `'refunded'` when `amountRefunded >= amountPaid`, otherwise `'partially_refunded'`. Else return `paymentStatusFor(amountPaid, total)`.

- [ ] **Step 4: Run the tests again.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/shared/src/refunds.ts packages/shared/src/index.ts packages/shared/test/refunds.test.ts
git commit -m "feat(shared): tiered refund rule matching and refunded payment status"
```

---

### Task 2: Refund and Booking model changes

**Files:**
- Modify: `apps/api/src/payments/refund.model.ts`
- Modify: `apps/api/src/bookings/booking.model.ts` (schema plus `bookingJson`, lines 83–107)
- Modify: `apps/api/src/bookings/payment.model.ts` (doc comment on `refundedAmount` only)
- Test: `apps/api/test/bookings/models.test.ts`

**Interfaces:**
- Produces:
  - `REFUND_REASONS = ['late_payment','duplicate_payment','amount_mismatch','cancellation'] as const` and `type RefundReason`
  - `type RuleApplied = { minHoursBefore: number | null; percent: number }`
  - `REFUND_METHODS = ['card','cash'] as const`
  - `type RefundDoc`
  - New Refund fields:

    | Field | Type | Notes |
    |---|---|---|
    | `method` | `'card' \| 'cash'` | Required. |
    | `gateway` | `string \| null` | Required when `method === 'card'`. |
    | `gatewayAccountId` | `string \| null` | Required when `method === 'card'`. |
    | `ruleApplied` | `{ minHoursBefore: number \| null; percent: number } \| null` | Null except for `cancellation`. `minHoursBefore` is null for a staff cancel. |
    | `failureCode` | `string \| null` | |
    | `attempts` | `number` | Default 0. |
    | `dispatchedAt` | `Date \| null` | |
    | `retryOf` | `ObjectId \| null` | |
    | `settledAt` | `Date \| null` | |

    Index `{ status: 1, method: 1, updatedAt: 1 }`, which reconcile uses.
  - New Booking fields:

    | Field | Type | Notes |
    |---|---|---|
    | `amountRefunded` | number | Default 0, min 0. |
    | `cancelledAt` | `Date \| null` | |
    | `cancelledBy` | `'player' \| 'guest' \| 'staff' \| null` | |
    | `cancelReason` | `string \| null` | |

    `bookingJson` adds `amountRefunded`, `cancelledAt` (ISO or null), `cancelledBy` and `cancelReason`.
  - Invariant, documented on `Payment.refundedAmount`: it is the sum of the payment's **non-failed** refunds, pending included (a reservation). `Booking.amountRefunded` is the same sum restricted to `reason: 'cancellation'`.

- [ ] **Step 1: Write the failing tests** in `models.test.ts`:
  - `'a cash refund needs no gateway'`: create `{ method:'cash', gateway:null, gatewayAccountId:null, reason:'cancellation', status:'pending', … }`. It saves.
  - `'a card refund needs its gateway and account'`: `method:'card'` with `gateway: null` rejects with a ValidationError on `gateway`.
  - `'refund reason must be known'`: `reason: 'manual'` is rejected.
  - `'a booking starts with nothing refunded'`: a new booking has `amountRefunded === 0` and `cancelledBy === null`.
  - `'bookingJson exposes the refund and cancellation fields'`: the keys are present with the values above.

- [ ] **Step 2: Run the tests and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/bookings/models.test.ts`
  Expected: the new tests FAIL.

- [ ] **Step 3: Implement the schema changes.**
  - `gateway` and `gatewayAccountId` use `required: function () { return this.method === 'card'; }` with `default: null`.
  - Export `RefundDoc = HydratedDocument<InferSchemaType<typeof refundSchema>>`, following the BookingDoc pattern.
  - Plan 08's `apply.ts` must still compile: pass `method: 'card'` there. Its behaviour changes in Task 5.

- [ ] **Step 4: Run all the API tests.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/bookings test/payments`
  Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): refund rows for cash and cancellations; booking refund fields`.

---

### Task 3: Gateway refund contract and Stripe adapter

**Files:**
- Modify: `apps/api/src/payments/gateway.ts`, `apps/api/src/payments/stripe.ts`, `apps/api/src/payments/routes/gateways.ts` (gateway JSON)
- Modify: `apps/api/test/helpers/testServices.ts` (fake Stripe)
- Test: `apps/api/test/payments/stripe.test.ts`, `apps/api/test/payments/gateways.test.ts`

**Interfaces:**
- Produces, in `gateway.ts`:
  - `refund(c, input: { gatewayRef: string; amount: number; idempotencyKey: string; refundId: string }): Promise<GatewayRefund>`
  - `findRefund(c, input: { gatewayRef: string; refundId: string }): Promise<GatewayRefund | null>`
  - `type GatewayRefund = { refundRef: string | null; status: 'pending' | 'succeeded' | 'failed'; failureCode: string | null }`
  - A new `GatewayEvent` member: `{ kind: 'refund_updated'; refundRef: string; status: 'pending' | 'succeeded' | 'failed'; failureCode: string | null }`.
- Produces, in `stripe.ts`:
  - `STRIPE_WEBHOOK_EVENTS`: the event types the owner must subscribe. The existing four (`payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `checkout.session.expired`), plus `refund.updated` and `refund.failed`.
  - The gateway JSON from `routes/gateways.ts` gains `webhookEvents: STRIPE_WEBHOOK_EVENTS`.
  - `StripeApi.refunds` gains:
    - `list(p: { payment_intent: string; limit: number }): Promise<{ data: { id: string; status: string | null; metadata: Record<string,string> | null; failure_reason?: string | null }[] }>`;
    - `create` params gain `metadata: { refundId: string }`.
- Produces, in the fake Stripe:
  - `refunds.create` stores refunds per payment intent;
  - `refunds.list` returns them;
  - `fail(method, kind)` gains kind `'invalid_request'` with an optional `code`, throwing a `Stripe.errors.StripeInvalidRequestError` with that code.

**Semantics**
- `refund`:
  - A `StripeInvalidRequestError` is a refusal that won't change on retry (`charge_already_refunded`, `amount_too_large`, …). It returns `{ refundRef: null, status: 'failed', failureCode: err.code ?? 'refund_declined' }`.
  - Every other error throws `GatewayError('gateway_error')` (retryable).
  - Status mapping is the same as today: `succeeded` stays `succeeded`; `failed` and `canceled` become `failed`; anything else becomes `pending`. `failureCode` is the refund's `failure_reason ?? null`.
- `findRefund`: lists up to 100 refunds of the intent and returns the one whose `metadata.refundId` matches, mapped the same way, or `null`. Errors throw `GatewayError('gateway_error')`.
- `handleWebhook`: `refund.updated` and `refund.failed` map to `refund_updated` from `event.data.object`.

- [ ] **Step 1: Write the failing tests** in `stripe.test.ts`:
  - `'sends the refund id as metadata'`: the fake's last `refunds.create` call has params `metadata.refundId`.
  - `'returns a declined refund as failed with its code'`: after `fail('refunds.create','invalid_request','charge_already_refunded')`, the result is `{ refundRef: null, status: 'failed', failureCode: 'charge_already_refunded' }`.
  - `'throws a gateway_error when Stripe is unreachable'`: kind `'api'` rejects with `GatewayError` code `gateway_error`.
  - `'finds an earlier refund by refund id'`: after a create with `refundId: 'r1'`, `findRefund(…,{refundId:'r1'})` returns its ref, and `'r2'` returns `null`.
  - `'normalizes refund.updated and refund.failed'`: build a signed event with `signedEvent`. The result is `{ kind: 'refund_updated', refundRef: 're_…', status }` for `succeeded` and for `failed` (with `failure_reason: 'expired_or_canceled_card'` giving that failureCode).

  In `gateways.test.ts`, the GET of the stripe gateway includes `webhookEvents` containing `'refund.updated'`.

- [ ] **Step 2: Run the tests and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/payments/stripe.test.ts test/payments/gateways.test.ts`
  Expected: the new tests FAIL.

- [ ] **Step 3: Implement the adapter, interface, fake and JSON changes above.** `apply.ts` still calls `refund`. Pass `refundId: String(row._id)` there for now; Task 5 replaces that code.

- [ ] **Step 4: Run all the payment tests.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/payments`
  Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): stripe refund lookup, declined refunds and refund webhooks`.

---

### Task 4: Two-phase refund service

**Files:**
- Create: `apps/api/src/payments/refunds.ts`
- Test: `apps/api/test/payments/refunds.test.ts`

**Interfaces:**
- Consumes:
  - Task 2's Refund fields;
  - Task 3's `refund`, `findRefund` and `GatewayRefund`;
  - `loadGateway(ownerId, key, config, services, session?)` (`gateway.model.ts:33`);
  - `bookingPaymentStatus` (Task 1);
  - `logSystemActivity` and `logActivity`.
- Produces:
  - `type RefundPart = { paymentId: unknown; method: 'card' | 'cash'; amount: number }`
  - `allocateRefund(payments: PaymentDoc[], amount: number): RefundPart[]`. It takes only `status: 'succeeded'` payments, each with room `amount - refundedAmount`. Card payments go first, newest `_id` first, then cash, newest first. If the payments can't cover `amount`, it throws `Error('Refund exceeds what was paid')`.
  - `reserveRefunds(input: { booking: BookingDoc; parts: RefundPart[]; reason: RefundReason; ruleApplied: RuleApplied | null; by: string | null; now: Date; currency?: string; retryOf?: unknown }, session: ClientSession): Promise<RefundDoc[]>`. `currency` overrides the payment's (mismatch only). A `cash` part against a card payment is how `record-cash` replaces a failed card refund.
  - `dispatchRefund(refundId: string, ownerId: string, deps: { config: Config; services: AppServices }): Promise<void>`
  - `settleRefund(ownerId: string, refundId: unknown, outcome: { status: 'pending' | 'succeeded' | 'failed'; gatewayRef?: string | null; failureCode?: string | null; allowFromSucceeded?: boolean }, now: Date, session: ClientSession, actor?: { ownerId: string; userId: string }): Promise<boolean>`. It returns whether it changed anything.
  - `reconcileRefunds(now: Date, deps): Promise<{ dispatched: number }>`
  - `refundJson(r: RefundDoc)` returns `{ id, paymentId, method, amount, currency, reason, ruleApplied, status, failureCode, retryOf, createdAt }`.
  - Constants: `RECONCILE_AFTER_MINUTES = 10`, `MAX_DISPATCH_ATTEMPTS = 12`.

**Semantics**
- `reserveRefunds`, which runs inside the caller's transaction:
  - creates one `pending` Refund per part. A card part takes `gateway`/`gatewayAccountId` from its payment; the currency is the payment's.
  - For each part, runs `Payment.updateOne({ _id, refundedAmount: <read value> }, { $inc: { refundedAmount: amount } })`. A miss throws, which aborts the transaction.
  - When the reason is `cancellation`, `$inc`s `booking.amountRefunded` by the total.
  - Logs `refund.created` (entity `refund`) per row: `logActivity` when `by` is set, else `logSystemActivity`.
- `dispatchRefund`, which runs after commit and never throws for gateway problems:
  1. Load the row. Skip it unless it is `method:'card'` and `status:'pending'`.
  2. `loadGateway`, ignoring `enabled` (refunds still flow on a disabled gateway). If the row is missing or `row.accountId !== refund.gatewayAccountId`, settle `failed` with `account_changed`. If there is no payment `gatewayRef`, settle `failed` with `no_charge`.
  3. If `dispatchedAt` is already set, call `findRefund` first and settle with what it finds.
  4. Otherwise set `dispatchedAt` and `$inc attempts`, then call `refund` with `idempotencyKey: 'refund_' + refundId`.
  5. On a `GatewayError`, leave the row `pending`. If `attempts >= MAX_DISPATCH_ATTEMPTS`, settle `failed` with `gateway_unreachable` instead.
  6. Otherwise settle with the result: `pending` keeps the row pending but stores `gatewayRef`.
- `settleRefund`:
  - Updates only `{ _id, status: 'pending' }`, and sets `status`, `gatewayRef`, `failureCode` and `settledAt` (`settledAt` only when terminal).
  - On `failed`, releases the reservation: `$inc` `payment.refundedAmount` by `-amount`, and for `cancellation` also `booking.amountRefunded` by `-amount`. It then recomputes `booking.paymentStatus` with `bookingPaymentStatus`.
  - On a terminal status, logs `refund.<status>`.
  - Opens no transaction of its own: callers wrap it in `runInTransaction`.
- `reconcileRefunds`:
  - Runs a cross-tenant query for `{ method:'card', status:'pending', updatedAt: { $lte: now - 10 min } }`, limit 100.
  - Calls `dispatchRefund` for each row.

- [ ] **Step 1: Write the failing tests** in `refunds.test.ts`. Use `startTestDb` and `makeTestServices`, seeding with the existing helpers in `test/helpers/venues.ts` and `connectStripe`.
  - `allocateRefund`:
    - `'takes card before cash, newest first'`: card 3000, cash 2000 (older), card 1000 (newest), allocating 3500, gives `[card1000:1000, card3000:2500]`.
    - `'skips failed payments and already-refunded room'`.
    - `'throws when payments cannot cover the amount'`.
  - `'reserve then dispatch refunds through the gateway once'`:
    - status is `succeeded`, with `gatewayRef` set;
    - `payment.refundedAmount` and `booking.amountRefunded` equal the amount;
    - the fake shows exactly one `refunds.create` with idempotencyKey `refund_<id>`;
    - a second `dispatchRefund` makes no call.
  - `'a declined refund fails and releases the reservation'`: with `refundStatus = 'failed'`, the row is `failed` and both sums are back to 0. `paymentStatus` is recomputed.
  - `'a gateway outage leaves the refund pending for reconcile'`: after `fail('refunds.create','api')`, the row is `pending` with `attempts: 1`. Then advance the clock 11 minutes and run `reconcileRefunds`. The row is `succeeded` and the fake shows one `refunds.list` before the second create.
  - `'adopts an earlier refund instead of refunding twice'`, for Review Focus 5. Dispatch once (succeeded at the fake), then manually reset the row to `pending` with the old `dispatchedAt`. Run `reconcileRefunds` with the clock 25 h on. The row is `succeeded` with the original `gatewayRef`, and the fake has exactly one `refunds.create` in total.
  - `'fails a refund whose account was replaced'`, for Review Focus 1. Reserve, then `connectStripe` again with a new secret key (the fake gives a new account id), then dispatch. The row is `failed` with `failureCode: 'account_changed'`, there is no `refunds.create` with either key, and the reservation is released.
  - `'gives up after MAX_DISPATCH_ATTEMPTS'`: the row is `failed` with `gateway_unreachable`.
  - `'cash refunds are never dispatched'`.

- [ ] **Step 2: Run the tests and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/payments/refunds.test.ts`
  Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `payments/refunds.ts` per the Semantics above.**

- [ ] **Step 4: Run the tests again.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): two-phase refund service with reconciliation`.

---

### Task 5: Webhook refunds on the two-phase path, plus Plan 08 carry-overs

**Files:**
- Modify: `apps/api/src/payments/apply.ts`, `apps/api/src/payments/routes/webhooks.ts`, `apps/api/src/payments/webhookEvent.model.ts` (only if the outcome enum needs `refund_updated` handling; reuse `'applied'`/`'ignored'`)
- Test: `apps/api/test/payments/late.test.ts`, `apps/api/test/payments/webhooks.test.ts`

**Interfaces:**
- Consumes: `reserveRefunds`, `dispatchRefund` and `settleRefund` (Task 4), and the `refund_updated` event (Task 3).
- Produces: `applyEvent(ownerId, event, ctx, session): Promise<{ outcome: WebhookOutcome; refundIds: string[] }>`. `ApplyContext` drops `creds` and `gateway`, since nothing in the transaction calls the gateway any more; it keeps `now`.

**Changes**
1. `refund(s)` no longer calls the gateway.
   - It keeps the expire-and-free step and marks the payment `succeeded` with `gatewayRef`.
   - It then calls `reserveRefunds` with a single card part of `event.amount`, `by: null` and `ruleApplied: null`, and returns its id.
   - The `payment.refund` activity row and the `ActivityLog.updateOne` patch go, because `refund.created` and `refund.<status>` replace them.
   - Because the payment is `succeeded` with `refundedAmount` reserved, `allocateRefund` never offers it again.
2. **Duplicate tag (carry-over):** reason is `duplicate_payment` when the booking status is in `['confirmed','completed','no_show']`, and `late_payment` otherwise.
3. **Mismatch (carry-over):**
   - Instead of returning early with no record, set the payment to `failed` with failureCode `amount_mismatch` and `gatewayRef`.
   - Reserve a card refund of `event.amount` with `reason: 'amount_mismatch'` and `currency: event.currency`. `reserveRefunds` takes a currency override for this one case.
   - Log `payment.mismatch` with `{ expected: {amount, currency}, received: {amount, currency} }`.
   - The outcome stays `'mismatch'`.
4. `refund_updated`:
   - Find the Refund by `{ ownerId, gatewayRef: event.refundRef }`. If none, the outcome is `'unmatched'`.
   - Otherwise call `settleRefund`.
   - A `refund.failed` arriving for a row already `succeeded` is a reversal. Pass `allowFromSucceeded: true` (Task 4 signature; only this path sets it): the row moves `succeeded → failed` and the reservation is released.
   - The outcome is `'applied'` when the row changed, otherwise `'ignored'`.
5. `webhooks.ts`:
   - `runInTransaction` returns `refundIds` from the callback.
   - After commit, `await dispatchRefund(id, ownerId, { config, services })` for each id.
   - Always answer `200 { received: true }` once committed. A refund outage is reconcile's job, no longer Stripe's retry.

**Commit-after-refund window (carry-over), ruled closed by design.** The gateway is called only after the payment is committed as `succeeded`. A redelivered event therefore finds no `pending` payment and is `ignored`, so it can't revive a booking whose money is already on its way back. **>24h key expiry (carry-over):** handled by Task 4's `findRefund`-before-retry.

- [ ] **Step 1: Update and add tests.**
  - In `late.test.ts`, replace `'answers 500 on a Stripe refund error and refunds once on redelivery'` with `'answers 200 on a Stripe refund error and leaves the refund pending for reconcile'`. Assert:
    - the response is 200;
    - the Refund is `pending`;
    - the booking is `expired`;
    - a redelivery is `ignored` with no new `refunds.create`;
    - `reconcileRefunds` 11 minutes later gives `succeeded`.
  - Replace `'calls the gateway only after every database write'` with `'calls the gateway only after the webhook transaction commits'`. Make the fake's `refunds.create` read the Refund row with no session (committed data only), and assert that it exists with status `pending`.
  - Keep `'records a refund the gateway declines and does not retry it'`. Its activity assertions now read `refund.failed`.
  - New tests:
    - `'tags a payment on a completed booking as duplicate_payment'`;
    - the same for `no_show`;
    - `'refunds a mismatched payment and logs it'`: the payment is `failed`/`amount_mismatch`, a Refund with `amount_mismatch` for the received amount and currency is `succeeded`, and there is a `payment.mismatch` activity row;
    - `'refund.failed on a succeeded refund reverses it'`: the row is `failed` and `payment.refundedAmount` is back to 0;
    - `'refund.updated for an unknown refund is unmatched'`.

  In `webhooks.test.ts`, update any assertion on `ApplyContext`/`applyEvent` return shape.

- [ ] **Step 2: Run the tests and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/payments/late.test.ts test/payments/webhooks.test.ts`
  Expected: the changed and new tests FAIL.

- [ ] **Step 3: Implement the changes above.**

- [ ] **Step 4: Run all the payment tests.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/payments`
  Expected: PASS.

- [ ] **Step 5: Commit.** Message: `refactor(api): webhook refunds after commit; tag duplicates and refund mismatches`.

---

### Task 6: Cancel service

**Files:**
- Create: `apps/api/src/bookings/cancel.ts`
- Modify: `apps/api/src/bookings/transition.ts`
- Test: `apps/api/test/bookings/cancel.test.ts`

**Interfaces:**
- Consumes:
  - `cancellationRefund` (Task 1);
  - `allocateRefund`, `reserveRefunds` and `dispatchRefund` (Task 4);
  - `loadGateway`;
  - `gateway.cancelPayment`.
- Produces:
  - `transition(actor: Actor, booking, to, at, session, extra)`, where `type Actor = { ownerId: string; userId: string | null }`. `TenantContext` already satisfies it. When `userId` is null, it logs with `logSystemActivity`.
  - `type Canceller = { kind: 'player'; ownerId: string; userId: string } | { kind: 'guest'; ownerId: string } | { kind: 'staff'; t: TenantContext }`
  - `type CancellationPreview = { percent: number; amount: number; rule: RefundRule | null; amountPaid: number; amountRefunded: number; currency: string; card: number; cash: number }`
  - `previewCancellation(booking: BookingDoc, by: Canceller['kind'], now: Date): Promise<CancellationPreview>`. It throws the same errors as `cancelBooking` would.
  - `cancelBooking(booking: BookingDoc, by: Canceller, input: { reason?: string }, deps: { config: Config; services: AppServices }): Promise<{ booking: BookingDoc; refunds: RefundDoc[] }>`
  - Errors, all 409:

    | Code | When |
    |---|---|
    | `invalid_transition` | The status is not `awaiting_payment`, `pending` or `confirmed`. |
    | `too_late` | Message "This booking has already started". A player or guest cancelling at `now >= startAt`. Staff may cancel at any time. |
    | `payment_in_progress` | The intent or link cancel was refused. |

**Algorithm**

`refundable = booking.amountPaid - booking.amountRefunded`. The refund comes from `cancellationRefund({ rules: booking.policySnapshot.refundRules, startAt: booking.startAt, now, refundable, byStaff: kind === 'staff' })`. The preview's `card` and `cash` are the method sums of `allocateRefund(payments, amount)`.

`cancelBooking` runs these steps:
1. **Check.** Run the status and `too_late` checks.
2. **Close any open card payment.** Do this outside the transaction, because the transaction can rerun. If the booking is `awaiting_payment` and has a `pending` card payment:
   - `loadGateway` and call `cancelPayment(creds, { kind, gatewayRef, linkRef })`.
   - Any throw gives `payment_in_progress`.
   - On success, mark the payment `failed` with failureCode `booking_cancelled`, guarded on `status:'pending'`.
3. **Cancel inside `runInTransaction`.**
   - Re-read the booking in the session.
   - Recompute the refund from the re-read amounts.
   - Call `transition(actor, booking, 'cancelled', now, session, { cancelledAt: now, cancelledBy: kind, cancelReason: reason ?? null, paymentStatus: bookingPaymentStatus(amountPaid, amountRefunded + amount, total) })`. `transition` frees the slot locks and logs `booking.cancelled`; add `refund: { amount, percent, rule }` to `extra`'s logged `after`.
   - If `amount > 0`, call `reserveRefunds` with reason `cancellation` and `ruleApplied: { minHoursBefore: rule?.minHoursBefore ?? null, percent }`. `by` is the staff `userId`, the player's `userId`, or null for a guest.
   - The actor is: staff is `t`; player is `{ ownerId, userId }`; guest is `{ ownerId, userId: null }`.
4. **Dispatch.** After commit, call `dispatchRefund` for each card refund.
5. **Return.** Re-read the booking and its refunds and return them.

- [ ] **Step 1: Write the failing tests** in `cancel.test.ts`. Seed rules `[{96,100},{72,40}]` on the owner so the snapshot carries them, then seed bookings through `createBooking` and the cash route, or through webhook confirm for card.
  - `'player cancel 80h before refunds 40% of what was paid, by card'`:
    - the booking is `cancelled` with `paymentStatus: 'partially_refunded'` and `amountRefunded` 40%;
    - the slot locks are gone;
    - one Refund is `succeeded`, reason `cancellation`, with `ruleApplied {72,40}`;
    - `previewCancellation` beforehand returned the same `amount` and `percent`.
  - `'player cancel inside the last rule refunds nothing'`: the booking is `cancelled`, there are no Refund rows, and the status is `paid`.
  - `'staff cancel refunds 100% split across card and cash'`:
    - card 3000 plus cash 2000 gives a card Refund `succeeded` 3000 and a cash Refund `pending` 2000, with `by = staff`;
    - `paymentStatus: 'refunded'`;
    - `ruleApplied: { minHoursBefore: null, percent: 100 }`.
  - `'player cannot cancel after start; staff can'`: the player gets `too_late`; staff on a `confirmed` booking succeeds.
  - `'cancelling a hold cancels its payment intent first'`: the fake shows `paymentIntents.cancel`; the payment is `failed`/`booking_cancelled`; the booking is `cancelled` with no refunds.
  - `'a hold whose payment already went through cannot be cancelled'` (Review Focus 2): `settle(pi,'succeeded')`, so the fake refuses the cancel. The result is `payment_in_progress`, and the booking stays `awaiting_payment`.
  - `'two concurrent cancels create refunds once'` (Review Focus 3): `Promise.allSettled` of a player and a staff cancel gives one fulfilled and one 409 `invalid_transition`, and exactly one Refund.
  - `'a cash payment committed before the cancel is refunded too'`.
  - `'completed, expired and cancelled bookings cannot be cancelled'`: all give `invalid_transition`.
  - `'a guest cancel logs activity with no actor'`.

- [ ] **Step 2: Run the tests and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/bookings/cancel.test.ts`
  Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `cancel.ts` and widen `transition`'s actor.** Existing callers pass `t` unchanged.

- [ ] **Step 4: Run the booking and payment tests.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/bookings test/payments`
  Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): cancel bookings with tiered refunds`.

---

### Task 7: Staff endpoints

**Files:**
- Modify: `apps/api/src/bookings/routes/owner.ts`
- Create: `apps/api/src/payments/routes/refunds.ts`
- Modify: `apps/api/src/tenancy/routes/owner.ts` (mount it next to `gatewaysRouter`)
- Test: `apps/api/test/bookings/owner.test.ts`, `apps/api/test/payments/refundRoutes.test.ts`

**Interfaces:**
- Consumes: `previewCancellation`, `cancelBooking` (Task 6), `refundJson`, `dispatchRefund`, `settleRefund` and `reserveRefunds` (Task 4).
- Produces (all under `/api/v1/owners/:ownerId`):

  | Method and path | Permission | Behaviour |
  |---|---|---|
  | `GET /bookings/:bookingId/cancellation` | `booking.view` | `{ preview: CancellationPreview }` for a staff cancel. |
  | `POST /bookings/:bookingId/cancel` | `booking.cancel` | Body `{ reason?: string }` (trimmed, max 300, strict). Returns `{ booking, refunds: refundJson[] }`. |
  | `GET /bookings/:bookingId` | (existing) | Response adds `refunds: refundJson[]`, sorted by `_id`. |
  | `POST /refunds/:refundId/retry` | `refund.issue` | Only for a `failed` **card** refund whose payment's account is still connected. Inside a transaction, `reserveRefunds` creates a new row with the same payment, amount, reason and ruleApplied, `retryOf` the old id, and `by` the staff member. It is then dispatched. Returns `201 { refund }`. Any other row gives 409 `invalid_transition`. |
  | `POST /refunds/:refundId/record-cash` | `refund.issue` | A `pending` cash row becomes `succeeded` (`settleRefund` with the staff actor; `by` and `settledAt` are set). A `failed` card row gets a new cash row in a transaction: `reserveRefunds` with `method: 'cash'` against the same payment, and `retryOf`. It is settled `succeeded` at once. Returns `201 { refund }` for a new row, `200 { refund }` for an updated one. Anything else gives 409 `invalid_transition`. |

  Refunds are looked up with `tenantRepo(Refund, t, { venueField: 'venueId' })`, so out-of-scope venues and unknown ids give 404.

**Decision on `record-cash`:** `reserveRefunds` currently allocates against `payment.refundedAmount` room. Cash handed back for a failed card refund reserves against the card payment it replaces, so the invariant in Task 2 holds and the money isn't refunded twice.

- [ ] **Step 1: Write the failing tests.**
  - In `owner.test.ts`:
    - `'staff preview shows a 100% refund'`;
    - `'staff cancel needs booking.cancel'`: a role without it gets 403;
    - `'staff cancel returns the booking and its refunds'`;
    - `'booking detail lists refunds'`;
    - `'a manager limited to another venue gets 404'`.
  - In `refundRoutes.test.ts`:
    - `'retry re-sends a failed card refund once'`: first with `refundStatus='failed'`, then `'succeeded'`. There is a new row with `retryOf` and the old row is unchanged. Retrying the new row (succeeded) gives 409.
    - `'retry of a refund on a replaced account is refused'`: 409.
    - `'record-cash settles a pending cash refund'`: `by` is the staff userId, and `paymentStatus` is unchanged (already counted).
    - `'record-cash replaces a failed card refund with cash'`: the booking's `amountRefunded` is back up and the payment's `refundedAmount` is the amount.
    - `'record-cash twice does nothing more'`: the second call gives 409.
    - `'refund routes need refund.issue'`: 403.

- [ ] **Step 2: Run the tests and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/bookings/owner.test.ts test/payments/refundRoutes.test.ts`
  Expected: the new tests FAIL with 404s for the missing routes.

- [ ] **Step 3: Implement the routes.** Follow the existing patterns in `owner.ts`: `tenantOf`, `scopedBooking`, `requirePermission`, Zod `.strict()`.

- [ ] **Step 4: Run the tests again.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): staff cancel, refund preview, refund retry and cash settlement`.

---

### Task 8: Player and guest endpoints

**Files:**
- Modify: `apps/api/src/bookings/routes/public.ts`
- Modify: `apps/api/src/auth/otp.model.ts` (`OTP_PURPOSES` gains `'guest_cancel'`)
- Test: `apps/api/test/bookings/public.test.ts`

**Interfaces:**
- Consumes: `previewCancellation` and `cancelBooking` (Task 6), `refundJson` (Task 4), `requestOtp` and `verifyOtp`, `normalizePhone`, `lookupQuery`.
- Produces (under `/api/v1`):

  | Method and path | Auth | Behaviour |
  |---|---|---|
  | `GET /me/bookings/:bookingId/cancellation` | `requireAuth` | `{ preview }`. 404 if the booking isn't the player's. |
  | `POST /me/bookings/:bookingId/cancel` | `requireAuth` | Body `{ reason?: string }`. Returns `{ booking, refunds }`. |
  | `GET /me/bookings/:bookingId` | (existing) | Adds `refunds`. |
  | `GET /bookings/lookup/cancellation?reference&phone` | none | `{ preview }`. Same 404 rules as `/bookings/lookup`. |
  | `POST /bookings/lookup/otp` | `otpLimiter` | Body `{ reference, phone }`. Sends a `guest_cancel` code to the booking's guest phone. Answers 404 exactly as lookup does. |
  | `POST /bookings/lookup/cancel` | none | Body `{ reference, phone, otpCode, reason? }`. Verifies the code against the booking's `guest.phone` before cancelling. A wrong or missing code is the existing OTP error. |

  Pull the lookup into a helper `guestBooking(reference, phone)` shared by all four guest routes.

**Ruling: guest cancel always needs an OTP.** A reference and phone number are enough to *view* a booking, but cancelling is destructive and can move money. So a guest cancel always requires a code sent to that phone, even at venues where guest booking doesn't require OTP. If this is wrong, a guest at a no-OTP venue receives one SMS they wouldn't have.

- [ ] **Step 1: Write the failing tests** in `public.test.ts`:
  - `'player previews and cancels their own booking'`: the preview's `percent` and `amount` match the cancel's refund.
  - `"player cannot cancel someone else's booking"`: 404.
  - `'player cancel after start is too_late'`.
  - `'guest cancel needs a code sent to the booking phone'`:
    - without a code: 400 `validation_error`;
    - wrong code: the OTP error;
    - after `POST /bookings/lookup/otp`, the test services' captured SMS code works, and the booking is `cancelled` with `cancelledBy: 'guest'`.
  - `'guest otp and cancel answer 404 for a wrong phone'`.
  - `'me booking detail lists refunds'`.

- [ ] **Step 2: Run the tests and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/bookings/public.test.ts`
  Expected: the new tests FAIL.

- [ ] **Step 3: Implement the routes.** Mount `/bookings/lookup/otp` with `...(otpLimiter ? [otpLimiter] : [])`, as `/venues/:slug/bookings/otp` does. Register the `/bookings/lookup/*` routes before any `/bookings/:bookingId` pattern in this router.

- [ ] **Step 4: Run the whole suite and the checks.**
  Run: `node_modules/.bin/pnpm test && node_modules/.bin/pnpm -r typecheck && node_modules/.bin/pnpm lint`
  Expected: everything passes.

- [ ] **Step 5: Commit.** Message: `feat(api): player and guest cancellation with refund preview`.
