# Plan 02 — Auth & Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platform-level user accounts that can sign in with email + password, phone + OTP or Google, link several methods to one account, and use short-lived JWT access tokens with rotating refresh tokens — API only, usable unchanged by web and future mobile apps.

**Architecture:** New `apps/api/src/auth/` module: pure crypto/token helpers, a `User` model, a `RefreshToken` model (rotation with reuse detection), an `OtpCode` model, and one Express router per sign-in method plus `/me`. External effects (SMS, email, Google token verification, current time) are injected through `AppServices` so tests use fakes. `requireAuth` middleware is the hand-off to Plan 03.

**Tech Stack:** Plan 01 stack + `jose` (JWT HS256), Node `crypto.scrypt` (passwords, no native deps), `libphonenumber-js` (E.164), `google-auth-library` (ID-token verification), `cookie-parser`, `express-rate-limit`.

**Spec:** `docs/superpowers/specs/2026-10-23-sports-slot-booking-design.md` §4, §5 (Players), §10 (guest OTP reuses `OtpService` later). Roadmap: `docs/superpowers/plans/2026-10-23-roadmap.md`.

## Global Constraints

- Plan 01 constraints still apply (TS strict, ESM, error shape `{ error: { code, message, details? } }`, `/api/v1`, i18n strings never hard-coded in web — this plan is API-only).
- Players are platform-level (no `ownerId` on `users`).
- Login methods: phone + OTP, email + password, Google. One account can link multiple methods.
- JWT access token + refresh token so mobile apps can use the API unchanged.
- Never store secrets in plain text: passwords (scrypt), refresh tokens, OTP codes and reset tokens are stored only as hashes.
- Times compared via injected `services.now()` (never `Date.now()` directly in auth code) so expiry is testable.

## Decisions made in this plan (builder's calls)

- Access token: JWT HS256, 15 min, claims `{ sub: userId, typ: 'access' }`, secret `JWT_SECRET` (≥ 32 chars).
- Refresh token: 32 random bytes base64url, opaque, 30 days, stored as sha256 hash with a `familyId`. Each refresh rotates; reusing a rotated token revokes the whole family.
- Delivery: every token response body is `{ user, accessToken, refreshToken }` (mobile). Web also gets refresh token as httpOnly cookie `rt` (`SameSite=Lax`, `Secure` in production, path `/api/v1/auth`). `/auth/refresh` and `/auth/logout` accept the cookie or a body field.
- Emails are trimmed + lowercased. Phones normalized to E.164; input without `+country` is rejected (worldwide target — no default country).
- OTP: 6 digits, 5 min expiry, max 5 verify attempts per code, 60 s resend cooldown, max 5 requests per phone per hour. `purpose` field (`login` | `link` | `guest_booking`) so Plan 07 reuses it.
- Google login never auto-merges into an existing account by email: if the Google email belongs to an account without that Google identity → `409 account_exists` (user logs in another way, then links). Prevents takeover via unverified emails.
- Password reset by emailed token (1 h, single use) is in scope; email verification is deferred to Plan 10 (`emailVerified` stored, false for email sign-up, true for Google).
- No unlinking in this plan (YAGNI).

## Review Focus

1. Same email typed differently (`" Ana@X.com "` vs `"ana@x.com"`) → treated as one account on register and login.
2. Same phone typed differently (`"+880 1712-345678"` vs `"+8801712345678"`) → one account; local number without country (`"01712345678"`) → `400 invalid_phone`.
3. Refresh token used a second time after rotation → `401 token_reused` and every token in that family stops working.
4. Two concurrent registrations with the same email → exactly one `201`, the other `409 email_in_use` (unique index, not check-then-insert).
5. OTP brute force → after 5 wrong attempts the code is dead even if the 6th guess is right (`429 otp_attempts_exceeded`).

---

## File Structure

