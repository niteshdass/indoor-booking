# Reviews & Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in players rate a venue (1–5 stars plus an optional comment) after a completed booking. Venues show an average and a count on the venue page and on search cards, and search gets a "Top rated" sort. Owners reply publicly and flag reviews. Players get a "rate your game" prompt, and staff are told about new reviews.

**Architecture:**
- **Data:** a new tenant-scoped `Review` collection holds one row per completed booking (unique `bookingId`).
- **Aggregate:** `rating: { average, count }` is stored on the venue. It is recomputed from visible reviews inside the same transaction as every review write.
- **Booking fields:** `completedAt` (set by `transition()`), `reviewedAt` and `reviewRequestedAt`. These drive the 30-day review window, the "never review twice" rule and the prompt sweep.
- **Notices:** both are new events in the existing outbox (`review_request`, `review_posted`).
- **Web:**
  - Shared star components.
  - A review dialog on the player's booking page.
  - A reviews section on the venue page.
  - A rating on search cards and a sort option.
  - An owner Reviews page.

**Tech Stack:**
- API: Express, Mongoose and zod, tested with Vitest + supertest + mongodb-memory-server replica set.
- Web: React 19, react-router, react-i18next and CSS Modules, tested with Vitest + Testing Library using the `mockApi` and `renderApp` helpers.
- Shared: `@booking/shared`.

**Spec:** `docs/superpowers/specs/2026-10-25-reviews-ratings-design.md` (approved 2026-10-25). Roadmap: `docs/superpowers/plans/2026-10-23-roadmap.md`, Plan 14.

## Global Constraints

- **Who can review:** only the signed-in player who owns the booking (`booking.playerId`), only while `status === 'completed'`. Guest bookings (`playerId: null`) can never be reviewed.
- **One review per booking:** enforced by a unique index on `Review.bookingId` and by setting `Booking.reviewedAt` once, which is never cleared. A deleted review leaves `reviewedAt` set, so the booking cannot be reviewed again.
- **Windows:**
  - A review can be posted while `now <= completedAt + 30 days`.
  - The author can edit or delete it while `now <= review.createdAt + 30 days` and `moderation === 'visible'`.
  - Times are compared as `Date`s, never strings.
- **Stars and comment:**
  - Stars are whole numbers from 1 to 5.
  - The comment is trimmed and at most 1,000 characters; an empty comment is stored as `null`.
  - A reply is trimmed, required (at least 1 character) and at most 1,000 characters.
  - A flag reason is trimmed, optional and at most 500 characters.
- **Moderation:** `moderation` is `'visible' | 'hidden'`. Nothing in this plan sets `hidden`; that is Plan 18. Every public read and the aggregate filter on `moderation: 'visible'`. Owners and staff can never edit, delete or hide a player's review.
- **Public reviewer name:** first word of `user.name` + space + first letter of the last word + `.` ("Karim Hossain" → "Karim H."). A one-word name is shown as is; an empty name gives `null`, which the web shows as "Player" / «Игрок». It is derived when served and never stored.
- **Aggregate:** `average` is rounded to one decimal; it is `null` when `count` is 0.
- **"Top rated" sort:** average descending, then count descending, then name, then `_id`. Venues with no reviews come last.
- **Permission:** `review.manage` is new in `PERMISSIONS`. Owner and manager system roles get it; staff does not. System roles re-sync on start. It covers the owner Reviews page, reply and flag, scoped to the member's venues.
- **Notices:**
  - `review_request` is queued 3 hours after `completedAt`, at most once per booking. It goes to the player's verified contacts in the owner's `defaultLocale`.
  - `review_posted` goes to active members whose role has `review.manage` and who cover the venue. It fires on post only, not on edit.
  - Nothing is sent for replies.
- **API errors** use `AppError(status, code, message)`. New codes, each with en and ru strings in the web `errors` block:
  - `not_reviewable` (409)
  - `already_reviewed` (409)
  - `review_locked` (409)
  - `cannot_flag` (409)
  - `cannot_reply` (409)
- **UI:** follows `.superdesign/design-system.md`.
  - Every color, size, spacing, radius and shadow is a `var(--…)` from `apps/web/src/styles/tokens.css`, and `test/tokens.test.ts` stays green.
  - New tokens go in the light block and in both dark blocks, plus one line in the design doc.
  - Light and dark mode both work.
  - Every string exists in en and ru, and the i18n test stays green; ru never uses «поле», and a turf is «корт».
- **TDD:** each step writes the failing test first.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Commands:**
  - API test: `cd apps/api && ../../node_modules/.bin/pnpm exec vitest run <file>`
  - Web test: `cd apps/web && ../../node_modules/.bin/pnpm exec vitest run <file>`
  - Shared test: `cd packages/shared && ../../node_modules/.bin/pnpm exec vitest run <file>`
  - Whole repo, from the root: `node_modules/.bin/pnpm typecheck && node_modules/.bin/pnpm lint && node_modules/.bin/pnpm test`

## Review Focus

