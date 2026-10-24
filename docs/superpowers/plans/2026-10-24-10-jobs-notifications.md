# Jobs & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bookings move on by themselves and people hear about it. Background jobs expire payment holds, auto-reject stale pending bookings, auto-complete finished ones, send reminders, warn about expiring payment links and re-dispatch stuck refunds. Players, guests and staff get email/SMS for every booking event. Real email and SMS providers replace the console senders, and two one-off migrations repair rows that predate Plan 09.

**Architecture:**
- **Notifications go through an outbox.** Every booking change that should notify someone writes `Notification` rows inside its own transaction. If the change rolls back, so does the message. A delivery job renders each row from a pure template (en/ru) and sends it through `services.email` / `services.sms`, retrying with backoff. A provider outage never fails a booking request.
- **Jobs run in-process on MongoDB, with no new infrastructure.** A small runner ticks every 15 s. Each job is guarded by a lease document in `jobRuns`, so with several API instances each job runs once per interval. Every job is an exported function `(now, deps)`; tests call these directly with the fake clock.
- **Migrations** run at server start from a registry recorded in `migrations`.

**Tech Stack:** Express 5, Mongoose 8 (replica-set transactions), Zod 3, Vitest + MongoMemoryReplSet, nodemailer (SMTP email), Twilio REST API via `fetch` (SMS, no SDK).

**Spec:** `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md`. Relevant sections:
- §11: hold expiry, auto-reject and auto-complete;
- §15: notifications and the job queue;
- §18: providers and the queue choice are the builder's call.

Also roadmap row 10 in `docs/superpowers/plans/2026-10-23-roadmap.md`, and the Plan 09 carry-overs.

## Global Constraints

**Lifecycle**
- `awaiting_payment` holds its slots for 10 minutes (`HOLD_MINUTES`), then auto-expires; payment links hold 32 (`LINK_HOLD_MINUTES`). (§11)
- A pending booking not acted on is auto-rejected N hours before slot start. N is the owner setting `pendingAutoRejectHours`, default 2, range 0–72, and is owner level only. (§11, `packages/shared/src/settings.ts`)
- `completed` is set automatically after the end time (or by check-in). (§11)

**Notifications**
- Channels are email and SMS behind interfaces. Phase 1 has no push. (§15)
- Events: booking created (pending/confirmed), confirmed by owner, rejected, cancelled, refund issued, reminder before the slot (2 hours), payment hold expiring. Owner/staff are notified of new pending bookings. (§15)
- Messages are English and Russian (`LOCALES = ['en','ru']`). Times are shown in the venue's timezone; money is integer minor units, formatted with `formatMoney`. (§4)

**Code conventions**
- Every owner-scoped query carries `ownerId` (tenantScoped plugin). Cross-tenant job queries use `.setOptions({ crossTenant: true })`, like `reconcileRefunds`.
- Booking status changes go through `transition()` (`apps/api/src/bookings/transition.ts`). System actors are `{ ownerId, userId: null }`.
- Refund writes use `{ timestamps: false }` and set `updatedAt` from the clock (Plan 09 convention).
- The clock is always `services.now()`. Never call `new Date()` in job or notification code.

**Scope and process**
- API only, with no UI, so the CLAUDE.md UI rules don't apply.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands:
  - `node_modules/.bin/pnpm --filter api exec vitest run <files>`;
  - the whole suite, `node_modules/.bin/pnpm test`;
  - `node_modules/.bin/pnpm -r typecheck` and `node_modules/.bin/pnpm lint` before each commit.

## Decisions made in this plan (builder's calls)

**Infrastructure**
- **Job queue: an in-process runner plus MongoDB leases, not BullMQ or Agenda.** Every job is a periodic sweep, so there are no per-booking delayed jobs. Leases give single-run semantics across instances without adding Redis. §18 leaves the choice open.
- **Providers: SMTP for email via nodemailer, Twilio REST for SMS.** SMTP works with any mail provider, and Twilio needs no SDK. Both are required in production, the same rule `PAYMENTS_ENCRYPTION_KEY` follows. Without them phone OTP would silently go to a log.