```
apps/api/src/
  config.ts                     # MODIFY: + jwtSecret, googleClientId?, appUrl
  app.ts                        # MODIFY: + services in AppDeps, cookie-parser, mount auth + me routers
  services.ts                   # AppServices type + defaultServices(config)
  auth/
    crypto.ts                   # hashPassword, verifyPassword, randomToken, sha256
    jwt.ts                      # signAccessToken, verifyAccessToken
    normalize.ts                # normalizeEmail, normalizePhone
    user.model.ts               # User mongoose model + toPublicUser
    refreshToken.model.ts
    otp.model.ts
    passwordReset.model.ts
    tokens.ts                   # issueTokens, rotateRefreshToken, revokeFamily, setRefreshCookie
    requireAuth.ts              # middleware; req.auth
    otp.ts                      # requestOtp, verifyOtp (OtpService)
    google.ts                   # GoogleVerifier interface + real impl
    routes/
      emailAuth.ts              # /auth/register, /auth/login, /auth/password/*
      phoneAuth.ts              # /auth/otp/request, /auth/otp/verify
      googleAuth.ts             # /auth/google
      session.ts                # /auth/refresh, /auth/logout
      me.ts                     # /me, /me/link/*
apps/api/test/
  helpers/testServices.ts       # fakes: FakeSms, FakeEmail, FakeGoogle, controllable clock
  helpers/testApp.ts            # buildTestApp() = createApp with test config + fakes
  auth/crypto.test.ts
  auth/normalize.test.ts
  auth/tokens.test.ts
  auth/emailAuth.test.ts
  auth/phoneAuth.test.ts
  auth/googleAuth.test.ts
  auth/me.test.ts
```

---

### Task 1: Config, services and crypto/normalize helpers

**Files:**
- Modify: `apps/api/src/config.ts`, `apps/api/src/app.ts`, `apps/api/test/config.test.ts`, `apps/api/test/app.test.ts`, `.env.example`
- Create: `apps/api/src/services.ts`, `apps/api/src/auth/crypto.ts`, `apps/api/src/auth/jwt.ts`, `apps/api/src/auth/normalize.ts`, `apps/api/test/helpers/testServices.ts`, `apps/api/test/helpers/testApp.ts`, `apps/api/test/auth/crypto.test.ts`, `apps/api/test/auth/normalize.test.ts`

**Interfaces:**
- Consumes: Plan 01 `loadConfig`, `createApp`, `AppError`.
- Produces:
  - `Config` gains `jwtSecret: string` (env `JWT_SECRET`, required, min 32), `googleClientId?: string` (`GOOGLE_CLIENT_ID`), `appUrl: string` (`APP_URL`, default `http://localhost:5173`)
  - `interface SmsSender { send(to: string, text: string): Promise<void> }`
  - `interface EmailSender { send(msg: { to: string; subject: string; text: string }): Promise<void> }`
  - `interface GoogleVerifier { verify(idToken: string): Promise<{ sub: string; email?: string; emailVerified: boolean; name?: string }> }` (throws `AppError(401,'invalid_google_token')`)
  - `type AppServices = { now: () => Date; sms: SmsSender; email: EmailSender; google: GoogleVerifier }`
  - `defaultServices(config: Config): AppServices` — console SMS/email senders (log only) until Plan 10; real Google verifier
  - `AppDeps` gains `services: AppServices`
  - `hashPassword(plain: string): Promise<string>` → `scrypt$N$r$p$saltB64$hashB64`; `verifyPassword(plain: string, stored: string): Promise<boolean>` (constant-time compare)
  - `randomToken(bytes?: number): string` (base64url, default 32); `sha256(value: string): string` (hex)
  - `signAccessToken(userId: string, secret: string, now: Date): Promise<string>`; `verifyAccessToken(token: string, secret: string, now: Date): Promise<{ userId: string }>` (throws `AppError(401,'invalid_token')`)
  - `normalizeEmail(input: string): string` (throws `AppError(400,'invalid_email')`); `normalizePhone(input: string): string` (E.164, throws `AppError(400,'invalid_phone')`)
  - test helpers: `makeTestServices(): TestServices` with `sms.sent: {to,text}[]`, `email.sent: {...}[]`, `google.register(idToken, profile)`, `clock.advance(ms)`, `now()`; `buildTestApp(services?): { app, services }` (test config `jwtSecret: 'x'.repeat(32)`)

