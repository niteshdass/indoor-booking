# Platform General settings: venue approval, platform fee, owner payouts

## Intent

The platform admin wants to earn from bookings and control who gets onto the platform, all from **Admin > Settings**. Today that page has Google sign-in, Email and SMS tabs. It gets a new **General** tab, which is the first tab.

Money for a booking already flows player → owner, through the owner's own bKash, Nagad, Rocket or Stripe. The admin never touches booking money. So the admin's cut becomes a **balance each owner owes the platform**. The owner pays it to the admin's own bKash, Nagad or Stripe whenever they like.

## Goals

1. **Venue signup approval:** the admin picks one of two modes.
   - **Manual** (today's behaviour): a new owner application waits in `pending_approval` for the admin.
   - **Automatic:** the owner is `active` right away.
2. **Platform fee per booking:** the admin picks one of three modes.
   - **Free:** no fee on bookings, nothing is owed, and nothing about fees shows anywhere.
   - **Fixed:** a set amount per booking.
   - **Percent:** a percentage of the booking.
3. **Who pays the fee** (the admin chooses):
   - **Owner pays:** the player pays the venue price (1000). The owner owes the platform the fee.
   - **Player pays:** the player pays the venue price plus the fee (1000 + 50 = 1050) to the owner. The owner collected the fee on the platform's behalf, so the owner owes the platform the fee.
   - In both modes the debt is the owner's. Only what the player is charged changes.
4. **The fee is set at booking time.** When a booking is created, its fee is computed from the current settings and stored on the booking. Later changes to the settings never touch existing bookings.
5. **Admin payment details:** the admin enters where owners pay them:
   - a bKash number and a Nagad number (the same shape as an owner's `ManualWallet`);
   - Stripe keys (test and live, sealed like the owner gateway keys).
6. **Owner pays the platform at any time.** In the owner dashboard, the owner sees what they owe and can pay any amount up to that balance:
   - **bKash / Nagad:** the owner sends money outside the app, then submits the TrxID and sender number. The admin checks it and confirms or rejects it. This is the same pattern as the existing player manual-wallet flow.
   - **Stripe:** the owner pays by card in the app, using the admin's Stripe keys. It is confirmed automatically by webhook.
7. **Admin sees who owes what.** A list of owners shows each one's balance, and there is a queue of submitted payouts to confirm or reject.

## Non-goals

- Per-owner fee overrides or fee tiers. There is one platform-wide setting.
- Automatic enforcement: no auto-suspension and no blocking of bookings when an owner doesn't pay. The admin can still suspend manually, as today.
- Invoices or PDF statements.
- Currency conversion.
- Rocket or SSLCommerz for platform payouts. Only what was asked for: Stripe, bKash and Nagad.
- Fees on walk-in bookings that staff enter (see "Calls made").

## Anti-goals

These would make it a failure even if it technically works:

- A settings change silently re-pricing bookings that already exist.
- A player seeing a total at checkout that differs from what they are charged, or the fee hidden from a player who is paying it.
- Free mode leaving any fee UI visible (a "Platform fee: 0" line, an empty "You owe" card).
- Approval mode changes touching owners that are already pending. Switching to Automatic does **not** auto-approve the existing queue. The admin still handles those.

## Constraints

- Follow the existing admin-settings pattern:
  - store it on the single `PlatformSettings` document in `apps/api/src/admin/settings.ts`;
  - expose it through `apps/api/src/admin/routes/settings.ts`;
  - share types in `packages/shared/src/admin.ts`;
  - gate it with the `platform.settings` permission;
  - read through the cached `loadSettings()`;
  - seal secrets with `secretBox` and a field-bound AAD.
- Store money as integer minor units of the booking's currency (`packages/shared/src/money.ts`).
- Owners each have their own currency. A **fixed fee is one number entered in major units and applied in each booking's own currency**. A fixed fee of 50 means ৳50 on a BDT booking and $50 on a USD one. The admin is expected to run a single-currency platform (BDT); the settings screen says so in a hint.
- Balances are kept **per currency**. An owner with no bookings in a currency shows no line for it.
- UI:
  - follows `.superdesign/design-system.md` and only uses tokens from `apps/web/src/styles/tokens.css`;
  - works in light and dark mode;
  - all strings exist in English and Russian (`en.json`, `ru.json`) and fit in Russian.
- The admin in-app guide (`apps/web/src/admin/docs/content.ts` / `content.ru.ts`) gets a topic for the General tab.

## How it works (decided)

### Settings shape (`PlatformSettings.general`)

```
general: {
  ownerApproval: 'manual' | 'automatic'          // default 'manual'
  fee: {
    mode: 'free' | 'fixed' | 'percent'           // default 'free'
    fixed: number | null                          // major units, e.g. 50
    percent: number | null                        // e.g. 5 means 5%, up to 2 decimals, 0 < p ≤ 50
    payer: 'owner' | 'player'                     // default 'owner'
  }
  payout: {
    bkash: ManualWallet | null
    nagad: ManualWallet | null
    stripe: { mode: 'test'|'live', keys: { test?, live? } (sealed like owner gateways), enabled } | null
  }
}
```

If no document exists, the defaults apply: manual approval, free, no payout methods. That is exactly today's behaviour.

### Approval

`POST /owners` (the apply route) reads `general.ownerApproval`.
- With `automatic`, it creates the owner as `active` and logs `owner.auto_approved`.
- With `manual`, nothing changes.

The apply page's success message changes too: "You're live" for automatic, "Waiting for approval" for manual.

### Fee at booking time

`quoteBooking` gains a fee step that runs after the slots and add-ons are totalled.

1. `base = subtotal + addonsTotal`.
2. Work out the fee:
   - `fixed`: `fee = fixed × 10^exponent(currency)`;
   - `percent`: `fee = round(base × percent / 100)` to the nearest minor unit, half up.
   - If the result is 0, there is no fee.
3. Work out the total:
   - player pays: `total = base + fee`;
   - owner pays: `total = base`.
4. The booking stores a snapshot:

```
platformFee: { mode, value, payer, amount } | null
```

   - `value` is the fixed amount or the percent.
   - `null` means no fee: the mode was free, the booking was a walk-in, or the fee came to 0.

The quote endpoint returns the fee, so checkout shows it.

Advance payments, when the player pays the fee:
- The advance policy is computed on `base`, as today.
- When an advance is required (> 0), the fee is added to it, so the fee is collected up front.
- When nothing is due up front, the fee is paid at the venue with the rest.

Fixed fee on a multi-day checkout: each booking of a group is its own booking, so each one carries its own fee.

### When the fee counts as owed

A booking's fee counts toward the owner's balance only while the booking is `pending`, `confirmed`, `completed` or `no_show`.

- `awaiting_payment` does not count yet.
- `rejected`, `cancelled` and `expired` count as zero.

The balance is computed from these statuses; it is not a counter that gets moved up and down.

Refunds on a cancelled booking keep today's rules, applied to what the player actually paid (fee included when the player paid it). The platform drops the fee for cancelled bookings, so the owner keeps any amount that wasn't refunded.

### Balance and payouts

A new collection, `PlatformPayout`, scoped by owner, holds one row per payout an owner submits:

```
{ ownerId, currency, amount, method: 'bkash'|'nagad'|'stripe',
  trxId?, senderNumber?, stripePaymentIntentId?,
  status: 'pending'|'confirmed'|'rejected', rejectReason?, reviewedBy?, reviewedAt?, createdAt }
```

For each owner and currency:

```
owed = Σ platformFee.amount of the owner's bookings in owing statuses
paid = Σ confirmed payouts
balance = owed − paid
```

Pending payouts are shown separately as "awaiting check" and do not reduce the balance yet. The amount a new payout can cover is `max(0, balance − pending)`.

**Negative balance is a credit (user decided).** When a booking whose fee the owner already paid later becomes non-owing (cancelled, rejected), `owed` drops below `paid` and the balance goes negative. That credit stays and later fees use it up automatically, since the balance formula is cumulative. No refunds to owners. The owner page shows a "Credit ৳X" state with no Pay now, and the admin Owes column shows credit as a negative amount labelled as credit.

### Reports (user decided: net)

Owner reports (`apps/api/src/reports/overview.ts` and the CSV export) and admin stats (`apps/api/src/admin/stats.ts`) count venue revenue **net of the platform fee**: what the booking earned minus `platformFee.amount` for owing bookings, in either payer mode. The fee appears as its own line or column ("Platform fee"), so gross = net + fee is visible. Admin stats also show total platform fees owed and collected.

- **Manual (bKash/Nagad):** the owner sees the admin's number. They submit an amount, a TrxID (validated with `normalizeTrxId`) and a sender number, which creates a `pending` payout. The admin confirms or rejects it in the admin queue.
- **Stripe:** the server creates a PaymentIntent with the admin's keys for the chosen amount. The owner pays with the existing Payment Element. A webhook on a new platform endpoint marks the payout `confirmed`. The webhook is idempotent through the existing `webhookEvent` model.

### Screens

**Admin > Settings > General** (first tab), as three cards:
- **Venue signup:** a two-option segmented choice, Manual or Automatic, with a hint for each.
- **Platform fee:**
  - a choice of Free, Fixed or Percent;
  - the amount or percent field (hidden when Free);
  - a "Who pays" choice: Owner or Player;
  - a live example line, such as "Field 1000 → player pays 1050, you receive 50".
- **Where owners pay you:** bKash number, Nagad number, and Stripe keys with the same field set and test/live switch as the owner Stripe setup.

Each card follows the page's existing Save behaviour. There is no "Use server config", because there is no env fallback.

**Admin > Owners:** a "Owes" column with the per-currency balance.

**Admin > Payouts** (new page, or a tab under Owners — the builder's choice; see below):
- a queue of pending payouts with Confirm and Reject (with a reason);
- the history of past payouts.

**Owner dashboard:** a "Platform fee" page under Settings, shown only when the fee mode is not Free or the owner has a non-zero balance. It shows:
- the balance per currency and the pending amount;
- a "Pay now" action: pick bKash, Nagad or Stripe (only the ones the admin set up), then enter the amount and either the TrxID or the card;
- the list of past payouts with their status.

It uses the `settings.edit` permission.

**Player checkout and booking details:** when the player pays the fee, a "Platform fee" line appears above the total. When the owner pays, the player sees nothing.

**Owner booking detail:** a "Platform fee" line with the amount and who paid it.

## Calls made

These are the builder's or agent's own decisions, not the user's:

- **Fee on online bookings only.** Walk-in and staff-created bookings carry no fee. The platform brought the player online; a walk-in is the owner's own customer.
  - Recurring series created online count as online.
- **Fixed fee is per booking, not per slot.**
- **Percent is of slots + add-ons**, and is capped at 50%.
- **The fee joins the advance whenever an advance is due.**
- **Cancelled, rejected and expired bookings owe nothing.**
- **Switching to Automatic doesn't approve existing pending applications.**
- **Owners can't pay more than they owe.**
- **No reminders or notifications** about balances in this round.
- **Owes column and payout queue (confirm/reject) gated by `platform.owners`.** The General tab itself stays on `platform.settings`.
- **Online recurring series get the fee too.** They are priced in `apps/api/src/series/engine.ts`, outside `quoteBooking`, so the fee step is added there and to the series preview.

## Left to the builder

- Whether payouts are a tab under Owners or a page of their own in the admin sidebar.
- The exact component layout of the cards, within the design system.
- The naming of routes and models, as long as it follows the codebase's conventions.
- The migration approach for the new `platformFee` field. Existing bookings get `null` and owe nothing.