1. **Two posts for one booking at once** (double-click, two tabs): exactly one gets 201 and the other gets 409 `already_reviewed`. There is one review row, and the venue count goes up by 1. Pinned in Task 5.
2. **Window edges:**
   - Posting at exactly `completedAt + 30d` succeeds; 1 ms later gets 409 `not_reviewable`.
   - Editing at `createdAt + 30d` succeeds; later gets 409 `review_locked`.
   - Pinned in Task 5.
3. **Venue-scoped staff:** a manager limited to venue A gets 404 when listing (`venueId=B`), replying to or flagging a venue B review. Venue B is also missing from their summary. Pinned in Task 7.
4. **Hidden reviews:** a review set to `moderation: 'hidden'` directly in the DB is missing from the public list, the venue's average and count, and the search rating. Its author still sees it marked hidden and cannot edit it. Pinned in Tasks 3, 5 and 6.
5. **Comment edge cases:**
   - A whitespace-only comment is stored as `null`.
   - 1,001 characters gets 400.
   - 1,000 Cyrillic characters are accepted.
   - Deleting a review and posting again gets 409 `already_reviewed`.
   - Pinned in Task 5.

---

### Task 1: Shared review constants, types and the `review.manage` permission

**Files:**
- Create: `packages/shared/src/reviews.ts`, `packages/shared/test/reviews.test.ts`
- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/index.ts`
- Modify: `apps/web/src/i18n/locales/en.json`, `apps/web/src/i18n/locales/ru.json` (adds `owner.perm.review_manage`)
- Modify: `apps/web/test/owner/staff.test.tsx` (test title "all 15 permissions" → "every permission"; the assertions already loop over `PERMISSIONS`)

**Interfaces — Produces:**
```ts
export const REVIEW_WINDOW_DAYS = 30;
export const REVIEW_EDIT_DAYS = 30;
export const REVIEW_COMMENT_MAX = 1000;
export const REVIEW_REPLY_MAX = 1000;
export const REVIEW_FLAG_REASON_MAX = 500;
export const REVIEW_STARS = [1, 2, 3, 4, 5] as const;
export const REVIEW_PAGE_SIZE = 10;
export type RatingSummary = { average: number; count: number };   // only built when count > 0
export type ReviewReplyJson = { text: string; at: string; editedAt: string | null };
export type PublicReviewJson = {
  id: string; stars: number; comment: string | null; reviewer: string | null;
  createdAt: string; edited: boolean; reply: ReviewReplyJson | null;
};
export type OwnReviewJson = PublicReviewJson & { hidden: boolean; editableUntil: string | null };
export type OwnerReviewJson = PublicReviewJson & {
  venueId: string; bookingId: string; reference: string;
  flag: { at: string; reason: string | null } | null; hidden: boolean;
};
export function reviewerName(fullName: string | null | undefined): string | null;
```
- `PERMISSIONS` gains `'review.manage'` at the end.
- `SYSTEM_ROLES.manager` gets it automatically, since it is not in `MANAGER_EXCLUDED`. `staff` stays unchanged.

- [ ] **Step 1: Write failing tests** in `packages/shared/test/reviews.test.ts`
```ts
it('reviewerName shortens to first name and last initial', () => {
  expect(reviewerName('Karim Hossain')).toBe('Karim H.');
  expect(reviewerName('  Anna  Maria   Petrova ')).toBe('Anna P.');
  expect(reviewerName('Олег Иванов')).toBe('Олег И.');
  expect(reviewerName('Madonna')).toBe('Madonna');
  expect(reviewerName('   ')).toBeNull();
  expect(reviewerName(null)).toBeNull();
});
it('review.manage is an owner and manager permission, not staff', () => {
  expect(PERMISSIONS).toContain('review.manage');
  expect(SYSTEM_ROLES.owner).toContain('review.manage');
  expect(SYSTEM_ROLES.manager).toContain('review.manage');
  expect(SYSTEM_ROLES.staff).not.toContain('review.manage');
});
```
- [ ] **Step 2: Run them.** Expected: FAIL, because `reviewerName` is not exported.
- [ ] **Step 3: Implement** `reviews.ts`, export it from `index.ts`, and add the permission.
- [ ] **Step 4: Add the web permission label:**
  - en `"review_manage": "Manage reviews"`
  - ru `"review_manage": "Управление отзывами"`
  - Rename the staff test title.
- [ ] **Step 5: Run** the shared tests and `apps/web` tests `test/owner/staff.test.tsx test/i18n.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(shared): review constants, types and review.manage permission`

---

### Task 2: Booking completion time and review markers

**Files:**
- Modify: `apps/api/src/bookings/booking.model.ts`, `apps/api/src/bookings/transition.ts`, `apps/api/src/migrations/index.ts`
- Test: `apps/api/test/bookings/models.test.ts`, `apps/api/test/jobs/sweeps.test.ts`, `apps/api/test/migrations.test.ts`

**Interfaces — Produces:**
- New Booking fields, all `{ type: Date, default: null }`:
  - `completedAt`
  - `reviewedAt`: set once when a review is posted; never cleared.
  - `reviewRequestedAt`: set when the prompt sweep handles the booking.
- Index `{ status: 1, completedAt: 1, _id: 1 }`, with a comment that it is for the prompt sweep.
- `bookingJson()` adds `completedAt: string | null`.
- `transition()` adds `completedAt: at` to `$set` when `to === 'completed'`. This covers both the auto-complete sweep and the owner's manual complete without touching either caller.
- Migration `2026-10-25-booking-completed-at`: for `status: 'completed'` with no `completedAt`, set `completedAt = $endAt` with a pipeline update. Also set `reviewRequestedAt = now`, so no prompt backlog goes out on deploy. Use `{ crossTenant: true, timestamps: false }`. It returns `modifiedCount`.
  - `MigrationStep.run` currently takes no args. Change the signature to `run(now: Date)`, pass `now` from `runMigrations`, and leave the existing steps ignoring it.

- [ ] **Step 1: Failing tests:**
  - sweeps.test: "auto-complete stamps completedAt with the sweep time": after `autoCompleteBookings(now)`, `booking.completedAt` equals `now`.
  - The owner booking test where staff completes a booking gets `expect(res.body.booking.completedAt).toBe(now.toISOString())`. Add it to the existing complete test in `test/bookings/owner.test.ts`.
  - migrations.test: "backfills completedAt from endAt and marks the prompt as handled":
    - Insert a completed booking with no `completedAt`, `reviewRequestedAt` or `reviewedAt`.
    - After running, `completedAt` equals `endAt` and `reviewRequestedAt` equals `now`.
    - Calling the step's `run(now)` directly a second time returns 0 (`runMigrations` would skip it as recorded).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** as described in the Interfaces block.
- [ ] **Step 4: Run** the three test files. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): stamp completedAt on bookings and backfill it`

