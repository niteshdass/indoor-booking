# Plan 08 — Payments (Stripe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each owner connects their own Stripe account. A registered player pays the advance on an `awaiting_payment` hold with a Payment Intent. A walk-in player pays through a Stripe-hosted link (shown as a QR code) on their own phone. The booking is confirmed only by a verified webhook, and each webhook takes effect exactly once. A payment that arrives after the hold lapsed revives the booking if its slots are still free; otherwise it is refunded automatically.

**Architecture:**
- **Gateway behind an interface.** `apps/api/src/payments/gateway.ts` defines `PaymentGateway` (`supports`, `verifyCredentials`, `createPayment`, `handleWebhook`, `refund`). `payments/stripe.ts` is the first implementation. It talks to Stripe only through a narrow `StripeApi` built by `services.stripe(secretKey)`, so tests inject a fake client and no test touches the network. Webhook signatures are checked with the real `Stripe.webhooks.constructEvent`, which is pure crypto.
- **Owner-scoped credentials.** `paymentGateways` holds one row per `{ ownerId, gateway }`. The secret key and webhook secret are sealed with AES-256-GCM (`payments/secretBox.ts`, key from env, AAD `ownerId:gateway`). The API never returns them.
- **One webhook transaction.** `POST /api/v1/webhooks/:gateway/:ownerId` reads the raw body, verifies it with that owner's secret, and then, in a single `runInTransaction`, inserts the event id into `webhookEvents` (unique) and applies the effect. A duplicate delivery hits the unique index and changes nothing.
- **Late payments.** `payments/apply.ts` decides between confirm, revive and refund under `lockTurf`. Revival (`expired → confirmed`) runs outside `canTransition` because it has to re-insert slot locks (Plan 07 carry-over M3).

**Tech Stack:**
- Plan 01–07 stack: Express 5, Mongoose 8 on a replica set, Zod 3, Vitest, supertest, MongoMemoryReplSet.
- New dependency: `stripe`, the official Node SDK. Use the current major at install time; the lockfile pins it.

**Spec:** `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md`:
- §4: owner-scoped gateways, AES-256-GCM, `gatewayAccountId`, minor units.
- §11: `awaiting_payment` hold, Payment Intents, late payment, walk-in card link.
- §14: `PaymentGateway`, `paymentGateways`, webhook route, idempotency, refunds through the original account.
- §16: `payments`, `refunds`.
- §2 anti-goal: "Refunds or payment states that drift from what Stripe actually did."

Roadmap: `docs/superpowers/plans/2026-10-23-roadmap.md` (Plan 08; failure modes 1, 2, 4 and 5).

## Global Constraints

- **Earlier plans still apply.**
  - TS strict, ESM, error shape `{ error: { code, message, details? } }`, `/api/v1`, injected `services.now()`.
  - Owner routes mount on `ownerRouter` with `tenantScoped` queries. Use `.setOptions({ crossTenant: true })` only on lookups by player, reference or webhook owner id.
  - Staff mutations and their `logActivity` run in one `runInTransaction`.
- **Quoted from the spec:**
  - "Credentials stored encrypted (AES-256-GCM, key from env), never returned by the API after saving."
  - "Every payment records which gateway account it was charged on (`gatewayAccountId`)".
  - "booking confirmed only on webhook … `payment_intent.succeeded`, never on redirect alone."
  - "Webhooks are idempotent (store processed event IDs)."
  - "Each owner has its own webhook endpoint `/api/v1/webhooks/:gateway/:ownerId` verified with that owner's secret."
  - "Refunds always go through the gateway + account that took the original payment."
  - "If a payment succeeds after the hold expired and the slot is gone, it is refunded automatically; if the slot is still free, the booking is revived and confirmed."
- **Exactly once.** A webhook delivered twice, concurrently, or out of order changes booking and payment state once (roadmap failure mode 4).
- **Tenancy.** Another owner's booking or gateway gives a 404 with the same body as a malformed id (roadmap failure mode 2).
- **Money.** Amounts sent to Stripe are the stored integer minor units unchanged; no conversion or float math (roadmap failure mode 5).
- **No secrets in logs or responses.** Secret keys and webhook secrets never appear in an API response, an activity-log `before`/`after`, an `AppError` message, or `console` output.
- **No UI in this plan.** The Payment Element checkout is Plan 12; the gateway settings screen and the walk-in QR are Plan 13. Both follow `.superdesign/design-system.md` and `tokens.css`.

## Decisions made in this plan (builder's calls)

- **Config.**
  - `PAYMENTS_ENCRYPTION_KEY`: base64 of exactly 32 bytes, exposed as `config.paymentsKey: Buffer`. Required when `NODE_ENV=production`, optional otherwise. Without it, connecting a gateway returns 503 `payments_unconfigured`.
  - `API_URL`, default `http://localhost:4000`, exposed as `config.apiUrl`. It builds the webhook URL shown to the owner: `${apiUrl}/api/v1/webhooks/stripe/${ownerId}`.
- **Sealed credentials.** `seal(plain, key, aad)` returns `v1.<iv>.<tag>.<ciphertext>`, each part base64url, with a random 12-byte IV. `open` rejects any other version, a tampered part, or the wrong AAD. The AAD is `${ownerId}:${gateway}`, so a row copied to another owner does not decrypt.
- **`paymentGateways` row:** `{ ownerId, gateway: 'stripe', credentialsEncrypted, publishableKey, accountId, mode: 'test'|'live', enabled }`, unique `{ ownerId, gateway }`.
  - The sealed JSON holds `{ secretKey, webhookSecret }`.
  - `publishableKey` is public by Stripe's design. It is stored in plain text and returned, because the web Payment Element needs it.
