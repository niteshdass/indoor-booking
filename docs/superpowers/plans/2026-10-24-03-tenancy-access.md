# Plan 03 — Tenancy & Access Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners, roles and staff memberships with permission checks, so every owner-side API request runs inside one owner's tenant, sees only that owner's data (and only the venues the member is assigned to), and leaves an activity-log trail.

**Architecture:** New `apps/api/src/tenancy/` module. `Owner`, `Role`, `Membership`, `ActivityLog` models. A Mongoose plugin (`tenantScoped`) makes any query on an owner-scoped model without an `ownerId` filter throw, so a forgotten filter is a 500, never a leak. Owner-side routes live under `/api/v1/owners/:ownerId/…`; `requireTenant` resolves the caller's membership into `req.tenant`, `requirePermission` gates by permission key, and `tenantRepo(Model, tenant)` injects `ownerId` (and the venue scope) into every query. Roles and members are managed through REST endpoints; the first owner is created by a CLI script (no owner self-registration in Phase 1).

**Tech Stack:** Plan 01–02 stack. No new dependencies (`node:util` `parseArgs` for the CLI).

**Spec:** `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md` §5 (Tenancy and roles), §16 (`owners`, `memberships`, `roles`, `activityLogs`), §2 anti-goal "Any query or endpoint that can leak one owner's data to another owner or their staff", §18 (tenancy scoping must have automated tests). Roadmap: `docs/superpowers/plans/2026-10-23-roadmap.md` (Plan 03; failure mode 2).

## Global Constraints

- Plan 01–02 constraints still apply (TS strict, ESM, error shape `{ error: { code, message, details? } }`, `/api/v1`, injected `services.now()`).
- "Every owner-scoped collection carries `ownerId`. Every API query for owner-side data filters by the `ownerId` from the authenticated context — enforced in one place (a middleware/repository helper), never left to individual handlers."
- "All owner-scoped collections include `ownerId` (indexed, first field in compound indexes)."
- A manager/staff request for another owner's (or an unassigned venue's) data → `404`, never data.
- Permission keys are the `PERMISSIONS` list in `packages/shared/src/permissions.ts`; system role bundles are `SYSTEM_ROLES` there. Do not duplicate them in the API.
- Super Admin is not built; `roles.scope` has a `'platform'` value and `roles.ownerId` may be `null` so it can be added without schema changes.
- Players stay platform-level: `users` gets no `ownerId`.

## Decisions made in this plan (builder's calls)

- **Tenant in the URL:** owner-side routes are `/api/v1/owners/:ownerId/...` (a user may belong to several owners later; mobile-friendly; no hidden header state).
- **System roles** are global docs (`ownerId: null`, `system: true`, `key: 'owner'|'manager'|'staff'`) upserted from `SYSTEM_ROLES` at startup by `ensureSystemRoles()`. Owners' custom roles have their `ownerId`. System roles are read-only.
- **Venue scope:** membership stores `allVenues: boolean` + `venueIds: ObjectId[]`; API shape is `venueIds: 'all' | string[]`. Plan 03 cannot check that venue ids exist (venues arrive in Plan 04) — Plan 04 adds that check to the members endpoints.
- **Adding staff:** owner adds a member by email *or* phone. If no user has it, a user stub is created (`name` + that email/phone, unverified). The person then signs in by phone OTP or by "forgot password" (which verifies the email — Plan 02 fix I-3). No invite tokens.
- **No privilege escalation:** an actor can only create/edit roles, assign roles, and grant venue scope that are subsets of their own. Nobody can change or remove the owner membership or their own membership.
- **Non-members** (not a member, disabled membership, unknown or malformed owner id) → `404 not_found`. Owner `status` other than `active` → `403 owner_inactive`. Missing permission → `403 forbidden`.
- **Activity log** reading needs `reports.view`. Entries carry optional `venueId`; members limited to some venues see only entries for those venues (entries without `venueId` are owner-level and visible only to all-venue members).
- **First owner** is created by `pnpm --filter api create-owner --email <registered user email> --name ... --country ... --currency ... [--locale en]`.

