# Plan 05 — Slot Engine & Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For any turf and business date, the API returns the day's slots — cut from the effective hours in the venue's timezone, changed by overrides and closures, priced by the turf's pricing rules — to the owner and, for published venues, to players.

**Architecture:**
- **Shared package, pure.** Timezone conversion, pricing resolution, override date/range logic and `computeSlots` live in `packages/shared` with no I/O, so the web app (Plan 12/13) can reuse them and tests need no database.
- **API module.** A new `apps/api/src/schedule/` module holds the `SlotOverride` and `Closure` models, their routes, the turf pricing route, and the slots endpoints. `schedule/load.ts` gathers a day's inputs from MongoDB and calls `computeSlots`.
- **Slots are computed, not stored** (spec §7). Nothing is written for dates with no changes.

**Tech Stack:** Plan 01–04 stack. No new dependencies: timezone math uses `Intl.DateTimeFormat` only.

**Spec:** `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md`:
- §7 (slots, past-midnight business day, overrides, no overlaps)
- §8 (pricing tiers)
- §6 (settings inheritance: hours, weekend days, booking window, closed dates at owner/venue/turf)
- §4 (UTC storage, venue timezone, minor units)
- §16 (`turfs.pricingRules`, `slotOverrides`, `closures`)

Roadmap: `docs/superpowers/plans/2026-10-23-roadmap.md` (Plan 05; failure modes 2, 3 and 5).

## Global Constraints

- **Earlier plans still apply.** TS strict, ESM, error shape `{ error: { code, message, details? } }`, `/api/v1`, injected `services.now()`. Owner routes mount on `ownerRouter`; every query carries `ownerId` (or goes through `tenantRepo`). Mutations and their `logActivity` run in one `runInTransaction`.
- **Tenancy.** Another owner's data, or a venue outside the member's scope, gives `404 not_found` and never data (roadmap failure mode 2). Public reads expose only published venues of `active` owners, and only active turfs.
- **Time.** Quoted from spec §4: "Times stored in UTC; each venue has an IANA timezone … and all slot generation happens in venue local time." Roadmap failure mode 3: slots around midnight and DST are "never duplicated or skipped silently".
- **Business day.** Quoted from spec §7: "A slot belongs to the business day it opened on — a 01:00 Saturday slot from Friday's 16:00–02:00 session is a Friday slot for pricing, weekend rules, closures, overrides and booking window."
- **Money.** Prices are integers in minor units of the venue's currency (`assertMinor`); no floats.
- **No UI in this plan.** Plan 12 (slot grid) and Plan 13 (schedule) must follow `.superdesign/design-system.md` and `apps/web/src/styles/tokens.css`; the slot `status` values here are the ones the design system's slot grid states map to.

## Decisions made in this plan (builder's calls)

- **Dates and times.**
  - A business date is `'YYYY-MM-DD'` (a real calendar date; `2026-02-30` is rejected). Its weekday is the calendar weekday of that date.
  - Times are `'HH:MM'` local. A range `{ start, end }` with `end <= start` ends the next day; inside a business day a time is a minute offset in `[0, 2880)`.
  - Local wall time → UTC uses the "compatible" rule: a time that occurs twice (DST fall-back) takes the earlier instant; a time skipped by spring-forward moves forward by the gap.
- **Cutting slots.** A session starts at local `open` and ends at local `close` (next day when `close <= open`; `open === close` is 24 h). Both ends convert to UTC, and slots are cut by **elapsed** minutes from the start. A leftover shorter than `slotLengthMin` is dropped. So a DST night yields one slot fewer or more, every `startAt` is unique, and the local label (`localStart`) may repeat on fall-back nights.
- **Overrides** (`slotOverrides`, per turf) apply on one `date` or on a weekly `recurrence { weekdays, from, until? }`:
  - `block { start, end }`: slots overlapping the range get status `blocked` (still listed).
  - `modify { slotStart, start, end, price? }`: the generated slot whose `localStart === slotStart` is replaced by `[start, end)`. On a fall-back night with a repeated label, the first match wins.
  - `add { start, end, price? }`: an extra slot.
  - `close {}`: no slots that business day.
  - `price` on add/modify beats every pricing rule for that slot.
  - No PATCH: change = delete + create.
