# Recurring Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners and staff book a weekly series of games for a player or a named group in one go. Registered players request a series from the venue page, and the owner accepts or declines it. Every date is shown as free or clashing first. Free dates are booked; clashes are skipped and listed. One game or all future games can be cancelled.

**Architecture:**
- **Data:** a new tenant-scoped `RecurringSeries` collection (`recurringSeries`). Every game is an ordinary `Booking` with a new `seriesId`, so the schedule, check-in, cash, reminders, auto-complete and reviews work unchanged.
- **Engine:** a pure shared `expandSeriesDates()` turns the pattern into dates. In the API, `seriesAvailability()` checks each date against `loadDay()`. `bookSeries()` writes all games and their slot locks in one transaction and skips any date taken meanwhile. It does not use `createBooking()`, because that applies the booking window and per-booking notices.
- **Requests:** a player's games are created `pending` and answered as a whole. A new sweep auto-declines unanswered requests and another marks finished series `ended`.
- **Notices:** five new outbox events, each a single summary built on a representative game (the first booked or cancelled game).
- **Web:** a shared series form and preview list, used by an owner "New series" page and a player "Request weekly booking" page. Also an owner Series list and detail page, "Series" badges on games, and series grouping in My bookings.

**Tech Stack:**
- API: Express, Mongoose and zod, tested with Vitest + supertest + mongodb-memory-server replica set.
- Web: React 19, react-router, react-i18next and CSS Modules, tested with Vitest + Testing Library using `mockApi` and `renderApp`.
- Shared: `@booking/shared`.

**Spec:** `docs/superpowers/specs/2026-10-25-recurring-bookings-design.md` (approved 2026-10-25). Roadmap: `docs/superpowers/plans/2026-10-23-roadmap.md`, Plan 17.

## Global Constraints