## Review Focus

1. A member of owner A calling `/owners/<B>/…`, a malformed id, a non-existent id, or a disabled membership → `404 not_found`, identical body each time (Task 2 test "non-members get identical 404s").
2. A member who holds `staff.manage` but not `refund.issue` creates a role with `refund.issue`, assigns such a role, or (with limited venues) grants `'all'` venues → `403 privilege_escalation` (Task 5 + Task 6 tests).
3. Owner removes/demotes the owner membership or their own membership → `409`, owner never locked out (Task 6 tests).
4. A handler that forgets the `ownerId` filter (`Membership.find({})`, `Role.findById(id)`) → throws, never returns another owner's rows (Task 3 test "unscoped queries throw").
5. A member limited to venue V1 reads records or activity for venue V2 → not returned / `404` (Task 3 repo tests, Task 4 activity test).

---

## File Structure

```
packages/shared/src/
  statuses.ts                # MODIFY: + OWNER_STATUSES, MEMBERSHIP_STATUSES
  permissions.ts             # MODIFY: + SystemRoleKey type, SYSTEM_ROLE_NAMES
  locales.ts                 # LOCALES = ['en','ru'], Locale  (export from index.ts)
apps/api/src/
  tenancy/
    tenantScoped.plugin.ts   # mongoose plugin: queries must filter by ownerId
    owner.model.ts
    role.model.ts            # + ensureSystemRoles()
    membership.model.ts
    activityLog.model.ts     # + logActivity()
    createOwner.ts           # createOwner(input, now) service
    context.ts               # TenantContext, requireTenant, requirePermission, assertVenueAccess
    repo.ts                  # tenantRepo(Model, tenant, opts)
    routes/owner.ts          # ownerRouter: mounts tenant middleware + sub-routers; GET /owners/:ownerId
    routes/myMemberships.ts  # GET /me/memberships
    routes/roles.ts
    routes/members.ts
    routes/activity.ts
  scripts/createOwner.ts     # CLI
  types/express.d.ts         # MODIFY: + req.tenant
  app.ts                     # MODIFY: mount routers
  server.ts                  # MODIFY: await ensureSystemRoles() before listen
apps/api/test/
  helpers/tenancy.ts         # seedOwner(), addMember(), bearer()
  tenancy/*.test.ts
```

---

### Task 1: Owner, Role, Membership models, system roles, createOwner + CLI

**Files:**
- Modify: `packages/shared/src/statuses.ts`, `packages/shared/src/permissions.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/locales.ts`
- Create: `apps/api/src/tenancy/tenantScoped.plugin.ts` (stub: exported no-op plugin; Task 3 fills it), `owner.model.ts`, `role.model.ts`, `membership.model.ts`, `activityLog.model.ts` (model only; `logActivity` in Task 4), `createOwner.ts`, `apps/api/src/scripts/createOwner.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/package.json` (script `"create-owner": "tsx --env-file-if-exists=../../.env src/scripts/createOwner.ts"`)
- Test: `packages/shared/test/permissions.test.ts` (extend), `apps/api/test/tenancy/models.test.ts`, `apps/api/test/tenancy/createOwner.test.ts`