---

### Task 3: Review model and venue rating aggregate

**Files:**
- Create: `apps/api/src/reviews/review.model.ts`, `apps/api/src/reviews/rating.ts`, `apps/api/test/reviews/rating.test.ts`
- Modify: `apps/api/src/venues/venue.model.ts`

**Interfaces — Produces:**
- `Review` model, using the tenantScoped plugin and `timestamps: true`. Fields:
  - `ownerId`, `venueId`, `bookingId`, `playerId`: ObjectId, required.
  - `stars`: Number, 1–5, integer.
  - `comment`: String or null.
  - `editedAt`: Date or null.
  - `reply`: subdoc `{ text, by: ObjectId, at: Date, editedAt: Date|null }` or null, with `_id: false`.
  - `moderation`: `'visible'|'hidden'`, default `'visible'`.
  - `flag`: `{ by: ObjectId, at: Date, reason: String|null }` or null.
  - `flagCleared`: Boolean, default false. Plan 18 sets it on "keep".
- Review indexes:
  - `{ bookingId: 1 }` unique.
  - `{ venueId: 1, moderation: 1, _id: -1 }` for the public list.
  - `{ ownerId: 1, venueId: 1, _id: -1 }` for the owner list.
- `export type ReviewDoc`.
- Venue gains `rating: { average: { type: Number, default: null }, count: { type: Number, default: 0 } }` as a subdoc with `_id: false`.
- In `rating.ts`:
  - `export async function recomputeVenueRating(ownerId: string, venueId: string, session: ClientSession): Promise<{ average: number | null; count: number }>`: aggregates visible reviews of the venue, writes `venue.rating`, and returns it. The average is `Math.round(avg * 10) / 10`.
  - `export function ratingJson(r: { average?: number | null; count?: number } | null | undefined): RatingSummary | null`: returns null when count is 0 or missing.

- [ ] **Step 1: Failing tests** in `rating.test.ts`, inserting reviews directly:
  - "averages visible reviews to one decimal": stars 5, 4 and 4 give `{ average: 4.3, count: 3 }`, and the venue doc matches.
  - "ignores hidden reviews": add a hidden 1-star; the result is still 4.3 and 3.
  - "no reviews gives null average and zero count".
  - "a second review for the same booking is rejected by the unique index": the insert throws code 11000.
  - "ratingJson hides empty ratings": `ratingJson({ average: null, count: 0 })` is null, and `ratingJson(undefined)` is null.