- **Pattern:**
  - Weekly, on one or more weekdays (`Weekday` from `@booking/shared`, no duplicates).
  - One `startTime` (`HH:MM`, the slot's local start as `computeSlots` reports it in `localStart`) and `slotCount` consecutive slots, from 1 to `MAX_SLOTS_PER_BOOKING` (12).
  - `firstDate` is a business date (`YYYY-MM-DD`) at or after today in the venue timezone.
  - Exactly one of `endDate` (≥ `firstDate`) or `count` (1..100).
- **Length:**
  - The last generated date must be ≤ today + 182 days (`SERIES_MAX_DAYS`). Otherwise 400 `series_too_long`; never clipped.
  - At most 100 generated dates (`SERIES_MAX_GAMES`), clashes included. Otherwise 400 `series_too_many_games`.
  - `count` counts generated dates, clashes included.
  - A series ignores `bookingWindowDays`; single bookings keep it.
- **Clash reasons** (`SERIES_CLASH_REASONS`):
  - `past`: any slot `past`.
  - `taken`: any slot `booked` or `pending`.
  - `blocked`: any slot `blocked`.
  - `closed`: `day.closed`.
  - `outside_hours`: the start slot is missing, the run is not consecutive, or a slot has no price.
  - First match wins, in the order closed, past, taken, blocked, outside_hours.
- **Price:** the sum of `slot.price` for the date's slots from `loadDay()` at creation. Stored as `subtotal = total`, `addonsTotal: 0`, `advanceRequired: 0`, no add-ons.
- **Games:**
  - Owner-created: `source: 'walkin'`, `status: 'confirmed'`.
  - Player request: `source: 'online'`, `status: 'pending'`.
  - No `holdExpiresAt`. `policySnapshot` has the same shape `createBooking` writes for a walk-in (`paymentPolicy: null`, the venue's `refundRules`).
- **No per-game notices for series games:** no `booking_pending`, `staff_new_pending`, `booking_confirmed`, `booking_rejected` or `booking_cancelled`. Reminders, auto-complete and review requests stay per game.
- **Request deadline:**
  - `respondBy = min(createdAt + 48h, firstGameStartAt − 2h)`, where the first game is the earliest game actually booked.
  - If `respondBy <= now` at request time, the request gets 409 `series_too_soon` and nothing is created.
  - A player may have at most 3 series with `status: 'requested'` across all venues; a 4th gets 409 `series_request_limit`.
- **Statuses:** `SERIES_STATUSES = requested | active | declined | withdrawn | cancelled | ended`.
  - `requested` → `active` (accept), `declined` (owner or auto), or `withdrawn` (player).
  - `active` → `cancelled` when a cancel-future leaves no future holding games.
  - `active` → `ended` by the sweep once `lastEndAt <= now`.
- **Permissions** (no new key):
  - `booking.create`: preview and create.
  - `booking.confirm`: accept and decline.
  - `booking.cancel`: cancel-future.
  - `booking.view`: list and detail.
  - Scoped like bookings; out of scope gives 404.
- **New error codes**, each with en and ru strings in the web `errors` block:

  | Code | Status |
  |---|---|
  | `series_too_long` | 400 |
  | `series_too_many_games` | 400 |
  | `series_past_start` | 400 |
  | `series_no_free_dates` | 409 |
  | `series_too_soon` | 409 |
  | `series_request_limit` | 409 |
  | `series_request_open` | 409 |
  | `series_not_requested` | 409 |
- **Times:** compare instants as `Date`s. Weekdays come from business dates (`weekdayOf`), never from `Date.getDay()` on an instant.
- **UI:** follows `.superdesign/design-system.md`.
  - Every color, size, spacing, radius and shadow is a `var(--…)` from `apps/web/src/styles/tokens.css`, and `test/tokens.test.ts` stays green.
  - A new token goes in the light block and both dark blocks, plus one line in the design doc.
  - Light and dark mode both work.
  - Every string exists in en and ru, and `test/i18n.test.ts` stays green. A turf is «корт»; never «поле».
  - Rows and action groups use `flex-wrap: wrap`, with no `nowrap` or ellipsis on labels, so Russian fits.
- **TDD:** each step writes the failing test first.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Commands:**
  - API test: `cd apps/api && ../../node_modules/.bin/pnpm exec vitest run <file>`
  - Web test: `cd apps/web && ../../node_modules/.bin/pnpm exec vitest run <file>`
  - Shared test: `cd packages/shared && ../../node_modules/.bin/pnpm exec vitest run <file>`
  - Whole repo, from the root: `node_modules/.bin/pnpm typecheck && node_modules/.bin/pnpm lint && node_modules/.bin/pnpm test`

## Review Focus

1. **A series and a single booking racing for one slot:** exactly one wins. When the single booking wins, the series still books its other dates and lists that date as skipped `taken`. There is never a duplicate `slotLocks` row or two holding bookings on one slot. Pinned in Task 3.
2. **DST:** in `Europe/Berlin`, a Tuesday 20:00 series that crosses the last Sunday of March books every game at local 20:00. The UTC start moves by one hour. Pinned in Task 3.
3. **Past-midnight slots:** on a night venue (16:00–02:00), a series at `01:00` books on its business dates, each start falling on the next calendar day. The weekday is the business date's weekday. Pinned in Task 3.
4. **Answering races:**
   - Accept vs. auto-decline, or two accepts at once: one wins, the other gets 409 `series_not_requested`, and the games end all confirmed or all rejected.
   - Per-booking confirm, reject or cancel on a waiting request's game gets 409 `series_request_open`.
   - Pinned in Tasks 5 and 7.
5. **Venue-scoped staff:** a manager limited to venue A gets 404 for venue B's series (detail, accept, cancel-future), and venue B's series are missing from their list. Pinned in Task 5.

---

### Task 1: Shared series constants, types and date expansion

**Files:**
- Create: `packages/shared/src/series.ts`, `packages/shared/test/series.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces — Produces:**
```ts
export const SERIES_MAX_DAYS = 182;
export const SERIES_MAX_GAMES = 100;
export const SERIES_REQUEST_HOURS = 48;
export const SERIES_REQUEST_LEAD_HOURS = 2;
export const SERIES_MAX_OPEN_REQUESTS = 3;
export const SERIES_STATUSES = ['requested', 'active', 'declined', 'withdrawn', 'cancelled', 'ended'] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];
export const SERIES_CLASH_REASONS = ['closed', 'past', 'taken', 'blocked', 'outside_hours'] as const;
export type SeriesClashReason = (typeof SERIES_CLASH_REASONS)[number];
export type SeriesPattern = {
  weekdays: Weekday[]; startTime: string; slotCount: number;
  firstDate: string; endDate: string | null; count: number | null;
};
export type SeriesDate =
  | { date: string; status: 'free'; startAt: string; endAt: string; price: number }
  | { date: string; status: 'clash'; reason: SeriesClashReason };
export type SeriesPreview = { currency: string; dates: SeriesDate[]; freeCount: number; total: number };
export type SeriesGameJson = { id: string; reference: string; businessDate: string; startAt: string; endAt: string; status: BookingStatus; total: number; amountPaid: number };
export type SeriesJson = {
  id: string; venueId: string; turfId: string; status: SeriesStatus; source: 'online' | 'walkin';
  pattern: SeriesPattern; currency: string;
  player: { id: string; name: string | null } | null; guest: { name: string; phone: string } | null;
  skipped: { date: string; reason: SeriesClashReason }[];
  respondBy: string | null; declineReason: string | null; createdAt: string;
  games: SeriesGameJson[];
};
export class SeriesPatternError extends Error { constructor(public code: 'series_too_long' | 'series_too_many_games' | 'series_past_start') }
/** Business dates matching the pattern, ascending. Throws SeriesPatternError. */
export function expandSeriesDates(p: SeriesPattern, today: string): string[];
```
- Walk the days from `firstDate`. Keep dates whose `weekdayOf` is in `weekdays`, and stop at `endDate` or after `count` dates.
- Throw `series_past_start` if `firstDate < today`.
- Throw `series_too_many_games` if more than 100 dates would result. Check this while walking, so a long `endDate` cannot loop for long.
- Throw `series_too_long` if the last date is > `addDays(today, 182)`. This check runs first when the walk passes that bound.

- [ ] **Step 1: Write the failing tests** in `series.test.ts`:
  - "expands weekdays up to an end date": `{weekdays:['tue','fri'], firstDate:'2026-11-03', endDate:'2026-11-13'}` → `['2026-11-03','2026-11-06','2026-11-10','2026-11-13']`.
  - "count counts generated dates": `{weekdays:['mon'], firstDate:'2026-11-04', count:3}` → `['2026-11-09','2026-11-16','2026-11-23']`.
  - "182-day edge": today `'2026-11-01'`.
    - endDate `addDays(today,182)` on a matching weekday → included.
    - A count whose last date is `addDays(today,183)` → throws code `series_too_long`.
  - "more than 100 dates": daily (all 7 weekdays) with a count of 101 → `series_too_many_games`. With 100 → length 100 (on 7 weekdays, 100 dates fit within 182 days).
  - "first date before today" → `series_past_start`. `firstDate === today` is fine.
- [ ] **Step 2: Run** `test/series.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `series.ts` and export it from `index.ts`.
- [ ] **Step 4: Run** the shared suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): series constants, types and date expansion`

---

### Task 2: Series model and `seriesId` on bookings

**Files:**
- Create: `apps/api/src/series/series.model.ts`, `apps/api/test/series/model.test.ts`
- Modify: `apps/api/src/bookings/booking.model.ts` (`seriesId: ObjectId | null`, default null; index `{ ownerId: 1, seriesId: 1, startAt: 1 }`; `bookingJson` adds `seriesId: string | null`), `apps/web/src/lib/types.ts` (`BookingJson.seriesId`), `apps/web/src/owner/types.ts` (`OwnerBooking.seriesId`)

**Interfaces — Produces** (`RecurringSeries`, collection `recurringSeries`, `tenantScoped`, timestamps):
- **Where and who:**
  - `ownerId`, `venueId`, `turfId`
  - `source: 'online'|'walkin'`
  - `playerId: ObjectId|null`
  - `guest: {name, phone}|null`
  - `createdBy: ObjectId|null`
- **Pattern:**
  - `weekdays: string[]`
  - `startTime: string`, `slotCount: number`
  - `firstDate: string`, `endDate: string|null`, `count: number|null`
- **State:**
  - `status: SeriesStatus`
  - `currency: string`
  - `skipped: [{ date: string, reason: string }]`
  - `firstStartAt: Date`, `lastEndAt: Date`
  - `respondBy: Date|null`
  - `decidedAt: Date|null`, `decidedBy: ObjectId|null`
  - `declineReason: string|null`
- **Indexes:**
  - `{ownerId, venueId, status, _id: -1}`
  - `{playerId, status}`
  - `{status, respondBy, _id}`
  - `{status, lastEndAt, _id}`
- Exports `RecurringSeries`, `type SeriesDoc`, and `seriesJson(s: SeriesDoc, games: BookingDoc[], playerName: string | null): SeriesJson`.
  - `pattern` is built from the stored fields.
  - Games are sorted by `startAt`.
  - `guest.phone` is included only in owner responses; the player route passes `guest: null` (the player has none anyway).

- [ ] **Step 1: Failing tests** in `model.test.ts`:
  - "stores a series and serialises it": `seriesJson` returns the pattern, skipped list and games in order.
  - "bookingJson carries seriesId": null by default; set → string.
  - "tenant scoping applies": a query without `ownerId` throws, as other tenant models do.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the model, booking field and JSON. Update the two web type mirrors.
- [ ] **Step 4: Run** `test/series/model.test.ts test/bookings/models.test.ts test/bookings/playerJson.test.ts` and the web typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): recurring series model and booking seriesId`

