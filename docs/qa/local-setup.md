# Running OctaPM locally (OCTA-SETUP-044)

From an empty machine to a signed-in browser session with data in it, and a
smoke test that proves the API actually works rather than merely compiles.

## Why this exists

The unit suite (150 files, 1580 tests) mocks Prisma. It proves the services
behave; it cannot prove the application boots, that the routes are mounted, that
the middleware is in the right order, or that the migrations produce a schema
Prisma can talk to. This card added the missing half:

- `backend/prisma/seed.js` — the file `npm run db:seed` had always pointed at
  but which did not exist.
- `backend/scripts/smoke.js` — 74 checks over a running API.
- `backend/scripts/dev-db.mjs` — now configurable, and forces UTF-8.

## Steps

Node 24.14+ and npm 11.9+. Everything below runs from the repository root.

**1. Install.**

```bash
npm install
```

**2. Start a database.** `embedded-postgres` ships its own Postgres, so nothing
needs to be installed system-wide. This process must stay running.

```bash
npm run db:dev --workspace=backend
```

It prints the `DATABASE_URL` to use. If port 5432 is taken it says so and stops,
rather than failing obscurely — point it elsewhere:

```bash
DEV_DB_PORT=55432 DEV_DB_DIR=/tmp/octapm-pg npm run db:dev --workspace=backend
```

| Variable | Default | Notes |
| --- | --- | --- |
| `DEV_DB_PORT` | 5432 | |
| `DEV_DB_DIR` | `backend/.pgdata` | Keep it off OneDrive — see *Traps* |
| `DEV_DB_NAME` | `pmcopilots` | |
| `DEV_DB_USER` | `postgres` | |
| `DEV_DB_PASSWORD` | `yourpassword` | Local only |

**3. Configure.** Copy `backend/.env.example` to `backend/.env` and set
`DATABASE_URL` to whatever step 2 printed. Only five keys are needed to boot;
the file marks them and documents the other ~65. For a quiet local run also set
`JOB_WORKER_ENABLED=false` and the four `*_SCHEDULER_ENABLED=false` flags.

**4. Migrate and seed.**

```bash
npm run db:migrate:deploy --workspace=backend
npm run db:seed --workspace=backend
```

The seed builds one organisation, one user per role, and the *Riverside Tower*
project: three activities in a dependency chain, a three-line BOQ allocated to
them, approved progress, a seven-category cost breakdown and an active baseline
— enough that the dashboard, S-curve and earned-value views have something real
to draw. Re-running updates the same rows.

It prints the accounts. All eight share the password `DemoPassw0rd!`:

| Email | Role |
| --- | --- |
| `pm@octapm.demo` | PM, and company administrator |
| `planner@octapm.demo` | Planning engineer |
| `qs@octapm.demo` | Quantity surveyor |
| `cost@octapm.demo` | Cost controller |
| `procurement@octapm.demo` | Procurement |
| `warehouse@octapm.demo` | Warehouse |
| `site@octapm.demo` | Site engineer |
| `finance@octapm.demo` | Finance |

**5. Run.**

```bash
npm run dev
```

API on `:5000`, web app on `:5173`, Swagger at
`http://localhost:5000/api/v1/docs`.

**6. Prove it works.** With the API running, in another terminal:

```bash
npm run smoke --workspace=backend
```

## What the smoke test covers

74 checks, about 4 seconds:

- `/api/health` answers, and the OpenAPI document serves 661 paths.
- An unauthenticated request is refused with the error envelope.
- Sign-in returns a bearer token; `/auth/me` identifies the user; permission
  resolution returns the module map.
- Eight organisation-level endpoints: projects, notifications, conversations,
  reports, portfolio, company cost codes and vendors, workflow steps.
- **All 56 project modules' list endpoints** — every module the workspace can
  open, from activities and BOQ through commitments, pay applications, punch,
  drawings, specifications, timesheets, lookaheads and BIM.
- A write: create an RFI, then read it back by id.
- A negative: the warehouse role is refused (403) when creating an RFI.

Point it anywhere with `SMOKE_BASE_URL`; override the account with
`SMOKE_EMAIL` / `SMOKE_PASSWORD` / `SMOKE_DENY_EMAIL`.

## Traps this card walked into

Recorded because each one costs an hour to work out from the error alone.

- **Never put the data directory on OneDrive.** The repository lives under a
  synced OneDrive folder, and the default `backend/.pgdata` therefore does too.
  A sync client rewriting files under a running Postgres will corrupt it, and
  syncing one is slow enough that startup looks like a hang — the cluster sat in
  "the database system is starting up" for eight minutes. Use `DEV_DB_DIR`.
- **The cluster must be UTF-8.** Left alone, `initdb` takes its encoding from
  the host locale, which on an English Windows machine is WIN1252. Three
  migrations contain a `→` or an `—` in a SQL comment, and the migration then
  dies with `22P05 character ... has no equivalent in encoding "WIN1252"`.
  `dev-db.mjs` now passes `--encoding=UTF8 --lc-collate=C --lc-ctype=C`.
  Encoding is fixed when the cluster is created: to change it, delete the data
  directory and let it initialise again.
- **Windows path length.** A data directory nested deeply enough that
  `pg_wal/archive_status` crosses 260 characters fails initdb with a bare "No
  such file or directory". Keep the path short.

## Known gaps

- **`schema.prisma` and the migrations have drifted.** Applying every migration
  to an empty database and diffing it against the schema shows 33 indexes the
  migrations create that the schema does not declare, 1 index and 2 foreign keys
  the schema declares that no migration creates, and 76 constraints whose names
  differ from Prisma's defaults. Nothing is broken at runtime — the API passes
  all 74 smoke checks against exactly this database — but `prisma migrate dev`
  will want to generate a spurious migration. Reconciling it is its own card and
  must not be done casually, because rewriting an applied migration breaks its
  checksum for anyone who has already run it.
- The frontend is built and served but has not been driven end-to-end here; the
  smoke test is API-only.

## Test

```bash
npm run db:seed --workspace=backend
npm run smoke --workspace=backend
```

Expected: `74/74 passed`.
