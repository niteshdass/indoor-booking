# Platform General Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Admin > Settings > General tab covering:
- the venue signup approval mode;
- the platform fee per booking, with who pays it;
- the admin's own payout details.

It also adds an owner-side balance with "pay the platform at any time", plus fee-aware reports.

**Architecture:**
- **Settings:** they live on the existing single `PlatformSettings` document (`general` field) and are read through the cached `loadSettings()`.
- **Fee:** a pure fee function in `@booking/shared` runs inside `quoteBooking`, and the series engine prices fees the same way. The result is snapshotted on each booking as `platformFee`.
- **Balance:** it is computed on demand, as owed minus paid. "Owed" is the sum of fee snapshots on bookings in owing statuses; "paid" is the sum of confirmed `PlatformPayout` rows.
- **Payouts:**
  - Manual payouts (bKash/Nagad) are confirmed by an admin.
  - Stripe payouts use the admin's own keys and are confirmed by webhook at `/webhooks/stripe/platform`.

**Tech Stack:** Express + Mongoose + zod (apps/api), React + react-router + react-i18next + CSS modules (apps/web), Vitest + supertest + mongodb-memory-server, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-31-platform-general-settings-design.md`

## Global Constraints

- **Money:** integer minor units plus an ISO currency (`packages/shared/src/money.ts`). A fixed fee is stored in **major units** and applied in each booking's own currency.
- **Defaults when no settings document exists:**
  - `ownerApproval: 'manual'`;
  - fee `{ mode: 'free', fixed: null, percent: null, payer: 'owner' }`;
  - no payout methods.
- **Percent:** `0 < percent ≤ 50`, at most 2 decimals. Rounded half up to a minor unit, via `percentOf`.
- **Fixed:** `> 0`, at most 2 decimals.
- **Owing statuses:** `pending`, `confirmed`, `completed`, `no_show`. `awaiting_payment`, `rejected`, `cancelled` and `expired` owe nothing.
- **When a booking gets a fee:** only bookings with `source: 'online'` (series included). Walk-ins get `platformFee: null`.
- **Fee basis:** fixed fees are per booking; percent fees are taken on `subtotal + addonsTotal`.
- **Who pays:**
  - Player pays: the fee is added to `total`. When `advanceFor(policy, base) > 0`, the fee is also added to `advanceRequired`, capped at `total`.
  - Owner pays: `total` is unchanged.
- **Balance:** a negative balance is a credit, not refunded. An owner can pay at most `max(0, balance − pending)`.
- **Permissions:**
  - the General tab: `platform.settings`;
  - the payout queue and the Owes column: `platform.owners`;
  - the owner platform-fee page and routes: `settings.edit`.
- **Approval:** switching to automatic never approves owners that are already `pending_approval`.
- **Reports:** revenue is **net** of `platformFee.amount` for owing bookings, with the fee shown as its own figure.
- **UI rules:**
  - every screen follows `.superdesign/design-system.md`;
  - only `var(--…)` tokens from `apps/web/src/styles/tokens.css`, so `apps/web/test/tokens.test.ts` must stay green;
  - light and dark mode;
  - every string goes in both `en.json` and `ru.json` and fits in Russian.
- **Free mode:** no fee UI anywhere. That means no "Platform fee" line, and no owner page unless a balance or credit is non-zero.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Settings changed between quote and booking.** Booking creation must re-read settings and snapshot what applied at create time. It must not reuse what the quote showed. (Task 4: `uses the fee in force at create time`.)
2. **Two payout submissions at once.** Both can't pass the `payable` check and together exceed the balance. The check runs inside the transaction, after locking the owner row. (Task 5: `rejects a second payout that would exceed what is owed`.)
3. **A percent fee that rounds to 0** (a free or tiny booking) gives `platformFee: null`, not a zero line. (Task 1: `no fee when it rounds to zero`.)
4. **A currency with exponent 0 (JPY) and a fixed fee of 12.5** rounds to whole minor units. Exponent 3 (KWD) multiplies by 1000. (Task 1: `fixed fee follows the currency exponent`.)
5. **Owner-paid fee on a booking that is later cancelled, after a payout was confirmed.** The balance goes negative and is shown as a credit. Pay now is hidden. The admin's Owes column shows a credit. (Task 5: `cancelled booking after payout leaves a credit`; Task 10: `shows credit with no pay action`.)

---

### Task 1: Shared fee core

**Files:**
- Create: `packages/shared/src/platformFee.ts`
- Modify: `packages/shared/src/booking.ts` (`BookingQuote`, `quoteBooking`), `packages/shared/src/index.ts` (export)
- Test: `packages/shared/test/platformFee.test.ts`, `packages/shared/test/booking.test.ts`

**Interfaces:**
- Produces (exported from `@booking/shared`):
  ```ts
  export const PLATFORM_FEE_MODES = ['free', 'fixed', 'percent'] as const;
  export type PlatformFeeMode = (typeof PLATFORM_FEE_MODES)[number];
  export const FEE_PAYERS = ['owner', 'player'] as const;
  export type FeePayer = (typeof FEE_PAYERS)[number];
  export const PLATFORM_FEE_MAX_PERCENT = 50;
  export type PlatformFeeSettings = { mode: PlatformFeeMode; fixed: number | null; percent: number | null; payer: FeePayer };
  export const DEFAULT_PLATFORM_FEE: PlatformFeeSettings; // free / null / null / owner
  export type PlatformFeeSnapshot = { mode: 'fixed' | 'percent'; value: number; payer: FeePayer; amount: number };
  export const FEE_OWING_STATUSES: readonly BookingStatus[]; // pending, confirmed, completed, no_show
  export function platformFeeFor(settings: PlatformFeeSettings, base: number, currency: string): PlatformFeeSnapshot | null;
  export const OWNER_APPROVAL_MODES = ['manual', 'automatic'] as const;
  export type OwnerApprovalMode = (typeof OWNER_APPROVAL_MODES)[number];
  ```
- `BookingQuote` gains `platformFee: PlatformFeeSnapshot | null`.
- `quoteBooking` input gains `fee?: { settings: PlatformFeeSettings; currency: string } | null`. When it is omitted or null, there is no fee.

- [ ] **Step 1: Write failing tests** in `platformFee.test.ts`:
  - `free mode gives null`: `platformFeeFor({ ...DEFAULT_PLATFORM_FEE }, 100000, 'BDT')` → `null`.
  - `fixed fee follows the currency exponent`:
    - `{ mode:'fixed', fixed: 50, payer:'player' }` on BDT → `{ mode:'fixed', value:50, payer:'player', amount:5000 }`;
    - `fixed: 12.5` on `JPY` → amount `13`;
    - `fixed: 1` on `KWD` → `1000`.
  - `percent rounds half up`: `{ mode:'percent', percent: 5 }` on base `100000` → amount `5000`. `percent: 2.5` on base `333` → `8`.
  - `no fee when it rounds to zero`: percent `1` on base `10` → `null`. Percent `5` on base `0` → `null`.
- [ ] **Step 2: Add failing tests** in `booking.test.ts`, using the existing slot fixtures in that file:
  - `player-paid fee joins total and advance`:
    - base 100000, policy `partial_percent` 20, fee fixed 50 paid by the player;
    - expect `total` 105000, `advanceRequired` 25000 (20000 + 5000), and `platformFee.amount` 5000.
  - `player-paid fee with no advance`: policy `none` → `total` 105000, `advanceRequired` 0.
  - `owner-paid fee leaves total alone`: `total` 100000, `advanceRequired` unchanged, `platformFee.payer` `'owner'`.
  - `no fee input means no fee`: `platformFee` is `null` and totals are as today.
- [ ] **Step 3: Run tests.** `pnpm --filter @booking/shared test -- platformFee booking`. Expected: FAIL, `platformFeeFor` is not exported.
- [ ] **Step 4: Implement `platformFeeFor` and the fee step in `quoteBooking`.**
  - Fixed: `Math.round(fixed * 10 ** currencyExponent(currency))`.
  - Percent: `percentOf(base, percent)`.
  - An amount of 0 gives `null`.
  - In `quoteBooking`:
    1. `base = subtotal + addonsTotal`;
    2. `baseAdvance = advanceFor(policy, base)`;
    3. when the player pays: `total = base + fee`, and `advance = baseAdvance > 0 ? Math.min(total, baseAdvance + fee) : 0`.
- [ ] **Step 5: Run the tests again.** Same command. Expected: PASS. Then run `pnpm --filter @booking/shared typecheck`.
- [ ] **Step 6: Commit** with the message `feat(shared): platform fee computation in quotes`.

### Task 2: Admin General settings API

**Files:**
- Modify:
  - `apps/api/src/admin/settings.ts` (schema `general`, `resolveGeneral`);
  - `apps/api/src/admin/routes/settings.ts` (routes plus JSON);
  - `packages/shared/src/admin.ts` (`AdminSettingsJson.general`, `PlatformLog` actions).
- Test: `apps/api/test/admin/settings.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  // settings.ts
  export type PayoutStripe = { mode: 'test' | 'live'; publishableKey: string; accountId: string; creds: GatewayCredentials };
  export type GeneralSettings = {
    ownerApproval: OwnerApprovalMode;
    fee: PlatformFeeSettings;
    payout: { bkash: ManualWallet | null; nagad: ManualWallet | null; stripe: PayoutStripe | null };
  };
  export async function resolveGeneral(config: Config): Promise<GeneralSettings>; // defaults when unset; stripe null if no paymentsKey or disabled
  // secretAad gains 'payout.stripe'
  ```
  ```ts
  // shared admin.ts
  AdminSettingsJson.general: {
    ownerApproval: OwnerApprovalMode;
    fee: PlatformFeeSettings;
    payout: {
      bkash: ManualWallet | null;
      nagad: ManualWallet | null;
      stripe: { mode: 'test' | 'live'; enabled: boolean; keys: { test: { publishableKey: string; accountId: string } | null; live: { publishableKey: string; accountId: string } | null } } | null;
    };
    payoutWebhookUrl: string; // `${config.apiUrl}/api/v1/webhooks/stripe/platform`
  }
  ```
- Routes, all under `requirePlatform('platform.settings')`:
  - `PUT /admin/settings/general` with body `{ ownerApproval, fee: { mode, fixed, percent, payer }, payout: { bkash, nagad } }`. The wallet validation mirrors the owner `ManualWallet` rules (`normalizeBdMobile`). Fee validation:
    - `fixed` is required with `fixed` mode, `percent` with `percent` mode;
    - both are null with `free`;
    - the limits are those in Global Constraints.
  - `PUT /admin/settings/payout-stripe` with body `{ mode, secretKey, publishableKey, webhookSecret, enabled }`. It reuses the key regexes and `verifyCredentials` from `apps/api/src/payments/routes/gateways.ts` and seals with `secretAad('payout.stripe')`.
  - `DELETE /admin/settings/payout-stripe`.
- Logging: each save logs `settings.general_updated` via `logPlatform`. Add it to `PLATFORM_ACTIONS`.

- [ ] **Step 1: Write failing tests:**
  - `general starts at defaults`: GET returns `general.ownerApproval 'manual'`, fee mode `'free'`, and all three payouts `null`.
  - `saves approval, fee and wallets`: PUT `{ ownerApproval:'automatic', fee:{ mode:'percent', percent:5, fixed:null, payer:'player' }, payout:{ bkash:{ provider:'bkash', number:'01711111111', accountType:'personal' }, nagad:null } }` → 200 with the same values echoed back. `resolveGeneral(config)` returns them.
  - `rejects bad fees`, each → 400:
    - percent `60`;
    - percent `0`;
    - fixed mode with `fixed: null`;
    - fixed `-1`;
    - free mode with `fixed: 10`.
  - `saves payout stripe keys, never returns secrets`, using the fake from `test/helpers/stripe.ts`. The response has `payout.stripe.keys.test.publishableKey` and no `secretKey` anywhere in the body (check `JSON.stringify`).
  - `general needs platform.settings`: a player token → 403.
- [ ] **Step 2: Run tests.** `pnpm --filter api test -- admin/settings`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the `general` subdocument to `platformSettingsSchema` (default `null`), along with `resolveGeneral`, the routes and `settingsJson.general`.
- [ ] **Step 4: Run the tests again.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(api): platform General settings (approval, fee, payout details)`.

