# Reviews & Ratings — Design

Plan 14 of the roadmap (`docs/superpowers/plans/2026-10-23-roadmap.md`, Phase 2). Extends the main spec `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md`, which lists "Reviews and ratings" and a `reviews` collection for Phase 2 and says nothing more.

## Intent

Players who have actually played at a venue rate it, so other players can choose venues with confidence and owners hear how they are doing. Trust matters more than volume: a review must come from a real, finished game, and an owner must not be able to bury a bad review.

## Goals

- Signed-in players review a venue after a completed booking: 1–5 stars plus an optional comment.
- Venues show an average rating and a count on the venue page and on search result cards; search can sort by rating.
- Owners reply publicly and can flag a review for platform moderation.
- Players are asked to review after their game; staff hear about new reviews.

## Non-goals

- Guest (signed-out) reviews.
- Court-level or per-aspect ratings (surface, staff, facilities).
- Threaded conversations; notifying players of owner replies.
- Admin hide/keep of flagged reviews, the platform-scope guard and the Super Admin moderation screen (all Plan 18). This plan stores flags so Plan 18 can act on them.
- Photos in reviews, helpful votes, review search.

## Anti-goals (would make this a failure even if it works)

- An owner or staff member can hide, delete or edit a player's review.
- A review exists without a completed booking behind it, or one booking yields more than one review.
- The rating shown to players counts hidden reviews.
- The reviewer's full name or contact details are shown publicly.

## Decided by the user

| Topic | Decision |
|---|---|
| Who reviews | Signed-in players only, one review per **completed** booking they own. Guest bookings cannot be reviewed. |
| What is rated | The venue: 1–5 whole stars plus an optional text comment. |
| Review window | A review can be posted up to **30 days after the booking completed**. |
| Player edits | The author can edit or delete their review for **30 days after posting**; then it is locked. |
| Owner reply | One public reply per review, posted by staff with the review permission; editable and deletable by them. |
| Flagging | Staff can flag a review. A flagged review **stays visible** until a platform admin hides it or keeps it. |
| Display | Venue page: average, count, newest-first paged list with owner replies. Search result cards: average and count. Search gets a "Top rated" sort. |
| Notifications | Player is asked to review a few hours after the booking completes (email/SMS via existing jobs + outbox). Staff with the review permission are told when a review is posted. No notice for owner replies. |

## Calls made by Claude (change any)