**Interfaces:**
- Consumes: `User` (`src/auth/user.model.ts`), `normalizeEmail` (`src/auth/normalize.ts`), `runInTransaction` (`src/db.ts`), `currencyExponent`, `SYSTEM_ROLES`, `PERMISSIONS` (`@booking/shared`).
- Produces:
  - shared: `OWNER_STATUSES = ['active','pending_approval','suspended'] as const`, `OwnerStatus`; `MEMBERSHIP_STATUSES = ['active','disabled'] as const`, `MembershipStatus`; `type SystemRoleKey = keyof typeof SYSTEM_ROLES`; `SYSTEM_ROLE_NAMES: Record<SystemRoleKey,string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' }`; `LOCALES = ['en','ru'] as const`, `Locale`.
  - `Owner` model: `{ name: string (1–100), country: string (/^[A-Z]{2}$/), defaultCurrency: string (valid per currencyExponent), defaultLocale: Locale (default 'en'), status: OwnerStatus (default 'active'), settings: Mixed (default {}; Plan 04 types it) }`, timestamps.
  - `Role` model: `{ ownerId: ObjectId|null (ref Owner), scope: 'owner'|'platform' (default 'owner'), system: boolean (default false), key: SystemRoleKey|undefined, name: string (1–50), permissions: string[] }`, timestamps. Indexes: `{ ownerId:1, name:1 }` unique with collation `{ locale:'en', strength:2 }`; `{ key:1 }` unique partial `{ system: true }`. Plugin `tenantScoped` applied.
  - `ensureSystemRoles(): Promise<void>` — idempotent upsert by `{ ownerId: null, system: true, key }` setting `name` (`SYSTEM_ROLE_NAMES`), `permissions` (`SYSTEM_ROLES`), `scope: 'owner'`.
  - `systemRole(key: SystemRoleKey): Promise<RoleDoc>` — throws `Error('System roles not seeded')` if missing.
  - `Membership` model: `{ ownerId: ObjectId, userId: ObjectId (ref User), roleId: ObjectId (ref Role), allVenues: boolean (default false), venueIds: ObjectId[] (default []), status: MembershipStatus (default 'active') }`, timestamps. Indexes: `{ ownerId:1, userId:1 }` unique; `{ userId:1 }`; `{ ownerId:1, roleId:1 }`. Plugin applied.
  - `ActivityLog` model: `{ ownerId, actorId (ref User), action: string, entity: string, entityId: ObjectId, venueId?: ObjectId, before?: Mixed, after?: Mixed, at: Date }`. Index `{ ownerId:1, _id:-1 }`, `{ ownerId:1, venueId:1, _id:-1 }`. Plugin applied.
  - `createOwner(input: { userId: string; name: string; country: string; currency: string; locale?: Locale }, now: Date): Promise<{ owner: OwnerDoc; membership: MembershipDoc }>` — in one transaction: create owner, create membership (`roleId` = system owner role, `allVenues: true`), and (Task 4 wires it) an `owner.create` activity entry. Throws `AppError(400,'invalid_owner', …)` for bad country/currency/name.

- [ ] **Step 1: Write failing tests**

`packages/shared/test/permissions.test.ts` — add: `SYSTEM_ROLE_NAMES` has a name for every `SYSTEM_ROLES` key; `LOCALES` equals `['en','ru']`.

`apps/api/test/tenancy/models.test.ts`:
- `ensureSystemRoles creates owner/manager/staff once` — call twice; `Role.countDocuments({ ownerId: null, system: true })` → 3; owner role permissions equal `PERMISSIONS`.
- `ensureSystemRoles repairs drifted permissions` — set staff role permissions to `[]`, run again → equals `SYSTEM_ROLES.staff`.
- `role names are unique per owner, case-insensitive` — create `{ownerId: X, name: 'Cashier'}` then `'cashier'` → duplicate key error; same name under owner Y succeeds.
- `one membership per user per owner` — second create with same `{ownerId,userId}` → duplicate key error.

`apps/api/test/tenancy/createOwner.test.ts`:
- `creates owner and owner membership with all venues` — returns owner `{ status: 'active', defaultLocale: 'en' }`; membership `allVenues: true`, role key `'owner'`.
- `rejects bad country / unknown currency` — `country: 'bd'` and `currency: 'XXX1'` → `AppError` code `invalid_owner`; no `Owner` docs left.
- `is atomic` — make membership creation fail (pass a `userId` that is not a valid ObjectId) → no owner doc remains.