---

### Task 3: Availability and booking engine

**Files:**
- Create: `apps/api/src/series/engine.ts`, `apps/api/test/series/engine.test.ts`

**Interfaces:**
- Consumes:
  - `expandSeriesDates` and the types (Task 1); `RecurringSeries` and `Booking.seriesId` (Task 2).
  - `loadDay(ownerId, venue, turf, businessDate, now)`.
  - `runInTransaction`, `lockTurf`, `expireStaleHolds`, `holdingFilter`, `SlotLock`.
  - The reference generator used by `createBooking`.
  - `localParts(now, venue.timezone).date` for "today".
- Produces:
```ts
export type SeriesWho = { playerId: string | null; guest: { name: string; phone: string } | null; createdBy: string | null };
/** Validates the pattern (maps SeriesPatternError to AppError 400 with its code) and checks every date. */
export async function seriesAvailability(venue: VenueDoc, turf: TurfDoc, pattern: SeriesPattern, now: Date): Promise<SeriesPreview>;
/**
 * Re-checks and books in one transaction. Returns the series and its games. Throws 409
 * series_no_free_dates (nothing written) when no date is free. `beforeCommit` runs inside the
 * transaction after the games are written (activity, notices, request checks).
 */
export async function bookSeries(input: {
  venue: VenueDoc; turf: TurfDoc; pattern: SeriesPattern; who: SeriesWho;
  mode: 'owner' | 'request'; now: Date;
  beforeCommit?: (session: ClientSession, series: SeriesDoc, games: BookingDoc[]) => Promise<void>;
}): Promise<{ series: SeriesDoc; games: BookingDoc[] }>;
```
- **Per date:** take `day.slots`. Find the slot whose `localStart === startTime`, then the next `slotCount − 1` slots, each starting at the previous one's `endAt`. Apply the clash order from Global Constraints.
- **Transaction:**
  1. `lockTurf`, then `expireStaleHolds`.
  2. Re-run the availability for the free dates. Inside, also check `Booking.exists({ ownerId, turfId, overlapping, ...holdingFilter(now) })`; a hit means `taken`.
  3. Create the series. Status is `active` for owner and `requested` for request; `respondBy` follows the Global Constraints formula. `firstStartAt` and `lastEndAt` come from the booked games, and `skipped` holds every clash date.
  4. Insert the games (`seriesId`, statuses per mode, `slots` with prices, `currency` from the venue) and their `SlotLock`s.
  5. Run `beforeCommit`.
