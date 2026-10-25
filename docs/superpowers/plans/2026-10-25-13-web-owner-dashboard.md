# Web — Owner Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give owners, managers and staff a web portal at `/owner/:ownerId/*`. It has a today summary, a schedule calendar, bookings with every staff action, walk-ins, venue/turf/pricing/hours/override/closure editors, add-ons, settings with Stripe, staff and roles, and the activity log, all on the existing `/api/v1/owners/:ownerId/*` API.

**Architecture:**
- The portal is a second route tree in `apps/web` under `/owner`. It has its own `OwnerShell` with a sidebar, a drawer below lg, an owner switcher and a top bar.
- An `OwnerProvider` loads the owner, the membership's permissions and the venue list once per owner. Every nav item, route and action button is gated by `can(permission)`.
- Pages read through one `useResource` hook and write through `apiPost`, `apiPatch`, `apiPut` and `apiDelete`.
- There is one API change. Owner booking JSON gains the customer's name and contact plus the turf name, which the schedule, list and detail need.
- The daily summary is computed client-side from `GET /bookings`.

**Tech Stack:**
- React 19, react-router 8, react-i18next, CSS Modules, Leaflet (already a dependency) and `qrcode` 1.5.4 (new).
- Tests use Vitest, jsdom and Testing Library, through the existing `mockApi` and `renderApp` helpers.
- The API side is Express + Mongoose, tested with the existing API test helpers.

**Spec:** `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md` (§17 "Owner dashboard"; tenancy §, settings §, booking/refund rules). The API contract digest is at `.superpowers/sdd/plan13-api-digest.md`. It is git-ignored and was copied from `apps/api/src`; when it and the code disagree, the code wins.

## Global Constraints

### Design system
- Every screen follows `.superdesign/design-system.md`.
- Every color, font size, spacing, radius, shadow, width and duration is a `var(--…)` from `apps/web/src/styles/tokens.css`. `test/tokens.test.ts` must stay green.
- A missing value is added as a token, with one line in the design doc.
- Portal chrome:
  - Left sidebar nav plus a top bar. The sidebar becomes a drawer below lg (1024).
  - Sidebar items are 14px/500, 36px tall. Active = subtle bg + strong text; inactive = muted text.
  - The owner switcher sits at the top of the sidebar: owner name 14/600, role 12 muted, and a dropdown of memberships.
- **No `--brand` anywhere in the portal.** A selected slot in the portal uses primary.
- Tables:
  - header 12px/500 muted, sentence case;
  - 52px rows;
  - 1px subtle row borders;
  - hover = subtle bg;
  - numbers `tabular-nums`.
- Stat cards: surface card, label 13/500 muted, value 24/600 tabular.
- Schedule:
  - turfs as columns, time as rows (30-min labels);
  - booking blocks use the status soft bg plus a 3px left border in status fg;
  - blocked cells are striped as in the slot grid;
  - the current-time line is `--danger`.
- Badges:
  - Booking status:
    - confirmed = success;
    - awaiting_payment/pending = warning;
    - cancelled/rejected/expired = danger;
    - completed/no_show = neutral;
    - refunded = info.
    - Reuse `BookingStatusBadge`/`PaymentStatusBadge`.
  - Member status: active = success, disabled = neutral. The design doc's "invited = info" has no API state yet (see Task 17).
- Controls are 36px (sm 32, lg 40).
- Light and dark mode must both work.

### Copy
- Every string goes through i18n with keys in both `en.json` and `ru.json`. `test/i18n.test.ts` enforces parity.
- Portal keys live under `owner.*`.
- No fixed-width labels; Russian runs 20–30% longer. Buttons, tabs and sidebar items wrap or grow.

### Data and formatting
- Money is integer minor units. Display it with `money()` from `lib/format`, and parse input with `parseMoney(input, currency)` from `@booking/shared`.
- Never hand-build price strings.
- Venue times are shown in the venue's timezone (`formatTime`/`formatDate`).
- "Today" for a venue is `localParts(new Date(), venue.timezone).date`.
- Instants from the API are compared as `Date.parse(...)` milliseconds, never as raw strings.
- Times are `HH:MM` 24h; dates are `YYYY-MM-DD`.
- A closing time `close <= open` means the next day. Editors show a "next day" hint and never reject it.

### Booking rules (from spec, enforced by API, mirrored in UI)
- Available actions by status:

  | Status | Actions |
  |---|---|
  | `pending` | confirm, reject (`booking.confirm`); cancel (`booking.cancel`) |
  | `awaiting_payment` | cancel; show payment link (`booking.create`, walk-ins only) |
  | `confirmed` | cancel; check-in, no-show (`booking.checkin`) |
  | `pending`/`confirmed`/`completed`/`no_show` | mark cash (`payment.mark_cash`) while `amountPaid < total` |

- Staff cancel refunds 100% of the paid, un-refunded amount. The card part goes back to Stripe; the cash part becomes a pending cash refund that is recorded manually.
- Refund actions (`refund.issue`):
  - retry a `failed` card refund;
  - record cash for a `pending` cash refund or a `failed` card refund.
- Walk-in payment:
  - `cash` requires `payment.mark_cash`;
  - `link` returns a Stripe URL, shown as a QR code plus a copyable link, and leaves the booking `awaiting_payment`;
  - `unpaid` confirms with nothing paid.

### Auth and tenancy
- Every `/owner*` route is wrapped in `RequireAuth`.
- Owners are discovered with `GET /me/memberships`.
- The current owner comes from the `:ownerId` path param.
- An API 404 on `GET /owners/:ownerId` renders the portal's not-found state, never another owner's data.
- A 403 `owner_inactive` renders an "owner inactive" alert.
- A route the member lacks permission for renders `owner.noAccess`. It is never hidden behind a redirect loop.

### API conventions
- Base path `/api/v1/owners/:ownerId`.
- Body schemas are `.strict()`: send only the documented keys. Never spread a whole fetched object into a PATCH.
- PATCH `null` resets to inherit/default; an omitted key means unchanged.
- DELETE returns 204.
- `GET /payment-gateways` returns a bare array.
- Pricing is `PUT` of the whole `{base, rules}`.
- Overrides and closures have no PATCH (delete + create).

### Commands
Run from the repo root:
- `node_modules/.bin/pnpm typecheck`
- `node_modules/.bin/pnpm lint`
- `node_modules/.bin/pnpm --filter web exec vitest run [file]`
- `node_modules/.bin/pnpm --filter api exec vitest run [file]`
- `node_modules/.bin/pnpm --filter web build`
- `node_modules/.bin/pnpm test` (all)

### Commits
- Conventional prefix: `feat(web):`, `feat(api):`, `fix(web):`, `test(web):`.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A night session crosses midnight on the schedule.**
   - Situation: a venue is open 18:00–02:00, with a 01:00 booking on business date D.
   - Expected: the 01:00 block renders below 23:30 in D's column set, not at the top. Row placement comes from instants, not local clock minutes.
   - Test: `scheduleLayout places after-midnight slots after the evening ones` (Task 6).
2. **A staff member scoped to one venue, or missing a permission.**
   - Situation: a member's `venueIds` excludes a venue, or they lack `booking.cancel`.
   - Expected: the nav hides what they lack. The cancel button is absent. Typing the URL shows `owner.noAccess`, and an API 404 for an out-of-scope booking shows the not-found state.
   - Tests:
     - `nav shows only items the membership can use` (Task 4);
     - `booking detail hides actions the member lacks` (Task 8);
     - `out-of-scope booking renders not found` (Task 8).
3. **Double-submit and races on actions.**
   - Situation: someone double-clicks Confirm, or another staff member already rejected the booking (409 `invalid_transition`).
   - Expected: one request; buttons disabled while pending. A 409 shows the translated error and reloads the booking so the actions match its real status.
   - Test: `a 409 on confirm shows the error and reloads the booking` (Task 8).
4. **A walk-in for a slot taken meanwhile, or outside the booking window.**
   - Situation: the slot is taken (409 `slot_taken`) or the request returns 400 `outside_window`.
   - Expected: the form keeps all input, shows the translated error, and refetches the slot grid.
   - Test: `walk-in slot_taken keeps the form and refetches slots` (Task 10).
5. **Editing settings sends only what changed, and inherit stays inherit.**
   - Situation: an owner changes only the booking window, or a venue leaves hours "inherit".
   - Expected: the PATCH body contains only `bookingWindowDays`. A venue day left on inherit is not sent, and choosing "Inherit" for a key sends `null`.
   - Test: `settings form patches only changed keys and null for inherit` (Task 12).

---

## File Structure