**Notification content**
- **Language:** messages use the owner's `defaultLocale`, because users have no locale field yet.
- **Recipients:**
  - A player gets email if `email && emailVerified`, and SMS if `phone && phoneVerified`. Unverified contacts get nothing, since they may belong to someone else.
  - A guest, or a walk-in with no `playerId`, gets SMS to `guest.phone`.
  - Staff are active members whose role has `booking.confirm` and who can see the venue. Each gets email if they have an address, otherwise SMS.
- **Links:** `${appUrl}/b/${reference}` for players and guests, and `${appUrl}/dashboard/bookings/${bookingId}` for staff. Plans 12 and 13 must serve these paths.

**Sweep rules**
- **"Payment hold expiring"** is sent only for card-link holds (walk-in QR), 10 minutes before expiry. A 10-minute in-app hold happens while the player is on the checkout screen, where a message adds nothing.
- **Reminders** are sent 120 minutes before start. They are skipped for bookings created inside that window, because the confirmation already says when.
- **Stale messages:** a reminder whose booking is no longer `confirmed`, or a hold warning whose booking is no longer `awaiting_payment`, is dropped at delivery and not sent.

## Review Focus

1. **Two API instances tick at the same moment.** Expected: each job body runs once per interval. With no Redis, the lease is the only guard. Test in Task 5.
2. **Staff confirm a pending booking at the same moment auto-reject sweeps it.** Expected: exactly one wins. The loser changes nothing and sends nothing. The player gets one message that matches the final status. Test in Task 4.
3. **A payment webhook arrives after the expiry job expired the hold.** Expected: Plan 08's late-payment path still revives the booking if the slot is free, or refunds it if not. The job must not break that path, for example by cancelling the intent or leaving a stale lock. Test in Task 4.
4. **The SMS or email provider is down.** Expected: booking requests still succeed. The notification is retried with backoff and marked `failed` after 5 attempts. One bad row never blocks the rest of the batch. Tests in Tasks 2 and 3.
5. **A venue in a non-UTC timezone, and the Russian locale.** Expected: messages show the venue's local wall time (Asia/Dhaka 17:00Z shows as 23:00) and Russian text, with no English leaking into `ru`. Test in Task 1.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/notifications/templates.ts` (new) | Pure: events, data shape, `renderNotice` in en/ru |
| `apps/api/src/notifications/notification.model.ts` (new) | Outbox row |
| `apps/api/src/notifications/outbox.ts` (new) | Recipients, `noticeBooking` (enqueue in txn), `deliverNotifications` |
| `apps/api/src/notifications/senders.ts` (new) | SMTP and Twilio senders |
| `apps/api/src/jobs/sweeps.ts` (new) | Expire holds, auto-reject, auto-complete, reminders, hold warnings |
| `apps/api/src/jobs/runner.ts` (new) | `JobRun` lease model, `JOBS` registry, `runDueJobs`, `startJobs` |
| `apps/api/src/migrations/index.ts` (new) | `Migration` model, registry, `runMigrations` |
| `apps/api/src/bookings/create.ts`, `cancel.ts`, `routes/owner.ts`, `payments/apply.ts`, `payments/refunds.ts` | Enqueue notices at each event |
| `apps/api/src/config.ts`, `services.ts`, `server.ts` | Provider config, real senders, starting jobs and migrations |

---

### Task 1: Notification templates

**Files:**
- Create: `apps/api/src/notifications/templates.ts`
- Test: `apps/api/test/notifications/templates.test.ts`