(The `beforeAll` of every tenancy test runs `startTestDb()`, `init()` on every model it touches, and `ensureSystemRoles()`.)

- [ ] **Step 2: Run to verify they fail**

Run: `node_modules/.bin/pnpm --filter @booking/shared test && node_modules/.bin/pnpm --filter api exec vitest run test/tenancy`
Expected: FAIL — missing exports / modules.

- [ ] **Step 3: Implement shared constants, models, `ensureSystemRoles`, `systemRole`, `createOwner`**

Owner/membership/activity models use `tenantScoped` stub (Task 3 makes it enforce); write every query in this task with an explicit `ownerId` in the filter already (system roles: `ownerId: null`), so Task 3 needs no rewrites here.

- [ ] **Step 4: Implement CLI `src/scripts/createOwner.ts`**

`parseArgs` options `email, name, country, currency, locale` (all strings; all but `locale` required). Loads config, connects, `ensureSystemRoles()`, finds user by `normalizeEmail(email)` (missing → print `No user with email <email>; register first` and exit 1), `createOwner(...)`, prints `Owner <name> created: <ownerId>`, disconnects. Errors print `error.message` and exit 1. No unit test (thin wrapper); manual check in Step 6.

- [ ] **Step 5: `server.ts` awaits `ensureSystemRoles()` after `connectDb`, before `listen`.**

- [ ] **Step 6: Verify**

Run: `node_modules/.bin/pnpm test` → all pass. Manual: with a local replica set and a registered user, `node_modules/.bin/pnpm --filter api create-owner --email <e> --name "Test Arena" --country BD --currency BDT` prints `Owner Test Arena created: <24-hex>`; unknown email prints the register-first message, exit 1.

- [ ] **Step 7: Commit** — `feat(api): owners, roles, memberships and create-owner CLI`

---

### Task 2: Tenant context, permissions, owner + my-memberships routes

**Files:**
- Create: `apps/api/src/tenancy/context.ts`, `routes/owner.ts`, `routes/myMemberships.ts`, `apps/api/test/helpers/tenancy.ts`
- Modify: `apps/api/src/types/express.d.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/tenancy/context.test.ts`

**Interfaces:**
- Consumes: `requireAuth(config, services)`, `AuthDeps`, Task 1 models, `signAccessToken(userId, secret, now)`.
- Produces:
  - `type TenantContext = { ownerId: string; userId: string; membershipId: string; roleId: string; roleKey: SystemRoleKey | null; permissions: ReadonlySet<Permission>; venueIds: 'all' | readonly string[] }`; `req.tenant?: TenantContext`.
  - `requireTenant(): RequestHandler` — reads `req.params.ownerId` (router uses `mergeParams`), requires `req.auth`; loads active membership `{ ownerId, userId, status: 'active' }` + its role + owner. Non-member/malformed/unknown → `404 not_found` "Owner not found"; owner not `active` → `403 owner_inactive`. Permissions = role permissions filtered by `isPermission`.
  - `tenantOf(req): TenantContext` — throws `Error` if unset (programmer error).
  - `requirePermission(...perms: Permission[]): RequestHandler` — all listed required; else `403 forbidden` "You do not have permission to do this".
  - `hasVenueAccess(t: TenantContext, venueId: string): boolean`; `assertVenueAccess(t, venueId): void` → `404 not_found`.
  - `ownerRouter(deps: AuthDeps): Router` mounted at `api.use('/owners/:ownerId', …)`; runs `requireAuth` then `requireTenant()`; `GET /` → `{ owner: { id, name, country, defaultCurrency, defaultLocale, status }, membership: { id, role: { id, key, name }, permissions: string[] (sorted), venueIds } }`. Later tasks mount sub-routers on it.
  - `myMembershipsRouter(deps): Router` — `GET /me/memberships` (requireAuth) → `{ memberships: [{ ownerId, ownerName, ownerStatus, role: { id, key, name }, permissions, venueIds }] }`, active memberships only, sorted by owner name.
  - test helpers: `seedOwner(services, opts?: { name?: string }) → { ownerId, userId, token }`; `addMember(services, ownerId, opts: { roleKey?: SystemRoleKey; roleId?: string; venueIds?: 'all' | string[]; status?: MembershipStatus }) → { userId, membershipId, token }`; `bearer(token) → ['Authorization', 'Bearer …']`.