- [ ] **Step 2: Run them.** Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement** the model and `rating.ts`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): review model and venue rating aggregate`

---

### Task 4: Review notices and the prompt sweep

**Files:**
- Modify: `apps/api/src/notifications/templates.ts`, `apps/api/src/notifications/outbox.ts`, `apps/api/src/jobs/sweeps.ts`, `apps/api/src/jobs/runner.ts`
- Test: `apps/api/test/notifications/templates.test.ts`, `apps/api/test/notifications/outbox.test.ts`, `apps/api/test/jobs/sweeps.test.ts`

**Interfaces — Produces:**
- `NOTICE_EVENTS` gains `'review_request'` and `'review_posted'`.
- `NoticeData` gains optional fields:
  - `ownerId?: string`
  - `stars?: number`
  - `comment?: string | null`: at most 140 characters, cut with `…` when longer.
- `noticeBooking(event, booking, now, session, extra)`: `extra` gains `stars?: number` and `comment?: string | null`.
- For `review_posted`:
  - Recipients are `staffRecipients(booking, 'review.manage', session)`, now taking the permission as a parameter; `staff_new_pending` passes `'booking.confirm'`.
  - `data.ownerId` is set.
  - `customerName` is `reviewerName(player.name)` rather than the full name.
- `renderNotice` links:
  - `review_request` → `${appUrl}/me/bookings/${d.bookingId}?review=1`
  - `review_posted` → `${appUrl}/owner/${d.ownerId}/reviews`
  - All others are unchanged.
- `isStale`:
  - `review_request` is stale when the booking's `reviewedAt` is set or its status is not `completed`.
  - It selects `status reviewedAt`.
- In `sweeps.ts`:
  - `export const REVIEW_REQUEST_DELAY_MINUTES = 180;`
  - `export async function sendReviewRequests(now: Date): Promise<number>`: sweeps on key `completedAt`; add it to `SortKey`.
  - Filter: `{ status: 'completed', playerId: { $ne: null }, reviewedAt: null, reviewRequestedAt: null, completedAt: { $lte: now − 180 min, $gt: now − 30 days } }`.
  - Each step sets `reviewRequestedAt: now` (conditional on it still being null), then calls `noticeBooking('review_request', …)`. It returns `inserted > 0`.
- `JOBS` gains `{ name: 'review-requests', everyMs: 300_000, run: (now) => sendReviewRequests(now) }`.
- Template copy (exact). In every case `renderNotice` appends the link to the SMS.

  | Event | Locale | Subject | Lead | Extra | SMS |
  |---|---|---|---|---|---|
  | `review_request` | en | `How was your game? (${ref})` | `Thanks for playing at ${venueName}. Rate the venue to help other players choose.` | none | `How was ${venueName}? Rate your game:` |
  | `review_request` | ru | `Как прошла игра? (${ref})` | `Спасибо, что играли на площадке ${venueName}. Оцените её — это поможет другим игрокам с выбором.` | none | `Как вам ${venueName}? Оцените игру:` |
  | `review_posted` | en | `New review: ${stars} of 5 (${ref})` | `${customerName ?? 'A player'} rated ${venueName} ${stars} out of 5.` | the comment in quotes, when present | `New ${stars}/5 review for ${venueName}. ${ref}` |
  | `review_posted` | ru | `Новый отзыв: ${stars} из 5 (${ref})` | `Новая оценка площадки ${venueName}: ${stars} из 5 от ${customerName ?? 'игрока'}.` | the comment in «», when present | `Новый отзыв ${stars}/5 о площадке ${venueName}. ${ref}` |

- [ ] **Step 1: Failing tests:**
  - templates.test:
    - "review_request links to the booking with the review dialog open" checks en and ru: `text` contains `/me/bookings/<id>?review=1`.
    - "review_posted links to the owner reviews page and quotes the comment": the en text contains `"Great lights"`, and the ru text contains `«Great lights»`.
  - outbox.test:
    - "review_posted goes to members with review.manage covering the venue":
      - An owner member gets the notice; a staff-role member does not.
      - A manager scoped to another venue does not.
      - The dedupe key makes a second call insert 0.
    - "review_request is dropped as stale once the booking is reviewed": queue it, set `booking.reviewedAt`, run `deliverNotifications`, and the row is `failed` / `stale`.
  - sweeps.test, "sendReviewRequests":
    - With a booking completed at `now − 179 min` → 0 queued.
    - At `now − 180 min` → queued to the player's verified email, and `reviewRequestedAt` equals `now`.
    - A second run → 0.
    - A guest booking → 0.
    - A booking with `reviewedAt` set → 0.
    - A booking completed 31 days ago → 0.
    - A player with no verified contact → 0 queued, but `reviewRequestedAt` is still set.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three files and `test/notifications/events.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): review request and new-review notices`

---

### Task 5: Player review endpoints and own-review data on bookings

**Files:**
- Create: `apps/api/src/reviews/json.ts`, `apps/api/src/reviews/schemas.ts`, `apps/api/src/reviews/routes/player.ts`, `apps/api/test/reviews/player.test.ts`
- Modify: `apps/api/src/app.ts` (mount `playerReviewsRouter(config, services)` next to `publicBookingsRouter`), `apps/api/src/bookings/playerJson.ts`

**Interfaces:**
- Consumes:
  - `Review` and `recomputeVenueRating` (Task 3).
  - `noticeBooking('review_posted', …, { stars, comment })` (Task 4).
  - `completedAt` and `reviewedAt` (Task 2).
  - The constants and `reviewerName` (Task 1).
- Produces, in `json.ts`:
  - `publicReviewJson(r: ReviewDoc, authorName: string | null | undefined): PublicReviewJson`: `edited` is `editedAt !== null`, and `reply` is mapped.
  - `ownReviewJson(r, authorName, now): OwnReviewJson`: `editableUntil` is `createdAt + 30d` while that is ≥ now and the review is visible, else null. `hidden` is `moderation === 'hidden'`.
  - `ownerReviewJson(r, authorName, reference): OwnerReviewJson`.
- `schemas.ts` (zod, strict):
  - `reviewBodySchema = { stars: int 1..5, comment?: string → trim, max 1000, '' → null }`
  - `reviewPatchSchema` = the same fields, all optional, with at least one key.
  - `replyBodySchema = { text: trim, 1..1000 }`
  - `flagBodySchema = { reason?: trim, max 500, '' → null }`
- Routes, all `requireAuth`:
  - `POST /me/bookings/:bookingId/review` returns 201 `{ review: OwnReviewJson }`.
    - In one transaction:
      1. Load the booking cross-tenant by `_id` and `playerId` = user (if none, 404 `not_found`).
      2. Status must be `completed`, `completedAt` set and `now <= completedAt + 30d`; otherwise 409 `not_reviewable`.
      3. `Booking.findOneAndUpdate({ ownerId, _id, reviewedAt: null }, { $set: { reviewedAt: now } })`; if that returns null, 409 `already_reviewed`.
      4. Create the Review.
      5. `recomputeVenueRating`.
      6. `noticeBooking('review_posted', …)`.
      7. Log activity `review.posted` as the player (actor userId).
    - A duplicate-key 11000 from the create maps to 409 `already_reviewed`.
  - `PATCH /me/bookings/:bookingId/review` returns 200 `{ review }`.
    - The review must belong to the user (else 404).
    - It must be visible and `now <= createdAt + 30d`; otherwise 409 `review_locked`.
    - Sets the fields plus `editedAt: now`, then recomputes the rating. The reply is kept. No notice is sent.
  - `DELETE /me/bookings/:bookingId/review` returns 204.
    - Same lock rule.
    - Deletes the row and recomputes the rating; `reviewedAt` stays.
- `playerBookingsJson` adds:
  - `review: OwnReviewJson | null`, from one `$in` query on `bookingId`.
  - `reviewableUntil: string | null`: `completedAt + 30d` when the status is completed, `reviewedAt` is null, `playerId` is set and that time is ≥ now; else null.
  - `PlayerBooking` type updated.

- [ ] **Step 1: Failing tests** in `player.test.ts` (seed owner, venue, turf, a player user and a completed booking with `completedAt` set):
  - "posts a review and updates the venue rating": 201, `review.stars` 4, `reviewer` 'Karim H.', and the venue rating is `{ average: 4, count: 1 }`. A `review_posted` notification row exists.
  - "rejects a booking that is not completed, a guest booking and another player's booking": a confirmed booking → 409 `not_reviewable`; another player's booking → 404.
  - "window edges": with `completedAt + 30d` exactly → 201; with `completedAt + 30d + 1ms` → 409 `not_reviewable`.
  - "two posts at once make one review": `Promise.all` of two POSTs gives statuses `[201, 409]` in either order, `Review.countDocuments()` is 1, and the venue count is 1.
  - "comment rules":
    - `'   '` → stored `null`.
    - 1,001 characters → 400 `validation_error`.
    - 1,000 × 'ж' → 201.
    - Stars 0, 6 and 4.5 → 400.
  - "edit keeps createdAt, sets edited and keeps the reply":
    - Pre-set a reply in the DB.
    - PATCH stars 2 → `edited` is true, `reply` is still present, and the venue average is 2.
    - No second `review_posted` row.
  - "edit and delete lock after 30 days": at `createdAt + 30d` PATCH → 200; later → 409 `review_locked`; DELETE later → 409.
  - "hidden review is locked and shown hidden to its author":
    - Set `moderation: 'hidden'` in the DB; PATCH → 409 `review_locked`.
    - `GET /me/bookings/:id` → `booking.review.hidden` is true and `editableUntil` is null.
  - "delete removes the review and the booking cannot be reviewed again": DELETE → 204, the venue count is 0, and POST → 409 `already_reviewed`.
  - "my bookings carry reviewableUntil and my review": before posting, `reviewableUntil` is `completedAt + 30d` ISO and `review` is null; after posting, `reviewableUntil` is null and `review.id` is set.
- [ ] **Step 2: Run them.** Expected: FAIL (404s, because the routes are missing).
- [ ] **Step 3: Implement** the JSON helpers, schemas, router and `playerJson` changes; mount the router.
- [ ] **Step 4: Run** `test/reviews/player.test.ts` and `test/bookings/playerJson.test.ts test/bookings/public.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): player review post, edit and delete`

---

### Task 6: Public reviews, venue rating and "Top rated" search

**Files:**
- Create: `apps/api/src/reviews/routes/public.ts`, `apps/api/test/reviews/public.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/venues/routes/public.ts`, `apps/api/src/search/query.ts`, `apps/api/src/search/candidates.ts`, `apps/api/src/search/routes.ts`, `packages/shared/src/search.ts`
- Test: `apps/api/test/search/*.test.ts` (the existing file that covers ordering)

**Interfaces:**
- Consumes: `ratingJson` (Task 3) and `publicReviewJson` (Task 5).
- Produces:
  - `GET /venues/:slug/reviews?before=<reviewId>&limit=<1..50, default REVIEW_PAGE_SIZE>`:
    - Uses `publicVenueBySlug`.
    - Returns visible reviews of that venue, `_id` descending.
    - Response: `{ reviews: PublicReviewJson[], nextBefore: string | null }`.
    - Reviewer names come from one `$in` on User.
  - `GET /venues/:slug` → `venue.rating: RatingSummary | null`.
  - `SearchResult.rating: RatingSummary | null` (shared type).
  - `SearchQuery.sort: 'default' | 'rating'`, from the query param `sort=rating`; any other value → 400.
  - `findCandidates` sort: for `'rating'`, `{ 'rating.average': -1, 'rating.count': -1, name: 1, _id: 1 }` (a missing or null average sorts last in descending order). Otherwise unchanged.

- [ ] **Step 1: Failing tests:**
  - public.test:
    - "lists visible reviews newest first in pages of 10 with replies": 12 reviews, one hidden.
      - Page 1 has 10 items, newest first, with `nextBefore` set.
      - Page 2 has 1 item with `nextBefore` null.
      - The hidden review appears nowhere.
      - A reply is shown as `{ text, at, editedAt }`.
      - No reviewer contact fields are present.
    - "unpublished venue reviews 404".
    - "venue page carries rating, null without reviews".
  - search test:
    - "sort=rating orders by average, then count, then name, unrated last": venues with A 4.5/2, B 4.5/10, C 5.0/1, D unrated, giving order C, B, A, D.
    - The result `rating` for D is null.
    - `sort=stars` → 400.
    - "hidden reviews do not count in search rating": recompute after hiding, and the result rating drops.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file and the search tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): public reviews, venue rating and top-rated search`

---

### Task 7: Owner review endpoints

**Files:**
- Create: `apps/api/src/reviews/routes/owner.ts`, `apps/api/test/reviews/owner.test.ts`
- Modify: `apps/api/src/tenancy/routes/owner.ts` (`router.use(ownerReviewsRouter(services))`)

**Interfaces:**
- Consumes:
  - `requirePermission`, `tenantOf` and `tenantRepo(Review, t, { venueField: 'venueId' })`.
  - `logActivity` and `ownerReviewJson`.
  - `replyBodySchema` and `flagBodySchema`.
- Produces, all behind `requirePermission('review.manage')`:
  - `GET /reviews?venueId=&stars=1..5&before=&limit=1..100 (default 20)`:
    - Returns `{ reviews: OwnerReviewJson[], nextBefore, summary: { venueId, name, rating: RatingSummary | null }[] }`.
    - `summary` lists every venue in the member's scope.
    - It includes hidden reviews, marked with `hidden: true`.
    - A `venueId` outside the member's scope → 404 `not_found`.
  - `PUT /reviews/:reviewId/reply { text }`:
    - Creates the reply (`at = now`) or edits it (sets `editedAt = now`).
    - A hidden review → 409 `cannot_reply`.
    - Logs `review.replied`.
    - Returns `{ review }`.
  - `DELETE /reviews/:reviewId/reply`: 204, logs `review.reply_deleted`.
  - `POST /reviews/:reviewId/flag { reason? }`:
    - If a flag is already open, returns the review unchanged.
    - `flagCleared` or a hidden review → 409 `cannot_flag`.
    - Logs `review.flagged`.
    - Returns `{ review }`.
  - None of these routes change `stars`, `comment` or `moderation`, and none deletes a review.

- [ ] **Step 1: Failing tests** in `owner.test.ts`:
  - "owner lists reviews with filters and a per-venue summary": `stars=5` filter, `venueId` filter, `nextBefore` paging, and summary averages.
  - "staff role without review.manage gets 403".
  - "a manager scoped to venue A cannot see or act on venue B": list with `venueId=B` → 404; the summary lacks B; reply/flag on a B review → 404.
  - "reply create, edit, delete":
    - PUT → `reply.text` is set and `editedAt` is null.
    - A second PUT → `editedAt` is set.
    - DELETE → `reply` is null.
    - 1,001 characters → 400.
    - Blank → 400.
  - "flag is idempotent and leaves the review public": two POSTs → same `flag.at`; the public list still shows the review.
  - "cannot flag a kept review" (`flagCleared: true` in the DB) → 409 `cannot_flag`.
  - "owner endpoints cannot change stars or delete a review": a PATCH or DELETE on `/reviews/:id` → 404 (no such route).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** and mount the router.
- [ ] **Step 4: Run** the file and then the whole API suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): owner review list, reply and flag`

---

### Task 8: Web star components and tokens

**Files:**
- Create: `apps/web/src/components/ui/Stars.tsx`, `apps/web/src/components/ui/Stars.module.css`, `apps/web/src/components/ui/StarInput.tsx`, `apps/web/src/components/ui/StarInput.module.css`, `apps/web/test/ui/stars.test.tsx`
- Modify: `apps/web/src/styles/tokens.css`, `.superdesign/design-system.md`, both locale files

**Interfaces — Produces:**
- `Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'md' })`:
  - Five glyphs filled to the nearest half.
  - Wrapped in `role="img"` with `aria-label={t('reviews.starsLabel', { value })}`: en "{{value}} out of 5", ru "{{value}} из 5".
- `StarInput({ value, onChange, name, legend }: { value: number | null; onChange(v: number): void; name: string; legend: string })`:
  - A `<fieldset>` with a `<legend>` and five native radio inputs, labelled `t('reviews.starOption', { count: n })`. en: "1 star" / "{{count}} stars"; ru plural forms: "{{count}} звезда/звезды/звёзд".
  - The star is drawn in the label.
  - Arrow keys work natively.
- New tokens, in the light block and both dark blocks:
  - `--star-filled`: light `#f59e0b`, dark `#fbbf24`.
  - `--star-empty`: `var(--border-strong)`.
  - `--star-size-sm: 1rem`
  - `--star-size-md: 1.5rem`
  - The input's hit area uses the existing `--control-md`.
- Design doc: a new "Ratings" line under Components, covering the star colours and sizes, that the average shows as stars plus the number, and that input stars are radios with a 36px hit area.

- [ ] **Step 1: Failing tests:**
  - "Stars announces its value": `getByRole('img', { name: '4.5 out of 5' })`.
  - "StarInput is a radio group that reports the chosen value": clicking "4 stars" calls `onChange(4)`; the checked radio follows `value`.
  - "StarInput labels read in Russian": switch to ru, and the label `'5 звёзд'` exists.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the components, tokens, doc line and strings.
- [ ] **Step 4: Run** `test/ui/stars.test.tsx test/tokens.test.ts test/i18n.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): star display and star input components`

---

### Task 9: Web player — review a booking

**Files:**
- Create: `apps/web/src/bookings/ReviewDialog.tsx`, `apps/web/src/bookings/ReviewDialog.module.css`, `apps/web/src/bookings/MyReview.tsx`, `apps/web/test/bookings/review.test.tsx`
- Modify: `apps/web/src/lib/types.ts` (`BookingJson` gains `completedAt`, `review: OwnReviewJson | null` and `reviewableUntil: string | null`), `apps/web/src/bookings/BookingDetailPage.tsx`, `apps/web/src/bookings/BookingRow.tsx`, both locale files (`reviews.*`, and the errors `not_reviewable`, `already_reviewed`, `review_locked`, `cannot_flag`, `cannot_reply`)

**Interfaces:**
- Consumes:
  - `StarInput` and `Stars` (Task 8).
  - API `POST`/`PATCH`/`DELETE /me/bookings/:id/review` (Task 5).
- Behaviour:
  - **Booking detail page:**
    - When `reviewableUntil` is set, it shows a primary button "Rate your game" / «Оценить игру».
    - When `review` is set, it shows `MyReview`: stars, comment, "edited" mark, the owner's reply, and a "Hidden by moderators" / «Скрыт модератором» badge when hidden. While `editableUntil` is set, it also shows Edit (secondary) and Delete (secondary, asks for confirmation).
  - **`?review=1`:** the dialog opens on load when the booking is reviewable.
  - **ReviewDialog:**
    - `StarInput`, plus a `Textarea` (comment, optional) with a live count "{{n}}/1000".
    - Submit is disabled until stars are chosen.
    - Posting or patching updates the page state from the response.
    - API errors are shown in the dialog with `errorMessage`.
  - **`BookingRow`:** the row is a `Link`, so it cannot hold a button. When `reviewableUntil` is set, it shows a muted text cue "Rate your game" with a star; when `review` is set, it shows `<Stars value={review.stars} />`.

- [ ] **Step 1: Failing tests** in `review.test.tsx`, using `mockApi` with `/me/bookings/b1` returning a completed booking:
  - "rate your game posts stars and comment": open the dialog, choose "4 stars", type "Nice", and submit. The POST body is `{ stars: 4, comment: 'Nice' }`. The page then shows `Stars` 4 and "Nice".
  - "?review=1 opens the dialog".
  - "no rate button outside the window": with `reviewableUntil: null` and `review: null`, there is no button.
  - "edit and delete while editable; locked review has neither":
    - `editableUntil` set → Edit and Delete exist.
    - Delete asks for confirmation, then sends DELETE.
    - With `editableUntil: null`, neither exists.
  - "hidden review shows the moderation badge".
  - "already_reviewed is shown translated in ru".
  - "my bookings row shows the rate cue or my stars".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new file and `test/bookings/*.test.tsx test/i18n.test.ts test/tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): players rate, edit and delete their review`

---

### Task 10: Web public — venue reviews, search card rating, "Top rated" sort

**Files:**
- Create: `apps/web/src/venue/ReviewsSection.tsx`, `apps/web/src/venue/ReviewsSection.module.css`, `apps/web/test/venue/reviews.test.tsx`
- Modify: `apps/web/src/venue/VenuePage.tsx` (render `ReviewsSection` after `SlotsPanel`; the venue type gains `rating`), `apps/web/src/search/ResultCard.tsx` and `.module.css`, `apps/web/src/search/searchParams.ts` (`Criteria.sort: 'default' | 'rating'`, URL param `sort=rating`), `apps/web/src/search/SearchForm.tsx`, both locale files
- Test: `apps/web/test/search/*.test.tsx` (existing files for the card, form and params)

**Interfaces:**
- Consumes: `GET /venues/:slug/reviews` and `rating` on the venue and search results (Task 6); `Stars` (Task 8).
- Behaviour:
  - **ReviewsSection:**
    - An `h2` "Reviews" / «Отзывы».
    - A summary: `Stars` (md) + average formatted with one decimal for the locale + "{{count}} reviews" (ru plural forms).
    - With no reviews, "No reviews yet" / «Пока нет отзывов».
    - The list: each item has `Stars`, the reviewer (null → "Player" / «Игрок»), a date (`formatDate` in the venue tz), the comment, "edited" / «изменён», and the owner reply in a subtle block labelled "Reply from the venue" / «Ответ площадки».
    - A "Show more" secondary button fetches `?before=nextBefore`.
  - **ResultCard:** when `r.rating` is set, shows `★ 4.6 (23)`, with `aria-label` from `reviews.cardLabel` ("Rated {{value}} out of 5 from {{count}} reviews", with plurals); otherwise nothing.
  - **SearchForm:** a `Select` "Sort" / «Сортировка» with the options "Recommended" / «По умолчанию» (value `default`) and "Top rated" / «С высоким рейтингом» (`rating`). Only `rating` is written to the URL.

- [ ] **Step 1: Failing tests:**
  - "venue page shows average, count and reviews with replies".
  - "show more loads the next page".
  - "no reviews yet".
  - "null reviewer shows Player".
  - "result card shows rating only when rated".
  - "top rated sort writes sort=rating and the API call carries it".
  - "searchParams round-trips sort and drops unknown values".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `test/venue test/search test/i18n.test.ts test/tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): venue reviews, card rating and top-rated sort`

---

### Task 11: Web owner — Reviews page

**Files:**
- Create: `apps/web/src/owner/reviews/ReviewsPage.tsx`, `apps/web/src/owner/reviews/ReplyForm.tsx`, `apps/web/src/owner/reviews/FlagDialog.tsx`, `apps/web/src/owner/reviews/reviews.module.css`, `apps/web/test/owner/reviews.test.tsx`
- Modify: `apps/web/src/owner/shell/nav.ts` (insert `{ to: 'reviews', key: 'owner.nav.reviews', perms: ['review.manage'] }` before `activity`), `apps/web/src/owner/ownerRoutes.tsx` (`<Route path="reviews" element={<Guarded nav="reviews"><ReviewsPage /></Guarded>} />`), `apps/web/src/owner/types.ts`, both locale files (`owner.nav.reviews`, `owner.reviews.*`), `apps/web/test/owner/fixtures.ts` (an `ownerReview()` factory)

**Interfaces:**
- Consumes: the Task 7 endpoints; `useResource`, `apiPut`, `apiPost` and `apiDelete`; `Stars`; the existing `VenueSelect` or `Select`; `Badge`; `Dialog`; `Textarea`.
- Behaviour:
  - **Page title:** "Reviews" / «Отзывы».
  - **Summary:** cards per venue (name, `Stars`, average, count, or "No reviews yet").
  - **Filters:** venue (all + the member's venues) and stars (all, 5…1), both in the URL query.
  - **List items:**
    - Stars, reviewer, date, venue name, a booking reference linked to `bookings/:bookingId` when the member can `booking.view`, the comment and the "edited" mark.
    - A "Flagged — awaiting review" / «Отмечен — ждёт проверки» warning `Badge` when `flag` is set.
    - A "Hidden" / «Скрыт» neutral badge when `hidden`.
  - **Reply:** "Reply" opens an inline `ReplyForm` (`Textarea`, counter /1000, Save/Cancel). An existing reply shows with Edit and Delete (secondary; Delete asks for confirmation). The reply is not offered on hidden reviews.
  - **Flag:** "Flag" (secondary) opens `FlagDialog` with an optional reason (/500) and the explanation "The review stays visible until the platform team checks it." / «Отзыв останется виден, пока его не проверит команда платформы». Flag is not offered when already flagged, hidden or `flagCleared`. The API error `cannot_flag` is shown translated.
  - **"Show more":** pages with `nextBefore`.
  - The `nav.ts` comment stays true: the route is guarded by the same perms.

- [ ] **Step 1: Failing tests** in `reviews.test.tsx`:
  - "nav shows Reviews only with review.manage".
  - "lists reviews with summary and filters; stars filter refetches with stars=5".
  - "reply create sends PUT with text and shows it; edit and delete work".
  - "flag sends POST with reason and shows the flagged badge; no flag button on a flagged review".
  - "hidden review has no reply or flag actions".
  - "renders in Russian": in ru, the page title, the flagged badge and the reply counter show the ru strings. Fit is checked by CSS, not jsdom: badges and action rows use `flex-wrap: wrap` with no `white-space: nowrap` or `text-overflow`, which the reviewer confirms in the diff.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `test/owner test/i18n.test.ts test/tokens.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the whole repo:** `node_modules/.bin/pnpm typecheck && node_modules/.bin/pnpm lint && node_modules/.bin/pnpm test`. Expected: all green.
- [ ] **Step 6: Commit** `feat(web): owner reviews page with reply and flag`

---

## Notes for the executor

- **Spec rulings already made:**
  - The prompt link opens the booking detail page `/me/bookings/:id?review=1`, which is part of My bookings, rather than the list, because each list row is a link and cannot hold a dialog button. The row shows a cue instead.
  - `cannot_reply` is added for hidden reviews, which the spec's moderation section implies.
- **Hidden reviews:** nothing in this plan creates one. Tests set `moderation: 'hidden'` directly in the DB, so Plan 18 can add hide/keep without touching these reads.