- **Retry:** a duplicate key on `slotLocks` aborts the attempt. Find the date of the `startAt` in `keyValue`, mark it skipped `taken`, and rerun without it. Reference duplicates retry as in `createBooking`.
- In `request` mode, if `respondBy <= now`, throw 409 `series_too_soon` before writing.

- [ ] **Step 1: Failing tests** in `engine.test.ts`:
  - **Setup:** a venue with hours 08:00–23:00 and turf pricing `{ base: 1000 }`. The test clock is at `2026-01-01`; advance it so "today" is a known Monday.
  - "preview marks each date free with price or clash with reason":
    - Seed a confirmed booking on date 2 → `taken`.
    - A block override on date 3 → `blocked`.
    - A closure on date 4 → `closed`.
    - `startTime` 23:00 with `slotCount` 2 → `outside_hours`.
    - `freeCount` and `total` add up.
  - "today's slot already started is past".
  - "ignores bookingWindowDays": venue window 7 days, series on day 60 → free.
  - "books free dates and skips clashes in one go":
    - Owner mode gives games `confirmed`, `source: 'walkin'`, `advanceRequired: 0` and `seriesId` set.
    - `skipped` lists the clashes.
    - The slot locks count equals the slots booked.
  - "request mode creates pending online games and respondBy":
    - Games are `pending`.
    - With the first game 5 days out, `respondBy` = createdAt + 48h.
    - With the first game 3h out, `respondBy` = start − 2h.
    - With the first game 1h out → 409 `series_too_soon`.
  - "no free dates writes nothing" → 409 `series_no_free_dates`; the series and bookings counts are 0.
  - "a single booking racing the series loses or wins cleanly" (Review Focus 1):
    - `Promise.all` of `bookSeries` (4 Tuesdays) and a `createBooking` for Tuesday 2's slot.
    - Afterwards there is exactly one holding booking on that slot and no duplicate `SlotLock`s.
    - If the single booking won, the series has 3 games and `skipped` holds Tuesday 2 with reason `taken`.
  - "DST: Europe/Berlin Tuesdays 20:00 across 2026-03-29 keep local 20:00" (Review Focus 2): `localParts(game.startAt, tz).hm === '20:00'` for every game, and the UTC offsets differ.
  - "night venue 01:00 books on the business date" (Review Focus 3): hours 16:00–02:00, `weekdays: ['fri']`, `startTime: '01:00'` → each game's `businessDate` is a Friday and `startAt` is Saturday 01:00 local.
  - "pattern errors map to 400": too long → `series_too_long`; past start → `series_past_start`.
- [ ] **Step 2: Run them.** Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `engine.ts`.
- [ ] **Step 4: Run** `test/series/engine.test.ts test/bookings/create.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): series availability and booking engine`

---

### Task 4: Series notices and series-aware cancel

**Files:**
- Modify:
  - `apps/api/src/notifications/templates.ts` (events plus en and ru builders, links)
  - `apps/api/src/notifications/outbox.ts` (recipients, the `extra` type, `NoticeData`)
  - `apps/api/src/notifications/notification.model.ts` (if the event enum is declared there)
  - `apps/api/src/bookings/cancel.ts`
- Test: `apps/api/test/notifications/series.test.ts`, `apps/api/test/bookings/cancel.test.ts`

**Interfaces:**
- **New `NOTICE_EVENTS`:** `series_requested`, `series_accepted`, `series_declined`, `series_created`, `series_games_cancelled`.
- **`NoticeData` gains:**
  - `seriesId?: string`
  - `games?: string[]`: ISO starts, ascending, at most 30 listed, plus `moreGames?: number`.
  - `skipped?: { date: string; reason: SeriesClashReason }[]`
  - `kept?: string[]`
  - `ownerId` (already optional)
- **`noticeBooking(event, booking, now, session, extra)`:**
  - `extra` gains `seriesId`, `games`, `skipped`, `kept` and `toStaff?: boolean`.
  - `booking` is the representative game; dedupe stays `event:bookingId:…`.
- **Recipients:**
  - `series_requested`, or `series_games_cancelled` with `toStaff`: `staffRecipients(booking, 'booking.confirm', session)`.
  - All others: the player's contacts, else the guest phone (`series_created` for a group goes to its phone).
- **Links:**
  - staff: `${appUrl}/owner/${ownerId}/series/${seriesId}`
  - player: `${appUrl}/me/bookings`