### Task 3: Automatic owner approval

**Files:**
- Modify: `apps/api/src/tenancy/routes/apply.ts`; `packages/shared/src/admin.ts` (add `'owner.auto_approved'` to `PLATFORM_ACTIONS`)
- Modify: `apps/web/src/apply/ApplyPage.tsx` (the success path only)
- Test: `apps/api/test/tenancy/` (the existing apply test file; find it with `grep -rl "pending_approval" apps/api/test/tenancy`)

**Interfaces:**
- Consumes: `resolveGeneral(config)` (Task 2).

- [ ] **Step 1: Write failing tests:**
  - `automatic approval makes the owner active`: save `general.ownerApproval = 'automatic'` directly with `PlatformSettings.updateOne` and `clearSettingsCache()`. Then POST `/owners` → 201 with `owner.status === 'active'`, and the platform log has `owner.auto_approved`.
  - `manual stays pending`: the default → `'pending_approval'`.
  - `switching to automatic leaves existing pending owners pending`: seed a pending owner, switch the mode, re-read it → still `pending_approval`.
- [ ] **Step 2: Run tests.** Expected: the first one fails.
- [ ] **Step 3: Implement.**
  - The status comes from `resolveGeneral(config).ownerApproval`.
  - When automatic, log `owner.auto_approved` in addition to `owner.applied`.
  - Web: `ApplyPage` already navigates to `/owner` on success.
    - With `owner.status === 'active'`, pass `state: { applied: 'active' }`. `OwnerIndexPage` then shows a success `Alert`: `apply.live`, "Your business is live. Add your first venue." / "Ваш бизнес активен. Добавьте первую площадку."
    - Pending owners keep today's waiting notice.
    - Add a web test in the existing apply test: an active response shows `apply.live`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(api): automatic venue approval mode`.

### Task 4: Fee snapshot at booking time

**Files:**
- Modify:
  - `apps/api/src/bookings/booking.model.ts` (`platformFee` field, `bookingJson`);
  - `apps/api/src/bookings/create.ts` (`prepare`, the single create, `quoteGroup` and the group create);
  - `apps/api/src/bookings/routes/public.ts` (`quoteJson`);
  - `apps/api/src/series/engine.ts` (`bookSeries` and `seriesAvailability`);
  - `packages/shared/src/series.ts` (`SeriesPreview` gains `platformFee`).
- Test: `apps/api/test/bookings/create.test.ts`, `apps/api/test/bookings/group.test.ts`, `apps/api/test/series/` (the existing engine test)

**Interfaces:**
- Consumes: `quoteBooking({ …, fee })` and `platformFeeFor` (Task 1), and `resolveGeneral` (Task 2).
- Produces:
  - The booking field `platformFee: PlatformFeeSnapshot | null`. Mongoose type `Mixed`, default `null`. Existing documents read as `null`, so no migration is needed.
  - `bookingJson(b).platformFee`.
  - `quoteJson(q).platformFee`.
  - `SeriesPreview.platformFee: { payer: FeePayer; perGame: number[] } | null`, where `perGame` aligns with the free dates.

Implementation notes:
- `prepare()` passes `fee: source === 'online' ? { settings: (await resolveGeneral(config)).fee, currency: venue.currency } : null`. Thread `config` through `QuoteInput`.
- The series engine:
  - online (`!owner`) games compute `platformFeeFor(fee, g.price, venue.currency)`;
  - when the player pays, `total = g.price + amount`;
  - `advanceRequired` stays 0, since series have no advance today;
  - the snapshot is stored.

- [ ] **Step 1: Write failing tests:**
  - `online booking snapshots the fee` (create.test): settings fixed 50 paid by the player, then a BDT 1000 booking → the booking has `total` 105000 and `platformFee` `{ mode:'fixed', value:50, payer:'player', amount:5000 }`, and the quote endpoint returns the same `platformFee`.
  - `walk-in has no fee`: the same settings, a walk-in → `platformFee null`, total unchanged.
  - `uses the fee in force at create time`: quote at 5%, change to 10% (`clearSettingsCache()`), create → the snapshot `value` is 10.
  - `existing bookings keep their fee`: create at fixed 50, change to percent 10 → the booking still has amount 5000.
  - `each booking of a group carries its own fee` (group.test): a 2-day checkout with fixed 50 → both bookings have amount 5000, and the response `total` includes both.
  - `online series games carry the fee` (series test): player pays, fixed 50 → each game `total` = price + 5000, and the preview `platformFee.perGame` has the same amounts. An owner-created series → `platformFee null`.
- [ ] **Step 2: Run tests.** `pnpm --filter api test -- bookings/create bookings/group series`. Expected: FAIL.
- [ ] **Step 3: Implement** following the notes above.
- [ ] **Step 4: Run the tests again** with the same command, then run the whole API suite (`pnpm --filter api test`). Expected: PASS, and the existing payment tests still pass, since the default is no fee.
- [ ] **Step 5: Commit** with the message `feat(api): snapshot platform fee on online bookings and series`.

### Task 5: Owner balance, manual payouts, admin queue and Owes

**Files:**
- Create:
  - `apps/api/src/platform/payout.model.ts`;
  - `apps/api/src/platform/balance.ts`;
  - `apps/api/src/platform/routes/ownerPayouts.ts`;
  - `apps/api/src/platform/routes/adminPayouts.ts`;
  - `packages/shared/src/platformPayouts.ts` (export it from index).
- Modify:
  - `apps/api/src/tenancy/routes/owner.ts`, to mount the owner router like `gatewaysRouter`;
  - `apps/api/src/admin/routes/index.ts`, to mount the admin router;
  - `apps/api/src/admin/stats.ts` (`ownerRows` adds `owes`);
  - `packages/shared/src/admin.ts` (`AdminOwnerRowJson.owes`, and the actions `payout.confirmed` and `payout.rejected`).
- Test: `apps/api/test/platform/payouts.test.ts`

**Interfaces:**
- Consumes: the `platformFee` snapshot (Task 4) and `resolveGeneral` (Task 2).
- Produces:
  ```ts
  // shared
  export const PAYOUT_METHODS = ['bkash', 'nagad', 'stripe'] as const;
  export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
  export const PAYOUT_STATUSES = ['pending', 'confirmed', 'rejected'] as const;
  export type PlatformBalanceJson = { currency: string; owed: number; paid: number; pending: number; balance: number; payable: number };
  export type PlatformPayoutJson = { id: string; ownerId: string; ownerName?: string; currency: string; amount: number; method: PayoutMethod;
    trxId: string | null; senderNumber: string | null; status: PayoutStatus; rejectReason: string | null; createdAt: string; reviewedAt: string | null };
  export type OwnerPlatformFeeJson = { feeActive: boolean; payer: FeePayer; balances: PlatformBalanceJson[]; payouts: PlatformPayoutJson[];
    methods: { bkash: ManualWallet | null; nagad: ManualWallet | null; stripe: { publishableKey: string } | null } };
  // AdminOwnerRowJson.owes: CurrencyAmount[]  (amount may be negative = credit; only non-zero currencies)
  ```
  ```ts
  // balance.ts
  export async function platformBalances(ownerId: string, session?: ClientSession): Promise<PlatformBalanceJson[]>;
  export async function balancesByOwner(ownerIds: string[]): Promise<Map<string, CurrencyAmount[]>>; // balance per currency, for ownerRows
  ```
- **Owner routes** (`settings.edit`):
  - `GET /owners/:ownerId/platform-fee` → `OwnerPlatformFeeJson`;
  - `POST /owners/:ownerId/platform-payouts` with body `{ currency, amount, method: 'bkash'|'nagad', trxId, senderNumber }` → 201 `PlatformPayoutJson`. It rejects:
    - `amount < 1` or `amount > payable` → 400 `amount_exceeds_balance`;
    - an invalid TrxID → 400 (`normalizeTrxId`);
    - a method the admin hasn't set up → 400 `method_unavailable`;
    - a duplicate TrxID for that method → 409 `duplicate_trx`.
- **Admin routes** (`platform.owners`):
  - `GET /admin/payouts?status=pending|all&before=` → `{ payouts: PlatformPayoutJson[]; nextBefore: string | null }`, paged by `ADMIN_PAGE_SIZE`;
  - `POST /admin/payouts/:id/confirm`;
  - `POST /admin/payouts/:id/reject` with body `{ reason }`, max `SUSPEND_REASON_MAX`.
  - Each acts only on `pending` payouts (otherwise 409 `payout_not_pending`) and logs to the platform log.
- **Model:** scoped by owner, with the `tenantScoped` plugin. Admin reads use `crossTenant: true`, like `stats.ts`. Indexes: `{ ownerId, currency, status }`, `{ status, createdAt }`, and unique `{ method, trxId }` partial on string `trxId`.
- **Concurrency:** create the payout inside `runInTransaction`. Recompute `platformBalances(ownerId, session)` there, and touch the owner document first. Add `payoutLockAt: { type: Date, default: null }` to `apps/api/src/tenancy/owner.model.ts`, then write `Owner.updateOne({ _id }, { $set: { payoutLockAt: now } }, { session })`, so that two concurrent submits conflict and one retries.

- [ ] **Step 1: Write failing tests:**
  - `balance counts owing bookings only`: seed bookings with `platformFee.amount` 5000 in `confirmed`, `pending`, `cancelled` and `awaiting_payment` → `owed` 10000.
  - `manual payout waits for admin`: POST 6000 via bkash → 201 pending. GET shows `pending` 6000, `balance` 10000, `payable` 4000. Admin confirm → `paid` 6000, `balance` 4000.
  - `rejected payout frees the amount`: reject → `payable` is back to 10000 and `rejectReason` is stored.
  - `rejects a second payout that would exceed what is owed`: two concurrent POSTs of 6000 (`Promise.all`) → one 201 and one 400 `amount_exceeds_balance`.
  - `cancelled booking after payout leaves a credit`: pay and confirm 10000, then cancel one booking → `balance` −5000, `payable` 0. The admin owners list shows `owes: [{ currency:'BDT', amount:-5000 }]`.
  - `method must be set up`: nagad not configured → 400 `method_unavailable`.
  - `permissions`: a staff member without `settings.edit` → 403 on the owner route. A platform user without `platform.owners` → 403 on the admin queue.
  - `free mode with zero balance`: `feeActive false`, `balances []`.
- [ ] **Step 2: Run tests.** `pnpm --filter api test -- platform/payouts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `platformBalances` is two aggregates:
    - bookings with `platformFee: { $ne: null }` and status in `FEE_OWING_STATUSES`, grouped by currency;
    - payouts grouped by `currency` and `status`.
  - `feeActive` is `general.fee.mode !== 'free'`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(api): owner platform balance, manual payouts and admin queue`.

### Task 6: Stripe payouts to the admin

**Files:**
- Create: `apps/api/src/platform/webhookEvent.model.ts` (collection `platformWebhookEvents`, unique `eventId`, not tenant-scoped)
- Modify:
  - `apps/api/src/platform/routes/ownerPayouts.ts`;
  - `apps/api/src/payments/routes/webhooks.ts`: add `router.post('/stripe/platform', …)` **before** `'/:gateway/:ownerId'`.
- Test: `apps/api/test/platform/stripePayouts.test.ts`

**Interfaces:**
- Consumes:
  - `resolveGeneral(config).payout.stripe` (Task 2);
  - `stripeGateway(services.stripe)` `createPayment` / `handleWebhook` (`apps/api/src/payments/gateway.ts`);
  - `platformBalances` (Task 5).
- Produces:
  - **Start a payout:** `POST /owners/:ownerId/platform-payouts/stripe` with body `{ currency, amount }`. Response 201: `{ payout: PlatformPayoutJson; clientSecret: string; publishableKey: string }`.
    - It creates a `pending` payout with `method: 'stripe'`, then calls `createPayment` with `kind: 'intent'`, `metadata: { payoutId }` and `idempotencyKey: payout-${id}`, and stores `stripePaymentIntentId`.
    - The same `payable` check as Task 5 applies.
    - If `!gateway.supports(owner.country, currency)`, it returns 400 `method_unavailable`.
  - **Webhook:** `POST /webhooks/stripe/platform`. It tries the test and live secrets of the admin keys. It records the event in `platformWebhookEvents`, where a duplicate means "already processed" and returns 200.
    - On `succeeded` with a `paymentId` (that is, metadata `payoutId`; extend `paymentIdOf` to fall back to `metadata.payoutId`): the gateway amount and currency must equal the payout's, otherwise the outcome is `mismatch` and nothing changes. Then mark the payout `confirmed`.
    - On `closed` / `attempt_failed`: mark it `rejected` with reason `stripe_failed`.
  - **Expiry:** a pending Stripe payout older than 1 hour no longer counts toward `pending`. Filter by `createdAt` in `platformBalances`, for `method: 'stripe'` only.

- [ ] **Step 1: Write failing tests** using `test/helpers/stripe.ts`. Read it first for how existing webhook tests sign events.
  - `start stripe payout returns a client secret`: response 201, the payout is pending, and `clientSecret` is the fake's.
  - `webhook confirms the payout`: a signed `payment_intent.succeeded` with `metadata.payoutId` → the payout is `confirmed` and the balance drops.
  - `duplicate webhook is ignored`: the same event twice → both 200, and it is confirmed only once (`paid` counted once).
  - `amount mismatch leaves it pending`.
  - `no admin stripe → 400 method_unavailable`.
  - `owner webhook route still works`: one existing `webhooks.test.ts` case still passes. Run that whole file.
- [ ] **Step 2: Run tests.** `pnpm --filter api test -- platform/stripePayouts payments/webhooks`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(api): owners pay the platform by card with the admin's Stripe`.

