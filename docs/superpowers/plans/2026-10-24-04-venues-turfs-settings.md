# Plan 04 — Venues, Turfs & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners create venues and turfs, set owner-wide settings, override them per venue and turf, and publish venues so players can open a public venue page — with one function, `resolveSettings`, deciding every effective setting.

**Architecture:**
- **Shared package.** Settings types, defaults and the pure `resolveSettings` live in `packages/shared`, so the web app can show the same effective values later. The package also holds the new constants (sports, amenities, weekdays) plus timezone and slug helpers.
- **API module.** A new `apps/api/src/venues/` module holds the `Venue` and `Turf` models (both `tenantScoped`). It adds owner settings routes, venue and turf CRUD under `/owners/:ownerId/…`, and one public read, `GET /api/v1/venues/:slug`.
- **Members fix.** The members endpoints from Plan 03 start checking that venue ids exist.

**Tech Stack:** Plan 01–03 stack. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md`:
- §6 (core concepts, settings inheritance)
- §4 (country, currency, timezone, minor units)
- §5 (tenancy rule; player reads expose only published venues)
- §10 (advance disables guest booking)
- §12 (refund rules)
- §16 (`venues`, `turfs`)

Roadmap: `docs/superpowers/plans/2026-10-23-roadmap.md` (Plan 04; failure modes 2 and 5).

## Global Constraints

- **Earlier plans still apply.**
  - From Plans 01–03: TS strict, ESM, error shape `{ error: { code, message, details? } }`, `/api/v1`, injected `services.now()`.
  - Owner routes mount on `ownerRouter`. Every query goes through `tenantRepo` or carries an explicit `ownerId`.
  - Mutations and their `logActivity` run in one `runInTransaction`.
- **Tenancy.** Quoted from spec §5: "Every owner-scoped collection carries `ownerId`" and "Player-facing reads (search, venue page) only expose published venues."
  - Venue and turf compound indexes start with `ownerId`.
  - Another owner's data, or a venue outside the member's scope, gives `404 not_found` and never any data.
- **Money.** Integers in minor units; validate with `assertMinor`. No floats.
- **Location.** Venue location is a GeoJSON Point `[lng, lat]` with a `2dsphere` index. The API speaks `{ lat, lng }`.
- **Time.** Times stay UTC. Each venue has an IANA timezone, and nothing in this plan computes slots (that is Plan 05).
- **Settings inheritance** follows the spec §6 table exactly:
  - Owner level: hours, weekend days, payment policy, guest booking, refund rules, booking window.
  - Venue overrides: the same six.
  - Turf overrides: hours only.
  - Slot length is set on the turf only and is required.
  - Closed dates belong to Plan 05.
- **No UI in this plan.** The owner dashboard (Plan 13) and player pages (Plan 12) must follow `.superdesign/design-system.md` and use `apps/web/src/styles/tokens.css`. API field names here are what those screens will bind to.

## Decisions made in this plan (builder's calls)

- **Settings storage.**
  - `Owner.settings` stores only the keys the owner has set, and `withOwnerDefaults` fills in the rest, so improving a default later reaches every owner who never touched it.
  - Each override replaces a key whole, except `hours`, which merges per weekday. Owner, then venue, then turf: a venue can change only Friday.
  - In a PATCH, `null` resets a key: at owner level to the default, at venue and turf level to "inherit".
- **Hours shape.**
  - `hours` is `Record<Weekday, DayHours>`, where `DayHours = { open: 'HH:MM'; close: 'HH:MM' } | 'closed'`.
  - When `close <= open` the session ends the next day, and `open === close` means 24 hours. Plan 05 turns this into slots.
  - One session per day.
- **Payment policy** is one of `{ type: 'none' }`, `{ type: 'full' }`, `{ type: 'partial_percent', percent }` or `{ type: 'partial_fixed', amount }`.
  - `partial_fixed` is allowed only on a venue, because the amount is in the venue's currency. At owner level it is rejected with 400 `validation_error`.
  - Guest booking is effectively off whenever the policy is anything but `none` (spec §10). `resolveSettings` enforces this, whatever is stored.
- **Defaults:**
  - every day `08:00`–`22:00`
  - `weekendDays: ['sat','sun']`
  - `paymentPolicy: { type: 'none' }`
  - `guestBooking: { allowed: true, requireOtp: true }`
  - `refundRules: []` (no refund)
  - `bookingWindowDays: 30`
  - `pendingAutoRejectHours: 2`, which is owner-level only
- **Refund rules** are `{ minHoursBefore, percent }[]`:
  - at most 10
  - thresholds must be unique
  - `percent` 0–100 with at most 2 decimals
  - stored sorted by `minHoursBefore` descending
  - hours rather than the spec's days, so short notice periods are possible
- **Venue currency** is fixed at creation (default: the owner's `defaultCurrency`); prices and bookings will depend on it. Country and timezone can be edited.
- **Slugs** are unique platform-wide.
  - Generated from the name by `slugify`, which transliterates Cyrillic. On a collision it appends `-2`, `-3` and so on.
  - An explicit slug that is taken gives 409 `slug_taken`.
  - Format: `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–60 characters.
