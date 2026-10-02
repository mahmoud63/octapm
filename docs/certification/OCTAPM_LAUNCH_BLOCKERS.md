# OctaPM certification — issue register and launch blockers

Every finding of the certification programme is recorded here, whatever its
severity. The launch blockers are the open P0 and P1 rows.

**Severity.** P0: one company can see or change another's data, financial
corruption, or a way round authentication. P1: a business launch blocker. P2:
important, can be scheduled after launch if the risk is controlled. P3: polish.

**Status.** Open · Fixed (with the commit) · Accepted (a recorded decision not to
change it) · Deferred (scheduled after launch) · Not a defect.

## Launch blockers now

Open P0 and P1 rows of the register, as of the latest checkpoint:

- **C0-2 (P1)** — a deployment that leaves the scheduler and worker switches unset runs all of them.
- **C0-3 (P1)** — a Stripe test secret key and a placeholder webhook secret are literals in the tracked deploy workflow.

The codebase reading that preceded the tests produced 214 further leads (10 guessed P0, 36 guessed P1).
A lead is not a finding: none of them has been executed yet. They are listed in
[OCTAPM_CERT_LEADS.md](OCTAPM_CERT_LEADS.md) and each is confirmed or dismissed at its checkpoint; a
confirmed one gets a row here.

## Register

| ID | Severity | Area | Company / role | Reproduction | Expected | Actual | Cause | Fix | Test | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C0-1 | P1 | Background jobs / exception engine | Any deployment | Start the API without `EXCEPTIONS_ENGINE_ENABLED` in its environment | The engine is off unless it is explicitly switched on | The engine is on: it evaluates every organisation on domain events and nightly, and opens exception rows | The flag's default in `exception-engine.service.js` is "on unless set to false" | Reverse the default: on only when explicitly set to `true`; the same for the nightly scheduler | Unit tests of the default with the variable missing, empty, blank, unrecognised and with no environment, for the trigger, the tick, the handler and the notifier (69 tests in four files); three mutations caught; live files `pc-7b-exception-triggers` and `pc-7b-exceptions-api` 24 of 24; the certification API started without the variable logs `disabled: EXCEPTIONS_ENGINE_ENABLED is not true` | Fixed | `ef5e919` |
| C0-2 | P1 | Background jobs / schedulers | Any deployment | Start the API with only the database and token secrets set | Nothing that writes to every organisation starts because a variable is missing | Scheduler leadership, the billing, notification, daily-log, report, workflow and accounting schedulers, the job worker, the weather feed and Expo push are all on; billing, notification, report and workflow act at start on every organisation | Each switch is read as "on unless set to false" (`jobs/schedulers.js:88`, `billing-scheduler.js:102`, `notification-scheduler.js:40`, `daily-log-scheduler.js:52`, `report-scheduler.js:42`, `workflow-scheduler.js:16`, `accounting-scheduler.js:25` — exact match, so `FALSE` leaves it on, `jobs/worker.js:341`, `weather-feed.service.js:55`, `push.service.js:77`) | To be decided at CERT-6 with the job tests: these are the product's normal workers, so the candidate fix is a production start-up check that refuses to boot unless each switch is set explicitly, plus case-insensitive parsing for the accounting switch | — | Open | — |
| C0-3 | P1 | Secrets / deployment | Anyone who can read the repository | Read `.github/workflows/deploy.yml` lines 74-75 and 239-240 | No credential in a tracked file | A full-length Stripe test-mode secret key and a fixed placeholder webhook signing secret are written as literals, on this branch and on `origin/main` (since commit `b26f6f6`, June 2026). The server's format check accepts the placeholder webhook secret, so an environment deployed by this workflow would accept forged billing events from anyone who has read the file | The values were hard-coded into the workflow; the lines carry a comment saying the owner asked for them to stay | Owner action: rotate the Stripe test key, move both values to repository secrets, and add the placeholder to the server's refused list. Not changed here: the deploy workflow is outside what this certification may alter without approval, and no environment deployed by it exists today | Secret scan at CERT-7 | Open — needs the owner | — |
