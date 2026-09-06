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
cd backend && npm run dev
```

```bash
cd frontend && npm run dev
```

The API listens on `:5000` and the web app on `:5173`. The Playwright config
assumes both, and deliberately does not start them itself: a cold Vite start on
Windows takes longer than a `webServer` block will wait.

### Raise the login limit before a full run

The API allows `RATE_LIMIT_LOGIN_MAX` login attempts per IP and email in a
15-minute window — **12 by default**. A full suite run signs in far more often
than that, and the window is shared with any run that came before it, so the
second consecutive run fails partway through with a 429 that used to surface as
a confusing "Workspace Control not found".

Start the API with a higher ceiling when you are running the suite:

```bash
cd backend && RATE_LIMIT_LOGIN_MAX=500 npm run dev
```

Leave the default alone anywhere else — it is a real brute-force control.

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
