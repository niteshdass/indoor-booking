# Slot Booking — Design System

Adapted 2026-10-24 from the Fluent Monetize design system (Option B neutrals, chosen 2026-10-07).
Visual rules are carried over unchanged; product context, fonts and booking components are this project's.
Source of truth in code: `apps/web/src/styles/tokens.css`. Every UI change uses these tokens — no hardcoded hex, px font sizes, radii or shadows outside that file.

## Product context
Multi-vendor booking for indoor and outdoor sports venues (courts, pitches, lanes). Owners run one or more venues with staff; players find a venue, pick a slot and pay with Stripe. English and Russian.

Surfaces:
- **Owner portal** (React SPA): left sidebar nav + top bar; owner switcher (a user can belong to several owners); dashboard with booking/revenue stat cards; schedule/calendar per venue and court; data tables (bookings, members, staff, activity log); editors (venue, court, pricing, roles); settings forms.
- **Public venue page**: cover image, venue header (name, address, sports, Share), court/sport tabs, date strip, slot grid, booking summary card with price and Book button.
- **Player**: sign-in (phone OTP, email, Google), checkout, booking receipt, my bookings, account.

JTBD: owners and staff see today's schedule and act on it fast and calmly; players trust the page enough to book and pay.

## Visual principles
- Calm, neutral, content-first. Monochrome UI chrome; color is reserved for status and the owner's own brand color.
- One neutral ramp, one dark-mode family, one radius scale — no one-off values.
- Dark mode is first-class: every token has a light and dark value. Surfaces separate by lightness steps and borders, not heavy shadows.
- Per-owner brand color (`--brand`) appears only on public pages (CTA accents, active tab underline, selected slot). Never in the owner portal chrome.
- Text must fit Russian: Russian strings run ~20–30% longer than English. No fixed-width labels; buttons and tabs grow or wrap.