- **Copy:**
  - Each template lists the dates in the venue timezone (date + time, one per line, in the email; SMS gives the count and the first date).
  - Skipped and kept dates go in `extra`, each translated with its reason.
  - ru strings use «корт» and «игра/игры».
- **`isStale`:** series events are never stale.
- **`cancelBooking(booking, by, input, deps)`:**
  - `input` gains `notify?: boolean` (default true).
  - When `booking.seriesId` is set, it sends `series_games_cancelled` (`games: [startAt]`, `toStaff: by.kind !== 'staff'`) instead of `booking_cancelled`.
  - With `notify: false` it sends neither.

- [ ] **Step 1: Failing tests:**
  - `series.test.ts`:
    - "renders every series event in en and ru with the dates in venue time":
      - `renderNotice` for each event and locale has a non-empty subject and SMS.
      - The email lists `games.length` lines.
      - ru `series_declined` has no English words from the en template.
      - `moreGames` shows "+N more" / «ещё N».
    - "series_requested goes to staff who can confirm at that venue": a manager covering the venue gets a row; staff without `booking.confirm` and a manager of another venue get none.
    - "series_games_cancelled to staff when the player cancelled, to the player when staff did".
  - `cancel.test.ts`:
    - "a series game cancel sends one series_games_cancelled and no booking_cancelled".
    - "notify:false sends nothing".
    - The existing non-series cancel test is unchanged.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `test/notifications test/bookings/cancel.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): series notices and series-aware cancel notice`

---

### Task 5: Owner series API and guards on per-booking actions

**Files:**
- Create: `apps/api/src/series/routes/owner.ts`, `apps/api/src/series/schemas.ts`, `apps/api/src/series/cancelFuture.ts`, `apps/api/test/series/owner.test.ts`
- Modify:
  - `apps/api/src/app.ts`: mount `ownerSeriesRouter(config, services)` where `ownerBookingsRouter` is mounted.
  - `apps/api/src/bookings/routes/owner.ts`: confirm and reject refuse with `series_request_open` when the booking's series is `requested`.

**Interfaces:**
- **`schemas.ts`** (zod, strict):
  - `seriesPatternSchema` produces `SeriesPattern`: weekdays from `WEEKDAYS`, 1..7, unique; `startTime` `HH:MM`; `slotCount` 1..12; `firstDate` and `endDate` via `isoDateSchema`; `count` an integer 1..100; exactly one of `endDate`/`count`.
  - `ownerSeriesSchema = seriesPatternSchema.extend({ customer: { name, phone, playerId? } })`, the same customer shape as the walk-in schema.
  - `reasonSchema = { reason?: trim max 300 }`.
- **`cancelFuture.ts`:**
```ts
/** Cancels every holding game of the series with startAt > now, one cancelBooking each with notify:false,
 *  then one series_games_cancelled summary (representative = first cancelled game) listing cancelled and
 *  kept dates. Sets status 'cancelled' when no future holding game is left, recomputes lastEndAt, logs series.cancel. */
export async function cancelFutureGames(series: SeriesDoc, by: Canceller, reason: string | undefined, deps: { config; services }):
  Promise<{ cancelled: BookingDoc[]; kept: { booking: BookingDoc; code: string }[] }>;
```
  - A game whose `cancelBooking` throws an `AppError` is kept with that error's code.
  - The summary and status update run in their own `runInTransaction` after the loop. No summary is sent when nothing was cancelled.
  - Refuses with `series_request_open` while the series is `requested`.
- **Routes** (paths relative to the owner router base, scope per Global Constraints):
  - `POST /venues/:venueId/turfs/:turfId/series/preview` (`booking.create`): body is the pattern; returns `{ preview }`.
  - `POST /venues/:venueId/turfs/:turfId/series` (`booking.create`): returns 201 `{ series: SeriesJson }`.
    - `bookSeries` in mode `owner`. `who` is built like a walk-in: `playerId` if given, `guest` with the normalised phone, and `createdBy` the member.
    - `beforeCommit` logs `series.create` (entity `series`) and queues `series_created` on the first game (`games`, `skipped`).
  - `GET /series?venueId&status&before` (`booking.view`): returns `{ series: SeriesJson[], nextBefore }`. It pages by `_id` descending with the same page size as the bookings list, and each item includes its games.
  - `GET /series/:seriesId` (`booking.view`): returns `{ series }`.
  - `POST /series/:seriesId/accept` (`booking.confirm`):
    - In one transaction, conditionally move `requested` → `active` (else 409 `series_not_requested`).
    - `transition(…, 'confirmed')` each pending game with actor `{ ownerId, userId: null }`, so no per-game log.
    - Log `series.accept` and queue `series_accepted`.
    - Returns `{ series }`.
  - `POST /series/:seriesId/decline` (`booking.confirm`): the same, with `declined`, games `rejected` (`rejectReason`), `declineReason`, `series.decline` and `series_declined`.
  - `POST /series/:seriesId/cancel-future` (`booking.cancel`): returns `{ series, cancelled: string[], kept: { id, code }[] }`.