- **Creating venues.**
  - Creating a venue needs `venue.manage` and all-venue scope, because a venue-limited member could not see the new venue. Otherwise 403 `forbidden`.
  - Venue and turf reads need only membership plus venue scope.
- **Publishing.**
  - `published: true` needs at least one active turf, otherwise 409 `venue_not_ready`.
  - Deactivating or deleting the last active turf of a published venue gives 409 `last_active_turf`.
- **Deleting.**
  - Deleting a venue gives 409 `venue_has_turfs` while turfs exist. A successful delete also removes the venue id from every membership, in the same transaction.
  - Turf delete is a hard delete for now; Plan 07 must refuse it once bookings exist.
- **Turfs.**
  - `slotLengthMin` is set at creation only: 30–240 in steps of 15.
  - Turf names are unique per venue, ignoring case.
- **Photos** are `{ url (https), alt? }[]`, at most 20. Upload and storage provider are left to Plan 13 (spec §18).
- **Sports and amenities** come from fixed lists in shared, so search can filter on them and the web can translate their keys.
- **Public venue page.**
  - `GET /api/v1/venues/:slug` needs no auth and returns only public fields plus active turfs.
  - It is the second deliberate `crossTenant` query, documented at the call site.
- **Members carry-over.** Venue ids in POST/PATCH `/members` that are not this owner's venues give `404 not_found` "Venue not found", the same for other owners' venues and ids that don't exist.

## Review Focus

1. **Out of scope gives 404.** A member of owner A, or a manager limited to venue V1, reads or edits a venue or turf of owner B or of V2: `404 not_found`, the same body every time. (Task 3 and Task 4 tests.)
2. **Coordinates.** `{ lat, lng }` swapped or out of range (`lat: 91`, `lng: 181`) gives 400. A valid `{ lat: 23.81, lng: 90.41 }` is stored as `[90.41, 23.81]`. (Task 3 test "stores location as [lng, lat] and rejects out-of-range".)
3. **Advance vs guest booking.**
   - Owner says `guestBooking.allowed: true` and a venue sets `partial_percent`: the effective `guestBooking.allowed` is `false`.
   - `partial_fixed` at owner level is rejected. (Task 1 and Task 2 tests.)
4. **Public page leaks.**
   - An unpublished venue, or a slug that doesn't exist, gives 404 with the same body.
   - A published venue's response has no `ownerId`, no settings overrides and no inactive turfs. (Task 6 tests.)
5. **Slugs.**
   - A Russian name such as `"Арена Москва"` gives slug `arena-moskva`.
   - Two venues with the same name get `x` and `x-2`.
   - Bad timezone `"Asia/Dhak"` gives 400. (Task 1 and Task 3 tests.)

---

## File Structure