**Interfaces:**
- Consumes: `formatMoney(minor, currency, locale)` and `Locale` from `@booking/shared`.
- Produces:
  - `NOTICE_EVENTS = ['booking_pending','booking_confirmed','booking_rejected','booking_cancelled','refund_issued','booking_reminder','hold_expiring','staff_new_pending'] as const` and `type NoticeEvent`.
  - `type NoticeData = { bookingId: string; reference: string; venueName: string; turfName: string; timezone: string; startAt: string; endAt: string; currency: string; amount?: number; reason?: string | null; customerName?: string; holdExpiresAt?: string }`. Times are ISO strings. `amount` is the refund amount for `refund_issued`, or the amount being refunded for `booking_cancelled` (0 or absent means no refund line).
  - `renderNotice(event: NoticeEvent, locale: Locale, data: NoticeData, appUrl: string): { subject: string; text: string; sms: string }`.

**Content per event.** Write the English as given and add a natural Russian equivalent. Every message names the venue, turf, local date and time range, and reference.

| Event | Must say |
|---|---|
| `booking_pending` | The request was received and the venue will confirm it. |
| `booking_confirmed` | The booking is confirmed. |
| `booking_rejected` | The venue declined; include `reason` when present. |
| `booking_cancelled` | The booking is cancelled; when `amount > 0`, add "Refund: {money}". |
| `refund_issued` | "{money} has been refunded". |
| `booking_reminder` | The game starts at {time}. |
| `hold_expiring` | Pay before {local hold expiry time} or the slot is released. |
| `staff_new_pending` | New booking request from {customerName}, waiting for confirmation. |

**Links and formatting**
- `staff_new_pending` links to `${appUrl}/dashboard/bookings/${bookingId}`. Every other event links to `${appUrl}/b/${reference}`.
- `sms` is one short line plus the link, with no greeting.
- Dates use `Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' })`. The end time uses `timeStyle: 'short'` only.

- [ ] **Step 1: Write the failing tests.**

  Shared fixture: `data` with `timezone: 'Asia/Dhaka'`, `startAt: '2026-11-10T17:00:00.000Z'`, `endAt: '2026-11-10T18:00:00.000Z'`, `currency: 'BDT'`, `reference: 'BK7Q2M'`, `venueName: 'Arena'`, `turfName: 'Court 1'`, `bookingId: 'b1'`, and `appUrl` `'https://app.test'`.

  Tests:
  - `'every event renders a subject, text and sms in both locales'`: loop over `NOTICE_EVENTS × LOCALES`. All three fields are non-empty, `text` and `sms` contain `BK7Q2M`, and the `ru` text differs from the `en` text.
  - `'times are shown in the venue timezone'`: en `booking_confirmed` text contains `11:00 PM`; ru contains `23:00`; neither contains `17:00`.
  - `'refund amounts are formatted in the booking currency'`: `refund_issued` with `amount: 150000` contains `formatMoney(150000,'BDT','en')`.
  - `'cancelled without a refund has no refund line'`: with `amount: 0`, the en text does not contain `Refund`.
  - `'rejected includes the reason when given'`: with `reason: 'Pitch flooded'`, the text contains it.
  - `'staff notice links to the dashboard, others to the booking page'`: the staff text contains `https://app.test/dashboard/bookings/b1`; the confirmed text contains `https://app.test/b/BK7Q2M`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/notifications/templates.test.ts`
  Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement `templates.ts`.**

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): notification templates in English and Russian`.

---

### Task 2: Outbox and delivery

**Files:**
- Create: `apps/api/src/notifications/notification.model.ts`, `apps/api/src/notifications/outbox.ts`
- Test: `apps/api/test/notifications/outbox.test.ts`

