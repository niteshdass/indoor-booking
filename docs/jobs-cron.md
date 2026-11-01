# Running background jobs

Holds expire, reminders go out, notices are delivered and card refunds are reconciled by background jobs (`apps/api/src/jobs/runner.ts`). Each job has its own interval, from 15 seconds to 1 hour. A job lease stops two callers from running the same job at once.

## Long-running server

`pnpm --filter api start` runs the jobs inside the API process. Leave `JOBS_ENABLED=true`, which is the default. If you run several API servers, set `JOBS_ENABLED=false` on all but one, or leave it on everywhere and let the leases sort it out.

## Serverless (Vercel)

A function only runs while it handles a request, so something has to call it on a schedule:

1. Set `CRON_SECRET` on the API, for example from `openssl rand -hex 32`. The API mounts `GET /api/v1/jobs/tick` only when it is set.
2. Call that URL every 1 to 5 minutes with the header `Authorization: Bearer <CRON_SECRET>`. Each call runs the jobs that are due and returns their names: `{"ran": ["expire-holds", ...]}`. A wrong or missing secret gets `401`.

Vercel Cron on the Hobby plan runs **once a day**, which is not often enough: reminders and hold expiry could lag by up to 24 hours. Use one of these instead:

- **External pinger (free):** cron-job.org lets you set a custom `Authorization` header and run every minute. A GitHub Actions `schedule` workflow also works, but runs at most every 5 minutes and is often late.
- **Vercel Pro:** add a cron for `/api/v1/jobs/tick` to `vercel.json`. Vercel sends `CRON_SECRET` as the bearer token by itself.

If reminders stop arriving, check the pinger's history first.