```
packages/shared/src/
  venues.ts            # SPORTS, AMENITIES, WEEKDAYS, isTimeZone(), slugify()
  settings.ts          # types, DEFAULT_OWNER_SETTINGS, withOwnerDefaults(), resolveSettings()
  index.ts             # MODIFY: export both
apps/api/src/
  venues/
    settingsSchema.ts  # Zod: ownerSettingsPatch, venueSettingsPatch, turfHoursPatch, hours/policy/refund parts
    venue.model.ts
    turf.model.ts
    effective.ts       # effectiveForVenue(), effectiveForTurf() — load docs, call resolveSettings
    routes/settings.ts # GET/PATCH /settings
    routes/venues.ts   # /venues CRUD
    routes/turfs.ts    # /venues/:venueId/turfs CRUD
    routes/public.ts   # GET /api/v1/venues/:slug
  tenancy/routes/owner.ts    # MODIFY: mount settings, venues, turfs routers
  tenancy/routes/members.ts  # MODIFY: venue existence check
  app.ts                     # MODIFY: mount public router
apps/api/test/
  helpers/venues.ts    # seedVenue(), seedTurf()
  venues/*.test.ts
packages/shared/test/settings.test.ts, venues.test.ts
```

---

### Task 1: Shared constants, settings types and `resolveSettings`

**Files:**
- Create: `packages/shared/src/venues.ts`, `packages/shared/src/settings.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/venues.test.ts`, `packages/shared/test/settings.test.ts`

**Interfaces:**
- Consumes: `assertMinor` (`money.ts`).
- Produces:
  - **Constants:**
    - `WEEKDAYS = ['mon','tue','wed','thu','fri','sat','sun'] as const` and type `Weekday`
    - `SPORTS = ['football','futsal','cricket','badminton','tennis','table_tennis','basketball','volleyball','padel','squash','pickleball','hockey'] as const` and type `Sport`
    - `AMENITIES = ['parking','shower','locker','changing_room','toilets','cafe','wifi','floodlights','first_aid','equipment_rental','seating','prayer_room'] as const` and type `Amenity`
  - **`isTimeZone(tz: string): boolean`**: true for `Intl.supportedValuesOf('timeZone')` or `'UTC'`.
  - **`slugify(name: string): string`**:
    - lowercase; transliterate Cyrillic with a fixed map (`а→a … ж→zh х→kh ц→ts ч→ch ш→sh щ→shch ъ→'' ы→y ь→'' э→e ю→yu я→ya ё→e й→y`)
    - drop other non-`[a-z0-9]` characters; collapse runs into `-`; trim `-`
    - cut to 60 characters on a `-` boundary
    - return `'venue'` if the result has fewer than 3 characters
  - **`SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/`**
  - **Types:**
    - `DayHours = { open: string; close: string } | 'closed'`
    - `WeeklyHours = Record<Weekday, DayHours>`
    - `PaymentPolicy = { type: 'none' } | { type: 'full' } | { type: 'partial_percent'; percent: number } | { type: 'partial_fixed'; amount: number }`
    - `RefundRule = { minHoursBefore: number; percent: number }`
    - `GuestBooking = { allowed: boolean; requireOtp: boolean }`
    - `OwnerSettings = { hours: WeeklyHours; weekendDays: Weekday[]; paymentPolicy: PaymentPolicy; guestBooking: GuestBooking; refundRules: RefundRule[]; bookingWindowDays: number; pendingAutoRejectHours: number }`
    - `VenueSettingsOverride = Partial<Omit<OwnerSettings, 'hours' | 'pendingAutoRejectHours'>> & { hours?: Partial<WeeklyHours> }`
    - `TurfSettingsOverride = { hours?: Partial<WeeklyHours> }`
    - `EffectiveSettings = OwnerSettings`
  - **`DEFAULT_OWNER_SETTINGS: OwnerSettings`**, with the values in Decisions.
  - **`withOwnerDefaults(stored: Partial<OwnerSettings>): OwnerSettings`**: shallow fill; `hours` merges per day.
  - **`resolveSettings(owner: OwnerSettings, venue?: VenueSettingsOverride, turf?: TurfSettingsOverride): EffectiveSettings`**:
    - pure; never mutates its inputs
    - `hours` merges per day, owner then venue then turf
    - other keys: the venue's value wins when present
    - `guestBooking.allowed` becomes `false` unless the effective `paymentPolicy.type === 'none'`

- [ ] **Step 1: Write failing tests**