```
apps/api/src/bookings/ownerJson.ts                 Task 1  ownerBookingsJson / ownerBookingJson
apps/api/src/bookings/routes/owner.ts              Task 1  (modify: use ownerBookingJson everywhere)
apps/api/test/bookings/ownerJson.test.ts           Task 1

apps/web/src/lib/apiClient.ts                      Task 2  (+ apiPut, apiDelete)
apps/web/src/owner/types.ts                        Task 2  owner API JSON types
apps/web/src/owner/useResource.ts                  Task 2  load/reload hook
apps/web/src/owner/ownerApi.ts                     Task 2  ownerPath()
apps/web/src/components/ui/{Table,Checkbox,Textarea,StatCard,Tabs}.tsx (+ .module.css)   Task 2
apps/web/src/styles/tokens.css, .superdesign/design-system.md                            Task 2 (+ later tasks as needed)

apps/web/src/owner/OwnerProvider.tsx               Task 3  useOwner(), can()
apps/web/src/owner/OwnerIndexPage.tsx              Task 3  /owner → pick owner
apps/web/src/owner/RequirePermission.tsx           Task 3
apps/web/src/owner/ownerRoutes.tsx                 Task 3  route tree (pages filled by later tasks)
apps/web/src/routes.tsx, src/auth/ProfilePage.tsx  Task 3  (modify)

apps/web/src/owner/shell/OwnerShell.tsx (+css)     Task 4  sidebar, drawer, top bar
apps/web/src/owner/shell/OwnerSwitcher.tsx         Task 4
apps/web/src/owner/shell/nav.ts                    Task 4  NAV items + permissions
apps/web/src/owner/shell/useVenueParam.ts          Task 4  ?venue= selection
apps/web/src/owner/shell/VenueSelect.tsx           Task 4

apps/web/src/owner/today/{TodayPage.tsx,summarize.ts}            Task 5
apps/web/src/owner/schedule/{SchedulePage.tsx,scheduleLayout.ts,ScheduleGrid.tsx}   Task 6
apps/web/src/owner/bookings/{BookingsPage.tsx,bookingFilters.ts} Task 7
apps/web/src/owner/bookings/{OwnerBookingPage.tsx,BookingActions.tsx,ReasonDialog.tsx}  Task 8
apps/web/src/owner/bookings/{CashDialog.tsx,PaymentLinkDialog.tsx,OwnerRefunds.tsx}     Task 9
apps/web/src/bookings/CancelDialog.tsx             Task 8  (modify: generic booking type)
apps/web/src/owner/walkin/{WalkInPage.tsx,walkInEstimate.ts}     Task 10
apps/web/src/venue/SlotGrid.tsx (+css)             Task 10 (modify: tone="portal" uses primary)
apps/web/src/owner/venues/{VenuesPage.tsx,VenueEditorPage.tsx,VenueForm.tsx,LocationPicker.tsx,TurfList.tsx}  Task 11
apps/web/src/owner/settings/{HoursEditor.tsx,SettingsForm.tsx,settingsPatch.ts,SettingsPage.tsx}  Task 12
apps/web/src/owner/settings/StripeGatewayCard.tsx  Task 13
apps/web/src/owner/venues/VenueSettingsTab.tsx     Task 13
apps/web/src/owner/turfs/{TurfEditorPage.tsx,TurfDetailsForm.tsx,PricingEditor.tsx,pricingForm.ts}  Task 14
apps/web/src/owner/schedule/{OverridesTab.tsx,OverrideForm.tsx,ClosuresPage.tsx,ClosureForm.tsx}    Task 15
apps/web/src/owner/addons/{AddonsPage.tsx,AddonForm.tsx,AssignmentsTable.tsx}    Task 16
apps/web/src/owner/staff/{StaffPage.tsx,MemberDialog.tsx,RoleEditor.tsx}         Task 17
apps/web/src/owner/activity/ActivityPage.tsx       Task 18
apps/web/src/i18n/locales/{en,ru}.json             every web task
apps/web/test/owner/**                             tests per task (helpers in test/owner/fixtures.ts, Task 3)
```

---

### Task 1: API — owner booking JSON with customer and turf

The schedule, list and detail must show who booked. Registered players today carry only `playerId`.

**Files:**
- Create: `apps/api/src/bookings/ownerJson.ts`
- Modify: `apps/api/src/bookings/routes/owner.ts` (every `bookingJson(...)` response: list, detail, cancel, confirm, reject, check-in, no-show, cash, walk-in create)
- Test: `apps/api/test/bookings/ownerJson.test.ts`, plus one assertion added to `apps/api/test/bookings/owner.test.ts`

**Interfaces:**
- Consumes: `bookingJson`, `BookingDoc` (`booking.model.ts`), `User` (`auth/user.model.ts`), `Turf`.
- Produces:
  - `OwnerBooking = ReturnType<typeof bookingJson> & { customer: { name: string; phone: string | null; email: string | null } | null; turf: { name: string } | null }`
  - `ownerBookingsJson(bookings: BookingDoc[]): Promise<OwnerBooking[]>`
  - `ownerBookingJson(b: BookingDoc): Promise<OwnerBooking>`
  - Mirror the `$in` batching of `playerJson.ts`: one `User` query and one `Turf` query per list.
  - Guest bookings set `customer = { name: guest.name, phone: guest.phone, email: null }`.
  - A player booking whose user has gone sets `customer = null`.