- [ ] **Step 1: Write failing tests.**
  - `config.test.ts`: update "applies defaults" to pass `JWT_SECRET: 's'.repeat(32)` and expect `jwtSecret`, `appUrl: 'http://localhost:5173'`, no `googleClientId` key; add `it('rejects JWT_SECRET shorter than 32 chars')` → throws `/JWT_SECRET/`.
  - `app.test.ts`: build via `createApp({ config, dbState, services: makeTestServices(), extraRoutes })`; existing assertions unchanged.
  - `crypto.test.ts`:
    ```ts
    it('hashes and verifies passwords', async () => {
      const h = await hashPassword('correct horse');
      expect(h).toMatch(/^scrypt\$/);
      expect(await verifyPassword('correct horse', h)).toBe(true);
      expect(await verifyPassword('wrong', h)).toBe(false);
    });
    it('salts every hash', async () => {
      expect(await hashPassword('a')).not.toBe(await hashPassword('a'));
    });
    it('access token round-trips and expires after 15 minutes', async () => {
      const t0 = new Date('2026-01-01T00:00:00Z');
      const tok = await signAccessToken('u1', SECRET, t0);
      expect(await verifyAccessToken(tok, SECRET, new Date(t0.getTime() + 14 * 60_000))).toEqual({ userId: 'u1' });
      await expect(verifyAccessToken(tok, SECRET, new Date(t0.getTime() + 16 * 60_000)))
        .rejects.toMatchObject({ status: 401, code: 'invalid_token' });
      await expect(verifyAccessToken(tok, 'y'.repeat(32), t0)).rejects.toMatchObject({ code: 'invalid_token' });
    });
    it('randomToken is url-safe and unique', () => {
      const a = randomToken(); expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(randomToken()).not.toBe(a);
    });
    ```
  - `normalize.test.ts`:
    ```ts
    expect(normalizeEmail(' Ana@X.com ')).toBe('ana@x.com');
    expect(() => normalizeEmail('nope')).toThrow(expect.objectContaining({ code: 'invalid_email' }));
    expect(normalizePhone('+880 1712-345678')).toBe('+8801712345678');
    expect(normalizePhone('+7 912 345-67-89')).toBe('+79123456789');
    expect(() => normalizePhone('01712345678')).toThrow(expect.objectContaining({ code: 'invalid_phone' }));
    expect(() => normalizePhone('+1 123')).toThrow(expect.objectContaining({ code: 'invalid_phone' }));
    ```
- [ ] **Step 2:** Run `pnpm --filter api test`. Expected: FAIL (missing modules / config mismatch).
- [ ] **Step 3:** Implement. scrypt params N=16384, r=8, p=1, keylen 64, salt 16 bytes; compare with `crypto.timingSafeEqual`. JWT via `jose` `SignJWT` with `setIssuedAt(now)`, `setExpirationTime(now + 15 min)`; verify with `jwtVerify(token, key, { currentDate: now })`. Phone via `parsePhoneNumberWithError(input)` requiring leading `+` and `isValid()`. Email: trim, lowercase, regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`. Update `server.ts` to pass `services: defaultServices(config)`. Add `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `APP_URL` to `.env.example`.
- [ ] **Step 4:** Run `pnpm --filter api test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): auth config, services and crypto helpers`.

---

### Task 2: User model, tokens and requireAuth

**Files:**
- Create: `apps/api/src/auth/user.model.ts`, `apps/api/src/auth/refreshToken.model.ts`, `apps/api/src/auth/tokens.ts`, `apps/api/src/auth/requireAuth.ts`, `apps/api/src/auth/routes/session.ts`, `apps/api/test/auth/tokens.test.ts`
- Modify: `apps/api/src/app.ts` (mount session router under `/auth`, `cookie-parser`)

**Interfaces:**
- Consumes: Task 1 helpers, `AppServices`, `startTestDb` (Plan 01).
- Produces:
  - `User` model fields: `name: string` (default `''`), `email?: string` (unique where exists), `emailVerified: boolean` (default false), `passwordHash?: string`, `phone?: string` (unique where exists), `phoneVerified: boolean`, `googleSub?: string` (unique where exists), `status: 'active' | 'disabled'` (default active), timestamps. Unique indexes are **partial** (`partialFilterExpression: { field: { $type: 'string' } }`).
  - `type PublicUser = { id: string; name: string; email: string | null; emailVerified: boolean; phone: string | null; hasPassword: boolean; hasGoogle: boolean }`; `toPublicUser(doc): PublicUser`
  - `RefreshToken` model: `{ userId, familyId, tokenHash (unique), expiresAt, usedAt?: Date, revokedAt?: Date }`
  - `issueTokens(userId: string, services: AppServices, config: Config, familyId?: string): Promise<{ accessToken: string; refreshToken: string }>`
  - `rotateRefreshToken(raw: string, services, config): Promise<{ userId: string; accessToken: string; refreshToken: string }>` — errors `401 invalid_refresh_token` (unknown/expired/revoked), `401 token_reused` (already used → revoke family)
  - `revokeFamilyByToken(raw: string): Promise<void>`; `revokeAllForUser(userId: string): Promise<void>`
  - `sendAuthResponse(res, status: number, user: UserDoc, tokens, config): void` — sets cookie `rt`, JSON `{ user: PublicUser, accessToken, refreshToken }`
  - `requireAuth(config, services): RequestHandler` — reads `Authorization: Bearer`, sets `req.auth = { userId }`; `401 unauthenticated` when missing, `401 invalid_token` when bad; rejects `disabled` users with `403 account_disabled`
  - Routes: `POST /auth/refresh` (body `{ refreshToken? }` or cookie `rt`) → 200 token response; `POST /auth/logout` → 204, clears cookie

