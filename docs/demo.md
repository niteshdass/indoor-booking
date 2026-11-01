# Demo deploy

The `demo` branch runs a public demo. Visitors open the login page and get one-tap buttons for each role: Admin, Venue owner, Front desk and Player. Each button signs them into a seeded account. They can use the whole app, but the following are read-only:

- Admin > Settings: Stripe, email/SMTP, SMS, Google, General and Payout.
- Owner payment gateways.
- Disabling or enabling users, and suspending owners.
- Editing or removing team members.
- Profile, email, phone and password changes, and password reset.

A blocked request returns `403 demo_locked`, and the UI shows "This is turned off in the demo."

## 1. Database (MongoDB Atlas)

1. In Atlas, create a database user under **Database Access**.
2. Under **Network Access**, allow your own IP so you can seed from your machine. Also allow the API host's outbound IP, or `0.0.0.0/0` if the host has no fixed IP.
3. Copy the connection string from **Connect > Drivers**. Add a database name that is used **only** for the demo, for example:

   ```
   mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/slot-demo?retryWrites=true&w=majority
   ```

## 2. Seed from your machine

```bash
MONGODB_URI="mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/slot-demo" \
NODE_ENV=development \
pnpm --filter api seed --reset
```

> **Warning:** `--reset` deletes every collection in that database except `migrations`. Point the command at the demo database only, never at real data.

The seed refuses to run when `NODE_ENV=production`, so set it to `development` for this one command. Variables passed on the command line take precedence over the root `.env`.

The seed creates these accounts, which the demo buttons sign into. Each has the password `password123`:

| Button      | Account                  |
|-------------|--------------------------|
| Admin       | `admin@seed.local`       |
| Venue owner | `owner@seed.local`       |
| Player      | `player1@seed.local`     |

If the database has not been seeded, the buttons show "The demo data isn't loaded yet."

### Re-seed regularly

Bookings are generated relative to the day you seed, so the data gets stale over time. Changes made by visitors (bookings, venues, prices) are also kept. Re-run the seed command every week or two, or run it nightly from a scheduled job.

## 3. API env

Set these on the API host:

| Variable                  | Value                                                  |
|---------------------------|--------------------------------------------------------|
| `DEMO_MODE`               | `true`                                                 |
| `NODE_ENV`                | `production`                                           |
| `MONGODB_URI`             | the Atlas string from step 1                           |
| `JWT_SECRET`              | 32+ random characters (`openssl rand -base64 48`)      |
| `PAYMENTS_ENCRYPTION_KEY` | `openssl rand -base64 32`                              |
| `APP_URL`                 | the web app's public URL                               |
| `CORS_ORIGIN`             | the web app's public URL                               |
| `TRUST_PROXY`             | `1` when the host sits behind a proxy or load balancer |

If `DEMO_MODE` is anything other than `true`, the demo routes are not mounted and nothing is locked.

## 4. Web env

Set `VITE_API_URL` at build time to the API's public base, for example `https://api.example.com/api/v1`. The login page asks `/auth/providers` whether demo mode is on and shows the role buttons only when it is.