### Task 7: Net revenue in reports and admin stats

**Files:**
- Modify:
  - `apps/api/src/reports/overview.ts` (`OverviewBooking.platformFee`, `earned`, plus a new `fees` total);
  - `apps/api/src/reports/routes.ts`: the projection includes `platformFee`, and the CSV gets a `platform_fee` column;
  - `apps/api/src/admin/stats.ts` (`earnedByCurrency` net, plus a new `feesByCurrency`);
  - `packages/shared/src/admin.ts` (`AdminOverviewJson.fees: { owed: CurrencyAmount[]; collected: CurrencyAmount[] }`);
  - the owner overview JSON type, wherever `revenue` is typed (find it with `grep -rn "playedRevenue" packages apps/web/src`).
- Test: `apps/api/test/reports/overview.test.ts`, `apps/api/test/admin/admin.test.ts`

**Interfaces:**
- **What counts as earned:** `earned(b)` returns what it does today minus `feeOf(b)`, where `feeOf(b) = FEE_OWING_STATUSES.includes(b.status) && b.platformFee ? b.platformFee.amount : 0`. The result is never below 0.
- **Overview totals:** the overview gains `platformFees: number`, the sum of `feeOf` over the period.
- **Admin overview:** `fees.owed` is the sum of `platformFee.amount` over owing bookings in the period. `fees.collected` is the sum of confirmed payouts by `reviewedAt` in the period.

