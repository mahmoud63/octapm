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

## C0-3 in detail — the Stripe values in the deploy workflow

Values are not reproduced here or anywhere in the certification record.

| Value | What it is | Test or production | Credential? | Action |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | A Stripe **secret API key**, `sk_test_` + 99 characters: the full length Stripe issues | **Test mode** (the `sk_test_` prefix). It cannot move real money, but it opens the account's test-mode data and API: customers, payment methods, subscriptions, webhooks endpoints, and the account's test-mode configuration | **Yes — exposed** | **ROTATION OWNER ACTION REQUIRED**: roll the key in the Stripe dashboard (Developers → API keys → Roll key), store the new one as the repository secret `STRIPE_SECRET_KEY`, and record the date and ticket in `STRIPE_SECRET_ROTATION_CONFIRMED_AT` / `STRIPE_SECRET_ROTATION_TICKET` (the production boot already requires them) |
| `STRIPE_WEBHOOK_SECRET` | A stand-in **word**, `whsec_` + 11 letters, not a secret Stripe issued | Neither: no Stripe endpoint was ever configured with it | Not a credential, but it was the configured signing secret of whatever this workflow deployed — so anyone who read it could have forged billing events there | Create the webhook endpoint in Stripe for each environment and store its real signing secret as the repository secret `STRIPE_WEBHOOK_SECRET`. The boot guard now refuses stand-in words |
| `STRIPE_PRICE_INDIVIDUAL_MONTHLY`, `…_ANNUAL`, `STRIPE_PRICE_BUSINESS_MONTHLY`, `…_ANNUAL` | Stripe **price ids** (`price_…`) | Test mode, presumably (they belong to the same account as the test key; cannot be confirmed without Stripe access) | No — identifiers, not secrets | Store as repository **variables** (or secrets) with the same names; the workflow reads `vars.` first, then `secrets.` |

**Where the literals are.** Added in commit `b26f6f6` (2026-06-14), the only commit that changed those lines. Present in the deploy workflow of `origin/main`, `origin/ai-dev`, `origin/feat/p0-foundations-sprint1` and 54 of the 59 local branches, and in the tag `landing-v2-smart-crm-ai`. Not in any other tracked file, now or in history. Removed from the working tree on `cert/full-saas-certification` by the commit that adds this section; the other branches still carry them until this change reaches them.

**Git history.** Not rewritten (no approval for that). Rotation makes the exposed test key worthless, which is what matters; a history rewrite would only remove a dead value and needs every clone to be re-made, so it is the owner's decision.

**GitHub configuration the workflow now needs** (Settings → Secrets and variables → Actions): secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; variables (or secrets) `STRIPE_PRICE_INDIVIDUAL_MONTHLY`, `STRIPE_PRICE_INDIVIDUAL_ANNUAL`, `STRIPE_PRICE_BUSINESS_MONTHLY`, `STRIPE_PRICE_BUSINESS_ANNUAL`; and, already referenced before, `STRIPE_SECRET_ROTATION_CONFIRMED_AT`, `STRIPE_SECRET_ROTATION_TICKET`. Until they exist, a run of the deploy workflow fails at the production boot check rather than deploying with stand-ins — the safe failure.

**Certification continues without real Stripe**: a local Stripe stand-in and locally signed events (see the billing certification). Real Stripe test checkout, billing portal and webhook delivery stay manual and pending until the owner supplies test credentials.

## Register

| ID | Severity | Area | Company / role | Reproduction | Expected | Actual | Cause | Fix | Test | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C0-1 | P1 | Background jobs / exception engine | Any deployment | Start the API without `EXCEPTIONS_ENGINE_ENABLED` in its environment | The engine is off unless it is explicitly switched on | The engine is on: it evaluates every organisation on domain events and nightly, and opens exception rows | The flag's default in `exception-engine.service.js` is "on unless set to false" | Reverse the default: on only when explicitly set to `true`; the same for the nightly scheduler | Unit tests of the default with the variable missing, empty, blank, unrecognised and with no environment, for the trigger, the tick, the handler and the notifier (69 tests in four files); three mutations caught; live files `pc-7b-exception-triggers` and `pc-7b-exceptions-api` 24 of 24; the certification API started without the variable logs `disabled: EXCEPTIONS_ENGINE_ENABLED is not true` | Fixed | `ef5e919` |
| C0-2 | P1 | Background jobs / schedulers | Any deployment | Start the API with only the database and token secrets set | Nothing that writes to every organisation starts because a variable is missing | Scheduler leadership, the billing, notification, daily-log, report, workflow and accounting schedulers, the job worker, the weather feed and Expo push are all on; billing, notification, report and workflow act at start on every organisation | Each switch is read as "on unless set to false" (`jobs/schedulers.js:88`, `billing-scheduler.js:102`, `notification-scheduler.js:40`, `daily-log-scheduler.js:52`, `report-scheduler.js:42`, `workflow-scheduler.js:16`, `accounting-scheduler.js:25` — exact match, so `FALSE` leaves it on, `jobs/worker.js:341`, `weather-feed.service.js:55`, `push.service.js:77`) | To be decided at CERT-6 with the job tests: these are the product's normal workers, so the candidate fix is a production start-up check that refuses to boot unless each switch is set explicitly, plus case-insensitive parsing for the accounting switch | — | Open | — |
| C0-3 | P1 | Secrets / deployment | Anyone who can read the repository | Read `.github/workflows/deploy.yml` lines 74-79 and 239-244 | No credential in a tracked file | A full-length Stripe test-mode secret key and a stand-in webhook signing secret were written as literals (with four price ids), on this branch and on `origin/main` since commit `b26f6f6` (2026-06-14). The server's format check accepted the stand-in webhook secret, so an environment deployed by that workflow would accept billing events forged by anyone who has read the file | The values were hard-coded into the workflow, under a comment addressed to agents saying to keep them | The workflow now takes all six values from repository secrets and variables, and the comment is gone; the production boot guard refuses stand-in words as Stripe credentials; the secret-hygiene check (CI) now flags full-length test-mode keys, webhook signing secrets and any literal `STRIPE_*` value in a workflow. **ROTATION OWNER ACTION REQUIRED** — see "C0-3 in detail" below | `security.test.js` (stand-in words refused, a real-looking value accepted); `validate-secret-hygiene.mjs --self-test`; repository scan passes; 4 mutations caught | Fixed in the repository; rotation open — needs the owner | (this commit) |
