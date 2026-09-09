# Development and test environment certification

**Phase 20 clean-up** · **Written:** 2026-09-08
**Cards:** OCTA-QA-ENV-108 · OCTA-UX-KEY-104 · OCTA-A11Y-DIALOG-105 · OCTA-QA-CONSOLE-106 · OCTA-QA-LOGIN-107
**Scripts:** `scripts/dev-preflight.mjs` · `npm run dev:check` · `npm run e2e`
**Specs:** `e2e/30-console-quality.spec.ts`

Two full regression runs in this programme lost a test to the environment
rather than the product, and both were nearly written off with a plausible
explanation that the evidence did not support. This is what the environment
actually has to look like, how to check it in one command, and what the
evidence said when it was finally read properly.

---

## 1. Process architecture

Four roles. Exactly one process each, and nothing else on those ports.

| role | port | how to start | notes |
| --- | --- | --- | --- |
| PostgreSQL | `55432` | `cd backend && DEV_DB_PORT=55432 DEV_DB_DIR=C:/Temp/octapm-pg node scripts/dev-db.mjs` | data dir **must** be outside OneDrive; a synced folder corrupts the cluster mid-write |
| API | `5000` | `cd backend && npm start` | **not** `npm run dev` — see §3 |
| Web | `5173` | `cd frontend && npm run dev` | Vite binds `::1` only |
| Tests | — | `npm run e2e` | preflight, then Playwright |

Check it in one command:

```bash
npm run dev:check
```

```
✓ database                   listening on :55432
✓ api                        healthy on :5000 (pid 37632)
✓ web                        listening on :5173 (pid 30496)
✓ api instances              1 (37632)
• login ceiling              backend/.env sets it for the API process
Stack looks right. Remember: no code edits while a full suite runs.
```

It **reports and does not repair.** Killing a process the operator did not ask
about is how you lose someone else's work, so where something is wrong it
prints the exact `Stop-Process` command and exits non-zero.

---

## 2. Health check

`GET /api/health` — public, and it already existed. It returns only:

```json
{ "success": true, "data": { "status": "ok", "timestamp": "…" } }
```

No secrets, no database credentials, no diagnostics. Nothing was added.

**Do not probe `/api/v1/projects` to test liveness.** It is a protected route
and answers `401` when unauthenticated, which is correct behaviour and not a
failure. Reading that 401 as "the API is down" wasted real time in this
session; the paths `/health`, `/healthz` and `/api/v1/health` do not exist and
probing them proves nothing either.

---

## 3. The API runs without a file watcher

`npm run dev` starts **nodemon**, which restarts the API whenever a backend
file changes. That is right for development and wrong for a 20-minute test
run, for a reason that is not obvious: when a second nodemon loses the race for
`:5000` it does not exit. It crashes with `EADDRINUSE`, prints *"app crashed —
waiting for file changes"*, and **stays resident, still watching**. The next
file change wakes every one of them and they all fight for the port.

Found in this worktree, with three of them accumulated:

```
PID  2960  nodemon.js src/index.js   ← crashed on EADDRINUSE, still watching
PID 21312  nodemon.js src/index.js   ← crashed on EADDRINUSE, still watching
PID 30144  nodemon.js src/index.js   ← crashed on EADDRINUSE, still watching
PID 37632  node src/index.js         ← the live API
```

This is what restarted the live API in the middle of a full regression and
produced a sign-in failure at test 116 of 138 that looked exactly like a
product defect. Use `npm start` for anything you intend to run a suite
against.

### Finding and stopping a stale API

```powershell
Get-NetTCPConnection -LocalPort 5000 -State Listen |
  Select-Object LocalAddress, OwningProcess

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, CommandLine
```

Read the command line before stopping anything — confirm the path is this
worktree and the process is OctaPM's:

```powershell
Stop-Process -Id <pid> -Force
```

---

## 4. Login rate limiting — what the evidence actually said

The suspicion was that repeated E2E runs exhaust the login budget and fail
late in the suite with `429`. **They do not, and never did.** From the API log
of a full run:

```
POST /api/v1/auth/login    1537 × 200    3 × 401    0 × 429
```

Zero rate-limited responses across **1,612 login requests**. The three `401`s
are the auth specs deliberately signing in with a wrong password.

Two things made this look otherwise, and both are worth knowing:

- `backend/.env` already sets `RATE_LIMIT_LOGIN_MAX=2000` with a 60-second
  window. The production default of 12 per 15 minutes is a real brute-force
  control and is **unchanged**; the development environment raises its own
  ceiling and always has.
- Grepping the API log for "rate limit" returns **1,935 hits, every one of
  them the stack-trace frame `rate-limit.js:80`** — the limiter's own
  `next()`, which appears in the stack of every logged error because the
  middleware sits in the chain. It is not evidence of rate limiting at all.

The arithmetic also refutes it independently: the suite makes roughly 178 `pm`
logins. Against a ceiling of 12 it would fail at test 12, not test 116.

**Nothing was done to the limiter.** No production behaviour changed, and no
test-only bypass was added, because there is no problem to bypass.

### What was done instead

