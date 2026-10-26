# Slot Booking — Design System

Adapted 2026-10-24 from the Fluent Monetize design system; visual identity v2 ("Hard court") proposed 2026-10-26.
Product context and booking components are this project's.
Source of truth in code: `apps/web/src/styles/tokens.css`. Every UI change uses these tokens — no hardcoded hex, px font sizes, radii or shadows outside that file.

## Product context
Multi-vendor booking for indoor and outdoor sports venues (courts, pitches, lanes). Owners run one or more venues with staff; players find a venue, pick a slot and pay with Stripe. English and Russian.

Surfaces:
- **Owner portal** (React SPA): left sidebar nav + top bar; owner switcher (a user can belong to several owners); dashboard with booking/revenue stat cards; schedule/calendar per venue and court; data tables (bookings, members, staff, activity log); editors (venue, court, pricing, roles); settings forms.
- **Public venue page**: venue header (name, rating, address, sports, Share), photo gallery, court tabs, date strip, slot grid grouped by time of day, booking summary with price and Book button, amenities and location map, reviews.
- **Player**: sign-in (phone OTP, email, Google), checkout, booking receipt, my bookings, account.

JTBD: owners and staff see today's schedule and act on it fast and calmly; players trust the page enough to book and pay.

## Visual identity v2 — "Hard court" (adopted 2026-10-26)
Mockups: `.superdesign/design_iterations/landing_1.html`, `admin_today_1.html`. The tokens live in `apps/web/src/styles/tokens.css`; this section is the rule.

Idea: the look of a sports court. Hard-court blue, chalk lines, a little ball-yellow. The court-line drawing is the one bold device. Everything else stays calm.

### Principles
- **Court lines are the signature.** 2px chalk or primary strokes, top-down court drawings (padel, futsal, tennis, badminton, basketball, volleyball) as the illustration system. No stock photos or gradient blobs.
- **Spend boldness once per screen.** Landing: the hero, a `--hero-bg` tinted band where the padel panel sits on a fan of clay and parquet courts (one screen, every sport). Portal: the live court timeline. Everything around it is quiet: neutral surfaces, 1px borders, status color only where status lives.
- **Ball yellow is scarce.** Only the main CTA on dark (night) surfaces and the ball in the hero. Never body text, never on light backgrounds.
- **Owner brand color** (`--brand`) still only on public venue pages (CTA, active tab, selected slot). Never in portal chrome or on the marketing site.
- **Motion lives on the landing, tied to the court.** Hero: court lines draw in and the slot card rises, then the card loops the booking story in four numbered steps (Find: a mini search bar types "Padel / Today" and a court turns up; Pick: 19:00 gets tapped; Book: summary and the Book button press; Done: the confirmation tick draws), about 10s a lap and only while on screen. The ball keeps a slow cross-court rally. These are the only two loops. Sport tiles re-chalk their court lines on hover or focus. The owners timeline fills its bookings in sequence when it scrolls into view. No generic fade-up on sections, nothing in the portal. `prefers-reduced-motion` shows end states (the card holds on Done) and a still ball.
- **Russian fits.** Strings run 20–30% longer: no fixed-width buttons, tabs or nav items; headlines use `text-wrap: balance`; KPI numbers `nowrap` and shrink with `clamp`.
- Avoid: all-caps eyebrow labels, "→" in buttons, numbered markers on things that are not a sequence (the "how it works" steps are a real sequence, so they are numbered), identical card grids for every section.

### Palette anchors (not themed)
| Name | Hex | Use |
|---|---|---|
| court-blue | #1f3f9a | light primary, hero court, closing band, org mark |
| court-blue-deep | #172f75 | primary hover |
| night | #0b1433 | owners section, text-strong (light), dark-mode base family |
| chalk | #f5f7f4 | light page bg, lines on blue |
| surround | #2e6a4f | court surround in the hero only |
| ball | #d6ef3f (text #1b2400) | CTA on night/blue, hero ball |
| clay | #c65a38 | hero back court (tennis clay) only |
| wood | #c98a44 | hero back court (parquet) only |

