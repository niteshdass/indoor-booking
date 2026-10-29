# Super Admin — Design

Date: 2026-10-28
Plan 18 of the roadmap (`docs/superpowers/plans/2026-10-23-roadmap.md`, Phase 3: "Owner self-registration, `pending_approval` flow, Super Admin panel (platform-scope role), owner suspension"), plus the review hide/keep that the reviews spec (`2026-10-25-reviews-ratings-design.md`) deferred to Plan 18.

The user asked for "a superadmin dashboard" and left every decision to the builder; everything below is the builder's call unless it cites an earlier spec.

## Intent

The platform runs one owner today but is built multi-vendor. Before a second owner can join, the people running the platform need one place to see the whole platform and act on it: let new venue owners in, stop a bad one, keep player accounts in order and settle flagged reviews. Owners need a way to ask to join.

## Goals

- A platform admin (Super Admin) signs in with their normal account and gets `/admin`, a portal in the same shell look as the owner portal.
- **Overview:** platform KPIs and a "needs your attention" list (owners waiting for approval, flagged reviews).
- **Owners:** list with status tabs and search; detail page with facts, contact people, venues, 30-day numbers and history; approve, suspend (with a reason), reactivate.
- **Users:** searchable list; disable / enable an account (disable signs them out everywhere).
- **Reviews:** cross-owner moderation queue: flagged, hidden, kept; Hide or Keep (final, per the reviews spec).
- **Activity:** every admin action in a platform log, newest first.
- **Owner self-registration:** a signed-in user applies with business name, country, currency and language; the owner starts `pending_approval`; the applicant sees a waiting screen in `/owner` until approved.
- A CLI script grants or revokes the platform role (the first admin cannot be created from the UI).

## Non-goals

- Commission, payouts, Stripe Connect (Plan 19).
- Platform admins editing owner data (venues, prices, bookings) or impersonating owners.
- Several platform roles in the UI. The model allows them (permissions per role), but only `super_admin` is seeded and the UI shows everything to it.
- Emails to owners on approve/suspend. The applicant sees the status the next time they open the portal. (Easy follow-up through the notifications module.)
- Deleting owners or users.

## Anti-goals

- A platform role leaking into the owner side: owners must never see, assign or be granted it through roles or members endpoints.
- Any admin endpoint reachable without the platform role (every route sits behind one guard).
- An admin disabling their own account or another admin's from the UI.
- Moderation changing a venue's rating outside a transaction (the reviews spec requires the aggregate to move with the change).

## Decisions

### Platform role
- `packages/shared`: `PLATFORM_PERMISSIONS` (`platform.view`, `platform.owners`, `platform.users`, `platform.reviews`) and `PLATFORM_ROLES = { super_admin: all }`.
- `Role` gets a system role `{ ownerId: null, system: true, scope: 'platform', key: 'super_admin', name: 'Super admin' }`, upserted by `ensureSystemRoles()`.
- `User.platformRoleId` (ObjectId, default null) holds it. Platform access never goes through `Membership`.
- `requirePlatform(...perms)` (after `requireAuth`) loads the role with `scope: 'platform'`; no role or a missing permission gives `403 forbidden`.
- Owner-side role queries (`requireTenant`, roles list, assignable roles) now exclude `scope: 'platform'`.
- `PublicUser.platformAdmin: boolean`, so the web app can show the Admin link without an extra request.
- `pnpm --filter api platform-admin --email <email> [--revoke]`.

### Platform log
New `PlatformLog` collection (not tenant-scoped): `{ actorId, action, entity: 'owner'|'user'|'review', entityId, ownerId?, reason?, at }`. Actions: `owner.approved`, `owner.suspended`, `owner.reactivated`, `user.disabled`, `user.enabled`, `review.hidden`, `review.kept`, `owner.applied` (actor is the applicant). The owner's own activity log is not written to, so its labels stay unchanged.

### API (`/api/v1/admin`, all behind `requireAuth` + `requirePlatform`)
| Route | Permission | Notes |
|---|---|---|
| `GET /admin/me` | `platform.view` | `{ role, permissions }`; the web guard |
| `GET /admin/overview` | `platform.view` | owners by status; users total and new in last 30 days vs the 30 before; venues total/published; bookings made in last 30 days vs before (excluding never-booked `awaiting_payment`/`expired`); earned value in last 30 days per currency (same "earned" rule as the owner Overview); open flags; 5 oldest pending owners; 5 newest owners |
| `GET /admin/owners?status&q&page` | `platform.owners` | 25 a page, newest first; `q` matches business name or an owner-role member's name/email; each row: venues, published venues, bookings in 30 days, primary contact; tab counts by status |
| `GET /admin/owners/:id` | `platform.owners` | owner, contacts (active owner-role members), member count, venues (name, city, published, courts, rating), 30-day bookings and earned per currency, platform log for this owner |
| `POST /admin/owners/:id/approve` | `platform.owners` | `pending_approval` → `active`, else `409 invalid_status` |
| `POST /admin/owners/:id/suspend` `{ reason }` | `platform.owners` | `active`/`pending_approval` → `suspended`; reason 1–500 chars, required |
| `POST /admin/owners/:id/reactivate` | `platform.owners` | `suspended` → `active` |
| `GET /admin/users?q&status&page` | `platform.users` | 25 a page; `q` matches name, email or phone; each row has team count and `platformAdmin` |
| `POST /admin/users/:id/disable` / `enable` | `platform.users` | not yourself, not another platform admin (`409 cannot_change_admin`); disable revokes refresh tokens |
| `GET /admin/reviews?state=flagged|hidden|kept&before` | `platform.reviews` | cursor paged (20), with venue, owner, author, flagger names |
| `POST /admin/reviews/:id/hide` / `keep` | `platform.reviews` | reviews spec rules: only a flagged, visible review; hide → `moderation: hidden`, keeps the flag record, recomputes rating in one transaction; keep → `flag: null`, `flagCleared: true`; both final |
| `GET /admin/activity?before` | `platform.view` | 30 a batch with actor and target names |
| `POST /owners` (any signed-in user) | — | self-registration: `createOwner` with `status: 'pending_approval'`; one pending application per user (`409 application_pending`) |

Suspension needs nothing else: public venue reads and search already require an active owner, and `requireTenant` already refuses inactive owners (`403 owner_inactive`). Existing bookings are left as they are.

### Web
- `/admin/*` under `RequireAuth` + a platform guard (`/admin/me`; a 403 shows "You don't have access" with a link home).
- `AdminShell` reuses the owner portal shell styles: sidebar card "Platform admin", nav Overview, Owners (warning count pill = waiting approval), Users, Reviews (warning count pill = open flags), Activity; same footer (player site, account row, sign out) and top bar (title, language, theme).
- Pages follow existing patterns: StatCards, cards with `Table bare`, `Tabs`, search field, server `Pagination`, `Badge`, `EmptyState`, `Dialog` confirmations (suspend asks for a reason).
- Profile gets a "Platform admin" row card (like Owner portal) when `user.platformAdmin`.
- `/list-your-venue` (signed in): the application form (business name, country, currency, language; reuses the venue form's region selects). The landing "List your venue" buttons point here.
- `/owner` index: no teams → empty state with "List your venue"; only pending/suspended teams → a status card per team ("Waiting for approval" / "Suspended"). `OwnerProvider` tells pending from suspended.

## Left to the builder
Copy, icons, exact KPI order and tests follow the existing owner portal conventions.