- [ ] **Step 1: Write failing tests**, `ownerJson.test.ts`:
  - `adds the registered player's name, phone and email`
  - `uses the guest name and phone for guest bookings`
  - `customer is null when the player no longer exists`
  - `adds the turf name`
  - `batches users and turfs`: two bookings by the same player give one `User.find` call (spy).

  In `owner.test.ts`, add the test `list and detail responses carry customer and turf`. It runs `GET /bookings?venueId=` and `GET /bookings/:id`, and checks that `booking.customer.name` and `booking.turf.name` equal the seeded values.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/bookings/ownerJson.test.ts test/bookings/owner.test.ts`. Expected: FAIL (module missing / `customer` undefined).
- [ ] **Step 3: Implement** `ownerJson.ts` and swap every owner-route `bookingJson(x)` for `await ownerBookingJson(x)`; the list uses `ownerBookingsJson`.
- [ ] **Step 4: Run** the same command plus `node_modules/.bin/pnpm --filter api exec vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(api): owner booking JSON carries customer and turf name`.

---

### Task 2: Web foundation: client verbs, owner types, useResource, UI primitives

**Files:**
- Modify: `apps/web/src/lib/apiClient.ts`, `apps/web/src/styles/tokens.css`, `.superdesign/design-system.md`
- Create:
  - `apps/web/src/owner/types.ts`
  - `apps/web/src/owner/ownerApi.ts`
  - `apps/web/src/owner/useResource.ts`
  - `apps/web/src/components/ui/{Table,Checkbox,Textarea,StatCard,Tabs}.tsx`, each with a `.module.css`
- Test: `apps/web/test/apiClient.test.ts` (extend), `apps/web/test/owner/useResource.test.tsx`, `apps/web/test/ui.test.tsx` (extend)

**Interfaces:**
- Produces:
  - `apiPut<T>(path: string, body: unknown): Promise<T>`.
  - `apiDelete(path: string): Promise<void>`. A 204 has no body; reuse the existing `send`/`request`.
  - `ownerPath(ownerId: string, path = ''): string` returns ``/owners/${ownerId}${path}``.
  - `useResource<T>(path: string | null): { state: { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: unknown }; reload(): void; set(data: T): void }`
    - A `null` path means idle.
    - It ignores stale responses after the path changes, using the `live` flag as in `MyBookingsPage`.
    - `reload()` refetches while keeping the current data visible. The state stays `ready` with the old data until the new data arrives.
    - `set` replaces the data locally after a successful write.
  - `owner/types.ts` holds the JSON types from the digest, exported by these names:
    - `Membership`, `OwnerInfo`, `OwnerMembership`;
    - `OwnerVenue`, `OwnerTurf`, `TurfPricing`, `PricingRule`, `OwnerSlotDay`, `OwnerSlot`;
    - `Override`, `Closure`, `Addon`, `Assignment`, `WalkInAddon`;
    - `OwnerBooking` (Task 1 shape; extends web `BookingJson` minus `venue`/`turf`, plus `customer`, `turf`, `source`, `guest`, `playerId`, `createdAt`);
    - `PaymentJson`, `BookingDetail = { booking: OwnerBooking; payments: PaymentJson[]; refunds: RefundJson[] }`;
    - `Member`, `Role`, `ActivityItem`, `ActivityPage`, `GatewayView`, `PaymentLink = { id: string; amount: number; currency: string; url: string }`.
    - Import `Permission`, `OwnerSettings`, `VenueSettingsOverride`, `WeeklyHours`, `DayHours`, `PaymentPolicy`, `RefundRule`, `Weekday`, `Sport`, `Amenity` and `AddonPricingType` types from `@booking/shared`.
  - UI primitives:
    - `Table`: props `{ caption: string; children }`; renders `<table>` with a visually hidden caption; `className` passthrough.
    - `Checkbox`: props `{ label: string; checked: boolean; onChange(checked: boolean): void; disabled?: boolean; hint?: string }`.
    - `Textarea`: same props pattern as `TextField`.
    - `StatCard`: props `{ label: string; value: string; hint?: string }`.
    - `Tabs`: props `{ label: string; tabs: { id: string; label: string }[]; value: string; onChange(id: string): void }`. ARIA tablist; arrows/Home/End as in `MyBookingsPage`; the active tab is underlined with `--primary`.
  - New tokens (light = dark unless noted; add each to the design doc):
    - `--sidebar-width: 15rem`
    - `--schedule-row: 1.5rem` (one 15-min row)
    - `--schedule-col-min: 9rem`
    - `--schedule-time-col: 3.5rem`
    - `--table-row: 3.25rem` (52px)
    - `--status-bar: 3px`
    - `--qr-size: 12rem`

- [ ] **Step 1: Write failing tests:**
  - `apiPut sends PUT with JSON body`
  - `apiDelete resolves on 204`
  - `apiDelete throws ApiError on 409`
  - `useResource loads, reloads keeping data, ignores a stale response after path change`
  - `useResource with null path stays idle and does not fetch`
  - `Tabs moves selection with arrow keys`
  - `Checkbox reports its checked state`
  - `StatCard renders label and value`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/apiClient.test.ts test/owner/useResource.test.tsx test/ui.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the items above.
- [ ] **Step 4: Run** the same command plus `test/tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owner API types, useResource, apiPut/apiDelete and table/tabs/stat primitives`.

---

### Task 3: OwnerProvider, owner picker, permission gate, route tree

**Files:**
- Create:
  - `apps/web/src/owner/OwnerProvider.tsx`
  - `apps/web/src/owner/OwnerIndexPage.tsx`
  - `apps/web/src/owner/RequirePermission.tsx`
  - `apps/web/src/owner/ownerRoutes.tsx`
  - `apps/web/test/owner/fixtures.ts`
- Modify: `apps/web/src/routes.tsx`, `apps/web/src/auth/ProfilePage.tsx`
- Test: `apps/web/test/owner/provider.test.tsx`

**Interfaces:**
- Consumes: `useResource`, `ownerPath`, types (Task 2).
- Produces:
  - `useOwner(): { ownerId: string; owner: OwnerInfo; membership: OwnerMembership; memberships: Membership[]; venues: OwnerVenue[]; can(p: Permission): boolean; reloadVenues(): void }`
    - The provider loads `GET /owners/:ownerId`, `GET /me/memberships` and `GET /owners/:ownerId/venues` in parallel. It shows a `Spinner` until all three resolve.
    - A 404 from the owner call renders `owner.notFound` with a link to `/owner`.
    - A 403 `owner_inactive` renders `owner.inactive`.
  - `<RequirePermission perm={Permission | Permission[]} any?: boolean>`
    - It renders its children when the member holds all of the listed permissions (or any of them when `any` is set).
    - Otherwise it renders `<Alert tone="info">{t('owner.noAccess')}</Alert>`.
  - `OwnerIndexPage` at `/owner`:
    - It loads memberships. With none it shows `owner.noTeams`.
    - Otherwise it navigates with `replace` to the remembered last owner, if that owner is still a member, or else the first membership.
    - The remembered owner is in `localStorage['owner.last']`, with reads and writes wrapped in try/catch. The provider writes it on load.
  - `OwnerRoutes` is the element tree mounted in `routes.tsx` as `<Route path="/owner/*" element={<RequireAuth><OwnerRoutes/></RequireAuth>}/>`. It sits outside `AppShell`.
    - Children of `:ownerId` render inside `<OwnerProvider><OwnerShell/></OwnerProvider>`; until Task 4 the shell is a plain `<Outlet/>`.
    - Paths: `index` (Today), `schedule`, `bookings`, `bookings/:bookingId`, `walk-in`, `venues`, `venues/new`, `venues/:venueId`, `venues/:venueId/turfs/:turfId`, `closures`, `addons`, `settings`, `staff`, `activity`.
    - Each later task replaces its placeholder (`<p>{t('owner.comingSoon')}</p>`) with the page, wrapped in `RequirePermission` per Task 4's `NAV` table.
  - `ProfilePage` fetches `GET /me/memberships` and, when the list is non-empty, shows a `Card` with a link-mode `Button` to `/owner` (`owner.portalLink`). The fetch lives here rather than in `AppShell` so Plan 12 tests that assert zero unmatched calls stay valid.
  - `test/owner/fixtures.ts` exports builders:
    - `membership(over?)`, `ownerInfo(over?)`, `venue(over?)`, `turf(over?)`, `slotDay(over?)`, `ownerBooking(over?)`, `member(over?)`, `role(over?)`;
    - `ownerRoutes({ permissions?, venueIds?, venues? }): Route[]`, which returns the three provider routes for `mockApi`;
    - `OWNER_ID = 'o1'`; the default user `staffUser`.

- [ ] **Step 1: Write failing tests**, `provider.test.tsx`:
  - `/owner redirects to the first membership`
  - `/owner prefers the remembered owner when still a member`
  - `/owner with no memberships shows owner.noTeams`
  - `unknown owner id renders owner.notFound` (owner call 404)
  - `inactive owner renders owner.inactive`
  - `RequirePermission blocks a member without the permission`
  - `profile links to the portal only for members`
  - `signed-out /owner/o1 redirects to /login?next=%2Fowner%2Fo1`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/provider.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the items above and add the i18n keys `owner.notFound`, `owner.inactive`, `owner.noAccess`, `owner.noTeams`, `owner.portalLink` and `owner.comingSoon` in en and ru.
- [ ] **Step 4: Run** the file plus the full web suite (`node_modules/.bin/pnpm --filter web exec vitest run`). Expected: PASS, with the Plan 12 tests unchanged.
- [ ] **Step 5: Commit** `feat(web): owner portal provider, picker and permission gate`.

---

### Task 4: OwnerShell: sidebar, drawer, switcher, venue select

**Files:**
- Create: `apps/web/src/owner/shell/{OwnerShell.tsx,OwnerShell.module.css,OwnerSwitcher.tsx,nav.ts,useVenueParam.ts,VenueSelect.tsx}`
- Modify: `apps/web/src/owner/ownerRoutes.tsx`
- Test: `apps/web/test/owner/shell.test.tsx`

**Interfaces:**
- Consumes: `useOwner`.
- Produces:
  - `NAV: { to: string; key: string; perms: Permission[]; any?: boolean }[]`, in this order (`to` is relative to `/owner/:ownerId`):

    | to | label key | perms |
    |---|---|---|
    | `''` | `owner.nav.today` | `booking.view` |
    | `schedule` | `owner.nav.schedule` | `booking.view` |
    | `bookings` | `owner.nav.bookings` | `booking.view` |
    | `walk-in` | `owner.nav.walkIn` | `booking.create` |
    | `venues` | `owner.nav.venues` | `[]` (all members) |
    | `closures` | `owner.nav.closures` | `slot.override`, `settings.edit`, any |
    | `addons` | `owner.nav.addons` | `addon.manage` |
    | `settings` | `owner.nav.settings` | `settings.edit` |
    | `staff` | `owner.nav.staff` | `staff.manage` |
    | `activity` | `owner.nav.activity` | `reports.view` |

    `ownerRoutes.tsx` wraps each page in `RequirePermission` with the same perms.
  - `OwnerShell` layout:
    - From lg: a fixed `--sidebar-width` sidebar with the switcher, then the nav (`NavLink`, `end` for Today), then a footer with `LanguageSwitcher`, `ThemeToggle` and a "Player site" link to `/`.
    - Below lg: the top bar shows a menu button (`aria-expanded`, `aria-controls`) that opens the sidebar as a drawer over an `--overlay` scrim. Escape, the scrim, or navigating closes it, and focus returns to the menu button.
    - The top bar holds the page title (via `useOwnerTitle(title: string)`, exported from `OwnerShell.tsx`, set by each page) and the user's name.
  - `OwnerSwitcher`:
    - The button shows the owner name and role name.
    - It opens a listbox of `memberships`.
    - Picking one navigates to `/owner/<id>`.
    - Non-active `ownerStatus` entries show a neutral badge (`owner.status.<status>`).
  - `useVenueParam(): [venue: OwnerVenue | null, setVenueId(id: string): void]`
    - It reads `?venue=` and falls back to the first venue in `useOwner().venues`.
    - The setter replaces the search param and keeps other params.
  - `VenueSelect` is a `Select` bound to `useVenueParam` (label `owner.venue`). It is hidden when there is only one venue.

- [ ] **Step 1: Write failing tests**, `shell.test.tsx`:
  - `nav shows only items the membership can use` (staff system role → Today, Schedule, Bookings, Walk-in, Venues only)
  - `active nav item has aria-current=page`
  - `switcher lists memberships and navigates to the picked owner`
  - `drawer opens from the menu button and closes on Escape returning focus`
  - `useVenueParam falls back to the first venue and keeps other params when set`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/shell.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** The drawer uses CSS `@media (min-width: 1024px)` to show the sidebar inline. The nav is a `<nav aria-label={t('owner.nav.label')}>`.
- [ ] **Step 4: Run** the file and `test/tokens.test.ts test/i18n.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owner shell with sidebar, drawer and owner switcher`.

---

### Task 5: Today: summary cards and pending queue

**Files:**
- Create: `apps/web/src/owner/today/{TodayPage.tsx,TodayPage.module.css,summarize.ts}`
- Test: `apps/web/test/owner/today.test.tsx`

**Interfaces:**
- Consumes: `useVenueParam`, `VenueSelect`, `useResource`, `StatCard`, `OwnerBooking`.
- Produces:
  - `summarize(bookings: OwnerBooking[]): { count: number; collected: number; pending: number; upcoming: OwnerBooking[] }`
    - `count`: bookings whose status is not `cancelled`, `rejected` or `expired`.
    - `collected`: Σ(`amountPaid − amountRefunded`) over all of the day's bookings, including cancelled ones.
    - `pending`: the number with status `pending`.
    - `upcoming`: non-terminal bookings (`pending`, `awaiting_payment`, `confirmed`) whose last slot `endAt` is after now, sorted by first `startAt`.
  - `TodayPage`:
    - It loads `GET bookings?venueId=<venue>`; the API defaults to venue-local today.
    - Three `StatCard`s (`owner.today.bookings`, `owner.today.collected` with hint `owner.today.collectedHint` = "Paid for today's bookings, minus refunds", `owner.today.pending`) in the venue currency.
    - A table of `upcoming`: time range, turf, customer, status badge, link to the booking detail.
    - Pending rows show Confirm/Reject buttons when `can('booking.confirm')`. They use the same handlers as Task 8; until then, a link to the detail.
    - With no venues, it shows `owner.today.noVenues` with a link to `venues/new` when `can('venue.manage')`.

- [ ] **Step 1: Write failing tests:**
  - `summarize counts live bookings, nets refunds into collected and counts pending`. Fixture: one confirmed paid 3000, one cancelled paid 2000 refunded 2000, one pending unpaid, one expired. Expect count 2, collected 3000, pending 1.
  - `summarize upcoming excludes finished and terminal bookings`
  - `Today shows stat cards in venue currency for the selected venue`
  - `Today with no venues prompts to create one`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/today.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `vi.useFakeTimers({ toFake: ['Date'] })` in tests for "now".
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owner today summary`.