- [ ] **Step 1: Write failing tests** in `tokens.test.ts` (seed a user directly with `User.create({ name: 'A' })`):
  ```ts
  it('refresh rotates the token', async () => {
    const t = await issueTokens(uid, services, config);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(t.refreshToken);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^rt=.*HttpOnly/);
  });
  it('reusing a rotated token → 401 token_reused and kills the family', async () => {
    const t = await issueTokens(uid, services, config);
    const r1 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken });
    const r2 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken });
    expect(r2.status).toBe(401); expect(r2.body.error.code).toBe('token_reused');
    const r3 = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(r3.status).toBe(401); expect(r3.body.error.code).toBe('invalid_refresh_token');
  });
  it('refresh accepts the rt cookie', async () => { /* .set('Cookie', `rt=${t.refreshToken}`) → 200 */ });
  it('expired refresh token → 401 invalid_refresh_token', async () => {
    const t = await issueTokens(uid, services, config);
    services.clock.advance(31 * 24 * 3600_000);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken });
    expect(res.body.error.code).toBe('invalid_refresh_token');
  });
  it('logout revokes the family', async () => { /* logout 204, then refresh → 401 invalid_refresh_token */ });
  it('requireAuth: missing header → 401 unauthenticated; bad token → 401 invalid_token; disabled user → 403 account_disabled', ...);
  ```
  (`requireAuth` tested via an `extraRoutes` route `GET /__test/whoami` returning `req.auth`.)
- [ ] **Step 2:** Run `pnpm --filter api test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Rotation runs in `runInTransaction`: find by `sha256(raw)`; if `usedAt` set → revoke family (`revokedAt = now` on all) and throw `token_reused`; else set `usedAt` and issue a new token in the same `familyId`. Augment Express `Request` with `auth?: { userId: string }` in a `types/express.d.ts`.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): users, rotating refresh tokens and requireAuth`.

---

### Task 3: Email + password sign-up, login and password reset

**Files:**
- Create: `apps/api/src/auth/passwordReset.model.ts`, `apps/api/src/auth/routes/emailAuth.ts`, `apps/api/test/auth/emailAuth.test.ts`
- Modify: `apps/api/src/app.ts` (mount; rate limiter on `/auth`)

**Interfaces:**
- Consumes: `User`, `hashPassword`, `verifyPassword`, `normalizeEmail`, `issueTokens`, `sendAuthResponse`, `revokeAllForUser`, `services.email`.
- Produces routes:
  - `POST /auth/register` `{ name: string (1..80), email, password (8..128) }` → `201` token response; `409 email_in_use`
  - `POST /auth/login` `{ email, password }` → `200`; `401 invalid_credentials` for unknown email **and** wrong password (same message)
  - `POST /auth/password/forgot` `{ email }` → always `202 {}`; when the user exists, emails link `${appUrl}/reset-password?token=<raw>`
  - `POST /auth/password/reset` `{ token, password }` → `204`; token valid 1 h, single use; `400 invalid_reset_token`; revokes all refresh tokens for the user
  - Rate limit: `express-rate-limit` 20 requests / 15 min / IP on `/auth/*`, response `429 rate_limited`. `AppDeps` gains `rateLimit?: boolean` (default `config.nodeEnv !== 'test'`); `buildTestApp({ rateLimit: true })` turns it on for the one test that covers it