- Single-game cancel stays `POST /bookings/:id/cancel`; Task 4 already sends the series summary. It refuses with `series_request_open` while the series is `requested`. Put the check in `cancelBooking`, so player and guest are covered too.

- [ ] **Step 1: Failing tests** in `owner.test.ts`:
  - "preview and create a series for a guest group":
    - Preview gives 200 with the dates.
    - Create gives 201, with games and skipped matching the preview.
    - One `series_created` SMS row goes to the group phone.
    - An activity row `series.create` exists.
  - "create for a registered player links playerId and the games show in their /me/bookings with seriesId".
  - "staff without booking.create gets 403; venue-scoped manager gets 404 for another venue's turf, series detail, accept and cancel-future, and the list omits it" (Review Focus 5).
  - "accept confirms every pending game and sends one series_accepted":
    - Seed a request through `bookSeries` mode `request`.
    - No `booking_confirmed` rows are queued.
  - "decline rejects every game with the reason and frees the slots": the slot locks are gone, and a new single booking on that slot succeeds.
  - "two accepts at once: one 200, one 409 series_not_requested" (Review Focus 4).
  - "per-booking confirm, reject and cancel of a waiting request's game → 409 series_request_open".
  - "cancel-future cancels future games only":
    - Advance the clock past game 1.
    - Game 1 stays, the others are cancelled.
    - One `series_games_cancelled` notice goes to the player.
    - The status is `cancelled` when none are left.
  - "cancel one game sends the summary, not booking_cancelled".
- [ ] **Step 2: Run them.** Expected: FAIL (404).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `test/series test/bookings/owner.test.ts test/bookings/cancel.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): owner series create, answer and cancel`

---

### Task 6: Player series API

**Files:**
- Create: `apps/api/src/series/routes/player.ts`, `apps/api/test/series/player.test.ts`
- Modify: `apps/api/src/app.ts` (mount `playerSeriesRouter(config, services)` next to `publicBookingsRouter`)

**Interfaces:**
- Consumes:
  - `seriesPatternSchema` and `cancelFutureGames` (Task 5); `bookSeries` and `seriesAvailability` (Task 3).
  - The `publicTurf(slug, turfId)` lookup: move it from `bookings/routes/public.ts` to an exported `publicTurf` in `apps/api/src/venues/routes/public.ts`, and import it in both places.
- **Routes**, all `requireAuth`:
  - `POST /venues/:slug/turfs/:turfId/series/preview`: returns `{ preview }`.
  - `POST /venues/:slug/turfs/:turfId/series`: returns 201 `{ series }`.
    - Check `RecurringSeries.countDocuments({ playerId, status: 'requested' })` (crossTenant) `>= 3` → 409 `series_request_limit`. Re-check inside `beforeCommit` with the session.
    - Then `bookSeries` mode `request`, with `who` `{ playerId: userId, guest: null, createdBy: userId }`.
    - `beforeCommit` queues `series_requested` (`seriesId`, `ownerId`, `games`, `skipped`) and logs `series.create` with the player as actor.
  - `GET /me/series`: returns `{ series: (SeriesJson & { venue: { slug, name, timezone }, turf: { name } })[] }`. It returns the player's series, newest first, limited to 50.
  - `POST /me/series/:seriesId/withdraw`: conditionally moves `requested` → `withdrawn` (else 409 `series_not_requested`) and rejects the games as `decline` does. No notice is sent; it logs `series.withdraw`.
  - `POST /me/series/:seriesId/cancel-future`: `cancelFutureGames` with `{ kind: 'player', ownerId, userId }`.
  - Another player's series id gives 404.

- [ ] **Step 1: Failing tests** in `player.test.ts`:
  - "request creates pending games and notifies staff": 201, `status` `requested`, the games are `pending`, there is one `series_requested` row per staff recipient, and no `staff_new_pending` rows.
  - "signed-out gets 401".
  - "a fourth open request → 409 series_request_limit; withdrawing one allows another".
  - "withdraw rejects the games and frees the slots".
  - "player cancel-future keeps games already started" (advance the clock into game 2): game 2 is in `kept` with code `too_late`, and the later games are cancelled. The summary goes to staff.
  - "player single-game cancel on an active series sends a series summary to staff".
  - "GET /me/series lists only mine, with venue and turf names".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `test/series test/bookings/public.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): player series request, withdraw and cancel`

---

### Task 7: Sweeps — auto-decline and end, and the single-booking auto-reject skip

**Files:**
- Modify: `apps/api/src/jobs/sweeps.ts`, `apps/api/src/jobs/runner.ts`
- Test: `apps/api/test/jobs/series.test.ts`, `apps/api/test/jobs/sweeps.test.ts`

**Interfaces — Produces:**
- `autoDeclineSeries(now: Date): Promise<number>`:
  - Pages over `{ status: 'requested', respondBy <= now }`, in batches of `sweepConfig.batch`.
  - Each series is handled in its own transaction: conditional move to `declined` (`declineReason: null`), its pending games `rejected` with `rejectReason: AUTO_REJECT_REASON`, `series_declined` with `autoRejected: true`, and `logSystemActivity` `series.decline`.
  - A series that lost the race to an accept is skipped.