- [ ] **Step 1: Write failing tests:**
  - `revenue is net of the platform fee`: a confirmed booking with total 105000 and a player-paid fee of 5000 → revenue 100000, `platformFees` 5000.
  - `owner-paid fee is deducted too`: total 100000, owner-paid fee 5000 → revenue 95000.
  - `cancelled booking owes no fee`: kept 30000 → revenue 30000.
  - Admin overview `earned` is net, and `fees.owed` / `fees.collected` are as seeded.
- [ ] **Step 2: Run tests.** `pnpm --filter api test -- reports admin/admin`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `earnedByCurrency`, subtract the fee inside the `$switch` branches for the played statuses (`$ifNull: ['$platformFee.amount', 0]`).
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(api): report revenue net of the platform fee`.

### Task 8: Admin > Settings > General tab (web)

**Files:**
- Create: `apps/web/src/admin/settings/GeneralTab.tsx`, `apps/web/src/admin/settings/GeneralTab.module.css`
- Modify:
  - `apps/web/src/admin/AdminSettingsPage.tsx`: `SECTIONS` becomes `['general','google','email','sms']`, and the default tab is `'general'`;
  - `en.json`, `ru.json` (`admin.settings.tab.general`, `admin.settings.general.*`).
- Test: `apps/web/test/admin/settings.test.tsx`

**Interfaces:**
- Consumes:
  - `AdminSettingsJson.general` (Task 2);
  - `PUT /admin/settings/general`, and `PUT`/`DELETE /admin/settings/payout-stripe`;
  - the page's existing `Card`, `Store` and save helpers.
- **Card 1, Venue signup:** a segmented choice, Manual or Automatic, each with a hint line.
- **Card 2, Platform fee:**
  - mode: Free, Fixed or Percent;
  - an amount input (fixed) or a percent input (percent), hidden when Free;
  - Who pays: Owner or Player;
  - a live example built from `formatMoney(100000, 'BDT', i18n.language)` and `platformFeeFor`. Strings:
    - `admin.settings.general.exampleOwner`: "Field {{base}} → player pays {{base}}, owner owes you {{fee}}";
    - `admin.settings.general.examplePlayer`: "Field {{base}} → player pays {{total}}, owner owes you {{fee}}".
  - A hint that a fixed amount applies in each owner's own currency.
- **Card 3, Where owners pay you:**
  - bKash number and Nagad number, each with an account type select, reusing the field pattern from `apps/web/src/owner/settings/PaymentMethodsFields.tsx`;
  - Stripe keys, following the field set and test/live switch of `apps/web/src/owner/settings/StripeGatewayCard.tsx`, and showing `payoutWebhookUrl` to copy.
- Saving: one Save action for cards 1–3 (wallets included). The Stripe key form has its own Save and Remove buttons, like the owner card. When `secretsAvailable` is false, the Stripe form is disabled, using the existing notice pattern.
- Look: follow the existing settings cards and `.superdesign/design-system.md`, using tokens only.

- [ ] **Step 1: Write failing tests**, using the mock-fetch pattern already in this test file:
  - `opens on General by default`: the General tab panel is visible.
  - `free hides the amount fields`.
  - `percent shows the example for player payer`: choose Percent, type 5, choose Player → text "player pays ৳1,050.00" (match with a regex, since the locale format may vary).
  - `saves general`: Save → `PUT /admin/settings/general` with the body `{ ownerApproval:'automatic', fee:{ mode:'fixed', fixed:50, percent:null, payer:'owner' }, payout:{ bkash:{…}, nagad:null } }`.
  - `shows a field error from the server`: a 400 → error shown.
- [ ] **Step 2: Run tests.** `pnpm --filter web test -- admin/settings`. Expected: FAIL.
- [ ] **Step 3: Implement**, adding the en/ru strings.
- [ ] **Step 4: Run the tests again**, plus `pnpm --filter web test -- tokens i18n`. Expected: PASS.
- [ ] **Step 5: Check it in the browser.**
  - Run `pnpm dev`, open `/admin/settings`, take Playwright screenshots in light and dark mode, and switch to Russian.
  - Check that the strings fit at 375px and 1280px.
  - Save screenshots to `.playwright-mcp/`.
- [ ] **Step 6: Commit** with the message `feat(web): General tab in admin settings`.

### Task 9: Admin payout queue and Owes column (web)

**Files:**
- Create: `apps/web/src/admin/AdminPayoutsPage.tsx`
- Modify:
  - `apps/web/src/admin/nav.ts` (add `{ to: 'payouts', key: 'admin.nav.payouts', icon: 'owner.nav.settings' }` after `owners`; use an existing NavIcon key);
  - `apps/web/src/admin/adminRoutes.tsx`;
  - `apps/web/src/admin/AdminOwnersPage.tsx` (the Owes column);
  - `apps/web/src/admin/AdminOverviewPage.tsx` (the fees figures);
  - `en.json`, `ru.json`.
- Test: `apps/web/test/admin/admin.test.tsx`

**Interfaces:**
- Consumes: `GET /admin/payouts`, the confirm and reject routes, `AdminOwnerRowJson.owes` and `AdminOverviewJson.fees` (Tasks 5 and 7).
- The page has two filter tabs, Pending (the default) and All, with a list of rows: owner, amount, method, TrxID, sender, date, status.
  - Pending rows have Confirm, and Reject, which opens `ActionDialog` with a reason.
  - Paging uses `useCursor`.
- Owes column:
  - each non-zero currency is shown with `formatMoney`;
  - negative amounts show `admin.owners.credit` ("Credit {{amount}}"), with a neutral badge tone;
  - when there are no entries, it shows "—".
- The nav entry is hidden when the admin lacks `platform.owners`, following how the nav already filters by permission.

- [ ] **Step 1: Write failing tests:**
  - `lists pending payouts and confirms one`: Confirm → `POST /admin/payouts/p1/confirm`, and the row leaves the list.
  - `reject needs a reason`.
  - `owners list shows owes and credit`: rows with `owes` `[{BDT, 4000}]` and `[{BDT, -5000}]` → "৳40.00" and "Credit ৳50.00" (match with a regex).
- [ ] **Step 2: Run tests.** `pnpm --filter web test -- admin/admin`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again**, plus the tokens and i18n tests. Expected: PASS. Check it in the browser as in Task 8.
- [ ] **Step 5: Commit** with the message `feat(web): admin payout queue and owner balances`.

### Task 10: Owner "Platform fee" page (web)

**Files:**
- Create:
  - `apps/web/src/owner/platform/PlatformFeePage.tsx`;
  - `apps/web/src/owner/platform/PlatformFeePage.module.css`;
  - `apps/web/src/owner/platform/PayPlatformDialog.tsx`.
- Modify:
  - `apps/web/src/owner/shell/nav.ts` (`{ to: 'platform-fee', key: 'owner.nav.platformFee', group: 'setup', perms: ['settings.edit'] }`);
  - `apps/web/src/owner/ownerRoutes.tsx`;
  - `apps/web/src/owner/shell/OwnerShell.tsx`, to hide the nav item when `feeActive` is false and no balance is non-zero. Fetch `GET /owners/:ownerId/platform-fee` once in `OwnerProvider` or the shell, whichever already loads per-owner data.
  - `en.json`, `ru.json`.
- Test: `apps/web/test/owner/platformFee.test.tsx`

**Interfaces:**
- Consumes:
  - `OwnerPlatformFeeJson`;
  - `POST …/platform-payouts` (manual) and `POST …/platform-payouts/stripe` (Tasks 5 and 6);
  - the existing Stripe Payment Element component used by the player pay page (`grep -rln "PaymentElement" apps/web/src`).
- **Page:**
  - one balance card per currency: "You owe {{amount}}", with "Awaiting check {{pending}}" when pending > 0;
  - or "Credit {{amount}}" when balance < 0, with no Pay button;
  - a "Pay now" button when `payable > 0`;
  - a history list with status badges (pending, confirmed, rejected plus the reason).
  - An intro line tells the owner who pays the fee, based on `payer`.
- **Dialog:**
  1. choose a method (only those in `methods`);
  2. enter an amount, prefilled with `payable` and limited to `payable`.
  - bKash/Nagad: show the admin's number and account type, then the TrxID and sender number fields. Submit uses the manual route.
  - Stripe: create the intent, mount the Payment Element with `publishableKey` / `clientSecret`, then confirm. On success it shows "Payment received; it shows as paid in a moment" and refetches the balances.

- [ ] **Step 1: Write failing tests:**
  - `shows balance and pending`;
  - `shows credit with no pay action`;
  - `hides methods the admin has not set`;
  - `manual payout submits trx and sender` → the POST body is `{ currency:'BDT', amount:4000, method:'bkash', trxId:'ABC12345XY', senderNumber:'01711111111' }`;
  - `amount over payable is blocked` client-side, with the server error also shown.
  - `nav item hidden in free mode with no balance` (in the shell test or this file).
- [ ] **Step 2: Run tests.** `pnpm --filter web test -- owner/platformFee owner/shell`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again**, plus the tokens and i18n tests. Expected: PASS. Check it in the browser (light/dark, ru, 375px).
- [ ] **Step 5: Commit** with the message `feat(web): owners see and pay their platform fee balance`.

### Task 11: Fee lines for players and owners, guide and design doc

**Files:**
- Modify:
  - `apps/web/src/lib/types.ts`: `QuoteJson.platformFee`, `BookingJson.platformFee`, and the series preview type;
  - `apps/web/src/checkout/BookingSummary.tsx`;
  - `apps/web/src/bookings/BookingFacts.tsx`;
  - `apps/web/src/bookings/Receipt.tsx` and `receiptPdf.ts`;
  - `apps/web/src/owner/bookings/OwnerBookingPage.tsx`;
  - the series checkout preview (`grep -rln "freeCount" apps/web/src/series`);
  - the owner overview revenue card, which gets a "Platform fee" figure when it is > 0;
  - `apps/web/src/admin/docs/content.ts` and `content.ru.ts`: a new `general` topic covering approval, fee modes, who pays with the 1000 / 1050 example, payout details and the Stripe webhook URL, plus the payout queue;
  - `.superdesign/design-system.md`: the General tab, the payout queue and the owner Platform fee page;
  - `en.json`, `ru.json` (`checkout.platformFee`: "Platform fee" / "Сервисный сбор").
- Test: `apps/web/test/checkout/` (the existing summary test), `apps/web/test/bookings/` (the existing facts and receipt tests), `apps/web/test/owner/bookingDetail.test.tsx`, `apps/web/test/admin/docs.test.tsx`

**Interfaces:**
- Consumes: `platformFee` on the quote, booking and series preview JSON (Task 4).
- **Player screens:** when `platformFee?.payer === 'player'`, a "Platform fee" row appears above Total with `platformFee.amount`. Multi-day checkouts show the sum across items. When the owner pays, there is no row.
- **Owner booking detail:** when `platformFee` is non-null, it shows a row "Platform fee ({{payer}})". The payer labels are "paid by player" or "paid by you".

- [ ] **Step 1: Write failing tests:**
  - the summary shows "Platform fee ৳50.00" when the player pays;
  - no row when the owner pays or the fee is `null`;
  - the receipt includes the row;
  - the owner detail shows "paid by you";
  - the docs test finds the `general` topic in both languages.
- [ ] **Step 2: Run tests.** `pnpm --filter web test -- checkout bookings owner/bookingDetail admin/docs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suites:** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: everything passes except the failures that already existed before this work:
  - `owner/today/TodayPage.module.css:11` in the token guard;
  - the owner settings `useLocation()` Router tests;
  - the owner provider test.
  List any other failure and fix it before moving on.
- [ ] **Step 5: Check it end to end in the browser:**
  1. As admin: set a fixed fee of 50 paid by the player, and set a bKash number.
  2. As a player: book a 1000 court and see 1050 at checkout.
  3. As the owner: see "You owe ৳50" and submit a bKash payout.
  4. As admin: confirm it.
  5. As the owner: see the balance at 0.
  Take screenshots in light, dark and ru.
- [ ] **Step 6: Commit** with the message `feat(web): platform fee on checkout, receipts and booking detail; admin guide`.