- [ ] **Step 1: Write failing tests** in `emailAuth.test.ts`:
  ```ts
  it('registers and returns tokens', async () => {
    const res = await register({ name: 'Ana', email: ' Ana@X.com ', password: 'secret123' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Ana', email: 'ana@x.com', hasPassword: true, emailVerified: false });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.accessToken).toBe('string');
  });
  it('same email in different case → 409 email_in_use', async () => { /* register 'ana@x.com' then 'ANA@x.com' */ });
  it('concurrent duplicate registrations → one 201, one 409', async () => {
    const [a, b] = await Promise.all([register(body), register(body)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });
  it('short password → 400 validation_error', ...);
  it('login works with any email casing', ...);
  it('wrong password and unknown email give identical 401 invalid_credentials', async () => {
    const a = await login({ email: 'ana@x.com', password: 'nope1234' });
    const b = await login({ email: 'ghost@x.com', password: 'nope1234' });
    expect(a.status).toBe(401); expect(a.body).toEqual(b.body);
  });
  it('forgot → email sent with link; reset changes password, old refresh tokens die, token single-use', async () => {
    // forgot → 202, services.email.sent[0].text contains 'http://localhost:5173/reset-password?token='
    // reset → 204; login with new password 200; old refreshToken → 401; reusing reset token → 400 invalid_reset_token
  });
  it('forgot for unknown email → 202 and no email', ...);
  it('reset token older than 1 hour → 400 invalid_reset_token', ...); // clock.advance(61 min)
  it('rate limit → 429 rate_limited after 20 requests', ...); // app built with rateLimit: true
  ```
- [ ] **Step 2:** Run `pnpm --filter api test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Register relies on the unique index: catch Mongo `11000` → `409 email_in_use`. Unknown-email login still runs `verifyPassword` against a fixed dummy hash (equal timing). Reset token stored as `sha256`, `usedAt` set on use.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): email/password auth and password reset`.

---

### Task 4: Phone OTP sign-in

**Files:**
- Create: `apps/api/src/auth/otp.model.ts`, `apps/api/src/auth/otp.ts`, `apps/api/src/auth/routes/phoneAuth.ts`, `apps/api/test/auth/phoneAuth.test.ts`

**Interfaces:**
- Consumes: `normalizePhone`, `sha256`, `services.sms`, `services.now`, `User`, `issueTokens`, `sendAuthResponse`.
- Produces:
  - `type OtpPurpose = 'login' | 'link' | 'guest_booking'`
  - `requestOtp(phone: string, purpose: OtpPurpose, services: AppServices): Promise<{ expiresInSec: 300; resendInSec: 60 }>` — errors `429 otp_cooldown` (`details: { retryInSec }`), `429 otp_rate_limited` (> 5 per phone per hour)
  - `verifyOtp(phone: string, purpose: OtpPurpose, code: string, services: AppServices): Promise<void>` — errors `400 otp_invalid` (wrong code, or none active), `400 otp_expired`, `429 otp_attempts_exceeded`
  - SMS text: `Your verification code is ${code}. It expires in 5 minutes.`
  - Routes: `POST /auth/otp/request` `{ phone }` → `202 { expiresInSec, resendInSec }`; `POST /auth/otp/verify` `{ phone, code, name? }` → existing phone user `200`, new user `201` (created with `phoneVerified: true`, `name ?? ''`)