**Interfaces:**
- Consumes: `renderNotice` and `NoticeData` (Task 1); `Booking`, `Venue`, `Turf`, `Owner`, `User`, `Membership`, `Role`; `AppServices`; `Config`.
- Produces:
  - **The `Notification` model**, with tenantScoped:

    | Field | Type / default |
    |---|---|
    | `ownerId` | |
    | `bookingId` | ObjectId, may be null |
    | `event` | `NOTICE_EVENTS` |
    | `channel` | `'email' \| 'sms'` |
    | `to` | String |
    | `locale` | |
    | `data` | Mixed |
    | `status` | `'pending' \| 'sent' \| 'failed'`, default `'pending'` |
    | `attempts` | default 0 |
    | `nextAttemptAt` | Date |
    | `lastError` | null |
    | `sentAt` | null |
    | `dedupeKey` | String, unique |

    It also has timestamps and an index `{ status: 1, nextAttemptAt: 1 }`.
  - `MAX_NOTICE_ATTEMPTS = 5`. The backoff after attempt n is `2^(n-1)` minutes: 1, 2, 4, 8.
  - `noticeBooking(event: NoticeEvent, booking: BookingDoc, now: Date, session: ClientSession, extra?: { amount?: number; reason?: string | null; refundId?: string }): Promise<number>`. It:
    - loads the venue, turf and owner locale in the session;
    - builds `NoticeData`; `customerName` is the guest name or the player's name;
    - resolves recipients: the customer's recipients for every event except `staff_new_pending`, which goes to staff (see "Recipients" above);
    - upserts one row per recipient with `$setOnInsert`, keyed by `dedupeKey = [event, bookingId, extra.refundId ?? '', channel, to].join(':')`, with `nextAttemptAt: now`;
    - returns the number of rows inserted.

    It uses upsert, not insert, so a repeat is a no-op inside a transaction and never an E11000 abort.
  - `deliverNotifications(now: Date, deps: { config: Config; services: AppServices }): Promise<{ sent: number; failed: number; dropped: number }>`. It:
    - takes up to 100 `pending` rows with `nextAttemptAt <= now`, cross-tenant, sorted by `nextAttemptAt`;
    - claims each one with a conditional update on `{ status: 'pending', attempts }`: `$inc` attempts and set `nextAttemptAt` by the backoff;
    - drops stale rows (see the decision above) as `failed` with `lastError: 'stale'`, without sending;
    - renders the row with `config.appUrl`;
    - for email, sends `{ to, subject, text }`; for SMS, sends `sms`;
    - on success sets `sent` and `sentAt`;
    - on a throw records `lastError` (the message) and marks the row `failed` once attempts reach `MAX_NOTICE_ATTEMPTS`.

    Each row is handled in its own try/catch.

- [ ] **Step 1: Write the failing tests.** Seed the owner, venue, turf and a confirmed booking with the existing helpers (`test/helpers/venues.ts`, `tenancy.ts`).
  - `'a registered player with verified email and phone gets both channels'`: 2 rows.
  - `'unverified contacts are skipped'`: with `emailVerified: false`, only the SMS row.
  - `'a guest booking notifies the guest phone by sms'`.
  - `'staff_new_pending goes to members who can confirm at that venue'`:
    - an owner-role member and a manager with `allVenues` each get one;
    - staff-role members (no `booking.confirm`) do not;
    - a manager assigned to another venue does not;
    - a disabled membership does not.
  - `'the same event twice inserts once'`: calling `noticeBooking` twice in two transactions leaves a single row per recipient.
  - `'delivery sends and marks rows sent'`: `services.sms.sent` has the rendered sms; the row is `sent`.
  - `'a failing provider is retried with backoff and fails after 5 attempts'` (Review Focus 4): make `services.sms.send` throw.
    - After the first run: attempts 1, still `pending`, `nextAttemptAt = now + 1 min`.
    - Advance the clock and repeat. After 5 attempts the row is `failed` with `lastError` set.
    - A second, healthy row in the same batch is `sent`.
  - `'a reminder for a booking no longer confirmed is dropped'`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/notifications/outbox.test.ts`

- [ ] **Step 3: Implement the model and `outbox.ts`.**

- [ ] **Step 4: Run them.** Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): notification outbox with retrying delivery`.

---

### Task 3: Notify at each booking event

**Files:**
- Modify:
  - `apps/api/src/bookings/create.ts` (`createBooking`)
  - `apps/api/src/bookings/routes/owner.ts` (confirm, reject)
  - `apps/api/src/payments/apply.ts` (`confirm`)
  - `apps/api/src/bookings/cancel.ts` (`cancelBooking`)
  - `apps/api/src/payments/refunds.ts` (`settleRefund`)