---

### Task 6: Schedule calendar

**Files:**
- Create: `apps/web/src/owner/schedule/{SchedulePage.tsx,ScheduleGrid.tsx,ScheduleGrid.module.css,scheduleLayout.ts}`
- Test: `apps/web/test/owner/scheduleLayout.test.ts`, `apps/web/test/owner/schedule.test.tsx`

**Interfaces:**
- Consumes: `useVenueParam`, `DateStrip` (`venue/DateStrip.tsx`), `OwnerTurf`, `OwnerSlotDay`, `OwnerBooking`.
- Produces:
  - `type Cell = { kind: 'booking'; booking: OwnerBooking; row: number; span: number } | { kind: 'slot'; slot: OwnerSlot; row: number; span: number }`
  - `type Layout = { originMs: number; rows: number; labels: { row: number; ms: number }[]; columns: { turf: OwnerTurf; closed: boolean; closedReason: string | null; cells: Cell[] }[] }`
  - `scheduleLayout(turfs: OwnerTurf[], days: Record<string, OwnerSlotDay>, bookings: OwnerBooking[]): Layout`
    - `originMs` = the minimum slot `startAt` across all turfs; the end is the maximum `endAt`.
    - One row is 15 minutes: `row = (startMs − originMs) / 900000 + 1` and `span = durationMs / 900000`.
    - There is a label every 2 rows (30 min).
    - Each live booking (status not `cancelled`, `rejected` or `expired`) gets one cell spanning its first slot's start to its last slot's end. The slot cells it covers, matched by `Date.parse(startAt)`, are dropped.
    - Other slots stay `slot` cells.
    - A turf day that is `closed` has no cells.
    - If no turf has any slots, `rows` is 0.
  - `ScheduleGrid` props are `{ layout: Layout; timeZone: string; now: number; onSlot(turfId: string, slot: OwnerSlot): void; bookingHref(id: string): string }`.
    - It is a CSS grid: a `--schedule-time-col` time column, then one `minmax(var(--schedule-col-min), 1fr)` column per turf, with rows of `--schedule-row`. The wrapper scrolls horizontally.
    - Booking blocks are links showing the time range, the customer name (or `owner.walkInGuest`) and the status text. Their color follows the booking-status mapping, applied as the soft bg plus a left border of `--status-bar`.
    - Available slots are buttons with the time and price; clicking calls `onSlot`.
    - Blocked slots are striped and past slots are subtle. A held `pending` slot with no booking uses the warning soft style labelled `slots.pending`.
    - A closed column shows `owner.schedule.closed` and the reason.
    - Every state is in text, never color alone.
    - When `originMs <= now < end`, a `--danger` line sits at `top: calc((now − originMs) / 900000 * var(--schedule-row))`, with `aria-hidden`.
  - `SchedulePage`:
    - It has `VenueSelect` and a `DateStrip` (today = venue-local today, `?date=`).
    - It loads the turfs (`GET venues/:v/turfs`, active only), each turf's `GET .../slots?date=`, and `GET bookings?venueId&from=date&to=date`.
    - Clicking an available slot navigates to `walk-in?venue=&turf=&date=&start=<startAt>` when `can('booking.create')`. Otherwise available cells are not buttons.
    - It refetches every 60 s while visible (`setInterval`, cleared on unmount).

- [ ] **Step 1: Write failing tests**, `scheduleLayout.test.ts`:
  - `scheduleLayout places after-midnight slots after the evening ones`. A turf with slots 23:00 and 00:00 (next UTC day), plus a 01:00 slot; rows increase monotonically and the 00:00 row is the 23:00 row + 4.
  - `merges a two-slot booking into one cell and drops its slot cells`
  - `aligns turfs with different slot lengths on a 15-minute grid` (30-min and 60-min turfs)
  - `closed turf has no cells and keeps its reason`
  - `cancelled booking leaves its slots as slot cells`

  `schedule.test.tsx`:
  - `schedule shows booking blocks with customer names and links to detail`
  - `clicking an available slot opens walk-in with the slot prefilled`
  - `member without booking.create cannot click slots`
  - `current-time line renders only for today`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/scheduleLayout.test.ts test/owner/schedule.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owner schedule calendar`.

---

### Task 7: Bookings list with filters

**Files:**
- Create: `apps/web/src/owner/bookings/{BookingsPage.tsx,BookingsPage.module.css,bookingFilters.ts}`
- Test: `apps/web/test/owner/bookingsList.test.tsx`

**Interfaces:**
- Consumes: `useVenueParam`, `Table`, `BookingStatusBadge`, `PaymentStatusBadge`.
- Produces:
  - `type BookingFilters = { venueId: string; turfId: string | null; from: string; to: string; status: BookingStatus | null; q: string }`
  - `readFilters(p: URLSearchParams, venue: OwnerVenue): BookingFilters`. The default is `from` = `to` = venue-local today.
  - `filtersToParams(f: BookingFilters): URLSearchParams`, which omits defaults and empty values.
  - `apiPathFor(ownerId: string, f: BookingFilters): string`. Never send `q`; send `turfId` and `status` only when set.
  - `matchesQuery(b: OwnerBooking, q: string): boolean`: case-insensitive match on reference, customer name, or customer phone digits.
  - `rangeError(f): 'owner.bookings.rangeOrder' | 'owner.bookings.rangeMax' | null`: `to < from`, or more than 31 days. When set, the page shows the error and does not fetch.
  - Page:
    - Filter bar: venue, turf (`owner.bookings.allTurfs`), from, to, status (`owner.bookings.allStatuses` + all 8 statuses via `bookingStatus.*` keys), and a search `TextField`.
    - Table columns: reference, date/time (venue tz), turf, customer, total, paid, status, source.
    - A row is a link to `bookings/:id`.
    - An empty result shows `owner.bookings.empty`.
    - When exactly 500 rows come back, it shows `owner.bookings.capped` ("Showing the first 500, narrow the range").

- [ ] **Step 1: Write failing tests:**
  - `filters round-trip through the URL and omit defaults`
  - `api path never includes q and includes status only when set`
  - `search matches reference, name and phone digits`
  - `a range over 31 days shows an error and does not fetch`
  - `rows link to booking detail`
  - `500 results show the capped notice`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/bookingsList.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owner bookings list with filters`.