- `endSeries(now: Date): Promise<number>`: `{ status: 'active', lastEndAt <= now }` → `ended`.
- `autoRejectPending` adds `seriesId: null` to its filter.
- `JOBS` gains `{ name: 'series-auto-decline', everyMs: 60_000 }` and `{ name: 'series-end', everyMs: 300_000 }`.

- [ ] **Step 1: Failing tests:**
  - "auto-declines at respondBy, not before": at `respondBy − 1ms`, 0 handled; at `respondBy`, 1. The games are `rejected`, and there is one `series_declined` notice.
  - "accept vs auto-decline race leaves one outcome" (Review Focus 4): run `autoDeclineSeries` and the accept route concurrently; the games are all confirmed or all rejected, matching the series status.
  - "pending auto-reject leaves series games alone": with `pendingAutoRejectHours` 2, a series game starting in 1h stays `pending` after `autoRejectPending`.
  - "ends an active series after its last game".
  - "batches": with `sweepConfig.batch = 1`, three due requests are all declined.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `test/jobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): series auto-decline and end sweeps`

---

### Task 8: Web shared series form and owner "New series" page

**Files:**
- Create:
  - `apps/web/src/series/SeriesForm.tsx`, `apps/web/src/series/SeriesPreviewList.tsx`, `apps/web/src/series/series.module.css`
  - `apps/web/src/series/types.ts` (re-exports the shared series types for web use)
  - `apps/web/src/owner/series/NewSeriesPage.tsx`
  - `apps/web/test/series/form.test.tsx`, `apps/web/test/owner/newSeries.test.tsx`
- Modify:
  - `apps/web/src/owner/shell/nav.ts`: add `{ to: 'series', key: 'owner.nav.series', perms: ['booking.view'] }` after `walk-in`.
  - `apps/web/src/owner/ownerRoutes.tsx`:
    - `series/new` → `<Guarded perm={['booking.create']}><NewSeriesPage/></Guarded>`
    - `series` → `<Guarded nav="series">…` (placeholder until Task 9)
  - Both locale files: `owner.nav.series`, `series.*`, the error codes, and `owner.activity.action.series_create|series_accept|series_decline|series_withdraw|series_cancel` plus `owner.activity.entity.series`.
  - `apps/web/test/owner/fixtures.ts`: add `seriesJson()` and `seriesPreview()` factories.

**Interfaces:**
- `SeriesForm({ value, onChange, tone: 'brand'|'portal', slotTimes: string[] })`:
  - Controlled `SeriesPattern`.
  - Weekday toggle chips Mon–Sun (localised short names via `Intl`).
  - Start-time select from `slotTimes`, and a "Length" select (1..12 slots, shown as duration).
  - First date, and an "Ends" radio: "On date" with a date input, or "After N games" with a number input (1..100).
- `SeriesPreviewList({ preview })`:
  - One row per date: localised date and time, then the price (`formatMoney`) or a clash badge with the translated reason (`series.reason.<code>`).
  - The footer shows "N games · total", and "M dates skipped" when any are.
- `NewSeriesPage`:
  - Venue and turf selects, as on the walk-in page.
  - Customer: player search or name + phone, reusing the walk-in customer block.
  - `slotTimes` from `GET …/schedule` slot `localStart`s for `firstDate`.
  - "Check dates" calls preview. The page shows `SeriesPreviewList`, and "Book N games" is disabled when `freeCount` is 0.
  - Create; on 201, navigate to `series/:id`. Errors are shown translated.
  - Changing any field clears the preview.

- [ ] **Step 1: Failing tests:**
  - `form.test.tsx`:
    - "toggling weekdays and switching end mode updates the pattern" (`endDate` and `count` are mutually exclusive).
    - "preview list shows price for free dates and reason for clashes".
  - `newSeries.test.tsx`:
    - "nav shows Series with booking.view".
    - "check dates posts the pattern and shows the preview; book posts the customer and navigates".
    - "book disabled when no free dates".
    - "series_too_long shows the translated error".
    - "renders in Russian" (title, weekday chips, a clash reason).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use tokens only; reuse `Button`, `Select`, `Badge` and `Field` from the existing UI kit.
- [ ] **Step 4: Run** `test/series test/owner test/i18n.test.ts test/tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): series form, preview and owner new series page`

---

### Task 9: Web owner — Series list, detail and badges

**Files:**
- Create: `apps/web/src/owner/series/SeriesListPage.tsx`, `apps/web/src/owner/series/SeriesDetailPage.tsx`, `apps/web/src/series/SeriesBadge.tsx`, `apps/web/test/owner/series.test.tsx`
- Modify:
  - `apps/web/src/owner/ownerRoutes.tsx`:
    - `series` → `SeriesListPage`
    - `series/:seriesId` → `<Guarded perm={['booking.view']}>`
  - `apps/web/src/owner/bookings/BookingsPage.tsx`, `OwnerBookingPage.tsx` and `apps/web/src/owner/schedule/ScheduleGrid.tsx`: show `SeriesBadge` when `seriesId` is set. The badge links to `series/:seriesId` (on the schedule, a badge only).
  - Both locale files.

