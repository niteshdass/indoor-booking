# Part A — Today You Can Act From: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners and staff run the day from the Today page: it refreshes itself, every booking block and free gap on the timeline is tappable, every "Coming up" row and Attention row has the next action inline, and money still owed is marked without implying anything was paid.

**Architecture:** Web-only (no API changes). A shared `usePoll` hook drives silent refetches; `useResource` gains a keep-data-on-error mode. Booking actions and their dialogs move out of `BookingActions` into one hook (`useBookingActions`) that the booking page, a new `BookingSheet`, the Coming-up rows and Attention rows all use. Timeline logic stays pure in `CourtTimeline.tsx` (`buildLanes`, new `freeGaps`) so it stays unit-testable.

**Tech Stack:** React 19 + react-router, react-i18next (en/ru), CSS modules on `apps/web/src/styles/tokens.css`, vitest + Testing Library (`apps/web/test`).

**Spec:** `docs/superpowers/specs/2026-10-29-local-payments-guest-pay-today-actions-design.md` (Part A). Parts B, C, D get their own plans after this one ships.

## Global Constraints

- UI follows `.superdesign/design-system.md`; every colour, size, space, radius, shadow is a `var(--…)` from `apps/web/src/styles/tokens.css`. Missing token → add it there and to the design doc.
- Light and dark mode; Russian strings fit; 390px wide; 44px touch targets; WCAG 2.2 AA; status never by colour alone.
- Every new string in both `apps/web/src/i18n/locales/en.json` and `ru.json`. Copy plain, sentence case.
- Permissions exactly as `availableActions()` (`apps/web/src/owner/bookings/availableActions.ts`) decides them.
- Anti-goal: no colour or label may say "paid" for money not received.
- Run web tests with `pnpm --filter web test -- <file>`; full suite `pnpm -r test` before the last commit.

## Review Focus

1. **A refetch lands while a dialog or the sheet is open** — the open booking must update in place (or stay as is), never close the dialog or lose typed input. Test in Task 4.
2. **A booking in the sheet changes status under the user (409)** — sheet reloads that booking and shows the new actions, no stale buttons. Test in Task 4.
3. **Free gap partly in the past or overlapping a held (`pending` slot status) booking** — only future `available` slots form gaps; a gap never starts before now. Test in Task 3.
4. **Member with only `booking.view`** — no gap buttons, no action buttons, no Actions column, sheet shows facts only. Tests in Tasks 3, 4, 5.
5. **Poll failure after a good load** — data stays, toolbar says "Couldn't refresh · Retry", no page-level error. Test in Task 1.

---

### Task 1: Silent live refresh

**Files:**
- Create: `apps/web/src/owner/usePoll.ts`
- Modify: `apps/web/src/owner/useResource.ts`, `apps/web/src/owner/schedule/SchedulePage.tsx:52-61`, `apps/web/src/owner/today/TodayPage.tsx`, `TodayPage.module.css`, en/ru locales
- Test: `apps/web/test/owner/usePoll.test.ts`, `apps/web/test/owner/today.test.tsx`

**Interfaces:**
- Produces: `usePoll(tick: () => void, ms = 60_000): void` — calls `tick` every `ms` while `document.visibilityState !== 'hidden'`, and once on `visibilitychange` to visible and on `online`.
- Produces: `useResource<T>(path, opts?: { keepOnError?: boolean })` additionally returns `updatedAt: number | null` (ms of last successful load) and `refreshError: unknown` (set when a reload fails while `keepOnError` and data exist; cleared on next success). Without `keepOnError` behaviour is unchanged.
- Produces: `useNewIds(ids: string[]): ReadonlySet<string>` in `usePoll.ts` — ids not present in the previous call's list; empty on the first call.

- [ ] **Step 1: Write failing tests**

`usePoll.test.ts` (fake timers, `renderHook`):
- `usePoll ticks every interval while visible` — advance 60_000 twice → tick called 2×.
- `usePoll skips ticks while hidden and ticks on becoming visible` — stub `visibilityState` 'hidden', advance 60_000 → 0 calls; set 'visible', dispatch `visibilitychange` → 1 call.
- `usePoll ticks when the browser comes back online` — dispatch `online` → 1 call.
- `useNewIds marks only ids missing from the previous list` — rerender `['a']` → `['a','b']` gives `Set{'b'}`; first render gives empty set.