---

### Task 8: Booking detail and status actions

**Files:**
- Create: `apps/web/src/owner/bookings/{OwnerBookingPage.tsx,OwnerBookingPage.module.css,BookingActions.tsx,ReasonDialog.tsx,availableActions.ts}`
- Modify: `apps/web/src/bookings/CancelDialog.tsx` (make it generic `CancelDialog<B>` so `cancel` returns `{ booking: B; refunds: RefundJson[] }`; player usage is unchanged)
- Test: `apps/web/test/owner/bookingDetail.test.tsx`

**Interfaces:**
- Consumes: `BookingDetail`, `useOwner().can`, `CancelDialog`, `RefundList`, `BookingStatusBadge`.
- Produces:
  - `type Action = 'confirm' | 'reject' | 'cancel' | 'checkIn' | 'noShow' | 'markCash' | 'paymentLink'`
  - `availableActions(b: OwnerBooking, can: (p: Permission) => boolean): Action[]` follows the Global Constraints table:
    - `paymentLink` only when `status === 'awaiting_payment' && source === 'walkin' && can('booking.create')`;
    - `markCash` only when `amountPaid < total`.
  - `ReasonDialog` props `{ open; title; confirmLabel; tone: 'danger' | 'primary'; onClose; onSubmit(reason?: string): Promise<void> }`. It has an optional `Textarea` limited to 300 characters.
  - Page:
    - Header: reference, status and payment badges.
    - Facts: venue (from `useOwner().venues`), turf, date, time range in the venue tz, source, and customer name/phone/email with a `tel:` link.
    - Slots and add-on lines; totals (subtotal, add-ons, total, advance, paid, refunded).
    - Payments table and refunds (`RefundList`). Refund row actions come in Task 9.
    - Action buttons:
      - Confirm → `POST bookings/:id/confirm`.
      - Reject → `ReasonDialog` → `POST .../reject {reason?}`.
      - Cancel → `CancelDialog` with `loadPreview = GET .../cancellation` and `cancel = POST .../cancel {reason?}`.
      - Check-in → `POST .../check-in`.
      - No-show → `POST .../no-show`.
    - Every action disables all action buttons while pending.
    - On success the page `set`s the new booking (cancel also merges the returned refunds and reloads).
    - On error it shows `errorMessage(err, t)` in an `Alert`. On a 409 it also reloads the detail.
    - Add i18n `errors.too_early`, `errors.invalid_transition`, `errors.payment_in_progress` and `errors.already_paid` if they are missing.
    - A 404 renders `owner.bookings.notFound` with a link back to the list.