### Themed tokens
| Token | Light | Dark |
|---|---|---|
| bg-page | #f5f7f4 | #080f27 |
| bg-surface | #ffffff | #0f1a3b |
| bg-surface-raised | #ffffff | #152248 |
| bg-subtle | #eef1f0 | #172550 |
| bg-hover | #e8ecee | #1c2c5c |
| border-subtle | #e9edeb | #18264f |
| border-default | #d9dfe0 | #22336a |
| border-strong | #b8c1c6 | #33478a |
| text-strong | #0b1433 | #f5f7f4 |
| text-default | #283247 | #cdd4e4 |
| text-muted | #566078 | #96a1bf |
| text-subtle | #8a93a6 | #6c7798 |
| primary / hover / fg | #1f3f9a / #172f75 / #fff | #8fa9ff / #b0c3ff / #0b1433 |
| primary-soft | #e6ecfa | rgba(143,169,255,.14) |
| overlay | rgba(11,20,51,.5) | rgba(0,0,0,.6) |

Status (fg / soft): success #0f8a5f / #dcf5ea (dark #3ccf95 / 13%), warning #b86a00 / #fdf0d5 (dark #f5b83d / 13%), danger #d0312d / #fdeceb (dark #ff7b72 / 13%), info #1f5fd1 / #e7effd (dark #6ea8ff / 13%). Light warning was darkened from #d97706 to pass 4.5:1 on its soft bg.

Dark mode switch: `data-theme="dark"` / `"light"` on `<html>`; with neither set, follow `prefers-color-scheme`. Dark is navy (night family), not grey.

### Typography
- **Unbounded** (500/600/700): display and section headings on the landing, page titles (h1) and KPI numbers in the portal. Wide, scoreboard-like. Letter-spacing -0.02em. Never body text, never below 18px.
- **Onest** (400/500/600): all UI and body text. Both fonts have full Cyrillic. Onest has tabular figures: prices, times, tables and schedules use `font-variant-numeric: tabular-nums`.
- Load: `family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;600;700&subset=latin,cyrillic`. Replaces Inter.
- Scale (px): 2xs 11 · xs 12 · sm 13 · base 14 · md 16 · lg 18 · xl 22 · 2xl 28 · 3xl 36 · 4xl 48 · display clamp(40, 7vw, 84).
- Line height: body 1.55, headings 1.15, display 1.02.

### Spacing, size, radius, shadow
- Spacing 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 96. Landing sections 64 (phone) / 96 (md+). Portal page padding 24.
- Controls: sm 32, md 36, lg 44 (all public CTAs and touch targets are lg). Table row 52. Topbar 56. Sidebar 15rem. Container 76rem; text column 40rem.
- Radius by hierarchy: sm 4 tag/checkbox · md 8 button/input/slot · lg 12 card · xl 20 hero panel, search bar, modal, closing band · full chip/badge/avatar.
- Shadows: xs cards, sm hover, md popover and the hero search bar, lg modal and the hero slot card. Dark: xs/sm none, borders separate surfaces.
- Focus ring `0 0 0 3px` primary at 22% (light) / 30% (dark). Always visible on keyboard focus.