The out-of-band bearer token is now cached per Playwright worker
(OCTA-QA-LOGIN-107). `openProject` alone signed in **79 times a run** for a
value that never changes — pure round trips and needless coupling to a control
whose whole job is to notice repeated logins. The specs that are *about*
signing in still drive the real form through `signIn`; only the API client used
to verify backend state borrows a token.

A failed sign-in now reports its HTTP status. A bare "sign-in for pm failed"
is what sent this investigation chasing a rate limit that was never involved.

### storageState

Not adopted. It is the right answer to a login budget under pressure, and this
one is not: the ceiling is 2,000 per minute and the suite uses about 178 per
20 minutes. Refactoring 24 spec files to solve a problem that is not occurring
would risk a green suite for no measured gain. The measurement that would
justify revisiting it is a non-zero `429` count in the API log.

---

## 5. Console quality gate

`gateConsole` in `frontend/e2e/support.ts` fails a test on any console **error
or warning the application produces about itself**, across the certified
workflows.

The older `watchForProblems` listens only for `console.error`. That is why
three real defects survived a green suite: two of them arrive as
`console.warn`.

**The allowlist has two entries**, and both are messages the browser emits
*about* the page rather than messages the page emits about itself:

| allowed | why |
| --- | --- |
| `Download the React DevTools` | React's own nag, not OctaPM |
| `Failed to load resource … 401` | The browser reporting the bootstrap `/auth/me` probe. On a cold load the access token lives only in memory, so the first call is unauthenticated; the response interceptor refreshes and retries and the user sees nothing. **Only 401** — any other status fails. |

**Never allowlistable**, named in the code so nobody can quietly add them:
controlled/uncontrolled transitions, missing `key`, missing `DialogTitle`,
missing `Description`/`aria-describedby`.

Verified by reverting the `PackagesPanel` key fix: two of the three gate tests
fail and name the component.

---

## 6. Log locations

Every service started in a session is redirected to a file, so the terminal
shows nothing. **That is expected and is not evidence the service failed.**

| service | log |
| --- | --- |
| database | `<scratchpad>/db.log` |
| API | `<scratchpad>/api.log` |
| web | `<scratchpad>/web.log` |
| regression | `<scratchpad>/regression*.log` |

```bash
tail -f "<scratchpad>/api.log"
```

Whoever launches a service this way must say where its log is. Reporting "no
output yet" from a redirected command as though the process had not started is
a reporting error, not a finding.

---

## 7. What not to do during a full regression

Once Playwright starts, until it finishes:

- **no backend or frontend code changes** — a `git add` that renormalises line
  endings is enough to trigger a watcher
- **no API restart**, no `npm run dev` alongside it
- **no database reset or reseed**
- **no second suite** in parallel — one worker, one shared seeded project
- documentation edits are safe (nothing watches `docs/`) but the commit that
  stages them is best left until the run is done

A run that was interfered with is not evidence. Discard it and start again
rather than reasoning about which failures were "real".

---

## 8. Diagnosing a failure honestly

Two runs in this programme failed on the environment, and in both cases the
first plausible explanation was wrong:

| symptom | tempting answer | what it actually was |
| --- | --- | --- |
| sign-in fails at test 116/138 | login rate limit | nodemon restarted the API mid-suite; the log has `EADDRINUSE` and `app crashed` at that moment |
| a page renders blank for 30s | accumulated test data slowing the API | every endpoint it needs answers in 25–152 ms; the page loads in 1.4–2.4s on three probes. Still undiagnosed, and recorded as such |

The rule the programme already applies to green results applies just as hard
to red ones: **a result is only worth the scepticism applied to the instrument
that produced it.** Prove the cause. "Probably a flake" is not a diagnosis, and
neither is "probably the rate limit".

Do not add `retries` to make a board green. `retries: 0` is deliberate.

---

## 9. Reseed before a full run

The seeded workspace is shared, and E2E specs write to it. Over repeated runs
the records pile up, and eventually a list that shows a fixed number of rows
stops containing the one a test just created.

That is what happened here. `11-inventory`'s "an order with nothing wrong is
reported as matched" raised its own order, received it, then could not find it
in the Match picker — which lists `take: 100` orders sorted by promised date.
The database held **302 purchase orders**, of which **156 were demonstrably
test-generated** (`PO-E2E-` 50, `PO-LC-` 101, `PO-ADV-` 5). The order existed
and the match worked; it was simply off the end of the list.

`prisma/seed.js` already cleans exactly this up — it deletes `PO-E2E-` and
`PO-LC-` orders with their receipts, receipt lines and PO lines, and the
matching `E2E-`/`LC-` inventory items. Running it dropped the count from 302
to 151 and the spec went 11/11.

```bash
cd backend && npm run db:seed
```

`npm run e2e` now does this between the preflight and the suite, so the
deterministic path is the default one:

```
dev-preflight  →  db:seed  →  playwright test
```

**Do not reseed while a suite is running.** Before, always; during, never.

### A product limit worth noting separately

The match picker's `take: 100` has no paging and no search, so on a real
project with more than a hundred purchase orders the older ones are
unreachable from that screen. The test data made it visible; the limit is real
either way. Recorded as **P2, not fixed here** — it is a feature change, not
an environment repair.