`venues.test.ts`:
- `slugify transliterates and cleans`:
  - `'Арена Москва'` → `'arena-moskva'`
  - `'  Big  Turf!! #1 '` → `'big-turf-1'`
  - `'Щука'` → `'shchuka'`
  - `'!!'` → `'venue'`
  - a 100-character name gives a result of at most 60 characters, matching `SLUG_RE` and not ending in `-`
- `isTimeZone`: `'Asia/Dhaka'`, `'Europe/Moscow'` and `'UTC'` → true; `'Asia/Dhak'` and `''` → false.

`settings.test.ts`:
- `withOwnerDefaults fills missing keys and merges hours per day`:
  - `withOwnerDefaults({})` deep-equals `DEFAULT_OWNER_SETTINGS`
  - `withOwnerDefaults({ hours: { fri: 'closed' } as never }).hours` has `fri: 'closed'` and `mon: { open: '08:00', close: '22:00' }`
- `venue overrides replace whole keys; hours merge per day through turf`:
  - owner refund rules A, venue refund rules B → B
  - owner `mon 08–22`, venue `{ fri: { open: '16:00', close: '02:00' } }`, turf `{ mon: 'closed' }` → mon `'closed'`, fri `16:00–02:00`, tue `08–22`
- `advance required disables guest booking`:
  - owner `guestBooking { allowed: true, requireOtp: false }`, venue `paymentPolicy { type: 'partial_percent', percent: 20 }` → effective `guestBooking.allowed` false, `requireOtp` false
  - same venue with `{ type: 'none' }` → true
- `resolveSettings does not mutate inputs`: deep-freeze owner, venue and turf, then call; no throw.

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter @booking/shared test` — Expected: FAIL (missing exports).

- [ ] **Step 3: Implement `venues.ts`, `settings.ts` and the exports.**

- [ ] **Step 4: Run** the same command — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(shared): venue constants, settings types and resolveSettings`

---

### Task 2: Settings validation and owner settings routes

**Files:**
- Create: `apps/api/src/venues/settingsSchema.ts`, `apps/api/src/venues/routes/settings.ts`
- Modify: `apps/api/src/tenancy/routes/owner.ts` (mount `settingsRouter(services)`)
- Test: `apps/api/test/venues/settings.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `WEEKDAYS`, `assertMinor`, `requirePermission`, `tenantOf`, `logActivity`, `runInTransaction`, `Owner`.
- Produces:
  - **Schema parts:**
    - `dayHoursSchema`: `'closed'` or `{ open, close }` matching `/^([01]\d|2[0-3]):[0-5]\d$/`
    - `hoursPatchSchema`: an object of optional weekday keys, `.strict()`
    - `paymentPolicySchema({ allowFixed: boolean })`:
      - percent must be above 0 and below 100, with at most 2 decimals
      - fixed amount must be an integer above 0 that passes `assertMinor`
    - `refundRulesSchema`:
      - at most 10 rules
      - `minHoursBefore` is an integer from 0 to 8760, with no duplicates
      - percent is 0–100 with at most 2 decimals
      - output sorted by `minHoursBefore` descending
    - `weekendDaysSchema`: unique weekdays, at most 7 (may be empty)
    - `bookingWindowDays`: integer 1–365
    - `pendingAutoRejectHours`: integer 0–72
  - **Patch schemas** (each `.strict()`, each value nullable for reset):
    - `ownerSettingsPatchSchema` (fixed policy not allowed)
    - `venueSettingsPatchSchema` (fixed allowed; no `pendingAutoRejectHours`)
    - `turfSettingsPatchSchema = { hours? }`
  - **`applyPatch<T>(stored: T, patch: Record<string, unknown>): T`**:
    - `null` deletes the key
    - for `hours`, the per-day keys merge into the stored hours; a whole `hours: null` deletes the stored hours
    - every other key replaces
  - **Routes:**
    - `GET /owners/:ownerId/settings`: any member → `{ settings: OwnerSettings }`, built with `withOwnerDefaults(owner.settings)`
    - `PATCH /owners/:ownerId/settings`: needs `settings.edit`
      - validates and applies the patch to the stored partial
      - logs `settings.update` with `entity: 'owner'`, `entityId` = ownerId, and the stored before/after
      - returns `{ settings }` with effective owner-level values

- [ ] **Step 1: Write failing tests (`settings.test.ts`)**

- `GET returns defaults for a fresh owner`: the body deep-equals `{ settings: DEFAULT_OWNER_SETTINGS }`.
- `PATCH sets, merges hours, and null resets`:
  - first PATCH `{ weekendDays: ['fri','sat'], hours: { fri: 'closed' } }`, then a second PATCH `{ hours: { sat: { open: '10:00', close: '02:00' } } }`
  - GET now shows `weekendDays` `['fri','sat']`, `fri: 'closed'`, sat `10:00–02:00`, mon default
  - PATCH `{ weekendDays: null }` brings back `['sat','sun']`
- `refund rules are sorted and validated`:
  - `[{minHoursBefore: 48, percent: 20}, {minHoursBefore: 96, percent: 100}]` is stored with 96 first
  - a duplicate threshold, `percent: 101` and `percent: 12.345` each give 400 `validation_error`
- `owner level rejects fixed advance and bad values`:
  - `{ paymentPolicy: { type: 'partial_fixed', amount: 500 } }` → 400
  - `{ hours: { mon: { open: '25:00', close: '10:00' } } }` → 400
  - `{ unknownKey: 1 }` → 400
  - `{ bookingWindowDays: 0 }` → 400
- `staff without settings.edit → 403 forbidden; non-member → 404`.
- `PATCH writes a settings.update activity entry`.

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/venues/settings.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the schema module, `applyPatch` and the router; mount it on `ownerRouter`.**

- [ ] **Step 4: Run** the test file, then `node_modules/.bin/pnpm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(api): owner settings with validation and reset`

---

### Task 3: Venue model and venue CRUD

**Files:**
- Create: `apps/api/src/venues/venue.model.ts`, `apps/api/src/venues/effective.ts`, `apps/api/src/venues/routes/venues.ts`, `apps/api/test/helpers/venues.ts`
- Modify: `apps/api/src/tenancy/routes/owner.ts` (mount `venuesRouter(services)`)
- Test: `apps/api/test/venues/venues.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `slugify`, `SLUG_RE`, `isTimeZone`, `AMENITIES`, `resolveSettings`, `withOwnerDefaults`
  - Task 2: `venueSettingsPatchSchema`, `applyPatch`
  - Plan 03: `tenantRepo(Venue, t, { venueField: '_id' })`, `assertVenueAccess`, `currencyExponent`