- Test: `apps/api/test/notifications/events.test.ts`

**Interfaces:**
- Consumes: `noticeBooking` (Task 2).
- Produces: notices enqueued inside the same transaction as each change.

| Where | When | Event(s) |
|---|---|---|
| `createBooking` | result `pending` | `booking_pending` and `staff_new_pending` |
| `createBooking` | result `confirmed` | `booking_confirmed` |
| `createBooking` | `awaiting_payment` | none |
| owner confirm route | pending → confirmed | `booking_confirmed` |
| owner reject route | | `booking_rejected` with `reason` |
| `apply.ts` `confirm()` | confirm or revive | `booking_confirmed` |
| `cancelBooking` | | `booking_cancelled` with `amount` = the refund amount reserved by this cancel |
| `settleRefund` | the row moves to `succeeded` (card dispatch or webhook, cash `record-cash`) | `refund_issued` with `amount: row.amount`, `refundId` |

`settleRefund` sends nothing for a failed refund, or for a move from `succeeded` to `failed`.

- [ ] **Step 1: Write the failing tests.** Drive each case through the public flows the existing tests use (routes, or `createBooking` / `cancelBooking` / the webhook helper in `test/helpers/stripe.ts`), then assert the `Notification` rows.
  - `'a guest booking notifies the guest and the venue staff'`.
  - `'a registered no-advance booking sends a confirmation'`.
  - `'a hold sends nothing until the payment confirms it'`: none after create; `booking_confirmed` after the `payment_intent.succeeded` webhook.
  - `'staff confirm and reject notify the customer'`: reject with reason `'Pitch flooded'` stores `data.reason`.
  - `'a cancel with a refund notifies cancellation and, once settled, the refund'`:
    - card at 80 h with rules `[{96,100},{72,40}]`;
    - `booking_cancelled` with `data.amount` = 40%;
    - `refund_issued` once the fake Stripe refund succeeds.
  - `'a cash refund notifies when staff record it'`: no `refund_issued` while `pending`; one after `record-cash`.
  - `'a failed refund sends no refund notice'`: `fake.refundStatus = 'failed'`.
  - `'a provider outage never fails a booking'` (Review Focus 4): `services.sms.send` throws, and the guest booking route still answers 201.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/notifications/events.test.ts`

- [ ] **Step 3: Add the `noticeBooking` calls.**

- [ ] **Step 4: Run the notification, booking and payment tests.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/notifications test/bookings test/payments`
  Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): notify players, guests and staff of booking events`.

---

### Task 4: Lifecycle sweeps

**Files:**
- Create: `apps/api/src/jobs/sweeps.ts`
- Test: `apps/api/test/jobs/sweeps.test.ts`

**Interfaces:**
- Consumes:
  - `transition`, `lockTurf`, `runInTransaction`, `ownerSettings` (`venues/effective.ts`);
  - `noticeBooking` (Task 2), `LINK_HOLD_MINUTES`, `Payment`.
- Produces. Each function returns how many bookings it changed or noticed. Each processes at most `SWEEP_BATCH = 200` bookings cross-tenant, one transaction per booking. A per-booking throw is logged as `console.error('[jobs] <name> of <id> failed', err)` and the sweep continues.
  - **`expireHolds(now)`**
    - Selects `awaiting_payment` with `holdExpiresAt <= now`.
    - In the transaction: `lockTurf`, re-read the booking, recheck it is still `awaiting_payment` with `holdExpiresAt <= now`, then `transition(system, booking, 'expired', now, session)`.
    - It does not touch the payment or the Stripe intent; Plan 08's late-payment path owns that.
  - **`autoRejectPending(now)`**
    - Selects `pending` with `startAt <= now + 72h`.
    - Per owner, reads `ownerSettings(ownerId).pendingAutoRejectHours` (cached per run) and keeps bookings with `startAt - hours <= now`.
    - Calls `transition(system, b, 'rejected', now, session, { rejectReason: 'Not confirmed in time' })`, then `noticeBooking('booking_rejected', …, { reason: 'Not confirmed in time' })`.
  - **`autoCompleteBookings(now)`**: selects `confirmed` with `endAt <= now` and calls `transition(system, b, 'completed', now, session)`. No notice.
  - **`sendReminders(now)`**
    - Selects `confirmed` with `now < startAt <= now + REMINDER_LEAD_MINUTES` (`REMINDER_LEAD_MINUTES = 120`) and `createdAt <= startAt - REMINDER_LEAD_MINUTES`.
    - Calls `noticeBooking('booking_reminder', …)`; the dedupe key makes repeats no-ops.
  - **`warnExpiringHolds(now)`**
    - Selects `awaiting_payment` with `now < holdExpiresAt <= now + HOLD_WARNING_MINUTES` (`HOLD_WARNING_MINUTES = 10`) that have a `pending` card Payment with `kind: 'link'`.
    - Calls `noticeBooking('hold_expiring', …)`, with `data.holdExpiresAt` set.

- [ ] **Step 1: Write the failing tests.** Use `services.clock.advance` and call each sweep with `services.now()`.
  - **expireHolds**
    - `'a lapsed hold expires and frees its slot'`: the status is `expired`, the slot locks are gone, a `booking.expired` system activity is logged, and the slot is bookable again.
    - `'a live hold is left alone'`.
  - **Review Focus 3:** `'a payment that lands after the job expired the hold still revives the booking'`.
    - Hold, advance 11 min, `expireHolds`, then the `payment_intent.succeeded` webhook. The booking is `confirmed`.
    - With the slot taken by someone else in between, the payment is refunded instead (`late_payment` refund row).
  - **autoRejectPending**
    - `'a pending booking is auto-rejected at the owner threshold'`:
      - default 2 h: at start − 2h01m it is still `pending`; at start − 2h it is `rejected` with `rejectReason`, a `booking_rejected` notice, and the locks freed.
      - an owner with `pendingAutoRejectHours: 0` rejects at `startAt`.
    - `'auto-reject and a staff confirm racing: one wins'` (Review Focus 2): `Promise.allSettled([autoRejectPending(now), POST confirm])`.
      - The final status is `rejected` or `confirmed`.
      - Exactly one of the `booking_rejected` / `booking_confirmed` notices exists, and it matches the final status.
      - The loser is a 409 (route) or a skipped booking (sweep).
  - **autoCompleteBookings**: `'confirmed bookings complete after their end time'`. `pending` and `awaiting_payment` past their end are not completed by this sweep.
  - **sendReminders**
    - `'a reminder is enqueued once inside the two-hour window'`: running it twice gives one row per recipient.
    - `'a booking made inside the window gets no reminder'`.
  - **warnExpiringHolds**: `'a payment-link hold is warned ten minutes before expiry; an in-app hold is not'`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/jobs/sweeps.test.ts`