- **Overlap rejection** (spec §7) happens when an `add` or `modify` is created: its range must not overlap (a) another `add`/`modify` whose dates intersect, or (b) a generated slot of the current effective hours on any weekday it applies to, except a modify's own target. → 409 `override_overlap`. A `modify` whose `slotStart` matches no generated slot (on the date, or on any listed weekday) → 409 `slot_not_found`. The check uses minute ranges, not UTC (DST-agnostic). Concurrent creates are serialized by `lockTurf` in the transaction.
- **Later hours changes** can make old overrides overlap generated slots; `computeSlots` then drops the generated slot (override wins), so output never overlaps.
- **Closures** (`closures`) are inclusive date ranges at owner level (`venueId: null`), venue level or turf level, at most 366 days long. Owner-level closures need `settings.edit` and all-venue scope (else 403 `forbidden`); venue/turf closures need `slot.override` and venue scope.
- **Pricing** is stored on the turf as `pricing: { base, rules } | null`. `null` (the default for existing turfs) means unpriced: slots carry `price: null`, and Plan 07 must refuse to book them. Rules:
  - `{ kind: 'date', date, range?, price }` → tier 1
  - `{ kind: 'weekend', range?, price }` → tier 2 (weekend business days)
  - `{ kind: 'weekday', range?, price }` → tier 3 (other business days)
  - `base` → tier 4. A rule without `range` covers the whole business day. A slot matches by its start minute. Within one tier, overlapping rules are rejected (400 `validation_error`), so there is never a tie. At most 100 rules.
  - `PUT .../pricing` replaces the whole object; needs `pricing.edit`; logs `pricing.update`.
