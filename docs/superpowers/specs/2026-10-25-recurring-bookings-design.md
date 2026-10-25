# Recurring Bookings — Design

Plan 17 of the roadmap (`docs/superpowers/plans/2026-10-23-roadmap.md`, Phase 2). Extends the main spec `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md`, which lists "Recurring bookings (e.g. every Friday 8pm for 4 weeks)" and a `recurringSeries` collection for Phase 2.

## Intent

Clubs, teams and regular groups play at the same court and time every week. Today staff re-book them game by game. A series lets the owner book all of those weeks in one go, and lets a registered regular ask for it themselves, while every game still behaves like a normal booking on the schedule, at the desk and in My bookings.

## Goals

- Owners/staff create a weekly series for a player or a named group, booking all free dates at once.
- Registered players request a series from the venue page; the owner accepts or declines.
- Before saving, every date is shown as free or clashing; free dates are booked, clashing dates are skipped.
- Cancel one game or every future game of a series.

## Non-goals

- Online payment for series (no Stripe, no advance). Games are paid at the desk.
- Add-ons on a series. Staff may still add extras to a single game the normal way.
- Guest (signed-out) series requests.
- Editing a series' day, time or court after creation (cancel future games and create a new series instead).
- Open-ended series, non-weekly patterns (every other week, monthly), coupons on series (Plan 15 is not built).

## Anti-goals (would make this a failure even if it works)

- Two bookings for the same slot: a series game and another booking on the same court and time.
- A series silently missing dates: every skipped date must be visible to whoever created or requested it.
- A player request holding court time indefinitely.
- Cancelling "all future" games touching games already played.

## Decided by the user

| Topic | Decision |
|---|---|
| Who creates | Owner/staff set up series directly. Registered players can send a series request; the owner accepts or declines. Guests cannot. |
| Payment | Per game at the desk. Each game is confirmed with nothing to pay online; staff mark each game paid (cash / payment link) as with walk-ins today. |
| Clashes | Show every date as free or clashing before saving; book the free ones, skip the clashing ones and show them as skipped. |
| Length | Weekly on one or more chosen weekdays, same court and time, ending on an end date or after a number of games, at most 26 weeks ahead. |
| Cancelling | Owner or the series' player can cancel one game or all future games. Past games stay. |
| Request hold | While a player's request waits, its free dates show as Pending to others; auto-declined if unanswered after 48 hours or 2 hours before its first game, whichever comes first. |
| Add-ons | None in series. |
| Bulk cancel vs cutoff | A player's "cancel all future" cancels the games their cancellation rules allow; games inside the venue's no-cancel cutoff stay booked and are listed back as "could not cancel". Owner/staff can always cancel every future game. |
| Cancel notices | One summary notice per cancel action (one game or all future) to the other side — the player when the venue cancelled, staff when the player cancelled — listing the cancelled dates. Never one notice per game. |

## Calls made by Claude (change any)

