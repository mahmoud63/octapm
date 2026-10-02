# OctaPM full SaaS certification

The question this programme answers: **can OctaPM safely carry at least a
hundred separate construction companies at once, and is it ready for real
businesses?** It is a test and proof programme, not a feature phase. During it,
only launch blockers, security defects, tenant leaks, authorisation errors,
financial errors, data-loss defects, billing errors and broken main workflows
are fixed; smaller findings are recorded for later.

| Document | What it holds |
|---|---|
| This document | The programme, the starting state, each checkpoint's result, the final assessment |
| [OCTAPM_CERT_JOURNAL.md](OCTAPM_CERT_JOURNAL.md) | The step-by-step record, for resuming after a failure |
| [OCTAPM_LAUNCH_BLOCKERS.md](OCTAPM_LAUNCH_BLOCKERS.md) | The issue register (every finding, P0 to P3) and the launch blockers |
| [OCTAPM_100_COMPANY_MATRIX.md](OCTAPM_100_COMPANY_MATRIX.md) | The hundred test companies: who they are and how they differ |
| [OCTAPM_TENANT_ISOLATION_REPORT.md](OCTAPM_TENANT_ISOLATION_REPORT.md) | Cross-company attacks and their results |
| [OCTAPM_BILLING_CERTIFICATION.md](OCTAPM_BILLING_CERTIFICATION.md) | Plans, subscriptions, seats, provider events |
| [OCTAPM_FINANCIAL_CERTIFICATION.md](OCTAPM_FINANCIAL_CERTIFICATION.md) | The financial rules, reconciliation, the final delta |
| [OCTAPM_WORKFLOW_CERTIFICATION.md](OCTAPM_WORKFLOW_CERTIFICATION.md) | The construction lifecycle, step by step |
| [OCTAPM_WEB_CERTIFICATION.md](OCTAPM_WEB_CERTIFICATION.md) | The browser application |
| [OCTAPM_MOBILE_CERTIFICATION.md](OCTAPM_MOBILE_CERTIFICATION.md) | The field app |
| [OCTAPM_FILE_SECURITY_CERTIFICATION.md](OCTAPM_FILE_SECURITY_CERTIFICATION.md) | Uploads, downloads, links |
| [OCTAPM_BACKGROUND_JOB_CERTIFICATION.md](OCTAPM_BACKGROUND_JOB_CERTIFICATION.md) | Jobs, schedulers, notifications, realtime |
| [OCTAPM_PERFORMANCE_CERTIFICATION.md](OCTAPM_PERFORMANCE_CERTIFICATION.md) | A hundred companies working at once |
| [OCTAPM_CODEX_AUDIT.md](OCTAPM_CODEX_AUDIT.md) | The independent review and its adjudication |

## Severity

| | |
|---|---|
| **P0** | Catastrophic: one company can see or change another's data, financial corruption, a way round authentication |
| **P1** | A business launch blocker |
| **P2** | Important, but can be scheduled after launch if the risk is controlled |
| **P3** | Polish, a minor issue |

## Checkpoints

| | Checkpoint | Status |
|---|---|---|
| CERT-0 | Baseline verified | Complete (2026-10-02) |
| CERT-1 | Hundred-company data generated | In progress |
| CERT-2 | Tenant isolation complete | Not started |
| CERT-3 | Construction workflows complete | Not started |
| CERT-4 | Billing complete | Not started |
| CERT-5 | Financial certification complete | Not started |
| CERT-6 | Web, mobile, files, jobs complete | Not started |
| CERT-7 | Performance and security complete | Not started |
| CERT-8 | Claude full certification complete | Not started |
| CERT-9 | Codex independent audit complete | Not started |
| CERT-10 | Confirmed findings remediated | Not started |
| CERT-11 | Codex targeted recheck complete | Not started |
| CERT-12 | Final frozen build certification complete | Not started |

Results are reported per checkpoint and are not carried from one to the next: a
number quoted under a checkpoint was produced by a run made for that checkpoint.

---

## CERT-0 — Baseline

### Starting state, as verified on 2026-10-02

Nothing below is taken from an earlier report; each line was checked.