- [ ] **Step 3: Implement `sweeps.ts`.**

- [ ] **Step 4: Run them, plus the booking and payment tests.** Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): sweeps for hold expiry, auto-reject, auto-complete, reminders`.

---

### Task 5: Job runner with leases

**Files:**
- Create: `apps/api/src/jobs/runner.ts`
- Modify: `apps/api/src/config.ts` (`jobsEnabled`), `apps/api/src/server.ts`, `apps/api/test/helpers/testApp.ts` (`testConfig.jobsEnabled: false`), `apps/api/test/config.test.ts`
- Test: `apps/api/test/jobs/runner.test.ts`

**Interfaces:**
- Consumes: the sweeps (Task 4), `deliverNotifications` (Task 2), `reconcileRefunds` (`payments/refunds.ts`).
- Produces:
  - `type JobDeps = { config: Config; services: AppServices }`.
  - `type Job = { name: string; everyMs: number; run(now: Date, deps: JobDeps): Promise<unknown> }`.
  - `JOBS: Job[]`:

    | name | everyMs |
    |---|---|
    | `expire-holds` | 30 000 |
    | `auto-reject` | 60 000 |
    | `auto-complete` | 300 000 |
    | `reminders` | 60 000 |
    | `hold-warnings` | 60 000 |
    | `deliver-notifications` | 15 000 |
    | `reconcile-refunds` | 300 000 |
  - The `JobRun` model is global, with no `ownerId` and no tenantScoped: `{ _id: name, holder: String, leaseUntil: Date, lastStartedAt: Date }`. `LEASE_MS = 5 * 60_000`.
  - `runDueJobs(jobs: Job[], deps: JobDeps, holder: string): Promise<string[]>` returns the names it ran.
    - **Acquire:** `findOneAndUpdate({ _id: name, leaseUntil: { $lte: now }, lastStartedAt: { $lte: now - everyMs } }, { $set: { holder, leaseUntil: now + LEASE_MS, lastStartedAt: now } }, { upsert: true, new: true })`. An E11000 means another holder has it: skip the job.
    - **Run:** each job runs in its own try/catch, logging `console.error('[jobs] <name> failed', err)`.
    - **Release:** afterwards, set `leaseUntil: now` where `holder` matches.
  - `startJobs(deps: JobDeps, opts?: { tickMs?: number; jobs?: Job[] }): { stop(): Promise<void> }`.
    - `tickMs` defaults to 15 000, and `holder` is `${hostname}:${pid}:${random}`.
    - Ticks never overlap: the next tick is scheduled after the previous one finishes.
    - `stop()` waits for an in-flight tick.
  - `Config.jobsEnabled: boolean`, from env `JOBS_ENABLED` (`'true' | 'false'`, default `'true'`).
  - `server.ts` calls `startJobs` when `jobsEnabled`, and on `SIGTERM` / `SIGINT` calls `stop()` and then exits.

- [ ] **Step 1: Write the failing tests.** Use stub jobs that count calls, plus the fake clock.
  - `'a due job runs once and not again before its interval'`.
  - `'two holders ticking at once run each job once'` (Review Focus 1): `Promise.all([runDueJobs(jobs, deps, 'a'), runDueJobs(jobs, deps, 'b')])`. Each counter is 1.
  - `'a throwing job is logged, others still run, and its lease is released'`.
  - `'a lease left by a crashed holder is taken once it lapses'`: plant a `JobRun` with `leaseUntil` in the future; nothing runs until the clock passes it.
  - `'startJobs ticks until stopped'`: `tickMs: 10`; after `stop()` resolves, the counters stop moving.
  - `'JOBS registers every sweep, delivery and refund reconcile'`: the names match the table.
  - Config: `JOBS_ENABLED=false` gives `jobsEnabled: false`; unset gives `true`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/jobs/runner.test.ts test/config.test.ts`