- [ ] **Step 1: Write failing tests (`context.test.ts`)**

Mount a probe route via `buildTestApp({ extraRoutes })` that is NOT under `ownerRouter`, e.g. `router.get('/probe/:ownerId', requireAuth(...), requireTenant(), requirePermission('refund.issue'), (req,res)=>res.json({ venueIds: tenantOf(req).venueIds }))`, plus calls through the real `GET /owners/:ownerId`.

- `owner sees their owner and full permissions` — `GET /owners/:id` → 200, `role.key: 'owner'`, `permissions` equals sorted `PERMISSIONS`, `venueIds: 'all'`.
- `non-members get identical 404s` — owner A's token on: owner B's id, `'not-an-id'`, a random ObjectId, and A's own id after setting a member's membership `disabled` (that member's token) → all `404`, all bodies deep-equal `{ error: { code: 'not_found', message: 'Owner not found' } }`.
- `suspended owner → 403 owner_inactive`.
- `no token → 401 unauthenticated`.
- `staff lacks refund.issue → 403 forbidden`; owner passes the probe.
- `limited member's venueIds are strings` — member with two ObjectIds → probe returns them as strings.
- `GET /me/memberships lists active memberships only` — user who is owner of A and disabled member of B → one entry, A.

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/tenancy/context.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `context.ts`, routers, `express.d.ts`, mount both in `app.ts` after `meRouter`.

- [ ] **Step 4: Run** the test file, then `node_modules/.bin/pnpm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `feat(api): tenant context and permission middleware`

---

### Task 3: Enforced tenant filter — plugin + `tenantRepo`

**Files:**
- Modify: `apps/api/src/tenancy/tenantScoped.plugin.ts`
- Create: `apps/api/src/tenancy/repo.ts`
- Test: `apps/api/test/tenancy/scoping.test.ts`

**Interfaces:**
- Consumes: `TenantContext`, Task 1 models.
- Produces:
  - `tenantScoped(schema): void` — registers `pre` hooks for `find, findOne, findOneAndUpdate, findOneAndDelete, findOneAndReplace, updateOne, updateMany, replaceOne, deleteOne, deleteMany, countDocuments` that throw `Error('Tenant filter missing: <Model>.<op>')` unless `this.getFilter()` has own key `ownerId` or `this.getOptions().crossTenant === true`; and an `aggregate` pre hook that requires the first stage to be `$match` with own key `ownerId` (or `$geoNear` whose `query` has `ownerId`), unless `this.options.crossTenant`. Document `save` relies on `ownerId` being `required` in the schema (not required on `Role`; system roles are seeded with `ownerId: null`).
  - `tenantRepo<T>(model: Model<T>, t: TenantContext, opts?: { venueField?: string })` returns `{ find(filter?, projection?), findOne(filter?), findById(id), countDocuments(filter?), create(doc), updateOne(filter, update), deleteOne(filter) }`. Every filter is `{ ...filter, ownerId: t.ownerId }` (tenant wins over a caller-supplied `ownerId`). With `venueField` and `t.venueIds !== 'all'`, also `[venueField]: { $in: t.venueIds }`. `findById` with a malformed id returns `null` (no CastError). `create` sets `ownerId` and, with `venueField`, throws `404 not_found` when the doc's venue is out of scope. Returns Mongoose queries/promises unchanged otherwise.
  - Existing `requireTenant` / `/me/memberships` / `ensureSystemRoles` queries keep passing: they already filter on `ownerId`; `/me/memberships` uses `.setOptions({ crossTenant: true })` (one documented exception — it filters by `userId`).

- [ ] **Step 1: Write failing tests (`scoping.test.ts`)**

Define a test-only model in the test file: `Widget { ownerId (required), venueId, name }` with `tenantScoped` applied.

- `unscoped queries throw` — `Widget.find({})`, `Widget.findOne({ name: 'a' })`, `Widget.findById(id)`, `Widget.updateMany({}, {...})`, `Widget.countDocuments()`, `Widget.aggregate([{ $match: { name: 'a' } }])` each reject with message containing `Tenant filter missing`; `Membership.find({})` too (real model).
- `crossTenant opt-out works` — `Widget.find({}).setOptions({ crossTenant: true })` resolves.
- `repo only sees own owner` — widgets for owners A and B; repo(A).find() returns only A's; repo(A).findById(B's widget id) → `null`; repo(A).updateOne({ _id: Bwidget }, …) modifies 0; repo(A).find({ ownerId: B }) still returns only A's.
- `repo.create stamps ownerId` — create `{ ownerId: B, name }` via repo(A) → stored with A.
- `venue scope filters reads and blocks writes` — tenant with `venueIds: [V1]`, `venueField: 'venueId'`: find returns only V1 widgets; findById(V2 widget) → `null`; create with V2 → `AppError` 404 `not_found`.
- `malformed id → null` — repo.findById('nope') → `null`.

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/tenancy/scoping.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement plugin and repo**

- [ ] **Step 4: Run** the file, then `node_modules/.bin/pnpm test` — Expected: PASS (fix any earlier query the plugin now rejects by adding the `ownerId` filter, never `crossTenant`, except `/me/memberships`).

- [ ] **Step 5: Commit** — `feat(api): enforce ownerId filter on tenant-scoped models`

---

### Task 4: Activity log

**Files:**
- Modify: `apps/api/src/tenancy/activityLog.model.ts`, `apps/api/src/tenancy/createOwner.ts`, `apps/api/src/tenancy/routes/owner.ts`
- Create: `apps/api/src/tenancy/routes/activity.ts`
- Test: `apps/api/test/tenancy/activity.test.ts`

**Interfaces:**
- Consumes: `TenantContext`, `tenantRepo`, `requirePermission`, `ownerRouter`.
- Produces:
  - `type ActivityEntry = { action: string; entity: string; entityId: string; venueId?: string; before?: unknown; after?: unknown }` — `action` is `'<entity>.<verb>'` (e.g. `role.create`); later plans add their own.
  - `logActivity(actor: { ownerId: string; userId: string }, entry: ActivityEntry, at: Date, session?: ClientSession): Promise<void>` (a `TenantContext` satisfies `actor`).
  - `createOwner` now logs `owner.create` (entity `owner`, `after: { name, country, defaultCurrency }`) in its transaction.
  - `GET /owners/:ownerId/activity?limit=&before=` — `requirePermission('reports.view')`; repo with `venueField: 'venueId'`; sorted `_id` desc; `limit` 1–100 default 50; `before` = an activity id (malformed → `400 validation_error`). Response `{ items: [{ id, action, entity, entityId, venueId, actor: { id, name }, before, after, at }], nextBefore: string | null }` (`nextBefore` = last item id when `items.length === limit`).

- [ ] **Step 1: Write failing tests (`activity.test.ts`)**

- `createOwner writes owner.create` — one entry, `actorId` = user, `entity: 'owner'`.
- `owner pages through activity newest first` — insert 3 entries via `logActivity` (distinct `at`); `?limit=2` → 2 newest + `nextBefore`; `?before=<nextBefore>` → the rest, `nextBefore: null`.
- `staff without reports.view → 403 forbidden`.
- `venue-limited member sees only their venues' entries` — custom role with `reports.view` (create directly in DB), member limited to V1; entries for V1, V2, and none → only V1 returned.
- `other owner's entries never appear` — entries for owner B not in owner A's list.
- `before=garbage → 400 validation_error`.

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/tenancy/activity.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** file, then `node_modules/.bin/pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): activity log`

---

### Task 5: Roles API

**Files:**
- Create: `apps/api/src/tenancy/routes/roles.ts`
- Modify: `apps/api/src/tenancy/routes/owner.ts` (mount)
- Test: `apps/api/test/tenancy/roles.test.ts`

**Interfaces:**
- Consumes: `tenantRepo`, `requirePermission`, `logActivity`, `runInTransaction`, `isDuplicateKeyError`, `isPermission`.
- Produces (all `requirePermission('staff.manage')`; role JSON `{ id, key, name, system, permissions: string[] (sorted), memberCount }`):
  - `GET /owners/:ownerId/roles` → `{ roles }`: system roles (owner, manager, staff order) then custom roles by name. Query `{ ownerId: { $in: [ownerId, null] } }` written explicitly (plugin accepts it).
  - `POST /owners/:ownerId/roles` body `{ name: string (trim, 1–50), permissions: string[] (≥1, unique, each isPermission) }` → `201 { role }`. Unknown key → `400 validation_error`. Name equal (case-insensitive) to a system role name or an existing custom role → `409 role_name_taken`. Permissions not ⊆ actor's → `403 privilege_escalation`. Logs `role.create`.
  - `PATCH /owners/:ownerId/roles/:roleId` body `{ name?, permissions? }` (≥1 field) → `{ role }`. System role → `409 system_role_readonly`. Other owner's / unknown / malformed id → `404 not_found`. Same escalation rule on new permissions. Logs `role.update` with `before`/`after` `{ name, permissions }`.
  - `DELETE /owners/:ownerId/roles/:roleId` → `204`. System → `409 system_role_readonly`; assigned to any membership → `409 role_in_use`. Logs `role.delete`.

- [ ] **Step 1: Write failing tests (`roles.test.ts`)**

- `lists system roles first then custom` — after creating `Cashier`.
- `creates a custom role` — 201, sorted permissions, activity `role.create` exists.
- `rejects unknown permission key → 400 validation_error`.
- `name clash → 409 role_name_taken` — `'manager'` and a repeated `'Cashier'` (`' cashier '`).
- `cannot grant permissions you lack → 403 privilege_escalation` — member whose custom role is `['staff.manage','booking.view']` posts `['refund.issue']`.
- `system roles are read-only` — PATCH and DELETE owner role → `409 system_role_readonly`.
- `role in use cannot be deleted → 409 role_in_use`; unused → 204.
- `other owner's role → 404` — owner A PATCHes owner B's role id.
- `staff role cannot manage roles → 403 forbidden`.

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/tenancy/roles.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** — each mutation + its `logActivity` in one `runInTransaction`; duplicate-key on name → `409 role_name_taken`.
- [ ] **Step 4: Run** file, then `node_modules/.bin/pnpm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(api): custom roles API`

---

### Task 6: Members (staff) API

**Files:**
- Create: `apps/api/src/tenancy/routes/members.ts`
- Modify: `apps/api/src/tenancy/routes/owner.ts` (mount)
- Test: `apps/api/test/tenancy/members.test.ts`

**Interfaces:**
- Consumes: `tenantRepo`, `requirePermission`, `logActivity`, `runInTransaction`, `normalizeEmail`, `normalizePhone`, `nameSchema` (`auth/routes/emailAuth.ts`), `User`, `isDuplicateKeyError`.
- Produces (all `requirePermission('staff.manage')`; member JSON `{ id, user: { id, name, email, phone }, role: { id, key, name }, venueIds: 'all' | string[], status, createdAt }`; `venueIdsSchema = z.union([z.literal('all'), z.array(objectIdString).max(500)])`, de-duplicated):
  - `GET /owners/:ownerId/members` → `{ members }` sorted by user name.
  - `POST /owners/:ownerId/members` body `{ name, email? , phone?, roleId, venueIds }` — exactly one of `email`/`phone` (`400 validation_error`). Finds user by normalized email/phone, else creates stub `{ name, email|phone }`. Role must be the owner's custom role or a system role other than `owner` (`owner` → `400 role_not_assignable`; unknown/other owner's → `404 not_found`). → `201 { member }`; already a member → `409 already_member`. Logs `member.add`.
  - `PATCH /owners/:ownerId/members/:membershipId` body `{ roleId?, venueIds?, status? ('active'|'disabled') }` (≥1) → `{ member }`. Logs `member.update` with before/after `{ roleId, venueIds, status }`.
  - `DELETE /owners/:ownerId/members/:membershipId` → `204`. Logs `member.remove` with `before`.
  - Guards (PATCH/DELETE): target is the owner-role membership → `409 owner_membership_locked`; target is the actor's own membership → `409 cannot_modify_self`; unknown/other owner's → `404 not_found`.
  - Escalation (POST/PATCH): assigned role's permissions ⊄ actor's, the target's current role's permissions ⊄ actor's, or granted venues ⊄ actor's venues (`'all'` only if actor has `'all'`) → `403 privilege_escalation`.

