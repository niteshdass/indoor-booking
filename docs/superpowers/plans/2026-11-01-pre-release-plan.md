# BookaTurf — Pre-release Plan

**Date:** 2026-11-01 · **Branch audited:** `demo` @ `ffa61c8`
**Source:** full audit of `apps/api`, `apps/web`, `packages/shared` + competitor research (Bangladesh, India, global, Russia/CIS).

Work top to bottom. Each item is one small PR: fix, test, tick the box. Phase 0 gates the soft launch; nothing in later phases blocks it.

## Where we stand

| Check | Result |
|---|---|
| Typecheck (all packages) | ✅ pass |
| API tests | ✅ 998 / 998 |
| Shared tests | ✅ 153 / 153 |
| Web tests | ❌ 34 failing (1 real bug, rest stale after Payments tab move `390b83c`) |
| Lint | ❌ 1 real error; ~7.8k noise from `.vercel/output` not ignored |
| Web build | ✅ builds; main chunk 1.29 MB (376 KB gz) |

Already solid (don't re-do): tenancy scoping at model level, booking transaction + `SlotLock` unique index, idempotent signed Stripe webhooks, late-payment revive/refund, tiered refund snapshot, DST-safe `localToUtc`, refresh-token family revocation, OTP limits, image magic-byte checks, job leases, outbox retries, EN/RU key parity with RU plurals, Intl formatting, checkout edge cases (slot taken, hold expiry, payment failure).

---

## Phase 0 — Release blockers (must fix before soft launch)

- [x] **P0-01 Today page links 404.**
  Today moved to `/owner/:id/today`; relative links in `apps/web/src/owner/today/Attention.tsx:66,99,159` resolve to `/owner/:id/today/bookings/…`, which has no route.
  *Fix:* build absolute owner paths (or `../bookings/…`).
  *Done when:* `test/owner/today.test.tsx` and `test/owner/shell.test.tsx` route assertions pass; clicking a booking from Today opens it.

- [x] **P0-02 Green web test suite.**
  Update stale tests in `test/owner/settings.test.tsx`, `venueSettingsGateway.test.tsx`, `provider.test.tsx` for the Payments tab / settings split (`390b83c`). Fix hardcoded value at `src/owner/today/TodayPage.module.css:11` flagged by `test/tokens.test.ts`.
  *Done when:* `pnpm test` is fully green.

- [x] **P0-03 Lint clean.**
  Add `.vercel/**` to `ignores` in `eslint.config.js`; fix `any` at `apps/api/test/admin/settings.test.ts:199`.
  *Done when:* `pnpm lint` exits 0.

- [x] **P0-04 Error boundary.**
  No `ErrorBoundary` / `errorElement` anywhere — any render throw blanks the app (checkout included).
  *Fix:* boundary around `<AppRoutes/>` with translated "Something went wrong · Reload" panel (EN + RU), tokens only.

- [x] **P0-05 Status badge contrast (WCAG AA).**
  `apps/web/src/styles/tokens.css:209-214` light success/warning/danger fg are 3.6–4.4:1 on soft bg at `text-xs`.
  *Fix:* darken to ≥4.5:1 (≈ `#0b7350`, `#8f5200`, `#b3261e`), update `.superdesign/design-system.md`.

- [x] **P0-06 Visible focus ring.**
  `--focus-ring` (`tokens.css:205,258`) is 1.8:1 light / 2.3:1 dark; box-shadow ring vanishes in forced-colors.
  *Fix:* solid 2px `outline` in `--primary` + offset in `base.css:44-47`; add `@media (forced-colors: active)` rule.

- [x] **P0-07 Refresh token only in cookie.**
  `apps/api/src/auth/tokens.ts:129` returns `refreshToken` in the JSON body; `auth/routes/session.ts:16-18` accepts it from body. XSS can steal a 30-day session.
  *Fix:* drop it from the body for web clients; refresh reads the httpOnly cookie only.

- [x] **P0-08 Rate-limit booking writes.**
  `apps/api/src/app.ts:46-110` limits auth/lookup/search only. Booking create, quote, manual-payment and reviews are open.
  *Fix:* per-IP + per-phone limiter (Mongo store) on those routes.

- [x] **P0-09 Demo mode can't run in production.**
  `apps/api/src/config.ts:54,127` allows `DEMO_MODE` with `NODE_ENV=production` → passwordless sign-in as seeded admin (`demo/accounts.ts:4`, `password123`).
  *Fix:* refuse to boot unless host is on an explicit `DEMO_HOSTS` allowlist.
  *Note:* demo code exists only on `demo`; fixed on branch `release/p0-09-demo-hosts` (off `demo`), not on `release/phase-0`.

- [x] **P0-10 Require `TRUST_PROXY` in production.**
  `config.ts:52,126`. Behind Vercel all clients share one rate-limit bucket.
  *Fix:* zod-require it when `NODE_ENV=production`.

- [x] **P0-11 Map tile provider.**
  `search/ResultsMap.tsx:29`, `venue/VenueAbout.tsx:25`, `owner/venues/LocationPicker.tsx:13` use `tile.openstreetmap.org` — not allowed for production traffic.
  *Fix:* keyed provider (MapTiler / Stadia / Carto) via `VITE_MAP_TILE_URL`, attribution kept.

**Gate:** all P0 ticked + `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter web build` green → soft launch Dhaka (manual bKash/Nagad TrxID verification is acceptable for soft launch).

---

## Phase 1 — Launch hardening (first week live)

- [x] **P1-01 Payment index.** Add `{bookingId:1, kind:1, status:1}` to `apps/api/src/bookings/payment.model.ts`; queries at `bookings/routes/public.ts:127`, `jobs/sweeps.ts:120,177` scan today.
- [x] **P1-02 Stripe refunds/disputes from dashboard.** Handle `charge.refunded`, `charge.dispute.created/closed` in `payments/stripe.ts:138-165`; sync refund rows, flag booking, notify owner.
- [x] **P1-03 Job cadence.** Vercel Hobby cron = daily; reminders can lag 24h. Use paid cron or external pinger every 1–5 min hitting `serverless.ts` (compare `CRON_SECRET` with `timingSafeEqual`).
- [x] **P1-04 Health check reflects DB.** `routes/health.ts` → 503 when DB down.
- [x] **P1-05 TTL on token tables.** `expireAfterSeconds: 0` on `expiresAt` for RefreshToken, OTP, PasswordReset.
- [x] **P1-06 Forgot-password enumeration.** `auth/routes/emailAuth.ts:86-103` — queue via outbox, always 200.
- [x] **P1-07 Per-account login lockout.** Limiter keyed on email in addition to IP.
- [x] **P1-08 Security headers + request logs.** `helmet()` + `pino-http` with request id in `app.ts`.
- [x] **P1-09 SEO + share previews.** Per-route `document.title`; OG/Twitter tags for `/venues/:slug` via Vercel edge rewrite or API-rendered HTML; `robots.txt`, `sitemap.xml`, meta description in `index.html`.
- [x] **P1-10 `<html lang>` follows language.** Set `document.documentElement.lang` in `i18n/index.ts:26` `languageChanged`.
- [x] **P1-11 Timeline status not by colour alone.** `owner/today/CourtTimeline.tsx:285-298` — add icon/pattern per kind (e.g. dashed for waiting).
- [x] **P1-12 Code-split.** `lazy()` Leaflet components (`VenueAbout`, `LocationPicker`) and `/owner/*`, `/admin/*` route trees. Target main chunk < 500 KB.
- [x] **P1-13 Catch-all routes + styled 404.** `path="*"` in `ownerRoutes.tsx`, `adminRoutes.tsx`; `pages/NotFoundPage.tsx` uses EmptyState.
- [x] **P1-14 Touch targets ≥ 44px on phones.** `(pointer: coarse)` → `min-height: var(--control-lg)` for buttons/nav (`Button.module.css`, `AppShell.module.css:59`).
- [x] **P1-15 `--text-subtle` used as text.** 3.0:1 — switch text uses to `--text-muted`.
- [x] **P1-16 Skip link, PWA manifest, theme-color, apple-touch-icon.**
- [x] **P1-17 Error reporting.** Sentry (web boundary + API error handler).
- [x] **P1-18 Brand leftover.** `admin/AdminSettingsPage.tsx:151` placeholder still says "Slots".

**Ops left after merge (code is done, these need accounts/hosting):**
- P1-03: set `CRON_SECRET` and point a pinger (cron-job.org, every 1 min) at `GET /api/v1/jobs/tick` — `docs/jobs-cron.md`. On `demo`, drop the older tick route in `serverless.ts`; `createApp` now mounts one with `timingSafeEqual`.
- P1-09: add the robots/sitemap/preview-bot routes to `scripts/vercel-build.mjs` on `demo` — `docs/seo.md`. Submit the sitemap in Search Console.
- P1-17: create Sentry projects, set `SENTRY_DSN` (API) and `VITE_SENTRY_DSN` (web).

**Gate (release/phase-1):** typecheck ✅ · lint ✅ · API 1012/1012 · web 867/867 · shared 153/153 · build ✅ (main chunk 361 KB / 108 KB gz, was 1.29 MB).

---

## Phase 2 — Competitor parity for Bangladesh (table stakes)

Every serious BD competitor has these. Without them owners compare us unfavourably to Turfly / TurfBook.

| # | Feature | Why (who has it) | Notes |
|---|---|---|---|
| [x] P2-01 | **Automatic bKash / Nagad checkout** via SSLCommerz or EPS | Turfly, TurfHub, Turffin, TurfBook | Done with SSLCommerz (`payments/sslcommerz.ts`): hosted checkout per owner store, notices checked with the Validation / transaction APIs, return route + 5-min reconcile sweep, refunds by `bank_tran_id`. Manual TrxID stays as fallback; walk-in links stay Stripe. |
| [x] P2-02 | **Local BD SMS gateway** (confirm, reminder, OTP) | TurfBook (metered SMS), all | Done with SSL Wireless and BulkSMSBD (`notifications/senders.ts`): +8801 numbers go by the BD provider when one is set, everything else by Twilio. Optional metering: owners' booking SMS is charged in SMS parts against admin-granted credits (refunded on a failed send); OTPs are never charged. Alpha SMS not added. |
| [x] P2-03 | **Bangla (bn) UI** | Gap — competitors barely do it | Done: `bn` in shared `LOCALES` and the language menu, full `bn.json` (lazy, ~31 kB gzip), Bangla email/SMS templates, Bangla digits and dates via Intl. Noto Sans Bengali joins both font stacks; `:lang(bn)` raises line heights. Bangla runs 1.01× English overall (test caps it at 1.3×). |
| [x] P2-04 | **Coupons / promo codes** | Turfly, Khelboo, TurfBook | Done: owner coupons (percent with optional cap, or fixed), validity window, total and per-customer use caps, minimum spend, per-venue or all venues, new `coupon.manage` permission. `quoteBooking()` takes the discount off slots + add-ons before the platform fee and advance; a group splits one discount across its bookings and counts as one use. Uses are counted from live bookings, so expired, rejected and cancelled ones free theirs. Bookings keep a `{code, discount}` snapshot. Promo field at checkout; Coupons page in the owner dashboard. |
| [ ] P2-05 | **Reschedule / move booking** (owner + player within policy) | Turffin, Playo | Not present anywhere. Reuse slot lock in one transaction; keep payments attached. |
| [ ] P2-06 | **CSV export** of bookings & payments | TurfBook reports, roadmap #16 | Not present. Owner reports page + bookings list. |
| [ ] P2-07 | **Deposit / partial payment with dues tracking** surfaced to owners | TurfBook, Turffin | Partial advance exists in settings; make "due at desk" visible on Today and in reports. |
| [ ] P2-08 | **Player conveniences:** add to calendar (.ics), book again, saved venues | Turfly (one-tap rebook), Playo | Cheap, high retention. |
| [ ] P2-09 | **Weekly payouts / commission** (if marketplace collects) | Playo, TurfHub | Roadmap #19. Only needed if we collect money; owners currently use their own gateways. |

**Ops left for P2-01 (code is done):**
- Each owner needs an SSLCommerz merchant store (sandbox first) and enters its store ID + password under Settings → SSLCommerz, then switches it on per venue.
- `API_URL` must be public over HTTPS: SSLCommerz posts the IPN to `/api/v1/webhooks/sslcommerz/:ownerId` and sends players back through `/…/return`. Give owners the IPN URL shown on the card to set in their merchant panel.
- The refund API only answers whitelisted IPs: ask SSLCommerz to whitelist the API server's outbound IP for every live store (serverless needs a static egress IP).
- `PAYMENTS_ENCRYPTION_KEY` must be set (store passwords are sealed with it).

**Ops left for P2-02 (code is done):**
- Open an SSL Wireless (SMS Plus) or BulkSMSBD account and get a sender ID or masking name approved (BTRC rules apply to masking). Enter the API key and sender ID under Admin → Settings → Bangladesh SMS, or set `SSL_WIRELESS_API_TOKEN` + `SSL_WIRELESS_SID` / `BULKSMSBD_API_KEY` + `BULKSMSBD_SENDER_ID`.
- Send a test SMS to a +8801 number from the admin settings page before going live.
- BulkSMSBD may need the API server's outbound IP whitelisted in its panel.
- Metering is off by default. Before turning it on (Admin → Settings), grant every owner credits on Admin → Owners, or their booking SMS stops.

**Gate (release/p2-02-bd-sms):** typecheck ✅ · lint ✅ · API 1053/1053 · web 885/885 · shared 158/158 · build ✅

**Ops left for P2-03 (code is done):**
- Have a native Bangla speaker read `bn.json` and the bn templates in `notifications/templates.ts`, especially the landing page and owner settings. The translation was machine-made with a fixed glossary (venue ভেন্যু, turf মাঠ, recurring booking নিয়মিত বুকিং).
- Click through Today, Walk-in, Bookings and checkout in Bangla on a phone to check that nothing wraps badly.
- Login OTP text (`auth/otp.ts`) is still English only: the sign-in request carries no locale yet.
- Bangla SMS is UCS-2 (70 characters a part), so a Bangla booking SMS costs about 2 parts against 1 in English. Size the owners' SMS credits with that in mind.
- The landing FAQ still answers "Is it in Russian?". Consider changing it to ask about Bangla.

**Gate (release/p2-03-bangla):** typecheck ✅ · lint ✅ · API 1055/1055 · web 892/892 · shared 158/158 · build ✅

**Ops left for P2-04 (code is done):**
- Deploy builds the new indexes: `coupons {ownerId, code}` unique and `bookings {ownerId, coupon.couponId}` partial.
- Online checkout only: walk-ins and recurring series take no coupon yet.
- Brute-forcing codes is slowed only by the existing quote rate limit (300 per window); watch `coupon_invalid` volume after launch.
- A fixed coupon is in the owner's default currency and is refused at a venue priced in another.

**Gate (release/p2-04-coupons):** typecheck ✅ · lint ✅ · API 1091/1091 · web 906/906 · shared 168/168 · build ✅

---

## Phase 3 — Get ahead of competitors (differentiators)

BD market is fragmented (largest verified network ≈ 23 venues). Nobody combines a strong marketplace with a strong owner OS — our Today timeline, recurring bookings, add-ons and reports already cover the owner side. These items widen the lead.

| # | Feature | Gap it exploits |
|---|---|---|
| [ ] P3-01 | **Split payment among players** — organiser books, each player pays their share by link; unpaid shares fall to organiser before start | Turfly lists it "coming soon"; nobody in BD has it live. Football 5v5/7v7 squads split every booking. |
| [ ] P3-02 | **Find players / open games / need an opponent** — post open slots, skill level, join requests | Turfly, TurfHub, Turf Town, Hudle drive repeat use with this. |
| [ ] P3-03 | **Rain / weather policy** — owner-triggered closure → automatic refund or rebook credit | TurfHub only (unverified scale). Monsoon market; outdoor turfs lose bookings every week. |
| [ ] P3-04 | **Off-peak & last-minute pricing** — discount empty afternoons, auto price drop N hours before | Turfly. Our pricing rules engine already supports time bands; add last-minute rule. |
| [ ] P3-05 | **Wallet / credits** — refunds to wallet, loyalty points, referral credit | Playo Karma, Playtomic, Turfly. Avoids bKash reversal fees. |
| [ ] P3-06 | **Memberships & fixed-slot team packages** — monthly slot, priority booking, member price | Playtomic Champion tier. Builds on our recurring series. |
| [ ] P3-07 | **POS for walk-ins** — sell add-ons/drinks, 58/80 mm receipt printing | TurfBook, Playtomic Professional. |
| [ ] P3-08 | **Tournaments & leagues** — brackets, entry fees, corporate leagues | TurfHub, Hudle. New revenue line. |
| [ ] P3-09 | **WhatsApp reminders** + **VAT invoice** for corporate teams | Turffin (VAT). WhatsApp is the BD default channel. |
| [ ] P3-10 | **Embeddable booking widget / link for the venue's Facebook page** | FindSport, Fitbase. Most BD supply is booked through Facebook today. |
| [ ] P3-11 | **No-show protection** — required bKash deposit for late-night slots, no-show strike list | Barely marketed by anyone; late-night slots are the money slots. |
| [ ] P3-12 | **Waitlist** — notify when a held/pending slot frees up | Nobody in BD. |

---

## Phase 4 — Russia / CIS

- [ ] **P4-01 RU payments:** Stripe does not work in Russia. Add YooKassa + SBP QR as `PaymentGateway` before marketing in RU.
- [ ] **P4-02 SaaS pricing in RUB** (marketplace commission less proven there; YCLIENTS / Fitbase are SaaS).

---

## Pricing proposal (Bangladesh)

- Free for players; optional ≤2–3% convenience fee on online payments to cover gateway cost.
- **Free owner tier:** listing + owner portal; ~5–8% commission only on bookings that come through BookaTurf online. Walk-in/desk bookings free.
- **Pro tier ≈ 1,500–3,000 BDT / venue / month** (not benchmarked): POS, SMS bundle, staff roles, memberships, dynamic pricing, branded link, ~3% commission.
- SMS as metered credit. Weekly payouts to bKash or bank.
- Anchors: TurfBook ≈ 10–15 BDT per slot; Pitchbooking 5% or £25/facility/month; Playo/Hudle pure commission (rates private).

---

## Competitor reference

| Product | Market | Model | Payments | Notable |
|---|---|---|---|---|
| Turfly | BD (Dhaka, ~23 venues) | Marketplace + operator portal | bKash, Nagad, cards (SSLCommerz), wallet | Join a game, off-peak deals, rebook, loyalty; split pay "coming soon" |
| TurfBook | BD | Owner SaaS, ~10–15 BDT/slot or monthly | Cash, bKash/Nagad, partial + dues | POS + receipt printers, SMS, staff roles, coupons, reports |
| TurfHub.bd | BD | Marketplace, owner commission | bKash, Nagad, Rocket, cards | Matchmaking, tournaments, weather refund; scale claims unverified |
| Turffin | BD | Marketplace + owner tool, setup + monthly | EPS (many BD wallets) | Deposit/full prepay, VAT invoices, rescheduling; 0 live venues seen |
| Khelboo, Khelbokoi | BD | Small marketplaces | — | Promo codes |
| Playo | India | Commission marketplace, weekly payouts | — | Partner app, Karma points |
| Hudle | India | Marketplace + venue ops | — | 2,000+ venues, leagues |
| Playtomic | Global | Player network + Manager SaaS tiers | Cards, wallet | Split payment, memberships, leagues, POS |
| CourtReserve | Global | Venue SaaS | Cards | Memberships, leagues, branded app (top tiers) |
| Pitchbooking | UK | £25/facility/mo or 5% | Cards | Public-sector venues |
| YCLIENTS, FindSport, Fitbase | Russia | CRM / marketplace | SBP, YooKassa | Booking widgets |

Sources: [Turfly](https://apps.apple.com/us/app/turfly/id6756574386) · [TurfHub](https://turfhub.bd/) · [TurfBook](https://turfbook.vip/) · [Turffin](https://www.turffin.com/) · [Khelboo](https://www.khelboo.com/) · [Playo payouts](https://playo-partner.freshdesk.com/support/solutions/articles/1070000136933-how-do-payments-to-partners-work-on-playo-) · [Hudle](https://startupwired.com/2025/07/21/hudle-raises-2-5m-to-scale-sports-tech-platform/) · [Playtomic pricing](https://playtomic.com/pricing) · [Playtomic split pay](https://playerhelp.playtomic.com/hc/en-gb/articles/19832089052561-How-to-split-the-payment-of-a-reservation) · [CourtReserve fees](https://help.courtreserve.com/en/articles/7172928-convenience-fees) · [Pitchbooking pricing](https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-15/documents/709863/982119564479920-pricing-document-2025-10-28-0956.pdf) · [FindSport](https://findsport.ru/)

Caveats: Playtomic/CourtReserve prices come from third-party listings; Playo/Hudle/TurfHub commission rates are not public; TurfHub's scale claims look inflated.