- Produces:
  - **`Venue` model** (with `tenantScoped`, timestamps, `minimize: false`):
    - `ownerId`
    - `name` (1–100, trimmed)
    - `slug` (unique)
    - `address` (1–300), `city` (1–100)
    - `country` (`/^[A-Z]{2}$/`), `currency`, `timezone`
    - `location: { type: 'Point', coordinates: [lng, lat] }`
    - `photos: { url, alt? }[]`, `amenities: Amenity[]`
    - `published: boolean` (default false)
    - `settings: Mixed` (default `{}`; holds a `VenueSettingsOverride`)
  - **Venue indexes:** `{ slug: 1 }` unique; `{ location: '2dsphere' }`; `{ ownerId: 1, createdAt: -1 }`.
  - **`venueJson(v, effective)`** returns:
    - `id, name, slug, address, city, country, currency, timezone`
    - `location: { lat, lng }`, `photos`, `amenities`, `published`
    - `settings` (the override), `effectiveSettings`
    - `createdAt` (ISO)
  - **`effectiveForVenue(ownerId: string, venue: { settings }): Promise<EffectiveSettings>`** and **`effectiveForTurf(ownerId, venue, turf)`** (`effective.ts`): load `Owner.settings`, apply `withOwnerDefaults`, then call `resolveSettings`.
  - **Routes**, all under `/owners/:ownerId`:
    - `GET /venues`: venues within the member's scope, newest first → `{ venues: venueJson[] }`.
    - `POST /venues`: needs `venue.manage` and all-venue scope (else 403 `forbidden`).
      - Body: `{ name, address, city, country, timezone, location: { lat, lng }, currency?, slug?, photos?, amenities?, settings? }`.
      - Defaults: `currency` = owner's `defaultCurrency`; `slug` = `slugify(name)` with suffix retries on duplicate key.
      - Logs `venue.create` with `venueId` → 201 `{ venue }`.
    - `GET /venues/:venueId`: needs venue scope (else 404 "Venue not found") → `{ venue }`.
    - `PATCH /venues/:venueId`: needs `venue.manage` and venue scope.
      - `.strict()` body: `{ name?, slug?, address?, city?, country?, timezone?, location?, photos?, amenities?, settings? }`. `settings` goes through `venueSettingsPatchSchema` and `applyPatch`. `currency` is not accepted (400).
      - Logs `venue.update` with before/after of the changed fields → `{ venue }`.
      - `published` is added in Task 4.
  - **Errors:**
    - taken slug → 409 `slug_taken`
    - bad timezone, country, currency or coordinates → 400 `validation_error`
  - **Test helpers:**
    - `seedVenue(ownerId: string, over?: Partial<{ name; slug; published; timezone; currency; settings }>) → Promise<VenueDoc>`
    - `seedTurf(ownerId, venueId, over?)` (Task 4)