`today.test.tsx`:
- `Today refetches silently and shows the update time` — after load, advance 60s with the bookings mock returning one more booking: no skeleton shown in between, new row present, toolbar text matches `/Updated \d{2}:\d{2}/`.
- `Today keeps its data and offers retry when a refresh fails` — second bookings GET → 500: first row still on screen, `Couldn't refresh` text and a `Retry` button; clicking Retry with a 200 mock clears it.

- [ ] **Step 2: Run** `pnpm --filter web test -- usePoll today` → FAIL (module not found / text not found).

- [ ] **Step 3: Implement** `usePoll`, `useNewIds`, the `useResource` option, then wire them: SchedulePage replaces its `setInterval` effect with `usePoll(() => { setNow(Date.now()); reload(); })` (drop `REFRESH_MS`). TodayVenue uses `useResource(path, { keepOnError: true })` + `usePoll(reload)`; the toolbar status line sits under the date (`--text-xs`, `--text-muted`, `aria-live="polite"`). Upcoming rows and timeline blocks whose id is in `useNewIds(bookings.map(b => b.id))` get a `.fresh` class: `--primary-soft` background fading out over `--duration-slow` (add token if missing); under `prefers-reduced-motion: reduce` no transition, just the class for that cycle.

New keys under `owner.today`: `updated: "Updated {{time}}"`, `refreshFailed: "Couldn't refresh"`; reuse `auth.retry`.

- [ ] **Step 4: Run** the same tests plus `schedule.test.tsx` → PASS.
- [ ] **Step 5: Commit** `feat(owner): silent live refresh on Today and Schedule`

---

### Task 2: Shared booking actions hook

Refactor only; behaviour of the booking page must not change.

**Files:**
- Modify: `apps/web/src/owner/bookings/BookingActions.tsx`
- Test: existing `apps/web/test/owner/*booking*.test.tsx` (must stay green) + `apps/web/test/owner/bookingActions.test.tsx` (new)

**Interfaces:**
- Produces in `BookingActions.tsx`:
  ```ts
  type ActionCallbacks = { onUpdated(b: OwnerBooking): void; onPaid(b: OwnerBooking): void;
    onCancelled(b: OwnerBooking, refunds: RefundJson[]): void; onConflict(): void };
  function useBookingActions(booking: OwnerBooking, cb: ActionCallbacks): {
    actions: Action[];               // availableActions(booking, can)
    trigger(a: Action): void;        // runs a POST or opens that action's dialog
    pending: boolean; error: unknown;
    dialogs: ReactNode;              // ReasonDialog, CashDialog, PaymentLinkDialog, OwnerCancelDialog
  };
  function actionLabel(a: Action, t: TFunction): string; // owner.bookings.actions.*
  function RowActions(props: { booking: OwnerBooking; primary: Action | null; onDone(): void }): JSX.Element | null;
  ```
- `RowActions`: `primary` as a `size="sm"` Button, every other action from `actions` in an `ActionMenu` (`label = t('booking.moreActions')`, `reject`/`cancel`/`noShow` with `tone: 'danger'`); renders nothing when `actions` is empty; every callback ends in `onDone()`; error shown as in `PendingActions`.
- `BookingActions` keeps its props and markup, built on `useBookingActions`. `PendingActions` is deleted (callers move to `RowActions` in Task 5).

- [ ] **Step 1: Write failing tests** in `bookingActions.test.tsx`:
  - `RowActions shows the primary as a button and the rest in More actions` — pending booking, all perms, primary `'confirm'`: button "Confirm"; open "More actions" → menu items "Reject", "Cancel booking".
  - `RowActions opens the cash dialog from the menu` — confirmed, `amountPaid < total`, primary `'checkIn'`: menu item "Mark cash paid" opens the dialog (heading from CashDialog).
  - `RowActions renders nothing without permissions` — staff with only `booking.view` → container empty.
- [ ] **Step 2: Run** `pnpm --filter web test -- bookingActions` → FAIL.
- [ ] **Step 3: Implement** the hook by moving the state/dialog code out of `BookingActions`; `RowActions` on top.
- [ ] **Step 4: Run** `pnpm --filter web test -- owner` → all PASS (booking page tests unchanged). Today's pending-row tests still pass once Task 5 lands; until then keep `PendingActions` as a thin wrapper `RowActions primary='confirm'` so `today.test.tsx` stays green.
- [ ] **Step 5: Commit** `refactor(owner): share booking actions and dialogs through one hook`

