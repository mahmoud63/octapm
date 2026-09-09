# Running the test suites locally

The browser tests drive the real application against a real API and a real
database. Nothing is mocked, so the services have to be up first.

## 1. Database

```bash
cd backend && node scripts/dev-db.mjs
```

Starts an embedded PostgreSQL. Two things matter:

- **Keep the data directory out of OneDrive.** A synced folder corrupts the
  cluster mid-write; `DEV_DB_DIR` exists so you can point it at, say,
  `C:\Temp\octapm-pg`.
- The cluster is created with `--encoding=UTF8`. Some migrations contain `→` and
  `—`, and a WIN1252 cluster rejects them with `22P05`.

Then apply migrations and seed the demo data:

```bash
cd backend && npx prisma migrate deploy && npm run db:seed
```

The seed creates the organisation, the project **Riverside Tower**, and one user
per role — `pm@octapm.demo` through `finance@octapm.demo`, all with the password
`DemoPassw0rd!`. The browser tests expect exactly these.

## 2. API and web app

```bash
cd backend && npm start
```

**`npm start`, not `npm run dev`, for anything you will run a suite against.**
`npm run dev` starts nodemon, and a nodemon that loses the race for :5000 does
not exit — it crashes with `EADDRINUSE`, prints "waiting for file changes" and
stays resident, still watching. Three of them accumulated in one session, and
the next file change woke them all to fight over the port. That restarted the
live API in the middle of a 16-minute regression and produced a sign-in failure
that looked exactly like a product defect. See
`OCTAPM_DEV_TEST_ENVIRONMENT_CERTIFICATION.md`.

```bash
cd frontend && npm run dev
```

The API listens on `:5000` and the web app on `:5173`. The Playwright config
assumes both, and deliberately does not start them itself: a cold Vite start on
Windows takes longer than a `webServer` block will wait.

### Check the stack before you run anything

```bash
npm run dev:check
```

Reports the database, the API (through `/api/health`, which is public and
returns only a status and a timestamp), the web server, how many API-ish node
processes are alive, and the login ceiling. It reports rather than repairs:
where something is wrong it prints the exact `Stop-Process` command.

`npm run e2e` runs the same check first and refuses to start the suite if the
stack is wrong.

Do not use `/api/v1/projects` as a liveness probe. It is protected, so it
answers `401` when unauthenticated — correct behaviour, not a failure.

### The auth window, which is the one that actually bites

The limiter that stops a full suite is **`authLimiter`**, not the login one.
It covers everything under `/api/v1/auth` — including the `/auth/me` probe
the app makes on every cold page load — and its production default is 80
requests per 15 minutes per IP.

A full browser run makes about **2,025 requests under `/api/v1/auth` in 13.7
minutes**. `backend/.env` raises the ceiling to 2,000, but with the default
15-minute window that is one budget for the whole run: it ran out at request
2,001 and every `/auth/*` call after that — login, `/auth/me`,
`sso/lookup`, `refresh` — returned 429, failing eight specs.

`backend/.env` therefore also shortens the window so the budget refreshes
during a run:

```
RATE_LIMIT_AUTH_MAX=2000
RATE_LIMIT_AUTH_WINDOW_MS=60000
```

`.env` is untracked and local-only. **The production defaults in
`rate-limit.js` are unchanged** — 80 per 15 minutes is a real control.

If a suite fails with 429, count them with the colour codes stripped, or you
will read zero where there are twenty-five:

```bash
sed 's/[[0-9;]*m//g' api.log | grep -cE " 429 "
```

### The login ceiling is already raised, and is not your problem

`backend/.env` sets `RATE_LIMIT_LOGIN_MAX=2000` over a 60-second window, so a
local suite run does not come close. Measured across a full run: **1,537 × 200,
3 × 401, 0 × 429 over 1,612 login requests** — the 401s being the auth specs
deliberately using a wrong password.

The production default of 12 per 15 minutes is a real brute-force control and
is unchanged. Do not weaken it, and do not add a test-only bypass; there is
nothing to bypass.

If you ever do suspect rate limiting, count actual `429` responses. Grepping
the API log for "rate limit" returns thousands of hits that are all the
stack-trace frame `rate-limit.js:80` — the limiter's own `next()`, present in
every logged error because the middleware sits in the chain.

## 3. The suites

```bash
cd backend && node scripts/smoke.js
```

74 checks against a running API — the quickest way to tell whether the stack is
actually up.

```bash
cd backend && node scripts/qa/run.js
```

The API-level scenarios: security, the authorization sweep, cross-module
integration and company scoping.

```bash
cd frontend && npx playwright test
```

The browser tests. They sign in through the real form, drive the real UI and
verify the resulting backend state through a separate API client — never through
the browser's own session, because a second sign-in in the same cookie jar
displaces the session under test.

```bash
cd frontend && for f in scripts/*.test.mjs; do node "$f"; done
```

The frontend contract tests. They are plain Node scripts with no runner, so they
work anywhere Node does.

## Screenshots

The brand and navigation specs write to `docs/design/screenshots/`. They are
committed on purpose: a visual change should show up in review as a changed
image, not as a diff of Tailwind classes.