- [ ] **Step 1: Write failing tests (`venues.test.ts`)**

- `owner creates a venue with defaults`:
  - POST with `{ name: 'Арена Москва', address: 'ул. Ленина 1', city: 'Москва', country: 'RU', timezone: 'Europe/Moscow', location: { lat: 55.75, lng: 37.61 } }` → 201
  - body has `slug: 'arena-moskva'`, `currency` = owner default, `published: false`, `settings: {}`
  - `effectiveSettings` deep-equals `DEFAULT_OWNER_SETTINGS`
  - an activity row `venue.create` exists with its `venueId`
- `stores location as [lng, lat] and rejects out-of-range`:
  - `{ lat: 23.81, lng: 90.41 }` → stored `location.coordinates` `[90.41, 23.81]`
  - `{ lat: 91, lng: 0 }` → 400; `{ lat: 0, lng: 181 }` → 400
- `rejects bad timezone, country and currency`: `'Asia/Dhak'`, `'ru'`, `'XXX'` → each 400.
- `duplicate names get suffixed slugs; explicit taken slug → 409 slug_taken`:
  - two venues named `'Green Turf'` → `green-turf`, `green-turf-2`
  - POST with `slug: 'green-turf'` → 409
  - PATCH venue 2 with `slug: 'green-turf'` → 409
- `PATCH merges venue settings over owner settings`:
  - owner PATCH settings `{ guestBooking: { allowed: true, requireOtp: false } }`
  - venue PATCH `{ settings: { paymentPolicy: { type: 'partial_fixed', amount: 50000 } } }` → `effectiveSettings.paymentPolicy` is the fixed policy and `effectiveSettings.guestBooking.allowed` is false
  - venue PATCH `{ settings: { paymentPolicy: null } }` → inherited `none` again, `guestBooking.allowed` true
- `currency cannot be changed` → PATCH `{ currency: 'USD' }` → 400.
- `venue scope`:
  - manager limited to venue V1 (`addMember` with `venueIds: [V1]`): `GET /venues` lists only V1
  - `GET /venues/<V2>` → 404, the same body as for a random ObjectId and as owner B's venue id read by owner A
- `create needs all-venue scope and venue.manage`:
  - a custom role with `venue.manage` limited to V1 → POST 403 `forbidden`
  - staff → 403 `forbidden`

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/venues/venues.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the model, `effective.ts`, the router and the helpers; mount on `ownerRouter`.** Slug retry: on a duplicate key on `slug` for a generated slug, try `-2` up to `-20`, then give 409 `slug_taken`.

- [ ] **Step 4: Run** the test file, then `node_modules/.bin/pnpm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(api): venues with location, slug and settings override`

---

### Task 4: Turfs, publishing and venue delete

**Files:**
- Create: `apps/api/src/venues/turf.model.ts`, `apps/api/src/venues/routes/turfs.ts`
- Modify:
  - `apps/api/src/venues/routes/venues.ts`: `published` in PATCH; `DELETE`
  - `apps/api/test/helpers/venues.ts`: `seedTurf`
  - `apps/api/src/tenancy/routes/owner.ts`: mount `turfsRouter(services)`
- Test: `apps/api/test/venues/turfs.test.ts`