### Component layout tokens (unchanged from v1)
Container width token: `--container-narrow` 28rem (auth/form cards; not themed).
Field minimum width token: `--field-min` 10rem (smallest width of a paired form field before it wraps; not themed).
Map height token: `--map-height` 32rem (results map; same in light and dark).
Demo stepper tokens: `--demo-dot` 1.5rem (step dot), `--demo-rule` 2px (connector).
Picker height token: `--picker-max` 20rem (tallest a select dropdown grows before it scrolls).
Tab underline token: `--tab-underline` 2px (active underline on shared `Tabs` and the My bookings tabs; not themed).
Portal layout tokens (not themed): `--sidebar-width` 15rem (owner portal sidebar), `--table-row` 3.25rem (52px table row).
Schedule tokens (not themed): `--schedule-row` 1.5rem (one 15-minute row), `--schedule-col-min` 9rem (narrowest turf column), `--schedule-time-col` 3.5rem (time label column).
Status and payment tokens (not themed): `--status-bar` 3px (left border on schedule booking blocks), `--schedule-now-line` 2px (thickness of the current-time line), `--qr-size` 12rem (payment link QR code).
Review token: `--reply-rule` 2px (left rule beside an owner reply in the portal and My bookings; the public venue page uses a tinted block instead; not themed).
Venue page tokens (not themed): `--gallery-height` 26rem (desktop photo mosaic), `--gallery-tile` 85% (phone photo strip tile width), `--court-thumb` 3.5rem (court drawing in a court tab), `--venue-map-height` 15rem (location map), `--avatar-sm` 2rem (reviewer initial disc), `--slot-min` 6rem (narrowest slot cell), `--slot-label` 7rem (time-of-day label column).
Focus outline width token: `--focus-width` 2px, used with `--text-strong` for a solid outline where the soft focus ring is too faint (map pins). Not themed.
Disabled and busy token: `--opacity-muted` 0.55 (disabled buttons, a summary that is re-quoting; not themed). Motion token: `--duration-fast` 150ms (short opacity transitions; not themed).

### v2 implementation tokens
Night surfaces: any element with `data-surface="night"` takes the dark token values in both themes (owners section on the landing).
- `--bg-header`: translucent page color behind sticky headers; `--blur-header` 12px backdrop blur. Header height `--header-height` 4rem (public), `--topbar-height` 3.5rem (portal).
- `--on-night-line` / `--on-night-hover`: borders and hover fills on night and court-blue surfaces.
- `--shadow-ball` (ball CTA lift) and `--shadow-night` (portal preview on night). Button variant `ball` = `--ball` bg + `--ball-ink` text; only on night or court-blue surfaces.
- `--hero-bg`: hero band tint, #e8eefa light, #0e1a45 dark. Behind the panel two back courts (`--clay`, `--wood`) with chalk lines fan out to about ±6° at lg (±5° below) and fan open once on load; reduced motion skips it.
- `--hero-panel-max`: widest the hero court panel grows. `--meter-height`: thin usage meter bar.
- Court timeline (not themed): `--timeline-label` 7rem (court name column), `--timeline-lane` 3rem (lane height), `--timeline-min` 56rem (width below which it scrolls sideways), `--now-line` 2px.
- `--stripe-closed`: 45° hairline stripes in `--border-strong` for closed time on the court timeline (outside hours, blocked slots, closed days), shown at `--opacity-muted`.
- Motion: `--duration-slow` 600ms with `--ease-out` for landing entrances; `--duration-draw` 1.4s (court lines drawing in, tile re-chalk), `--duration-rally` 4.8s (one ball rally loop), `--stagger` 80ms (gap between timeline bookings filling in).
- Loading: page and section loads show `Skeleton` (`dashboard`, `table`, `detail`, `list` shapes; `role="status"` with a label) in `--bg-subtle`, pulsing to `--opacity-muted` over `--duration-pulse` 1.4s (off under reduced motion). Heights: `--skeleton-stat` 7.5rem, `--skeleton-panel` 16rem, `--skeleton-item` 4.5rem. Spinner stays for buttons, dialogs and small inline waits.

Breakpoints (mobile-first `min-width`): sm 640 · md 768 · lg 1024 · xl 1280.

### Marketing landing (`/`, logged out)
Order: sticky blurred header (court-colour tape along the top edge, `--header-tape` 3px: court-blue, surround, clay, wood, ball; logo mark = court square; pill nav links, active on `--primary-soft`; right edge: language as globe + code and theme as sun/moon/monitor icon pills that open a radio menu (`--menu-min` 11rem), then Sign in (brand pill) or, signed in, a court-blue initials disc with a ball ring linking to Profile; below 480px only the mark shows and nav drops to a second row) → hero (left: display headline, lede, 3-field search bar Sport / Date / From + "Show free courts", note on guest booking; right: court panel with animated slot card) → "Pick your game" sport tiles with court drawings (6 across at xl, 3 at md, 2 on phone) → "From search to serve" 3 numbered steps on a surface band → player features as a 2-column ruled list (icon tile + title + one line) → owners section on night: copy, ball-yellow checks, "List your venue" (ball) + "Talk to us" (outline), portal preview (KPIs + mini court timeline) → FAQ with `<details>` → court-blue closing band → 4-column footer.
Left-aligned throughout; only the steps and sport tiles use grids. The search bar submits to the existing search results page.