---

### Task 3: Timeline — status colours, due chip, tappable blocks and free gaps

**Files:**
- Modify: `apps/web/src/owner/today/CourtTimeline.tsx`, `TodayPage.module.css`, en/ru locales
- Test: `apps/web/test/owner/courtTimeline.test.ts`, `apps/web/test/owner/today.test.tsx`

**Interfaces:**
- `Kind = 'ok' | 'wait' | 'walk'` (`'due'` removed). `kindOf`: pending/awaiting_payment → `wait`; else walk-in → `walk`; else `ok`.
- `Block` gains `due: number` = `total - amountPaid` when status is pending, confirmed or completed and that is > 0, else 0. *(Spec says pending/confirmed; completed is kept because money is still owed after play — Claude's call, matches the existing timeline test.)* Block also keeps `booking: OwnerBooking`.
- `Lane` gains `gaps: Gap[]`, `type Gap = { start: number; end: number; startAt: string }`.
- `freeGaps(day: OwnerSlotDay | undefined): Gap[]` — merges consecutive slots with `status === 'available'` (end of one = start of next) into gaps; `startAt` = first slot's ISO `startAt`. Slots with any other status (`pending`, `booked`, `blocked`, `past`) break a gap.
- `CourtTimeline` new props: `currency: string`, `onOpen(b: OwnerBooking): void`, `walkInHref: ((turfId: string, startAt: string) => string) | null` (null hides gaps).

- [ ] **Step 1: Write failing tests**
  - courtTimeline: replace `marks a going-ahead booking…as due` with `colours by status and carries money due separately`: same four bookings → kinds `['online:ok','walk:walk','done:ok','free:ok']`, dues `[1000-0, total-partial, total, 0]` (use fixture totals).
  - courtTimeline: `freeGaps merges consecutive available slots and stops at taken or past ones` — slots `past 08–09, available 09–10, available 10–11, booked 11–12, available 12–13` → `[{start:9,end:11,startAt:'…09:00…'},{start:12,end:13,…}]`.
  - today: `Today renders each booking block as a labelled button` — a button named `/Court A, 10:00–11:00, .*confirmed, .*due/` exists for a confirmed booking that owes money (opening it is tested in Task 4).
  - today: `Today links a free gap to a prefilled walk-in` — click `/Court A, free 12:00–13:00, add walk-in/` → location pathname `/owner/o1/walk-in`, search has `venue`, `turf`, `date`, `start=<slot ISO>`.
  - today: `Today hides free-gap buttons without booking.create`.
  - today: legend shows "Confirmed", "Waiting", "Walk-in", "Payment due"; no "Paid".
- [ ] **Step 2: Run** `pnpm --filter web test -- courtTimeline today` → FAIL.
- [ ] **Step 3: Implement.** Blocks become `<button type="button">` (same geometry; min height 44px on the lane — raise the lane height token if needed) with `aria-label` from `owner.today.blockLabel` / `blockLabelDue` and no `title`. The due chip is a `--text-2xs`/600 pill inside the block (`--danger-soft` bg, `--danger` text) reading `owner.today.dueChip` with the currency symbol from `Intl.NumberFormat(lang,{style:'currency',currency}).formatToParts`. Gaps render as `<a>`-styled `Link`s (they navigate) behind blocks: transparent, on hover/focus `--bg-hover` with a `+` glyph; accessible name `owner.today.gapLabel`. Below 768px: court-name column `position: sticky; inset-inline-start: 0` on `--bg-surface`, and on mount scroll `.timelineScroll` so the now line sits a third from the start (skip if not shown).

  Keys under `owner.today`: `legendConfirmed: "Confirmed"` (remove `legendPaid`), `legendDue` stays "Payment due", `dueChip: "{{symbol}} due"`, `blockLabel: "{{court}}, {{from}}–{{to}}, {{name}}, {{status}}"`, `blockLabelDue: "{{court}}, {{from}}–{{to}}, {{name}}, {{status}}, {{due}} due"`, `gapLabel: "{{court}}, free {{from}}–{{to}}, add walk-in"`.

  TodayVenue passes `walkInHref` built like `SchedulePage.onSlot` (`/owner/:ownerId/walk-in?venue&turf&date&start`) only when `can('booking.create')`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(owner): tappable Today timeline with free gaps and a money-due chip`

---

### Task 4: BookingSheet

**Files:**
- Create: `apps/web/src/components/ui/Sheet.tsx`, `Sheet.module.css`, `apps/web/src/owner/today/BookingSheet.tsx`, `BookingSheet.module.css`
- Modify: `TodayPage.tsx`, en/ru locales
- Test: `apps/web/test/owner/bookingSheet.test.tsx`

**Interfaces:**
- `Sheet(props: DialogProps)` — same API and focus behaviour as `Dialog` (native `<dialog>`, `showModal`, Escape, returns focus to opener); CSS: from 768px a side sheet at the inline end (`--sheet-width`, full height, `--shadow-lg`, surface, no border), below a bottom sheet (full width, `max-height: 85dvh`, top radius `--radius-xl`, scrolls). Add `--sheet-width` token (and to the design doc).
- `BookingSheet(props: { booking: OwnerBooking | null; venue: OwnerVenue; onClose(): void; onChanged(): void })` — open while `booking` is non-null. Loads `GET /owners/:id/bookings/:bookingId` (`BookingDetail`) for payment rows; shows the list booking until it arrives.
- Content order: name + status badge + payment badge; phone as `tel:` link (when present); "Court · time" line; amounts grid (Total, Paid, Due when > 0) in venue currency; payments list (method, amount, status, time) when any; `BookingActions` via `useBookingActions` (full-width lg buttons); "Open booking" link to `bookings/:id`.
- On any action callback: replace the shown booking with the returned one, reload detail, call `onChanged()`; `onConflict` reloads the detail. TodayVenue holds `openId: string | null` and passes the *current* list booking for that id, so a poll updates the sheet in place.

- [ ] **Step 1: Write failing tests**
  - `BookingSheet shows the booking facts and a call link` — name, `tel:+8801…` href, "Total", "Due".
  - `BookingSheet confirms a pending booking and tells Today to reload` — click Confirm → POST `/bookings/b1/confirm`, badge becomes Confirmed, `onChanged` called once.
  - `BookingSheet reloads the booking on a 409` — confirm → 409; detail GET called again, now-confirmed booking shows Check in instead of Confirm.
  - `BookingSheet shows facts only for a view-only member` — no buttons except Close and "Open booking".
  - today: `Today keeps the sheet open across a refresh` — open block, advance 60s → dialog still open, same name.
  - today: `Closing the sheet returns focus to the block`.
- [ ] **Step 2: Run** `pnpm --filter web test -- bookingSheet today` → FAIL.
- [ ] **Step 3: Implement** Sheet, BookingSheet, wire `onOpen` in TodayVenue. Keys under `owner.today.sheet`: `title: "Booking"`, `call: "Call {{phone}}"`, `total`, `paid`, `due`, `payments: "Payments"`, `openBooking: "Open booking"`, `close: "Close"` (reuse existing keys where they already exist in `owner.bookings`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(owner): booking sheet on Today with inline actions`

---

### Task 5: "Coming up" next-step actions

**Files:**
- Create: `apps/web/src/owner/today/nextStep.ts`
- Modify: `TodayPage.tsx`, `TodayPage.module.css`, en/ru locales
- Test: `apps/web/test/owner/nextStep.test.ts`, `apps/web/test/owner/today.test.tsx`

**Interfaces:**
- `SOON_MS = 30 * 60_000`
- `nextStep(b: OwnerBooking, actions: Action[], now: Date): Action | null` — first match that is also in `actions`:
  1. `pending` → `confirm`
  2. `awaiting_payment` → `paymentLink`
  3. `confirmed` and first start ≤ now + `SOON_MS` → `checkIn`
  4. `confirmed` → `markCash`
  5. otherwise `null`
- Consumes `RowActions` (Task 2) with `primary = nextStep(...)`.

- [ ] **Step 1: Write failing tests**
  - nextStep table test: pending → confirm; pending without `confirm` in actions → null; awaiting walk-in → paymentLink; confirmed starting in 20 min → checkIn; confirmed starting in 2 h with due → markCash; confirmed in 2 h fully paid → null.
  - today: `Today shows Check in on a confirmed row about to start`, `Today shows Collect on a confirmed row that still owes` (label "Mark cash paid"), existing confirm/reject/409 tests updated to `RowActions` (reject now via "More actions").
  - today: `Today shows the Actions column for a member with only booking.checkin`.
  - today: at 390px viewport (`window.innerWidth`, class check is enough) rows render stacked — assert the table has the `stacked` class below 768px via a `matchMedia` stub.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Actions column shown when any of `booking.confirm`, `booking.cancel`, `booking.checkin`, `payment.mark_cash`, `booking.create`. Below 768px the upcoming table uses the same card-row pattern as owner Bookings (time · court line 1, customer line 2, action at the end; header kept for screen readers). Delete the `PendingActions` wrapper left in Task 2.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(owner): next-step action on every Coming up row`

---

### Task 6: Attention rows with actions

**Files:**
- Modify: `apps/web/src/owner/today/Attention.tsx`, `TodayPage.tsx`, en/ru locales
- Test: `apps/web/test/owner/today.test.tsx`

**Interfaces:**
- `Attention` gains props `onChanged(): void` and keeps `now`.
- Item type gains optional `booking: OwnerBooking` and `primary: Action`; such rows render `RowActions` instead of the "Open" link (rows with no permitted action fall back to "Open").
- New rows, in this order before the existing ones:
  1. Pending confirmations: one row when any `pending` — title `owner.today.pendingCount` ("{{count}} waiting for confirmation", plural forms), detail "Oldest: {{name}}, {{time}}" (oldest by `createdAt`), actions on that oldest booking, primary `confirm`, tone warning.
  2. Starting within `SOON_MS` with money due (confirmed, due > 0, start in (now, now+30min]) — one row per booking, primary `markCash`, tone warning.
  3. Started more than 15 min ago, still `confirmed`, not ended — one row per booking, primary `checkIn` (overflow has No-show), tone danger.
- "Payments to verify" is Part C; leave a `// Part C: payments to verify` slot comment only if the file already uses such markers — otherwise nothing.

- [ ] **Step 1: Write failing tests**
  - `Attention shows pending count with the oldest and confirms it inline`.
  - `Attention flags money due on a game starting soon` — "Mark cash paid" button opens the cash dialog.
  - `Attention flags a started game not checked in` — "Check in" posts `/check-in`, then `onChanged` reloads (row gone after mock update).
  - `Attention rows show Open instead of buttons for a view-only member`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Keys under `owner.today`: `pendingCount_one`, `pendingCount_other` (+ ru `_one/_few/_many/_other`), `pendingOldest`, `dueSoon: "{{name}} starts at {{time}} and still owes {{due}}"`, `notCheckedIn: "{{name}} started at {{time}} and has not checked in"`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(owner): act on Today's attention items inline`

---

### Task 7: Small fixes and design doc

**Files:**
- Modify: `TodayPage.tsx:58` area, `.superdesign/design-system.md` (Today page section), en/ru locales (remove dead keys)
- Test: `apps/web/test/owner/today.test.tsx`

- [ ] **Step 1: Failing tests:** `Today trends link has no arrow` (link text exactly "See trends"); `Today hides the waiting tile without booking.confirm`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:** drop the `→` span; render the pending StatCard only with `can('booking.confirm')`. Rewrite the design doc's Today section for: "See trends" without arrow; legend Confirmed/Waiting/Walk-in/Payment due chip/Closed; blocks are buttons opening the booking sheet; free gaps → walk-in; sticky court column and now-scroll on phones; "Updated hh:mm" / "Couldn't refresh · Retry"; Coming-up primary action + More actions; stacked rows below 768px; new Attention rows with inline actions; the new `Sheet` component and `--sheet-width` token. Remove `legendPaid` from en/ru.
- [ ] **Step 4: Run** `pnpm -r test`, `pnpm typecheck` and `pnpm lint` → all PASS. Check light/dark and 390px in the running app (`run` skill) on Today: sheet, gaps, chips, Russian.
- [ ] **Step 5: Commit** `fix(owner): Today trends link, waiting tile permission, design doc`