## Typography (fixed)
- Font: **Inter** for all UI, loaded with the `latin` and `cyrillic` subsets. No other fonts. (The source system's Baskervville heading serif is dropped: it has no Cyrillic.)
- Numbers in schedules, prices and tables use `font-variant-numeric: tabular-nums`.
- Scale (px): 2xs 11 · xs 12 · sm 13 · base 14 · md 16 · lg 18 · xl 20 · 2xl 24 · 3xl 32 · display 56
- Weights: 400 regular · 500 medium (UI default for labels/buttons) · 600 semibold (headings, numbers). 700 only for display.
- Line height: 1.5 body, 1.25 headings.

## Spacing (fixed)
4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 px. Card padding 20–24. Table row height 52. Control height 36 (sm 32, lg 40). Touch targets on public/player pages at least 40.
Container width token: `--container-narrow` 28rem (auth/form cards; not themed).
Field minimum width token: `--field-min` 10rem (smallest width of a paired form field before it wraps; not themed).
Map height token: `--map-height` 32rem (results map; same in light and dark).
Focus outline width token: `--focus-width` 2px, used with `--text-strong` for a solid outline where the soft focus ring is too faint (map pins). Not themed.

## Breakpoints (fixed, mobile-first `min-width`)
sm 640 · md 768 · lg 1024 · xl 1280. Owner portal sidebar becomes a drawer below lg. Public pages are designed phone-first; mobile apps will reuse the same API later.

## Shadows (fixed)
- xs `0 1px 2px rgba(10,13,20,.03)` — cards
- sm `0 2px 8px rgba(10,13,20,.06)` — hover
- md `0 12px 32px rgba(10,13,20,.10), 0 2px 8px rgba(10,13,20,.06)` — dropdown/popover
- lg `0 20px 60px rgba(10,13,20,.18), 0 4px 16px rgba(10,13,20,.08)` — modal
- Dark mode: shadows near-invisible; use 1px borders.
- Focus ring: `0 0 0 3px` primary at 10–15% alpha. Always visible on keyboard focus.

## Status colors (fixed)
| Role | Light fg / soft bg | Dark fg / soft bg |
|---|---|---|
| Success | #059669 / #d1fae5 | #34d399 / rgba(52,211,153,.12) |
| Warning | #d97706 / #fef3c7 | #fbbf24 / rgba(251,191,36,.12) |
| Danger | #dc2626 / #fef2f2 | #f87171 / rgba(248,113,113,.12) |
| Info / link | #2563eb / #eff6ff | #60a5fa / rgba(96,165,250,.12) |

## Neutrals, primary, radius
Cool gray light ramp + navy-tinted dark.

| Token | Light | Dark |
|---|---|---|
| bg-page | #f5f7fa | #0e121b |
| bg-surface | #ffffff | #141f2c |
| bg-surface-raised | #ffffff | #1e2a38 |
| bg-subtle / bg-hover | #f0f3f5 | #222f3d |
| border-subtle | #f0f3f5 | #222f3d |
| border-default | #e1e4ea | #2c3a4b |
| border-strong | #cacfd8 | #3d4c5e |
| text-strong | #0e121b | #f0f3f5 |
| text-default | #2b303b | #cacfd8 |
| text-muted | #525866 | #99a0ae |
| text-subtle | #99a0ae | #717784 |
| overlay (modal scrim) | rgba(10,13,20,.5) | rgba(0,0,0,.6) |
| primary / hover / fg | #19283a / #2b3a4d / #fff | #f0f3f5 / #cacfd8 / #0e121b |

Radius: sm 4 (tag, checkbox) · md 8 (button, input, slot cell) · lg 12 (card) · xl 16 (modal) · full (badge, avatar).

Dark mode switch: `data-theme="dark"` / `"light"` on `<html>`; with neither set, follow `prefers-color-scheme`.

## Results map
Leaflet with OpenStreetMap tiles. Tiles are always light, so they are never inverted in dark mode; the map frame, pins and the "Search this area" button use surface, border and primary tokens. Pins are DOM-built (venue names are untrusted text), keyboard-focusable, and labelled with the venue name and price. Below lg a List/Map segmented toggle (`aria-pressed`) shows one at a time; at lg and up list and map sit side by side with the map sticky.

## Components
- Buttons: primary (solid), secondary (outline, surface bg), ghost, danger; sizes sm/md/lg; icon-only square. Label weight 500. On public pages the main CTA (Book, Pay) uses `--brand` with `--brand-fg`.
- Inputs/selects: 36px, 1px border, label above (13px/500), helper 12px muted, error 12px danger. Phone input has a country prefix; OTP input is 6 single-digit boxes.
- Badges: pill, 12px/500, soft bg + fg from status colors; neutral badge uses subtle bg + muted text.
  - Booking status: confirmed = success, pending payment = warning, cancelled = danger, completed = neutral, refunded = info.
  - Member status: active = success, invited = info, disabled = neutral.
- Cards: surface bg, 1px border, xs shadow.
- Tables: header 12px/500 muted, sentence case (no uppercase), rows separated by 1px subtle border, hover = subtle bg.
- Sidebar nav: 14px/500 items, 36px tall, active = subtle bg + strong text, inactive = muted text.
- Owner switcher: top of sidebar; owner name 14px/600 + role 12px muted; dropdown lists memberships.
- Avatar: circle.

### Booking components (this project)
- **Date strip**: horizontal scroll of day chips (weekday 12px muted + date 16px/600), selected = primary bg + primary fg; today marked with a dot. Weekday names come from the locale.
- **Slot grid**: cells of time (14px/500, tabular) + price (12px muted), radius md, min height 40.
  - Available: surface bg, default border, hover = hover bg.
  - Selected: `--brand` bg + `--brand-fg` (public); primary in the owner portal.
  - Booked: subtle bg, subtle text, no border, not clickable, strike-free.
  - Held (another player is checking out): warning soft bg + warning fg.
  - Blocked / maintenance: subtle bg with 45° stripes in border-subtle.
  - Past: text-subtle, not clickable.
- **Schedule (owner)**: courts as columns, time as rows (30/60 min); booking blocks use status soft bg + 3px left border in status fg; current-time line in danger.
- **Booking summary card**: venue, court, date, time range, line items, total 20px/600 tabular, CTA full width.
- **Price**: always formatted with the owner's currency and locale via `Intl.NumberFormat`; never hand-built strings.