### Owner portal shell
- Sidebar (lg+; drawer below): owner switcher card (org mark in court blue, name 14/600, role 12 muted) → nav groups with sentence-case group labels in text-subtle: "Day to day" (Today, Schedule, Bookings, Walk-in, Series), "Setup" (Venues, Closures, Add-ons, Settings), "Team and players" (Staff, Reviews, Activity) → user row with theme toggle at the bottom. Items 36px, 18px stroke icons, active = primary-soft bg + primary text, counts as warning pills (things to act on).
- Top bar (sticky, blurred page bg): menu button (below lg), venue select with inline muted label, primary page action on the right ("New walk-in", small primary button; keeps `?venue`, hidden without `booking.create` and on the walk-in page). Not built: the day stepper (Schedule already moves between days) and ⌘K search (no search API yet).
- Series nav item shows a warning count pill for weekly requests waiting for a reply (shows `N+` when the API has another page; screen readers hear "N requests waiting").
- Page head: Unbounded h1 28px + one muted line of context; secondary action on the right.

### Today page
KPI row (one row at xl, 2 columns at md, 1 on phone): Bookings (hint: count on the same weekday last week), Revenue, Courts used (percent + `{booked} of {open} open hours` + meter; only when court slot data loads), Pending (StatCard `tone="warning"`: warning border and number when above 0). StatCard props: `tone?: 'warning'`, `meter?: 0–1`. → Courts timeline card, full width: court label column (name + surface), lanes with hour grid lines, booking blocks = status soft bg + 3px status left bar, closed = 45° stripes, now line in danger with a time tag on the first lane; scrolls sideways below 56rem. → "Needs your attention" list, full width (leading icon tile in the status soft color, no side stripes: info = weekly request, warning = unpaid hold still running, danger = 1–2 star review without a reply; each row has an "Open" link; the section is left out when empty) → "Coming up" table. Every extra (last week, courts, requests, reviews) fails quietly: Today still shows its bookings.

### Search page (`/search`)
Title "Find a court" in the display font. The search bar is the landing hero pill (Sport, Date, brand Search button; stacks below sm). Under it a row of pill chips: location (turns `--primary-soft` with a clear button once set), Distance and Sort as labelled pill selects, and "More filters" with a count of active filters; it toggles an inline surface panel (indoor, time range, price, free slots only), never a modal. Results are horizontal cards from sm: media column `--result-media` 15rem (min height `--result-min` 11rem; a 5:2 band on phones), venue photo or the venue's first sport drawn as a court in chalk on `--court-blue` over `--surround`; name in the display font with the rating, meta, sports, then next free slot in success-soft and the "from" price. The empty state is a tennis court drawing (`--empty-court` 7.5rem) with a "Clear filters" action. At lg the page is two columns (list 1.15fr, map 1fr) with the map sticky under the header and filling the viewport height; it opens on Dhaka.

## Results map
Leaflet with OpenStreetMap tiles. Tiles are always light, so they are never inverted in dark mode; the map frame, pins and the overlay controls use surface, border and primary tokens. The map opens fitted to every result; once the user zooms or pans, the list is limited to the map area (`bbox`) along with the other filters, and new results no longer move the map. Top centre: a "Search as I move the map" checkbox pill (on by default, searches 400ms after the map stops); turned off, a "Search this area" button appears after a move. Above the list a `--primary-soft` strip reads "Showing venues in the map area" with a "Show all" button that clears the area and refits the map. Pins are DOM-built (venue names are untrusted text), keyboard-focusable, and labelled with the venue name and price. Below lg a List/Map segmented toggle (`aria-pressed`) shows one at a time; at lg and up list and map sit side by side with the map sticky.

