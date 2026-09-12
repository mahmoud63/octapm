# Phase 21 — greenfield system driver

Builds a construction project from nothing and operates it: directory,
project, team, WBS, cost codes, schedule, BOQ, budget, procurement, delivery,
stock, material issue, subcontract, pay application, payment — then attacks it.

```bash
cd backend
node scripts/phase21/run-all.js            # fresh project, all stages
node scripts/phase21/run-all.js --keep     # continue the project in context.json
node scripts/phase21/run-all.js --only=stage4
```

Needs the local stack up (`node scripts/dev-preflight.mjs` from the repo root)
and the demo identities seeded. It writes `context.json` beside itself — the
ids every later stage builds on. That file is a run artefact and is not
committed.

## Why it is written this way

**Financial figures are only meaningful on a project nothing has touched
twice.** Run the stages twice against one project and the stock compounds; the
certifying figures come from a single clean pass. Stages find-or-create where
they can, but `run-all.js` without `--keep` is what produces evidence.

**Nothing is swallowed.** A failed call throws with method, path, status, the
server's error code and its validation detail, so a business assertion never
fails first with "cannot read property of undefined" when the cause was an
HTTP error. There is no `.catch(() => {})`, and a cleanup failure throws.

**Money is compared in integer cents**, never as floats, and the numbers are
chosen so the answer is known on paper first — the weighted average is exactly
11.00, the critical path is exactly 81 working days.

**Actual cost is read from `/cost/reconciliation`**, which exposes the ledger
total, its sources, both materialised projections and the service's own
`balanced` flag — not from a dashboard number, which would be taking the
system's word for its own arithmetic.

**Authorisation probes run last** (stage 7). A probe that succeeds writes a
real record: an early version posted a stock issue and moved the very ledger
stage 4 was proving. Stage 7 asserts the ledger moved by exactly what its
probes issued.

**The outsider tenant is registered through sign-up**, not borrowed from the
seed. A seeded user in another organisation has a different password, so every
call returns 401 — which proves nothing about tenant isolation and, on the
first attempt, looked exactly like a leak.

See `docs/qa/OCTAPM_PHASE21_*.md` for the run this produced.

## Phase 21C stages

Stages 10–19 continue the same project (proved by id at the start of each):

| stage | what it drives |
| --- | --- |
| `stage10-client.js` | prime contract → IPC period and items → certify → invoice → client payment → receivables → cash flow |
| `stage11-rfq.js` | vendor prequalification → RFQ package → supplier portals → levelling → award → PO-00001 |
| `stage12-three-way-match.js` | supplier invoices against PO lines, the price variance, and the 0.00 ledger delta for stocked goods |
| `stage13-labour.js` | a crew day on a timesheet, approved, posted to the ledger as labour |
| `stage14-rfi.js` | an RFI, the ball in court as it moves, and the change it becomes |
| `stage15-document-control.js` | drawing revisions, a submittal rejected then approved, a transmittal, a letter, one register |
| `stage16-quality.js` | ITPs, a major NCR closed out with evidence, a defect, a cube test, a punch item, an observation, the score |
| `stage17-field-safety.js` | a daily log approved, a weather delay raised from it, a near miss closed out, the photo gallery |
| `stage18-meetings-tasks.js` | minutes distributed, an action tracked as a task |
| `stage19-browser.js` | every persona through the real sign-in; 25 record deep links graded as the PM |
| `rbac-audit.js` | the probe that found P21-010: every project-nested prefix as two roles the policy denies |
| `snapshot.js` | the financial snapshot the project must reconcile to, transaction by transaction |

`stage19-browser.js` needs the browsers Playwright installed (`playwright-core`
is resolved from the repo's `node_modules`). Every stage is idempotent: it
finds its own record by a deterministic key and fails loudly on a duplicate
it did not expect.