- [ ] **Step 1: Write failing tests (`members.test.ts`)**

- `adds an existing user by email` — user registered as `" Ana@X.com "`; POST with `ana@x.com` → 201, same user id, no new User.
- `adds a new person by phone (stub user)` — 201; `User` with that E.164 phone, `phoneVerified: false`; that person can then `POST /auth/otp/request` + `/auth/otp/verify` and `GET /owners/:id` → 200 with staff permissions.
- `email and phone together, or neither → 400 validation_error`.
- `already a member → 409 already_member`.
- `owner role not assignable → 400 role_not_assignable`.
- `manager cannot be given more than the actor has` — member with custom role `['staff.manage','booking.view']`, venues `[V1]`: POST with manager role → `403 privilege_escalation`; with `venueIds: 'all'` → 403; with `[V2]` → 403; with a `['booking.view']` role and `[V1]` → 201.
- `owner membership is locked` — another all-powerful member PATCHes/DELETEs owner membership → `409 owner_membership_locked`.
- `cannot modify self` — owner PATCHes own membership → `409 cannot_modify_self`.
- `disable then remove` — PATCH `status: 'disabled'` → that member's `GET /owners/:id` → 404; DELETE → 204, activity has `member.add`, `member.update`, `member.remove`.
- `other owner's membership → 404`.
- `staff cannot list members → 403 forbidden`.

- [ ] **Step 2: Run** `node_modules/.bin/pnpm --filter api exec vitest run test/tenancy/members.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** — user lookup/stub creation + membership + log in one `runInTransaction`; stub-create duplicate-key (concurrent add) → re-find the user.
- [ ] **Step 4: Run** file, then `node_modules/.bin/pnpm test`, `node_modules/.bin/pnpm lint`, `node_modules/.bin/pnpm typecheck` — Expected: all pass, clean.
- [ ] **Step 5: Commit** — `feat(api): staff membership API`

---

## Hand-off to later plans

- Plan 04 uses `tenantRepo(Venue, tenant, { venueField: '_id' })` and `tenantRepo(Turf, tenant, { venueField: 'venueId' })`, applies `tenantScoped` to every new owner-scoped model, mounts its routers on `ownerRouter`, and adds "venue ids exist and belong to this owner" validation to the members endpoints.
- Player-facing cross-owner reads (search, venue page) must use `.setOptions({ crossTenant: true })` and filter `published: true` explicitly.