## Components
- Buttons: primary (solid), secondary (outline, surface bg), ghost, danger; sizes sm/md/lg; icon-only square. Label weight 500. On public pages the main CTA (Book, Pay) uses `--brand` with `--brand-fg`. Ghost buttons are for row actions in tables; a remove action standing alone inside a form (remove rule, remove photo) is secondary so it reads as a button.
- Inputs/selects: 36px, 1px border, label above (13px/500), helper 12px muted, error 12px danger. Selects in toolbars, filters and switchers may put a muted label beside the control (`layout="inline"`); selects inside forms keep the label above (`layout="stacked"`) so they line up with text fields. Every select drops the native arrow for one muted chevron (same in all browsers); focus lights the whole field or chip, never a ring inside it. Options open as a dropdown under the control (customizable select, `appearance: base-select`): at least as wide as the control, surface background, default border, `radius-md`, `shadow-md`, short fade and slide in. Rows are `control-md` tall with hover `bg-hover`; the chosen row is primary, medium weight, with a check at the end. Browsers without base-select fall back to the native picker. Phone input has a country prefix; OTP input is 6 single-digit boxes.
- Badges: pill, 12px/500, soft bg + fg from status colors; neutral badge uses subtle bg + muted text.
  - Booking status: confirmed = success, pending payment = warning, cancelled = danger, completed = neutral, refunded = info.
  - Member status: active = success, invited = info, disabled = neutral.
  - Series status: requested = warning, active = success, declined and cancelled = danger, withdrawn and ended = neutral. The "Series" marker on a booking is an info badge; it links to the series except inside a schedule block.
- Cards: surface bg, 1px border, xs shadow.
- Player series: the request page (`/venues/:slug/series`, brand tone, 28rem column) and the "Weekly bookings" cards above the My bookings tabs reuse the card, badge and `<details>` disclosure patterns; a series game in the single-bookings list shows the plain info "Series" badge, and on its detail page the badge links to the card.
- Tables: header 12px/500 muted, sentence case (no uppercase), rows separated by 1px subtle border, hover = subtle bg.
- Sidebar nav: 14px/500 items, 36px tall, 18px stroke icon, active = primary-soft bg + primary text, inactive = muted text (v2; see Owner portal shell).
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
- **Schedule (owner)**: courts as columns, time as rows (30/60 min); booking blocks use status soft bg + 3px left border in status fg; current-time line in danger, drawn behind each cell's text row so it never strikes through a label.
- **Booking summary card**: venue, court, date, time range, line items, total 20px/600 tabular, CTA full width.
- **Ratings**: stars use `--star-filled` (amber, lighter in dark) for a solid ★ and `--star-empty` (grey, 3:1 or more on the surface in light and dark) for an outline ☆, so filled and empty differ by shape as well as colour; 16px (`--star-size-sm`) or 24px (`--star-size-md`), drawn to the nearest half. An average shows as stars plus the number. Input stars are a radio group (arrow keys, visible focus ring) with a 36px (`--control-md`) hit area; the glyph is decorative and the label text names the radio.
- **Price**: always formatted with the owner's currency and locale via `Intl.NumberFormat`; never hand-built strings.