- [ ] **Step 1: Write failing tests:**
  - `availableActions per status and permission`: a table test over pending/awaiting_payment/confirmed/completed × the owner and staff permission sets.
  - `booking detail shows customer, slots in venue time and totals`
  - `booking detail hides actions the member lacks`
  - `confirm posts once even when double-clicked and updates the status`
  - `a 409 on confirm shows the error and reloads the booking`
  - `reject sends the trimmed reason`
  - `cancel shows the staff preview and merges refunds`
  - `out-of-scope booking renders not found`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/bookingDetail.test.tsx test/bookings`. Expected: the new tests FAIL and the Plan 12 bookings tests PASS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS. Then replace the Today pending-row stubs (Task 5) with confirm/reject buttons that use the same handlers, extracted as `useBookingAction(ownerId, id)`, and re-run `test/owner/today.test.tsx`.
- [ ] **Step 5: Commit** `feat(web): owner booking detail with confirm, reject, cancel, check-in, no-show`.

---

### Task 9: Money actions: mark cash, refunds, payment link QR

**Files:**
- Create: `apps/web/src/owner/bookings/{CashDialog.tsx,PaymentLinkDialog.tsx,OwnerRefunds.tsx}`
- Modify: `apps/web/src/owner/bookings/OwnerBookingPage.tsx`, `apps/web/package.json` (`qrcode@1.5.4`, `@types/qrcode@1.5.5`)
- Test: `apps/web/test/owner/moneyActions.test.tsx`

**Interfaces:**
- Consumes: `availableActions` (Task 8), `parseMoney`, `currencyExponent`.
- Produces:
  - `CashDialog` props `{ open; booking: OwnerBooking; onClose; onRecorded(b: OwnerBooking): void }`.
    - The amount field is prefilled with the remaining `total − amountPaid` formatted for input. It is parsed with `parseMoney`; an invalid or out-of-range amount shows `owner.cash.invalid` and nothing is posted.
    - `POST bookings/:id/payments/cash {amount}`, sending `amount` only when it differs from the remaining amount.
  - `PaymentLinkDialog` props `{ open; link: PaymentLink | null; load(): Promise<PaymentLink>; onClose }`.
    - It renders a QR code (`QRCode.toString(url, { type: 'svg' })` via `dangerouslySetInnerHTML`; the SVG is generated locally from a URL string) at `--qr-size`, with white quiet-zone colors left as the library default because QR needs contrast in both themes.
    - Below the code: the amount, a read-only link field, and a Copy button (`navigator.clipboard.writeText`, then `owner.link.copied`).
    - Errors `hold_expired` and `payments_unavailable` show translated text.
  - `OwnerRefunds` props `{ refunds: RefundJson[]; onChanged(): void }`. It wraps `RefundList` and adds per-row actions when `can('refund.issue')`:
    - a `failed` card refund gets Retry (`POST refunds/:id/retry`) and Record as cash (`POST refunds/:id/record-cash`);
    - a `pending` cash refund gets Record cash paid out.
    - Each action is followed by `onChanged()`, which reloads the detail.

- [ ] **Step 1: Write failing tests:**
  - `mark cash defaults to the remaining amount and posts no amount`
  - `mark cash posts a partial amount in minor units` (e.g. "12.50" USD → 1250)
  - `invalid cash amount does not post`
  - `payment link dialog renders a QR svg and copies the url`
  - `failed card refund offers retry and record-cash; pending cash offers record`
  - `refund actions are hidden without refund.issue`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/moneyActions.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Install and implement** (`node_modules/.bin/pnpm --filter web add qrcode@1.5.4 && node_modules/.bin/pnpm --filter web add -D @types/qrcode@1.5.5`).
- [ ] **Step 4: Run** the same command and `node_modules/.bin/pnpm --filter web build`. Expected: PASS, build OK.
- [ ] **Step 5: Commit** `feat(web): owner cash payments, refund actions and payment link QR`.

---

### Task 10: Walk-in booking

**Files:**
- Create: `apps/web/src/owner/walkin/{WalkInPage.tsx,WalkInPage.module.css,walkInEstimate.ts}`
- Modify: `apps/web/src/venue/SlotGrid.tsx`, `SlotGrid.module.css` (add a prop `tone?: 'brand' | 'portal'`; `portal` styles the selected cell and legend with `--primary`/`--primary-fg`; the default is unchanged)
- Test: `apps/web/test/owner/walkIn.test.tsx`

**Interfaces:**
- Consumes:
  - `toggleSlot`/`keepSelectable` (`venue/slotSelection.ts`), `SlotGrid`, `DateStrip`, `PhoneInput`;
  - `PaymentLinkDialog` (Task 9);
  - `quoteAddons` and `OfferedAddon` from `@booking/shared`;
  - `AddonPicker` (`checkout/AddonPicker.tsx`) if its props fit; otherwise a local list with the same controls.
- Produces:
  - `walkInEstimate(input: { slots: OwnerSlot[]; offered: WalkInAddon[]; indoor: boolean; selection: AddonSelection[] }): { slotsTotal: number; addons: AddonLine[]; total: number } | null`
    - It returns null when no slots are picked or any picked slot has a null price.
    - It maps `WalkInAddon` to `OfferedAddon` with `addonId = id` and `stock = null`.
    - It is labelled `owner.walkIn.estimate` ("Estimated, the final price is set when you book").
  - Page:
    - Query params `venue`, `turf`, `date` and `start` prefill the form; `start` pre-selects that slot if it is selectable.
    - Turf select; date strip; `SlotGrid tone="portal"` from `GET venues/:v/turfs/:t/slots?date=`. Selection is consecutive, at most 12.
    - When `day.inWindow` is false it shows `owner.walkIn.outsideWindow` and disables submit.
    - Add-ons come from `GET venues/:v/turfs/:t/addons`.
    - Customer name (required, 1..80) and phone (required; `PhoneInput`).
    - Payment radio:
      - `cash` is shown only when `can('payment.mark_cash')`, with an amount field defaulting to the estimate total, sent only when edited;
      - `link`;
      - `unpaid`.
    - Submit → `POST venues/:v/turfs/:t/bookings` with body `{ date, startAts, addons, customer: { name, phone }, payment }` (no extra keys).
      - On 201 without a payment, navigate to `bookings/<id>`.
      - With `payment` (link), open `PaymentLinkDialog` with the returned link; closing it navigates to the detail.
    - Errors: show `errorMessage` and keep every field. On `slot_taken`, `slot_unavailable` or `outside_window`, refetch the slot grid and drop now-unselectable slots (`keepSelectable`).
    - Add i18n for `errors.slot_taken`, `errors.outside_window`, `errors.payments_unavailable`, `errors.player_not_found`, `errors.nothing_to_pay` and `errors.invalid_amount` if missing.

- [ ] **Step 1: Write failing tests:**
  - `walkInEstimate sums slots and add-ons including per_hour rounding and auto lines`
  - `walkInEstimate is null when a slot has no price`
  - `prefilled slot from the schedule is selected`
  - `cash option hidden without payment.mark_cash`
  - `submit sends exactly the documented body and opens booking detail`
  - `link payment shows the QR dialog then goes to detail`
  - `walk-in slot_taken keeps the form and refetches slots`
  - `outside the booking window disables submit`
  - Also `SlotGrid portal tone marks selected cells without brand` (class check).
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/walkIn.test.tsx test/venue`. Expected: the new tests FAIL and the venue tests PASS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owner walk-in booking`.

---

### Task 11: Venues list, venue editor, location picker, turf list

**Files:**
- Create: `apps/web/src/owner/venues/{VenuesPage.tsx,VenueEditorPage.tsx,VenueForm.tsx,venueForm.ts,LocationPicker.tsx,TurfList.tsx,venues.module.css}`
- Test: `apps/web/test/owner/venues.test.tsx`

**Interfaces:**
- Consumes: `useOwner().venues`/`reloadVenues`, `Tabs`, `Checkbox`, `SPORTS`, `AMENITIES`, `isTimeZone`, `SLUG_RE` (`@booking/shared`).
- Produces:
  - `type VenueDraft = { name; slug; address; city; country; timezone; currency; lat: string; lng: string; amenities: Amenity[]; photos: { url: string; alt: string }[] }`
  - `draftFromVenue(v: OwnerVenue): VenueDraft`
  - `validateVenue(d: VenueDraft, isNew: boolean): Partial<Record<keyof VenueDraft, string>>` returns i18n keys:
    - name 1..100, address 1..300, city 1..100;
    - country `^[A-Z]{2}$`;
    - timezone `isTimeZone`;
    - lat −90..90, lng −180..180;
    - slug empty or `SLUG_RE` with length 3..60;
    - photo URLs `https://`, at most 20.
  - `venueBody(d: VenueDraft, original: OwnerVenue | null): object`
    - Create sends every key, with `slug`/`currency` only if non-empty and `alt` omitted when empty.
    - Edit sends only changed keys; `currency` is never sent on edit.
  - `LocationPicker` props `{ lat: number | null; lng: number | null; onChange(lat: number, lng: number): void }`.
    - It is a Leaflet map with OSM tiles, like `ResultsMap`, at height `--map-height`.
    - Clicking the map or dragging the marker sets the position, rounded to 6 decimals.
    - Lat and lng `TextField`s sit beside it as the keyboard-accessible path.
    - In tests Leaflet is mocked the same way the Plan 12 map tests mock it.
  - `VenuesPage`: a table with name, city, published badge (`owner.venues.published` success / `owner.venues.draft` neutral), and turf count (from turf lists loaded lazily, or "—"). "New venue" is shown when `can('venue.manage') && membership.venueIds === 'all'`.
  - `VenueEditorPage` (`venues/new` and `venues/:venueId`) has `Tabs` for details, turfs, settings (Task 13) and add-ons (Task 16):
    - Details tab:
      - the `VenueForm`;
      - Publish/Unpublish (`PATCH {published}`; 409 `venue_not_ready` → `errors.venue_not_ready`);
      - Delete (confirm `Dialog`; 409 `venue_has_turfs` → `errors.venue_has_turfs`).
      - After any write it calls `reloadVenues()`. After create it navigates to `venues/<id>`.
      - Read-only (disabled fields, no save) without `venue.manage`.
    - Turfs tab: `TurfList` lists turfs (name, sports, indoor/outdoor, slot length, active badge), each linking to `venues/:v/turfs/:t`. A create form (name, sports checkboxes, indoor, slot length `Select` 30..240 step 15, default 60) is shown with `turf.manage`; it posts and navigates to the new turf.

- [ ] **Step 1: Write failing tests:**
  - `validateVenue flags bad country, timezone, coordinates, slug and photo urls`
  - `venueBody on edit sends only changed keys and never currency`
  - `create venue posts the form and opens the new venue`
  - `publish without an active turf shows venue_not_ready`
  - `location picker fields update the draft`
  - `new venue hidden for venue-scoped members`
  - `create turf posts name, sports, indoor and slotLengthMin`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/venues.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owner venues and turfs CRUD with location picker`.

---

### Task 12: Settings form, hours editor, owner settings page

**Files:**
- Create: `apps/web/src/owner/settings/{HoursEditor.tsx,SettingsForm.tsx,settingsPatch.ts,SettingsPage.tsx,settings.module.css}`
- Test: `apps/web/test/owner/settings.test.tsx`

**Interfaces:**
- Consumes: shared settings types, `WEEKDAYS`, `parseMoney` (for partial_fixed).
- Produces:
  - `HoursEditor` props `{ value: Partial<WeeklyHours>; inherited?: WeeklyHours; onChange(v: Partial<WeeklyHours>): void; disabled?: boolean }`. There is one row per weekday (the locale weekday name):
    - mode `Select`: open / closed, plus inherit when `inherited` is given;
    - open and close `<input type="time">`;
    - when `close <= open`, the hint `owner.hours.nextDay`;
    - for an inherit row, a muted line with the inherited value.
    - An inherit row is absent from `value`.
  - `type SettingsLevel = 'owner' | 'venue'`
  - `SettingsForm` props `{ level: SettingsLevel; stored: Partial<OwnerSettings>; effective: OwnerSettings; inherited: OwnerSettings | null; currency: string; onSave(patch: Record<string, unknown>): Promise<void>; disabled?: boolean }`. Sections:
    - hours;
    - weekend days (checkboxes);
    - payment policy:
      - none, full or partial percent;
      - `partial_fixed` only at venue level, with a money field;
      - a note that any advance turns guest booking off;
    - guest booking (allowed, require OTP);
    - refund rules: rows of hours-before + percent, add/remove, at most 10, duplicate thresholds flagged;
    - booking window (1..365);
    - pending auto-reject hours (0..72; owner level only).
    - At venue level each section has an "Inherit from owner" checkbox.
  - `settingsPatch(level, before: Partial<OwnerSettings>, draft: Draft): Record<string, unknown>`
    - It includes only keys that differ from `before`.
    - Inherit becomes `null`.
    - Hours are diffed per day: a changed day is sent with its value, a day turned to inherit is sent as `null`, and unchanged days are omitted.
    - Owner level never sends `null` for hours days (no inherit).
  - `SettingsPage` (`settings.edit`): it loads `GET settings`, renders `SettingsForm level="owner"` and saves with `PATCH settings`. A success alert reads `owner.settings.saved`. Task 13 adds the Stripe card under the form.

- [ ] **Step 1: Write failing tests:**
  - `settings form patches only changed keys and null for inherit`. Owner: change only the booking window → `{ bookingWindowDays: 45 }`. Venue: set inherit on refund rules → `{ refundRules: null }`; change Monday hours only → `{ hours: { mon: {...} } }`.
  - `hours editor shows next-day hint when close is before open`
  - `partial_fixed only offered at venue level and parsed to minor units`
  - `duplicate refund thresholds block save`
  - `settings page saves and shows confirmation`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/settings.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): owner settings form with hours editor`.

