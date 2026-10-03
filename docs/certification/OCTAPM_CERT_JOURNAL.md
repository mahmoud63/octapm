# OctaPM full SaaS certification — journal

The durable record of the certification programme. After every meaningful step
an entry is added here and committed, so that the work can be resumed from Git
and this file after a network or session failure, without starting again.

**To resume:** read the last entry's "Next exact action"; check `git log` on
`cert/full-saas-certification`; bring the services in "Active services" back up
(they do not survive a machine restart or the end of a logon session); then
carry on from that action. Do not repeat a completed checkpoint.

## Standing facts

| | |
|---|---|
| Certification branch | `cert/full-saas-certification`, created from `feat/p0-foundations-sprint1` at `fbc0f76` |
| Certification worktree | `.claude/worktrees/cert` |
| Integration branch | `feat/p0-foundations-sprint1` — worktree `.claude/worktrees/procore-competitive-benchmark-6bd1b6`; the shared API on :5000 and web on :5173 run from it and are left alone |
| Shared development database | `octapm_verify` on `localhost:55432`, data `C:\Temp\octapm-pg`. Holds the durable demonstration, UAT and E2E organisations. **Certification scripts never write to it.** |
| Certification database | `octapm_cert` on `localhost:55433`, data `C:\Temp\octapm-pg-cert`. A separate Postgres cluster. Disposable. Identity marker in `cert_meta.environment`. |
| Certification working directory | `C:\Temp\octapm-cert` (outside Git and outside OneDrive): logs, maps, uploaded files, the cluster password, `environment.json` |
| Certification API / web / mobile ports | API :5190, web :5290, mobile web :8091 (the owner's own Expo server on :8081 is never touched) |
| Guard | `backend/scripts/cert/lib/cert-env.js` — every certification script goes through it; it never falls back to `DATABASE_URL` |

Start the certification cluster after a restart:
`powershell -NoProfile -ExecutionPolicy Bypass -File C:\Temp\octapm-cert\start-cluster.ps1`
(it starts `pg_ctl` through WMI, so the cluster does not die with the shell).

## Entries

### 2026-10-02 — CERT-0 in progress

- **HEAD:** `fbc0f76` on `cert/full-saas-certification` (no commits yet).
- **Verified starting state:** integration branch `feat/p0-foundations-sprint1`
  at `fbc0f76`, working tree clean, level with `origin`; `origin/main` at
  `fda371f`, 736 commits behind integration and with nothing integration lacks.
- **Shared database identity (read-only check):** PostgreSQL 18.3, database
  `octapm_verify`, port 55432, 246 tables, 138 migration folders, `migrate
  status` "up to date", 54 users, 433 projects, 26 subscriptions, 0 project
  exceptions.
- **Schema:** `prisma validate` passes (two known warnings about SET NULL on
  composite keys); 245 models.
- **Shared services found running:** Postgres :55432, API :5000 (started
  2026-10-01 20:57, before the last test-only commit), web :5173. The owner's
  Expo server on :8081 is not running.
- **Certification environment created:** cluster on :55433; database
  `octapm_cert`; all 138 migrations applied from zero in 13 seconds; marker
  `cert_meta.environment`; `backend/.env` for the certification worktree
  (gitignored, random local secrets, every scheduler and the job worker off).
- **Guard:** written, with 15 unit tests passing.
- **Running in the background:** the full existing test checkpoint on the
  integration worktree as the CERT-0 baseline; eleven read-only readers
  writing maps of the codebase to `C:\Temp\octapm-cert\maps`.
- **Backup state:** no change has been made to the shared database; nothing to
  back up yet. The existing cold backups under `C:\Temp\octapm-pg-backup-*`
  are untouched.
- **Next exact action:** record the baseline results when the checkpoint
  finishes; prove the guard against real databases; then CERT-1, the
  hundred-company population.

## 2026-10-02 — CERT-0 complete; CERT-1 layer 1 done

**State**

| | |
|---|---|
| Branch / HEAD | `cert/full-saas-certification`; see `git log` (the commit that adds this entry) |
| Checkpoint | CERT-0 complete. CERT-1 in progress: layer 1 (companies, people) exists; layer 2 (projects and their records, through the API) is next |
| Certification database | `octapm_cert` on :55433, marker `fdae416f-…`. 100 organisations, 100 subscriptions, 3,008 users, 3,052 memberships. No projects yet |
| Shared database | Untouched by certification scripts. Two live exception test files were run against it under the lock (the usual LiveTest organisations, created and dropped by the suite) |
| Backups | None taken: nothing in the shared database was migrated or changed. The certification database is disposable and rebuilt by scripts |
| Services | Certification Postgres :55433 (started by `C:\Temp\octapm-cert\start-cluster.ps1`); certification API :5190 from this worktree (started by `C:\Temp\octapm-cert\start-api.ps1`, log `C:\Temp\octapm-cert\logs\api.log`, PID in `api.pid`). Shared Postgres :55432, API :5000, web :5173 as before, not restarted |
| Certification API switches | Job worker, scheduler leadership, every scheduler, the exception engine, the weather feed and Expo push: off, each set explicitly in the worktree's `backend/.env` (not tracked) |

**Done since the last entry**

- Baseline recorded (commit `cd0bd13`).
- Eleven read-only maps of the codebase written to `C:\Temp\octapm-cert\maps\` (01 tenancy, 02 billing, 03 jobs, 04 files, 05a-c routes, 06 test infrastructure, 07 finance, 08 lifecycle, 09 CI and deployment). Their 214 suspected defects are in `OCTAPM_CERT_LEADS.md`. None executed yet.
- C0-1 fixed (commit `ef5e919`): the exception engine is off unless `EXCEPTIONS_ENGINE_ENABLED` is exactly `true`. Unit 69/69 in four files, three mutations caught, live 24/24.
- C0-2 and C0-3 recorded (register).
- Guard proven against real databases: `node scripts/cert/prove-guard.js` with `OTHER_DATABASE_URL` set to the shared database's address — 28 of 28.
- Population specification `scripts/cert/lib/spec.js` (deterministic; unit tests in `scripts/cert/__tests__/spec.test.js`), generator `generate-population.js`, reset `reset-population.js` (destructive guard, one transaction), API client `lib/api.js`.
- Layer 1 applied: `node scripts/cert/generate-population.js --apply` — "layer 1 complete". The specification as generated is in `C:\Temp\octapm-cert\population.json`.

**Tests run for this entry**

| | Discovered | Passed | Failed | Skipped |
|---|---|---|---|---|
| Exception engine unit files (four) | 69 | 69 | 0 | 0 |
| Mutations of the engine default | 3 | 3 caught | 0 survived | |
| Live `pc-7b-exception-triggers`, `pc-7b-exceptions-api` (shared database) | 24 | 24 | 0 | 0 |
| Guard and specification unit tests (`scripts/cert`) | 26 | 26 | 0 | 0 |
| Guard proof against real databases | 28 | 28 | 0 | |

**How to run a certification script**

From `backend/`, with no `DATABASE_URL` in the shell. The scripts read `CERT_DATABASE_URL`, `CERT_ENVIRONMENT_ID`, `CERT_PASSWORD` and `CERT_API_BASE` (default `http://localhost:5190`) from `backend/.env`. The password is also in `C:\Temp\octapm-cert\cert-password.txt`. A stock test suite run from this worktree must be given the shared database's `DATABASE_URL` explicitly, or it will write its fixtures into the certification database and disarm the destructive guard (lead 06/D2).

**Next exact action**

Layer 2: `scripts/cert/load-projects.js` — create each company's projects through the API as its PM, assign teams, then the record drivers (the phase 21 stages made to take any company's people, for the certified projects; a breadth driver for the others). Then `finalize-billing.js`, then `OCTAPM_100_COMPANY_MATRIX.md`, then mark CERT-1 complete.