## Venue page
Centered in `--container`. Scrolling strips and tab lists carry `--space-1` padding so the focus ring is not clipped by the scroll container. Order, top to bottom:
- **Header**: Unbounded name (`--text-2xl`, `--text-3xl` from md) with a secondary Share button (native share sheet, else copy link with a 2s "Link copied" status); a meta row with the rating (links to `#reviews`) and the address with a pin icon; sports as pill chips.
- **Gallery**: phone = scroll-snap strip of all photos, tiles `--gallery-tile` wide at 4:3; md up = mosaic (2fr 1fr) of the first three at `--gallery-height`. "Show all N photos" expands the gallery inline (no modal). No photos = the sport's court drawing on `--surround`.
- **Book a court** (h2 + court count): ARIA court tabs, each a `--court-thumb` court drawing (court-blue + chalk when active) with name and "Indoor · sports · 90 min"; active tab has a `--brand` border. Two-line date chips (weekday or "Today" with a dot over day and month; selected = primary, `aria-current="date"`). Then the slot grid and the selection summary.
- **Amenities and location**: separated from booking by a hairline rule. Amenities are a ruled icon list (2 columns from sm); location is a Leaflet map (`--venue-map-height`, wheel zoom off, `--brand` pin) with the address and a "Get directions" link. Side by side from lg.
- **Reviews**: a side column with the heading and the big Unbounded average (`--text-4xl`), sticky from lg; a ruled list (no cards) with `--avatar-sm` initial discs, text capped at 65ch; owner replies sit in a `--bg-subtle` tinted block.

## Slot grid
Slots are grouped into Morning (before 12), Afternoon (before 17) and Evening, each with an h3 and a free count. From sm each group is one row: a `--slot-label` (7rem) label column, then cells in an auto-fill grid of at least `--slot-min` (6rem); on phone the label sits above. Cells are compact (`--control-lg` min height, 16px time over 12px price). Pending (warning-soft + "Pending") is always visually distinct from booked; every non-clickable cell puts its state in the label and `aria-label`, never colour alone. A null price shows "Unavailable" and is disabled. A legend sits under the grid. Any free slot on any day can be picked; each consecutive run (at most 12 slots) on a day is one booking, up to 14 bookings in one checkout (beyond that a `warning` Alert says so). Picks are kept per day while browsing dates and in `sessionStorage` per venue and court, so they survive a reload or coming back from checkout; slots that are no longer free drop out. A day with picks gets a count badge on its date strip chip (`--brand` circle, `--text-2xs` bold, hidden "N slots picked" in its name). Once a slot is picked on the shown day, "Copy these times to" appears under the grid: pill toggle chips (`--control-md`, `aria-pressed`) for the next 7 days, fetched lazily. A chip is on (`--primary-soft`, `--primary` border, check icon) when that day already has the same times; tapping it copies the times there, tapping again clears them. A day where any of the times is not free is disabled, dashed, on `--bg-subtle` with the date struck through and a hidden "not free" in its name. The selection summary (court, date, times, total, `--brand` Continue button) is an in-flow sticky bar at the bottom edge on phone showing only the times (or "N slots on M days"), total and the button, hidden until a slot is picked (so it never covers the last row, wraps for long Russian text), and a sticky side card of `--side-card-width` from lg that shows a pick hint while empty. With picks on several days the date fact becomes "Days": each date is an underlined button that opens that day (the shown one in `--primary`), its time ranges under it in muted `--text-sm`, and a small clear button; the total covers every day.

## Checkout
Add-ons (checkbox for per-booking, 40px stepper buttons for per-unit and per-hour) sit beside the booking summary card, which is a sticky `--side-card-width` card from lg and stacks below on phones. Summary rows are tabular; the total is 20px/600. When an advance is due, "Due now" and "Pay at the venue" rows follow the total. While a new quote loads the previous one stays visible, dimmed, with `aria-busy`. Auto-applied add-ons show as "Included" lines and are never selectable. The CTA is a `--brand` button (signed in) or sign-in/create-account links carrying `?next=` back to the checkout URL.

Several bookings (`more=date:start,start;date:start` in the URL, each its own day and times): the summary meta reads "Court · N bookings", then one row per booking ("Mon, Nov 3 · 09:00–10:00") with its slot price, add-ons tagged "each booking" with their summed price, then the group total, "Due now" and "Pay at the venue". One payment covers all of them. Guests cannot book several at once, so signed-out players see the account note. If any booking fails (taken, closed, out of window, out of stock), nothing is booked and an alert "Date time: reason" offers "Remove date time", which drops that booking from the URL and re-quotes (the next one becomes first when the first is dropped).