- [ ] **Step 1: Write failing tests** in `phoneAuth.test.ts` (read the code from `services.sms.sent.at(-1).text` with `/\d{6}/`):
  ```ts
  it('request sends a 6-digit code to the E.164 number', ...);             // to === '+8801712345678'
  it('verify creates a new user (201) then logs in the same user (200) with formatting differences', ...);
  it('local number without country → 400 invalid_phone', ...);
  it('second request within 60 s → 429 otp_cooldown with retryInSec', ...);
  it('6th request in an hour → 429 otp_rate_limited', ...);             // advance 61 s between requests
  it('code expires after 5 minutes → 400 otp_expired', ...);
  it('5 wrong attempts kill the code even if the 6th is right', async () => {
    for (let i = 0; i < 5; i++) expect((await verify('000000')).body.error.code).toBe('otp_invalid');
    const res = await verify(realCode);
    expect(res.status).toBe(429); expect(res.body.error.code).toBe('otp_attempts_exceeded');
  });
  it('a code is single-use', ...);                                       // reuse → 400 otp_invalid
  it('new request invalidates the previous code', ...);
  ```
  (Make sure `000000` never equals the real code: fake random seam — `services.otpCode?: () => string`, default `crypto.randomInt(0, 1e6)` zero-padded; tests set it to return `'123456'`.)
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement. One active code per `{ phone, purpose }`; store `codeHash = sha256(phone + ':' + code)`, `expiresAt`, `attempts`, `consumedAt`. Increment `attempts` atomically (`findOneAndUpdate` with `$inc`) before comparing. Add `otpCode?: () => string` to `AppServices`.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): phone OTP sign-in`.

---

### Task 5: Google sign-in

**Files:**
- Create: `apps/api/src/auth/google.ts`, `apps/api/src/auth/routes/googleAuth.ts`, `apps/api/test/auth/googleAuth.test.ts`

**Interfaces:**
- Consumes: `GoogleVerifier` (Task 1), `User`, `issueTokens`, `sendAuthResponse`.
- Produces:
  - `createGoogleVerifier(clientId: string | undefined): GoogleVerifier` — uses `OAuth2Client.verifyIdToken({ idToken, audience: clientId })`; when `clientId` missing every call throws `503 google_not_configured`
  - Route `POST /auth/google` `{ idToken }`:
    - user with `googleSub` → `200`
    - no such user, email unused → `201` new user `{ name, email, emailVerified, googleSub }`
    - email belongs to a user without this `googleSub` → `409 account_exists`
    - bad token → `401 invalid_google_token`

- [ ] **Step 1: Write failing tests** (`services.google.register('tok-1', { sub: 'g1', email: 'Ana@Gmail.com', emailVerified: true, name: 'Ana' })`):
  ```ts
  it('first Google login creates the user (201), second logs in (200)', ...); // email stored 'ana@gmail.com', hasGoogle true
  it('Google email matching an email/password account → 409 account_exists, no link made', ...);
  it('unknown token → 401 invalid_google_token', ...);
  it('verifier without client id → 503 google_not_configured', async () => {
    await expect(createGoogleVerifier(undefined).verify('x')).rejects.toMatchObject({ status: 503 });
  });
  ```
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): google sign-in`.

---

### Task 6: Profile and account linking

**Files:**
- Create: `apps/api/src/auth/routes/me.ts`, `apps/api/test/auth/me.test.ts`

**Interfaces:**
- Consumes: `requireAuth`, `toPublicUser`, `requestOtp`/`verifyOtp` with purpose `'link'`, `GoogleVerifier`, `hashPassword`, `normalizeEmail`.
- Produces routes (all `requireAuth`):
  - `GET /me` → `{ user: PublicUser }`; `PATCH /me` `{ name (1..80) }` → `{ user }`
  - `POST /me/link/phone/request` `{ phone }` → `202`; `POST /me/link/phone/verify` `{ phone, code }` → `{ user }` with phone set, `phoneVerified: true`
  - `POST /me/link/google` `{ idToken }` → `{ user }` with `hasGoogle: true`
  - `POST /me/link/email` `{ email, password }` → `{ user }`; only when the user has no email yet, else `409 email_already_set`
  - Any identity already on another account → `409 identity_in_use`; linking the same identity already on this account → `200` (idempotent)

- [ ] **Step 1: Write failing tests** in `me.test.ts`:
  ```ts
  it('GET /me returns the public user; without token → 401 unauthenticated', ...);
  it('PATCH /me updates name; empty name → 400 validation_error', ...);
  it('email user links a phone, then can sign in with OTP as the same user id', ...);
  it('phone user links Google, then Google login returns the same user id', ...);
  it('phone user adds email+password, then email login returns the same user id', ...);
  it('linking a phone that belongs to another account → 409 identity_in_use', ...);
  it('linking email when one is already set → 409 email_already_set', ...);
  ```
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Link writes rely on partial unique indexes: catch `11000` → `409 identity_in_use`.
- [ ] **Step 4:** Run `pnpm test && pnpm lint && pnpm typecheck` from root. Expected: all PASS / exit 0.
- [ ] **Step 5:** Manual check against local replica set: register via `curl`, call `/me` with the access token, refresh, logout; OTP code appears in API console log.
- [ ] **Step 6:** Commit: `feat(api): profile and account linking`.

---

## Done when

- All auth routes above work against a real MongoDB replica set; full suite, lint, typecheck green.
- `requireAuth` and `req.auth.userId` are ready for Plan 03 (tenancy & access control).
- `requestOtp` / `verifyOtp` with purpose `guest_booking` ready for Plan 07.