- [ ] **Step 3: Implement `runner.ts`, the config and the server wiring.**

- [ ] **Step 4: Run the whole suite.** Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): lease-guarded job runner; schedule refund reconcile`.

---

### Task 6: Real email and SMS senders

**Files:**
- Create: `apps/api/src/notifications/senders.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/services.ts` (`defaultServices`), `apps/api/package.json` (add `nodemailer` and `@types/nodemailer` with `pnpm --filter api add`)
- Test: `apps/api/test/notifications/senders.test.ts`, `apps/api/test/config.test.ts`

**Interfaces:**
- Consumes: the `EmailSender` and `SmsSender` interfaces (`services.ts`).
- Produces:
  - `smtpEmailSender(opts: { url: string; from: string }, createTransport = nodemailer.createTransport): EmailSender`. It calls `sendMail({ from, to, subject, text })`.
  - `twilioSmsSender(opts: { accountSid: string; authToken: string; from: string }, fetchFn: typeof fetch = fetch): SmsSender`. It:
    - POSTs to `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    - sends `application/x-www-form-urlencoded` `To`, `From` and `Body`, with `Authorization: Basic base64(sid:token)`;
    - throws `Error('Twilio <status>: <message>')` on a non-2xx answer.
  - New `Config` fields:
    - `email?: { smtpUrl: string; from: string }`, from env `SMTP_URL` and `EMAIL_FROM`;
    - `sms?: { accountSid: string; authToken: string; from: string }`, from env `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`.
  - Validation:
    - Each group is all-or-nothing; a partial group is a `ConfigError` naming the missing keys.
    - Both groups are required when `NODE_ENV=production`.
  - `defaultServices` uses the real senders when the group is configured and keeps the console senders otherwise.