## 2026-10-02 (later) — CERT-1 layer 2 under way; CERT-2 tooling written

**State**

| | |
|---|---|
| Branch / HEAD | `cert/full-saas-certification`; the commit that adds this entry |
| Checkpoint | CERT-1 in progress. This is the DEVELOPMENT population: it exists to write and prove the loaders and drivers. The certified population is produced by one clean run from an empty database once the drivers are ready (reset → layer 1 → projects → records → certified lifecycles → finalize), with request capture on from the first request |
| Certification database | 100 organisations, 3,008 users, 688 projects (684 from `load-projects.js`, 4 by lifecycle runs), foundation records in every standard and light project; deeper records only in the companies the driver agents use |
| Services | Certification API :5190 (PID in `C:\Temp\octapm-cert\api.pid`); certification Postgres :55433. Shared environment untouched |
| Uncommitted on purpose | `backend/scripts/phase21/*` and `scripts/cert/run-certified-lifecycle.js` (the lifecycle repair workflow is editing them), `scripts/cert/drivers/<area>.js` (the driver workflow is writing them) |

**Background work running when this entry was written**

- Workflow `cert-lifecycle-driver-repair` (run `wf_447e2a96-45c`): makes phase 21 stages 10–18 and `snapshot.js` correct for one clean pass (they hard-coded figures from a project that had been driven twice), then an independent agent audits every changed expectation and runs a fresh pass. Companies 021, 027, 033, 039 are reserved for it. Rule given to it: an expected value changes only with an on-paper derivation; a disagreement between paper and product is reported as a product finding, not edited away.
- Workflow `cert-record-drivers` (run `wf_aed54dfb-200`, script in the session scratchpad `cert/wf-drivers.js`): ten agents, one record driver each (structure, procurement, inventory, subcontract, change-cost, progress, client-billing, quality-field, documents, collaboration-admin), developed on companies 022–032 and 001–010.

