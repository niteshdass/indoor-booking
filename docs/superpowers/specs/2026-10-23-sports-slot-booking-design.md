# Indoor & Outdoor Sports Slot Booking — Design

Date: 2026-10-23
Status: Draft, awaiting approval

## 1. Intent

A system for booking time slots at indoor and outdoor sports venues (futsal turf, cricket nets, badminton courts, etc.). Players find a venue near them, pick a slot, optionally add extras, pay (or not, depending on the venue's policy) and play.

At launch there is **one venue owner** running **several venues**. The system must be built as **multi-vendor from day one** so that later anyone can register as a venue owner and manage their own venues, with a platform Super Admin above them — without restructuring the database.

Target market is **worldwide** (user's decision). Nothing in the core may assume one country, currency, language or timezone.

Web first. Android and iOS come later and must reuse the same backend API.

## 2. Goals, non-goals, anti-goals

**Goals**
- Players can search venues by distance (anywhere / 10 / 20 / 30 km / custom radius) and book slots.
- Owners configure hours, slot length, pricing, add-ons, payment policy and refund policy, with sensible inheritance (owner → venue → turf).
- Owners and their staff manage bookings, walk-ins and cash payments from a dashboard.
- Every piece of owner data is scoped by `ownerId` so multi-vendor is a feature flip, not a migration.

**Non-goals (for now)**
- Super Admin UI, self-registration for owners, commission, payouts (Phase 3 — but the data model and permission system must allow them).
- Native mobile apps (Phase 3).
- Gateways other than Stripe (Phase 3 — but payments sit behind a gateway abstraction).
- Splittable fields (one big field that can be booked whole or as two halves). Out of scope; noted as a future possibility.

**Anti-goals (would be a failure even if it "works")**
- Two players able to hold the same slot at the same time (double booking).
- Any query or endpoint that can leak one owner's data to another owner or their staff.
- A web app so tied to server-rendered pages that mobile apps can't reuse the API.
- Refunds or payment states that drift from what Stripe actually did.

## 3. Phases

**Phase 1 — first web launch**
- Owner account, multiple venues and turfs, staff with roles/permissions.
- Owner global settings: hours, weekend days, payment policy, guest booking, refund rules, booking window.
- Auto-generated slots from rules, with manual overrides.
- Pricing: base, weekend, peak hours, date-specific overrides.
- Add-ons at checkout.
- Player search by distance + sport + date.
- Booking flow incl. guest booking with pending status.
- Stripe advance payments (none / partial / full) and rule-based refunds.
- Walk-in bookings and cash payment marking by staff.
- Player login: phone OTP, email/password, Google.
- Email/SMS notifications for key booking events.
- Owner dashboard: calendar/schedule view, booking list, basic daily summary.

**Phase 2**
- Reviews and ratings.
- Coupons / discount codes.
- Detailed earnings reports and CSV export.
- Recurring bookings (e.g. every Friday 8pm for 4 weeks).

**Phase 3**
- Multi-vendor: owner self-registration, Super Admin panel, owner approval, commission, Stripe Connect payouts.
- Android and iOS apps.
- Regional gateways (e.g. bKash, SSLCommerz, Razorpay, Paystack, Mercado Pago). Each owner enables gateways in their own settings; player sees only gateways that support the venue's country and currency.

## 4. Tech stack

Decided by the user:
- **Frontend:** React.
- **Backend:** Node.js + Express.
- **Database:** MongoDB.
- **Payments:** Stripe first.

Builder's calls (made in this design, open to change):
- TypeScript across frontend and backend.
- Monorepo: `apps/web` (React + Vite, contains both the player site and the owner dashboard under separate route trees), `apps/api` (Express), `packages/shared` (types, validation schemas with Zod, constants such as permission keys and booking statuses).
- Mongoose for MongoDB models. MongoDB must run as a replica set (Atlas or local single-node replica set) because booking creation uses transactions.
- REST JSON API under `/api/v1`, JWT access token + refresh token, so mobile apps can use it unchanged.
- Times stored in UTC; each venue has an IANA timezone (e.g. `Asia/Dhaka`, `Europe/London`) and all slot generation happens in venue local time.
- i18n from day one: English default, extra languages added as translation files (Bangla likely first). Locale-aware date, time, number and currency formatting.
- Multi-currency: each owner has a default currency, each venue may set its own (venue country decides). All money stored as integer **minor units** with an ISO 4217 currency code; a currency-exponent table handles zero-decimal currencies (e.g. JPY, and BDT/others where needed by gateway). No cross-currency conversion in a single booking.
- Venue has a country (ISO 3166) used for gateway availability, phone number format (E.164), and tax/legal text later.
- **All payment gateway settings are venue-owner scoped (user's decision).** Each owner connects their own gateway accounts (Phase 1: their own Stripe account — keys + webhook secret) in owner settings; money goes straight to the owner. Credentials stored encrypted (AES-256-GCM, key from env), never returned by the API after saving. Every payment records which gateway account it was charged on (`gatewayAccountId`) so that the Phase 3 move to Stripe Connect / regional gateways never breaks refunds on older charges.

## 5. Tenancy and roles

### Tenancy rule (user's decision)
Every owner-scoped collection carries `ownerId`. Every API query for owner-side data filters by the `ownerId` from the authenticated context — enforced in one place (a middleware/repository helper), never left to individual handlers. Player-facing reads (search, venue page) only expose published venues.

### Roles
- **Super Admin (Phase 3, not built now):** platform level. Represented in the model as a platform-scope role so it can be added without schema changes.
- **Venue Owner:** full control over own venues, settings, staff, reports, (later) payouts.
- **Manager:** manages assigned venues — slots, pricing, add-ons, bookings, confirm/reject pending. No owner settings, no payouts.
- **Staff / Counter:** walk-in bookings, mark cash paid, check-in, view day schedule.

Roles are permission bundles. Owners can create custom roles by picking permissions. Permission keys are strings, e.g. `venue.manage`, `turf.manage`, `pricing.edit`, `slot.override`, `booking.view`, `booking.create`, `booking.confirm`, `booking.cancel`, `payment.mark_cash`, `refund.issue`, `addon.manage`, `staff.manage`, `settings.edit`, `reports.view`. Each staff member is assigned to specific venues (or "all venues").

An **activity log** records who did what (confirm, reject, cancel, refund, mark paid, pricing changes).

### Players
Players are platform-level users (not owner-scoped) — a player can book at any owner's venue. Login methods (user's decision: a mix): phone + OTP, email + password, Google. One account can link multiple methods.

## 6. Core concepts

- **Owner** → has many **Venues** → each has many **Turfs** (a bookable unit: "Court 1", "Turf A").
- **Turf** has: sport type(s), indoor/outdoor, slot length (chosen at creation: e.g. 60/90/120 min), pricing, optional own hours.
- **Venue** has: address, geo location (GeoJSON Point), timezone, photos, amenities, published flag.

### Settings inheritance (user's decision)
Owner global settings → overridden by Venue → overridden by Turf (where meaningful).

| Setting | Owner | Venue | Turf |
|---|---|---|---|
| Opening/closing hours per weekday | ✓ | ✓ | ✓ |
| Weekend days (can have different hours/prices) | ✓ | ✓ | |
| Slot length | | | ✓ (required) |
| Payment policy (none / partial / full advance) | ✓ | ✓ | |
| Guest booking allowed | ✓ | ✓ | |
| Refund rules | ✓ | ✓ | |
| Booking window (how many days ahead) | ✓ | ✓ | |
| Closed dates / holidays | ✓ | ✓ | ✓ |

Builder's call: the effective setting is resolved by a single function `resolveSettings(turf)` used everywhere.

## 7. Slots

User's decisions: slot length set per turf at creation; slots auto-generated from hours; owner can customize.

Builder's call — **slots are computed, not stored**. For a given turf and date, the slot list is:
1. Take effective hours for that weekday (weekend vs weekday).
2. Cut into slots of the turf's slot length, starting at opening time.
3. Apply **overrides** for that date: blocked slot, changed slot time, extra slot, whole day closed.
4. Attach price (see §8).
5. Attach status from bookings: `available`, `pending`, `booked`, `blocked`, `past`.

**Past-midnight hours (builder's call):** hours may cross midnight (e.g. 16:00–02:00) or be 24h. Hours are stored as `open` + `close` where `close <= open` means next day. A slot belongs to the **business day it opened on** — a 01:00 Saturday slot from Friday's 16:00–02:00 session is a Friday slot for pricing, weekend rules, closures, overrides and booking window.

Stored: `slotOverrides` (per turf, per date or recurring rule) and bookings. Nothing is written for dates with no changes.

Overrides must not produce overlapping slots on the same turf; the API rejects overlapping overrides.

**UI (user's decision):** pending slots are blocked for others and shown with a distinct "Pending" label/colour, separate from "Booked" and "Available".

Builder's call: a player can book one slot or several consecutive slots on the same turf in one booking.

## 8. Pricing

User confirmed: base price per slot per turf, different price for weekends and peak hours, plus date-specific overrides.

Builder's call — pricing is a list of rules on the turf, highest priority wins:
1. Date-specific price (e.g. Eid, tournament day).
2. Weekend + time-range price.
3. Weekday + time-range (peak) price.
4. Base price.

Price is snapshotted onto the booking at creation time; later price changes never affect existing bookings.

## 9. Add-ons

User's decision: paid add-ons exist (drinks, bath, others).

Typical catalogue: equipment rental (bat, ball, racket, shuttle, football, shoes, bibs), shower/locker/towel, water/drinks/snacks, referee/umpire, coach, floodlight charge, video recording, parking.

Builder's calls:
- Owner keeps one add-on catalogue; each add-on is enabled per venue/turf with optional price override.
- Pricing type per add-on: `per_booking`, `per_unit` (quantity), `per_hour`.
- Optional stock count for physical rental items (checked at booking time for that slot).
- Optional "auto-apply" rule (e.g. floodlight added automatically to slots after 6pm on outdoor turfs).
- Add-ons are snapshotted onto the booking (name, unit price, qty, total).
- Advance percentage applies to the **full total** (slot + add-ons).

## 10. Payment policy and guest booking

User's decisions:
- Payment policy per owner (overridable per venue): **no advance**, **partial advance** (fixed amount or percentage), **full advance**.
- **If any advance is required, guest booking is automatically disabled** for that venue.
- **Guest bookings always start as `pending`.**
- A pending booking **blocks the slot**.

Guest booking needs name + phone (builder's call: phone OTP verification recommended, toggle in settings). Guests get a booking reference and a link to view/cancel.

Builder's call: when a **registered** player books a no-advance venue, the booking is `confirmed` immediately (only guest bookings start pending).

## 11. Booking lifecycle

Statuses:
- `awaiting_payment` — advance required, payment in progress. Slot held for 10 minutes (builder's call), then auto-expires. Uses Stripe Payment Intents (embedded Payment Element), not hosted Checkout, because Checkout sessions can't expire in under 30 minutes. If a payment succeeds after the hold expired and the slot is gone, it is refunded automatically; if the slot is still free, the booking is revived and confirmed.
- `pending` — guest booking awaiting owner/staff confirmation. Blocks slot.
- `confirmed` — paid advance (if required) or confirmed by owner.
- `rejected` — owner rejected a pending booking. Slot freed.
- `cancelled` — by player, guest, owner or staff. Slot freed. Refund per rules.
- `expired` — payment hold timed out. Slot freed.
- `completed` — slot time passed, player showed up (auto after end time, or check-in).
- `no_show` — marked by staff.

Payment status separate from booking status: `unpaid`, `partially_paid`, `paid`, `refunded`, `partially_refunded`. Payments can come from Stripe or be marked cash by staff (with who/when in the activity log).

Builder's call on pending expiry: a pending booking not acted on is auto-rejected N hours before slot start (owner setting, default 2 hours), so slots don't stay locked forever.

### Double-booking prevention
Builder's call: a `slotLocks` collection with a unique index on `{ turfId, startAt }`. Creating a booking inserts one lock per slot inside a MongoDB transaction together with the booking. Cancelling/expiring/rejecting deletes the locks. A duplicate-key error means the slot was taken → API returns `409 Conflict`.

### Walk-ins
Staff create bookings from the dashboard for a walk-in player (name + phone, optional link to existing player).
- **Cash:** booking `confirmed` directly, payment recorded as cash.
- **Card (builder's call):** staff show a Stripe payment link / QR code that the player pays on their own phone; booking sits in `awaiting_payment` until the webhook confirms it. No Stripe Terminal hardware and no staff-typed card details in Phase 1.

## 12. Cancellation and refunds

User's decision: owner-level setting of tiered rules — "if cancelled at least X before slot start, refund Y%"; otherwise no refund. Example: ≥4 days → 100%, ≥3 days → 40%, ≥2 days → 20%, less → 0%.

Builder's calls:
- Rules evaluated top-down by largest threshold; first match wins.
- Venue can override owner rules.
- If the **owner/staff** cancels (rain, maintenance), refund is always 100% of what was paid.
- Stripe refunds issued automatically through the gateway; cash refunds recorded manually by staff.
- Refund % applies to amount actually paid (advance), not the full booking total.

## 13. Search

User's decision: player chooses search radius — anywhere, 10, 20, 30 km, or custom.

- Location from browser geolocation or a picked place/address.
- MongoDB `2dsphere` index on `venue.location`; `$geoNear` for distance + sort.
- Filters: sport, indoor/outdoor, date, time range, "has available slot", price range (builder's call).
- Results show distance, starting price, next available slot.

Builder's call: map provider for address autocomplete and map display is left to the builder (Google Maps or Mapbox / OpenStreetMap).

## 14. Payments architecture

- `PaymentGateway` interface: `createPayment`, `handleWebhook`, `refund`, `supports(country, currency)`. Stripe is the first implementation; regional gateways plug in later (worldwide target). Gateway config lives in an owner-scoped `paymentGateways` collection `{ ownerId, gateway, credentialsEncrypted, enabled, mode: test|live }`. Each owner has its own webhook endpoint `/api/v1/webhooks/:gateway/:ownerId` verified with that owner's secret.
- Refunds always go through the gateway + account that took the original payment.
- Stripe Checkout (or Payment Intents) for advance; booking confirmed only on webhook `checkout.session.completed` / `payment_intent.succeeded`, never on redirect alone.
- Webhooks are idempotent (store processed event IDs).
- Phase 3: platform commission. Because owners use their own gateway accounts, commission is billed to owners (invoice / balance deduction), or — optionally — owners can choose Stripe Connect so the platform takes an application fee. `ownerId` + `gatewayAccountId` on every payment keep both paths possible.

## 15. Notifications

Builder's call:
- Channels: email and SMS in Phase 1 (provider left to builder, behind a `Notifier` interface); push notifications in Phase 3 with the mobile apps.
- Events: booking created (pending/confirmed), confirmed by owner, rejected, cancelled, refund issued, reminder before slot (e.g. 2 hours), payment hold expiring.
- Owner/staff get notified of new pending bookings.
- Background jobs (expiry, reminders, auto-reject, auto-complete) via a job queue (builder's call: BullMQ + Redis, or Agenda on MongoDB).

## 16. Data model (sketch)

All owner-scoped collections include `ownerId` (indexed, first field in compound indexes).

- `owners` — profile, country, status (`active` / later `pending_approval`, `suspended`), defaultCurrency, defaultLocale, settings (global defaults incl. refund rules).
- `users` — players and staff identities: name, phone, email, auth providers, passwordHash.
- `memberships` — `{ userId, ownerId, roleId, venueIds | all }` (staff link to owner). Owner themselves is a membership with the owner role.
- `roles` — `{ ownerId | null (platform), name, permissions[] }`; system roles seeded.
- `venues` — `{ ownerId, name, slug, address, country, currency, location: GeoJSON Point, timezone, photos, amenities, settingsOverride, published }`.
- `turfs` — `{ ownerId, venueId, name, sports[], indoor, slotLengthMin, hoursOverride, pricingRules[], active }`.
- `slotOverrides` — `{ ownerId, turfId, date | recurrence, type: block|modify|add|close, start, end, reason }`.
- `closures` — owner/venue/turf closed dates.
- `addons` — `{ ownerId, name, pricingType, price, stock?, autoApplyRule? }` + `addonAssignments` `{ ownerId, addonId, venueId|turfId, priceOverride, enabled }`.
- `bookings` — `{ ownerId, venueId, turfId, playerId | guest{name, phone}, slots[{startAt, endAt, price}], addons[snapshot], subtotal, advanceRequired, total, status, paymentStatus, source: online|walkin, policySnapshot (payment + refund rules at booking time), createdBy, timestamps }`.
- `slotLocks` — `{ turfId, startAt, bookingId }`, unique `{ turfId, startAt }`.
- `paymentGateways` — `{ ownerId, gateway, credentialsEncrypted, enabled, mode }` (unique `{ownerId, gateway}`).
- `payments` — `{ ownerId, bookingId, gateway, gatewayAccountId, method: card|cash|wallet, amount (minor units), currency, status, gatewayRef }`.
- `refunds` — `{ ownerId, bookingId, paymentId, amount, reason, ruleApplied, gatewayRef, by }`.
- `activityLogs` — `{ ownerId, actorId, action, entity, entityId, before, after, at }`.
- Phase 2: `reviews`, `coupons`, `recurringSeries`. Phase 3: `payouts`, `commissions`.

## 17. Screens (Phase 1)

**Player (web)**
- Home / search (location, radius, sport, date).
- Search results (list + map).
- Venue page (photos, turfs, amenities, slot grid per turf/date).
- Checkout (slots, add-ons, totals, advance due, guest form or login).
- Payment (Stripe) → booking confirmation.
- My bookings (upcoming/past, cancel with refund preview).
- Guest booking lookup by reference + phone.
- Auth: login/register (phone OTP, email, Google), profile.

**Owner dashboard**
- Today / schedule calendar (per venue, per turf, colour by status).
- Bookings list with filters; booking detail (confirm/reject/cancel/refund/mark cash/check-in/no-show).
- Walk-in booking.
- Venues & turfs CRUD (incl. location picker, slot length, hours, pricing rules).
- Slot overrides & closures.
- Add-on catalogue.
- Settings (hours, weekend, payment policy, guest booking, refund rules, booking window, pending auto-reject).
- Staff & roles.
- Activity log.
- Basic summary (today's bookings, revenue collected, pending count).

## 18. Left to the builder

- Exact folder layout inside the monorepo, UI component library, state management.
- SMS, email and map providers.
- Job queue choice.
- Hosting/deployment.
- Exact API route naming, as long as it is REST, versioned and mobile-friendly.
- Test strategy details (but booking creation, slot locking, pricing resolution, refund calculation and tenancy scoping must have automated tests).