---

### Task 13: Venue settings tab and Stripe gateway card

**Files:**
- Create: `apps/web/src/owner/venues/VenueSettingsTab.tsx`, `apps/web/src/owner/settings/StripeGatewayCard.tsx`
- Modify: `VenueEditorPage.tsx` (settings tab), `SettingsPage.tsx` (gateway card)
- Test: `apps/web/test/owner/venueSettingsGateway.test.tsx`

**Interfaces:**
- Consumes: `SettingsForm`, `settingsPatch` (Task 12), `GatewayView`.
- Produces:
  - `VenueSettingsTab` props `{ venue: OwnerVenue; ownerSettings: OwnerSettings; onSaved(v: OwnerVenue): void }`.
    - It renders `SettingsForm level="venue"` with `stored = venue.settings`, `effective = venue.effectiveSettings` and `inherited = ownerSettings` (from `GET settings`).
    - Saving sends `PATCH venues/:id {settings: patch}`.
    - It is disabled without `venue.manage`.
  - `StripeGatewayCard`, shown inside `SettingsPage`:
    - It loads `GET payment-gateways` (bare array) and takes the `stripe` entry.
    - Connected: it shows the mode badge (test = warning, live = success), the account id, an Enabled `Checkbox` (`PATCH payment-gateways/stripe {enabled}`), and the webhook URL plus the event list with Copy buttons.
    - Not connected, or "Replace keys": a form with secret key, publishable key and webhook secret. Client-side checks match the API regexes (`^(sk|rk)_(test|live)_\S+$`, `^pk_(test|live)_\S+$`, `^whsec_\S+$`) and the same mode. It submits `PUT payment-gateways/stripe {secretKey, publishableKey, webhookSecret}`.
    - Secret fields are `type="password"` with `autoComplete="off"` and are cleared after a successful save.
    - Errors use `errorMessage` (add `errors.gateway_account_in_use`, `errors.gateway_error` and `errors.payments_unconfigured`).

- [ ] **Step 1: Write failing tests:**
  - `venue settings tab saves settings patch under the settings key`
  - `venue settings tab shows inherited owner values`
  - `stripe card shows webhook url and toggles enabled`
  - `stripe form rejects mixed test and live keys before posting`
  - `stripe form clears secrets after connecting`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/venueSettingsGateway.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): venue settings overrides and Stripe gateway settings`.

---

### Task 14: Turf editor: details, hours, pricing

**Files:**
- Create: `apps/web/src/owner/turfs/{TurfEditorPage.tsx,TurfDetailsForm.tsx,PricingEditor.tsx,pricingForm.ts,turfs.module.css}`
- Test: `apps/web/test/owner/turfEditor.test.tsx`

**Interfaces:**
- Consumes: `HoursEditor` (Task 12), `Tabs`, `parseMoney`, `currencyExponent`, `OwnerTurf`, `PricingRule`.
- Produces:
  - `TurfEditorPage` (`venues/:venueId/turfs/:turfId`) loads `GET venues/:v/turfs/:t` and has `Tabs` for details, hours, pricing, overrides (Task 15) and add-ons (Task 16).
  - Details tab:
    - Fields: name, sports, indoor and active, with `slotLengthMin` read-only plus the hint `owner.turf.slotLengthFixed`.
    - Saving sends `PATCH` with the changed keys only.
    - Delete: on 409 `turf_has_bookings`, show the error with a "Deactivate instead" button (`PATCH {active:false}`). 409 `last_active_turf` maps to `errors.last_active_turf`.
  - Hours tab: `HoursEditor` with `value = turf.settings.hours ?? {}` and `inherited = venue effective hours`. It saves `PATCH {settings:{hours: diff}}`, using the same per-day diff as `settingsPatch`; reuse it.
  - `type PricingDraft = { base: string; rules: { kind: 'date' | 'weekend' | 'weekday'; date: string; allDay: boolean; start: string; end: string; price: string }[] }`
  - `draftFromPricing(p: TurfPricing | null, currency: string, lang: string): PricingDraft`
  - `pricingFromDraft(d: PricingDraft, currency: string): { ok: true; pricing: TurfPricing } | { ok: false; errors: Record<string, string> }`
    - Prices are parsed with `parseMoney`.
    - `range` is omitted when `allDay`.
    - `date` is sent only for `kind: 'date'`.
    - Same-tier overlapping ranges are flagged client-side as `owner.pricing.overlap` (all-day overlaps everything in its tier; for date-tier rules only the same date counts; ranges crossing midnight are split as the shared `rangeMinutes` does).
  - `PricingEditor`:
    - a base price field;
    - a rules list grouped by tier, in the order date, weekend, weekday, with the caption `owner.pricing.priority` ("Date beats weekend, weekend beats weekday, then base");
    - add/remove rule.
    - Saving sends `PUT venues/:v/turfs/:t/pricing`.
    - A 400 `validation_error` whose message mentions overlap shows `owner.pricing.overlap`.
    - It is disabled without `pricing.edit`.
    - A null pricing shows `owner.pricing.unpriced` ("Slots show as unavailable until a base price is set").

- [ ] **Step 1: Write failing tests:**
  - `pricingFromDraft parses minor units and omits range for all-day rules`
  - `pricingFromDraft flags overlapping weekday ranges including across midnight`
  - `pricing editor saves the whole pricing object with PUT`
  - `turf details sends only changed keys and shows slot length read-only`
  - `turf delete with bookings offers deactivate`
  - `turf hours saves a per-day diff under settings.hours`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/turfEditor.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): turf editor with hours and pricing rules`.

---

### Task 15: Slot overrides and closures

**Files:**
- Create: `apps/web/src/owner/schedule/{OverridesTab.tsx,OverrideForm.tsx,overrideBody.ts,ClosuresPage.tsx,ClosureForm.tsx}`
- Modify: `TurfEditorPage.tsx` (overrides tab), `ownerRoutes.tsx` (closures)
- Test: `apps/web/test/owner/overridesClosures.test.tsx`