- **Comment length:** optional, at most 1,000 characters after trimming; an empty string is stored as no comment. Reply: required, at most 1,000 characters.
- **Permission:** new `review.manage` added to `PERMISSIONS` in `packages/shared/src/permissions.ts`. Owner and manager system roles get it; staff does not. System roles are re-synced from `SYSTEM_ROLES` on start (`tenancy/role.model.ts`), so no migration is needed for them; custom roles get it only when an owner grants it. It covers reading the owner Reviews page, replying and flagging. Venue scoping follows the existing membership venue rules.
- **Public reviewer name:** first name plus last initial ("Karim H."), derived when serving, never stored as a copy. A user with a one-word name shows that word.
- **Edits of a review** keep the original `createdAt`, set `editedAt`, and show "edited" publicly. If a review's stars or text change after the owner replied, the reply stays.
- **A player deleting their review** removes it fully (with any reply and flag). The booking can then not be reviewed again.
- **Aggregate:** each venue stores `rating: { average, count }`, counting only visible reviews, recomputed from the reviews collection inside the same transaction as any change (post, edit, delete; Plan 18 adds hide/keep). Average is stored to one decimal place for display; sorting uses the stored value. Venues with no reviews have `count: 0` and no average, and show "No reviews yet".
- **"Top rated" sort:** by average descending, then count descending, then name. Venues with no reviews come last. It sits next to the existing name / distance sorts and keeps all existing filters.
- **Moderation (decided by the user: admin side deferred to Plan 18):** Plan 14 stores a `moderation` state on each review, always `visible` for now, plus flag data: who flagged it, when, and an optional reason (at most 500 characters). Flagging again while a flag is open does nothing. Public lists and the aggregate already exclude anything not `visible`, so Plan 18 only has to add hide/keep and its guard. Plan 18's rules: "keep" clears the flag and the review cannot be flagged again; "hide" removes it from public lists and the aggregate; the author still sees their hidden review, marked hidden, and cannot edit it.
- **Review prompt timing:** sent 3 hours after the booking completes, only if the player has not already reviewed and the window is still open; at most once per booking (outbox dedupe key). Uses the owner's default locale, like every other notice (users have no locale field today), and the existing channels. The link opens My bookings with the review dialog open for that booking; a signed-out player signs in first and lands there.
- **New-review notice:** to members with `review.manage` covering that venue, through the existing outbox (same pattern as `staff_new_pending`), with the stars and the start of the comment.
- **Player UI:** "Rate your game" button on past completed bookings in My bookings while the window is open; the form is a dialog with five star buttons (radio group, keyboard accessible) and a textarea. After posting, the booking shows the player's stars with Edit/Delete while editable.
- **Owner UI:** a "Reviews" item in the owner sidebar (shown with `review.manage`): average and count per venue at the top, a list filterable by venue and by stars, each with reply (inline form) and flag (dialog with optional reason). Flagged reviews show a "Flagged — awaiting review" badge.
- **Public UI:** the venue page gets a Reviews section under the slot grid: average shown as stars plus number, count, then 10 reviews per page, newest first, each with stars, reviewer name, date, comment, "edited" mark and the owner's reply. Search cards show "★ 4.6 (23)" or nothing when there are no reviews.
- **Notices use the existing outbox:** two new events (`review_request`, `review_posted`) in `NOTICE_EVENTS` with EN and RU templates, keyed by the review's booking like the other events. `review_posted` fires once when a review is posted, not on edits.
- **Completion time:** a new `completedAt` on bookings, set wherever a booking moves to `completed` (auto-complete sweep and manual completion). A migration backfills existing completed bookings from `endAt`, so games from the last 30 days can still be reviewed. The 3-hour prompt is a new sweep that finds bookings with `completedAt` at least 3 hours ago, no review and no prompt sent yet.
- **Review records** carry `ownerId`, `venueId` and the player's user id, so public reads and owner scoping need no joins through bookings. Aggregate updates use the transactions the API already runs on its replica set. "Top rated" uses the search's existing offset cursor.
- **Staff venue scope:** a member who covers only some venues sees, replies to and flags only those venues' reviews, and the per-venue summary shows only those venues.
- **Moderation edge cases:** a flagged (still visible) review can still be edited by its author and the flag stays open. For Plan 18: hidden reviews cannot be replied to or flagged, hide and keep are final (no un-hide), and neither notifies the author.
- **Removed venues or players:** an inactive venue keeps its reviews and aggregate; it is not public anyway. There is no account deletion today, so nothing is designed for it here.
- **Rate limits:** posting and editing reviews and replies go through the API's normal write limits; no extra limiter.

## Constraints

- Follow the existing stack and patterns: Express + Mongoose + zod in `apps/api`, shared types/schemas in `packages/shared`, React + CSS Modules + react-i18next in `apps/web`.
- UI follows `.superdesign/design-system.md` and tokens in `apps/web/src/styles/tokens.css`; add tokens and design-doc lines for anything new (star size and star colour). Light and dark mode; every string in English and Russian, fitting Russian lengths.
- Booking state: a booking is reviewable only in status `completed`. The completion time comes from the booking's transition record (the auto-complete sweep in `apps/api/src/jobs/sweeps.ts` or a manual completion). The builder confirms where that timestamp lives and adds a `completedAt` field if none exists.
- Multi-tenant: every owner endpoint is scoped by owner and venue membership as in Plans 03 and 13.
- Uniqueness of one review per booking is enforced by a unique index, not only by a check.
- Times are compared as instants, not strings.
- TDD throughout; API, shared and web suites stay green.

## Left to the builder

- Collection and field names beyond those above, index choices, route paths (following existing `/api/v1` conventions for public, player, owner).
- Pagination mechanics (match existing list endpoints).
- Exact copy wording, within the design system's voice.