- **Slot status** priority: `booked`/`pending` (from a `taken` list Plan 07 supplies; empty here) > `blocked` > `past` (`startAt <= now`) > `available`.
- **Booking window.** A business date `d` is inside the window when `localToday − 1 ≤ d ≤ localToday + bookingWindowDays` (`localToday` = the venue-local calendar date of `now`; the `−1` keeps last night's past-midnight session bookable). The owner endpoint always returns slots. The public endpoint returns `status: 'outside_window'` with no slots.
- **Carry-over from Plan 04.** One weekday of an hours override can be reset alone: `hours: { mon: null }` deletes only `mon` (owner level → default, venue/turf → inherit).

## Review Focus

1. **DST nights.** Europe/London, 60-min slots, 16:00–02:00: Sat 2026-03-28 gives 9 slots and Sat 2026-10-24 gives 11, every `startAt` unique, none skipped. (Task 1 and Task 3 tests.)
2. **Business day across midnight.** Asia/Dhaka, Fri 2026-10-30 16:00–02:00, weekend `sat,sun`: the slot starting Sat 01:00 local is priced by weekday rules, a Saturday closure leaves it, and a Friday closure removes it. (Task 3 tests.)
3. **Concurrent overlapping overrides.** Two `add` overrides with overlapping ranges for the same turf and date, sent at once: exactly one 201, the other 409 `override_overlap`. (Task 6 test.)
4. **Tenancy.** Pricing, overrides, closures and slots of another owner's turf, or of a venue outside a manager's scope, give 404 with the same body. (Task 4, 5, 6 and 7 tests.)
5. **Public slots leaks and bad input.** Unpublished venue, suspended owner or inactive turf → 404; `date=2026-02-30` → 400; a date past the booking window → `outside_window` with no slots. (Task 7 tests.)

---

## File Structure

```
packages/shared/src/
  time.ts        # isIsoDate, weekdayOf, addDays, hmToMin, rangeMinutes, localToUtc, localParts
  pricing.ts     # PricingRule, TurfPricing, priceFor(), pricingConflict()
  slots.ts       # override types, overrideAppliesOn(), overrideDatesIntersect(), generatedRanges(), computeSlots()
  index.ts       # MODIFY: export all three
apps/api/src/
  venues/settingsSchema.ts   # MODIFY: per-day null in hours
  venues/turf.model.ts       # MODIFY: pricing field
  venues/guards.ts           # MODIFY: scopedTurf(), turfNotFound, lockTurf()
  venues/routes/turfs.ts     # MODIFY: use scopedTurf; turfJson gains pricing
  schedule/
    slotOverride.model.ts
    closure.model.ts
    schemas.ts               # Zod: pricing, override, closure, date query
    load.ts                  # loadDay()
    routes/pricing.ts
    routes/closures.ts
    routes/overrides.ts
    routes/slots.ts          # owner slots
    routes/publicSlots.ts    # public slots
  tenancy/routes/owner.ts    # MODIFY: mount schedule routers
  app.ts                     # MODIFY: mount public slots router
apps/api/test/helpers/venues.ts   # MODIFY: seedTurf accepts pricing
apps/api/test/schedule/*.test.ts
packages/shared/test/time.test.ts, pricing.test.ts, slots.test.ts
```

---

### Task 1: Shared time helpers

**Files:**
- Create: `packages/shared/src/time.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/time.test.ts`

**Interfaces:**
- Consumes: `WEEKDAYS`, `Weekday` (`venues.ts`).
- Produces:
  - `isIsoDate(s: string): boolean` — `^\d{4}-\d{2}-\d{2}$` and a real calendar date.
  - `weekdayOf(date: string): Weekday`
  - `addDays(date: string, n: number): string`
  - `hmToMin(hm: string): number` — `'01:30'` → 90.
  - `rangeMinutes(r: { start: string; end: string }): [number, number]` — end ≤ start adds 1440; `start === end` → `[s, s + 1440]`.
  - `localToUtc(date: string, minuteOfDay: number, tz: string): Date` — `minuteOfDay` may be ≥ 1440 (rolls into following dates). Compatible disambiguation.
  - `localParts(at: Date, tz: string): { date: string; hm: string }`

`localToUtc` algorithm (transitions are assumed ≥ 48 h apart):

```ts
// offsetMin(tz, ms): local wall minus UTC, in minutes, via Intl.DateTimeFormat formatToParts (hourCycle 'h23').
const wall = Date.UTC(y, m - 1, d) + minuteOfDay * 60_000;
const before = offsetMin(tz, wall - 86_400_000);
const after = offsetMin(tz, wall + 86_400_000);
const fits = [...new Set([before, after])]
  .map((o) => wall - o * 60_000)
  .filter((t) => t + offsetMin(tz, t) * 60_000 === wall);
if (fits.length) return new Date(Math.min(...fits)); // repeated hour → earlier instant
return new Date(wall - before * 60_000);             // skipped hour → after the gap
```

- [ ] **Step 1: Write failing tests (`time.test.ts`)**
  - `isIsoDate`: `'2026-10-30'` true; `'2026-02-30'`, `'2026-13-01'`, `'26-10-30'`, `''` false.
  - `weekdayOf('2026-10-30')` → `'fri'`; `addDays('2026-12-31', 1)` → `'2027-01-01'`; `addDays('2026-03-01', -1)` → `'2026-02-28'`.
  - `rangeMinutes({ start: '16:00', end: '02:00' })` → `[960, 1560]`; `{ '08:00','08:00' }` → `[480, 1920]`.
  - `localToUtc('2026-10-30', 960, 'Asia/Dhaka')` → `2026-10-30T10:00:00Z`; minute `1500` → `2026-10-30T19:00:00Z`.
  - Gap: `localToUtc('2026-03-29', 90, 'Europe/London')` → `2026-03-29T01:30:00Z`.
  - Repeat: `localToUtc('2026-10-25', 90, 'Europe/London')` → `2026-10-25T00:30:00Z`.
  - `localParts(new Date('2026-10-30T19:00:00Z'), 'Asia/Dhaka')` → `{ date: '2026-10-31', hm: '01:00' }`.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter @booking/shared test` — Expected: FAIL (missing exports).
- [ ] **Step 3: Implement `time.ts` and export it.**
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(shared): timezone and business-date helpers`

---

### Task 2: Shared pricing

**Files:**
- Create: `packages/shared/src/pricing.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/pricing.test.ts`

**Interfaces:**
- Consumes: Task 1 `rangeMinutes`.
- Produces:
  - `TimeRange = { start: string; end: string }`
  - `PricingRule = { kind: 'date'; date: string; range?: TimeRange; price: number } | { kind: 'weekend'; range?: TimeRange; price: number } | { kind: 'weekday'; range?: TimeRange; price: number }`
  - `TurfPricing = { base: number; rules: PricingRule[] }`
  - `priceFor(pricing: TurfPricing, at: { businessDate: string; weekend: boolean; minute: number }): number` — first tier with a matching rule wins; `minute` is the slot's start minute in `[0, 2880)`; a rule range `[s, e)` matches `s <= minute < e`; no range matches all.
  - `pricingConflict(rules: PricingRule[]): [number, number] | null` — indexes of the first two rules of the same tier (same `date` for tier 1) whose ranges overlap; a rule with no range overlaps everything in its tier.

- [ ] **Step 1: Write failing tests (`pricing.test.ts`)**
  - Fixture: `base 1000`; `weekday 18:00–22:00 → 1400`; `weekday 22:00–02:00 → 1200`; `weekend (no range) → 1500`; `date '2026-12-16' 16:00–20:00 → 2000`.
  - `tiers`: weekday minute 1170 (19:30) → 1400; weekday minute 1500 (01:00 next day) → 1200; weekday minute 600 → 1000; weekend minute 600 → 1500; `'2026-12-16'` weekend minute 1020 → 2000; same date minute 1260 → 1500.
  - `pricingConflict`: fixture → `null`; adding `weekday 21:00–23:00` as index 4 → `[0, 4]`; two `date` rules on different dates with the same range → `null`; two no-range weekend rules → conflict.
- [ ] **Step 2: Run** the shared tests — Expected: FAIL.
- [ ] **Step 3: Implement `pricing.ts` and export it.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(shared): pricing rules and resolution`

---

### Task 3: Shared slot engine

**Files:**
- Create: `packages/shared/src/slots.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/slots.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; Task 2 `TurfPricing`, `priceFor`; `DayHours`, `Weekday`.
- Produces:
  - `OverrideWhen = { date: string } | { recurrence: { weekdays: Weekday[]; from: string; until?: string } }`
  - `OverrideRule = { type: 'block'; start: string; end: string } | { type: 'modify'; slotStart: string; start: string; end: string; price?: number } | { type: 'add'; start: string; end: string; price?: number } | { type: 'close' }`
  - `SlotOverrideLike = OverrideWhen & OverrideRule`
  - `overrideAppliesOn(o: OverrideWhen, date: string): boolean`
  - `overrideDatesIntersect(a: OverrideWhen, b: OverrideWhen): boolean` — date/date: equal; date/recurrence: `overrideAppliesOn`; recurrence/recurrence: some date in the intersection of `[from, until ?? ∞]` (scan at most 7 days from its start) applies to both.
  - `generatedRanges(hours: DayHours, slotLengthMin: number): [number, number][]` — minute ranges, no DST (used by the overlap check).
  - `SlotStatus = 'available' | 'pending' | 'booked' | 'blocked' | 'past'`
  - `ComputedSlot = { startAt: Date; endAt: Date; localStart: string; localEnd: string; price: number | null; status: SlotStatus; source: 'hours' | 'modify' | 'add' }`
  - `DaySlots = { businessDate: string; closed: boolean; closedReason: string | null; slots: ComputedSlot[] }`
  - `computeSlots(input: { businessDate: string; timezone: string; hours: DayHours; weekend: boolean; slotLengthMin: number; pricing: TurfPricing | null; overrides: (OverrideRule & { reason?: string | null })[]; closure: { reason: string | null } | null; taken?: { startAt: Date; status: 'pending' | 'booked' }[]; now: Date }): DaySlots`

`computeSlots` order:
1. `closure` or any `close` override → `{ closed: true, closedReason, slots: [] }` (`closedReason` = closure reason ?? the `close` override's `reason` ?? `null`).
2. Generate from `hours` by elapsed minutes (Decisions). `'closed'` hours → none.
3. Apply `modify`, then append `add` (both converted with `localToUtc`).
4. Drop `hours` slots that overlap any modify/add slot; sort by `startAt`.
5. `block` ranges → `blocked`.
6. Price: override `price` ?? (`pricing` ? `priceFor` with the slot's start minute : `null`).
7. Status by the priority in Decisions.

- [ ] **Step 1: Write failing tests (`slots.test.ts`)**
  - `cuts by slot length and drops the leftover`: Asia/Dhaka, `2026-10-30`, hours `16:00–02:00`, 90 min → 6 slots, `localStart` `16:00 … 23:30`, last `localEnd` `'01:00'`.
  - `24-hour day`: hours `00:00–00:00`, 120 min → 12 slots.
  - `spring-forward night`: Europe/London, `2026-03-28`, `16:00–02:00`, 60 min → 9 slots, last `localStart` `'00:00'`, all `startAt` unique.
  - `fall-back night`: Europe/London, `2026-10-24`, `16:00–02:00`, 60 min → 11 slots, all `startAt` unique, `localStart` `'01:00'` appears twice.
  - `past-midnight slot belongs to its business day`: Dhaka Fri `2026-10-30`, `weekend: false`, Task 2 fixture → the slot starting Sat 01:00 local is priced 1200 (not the weekend 1500).
  - `closure and close override`: `closure: { reason: 'Eid' }` → `closed: true`, `closedReason: 'Eid'`, no slots; a `close` override → closed.
  - `modify, add, block`: hours `16:00–20:00`, 60 min; `modify { slotStart: '17:00', start: '17:00', end: '18:30', price: 900 }` drops the `18:00` slot and gives a `modify` slot priced 900; `add { start: '20:00', end: '21:00' }` appends; `block { start: '16:00', end: '17:00' }` → first slot `blocked`.
  - `status`: `now` between the first and second slot → first `past`; `taken` with the third slot's `startAt` as `pending` → `pending`; `pricing: null` → every `price` null.
  - `overrideDatesIntersect`: `{ date: '2026-11-02' }` vs `{ recurrence: { weekdays: ['mon'], from: '2026-11-01' } }` → true; vs `{ weekdays: ['tue'] … }` → false; `{ weekdays: ['mon'], from: '2026-11-03', until: '2026-11-08' }` vs `{ weekdays: ['mon'], from: '2026-11-01' }` → false (no Monday in the overlap).
- [ ] **Step 2: Run** the shared tests — Expected: FAIL.
- [ ] **Step 3: Implement `slots.ts` and export it.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(shared): computeSlots with overrides, closures and pricing`

---

### Task 4: Per-day hours reset, turf pricing and the pricing route

**Files:**
- Create: `apps/api/src/schedule/schemas.ts`, `apps/api/src/schedule/routes/pricing.ts`
- Modify:
  - `apps/api/src/venues/settingsSchema.ts`: each weekday `dayHoursSchema.nullable().optional()`; `applyPatch` deletes a day set to `null` inside `hours`
  - `apps/api/src/venues/turf.model.ts`: `pricing: { type: Mixed, default: null }`
  - `apps/api/src/venues/guards.ts`: move in `turfNotFound`; add `scopedTurf`, `lockTurf`
  - `apps/api/src/venues/routes/turfs.ts`: use `scopedTurf`; `turfJson` gains `pricing`
  - `apps/api/src/tenancy/routes/owner.ts`: mount `pricingRouter(services)`
  - `apps/api/test/helpers/venues.ts`: `seedTurf` accepts `pricing`
- Test: `apps/api/test/venues/settings.test.ts` (extend), `apps/api/test/schedule/pricing.test.ts`

**Interfaces:**
- Consumes: Task 2 `TurfPricing`, `pricingConflict`; Plan 04 `scopedVenue`, `lockVenue`, `logActivity`.
- Produces:
  - `scopedTurf(t: TenantContext, venueId: string, turfId: string): Promise<{ venue: VenueDoc; turf: TurfDoc }>` — 404 "Venue not found" / "Turf not found" as in Plan 04.
  - `lockTurf(t, turfId, at, session): Promise<void>` — same contract as `lockVenue` (404 "Turf not found" when gone).
  - `pricingSchema` (strict): `base` and every `price` integer ≥ 0 passing `assertMinor`; `date` via `isIsoDate`; `range` times `HH:MM`; ≤ 100 rules; `pricingConflict` non-null → issue `"Rules <i> and <j> overlap"`.
  - `PUT /owners/:ownerId/venues/:venueId/turfs/:turfId/pricing` — `pricing.edit`; body `TurfPricing` → 200 `{ pricing }`; logs `pricing.update` (entity `turf`, `before`/`after` pricing).
  - `isoDateSchema`, `timeSchema` exported from `schemas.ts` for Tasks 5–7.

- [ ] **Step 1: Write failing tests**
  - `settings.test.ts` → `a weekday set to null resets only that day`: venue hours `{ mon: 'closed', fri: 16:00–02:00 }`, PATCH `{ hours: { mon: null } }` → stored hours `{ fri: … }`, effective mon `08:00–22:00`.
  - `pricing.test.ts`:
    - `sets pricing and shows it on the turf`: PUT fixture of Task 2 → 200; GET turf `pricing` deep-equals it; activity row `pricing.update`.
    - `rejects bad pricing`: `base: 10.5`, `price: -1`, `date: '2026-02-30'`, overlapping weekday rules → 400 `validation_error`.
    - `needs pricing.edit`: staff → 403.
    - `other owner or out-of-scope venue → 404`: owner B's turf → 404 "Venue not found"; manager limited to V1 on V2's turf → 404; a turf id of V2 under V1 → 404 "Turf not found".
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/schedule/pricing.test.ts test/venues/settings.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files, then `node_modules/.bin/pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): turf pricing route; reset one weekday of an hours override`

---

### Task 5: Closures

**Files:**
- Create: `apps/api/src/schedule/closure.model.ts`, `apps/api/src/schedule/routes/closures.ts`
- Modify: `apps/api/src/schedule/schemas.ts`, `apps/api/src/tenancy/routes/owner.ts`
- Test: `apps/api/test/schedule/closures.test.ts`

**Interfaces:**
- Consumes: Task 4 `scopedTurf`, `isoDateSchema`; Plan 04 `scopedVenue`.
- Produces:
  - `Closure` model (`tenantScoped`, timestamps): `ownerId`, `venueId: ObjectId | null`, `turfId: ObjectId | null`, `from`, `to` (`'YYYY-MM-DD'`, inclusive), `reason: string | null` (≤ 200). Index `{ ownerId: 1, venueId: 1, from: 1 }`.
  - `closureFor(ownerId: string, venueId: string, turfId: string, date: string): Promise<{ reason: string | null } | null>` — owner, venue or turf level, `from <= date <= to`.
  - Routes under `/owners/:ownerId`:
    - `GET /closures?venueId=&turfId=` — owner-level plus those of venues in the member's scope (filtered by the query when given).
    - `POST /closures` body `{ venueId?, turfId?, from, to, reason? }` — `turfId` needs `venueId` and must belong to it; `to >= from`, span ≤ 366 days (else 400). Permission per Decisions. Logs `closure.create` → 201 `{ closure }`.
    - `DELETE /closures/:closureId` — same permission rule as create; logs `closure.delete` → 204.
  - `closureJson`: `id, venueId, turfId, from, to, reason`.

- [ ] **Step 1: Write failing tests (`closures.test.ts`)**
  - `creates owner, venue and turf closures; closureFor finds each`: on `2026-12-16` each applies to the turf; `2026-12-17` outside → `null`.
  - `validates ranges`: `to < from`, a 367-day span, `turfId` without `venueId`, a turf of another venue → 400 (the last: 404 "Turf not found").
  - `owner-level closure needs settings.edit and all-venue scope`: manager → 403 `forbidden`; manager limited to V1 creating for V1 → 201.
  - `out of scope → 404`: manager limited to V1 posting for V2 → 404 "Venue not found"; deleting owner B's closure → 404.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/schedule/closures.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then the full suite — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): owner, venue and turf closures`

---

### Task 6: Slot overrides with overlap rejection

**Files:**
- Create: `apps/api/src/schedule/slotOverride.model.ts`, `apps/api/src/schedule/routes/overrides.ts`
- Modify: `apps/api/src/schedule/schemas.ts`, `apps/api/src/tenancy/routes/owner.ts`
- Test: `apps/api/test/schedule/overrides.test.ts`

**Interfaces:**
- Consumes: Task 3 `overrideAppliesOn`, `overrideDatesIntersect`, `generatedRanges`, `rangeMinutes`; Task 4 `scopedTurf`, `lockTurf`; Plan 04 `effectiveForTurf`.
- Produces:
  - `SlotOverride` model (`tenantScoped`, timestamps): `ownerId`, `venueId`, `turfId`, `date?`, `recurrence? { weekdays, from, until? }`, `type`, `slotStart?`, `start?`, `end?`, `price?`, `reason: string | null`. Indexes `{ ownerId: 1, turfId: 1, date: 1 }` and `{ ownerId: 1, turfId: 1, 'recurrence.from': 1 }`.
  - `overridesFor(ownerId: string, turfId: string, date: string): Promise<(OverrideRule & { reason: string | null })[]>`
  - Routes under `/owners/:ownerId/venues/:venueId/turfs/:turfId`:
    - `GET /overrides?from=&to=` — any member in scope; dated ones in range plus recurring ones intersecting it.
    - `POST /overrides` — `slot.override`. Body: exactly one of `date` / `recurrence` (weekdays 1–7 unique, `until >= from`), plus the type's fields (strict per type; `price` only on add/modify). In one transaction: `lockTurf`, load the turf's add/modify overrides, check overlap and target per Decisions, create, log `override.create` → 201 `{ override }`.
    - `DELETE /overrides/:overrideId` — `slot.override`; logs `override.delete` → 204.
  - Errors: 409 `override_overlap` "This slot overlaps another slot on this turf"; 409 `slot_not_found` "No slot starts at that time".

- [ ] **Step 1: Write failing tests (`overrides.test.ts`)** — turf with hours `16:00–22:00`, 60 min, in Asia/Dhaka:
  - `add after closing time → 201; add over a generated slot → 409 override_overlap`: `add 22:00–23:00` on `2026-10-30` → 201; `add 17:30–18:30` → 409.
  - `add/add on intersecting dates → 409`: dated `add 22:00–23:00` on Fri `2026-10-30`, then recurring `{ weekdays: ['fri'], from: '2026-10-01' }` `add 22:30–23:30` → 409; same with `weekdays: ['sat']` → 201.
  - `modify needs a matching slot`: `modify slotStart '17:00' → 17:00–18:30` → 409 (overlaps the 18:00 slot); `modify slotStart '21:00' → 21:00–22:30` → 201; `slotStart '17:15'` → 409 `slot_not_found`.
  - `block and close never overlap-check`: `block 16:00–18:00` and `close` on the same date → 201 each.
  - `concurrent overlapping adds → exactly one wins`: `Promise.all` of two POSTs `add 22:00–23:00` and `add 22:30–23:30` on the same date → statuses sorted `[201, 409]`, one override stored.
  - `validation`: both `date` and `recurrence`, neither, `price` on block, `until < from`, `date: '2026-02-30'` → 400.
  - `scope`: staff → 403; manager limited to V1 on V2's turf → 404; owner B's override delete → 404.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/schedule/overrides.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file (twice, to catch flakiness in the concurrency test), then the full suite — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): slot overrides with overlap rejection`

---

### Task 7: Slots endpoints (owner and public)

**Files:**
- Create: `apps/api/src/schedule/load.ts`, `apps/api/src/schedule/routes/slots.ts`, `apps/api/src/schedule/routes/publicSlots.ts`
- Modify: `apps/api/src/tenancy/routes/owner.ts`, `apps/api/src/app.ts` (mount `publicSlotsRouter()` next to `publicVenuesRouter()`)
- Test: `apps/api/test/schedule/slots.test.ts`

**Interfaces:**
- Consumes: Task 3 `computeSlots`; Task 5 `closureFor`; Task 6 `overridesFor`; Task 1 `weekdayOf`, `localParts`, `addDays`; Plan 04 `effectiveForTurf`, public venue lookup rules.
- Produces:
  - `loadDay(ownerId: string, venue: VenueDoc, turf: TurfDoc, businessDate: string, now: Date): Promise<{ day: DaySlots; settings: EffectiveSettings }>` — effective settings, `hours[weekdayOf(date)]`, `weekend = weekendDays.includes(weekday)`, closure, overrides, `computeSlots`. Plan 07 adds `taken`.
  - `inWindow(businessDate: string, now: Date, tz: string, bookingWindowDays: number): boolean` — per Decisions.
  - `slotJson(s)`: `{ startAt, endAt (ISO), localStart, localEnd, price, status, source }`.
  - Owner: `GET /owners/:ownerId/venues/:venueId/turfs/:turfId/slots?date=YYYY-MM-DD` → 200 `{ day: { businessDate, currency, closed, closedReason, inWindow, slots } }`. Any member in scope; inactive turfs included.
  - Public: `GET /api/v1/venues/:slug/turfs/:turfId/slots?date=` → 200 `{ day: { businessDate, currency, status: 'open' | 'closed' | 'outside_window', slots } }` — `closed`/`outside_window` have `slots: []`; `closedReason` is not exposed; `source` is not exposed. Venue 404 rules exactly as `GET /venues/:slug`; a turf not in that venue or inactive → 404 "Turf not found".
  - Missing or invalid `date` → 400 `validation_error`.

- [ ] **Step 1: Write failing tests (`slots.test.ts`)** — `services.now()` fixed at `2026-10-30T09:00:00Z` (15:00 Dhaka); turf hours fri `16:00–02:00`, 60 min, Task 2 pricing fixture:
  - `owner sees the day with prices and statuses`: `date=2026-10-30` → 10 slots, first `localStart` `'16:00'` `available`, the `01:00` slot price 1200, `currency` `'BDT'`.
  - `closure, override and window feed in`: a venue closure on `2026-10-31` leaves Friday's `01:00` slot; a Friday closure → `closed: true`; a `block 16:00–17:00` → first slot `blocked`; with `now` at `2026-10-30T11:30:00Z` the first slot is `past`.
  - `public day`: published venue → `status 'open'`, slot keys exactly `startAt, endAt, localStart, localEnd, price, status`; `date` 31 days ahead (window 30) → `outside_window`, `slots: []`; Friday closure → `closed`.
  - `public 404s`: unpublished venue, suspended owner, inactive turf, another venue's turf → 404 with identical bodies per entity.
  - `bad date → 400` on both endpoints: missing, `'2026-02-30'`, `'30-10-2026'`.
  - `owner scope`: manager limited to V1 reading V2's turf slots → 404.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/schedule/slots.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then `node_modules/.bin/pnpm test`, `pnpm -r typecheck`, `pnpm lint` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): owner and public slots endpoints`