**Interfaces:**
- Consumes: `Override`, `Closure`, `WEEKDAYS`, `parseMoney`, slot grid `GET .../slots?date=` (for modify's `slotStart` choices).
- Produces:
  - `type OverrideDraft = { type: 'block' | 'modify' | 'add' | 'close'; when: 'date' | 'recurring'; date: string; weekdays: Weekday[]; from: string; until: string; start: string; end: string; slotStart: string; price: string; reason: string }`
  - `overrideBody(d: OverrideDraft, currency: string): { ok: true; body: object } | { ok: false; errors: Record<string, string> }` builds the discriminated body:
    - `block {start,end}`;
    - `modify {slotStart,start,end,price?}`;
    - `add {start,end,price?}`;
    - `close {}`;
    - plus exactly one of `date` or `recurrence {weekdays, from, until?}`, and `reason` only when non-empty.
    - A recurring draft needs at least one weekday, and `until >= from` when set.
  - `OverridesTab`:
    - A month picker (`?month=YYYY-MM`, defaulting to the venue-local current month) loads `GET .../overrides?from=<first>&to=<last>`.
    - A table shows date or recurrence (localized weekdays), type (`owner.override.type.*`), time, price and reason, with Delete (`DELETE`, confirm).
    - "Add override" opens `OverrideForm` in a `Dialog`. For `modify`, the slot start is a `Select` of the generated slots for the chosen date (date mode only; recurring modify enters `HH:MM`).
    - Errors `override_overlap`, `slot_not_found` and `override_too_long` are translated.
    - The form shows the note `owner.override.existingBookings` ("Existing bookings are not cancelled").
    - Gated by `slot.override`; read-only without it.
  - `ClosuresPage`:
    - The scope filter (all / venue / turf) loads `GET closures?venueId=&turfId=`.
    - A table shows scope label (owner-wide / venue name / turf name), from–to and reason, with Delete.
    - `ClosureForm` scope options:
      - owner-wide only when `can('settings.edit') && venueIds === 'all'`;
      - venue/turf when `can('slot.override')`.
    - Validation: `to >= from`, at most 366 days.
    - It posts `{venueId?, turfId?, from, to, reason?}`.

- [ ] **Step 1: Write failing tests:**
  - `overrideBody builds each type with date or recurrence and omits empty reason`
  - `overrideBody requires a weekday for recurring overrides`
  - `override_overlap from the API is shown translated`
  - `modify offers the generated slot starts for the date`
  - `closure scope owner-wide hidden for scoped members`
  - `closure range over 366 days is rejected before posting`
  - `deleting a closure removes the row`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/overridesClosures.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): slot overrides and closures`.

---

### Task 16: Add-on catalogue and assignments

**Files:**
- Create: `apps/web/src/owner/addons/{AddonsPage.tsx,AddonForm.tsx,addonForm.ts,AssignmentsTable.tsx}`
- Modify: `VenueEditorPage.tsx` (add-ons tab), `TurfEditorPage.tsx` (add-ons tab)
- Test: `apps/web/test/owner/addons.test.tsx`

**Interfaces:**
- Consumes: `Addon`, `Assignment`, `ADDON_PRICING_TYPES`, `parseMoney`.
- Produces:
  - `type AddonDraft = { name; pricingType: AddonPricingType; price: string; maxQuantity: string; stock: string; autoApply: boolean; autoAllDay: boolean; autoStart: string; autoEnd: string; outdoorOnly: boolean }`
  - `addonBody(d: AddonDraft, original: Addon | null, currency: string): { ok: true; body: object } | { ok: false; errors: Record<string, string> }`
    - Edit sends only changed keys.
    - An empty stock means `null`.
    - autoApply is invalid with `per_unit` or a non-empty stock (`owner.addons.autoConflict`), mirroring the API.
  - `AddonsPage` (`addon.manage`):
    - A catalogue table: name, pricing type (`owner.addons.type.*`), price in the owner currency, max qty, stock, and an auto badge.
    - Create/edit `Dialog` with `AddonForm`; delete confirm.
    - Writes are hidden unless `membership.venueIds === 'all'`; scoped members get the note `owner.addons.ownerWideOnly`.
  - `AssignmentsTable` props `{ level: 'venue' | 'turf'; venue: OwnerVenue; turfId?: string; addons: Addon[]; assignments: Assignment[]; onChanged(): void }`. There is one row per catalogue add-on:
    - an Enabled checkbox;
    - a price override field (blank = catalogue price; required when the add-on currency differs from the venue currency, which shows `errors.price_override_required`);
    - stock at venue level only.
    - Save row → `PUT venues/:v/addons/:a` (or `.../turfs/:t/addons/:a`) `{enabled, priceOverride, stock?}`.
    - Remove → `DELETE` (shown only when a row exists).
    - The caption `owner.addons.offeredHint` reads "Only add-ons switched on here are offered".
    - The venue editor's add-ons tab loads `GET addons` and `GET venues/:v/addons`. The turf tab filters the assignment list to its `turfId`.

- [ ] **Step 1: Write failing tests:**
  - `addonBody rejects auto-apply with per_unit or stock`
  - `addonBody on edit sends only changed keys`
  - `create add-on posts minor-unit price`
  - `catalogue writes hidden for venue-scoped members`
  - `assignment save puts enabled and price override; turf rows omit stock`
  - `price_override_required is shown translated`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/addons.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): add-on catalogue and venue/turf assignments`.

---

### Task 17: Staff and roles

**Files:**
- Create: `apps/web/src/owner/staff/{StaffPage.tsx,MemberDialog.tsx,RoleEditor.tsx,staff.module.css}`
- Test: `apps/web/test/owner/staff.test.tsx`

**Interfaces:**
- Consumes: `Member`, `Role`, `PERMISSIONS`, `useOwner().membership` (for the self row and the escalation hint).
- Produces:
  - `StaffPage` (`staff.manage`) has `Tabs` for members and roles.
  - Members table:
    - Columns: name, email/phone, role, venues (`owner.staff.allVenues` or the venue names), status badge (active = success, disabled = neutral; a member who has never signed in is not distinguishable through the API, so there is no invited state).
    - Actions: Edit and Remove. They are hidden on the caller's own row and on the owner-role row, since the API refuses them (`cannot_modify_self`, `owner_membership_locked`).
  - `MemberDialog` (add/edit):
    - Add: name, a contact `Select` (email/phone) with the matching field, role `Select` (excluding the system owner role), and venue access (all, or venue checkboxes).
    - Edit: role, venues, status.
    - Add posts `{name, email|phone, roleId, venueIds}`; edit patches only changed keys.
    - The note `owner.staff.noInvite` reads "No invitation is sent. They sign in with this email or phone to get access."
    - Errors `already_member`, `email_unverified`, `role_not_assignable` and `privilege_escalation` are translated.
  - `RoleEditor`:
    - The roles list shows name, a system badge, the member count and the permission count.
    - Create/edit dialog: name, plus permission checkboxes grouped as Bookings (`booking.*`, `payment.mark_cash`, `refund.issue`), Venues (`venue.manage`, `turf.manage`, `pricing.edit`, `slot.override`, `addon.manage`) and Admin (`staff.manage`, `settings.edit`, `reports.view`). Each label is `owner.perm.<key with . replaced by _>`, and every one of the 15 permissions appears exactly once.
    - Permissions the caller lacks are disabled, with the hint `owner.staff.cannotGrant`.
    - System roles are read-only.
    - Delete is disabled when `memberCount > 0` (`errors.role_in_use`).

- [ ] **Step 1: Write failing tests:**
  - `role editor lists all 15 permissions once and disables ones the caller lacks`
  - `add member posts phone contact and selected venues`
  - `edit member patches only changed keys`
  - `own row and owner row have no edit or remove`
  - `system role is read-only and in-use role cannot be deleted`
  - `privilege_escalation is shown translated`
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/staff.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): staff members and roles`.

---

### Task 18: Activity log

**Files:**
- Create: `apps/web/src/owner/activity/{ActivityPage.tsx,activityText.ts}`
- Test: `apps/web/test/owner/activity.test.tsx`

**Interfaces:**
- Consumes: `ActivityItem`, `ActivityPage`, `useOwner().venues`.
- Produces:
  - `activityLabel(item: ActivityItem, t: TFunction): string` uses `owner.activity.action.<action with . replaced by _>`. Unknown actions fall back to `owner.activity.action.unknown` with `{{action}}`. Every action listed in digest §2.3 has a key in both locales.
  - `changedKeys(before: unknown, after: unknown): string[]` returns the top-level keys whose JSON differs, sorted.
  - `ActivityPage` (`reports.view`):
    - It loads `GET activity?limit=50` and shows a table: time, actor (name or `owner.activity.system`), action label, entity (`entity` + a link to the booking detail when `entity === 'booking'`), and changed keys.
    - Time is shown in the entry's venue tz when `venueId` matches a known venue, otherwise in the browser zone.
    - "Load more" (shown while `nextBefore` is non-null) appends `GET activity?limit=50&before=<nextBefore>`.
    - A row expands (a `<details>` element) to show before/after as formatted JSON in a `<pre>`, rendered as text and never as HTML.

- [ ] **Step 1: Write failing tests:**
  - `activityLabel translates known actions and falls back for unknown`
  - `changedKeys lists differing top-level keys`
  - `load more appends the next page and hides at the end`
  - `booking entries link to the booking detail`
  - `before/after render as text`: a `<script>` string in `after` is shown literally.
- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter web exec vitest run test/owner/activity.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command, then the full gate:
  - `node_modules/.bin/pnpm typecheck`
  - `node_modules/.bin/pnpm lint`
  - `node_modules/.bin/pnpm test`
  - `node_modules/.bin/pnpm --filter web build`

  Expected: all green, and no `owner.comingSoon` placeholders left in `ownerRoutes.tsx` (`grep -n comingSoon apps/web/src/owner/ownerRoutes.tsx` → no output; then delete the key from both locales).
- [ ] **Step 5: Commit** `feat(web): owner activity log`.

---

## Decisions this plan makes (for the reviewer)

- **Daily summary is client-side.** Collected = paid minus refunded for today's bookings, labelled so. There is no reports endpoint until Plan 16. Cost if wrong: a later API endpoint and a one-file swap in `summarize.ts`.
- **One API change only (Task 1).** Customer names are needed everywhere. Photo upload, owner-profile edit, invites, reference search on the server and a staff quote all stay out of scope:
  - photos are https URLs;
  - the walk-in total is an estimate from shared `quoteAddons`;
  - search filters the loaded list.
- **Portal entry** is a link on the profile page plus `/owner`, rather than an AppShell nav fetch. This keeps Plan 12's zero-unmatched-call tests valid.
- **Member "invited" status** is not shown: the API has only active/disabled.