**Interfaces:**
- **List:**
  - Venue and status filters, kept in the URL query.
  - Rows show the customer (player name or group name), court, weekdays and time, the date range, the games count, a status `Badge`, and for `requested` the "Answer by {respondBy}" text.
  - "New series" button, shown only with `booking.create`. "Show more" pages with `nextBefore`.
- **Detail:**
  - The pattern summary and customer.
  - Games (date, time, status badge, paid amount, link to the booking).
  - Skipped dates with their reasons.
  - Actions:
    - `requested` with `booking.confirm`: Accept (primary), and Decline (secondary, opening `ReasonDialog`).
    - `active` with `booking.cancel`: "Cancel all future games" (danger, with a confirm dialog listing the count). Per game, "Cancel this game" uses the existing booking cancel dialog flow.
  - After cancel-future, a notice lists the `kept` dates ("Could not cancel: …").

- [ ] **Step 1: Failing tests** in `series.test.tsx`:
  - "list filters by status in the URL and pages with nextBefore".
  - "requested series: accept posts and refreshes; decline sends the reason".
  - "no accept or decline without booking.confirm".
  - "cancel all future posts and shows kept dates".
  - "bookings list row shows the Series badge linking to the series".
  - "renders in Russian".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `test/owner test/i18n.test.ts test/tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owner series list, detail and series badges`

---

### Task 10: Web player — request weekly booking and My bookings series

**Files:**
- Create: `apps/web/src/series/RequestSeriesPage.tsx`, `apps/web/src/bookings/MySeries.tsx`, `apps/web/test/series/request.test.tsx`, `apps/web/test/bookings/mySeries.test.tsx`
- Modify:
  - `apps/web/src/routes.tsx`: add `/venues/:slug/series` (signed-in only; signed-out users are redirected to sign-in with a return path, as checkout does).
  - `apps/web/src/venue/SlotsPanel.tsx`: for a signed-in user, add a secondary "Request weekly booking" link to `/venues/:slug/series?turfId=…&date=…`.
  - `apps/web/src/bookings/MyBookingsPage.tsx`, `BookingRow.tsx`, `BookingDetailPage.tsx`:
    - Group games by series.
    - Series games show `SeriesBadge`, linking to the My bookings series section.
    - Single-game cancel stays as is.
  - Both locale files.

**Interfaces:**
- **`RequestSeriesPage`:**
  - Turf select (from the venue), `SeriesForm` with `tone="brand"`, and slot times from the public slot grid of `firstDate`.
  - "Check dates" calls the player preview and shows `SeriesPreviewList`.
  - "Send request" posts. On 201 it shows the confirmation "Request sent. The venue will answer by {respondBy}." with a link to My bookings.
  - Errors are shown translated (`series_request_limit`, `series_too_soon`).
- **`MySeries`**, from `GET /me/series`, on top of My bookings:
  - One card per series: venue, court, weekdays and time, status badge.
  - Next games, and skipped dates, shown collapsed with a disclosure.
  - Actions: "Withdraw request" (requested), or "Cancel all future games" (active, confirm dialog). The result lists the kept dates.
  - Games that belong to a series card are left out of the single-bookings list below.

- [ ] **Step 1: Failing tests:**
  - `request.test.tsx`:
    - "signed-out user sees no request link".
    - "check dates then send request posts the pattern and shows respondBy".
    - "series_request_limit shows the translated error".
    - "renders in Russian".
  - `mySeries.test.tsx`:
    - "groups series games under their series and keeps single bookings separate".
    - "withdraw posts and refreshes".
    - "cancel all future shows kept dates".
    - "declined series shows its status".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `test/series test/bookings test/venue test/i18n.test.ts test/tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the whole repo:** `node_modules/.bin/pnpm typecheck && node_modules/.bin/pnpm lint && node_modules/.bin/pnpm test`. Expected: all green.
- [ ] **Step 6: Visual check:** run the app and look at the owner New series, Series detail, the player request page and My bookings in light and dark, en and ru, at phone and desktop widths.
- [ ] **Step 7: Commit** `feat(web): player weekly booking request and series in my bookings`

---

## Notes for the executor

- **Rulings already made against the spec:**
  - **`count` includes clashes.** The series ends after N generated dates, not N booked games. This is predictable and shown in the preview, and the 100 cap applies to the same number.
  - **182 days is measured in business dates.** The last date must be ≤ today + 182.
  - **The player's "cutoff":** the venue has no separate no-cancel cutoff today; `cancelBooking` refuses a player only once a game has started (`too_late`). Cancel-future therefore keeps whatever `cancelBooking` refuses and reports it with its code, so a future cutoff rule is picked up automatically.
  - **Status after a single-game cancel:** only cancel-future sets `cancelled`. A single cancel recomputes `lastEndAt`, and the end sweep then marks the series `ended`.
  - **Representative game:** each series notice is attached to one game (the first booked or first cancelled one), so the outbox's per-booking dedupe and delivery work unchanged.
  - **Per-game activity:** accept, decline and withdraw transition games with `userId: null`, so the log gets one `series.*` entry, not one per game.
- **Guest lookup:** an owner-created group series stores `guest.phone`. Reference + phone lookup and guest cancel keep working per game, and Task 4 routes the notice as a series summary.