| | |
|---|---|
| Integration branch | `feat/p0-foundations-sprint1` |
| Starting HEAD | `fbc0f7648e361a4acbd1717e6bc8b34a5281c3a4` |
| Working tree | Clean |
| Remote | `origin` = `github.com/mahmoud63/octapm`; local and `origin/feat/p0-foundations-sprint1` are the same commit (0 ahead, 0 behind) |
| `origin/main` | `fda371f`; integration is 736 commits ahead of it and `main` has nothing integration lacks. Not merged, by standing instruction. |
| Other branches of note | `landing/v2-positioning` at `62d90dd` (previous landing page restored; local only, awaiting the owner's review) and its backup `backup/landing-v2-smart-crm-ai`. Not part of this certification. |
| Prisma schema | Valid. 8,103 lines, 245 models. Two known warnings (SET NULL on a composite key whose column is required). |
| Migrations | 138 folders, latest `20261005060100_record_ref_uniques`. `migrate status` on the shared database: up to date. |
| Shared database | PostgreSQL 18.3, `octapm_verify` on `localhost:55432`, UTF-8, 246 tables, 349 MB. 54 users, 433 projects, 26 subscriptions (5 business/active, 21 trial/incomplete), 0 project exceptions. |
| API | Running on :5000 from the integration worktree (process started 2026-10-01 20:57). `GET /api/v1/config/public` answers. No health path at `/health` or `/api/v1/health` — the real path is being located. |
| Web | Running on :5173 (Vite, development mode). Version 2.2.1. |
| Mobile | `mobile/` version 1.0.0 (Expo). The owner's Expo server on :8081 is not running. |
| Runtime | Node 24.19.0, Prisma 6.19.3 |
| Job worker (shared environment) | Off (`JOB_WORKER_ENABLED=false`) |
| Schedulers (shared environment) | Accounting, daily log, report, workflow: set off. Billing and notification schedulers: not set, so they take their code defaults (being mapped). |
| Exception engine (shared environment) | Off by an explicit setting. **The code default is on** — see CERT-0 finding C0-1. |
| Billing configuration | Stripe is not configured in the shared environment: no secret key, no webhook secret, no price ids. |
| AI | Not configured: no provider key. Left off, as instructed. |
| Test infrastructure found | Backend: 243 unit test files, 111 live test files. Web: 63 Playwright specs, 83 static source checks. Mobile: 70 Jest test files, 25 browser specs. CI: four workflows (quality gates, OpenAPI, container image, deploy). |

### The certification environment

Certification does not use the durable demonstration, UAT or E2E organisations
as its test population. It has its own database on its own Postgres cluster.

| | |
|---|---|
| Database | `octapm_cert` on `localhost:55433` (data directory `C:\Temp\octapm-pg-cert`) |
| How it was made | Empty database, then all 138 migrations applied from zero with `prisma migrate deploy` — 13 seconds, no error |
| Identity | One row in `cert_meta.environment`, of kind `octapm-certification-disposable`, with an id that scripts must name |
| API / web / mobile web | :5190 / :5290 / :8091, started from the certification worktree |
| Naming rule | Every user's address ends `.octapm-cert.test`; every company's slug is `cert-NNN-…` and its name ends `(CERT-NNN)` |
| Guard | `backend/scripts/cert/lib/cert-env.js`. A certification script takes its database from `CERT_DATABASE_URL` only and never falls back to `DATABASE_URL`; refuses any database not named `octapm_cert`; refuses unless the marker is present and matches; and before anything destructive refuses if a single user or company without the naming rule is present. |

### Baseline test run

The full existing checkpoint (schema, OpenAPI, tenant and project-controls live
suites, BOQ-access security, cost ledger, backend unit tests, web typecheck,
lint, source checks and the full web browser suite, mobile typecheck, lint and
unit tests, the financial snapshot and reconciliation, the membership sentinel
and the bulk-write fingerprint) was started on the untouched starting state.
It ran on 2026-10-02 from 07:27 UTC against `fbc0f76`, on the shared environment
(the durable organisations, with the exception engine off).

| Gate | Discovered | Passed | Failed | Skipped |
|---|---|---|---|---|
| Prisma validate | — | pass | | |
| Prisma migrate status | — | up to date | | |
| OpenAPI | 791 documented paths | pass | | |
| Error catalogue (backend utils) | 288 tests / 38 suites | 288 | 0 | 0 |
| Live: tenant | 77 tests / 11 suites | 77 | 0 | 0 |
| Live: project controls (PC-1 to PC-7b, R5) | 412 tests / 47 suites | 412 | 0 | 0 |
| Live: BOQ-access security | 41 tests / 11 suites | 41 | 0 | 0 |
| Live: cost ledger | 2 tests / 1 suite | 2 | 0 | 0 |
| Backend unit | 2,856 tests / 243 suites | 2,856 | 0 | 0 |
| Web typecheck | — | pass | | |
| Web lint | — | pass | | |
| Web static source checks | 83 | 83 | 0 | 0 |
| Web browser suite (full, with the E2E organisation reset) | 231 | 227 | 3 | 1 |
| Mobile typecheck | — | pass | | |
| Mobile lint | — | pass | | |
| Mobile unit | 417 tests / 70 suites | 417 | 0 | 0 |
| Financial snapshot (certified project) | 36 checks | 36 | 0 | |
| Financial reconciliation | 16 source lines | 16 | 0 | |
| Actual Cost delta | | 0.00 (SQL), 0.00 (API), 0.00 (SQL against API) | | |
| Subscription invariants | 24 durable organisations | 24 | 0 | |
| Membership sentinel (before and after) | — | no violations | | |
| Bulk-write fingerprint (before and after) | — | no write touched several organisations | | |

Not in this run, and so not claimed: `prisma generate` (skipped because the
shared API holds the engine file open); the 62 live test files that are not in
the four live groups above; the mobile browser suite; a production build of the
web application. Each is run at its own checkpoint.

**The three browser failures** are all in `68-exception-handoff.spec.ts`. That
spec needs an API with the exception engine switched on; the shared API runs
with it off, deliberately, so that it never evaluates the durable organisations.
They are an effect of the environment, not a defect in the product, and the spec
is run against a certification API with the engine on at CERT-6.

**The one skipped browser test** is the landing page's hero reel test, which
skipped itself, as it does when it finds no film to play.

### CERT-0 findings

Recorded in the [issue register](OCTAPM_LAUNCH_BLOCKERS.md).

- **C0-1 (P1, fixed in `ef5e919`)** — the exception engine's default was on: a
  deployment that did not set `EXCEPTIONS_ENGINE_ENABLED` evaluated every
  organisation. It is now off unless the variable is exactly `true`.
- **C0-2 (P1, open)** — the same "on unless set to false" default applies to
  scheduler leadership, six schedulers, the job worker, the weather feed and
  Expo push. Assessed with the job tests at CERT-6.
- **C0-3 (P1, open, needs the owner)** — a Stripe test secret key and a
  placeholder webhook secret are literals in the tracked deploy workflow.

### The guard, proven against real databases

`backend/scripts/cert/prove-guard.js` ran 28 cases and all 28 behaved as
expected: no address, an empty address, only `DATABASE_URL` set (no fallback),
the shared development database's address, a live read-only connection to the
shared database (refused, plain and destructive), a wrong marker id, the marker
removed, dropped, doubled or of another kind, a company with a durable name, a
company with only half the naming rule, a company named for the E2E suite, a
person with a durable address — each refused with the rule that applies — and
the certification database itself accepted. Each "wrong" state was made inside
a transaction that was rolled back; the proof checks that nothing was left.

### Leads from reading the code

Before testing, eleven read-only passes mapped the areas the certification
depends on (tenancy and sign-in, billing, jobs and realtime, files, every
route, the test infrastructure, finance, the lifecycle, CI and deployment).
They returned 214 suspected defects: 10 guessed P0, 36 guessed P1, 105 P2,
63 P3. None was executed. They are in
[OCTAPM_CERT_LEADS.md](OCTAPM_CERT_LEADS.md); each is confirmed or dismissed
by a test at its checkpoint.