- **Each game is an ordinary booking** in `bookings`, with a `seriesId` linking it to a `recurringSeries` record and `source` unchanged in meaning (`walkin` for owner-created, `online` for player requests). Slot locking, the schedule, reminders, auto-complete, check-in, cash marking and reviews all work per game with no special cases. A series game is reviewable like any completed booking.
- **Series record** holds owner, venue, turf, player (or a guest name + phone for owner-created series for unregistered groups, like walk-ins), weekdays, start time, duration (slot count), first date, end date or game count, status (`requested`, `active`, `declined`, `cancelled`, `ended`), who created it, and the list of skipped dates with reasons.
- **Time and duration:** one or more consecutive slots, as in a normal booking, on the venue's slot grid; dates are business dates in the venue's timezone (past-midnight hours follow the existing business-day rule).
- **Price:** each game is priced by the normal pricing rules for its own date (weekend, date and time rules apply), computed when the series is created and stored on each booking like any booking. Later price changes do not touch existing games.
- **Length rules:** the first date is today or later (business date in the venue timezone). The series gives exactly one of an end date or a game count. Every game must start within 26 weeks (182 days) of today; a request reaching further is rejected with a validation error, not clipped. Game count is capped at 100.
- **Booking window:** a series may reach up to 26 weeks ahead even when the venue's `bookingWindowDays` is shorter. Normal single bookings keep the window.
- **Clash reasons:** already booked or pending, blocked or closed by an override/closure, outside opening hours, or in the past. A preview endpoint returns each date with `free` or its clash reason and price; creating re-checks inside the transaction, so a date taken between preview and save becomes skipped, not an error. If no date is free, nothing is created and the user is told.
- **Atomicity:** all games of a series (or request) are created in one transaction with their slot locks; a lock conflict on a date marks that date skipped and the rest still book (retry the transaction without it).
- **Player requests:** games are created as `pending` (holding their slots, shown as Pending as today). Accepting confirms all still-pending games of the request in one step; declining or auto-declining rejects them. While a request waits, the per-booking confirm and reject actions are refused for its games (the request is answered as a whole); the existing single-booking pending auto-reject sweep skips series games. "First game" for the deadline means the earliest game actually booked (skipped dates don't count). The 48-hour / 2-hours-before-first-game deadline is fixed for series requests, separate from the venue's `pendingAutoRejectHours` for single bookings. A player may withdraw their own request while it waits. A player may have at most 3 open requests at a time.
- **Accepting** only confirms; the owner cannot change dates on accept. To change, decline and ask the player to request again (or create a series directly).
- **Permissions:** creating a series, and accepting/declining requests, use the existing `booking.create` and `booking.confirm` permissions; cancelling games uses `booking.cancel`. Venue scoping follows membership venue rules. No new permission key.
- **Cancelling:** "this game" cancels one booking through the existing cancel flow (refund rules apply only if money was taken). "All future" cancels every game of the series whose start is after now, each through the same flow. Games already started or finished are untouched. A player cancelling their own games follows the venue's normal player cancellation rules per game (games inside the cutoff stay, see the user's decision above). Cancelling a single game of a waiting request is not offered; the player withdraws the whole request, the owner declines it.
- **Series status:** `requested` → `active` (accepted) / `declined` (owner or auto-decline) / `withdrawn` (player). An active or owner-created series is `active` while it has future games; it becomes `cancelled` when an "all future" cancel leaves no future games, and `ended` when its last game has passed. A series whose kept games (inside the cutoff) remain stays `active` until they pass, then `ended`.
- **Existing paths:** series games use the normal statuses with `advanceRequired: 0` and no payment hold, so payment, hold expiry and checkout paths must treat them like a no-advance booking; the builder verifies each existing path (payment, hold expiry, pending auto-reject, player cancel, walk-in cash marking) against an `online` and a `walkin` series game and adds guards where one would misbehave.
- **Notifications** (existing outbox, EN + RU templates): `series_requested` to staff who can confirm bookings at that venue; `series_accepted` and `series_declined` (including auto-decline) to the player, with the booked and skipped dates. Owner-created series send the player one `series_created` notice listing booked and skipped dates (if the player has contact details). Cancels send one `series_games_cancelled` summary per action (see the user's decision); the per-booking cancel notice is not sent for series games. Per-game reminders work as today. No per-game "booking confirmed" notice for series games.
- **Owner UI:**
  - "New series" from the schedule/bookings area: pick court, weekdays, time and length, the player (search existing players) or a group name + phone, an end date or number of games. A preview list shows each date as free (with price) or clashing (with reason) before saving.
  - A "Series" list (filter by venue and status) with each series' games, skipped dates and actions: cancel one game, cancel all future, and for requests accept / decline.
  - Games on the schedule and in bookings lists carry a small "Series" badge linking to the series.
- **Player UI:**
  - On the venue page, signed-in players get "Request weekly booking" next to normal booking: the same pick-court/time/weekdays/length form and the same free/clash preview, then "Send request".
  - My bookings shows series requests (waiting / accepted / declined) and series games grouped under their series, with cancel one game / cancel all future.
- **Limits:** at most 26 weeks and at most 100 games per series (several weekdays per week can add up).
- **Activity log** records series created, request accepted/declined/withdrawn, and series cancelled.

## Constraints

- Follow the existing stack and patterns: Express + Mongoose + zod in `apps/api`, shared types/schemas in `packages/shared`, React + CSS Modules + react-i18next in `apps/web`.
- Slot uniqueness stays enforced by `slotLocks` (unique `{turfId, startAt}`) inside a transaction; two concurrent series or a series and a single booking for the same slot never both win.
- Multi-tenant: every owner endpoint is scoped by owner and venue membership as in Plans 03 and 13.
- Times are compared as instants; weekdays and dates are computed in the venue's timezone, including across DST changes.
- UI follows `.superdesign/design-system.md` and tokens in `apps/web/src/styles/tokens.css`; light and dark mode; every string in English and Russian, fitting Russian lengths.
- TDD throughout; API, shared and web suites stay green.

## Left to the builder

- Collection field names beyond those above, indexes, route paths (following `/api/v1` conventions for player and owner).
- How the auto-decline runs (a sweep in the existing jobs, like pending auto-reject).
- Exact copy wording, within the design system's voice.
- Pagination of the series list (match existing list endpoints).