- **Connecting Stripe** (`settings.edit`, so owners only; managers do not have it):
  - `PUT /owners/:ownerId/payment-gateways/stripe { secretKey, publishableKey, webhookSecret, enabled? }`.
  - Prefixes: `sk_test_|sk_live_|rk_test_|rk_live_`, `pk_test_|pk_live_` and `whsec_`. The secret and publishable keys must share a mode, else 400 `validation_error`.
  - `verifyCredentials` calls `accounts.retrieve()`. A Stripe authentication error → 400 `invalid_credentials`; any other Stripe error → 502 `gateway_error`.
  - Switching to a different `accountId` while the old account has a `pending` card payment → 409 `gateway_account_in_use`, because that payment's webhook would no longer verify.
  - `PATCH …/stripe { enabled }` toggles the gateway. `GET /owners/:ownerId/payment-gateways` lists `{ gateway, connected, enabled, mode, accountId, publishableKey, webhookUrl, updatedAt }`, and shows `connected: false` with nulls for an unconnected gateway.
  - Both mutations log `payment_gateway.connect` and `payment_gateway.update`. The `after` field holds only `{ gateway, mode, accountId, enabled }`.
- **Turning a gateway off** stops new payments only. Webhooks for in-flight payments are still processed.
- **Supported currencies.** `StripeGateway.supports(country, currency)` ignores country (the owner's Stripe account decides that). It is true when `currencyExponent(currency)` is 0 or 2. Three-decimal currencies (KWD, BHD, …) return false, because Stripe requires their last digit to be 0 and we never round money. An unsupported currency, or no enabled gateway, gives 409 `payments_unavailable`.
- **Payment rows** (extending the Plan 07 `Payment`):
  - New fields: `kind` (`intent` | `link` | null for cash), `linkRef` (Checkout Session id, or null), `failureCode` (null), `refundedAmount` (default 0).
  - A card payment stores `gateway: 'stripe'` and `gatewayAccountId: <accountId>` at creation. `gatewayRef` is the PaymentIntent id: set at creation for `intent`, and by the webhook for `link`.
  - A partial unique index `{ bookingId: 1 }` with `{ method: 'card', status: 'pending' }` allows at most one in-flight card payment per booking.
  - Stripe metadata on every intent and session is `{ paymentId, bookingId, ownerId, reference }`. Webhooks match payments by `metadata.paymentId`.
- **Online payment.** `POST /api/v1/bookings/:bookingId/payment` (`requireAuth`; the booking's `playerId` must be the caller, else 404 "Booking not found"):
  - The booking must be `awaiting_payment`, else 409 `invalid_transition`.
  - If `holdExpiresAt <= now`, the route expires the hold (status `expired`, slot locks deleted, one transaction) and returns 409 `hold_expired`.
  - The amount is `advanceRequired - amountPaid`. The route inserts or reuses the pending `intent` payment, then calls `createPayment` with idempotency key `intent_${paymentId}`. A repeat call returns the same `clientSecret`, because Stripe replays a repeated idempotency key.
  - Response: `{ payment: { id, amount, currency, gateway: 'stripe', clientSecret, publishableKey }, holdExpiresAt }`. A Stripe error → 502 `gateway_error`, and the pending row stays for the retry.
  - Intent params: `amount`, `currency` lowercased, `automatic_payment_methods: { enabled: true }`, `description: "Booking <reference>"`, `metadata`.
- **Walk-in card link.**
  - Walk-in `payment` gains `{ method: 'link', amount? }`, which needs `booking.create` only; staff handle no money. The amount defaults to the total and must be between 1 and the total; a zero total → 400 `nothing_to_pay`.
  - The gateway is checked before the booking is created.
  - The booking is `awaiting_payment` with `holdExpiresAt = now + 30 min` (`LINK_HOLD_MINUTES = 30`), because a Stripe Checkout Session cannot expire sooner. The pending `link` payment is inserted in the creating transaction.
  - After commit, the route creates a Checkout Session:
    - `mode: 'payment'`, one `price_data` line `{ currency, unit_amount: amount, product_data: { name: "Booking <reference>" } }`;
    - `expires_at` = hold end in Unix seconds;
    - `success_url: ${appUrl}/payment-complete?reference=<reference>`;
    - `metadata` and `payment_intent_data.metadata` (the same metadata).
  - The response adds `payment: { id, amount, currency, url }`. If the session call fails, the booking stays and the response is 502 `gateway_error`.
  - `POST /owners/:ownerId/bookings/:bookingId/payments/link` (`booking.create`) re-issues the link of the pending `link` payment (idempotency key `link_${paymentId}`) so staff can show the QR again. Without a pending link payment it returns 409 `invalid_transition`.
  - QR codes are drawn by the web client from `url`; the server has no QR library.
- **Walk-in zero-total cash (carry-over M2).** `cash` on a zero total records no payment row and the booking is `confirmed`/`paid`. Today it returns 400.
- **Webhook route.**
  - Mounted in `createApp` with `express.raw({ type: '*/*', limit: '1mb' })` **before** `express.json()`, and outside every rate limiter.
  - Status codes:
    - `:gateway` other than `stripe`, a malformed `ownerId`, or no gateway row → 404 `not_found`.
    - Missing `stripe-signature` or a failed verification → 400 `invalid_signature`.
    - Otherwise 200 `{ received: true }` for a processed, duplicate or ignored event. A thrown error → 500, so Stripe retries.
  - Inside the transaction: insert `webhookEvents { ownerId, gateway, eventId, type, outcome, at }` (unique `{ ownerId, gateway, eventId }`), then apply. A duplicate key → 200 with nothing applied.
- **Normalized events** (`handleWebhook` → `GatewayEvent`):
  - `payment_intent.succeeded` → `succeeded { paymentId, gatewayRef: pi.id, amount: pi.amount_received, currency: upper }`.
  - `payment_intent.payment_failed` → `attempt_failed { paymentId, failureCode: last_payment_error?.code ?? null }`. The payment stays `pending`; the player may retry on the same intent.
  - `payment_intent.canceled` and `checkout.session.expired` → `closed { paymentId }`.
  - Anything else → `ignored`.
- **Applying events** (`applyEvent`, payment matched by `metadata.paymentId` and the URL `ownerId`):
  - Outcomes: `applied`, `ignored`, `unmatched` (no such payment for this owner), `mismatch` (amount or currency differ from the row; nothing changes).
  - `succeeded` applies only to a `pending` payment, so a second success, or a `closed` after a success, is a no-op. `closed` turns `pending` into `failed`. `attempt_failed` sets `failureCode` on a `pending` row.
  - On `succeeded`, under `lockTurf`:
    - **Confirm.** The booking is `awaiting_payment` (hold lapsed or not; its locks are still there, because `createBooking` expires an overlapping stale hold before it takes the slot) and `endAt > now` → `confirmed`, with `amountPaid += amount`, `paymentStatus` per `paymentStatusFor`, and `holdExpiresAt: null`.
    - **Revive.** The booking is `expired`, `endAt > now`, no holding booking overlaps its range, and its stock-limited add-ons still fit → re-insert one `SlotLock` per slot, then the same confirm update guarded by `status: 'expired'`. This bypasses `BOOKING_TRANSITIONS`; `expired` stays terminal for staff. A duplicate key on the locks → refund.
    - **Refund otherwise.** That covers a slot taken, `endAt <= now`, stock gone, a booking that is cancelled, rejected or already confirmed, or a lapsed `awaiting_payment` whose slot has ended (which is also set to `expired` and loses its locks).
      - The refund call runs inside the transaction with idempotency key `refund_${paymentId}`, so a transaction retry or a webhook retry does not refund twice.
      - It inserts a `refunds` row `{ ownerId, venueId, bookingId, paymentId, amount, currency, reason: 'late_payment' | 'duplicate_payment', gateway, gatewayAccountId, gatewayRef, status, by: null }` and sets `payment.refundedAmount = amount`.
      - Booking `amountPaid` is not changed.
      - `reason` is `duplicate_payment` when the booking was already confirmed, else `late_payment`.
      - A Stripe refund error → throw → 500 → Stripe retries the webhook.
- **System activity.** `ActivityLog.actorId` becomes optional (default null). `logSystemActivity(ownerId, entry, at, session)` writes it, and `GET /activity` returns `actor: null` for those rows.
  - Webhook effects log `booking.confirmed` (with `after.via: 'payment'`), `booking.revived` and `payment.refund`.
  - Player actions stay unlogged, as in Plan 07.

## Not in this plan

- Hold-expiry job, cancelling the PaymentIntent on expiry, and showing lapsed holds as expired in listings (Plan 07 M4): Plan 10. Lazy expiry stays.
- Player or staff cancellation, refund rules, cash refunds, `charge.refunded`/`refund.updated` webhooks: Plan 09. Its refunds extend the `refunds` model here.
- Disconnecting a gateway, key rotation for `PAYMENTS_ENCRYPTION_KEY`, keeping retired credentials so a switched account can still refund old charges: Plan 09 or 19.
- Closures or overrides added after a hold expired do not block its revival (same stance as Plan 07: closures do not cancel bookings).
- Plan 07 M1 (grid read before `lockTurf`): unchanged.

## Review Focus

1. **The same event twice, at once.** Two concurrent deliveries of one `payment_intent.succeeded` → both 200; `amountPaid` rises once; one `webhookEvents` row; one `booking.confirmed` log. (Task 5 test.)
2. **Out of order.** `payment_intent.canceled` after `succeeded` → booking stays `confirmed` and payment `succeeded`. `payment_failed` then `succeeded` on the same intent → confirmed. (Task 5 tests.)
3. **Late payment, slot taken.** Hold lapses, another player books the slot (lazy expiry flips the first to `expired`), then the first payment succeeds → one Stripe refund call with key `refund_<paymentId>`, a `refunds` row `late_payment`, and the second player's booking untouched. The same event redelivered → no second refund call. (Task 6 tests.)
4. **Credentials leak.** After `PUT`, no response body, activity row, or error message contains the secret key or webhook secret; the stored `credentialsEncrypted` does not contain them either. A row copied to another owner id fails `open`. (Tasks 1 and 3 tests.)
5. **Wrong owner's webhook.** An event signed with owner A's secret but posted to owner B's URL → 400 `invalid_signature`. An event whose `metadata.paymentId` is owner A's payment, signed and posted for owner B → 200 `unmatched`, and A's booking is unchanged. (Task 5 tests.)

---

## File Structure

```
apps/api/src/
  config.ts                         # MODIFY: paymentsKey, apiUrl
  services.ts                       # MODIFY: stripe: StripeFactory
  app.ts                            # MODIFY: mount webhooks before express.json()
  tenancy/activityLog.model.ts      # MODIFY: optional actorId, logSystemActivity()
  tenancy/routes/activity.ts        # MODIFY: actor null
  tenancy/routes/owner.ts           # MODIFY: mount gatewaysRouter
  payments/secretBox.ts             # seal(), open()
  payments/gateway.ts               # PaymentGateway, GatewayEvent, gatewayFor()
  payments/stripe.ts                # StripeApi, StripeFactory, stripeGateway(), realStripe()
  payments/gateway.model.ts         # PaymentGatewayAccount, loadGateway()
  payments/webhookEvent.model.ts    # WebhookEvent
  payments/refund.model.ts          # Refund
  payments/intent.ts                # startIntent(), startLink()
  payments/apply.ts                 # applyEvent()
  payments/routes/gateways.ts       # owner GET/PUT/PATCH
  payments/routes/webhooks.ts       # POST /webhooks/:gateway/:ownerId
  bookings/payment.model.ts         # MODIFY: kind, linkRef, failureCode, refundedAmount, partial unique index
  bookings/create.ts                # MODIFY: card link option, zero-total cash, export stock helpers
  bookings/routes/public.ts         # MODIFY: POST /bookings/:bookingId/payment
  bookings/routes/owner.ts          # MODIFY: walk-in link, POST …/payments/link
apps/api/test/
  helpers/testServices.ts           # MODIFY: fake stripe
  helpers/testApp.ts                # MODIFY: testConfig paymentsKey, apiUrl
  helpers/stripe.ts                 # connectStripe(), signedEvent(), postEvent()
  payments/secretBox.test.ts
  payments/stripe.test.ts
  payments/gateways.test.ts
  payments/intent.test.ts
  payments/webhooks.test.ts
  payments/late.test.ts
  payments/walkin.test.ts
```

---

### Task 1: Config, sealed credentials, and the system activity actor

**Files:**
- Modify: `apps/api/src/config.ts`, `apps/api/test/helpers/testApp.ts`, `apps/api/src/tenancy/activityLog.model.ts`, `apps/api/src/tenancy/routes/activity.ts`
- Create: `apps/api/src/payments/secretBox.ts`
- Test: `apps/api/test/config.test.ts`, `apps/api/test/payments/secretBox.test.ts`, `apps/api/test/tenancy/activity.test.ts`

**Interfaces:**
- Produces:
  - `Config` gains `apiUrl: string` and `paymentsKey?: Buffer`. `testConfig` sets `apiUrl: 'http://localhost:4000'` and `paymentsKey: Buffer.alloc(32, 7)`.
  - `seal(plain: string, key: Buffer, aad: string): string` and `open(sealed: string, key: Buffer, aad: string): string`. `open` throws `Error('Cannot open sealed value')` on every failure.
  - `logSystemActivity(ownerId: string, entry: ActivityEntry, at: Date, session?: ClientSession): Promise<void>`.

- [ ] **Step 1: Write failing tests**
  - `config.test.ts`:
    - `PAYMENTS_ENCRYPTION_KEY` = base64 of 32 bytes → `paymentsKey.length === 32`.
    - Base64 of 16 bytes → `ConfigError` naming `PAYMENTS_ENCRYPTION_KEY`.
    - Unset with `NODE_ENV=production` → `ConfigError`; unset in development → `paymentsKey` undefined.
    - `API_URL` defaults to `http://localhost:4000`.
  - `secretBox.test.ts`:
    - Round trip; two seals of the same text differ.
    - The result starts with `v1.` and does not contain the plain text.
    - Each of the following throws the message above: one flipped character in iv, tag or ciphertext; `v2.` prefix; wrong key; wrong AAD (`ownerB:stripe` vs `ownerA:stripe`).
  - `activity.test.ts › lists a system entry`: `logSystemActivity` row → `GET /activity` item has `actor: null`.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/config.test.ts test/payments/secretBox.test.ts test/tenancy/activity.test.ts`. Expected: FAIL (missing modules and fields).
- [ ] **Step 3: Implement.** `node:crypto` `createCipheriv('aes-256-gcm', key, iv)` with `setAAD(Buffer.from(aad))`. Config uses a Zod `superRefine` for the production rule. `actorId` loses `required` and gets `default: null`.
- [ ] **Step 4: Run** the files, then `node_modules/.bin/pnpm --filter api test`. Expected: PASS, with no other test broken by the `Config` change.
- [ ] **Step 5: Commit**: `feat(api): payments config, AES-256-GCM secret box, system activity actor`

---

### Task 2: Gateway interface and the Stripe implementation

**Files:**
- Modify: `apps/api/package.json` (add `stripe`), `apps/api/src/services.ts`, `apps/api/src/errors.ts` (map `GatewayError`), `apps/api/test/helpers/testServices.ts`
- Create: `apps/api/src/payments/gateway.ts`, `apps/api/src/payments/stripe.ts`, `apps/api/test/helpers/stripe.ts` (the `signedEvent` part)
- Test: `apps/api/test/payments/stripe.test.ts`

**Interfaces:**
- Produces:
  - `type StripeApi = { accounts: { retrieve(): Promise<{ id: string }> }; paymentIntents: { create(p: object, o: { idempotencyKey: string }): Promise<{ id: string; client_secret: string | null }> }; checkout: { sessions: { create(p: object, o: { idempotencyKey: string }): Promise<{ id: string; url: string | null }> } }; refunds: { create(p: { payment_intent: string; amount: number }, o: { idempotencyKey: string }): Promise<{ id: string; status: string | null }> } }`.
  - `type StripeFactory = (secretKey: string) => StripeApi`; `realStripe: StripeFactory` (`new Stripe(key, { maxNetworkRetries: 2, timeout: 10_000 })`). `AppServices.stripe: StripeFactory`; `defaultServices` uses `realStripe`.
  - `type GatewayCredentials = { secretKey: string; webhookSecret: string }`.
  - `type GatewayEvent = { id: string; type: string } & ({ kind: 'succeeded'; paymentId: string | null; gatewayRef: string; amount: number; currency: string } | { kind: 'attempt_failed'; paymentId: string | null; failureCode: string | null } | { kind: 'closed'; paymentId: string | null } | { kind: 'ignored' })`.
  - `interface PaymentGateway`:
    - `key: 'stripe'`;
    - `supports(country: string, currency: string): boolean`;
    - `verifyCredentials(c: GatewayCredentials): Promise<{ accountId: string }>`;
    - `createPayment(c, input: { kind: 'intent' | 'link'; amount: number; currency: string; metadata: Record<string, string>; description: string; idempotencyKey: string; expiresAt?: Date; successUrl?: string }): Promise<{ gatewayRef: string | null; linkRef: string | null; clientSecret: string | null; url: string | null }>`;
    - `handleWebhook(c, rawBody: Buffer, signature: string | undefined): GatewayEvent`;
    - `refund(c, input: { gatewayRef: string; amount: number; idempotencyKey: string }): Promise<{ refundRef: string; status: 'pending' | 'succeeded' | 'failed' }>`.
  - `class GatewayError extends Error { code: 'invalid_credentials' | 'invalid_signature' | 'gateway_error' }`, which `errorHandler` maps to 400 for `invalid_credentials` and `invalid_signature`, and 502 for `gateway_error`. Its message is fixed text, never Stripe's message.
  - `stripeGateway(factory: StripeFactory): PaymentGateway`; `gatewayFor(services: AppServices, key: string): PaymentGateway | null`.
  - `TestServices.stripe` is a fake factory with:
    - `calls: { method: string; secretKey: string; params: object; idempotencyKey?: string }[]`;
    - `fail(method: string, kind: 'auth' | 'api')`, which makes the next call to that method throw `Stripe.errors.StripeAuthenticationError` or `StripeAPIError`;
    - replay of a repeated idempotency key with the same result.
    - Ids are `pi_test_<n>`, `cs_test_<n>`, `re_test_<n>`, `acct_test_<secretKey suffix>`; the client secret is `<pi>_secret_x`; the session url is `https://checkout.stripe.test/<cs>`.
  - `signedEvent(secret: string, event: object): { body: string; signature: string }` (via `Stripe.webhooks.generateTestHeaderString`).

- [ ] **Step 1: Write failing tests** (`stripe.test.ts`):
  - `supports`: `('BD','BDT')`, `('JP','JPY')`, `('US','USD')` → true; `('KW','KWD')` → false; `('US','XXX')` → false.
  - `createPayment` intent with `amount: 1005, currency: 'JPY'`:
    - the fake records `paymentIntents.create` with `amount: 1005`, `currency: 'jpy'`, `automatic_payment_methods: { enabled: true }`, the metadata and the idempotency key;
    - the result has `gatewayRef: 'pi_test_1'`, `clientSecret: 'pi_test_1_secret_x'`, `linkRef: null`, `url: null`.
  - `createPayment` link:
    - records `checkout.sessions.create` with `mode: 'payment'`, `line_items[0].price_data.unit_amount` equal to the amount, `expires_at` equal to `Math.floor(expiresAt / 1000)`, and `payment_intent_data.metadata` equal to `metadata`;
    - the result has `linkRef: 'cs_test_1'`, `gatewayRef: null`, and the url.
  - `handleWebhook` with `signedEvent`:
    - each of the four mapped types gives its `kind`, `paymentId` from metadata, and an uppercase currency;
    - `customer.created` → `ignored`;
    - a body changed after signing, a wrong secret, or a missing signature → `GatewayError` `invalid_signature`.
  - `refund`: Stripe status `succeeded` → `succeeded`, `pending` → `pending`, `failed` → `failed`; the idempotency key is passed through.
  - `verifyCredentials`: success → `{ accountId }`; an `auth` failure → `invalid_credentials`; an `api` failure → `gateway_error`. Neither error message contains the secret key.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api add stripe`, then `node_modules/.bin/pnpm --filter api exec vitest run test/payments/stripe.test.ts`. Expected: FAIL (missing modules).
- [ ] **Step 3: Implement.** For `checkout.session.expired`, take the payment id from the session's own `metadata`.
- [ ] **Step 4: Run** the file, then `node_modules/.bin/pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(api): PaymentGateway interface and Stripe implementation behind an injected client`

---

### Task 3: Owner gateway settings

**Files:**
- Create: `apps/api/src/payments/gateway.model.ts`, `apps/api/src/payments/routes/gateways.ts`, `apps/api/test/helpers/stripe.ts` (`connectStripe`)
- Modify: `apps/api/src/tenancy/routes/owner.ts`, `apps/api/src/bookings/payment.model.ts` (fields from Decisions and the partial unique index)
- Test: `apps/api/test/payments/gateways.test.ts`

**Interfaces:**
- Consumes: Task 1 `seal`/`open`, `Config.paymentsKey`/`apiUrl`; Task 2 `gatewayFor`, `GatewayError`.
- Produces:
  - `PaymentGatewayAccount` model (`tenantScoped`, timestamps), with fields as in Decisions.
  - `loadGateway(ownerId: string, key: string, config: Config, session?: ClientSession): Promise<{ row: PaymentGatewayAccountDoc; creds: GatewayCredentials; gateway: PaymentGateway } | null>`. It returns null for no row, an unknown key or a missing `paymentsKey`, and it does not check `enabled`.
  - `gatewaysRouter(config: Config, services: AppServices): Router`, mounted on `ownerRouter`. `ownerRouter` already receives `{ config, services }`.
  - `Payment` fields `kind`, `linkRef`, `failureCode`, `refundedAmount`.
  - `connectStripe(app, owner: { ownerId, token }, opts?: { secretKey?: string; webhookSecret?: string; enabled?: boolean }): Promise<{ webhookSecret: string; accountId: string }>`. Defaults: `sk_test_owner<n>`, `pk_test_owner<n>`, `whsec_owner<n>`.

- [ ] **Step 1: Write failing tests** (`gateways.test.ts`):
  - **Unconnected.** `GET` before connect → `[{ gateway: 'stripe', connected: false, enabled: false, mode: null, accountId: null, publishableKey: null, webhookUrl: 'http://localhost:4000/api/v1/webhooks/stripe/<ownerId>', updatedAt: null }]`.
  - **Connect.**
    - `PUT` valid → 200 `{ gateway: { connected: true, enabled: true, mode: 'test', accountId: 'acct_test_…', publishableKey: 'pk_test_…', webhookUrl } }`.
    - The serialized body contains neither `sk_test_` nor `whsec_`.
    - The stored row's `credentialsEncrypted` contains neither, and `open` with AAD `${ownerId}:stripe` gives back both.
    - One `payment_gateway.connect` activity row has `after` with exactly `{ gateway, mode, accountId, enabled }`.
  - **Validation.**
    - `sk_live_…` with `pk_test_…` → 400 `validation_error`; `secretKey: 'abc'` → 400.
    - The fake `fail('accounts.retrieve','auth')` → 400 `invalid_credentials`, the message does not contain the key, and no row is saved.
  - **Permissions.** A manager → 403 (no `settings.edit`). Owner B's token on owner A's path → the same status and body the existing owner routes give (see `test/tenancy/members.test.ts`).
  - **Other states.**
    - With `paymentsKey` removed from the config (custom `buildTestApp` config) → 503 `payments_unconfigured`.
    - `PATCH { enabled: false }` → `enabled: false`, logged `payment_gateway.update`.
    - `PUT` again with a key for another account while a `pending` card `Payment` exists on the old `accountId` → 409 `gateway_account_in_use`. With no pending payment, the account switches.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/payments/gateways.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `PUT` order: Zod → `paymentsKey` present → `verifyCredentials` (outside the transaction) → transaction: account-change guard, upsert, log.
- [ ] **Step 4: Run** the file and `test/bookings/*.test.ts`. Expected: PASS; the new Payment fields break no Plan 07 test.
- [ ] **Step 5: Commit**: `feat(api): owner Stripe connection with sealed credentials and per-owner webhook URL`

---

### Task 4: Online payment for an awaiting_payment hold

**Files:**
- Create: `apps/api/src/payments/intent.ts`
- Modify: `apps/api/src/bookings/routes/public.ts`
- Test: `apps/api/test/payments/intent.test.ts`

**Interfaces:**
- Consumes: Task 3 `loadGateway`, Payment fields; Plan 07 `Booking`, `SlotLock`, `HOLD_MINUTES`.
- Produces:
  - `startIntent(booking: BookingDoc, ctx: { config: Config; services: AppServices }): Promise<{ payment: PaymentDoc; clientSecret: string; publishableKey: string }>`. It throws `payments_unavailable`, `hold_expired` or `gateway_error` as in Decisions.
  - `pendingCardPayment(booking: BookingDoc, kind: 'intent' | 'link', fields: { amount: number; gateway: string; gatewayAccountId: string }): Promise<PaymentDoc>`. It inserts, or on a duplicate key returns the existing pending card payment of that kind. Task 7 uses it.
  - `expireHold(booking: BookingDoc, now: Date): Promise<void>`: a conditional `awaiting_payment` → `expired` update plus `SlotLock.deleteMany`, in one transaction.

- [ ] **Step 1: Write failing tests** (`intent.test.ts`, venue `paymentPolicy: partial_percent 20`, slot price 3000 → advance 600, registered player):
  - **Pay a hold.** Hold then `POST /bookings/:id/payment`:
    - 200 `{ payment: { amount: 600, currency: 'BDT', gateway: 'stripe', clientSecret: 'pi_test_1_secret_x', publishableKey }, holdExpiresAt }`;
    - one Payment row `{ method: 'card', kind: 'intent', status: 'pending', gateway: 'stripe', gatewayAccountId: 'acct_test_…', gatewayRef: 'pi_test_1' }`;
    - the Stripe metadata holds `paymentId`, `bookingId`, `ownerId` and `reference`.
  - **Repeat calls.** A second POST returns the same `clientSecret` and leaves one Payment row. Two concurrent POSTs → both 200 with the same client secret and one row.
  - **Lapsed hold.** `clock.advance(10 min)` then POST → 409 `hold_expired`; the booking is `expired` with zero slot locks.
  - **Ownership.** Another player's token → 404 "Booking not found"; a malformed id → the same body.
  - **Wrong state.** A `confirmed` booking (no-advance venue) → 409 `invalid_transition`.
  - **Gateway unavailable.** Gateway disabled or never connected → 409 `payments_unavailable`. A KWD venue → 409 `payments_unavailable`.
  - **Stripe error.** `fail('paymentIntents.create','api')` → 502 `gateway_error`; one pending row with `gatewayRef: null`. A retry → 200 with the same Payment id.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/payments/intent.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Booking lookup: `Booking.findOne({ _id, playerId: userId }).setOptions({ crossTenant: true })`; an invalid ObjectId gives the same 404.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(api): Payment Intent for awaiting_payment holds`

---

### Task 5: Idempotent webhooks: confirm, failed attempts, closed payments

**Files:**
- Create: `apps/api/src/payments/webhookEvent.model.ts`, `apps/api/src/payments/apply.ts`, `apps/api/src/payments/routes/webhooks.ts`, `apps/api/test/helpers/stripe.ts` (`postEvent`)
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/payments/webhooks.test.ts`

**Interfaces:**
- Consumes: Task 2 `GatewayEvent`, `handleWebhook`; Task 3 `loadGateway`; Task 1 `logSystemActivity`; `lockTurf`.
- Produces:
  - `WebhookEvent` model, with a unique index as in Decisions.
  - `applyEvent(ownerId: string, event: GatewayEvent, ctx: { gateway: PaymentGateway; creds: GatewayCredentials; now: Date }, session: ClientSession): Promise<'applied' | 'ignored' | 'unmatched' | 'mismatch'>`. In this task the `succeeded` branch handles **Confirm** only, and anything else returns `ignored`; Task 6 adds revive and refund.
  - `webhooksRouter(config: Config, services: AppServices): Router`.
  - `postEvent(app, ownerId: string, webhookSecret: string, event: object): supertest.Test`.
  - Test event builders: `piSucceeded(payment, overrides?)`, `piFailed(payment)`, `piCanceled(payment)`, `sessionExpired(payment)`. Each has a fresh `evt_<n>` id unless one is passed.

- [ ] **Step 1: Write failing tests** (`webhooks.test.ts`, starting from Task 4's paid-hold setup):
  - **Confirm.** `piSucceeded` with amount 600 → 200 `{ received: true }`:
    - the booking is `confirmed`, `amountPaid: 600`, `paymentStatus: 'partially_paid'`, `holdExpiresAt: null`;
    - the payment is `succeeded`;
    - one `booking.confirmed` activity row with `actor: null` and `after.via: 'payment'`;
    - one `webhookEvents` row with `outcome: 'applied'`.
  - **Duplicates.**
    - The same event again → 200; `amountPaid` is still 600; one events row; one activity row.
    - The same event posted twice concurrently (`Promise.all`) → both 200; `amountPaid` 600.
  - **Out of order.**
    - `piCanceled` after success → payment stays `succeeded` and the booking stays `confirmed`.
    - On a fresh hold, `piFailed` (code `card_declined`) → payment `pending` with `failureCode: 'card_declined'`, booking `awaiting_payment`; then `piSucceeded` → confirmed.
  - **Closed.** `sessionExpired` or `piCanceled` on a pending payment → payment `failed`; the booking is unchanged.
  - **Hold lapsed, slot untouched.** `clock.advance(11 min)` without anyone else booking, then `piSucceeded` → confirmed.
  - **Bad input.**
    - Amount 599 → outcome `mismatch`; payment `pending`; booking `awaiting_payment`.
    - Unknown `paymentId` → 200 `unmatched`.
    - Owner A's payment id posted to owner B's URL, signed with B's secret → 200 `unmatched`; A's booking unchanged.
    - Signed with A's secret but posted to B's URL → 400 `invalid_signature`.
    - Bad signature → 400 and no events row.
    - `/webhooks/paypal/<id>`, a malformed owner id, or an owner with no gateway row → 404.
    - Gateway disabled after the hold → the event is still applied.
  - **Raw body.** `customer.created` → 200 `ignored`. The JSON body arrives as a raw Buffer (the signature verifies), so mounting before `express.json()` works. Existing JSON routes still parse bodies.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/payments/webhooks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Route order: resolve the gateway, then `loadGateway`, then `handleWebhook`, then `runInTransaction(insert event → applyEvent → set outcome)`.
  - Catch a duplicate key on the `webhookEvents` insert outside the transaction and answer 200.
  - All payment and booking updates are conditional on the status they read.
- [ ] **Step 4: Run** the file, then `node_modules/.bin/pnpm --filter api test`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(api): per-owner Stripe webhooks, applied exactly once`

---

### Task 6: Late payment: revive or refund

**Files:**
- Create: `apps/api/src/payments/refund.model.ts`
- Modify: `apps/api/src/payments/apply.ts`, `apps/api/src/bookings/create.ts` (export `stockInUse` and `limited`; no behaviour change)
- Test: `apps/api/test/payments/late.test.ts`

**Interfaces:**
- Consumes: Task 5 `applyEvent`; Plan 07 `holdingFilter`, `SlotLock`, `offeredAddons`, `lockAddon`, `stockInUse`.
- Produces:
  - `Refund` model (`tenantScoped`, timestamps; fields as in Decisions; index `{ ownerId, bookingId }`).
  - `applyEvent` `succeeded`: **Revive** and **Refund otherwise**, exactly as in Decisions.

- [ ] **Step 1: Write failing tests** (`late.test.ts`, paid-hold setup, slot 18:00–19:00 the next day):
  - **Revive.**
    - Hold lapses and `POST /bookings/:id/payment` returns `hold_expired` (so the booking is `expired` with no locks), and nobody else books the slot. Then `piSucceeded` → booking `confirmed`, `amountPaid: 600`, one `SlotLock` per slot again, a `booking.revived` activity row, no refund call.
    - `BOOKING_TRANSITIONS.expired` is still `[]`, and the staff `confirm` route on an expired booking still returns 409.
  - **Slot taken.**
    - Player 2 books the same slot after the lapse (lazy expiry), then `piSucceeded` → booking 1 stays `expired`.
    - One fake `refunds.create` call with `{ payment_intent: 'pi_test_1', amount: 600 }`, key `refund_<paymentId>`, using the same secret key as the intent.
    - A `Refund` row `{ reason: 'late_payment', status: 'succeeded', gatewayAccountId: 'acct_test_…', by: null }`; payment `succeeded` with `refundedAmount: 600`.
    - A `payment.refund` activity row; booking 2 untouched.
  - **Redelivery.** The same event again → no second `refunds.create` call and one `Refund` row.
  - **Overlap only.** The slot length changes and player 2 books 18:30–19:30 (overlapping, different start) → refund.
  - **Slot over.** The hold lapses and `clock.advance` passes `endAt` → refund; booking `expired` with zero locks.
  - **Stock gone.** A stock-1 add-on is on booking 1; after the lapse player 2 takes the add-on on another turf at the same time → refund.
  - **Already confirmed.** A second succeeded payment on a confirmed booking (insert a second card payment row for it) → refund with `reason: 'duplicate_payment'`; `amountPaid` unchanged.
  - **Stripe error.** `fail('refunds.create','api')` → 500; no events row, no Refund row. Redelivery → refunded once.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/payments/late.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Stock check: for each line of a stock-limited offered add-on, `lockAddon` (sorted ids), then require `stockInUse + units ≤ stock`. An add-on no longer offered, or with `stock: null`, passes.
- [ ] **Step 4: Run** the file, then `node_modules/.bin/pnpm --filter api test`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(api): revive late-paid expired holds or refund through the original account`

---

### Task 7: Walk-in payment link and the zero-total cash fix

**Files:**
- Modify: `apps/api/src/bookings/create.ts`, `apps/api/src/bookings/routes/owner.ts`, `apps/api/src/payments/intent.ts` (`startLink`)
- Test: `apps/api/test/payments/walkin.test.ts`, `apps/api/test/bookings/owner.test.ts`

**Interfaces:**
- Consumes: Task 4 `pendingCardPayment`; Task 3 `loadGateway`; Task 5 `applyEvent` (to confirm a link payment end to end).
- Produces:
  - `CreateBookingInput.card?: { amount?: number; gateway: string; gatewayAccountId: string }`:
    - forces `status: 'awaiting_payment'` with `holdExpiresAt = now + LINK_HOLD_MINUTES`;
    - inserts the pending `link` payment in the transaction (amount default and check inside the transaction, as `cash` does);
    - passes it to `afterInsert`.
  - `LINK_HOLD_MINUTES = 30`, exported from `create.ts`.
  - `startLink(booking: BookingDoc, payment: PaymentDoc, ctx): Promise<{ url: string }>`: calls `createPayment` `link` with key `link_${paymentId}`, `expiresAt: booking.holdExpiresAt`, `successUrl` as in Decisions, and stores `linkRef`.
  - `POST /owners/:ownerId/bookings/:bookingId/payments/link` as in Decisions.

- [ ] **Step 1: Write failing tests**
  - `walkin.test.ts`:
    - **Create.** Walk-in `payment: { method: 'link' }` on a total of 3000 → 201:
      - `booking.status: 'awaiting_payment'`, `holdExpiresAt` = now + 30 min;
      - `payment: { amount: 3000, currency: 'BDT', url: 'https://checkout.stripe.test/cs_test_1' }`;
      - the session `expires_at` equals the hold end;
      - the `booking.create` activity row is written.
    - **Partial amount.** `{ method: 'link', amount: 1000 }` → amount 1000.
    - **Bad amounts.** `amount: 0` or 3001 → 400 `invalid_amount`, and no booking. A zero-total booking → 400 `nothing_to_pay`.
    - **Gateway unavailable.** Gateway not connected → 409 `payments_unavailable`, and no booking.
    - **Staff.** Staff with `booking.create` but not `payment.mark_cash` → 201.
    - **Re-issue.** `POST …/payments/link` → same url, and one Payment row. On a cash booking → 409 `invalid_transition`. Another owner's booking id → 404.
    - **Stripe error.** `fail('checkout.sessions.create','api')` on the walk-in → 502 `gateway_error`, and the booking exists `awaiting_payment`. The re-issue route then returns a url.
    - **Paid.** `piSucceeded` with `paymentId` → booking `confirmed`, `amountPaid: 3000`, `paymentStatus: 'paid'`, payment `gatewayRef` set to the PI id.
  - `owner.test.ts › cash walk-in on a zero total` (M2): add-on-free slot priced 0, `payment: { method: 'cash' }` → 201, `confirmed`, `paymentStatus: 'paid'`, no Payment row, no `payment.cash` activity.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/payments/walkin.test.ts test/bookings/owner.test.ts`. Expected: FAIL (`link` rejected by Zod; the zero-total cash walk-in gets 400).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files, then the whole check: `node_modules/.bin/pnpm test && node_modules/.bin/pnpm -r typecheck && node_modules/.bin/pnpm lint`. Expected: all PASS.
- [ ] **Step 5: Commit**: `feat(api): walk-in Stripe payment link; zero-total cash walk-ins confirm without a payment`