**Interfaces:**
- Consumes: Task 1 `SPORTS`; Task 2 `turfSettingsPatchSchema`, `applyPatch`; Task 3 `Venue`, `effectiveForTurf`, `assertVenueAccess`.
- Produces:
  - **`Turf` model** (with `tenantScoped`, timestamps, `minimize: false`):
    - `ownerId`, `venueId` (ref Venue)
    - `name` (1–60), `sports: Sport[]` (at least 1, unique), `indoor: boolean`
    - `slotLengthMin` (30–240, multiple of 15)
    - `active` (default true)
    - `settings: Mixed` (default `{}`; holds a `TurfSettingsOverride`)
  - **Turf indexes:**
    - `{ ownerId: 1, venueId: 1, name: 1 }` unique with collation `{ locale: 'en', strength: 2 }`
    - `{ ownerId: 1, venueId: 1, active: 1 }`
  - **`turfJson`** returns `id, venueId, name, sports, indoor, slotLengthMin, active, settings, effectiveSettings, createdAt`.
  - **Routes**, all under `/owners/:ownerId/venues/:venueId`. The venue must exist in this tenant and be in the member's scope, else 404 "Venue not found". The turf must belong to that venue, else 404 "Turf not found".
    - `GET /turfs`: lists the venue's turfs by name.
    - `POST /turfs`: needs `turf.manage`. Body `{ name, sports, indoor, slotLengthMin, settings? }`. Logs `turf.create` with `venueId` → 201 `{ turf }`.
    - `GET /turfs/:turfId`.
    - `PATCH /turfs/:turfId`: needs `turf.manage`. `.strict()` body `{ name?, sports?, indoor?, active?, settings? }`; `slotLengthMin` is not accepted (400). Logs `turf.update`.
    - `DELETE /turfs/:turfId`: needs `turf.manage`. Logs `turf.delete` → 204.
  - **Errors:** a duplicate turf name in the venue gives 409 `turf_name_taken`.
  - **Venue additions:**
    - `PATCH /venues/:venueId` accepts `published?: boolean`. `true` with no active turf gives 409 `venue_not_ready`. The activity action is `venue.publish` or `venue.unpublish` when that is the only change, otherwise `venue.update`.
    - `DELETE /venues/:venueId` needs `venue.manage`. If any turf exists → 409 `venue_has_turfs`. Otherwise it runs in one transaction: delete the venue, `Membership.updateMany({ ownerId, venueIds: id }, { $pull: { venueIds: id } })`, log `venue.delete` → 204.
  - **Last-active-turf guard:** deactivating or deleting the last active turf of a published venue gives 409 `last_active_turf`.

- [ ] **Step 1: Write failing tests (`turfs.test.ts`)**

- `creates a turf; effective settings layer owner → venue → turf hours`:
  - owner hours mon `08–22`; venue `{ hours: { fri: { open: '16:00', close: '02:00' } } }`; turf POST with `settings: { hours: { mon: 'closed' } }`
  - turf `effectiveSettings.hours`: mon `'closed'`, fri `16:00–02:00`, tue `08–22`
- `validates turf fields`:
  - `slotLengthMin: 45`, `20` and `250` → 400
  - `sports: []` → 400; `sports: ['curling']` → 400
  - PATCH `{ slotLengthMin: 90 }` → 400
- `turf names unique per venue, case-insensitive`:
  - `'Court 1'` then `'court 1'` in the same venue → 409 `turf_name_taken`
  - the same name in another venue → 201
- `turf of another venue or owner → 404`:
  - `/venues/V1/turfs/<turf of V2>` → 404 "Turf not found"
  - owner A reading owner B's venue turfs → 404 "Venue not found"
  - a manager limited to V1 → `/venues/V2/turfs` gives 404
- `publish needs an active turf`:
  - PATCH `published: true` with no turfs → 409 `venue_not_ready`
  - after adding a turf → 200 and an activity row `venue.publish`
- `cannot deactivate or delete the last active turf of a published venue`:
  - deactivate → 409 `last_active_turf`; delete → 409 `last_active_turf`
  - with a second active turf, deactivating one → 200