**Done since the last entry**

- `load-projects.js`: 684 projects and 8,389 team assignments created through the API as each company's PM. No refusal.
- `load-records.js`, `drivers/_context.js`, `drivers/foundation.js`: foundation records (directory, cost codes, activities, bill, allocations, budget) for every standard and light project.
- The lifecycle (phase 21 stages) made to run as any company's people (`run-certified-lifecycle.js <code>`). On company 021 stages 1–9 pass. Three stale figures corrected with their derivation (704 → 660 material issue; see the comments in stage 8, stage 12, snapshot).
- Request capture in `lib/api.js` → `C:\Temp\octapm-cert\corpus\*.jsonl`.
- CERT-2 tools: `list-routes.js` (1,012 real routes), `lib/tenant-map.js` (which company owns each table's rows: 241 of 245 tables), `isolation/index-ids.js`, `fingerprint.js`, `replay.js`, `read-sweep.js`, `inject.js`, `cross-links.js`, `show.js`.
- `finalize-population.js` written, not applied.

**Trial results (development population, partial corpus — not certification results)**

- Replay of 1,064 captured requests as outsiders: 1,134 attacks, 1,102 refused (401/404), no leak; 8 answered 500.
- Read sweep on two victims: 336 GET routes, 195 bound to real ids, 1,195 attacks, no leak after removing the echo of the sweep's own search text.
- Cross-company reference scan: 0.

**Findings so far from CERT-2 tooling (to be entered in the register when reproduced on the certified population)**

- `POST /inventory/warehouses` and `POST /inventory/items` with another company's `projectId` answer 500 (`P2003`): the service does not check the project, the composite foreign key refuses the row. Nothing crosses; the answer should be a 4xx.
- `GET /company/vendors/{id}/performance` and `GET /inventory/warehouses/{id}/locations` answer 200 with an empty body for another company's id (should be 404).
- Stripe webhook: a signed event whose object has no `customer` (or no `id`) matches the first subscription row of the table (`stripe-webhook.js:27-29, 57-59, 78-80`) — confirmed by reading; to be reproduced and fixed at CERT-4.
- The project team route's role list has eight of the nine roles (no `quality_engineer`); a quality engineer is added with their company role only.

**Next exact action**

When the driver workflow reports: read each report, run every driver on every company with `node scripts/cert/load-records.js` (failures are listed by kind), fix or record. When the lifecycle workflow reports: review the diff of `scripts/phase21`, commit. Then the clean generation run, `finalize-population.js --apply`, `isolation/index-ids.js`, `OCTAPM_100_COMPANY_MATRIX.md`, mark CERT-1 complete. Then CERT-2: `replay.js`, `read-sweep.js`, `inject.js` on the certified population, and the lead-verification workflow for the 46 guessed P0/P1 leads.

## 2026-10-02 (stopped at the usage limit) — work in progress saved, both workflows stopped

**State**

| | |
|---|---|
| Checkpoint | CERT-0 complete. CERT-1 in progress (development population only; the certified population has NOT been generated). CERT-2 tooling written and proven, not yet run for certification |
| Stopped by me | Workflow `cert-record-drivers` (`wf_aed54dfb-200`) and workflow `cert-lifecycle-driver-repair` (`wf_447e2a96-45c`), both mid-run, because the session's usage limit was reached. Neither returned its report |
| Saved as work in progress in this commit, UNREVIEWED | `backend/scripts/cert/drivers/{structure,procurement,inventory,subcontract,change-cost,progress,client-billing,quality-field,documents,collaboration-admin}.js` (written by the driver agents; none has been run at scale or reviewed by me); `backend/scripts/phase21/*` and `scripts/cert/run-certified-lifecycle.js` (edited by the repair agent: expectations of stages 10–18 and snapshot changed for one clean pass — every changed value still has to be audited against an on-paper derivation; the independent audit did not finish) |
| Services left running | Certification Postgres :55433, certification API :5190. Shared environment untouched |

**Proven since the last entry**

- `isolation/prove-tools.js`: the fingerprint and the cross-company reference scan detect a changed row, an added row, a deleted row, a foreign identifier in a text column, a foreign key into another company, and a reference to a non-member — 8 of 8, in a rolled-back transaction.
- `matrix-report.js` written and tried on the development population (its output was not kept: it is not a certification result).

**Next exact action**

1. Review the diff of `backend/scripts/phase21` (git show of this commit): for every changed expected value check the comment's derivation; then run `node scripts/cert/run-certified-lifecycle.js <code>` on a company not yet used (045, 051, 057…) as one clean pass. Lifecycle logs of the stopped runs: `C:\Temp\octapm-cert\logs\lifecycle\`.
2. Run each driver on every company: `node scripts/cert/load-records.js "--drivers=<name>"`; read the failures by kind; fix the driver or record the product finding.
3. Clean generation from an empty database: `reset-population.js --apply`, `generate-population.js --apply`, `load-projects.js`, `load-records.js`, the certified lifecycle on the companies whose first project is `certified`, `finalize-population.js --apply`, `isolation/index-ids.js`, `matrix-report.js`. Mark CERT-1 complete.
4. CERT-2: `isolation/replay.js`, `read-sweep.js`, `inject.js` on the certified population; verify the 46 guessed P0/P1 leads.

## 2026-10-02 (resumed on the owner's "resume from e0bf6c7" brief) — blockers 2-5 fixed; the guessed P0/P1 leads verified

**State**

| | |
|---|---|
| Branch / HEAD | `cert/full-saas-certification`, the commit that adds this entry (after `7ec3d7f`) |
| Checkpoint | CERT-0 complete. CERT-1 still partial: the development population only; the certified population is not generated yet |
| Certification database | Development population (100 companies, foundation records everywhere, deeper records in the driver companies). It also carries residue from the mutation runs of this entry (provider-event audit rows and invoices on companies the mutated code hit, all subscription rows restored; one inventory item of 022 pointing at a supplier of 023). The clean regeneration wipes all of it |
| Services | Certification Postgres :55433; certification API :5190 (PID in `api.pid`, still the code of `bbce8fc` — restart before CERT-1 generation); billing API :5191 (PID in `billing-api.pid`, current code, Stripe calls redirected to the stand-in); Stripe stand-in :5390 (`stripe-fake.pid`). Shared environment untouched |

**Done in this entry**

1. The untrusted commit `e0bf6c7` reviewed (workflow `cert-untrusted-commit-review`): the lifecycle audit re-derived all 26 changed expected values on paper, all equal, nothing weakened; its seven guard/tightening corrections applied (`e3119d9`). A clean lifecycle pass on company 057 with the corrected stages: 18 stages, 0 failures (logs `C:\Temp\octapm-cert\logs\lifecycle\057-*`). Driver reviews: 9 of 10 returned (collaboration-admin's review died at the usage limit); must-fix items per driver are listed in the review journal `wf_18160c82-a45`; NONE of the drivers has been run at scale yet.
2. C0-2 fixed (`b0f5147`): every writer off unless exactly `true`. 13/13 mutations, live 43/43.
3. C0-3 fixed in the repository (`ed43fd1`): deploy workflow reads secrets; stand-ins refused at boot; hygiene check widened. ROTATION OWNER ACTION REQUIRED (register, "C0-3 in detail").
4. Billing webhook (`e50753e`): D2, D3, D4, D20, D23, D24, NEW-1, NEW-4 fixed, NEW-2 partly; live proof 37/37 in octapm_cert, suite 104/106, mutations 9/9.
5. Inventory references (`7ec3d7f`): C2-INV-1 / L5 fixed; live proof 19/19, mutations 5/5.
6. Lead verification (workflow `cert-lead-verification`, run `wf_718e6cf5-98c`): the 46 guessed P0/P1 leads reproduced against the live API; 36 findings in the register (L2-L46 and extras), each with a script in `backend/scripts/cert/leads/` that exits 2 while the defect exists. Ten are cross-company (L3, L4, L5-fixed, L6, L7, L8, L9, L10, L38, L39); three are P0 (L8, L9, L10). The independent re-check ran for 14 findings and died at the usage limit for 22.
7. Billing suites: `suite-webhooks.js` reviewed and committed; `suite-plans-states.js`, `suite-isolation-idempotency.js` and `_probe-iso.js` were left by agents that died at the usage limit — uncommitted, unreviewed, not run.

**Open launch blockers now: 26** (register, "Launch blockers now").

**Next exact action**

1. Apply the drivers' must-fix items (structure L421, procurement L728/L765, inventory L535, quality-field L586, client-billing L229/L611, change-cost L543) and review collaboration-admin.js; then run every driver on six companies outside the development set and read `node scripts/cert/inventory-report.js`.
2. Restart the certification API on the current code; clean generation from an empty database (reset → layer 1 → projects → records → certified lifecycles on the companies whose first project is `certified` → finalize); regenerate a second time from empty and compare shapes; `isolation/index-ids.js`; `matrix-report.js`; CERT-1 complete.
3. CERT-2 from zero on the certified population; fix the cross-company findings (L3, L4, L6-L10, L38, L39 and whatever the sweeps add) until cross-company reads and writes are 0.

## 2026-10-02 (evening) — cross-company P0/P1 fixed; clean CERT-1 generation stopped by a dead database engine; party-visibility fixes under way

**State**

| | |
|---|---|
| Branch / HEAD | `cert/full-saas-certification`, the commit that adds this entry (after `6d1185c`); first push of the branch to `origin` with this entry (no workflow triggers on this branch name — deploy runs on `main` only) |
| Checkpoint | CERT-0 complete. CERT-1 NOT complete: the clean generation started at 16:09 is not certifiable (below) and will be redone on the fixed code. CERT-2 not started |
| Certification database | Reset at 16:09, then layer 1 (100 companies, 3,008 people, 3,052 memberships), 704 projects and 8,840 team assignments, records for companies 001-067 complete (0 driver failures). 068-087 partial, 088-100 not started — a re-run would duplicate the half-made drivers, so this database is now only a PROOF BED for the party-visibility fixes (companies 026, 031, 041, 072; two guests of 072-01 created through the invitation flow). It will be reset |
| Services | Certification Postgres :55433; certification API :5190 restarted at 20:40 on `6d1185c` (PID in `api.pid`); Stripe stand-in :5390. Billing API :5191 stopped (restart with `start-node.ps1 -Billing` when CERT-4 needs it). Shared environment (:5000, :5173, :55432) untouched |

**Done in this entry**

1. Cross-company fixes, each reproduced, fixed, proved in process on the working tree and mutation-proved: L3, L4, L6, L7, L8 (P0), L9 (P0) — `cff20b2`; L10 SSO takeover (P0) — `733046a` (+ route test `6d1185c`); L39 home-admin takeover — `af77a38`. Drivers reviewed, fixed and proven re-runnable — `da8265a`.
2. Clean CERT-1 generation, attempt 1: records reached company 087 in two runs of the loader; at 17:35 the API's Prisma engine died (tokio I/O driver panic, Windows error 1450 "Insufficient system resources" — the workstation had about 1.3 GB free and 1.5 GB of non-paged pool). The Node process lived on: every database request hung for ever (256 requests), three transactions stayed idle in transaction holding row locks for 2 h 46 m, `/api/health` and `/api/health/live` kept answering 200, `/api/health/ready` 503. Proved on the live process through its inspector (app client and a fresh PrismaClient both hang; thread pool, fs, DNS and a plain `pg` connection fine). Recorded as OPS-1 (P2, owner decision on operations); evidence `C:\Temp\octapm-cert\logs\api-wedge-2026-10-02-excerpt.log`.
3. Generation hardening (tooling, committed here): `scripts/cert/run-with-watchdog.js` replaces a certification API whose readiness fails three times running, keeps the dead API's log and records `logs/watchdog.jsonl`; `scripts/cert/layer1-fingerprint.js` hashes layer 1 (companies, people, memberships, subscriptions) for the §6 reproducibility proof; `C:\Temp\octapm-cert\start-detached.ps1` starts a run through WMI so it outlives the agent's two-hour task limit (killing the loader mid-driver would also leave duplicates). Staged, applied after the fix workflow: `lib/api.js` re-sends a request that got no answer only after the API process was replaced (scratchpad `api-retry.snippet.md`).
4. Party-visibility fix workflow running (`wf_22798df3-17f`): documents (L2, L23, L24, FILES-X2), RFI/submittal routing (L40, L42, FILES-X1, X-PARTY-2), commercial figures (L25, L41, L44), audit/custom fields/assistant (L43, L45, L46, X-PARTY-1). L25 re-confirmed on the fresh population: a subcontractor guest refused the prime contract reads 78,800,000 SAR and the LD rate from `GET /projects/:id` and `GET /projects`.

**Open launch blockers: 18 P0/P1** (register). Owner-needed: C0-3 rotation, L38, NEW-3, OPS-1.

**Next exact action**

1. When `wf_22798df3-17f` finishes: review every diff as untrusted, run the unit suites and each proof, commit per area, push.
2. Apply the `lib/api.js` retry; restart the API on the fixed code.
3. Clean generation: move `state/` and `corpus/` aside; `reset-population.js --apply`; `generate-population.js --apply`; `layer1-fingerprint.js take run1`; reset and generate again; `take run2`; `compare run1 run2` (must be IDENTICAL); `load-projects.js`; then `start-detached.ps1 -Name gen-records -Script scripts/cert/run-with-watchdog.js -ScriptArgs "scripts/cert/load-records.js --concurrency=8"`; the 14 certified lifecycles (021,027,033,039,045,051,057,063,069,075,081,087,093,099); `finalize-population.js --apply`; `matrix-report.js`; `isolation/index-ids.js`.
4. CERT-2 on that population (fingerprint before/after; replay, read-sweep, inject, cross-links).