- [ ] **Step 1: Write the failing tests.**
  - `'twilio sender posts the message with basic auth'`: assert on the captured URL, method, auth header and decoded form body.
  - `'twilio errors surface status and message'`: the stub returns 400 `{ message: 'Invalid To' }`, and `send` rejects with `Twilio 400: Invalid To`.
  - `'smtp sender passes from, to, subject and text'`: use a stub transport.
  - Config tests:
    - only `SMTP_URL` set fails with `EMAIL_FROM` in the message;
    - production without the Twilio vars fails;
    - all set parses both groups.
  - `'defaultServices picks real senders only when configured'`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/notifications/senders.test.ts test/config.test.ts`

- [ ] **Step 3: Implement.** Also add the new env keys, commented out, to `.env.example` if the repo has one.

- [ ] **Step 4: Run the whole suite.** Expected: PASS.

- [ ] **Step 5: Commit.** Message: `feat(api): SMTP email and Twilio SMS senders`.

---

### Task 7: Startup migrations for pre-Plan-09 rows

**Files:**
- Create: `apps/api/src/migrations/index.ts`
- Modify: `apps/api/src/server.ts` (run after `ensureSystemRoles`, before `listen`)
- Test: `apps/api/test/migrations.test.ts`

**Interfaces:**
- Consumes: `Refund`, `Payment`.
- Produces:
  - The `Migration` model is global: `{ _id: id, appliedAt: Date, changed: Number }`.
  - `MIGRATIONS: { id: string; run(): Promise<number> }[]`, applied in order:
    1. **`2026-10-24-refund-method`:** `Refund.updateMany({ method: { $exists: false } }, { $set: { method: 'card' } })`, cross-tenant, with `timestamps: false`. Every Plan 08 refund was a gateway refund. Pending ones then reach `reconcileRefunds`, which adopts them through `findRefund`.
    2. **`2026-10-24-payment-excess`:** collect the distinct `paymentId`s of refunds with reason `late_payment` or `duplicate_payment`, then `Payment.updateMany({ _id: { $in: ids }, excess: { $ne: true } }, { $set: { excess: true } })`, cross-tenant.
  - `runMigrations(now: Date): Promise<string[]>` runs each migration not yet recorded, records it, and returns the ids it ran. A second process racing on the record write (E11000) is ignored; both migrations are idempotent.

- [ ] **Step 1: Write the failing tests.** Insert legacy rows with `Refund.collection.insertOne`, bypassing validation, in the Plan 08 shape: no `method`, `attempts` or `ruleApplied`.
  - `'plan 08 refunds get method card'`.
  - `'payments refunded as late or duplicate are marked excess; others are not'`. A payment with only a `cancellation` refund is untouched.
  - `'a second run applies nothing'`: it returns `[]`.
  - `'a cancel after migration no longer draws from the old duplicate payment'`: the Plan 09 Important-1 scenario on a legacy row, through `cancelBooking`.

- [ ] **Step 2: Run them and watch them fail.**
  Run: `node_modules/.bin/pnpm --filter api exec vitest run test/migrations.test.ts`

- [ ] **Step 3: Implement it and wire it into `server.ts`.**

- [ ] **Step 4: Run the whole suite, `typecheck` and `lint`.** Expected: PASS and clean.

- [ ] **Step 5: Commit.** Message: `feat(api): startup migrations backfill refund method and excess payments`.