- `venue delete`:
  - with a turf → 409 `venue_has_turfs`
  - after deleting the turf (venue unpublished) → 204
  - a member that had `venueIds: [V]` now has `venueIds: []`
  - an activity row `venue.delete` exists
- `staff cannot write turfs → 403; staff can list turfs of their venue → 200`.

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/venues/turfs.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the turf model and router, plus the venue PATCH `published` and DELETE additions.** Check `last_active_turf` and `venue_not_ready` inside the write's transaction.

- [ ] **Step 4: Run** the test file, then `node_modules/.bin/pnpm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(api): turfs, venue publishing and delete`

---

### Task 5: Members endpoints check venue ids exist

**Files:**
- Modify: `apps/api/src/tenancy/routes/members.ts`
- Test: `apps/api/test/tenancy/members.test.ts` (extend; existing tests that pass made-up venue ids switch to `seedVenue`)

**Interfaces:**
- Consumes: Task 3 `Venue`, `seedVenue`.
- Produces: **`assertVenuesExist(t: TenantContext, venueIds: VenueIds): Promise<void>`** in `members.ts`.
  - `'all'` passes.
  - Otherwise `Venue.countDocuments({ ownerId: t.ownerId, _id: { $in: ids } })` must equal `ids.length`, else 404 `not_found` "Venue not found".
  - Called in POST and PATCH after the actor-scope checks.

- [ ] **Step 1: Write failing tests**

- `adding or updating a member with unknown venue ids → 404`:
  - POST with `venueIds: [<random ObjectId>]` → 404 "Venue not found"
  - POST with owner B's venue id → 404, same body
  - PATCH an existing member to `[<random>]` → 404
  - POST with a real venue id of this owner → 201

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/tenancy/members.test.ts` — Expected: the new test FAILS.

- [ ] **Step 3: Implement `assertVenuesExist`; update the old tests to use real venues.**

- [ ] **Step 4: Run** the test file, then `node_modules/.bin/pnpm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `fix(api): members endpoints reject unknown venue ids`

---

### Task 6: Public venue page endpoint

**Files:**
- Create: `apps/api/src/venues/routes/public.ts`
- Modify: `apps/api/src/app.ts` (mount `publicVenuesRouter()` on `api`, before `/owners`)
- Test: `apps/api/test/venues/public.test.ts`

**Interfaces:**
- Consumes: Task 3 `Venue`, Task 4 `Turf`, `effectiveForTurf` (for hours), `SLUG_RE`.
- Produces: **`GET /api/v1/venues/:slug`**, no auth.
  - A slug that fails `SLUG_RE`, doesn't exist or is unpublished gives 404 `not_found` "Venue not found".
  - Otherwise → `{ venue: { slug, name, address, city, country, currency, timezone, location: { lat, lng }, photos, amenities, turfs: [{ id, name, sports, indoor, slotLengthMin }] } }`.
  - `turfs` holds active turfs only, sorted by name.
  - The response has no `ownerId`, `settings`, `effectiveSettings`, `published` or timestamps.
  - The venue lookup uses `.setOptions({ crossTenant: true })`, with a comment naming it the public read the spec allows.
  - The turf query filters on the venue's `ownerId`.

- [ ] **Step 1: Write failing tests (`public.test.ts`)**

- `published venue returns public fields and active turfs only`:
  - one active and one inactive turf → `turfs` has length 1
  - `Object.keys(body.venue)` has exactly the listed keys (no `ownerId`, `settings`)
- `unpublished, unknown and malformed slugs → identical 404`:
  - an unpublished venue's slug, `'no-such-venue'` and `'Bad Slug!'` → all 404
  - all three bodies deep-equal `{ error: { code: 'not_found', message: 'Venue not found' } }`
- `no auth needed`: the request has no Authorization header → 200.

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/venues/public.test.ts` — Expected: FAIL (404 for everything, route missing).

- [ ] **Step 3: Implement and mount.**

- [ ] **Step 4: Run** the test file, then `node_modules/.bin/pnpm test`, `node_modules/.bin/pnpm -r typecheck` and `node_modules/.bin/pnpm lint` — Expected: all PASS and clean.

- [ ] **Step 5: Commit** — `feat(api): public venue page endpoint`
