# Product

## Register

product

The owner portal and player booking flow are the primary surfaces. The marketing landing at `/` is a brand surface and is treated as brand when it is the task.

## Users
- **Venue owners and staff** at indoor and outdoor sports venues (courts, pitches, lanes). They run one or more venues, often from a desk at the venue or a phone on the floor, between walk-ins and phone calls. Job: see today's courts at a glance, act on what needs them (confirm, take a walk-in, reply to a weekly request, collect payment) fast and calmly.
- **Players** looking for a court for tonight or the weekend, mostly on a phone. Job: find a free slot near them, trust the venue page, book and pay without an account if they want.
- English and Russian speakers. Bangladesh and similar markets first (BDT, Asia/Dhaka), so prices, times and dates must read naturally in both languages.

## Product Purpose
Multi-vendor slot booking for sports venues. Owners publish courts, hours and prices; players book and pay online (Stripe) or at the desk. Success: owners run the day from the Today page without a paper sheet, and players finish a booking in under a minute.

## Brand Personality
Sporty, calm, trustworthy. The look of a hard court: court blue, chalk lines, a little ball yellow. Confident but quiet; the court drawing is the one bold device, everything else steps back. Copy is plain, short, and sentence case, written for someone mid-task.

## Anti-references
- Generic SaaS dashboards: identical rounded card grids, gradient washes, hero-metric templates.
- Booking sites stuffed with stock photos of people playing, gradient blobs, carousels.
- All-caps eyebrow labels, "→" in buttons, numbered markers on things that are not a sequence.
- Neon-on-black "gamer" sports aesthetics.

## Design Principles
1. **Spend boldness once per screen.** Landing: the hero court panel. Portal: the live court timeline. The rest is neutral surfaces, 1px borders, status color only where status lives.
2. **Act from where you look.** Owners should be able to act on a thing (confirm, open, collect) from the place it shows up, not hunt for it.
3. **Calm under load.** A busy evening with 40 bookings must read as clearly as a quiet morning; density without noise.
4. **Russian fits, phones work.** Every string can run 30% longer; every screen works at 390px.
5. **Owner brand only where it belongs.** The venue's own color appears on its public page, never in portal chrome or the marketing site.

## Accessibility & Inclusion
WCAG 2.2 AA: text contrast in light and dark, visible keyboard focus, labelled controls, status never by color alone (text labels on every status). `prefers-reduced-motion` shows end states. Touch targets at least 44px on phone layouts.
