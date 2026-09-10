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
