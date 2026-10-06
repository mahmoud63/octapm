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

## 2026-10-02 (night) — party-visibility round 1 committed; independent review found 39 more; round 2 running

**State**

| | |
|---|---|
| Branch / HEAD | `cert/full-saas-certification` at the commit adding this entry (after `49ea340`), pushed |
| Checkpoint | CERT-1 not complete (the clean generation waits for the fixes). CERT-2 not started |
| Certification database | Still the proof bed of the evening entry (companies 026, 031, 041, 072 carry the fix agents' fixtures). To be reset |
| Services | Cert Postgres :55433; cert API :5190 PID in `api.pid` (restarted by the watchdog test at 22:21, runs the round-1 working tree); Stripe stand-in :5390 |

**Done in this entry**

1. Tooling, committed: CERT-2 judging hardened — 4xx other than 401/403/404 no longer passes, figure-only answers compared with the owner's, random-id control (`5d02dfd`); a database-bound file sweep and the CERT-2 and lifecycle runners (`43389ab`); request retry after a watchdog restart, proven by killing the API mid-run (40/40, `391fabe`).
2. Round 1 of the within-company visibility fixes (L2, L23, L24, L25, L40, L41, L42, L43, L44, L45, L46, FILES-X1, FILES-X2, X-PARTY-1, X-PARTY-2): written by four agents, then verified here — changed suites 214/214, full suite 3,174 (one pinned-argument test updated), all 22 proofs and lead scripts re-run in process (21 + L43 after its oracle was corrected and mutation-proved), template and assistant follow-ups added with tests and mutations. Committed per area: `978023b`, `295f4f9`, `d88f275`, `49ea340`.
3. Independent adversarial review of those diffs (four reviewers, read-only): all SHIP_WITH_FIXES, 39 findings — 10 P1 (among them a bypass the round itself introduced: links written through unchecked paths now count as read grants, R29; and a regression: a consultant step reviewer can no longer open the submittal, R4), 8 P2, the rest P3. Recorded in the review journal `wf_e36cca78-855`.
4. Round 2 launched (`wf_add102be-96d`): every finding reproduced or refuted first, then fixed, proven refused and allowed, mutation-proven, round-1 proofs re-run.

**Next exact action**

1. When round 2 reports: verify independently (unit suites, every proof in process, full suite), adjudicate REFUTED/PRODUCT_DECISION verdicts by reading the code, commit per area, update the register (round-1 leads fixed; review findings with their verdicts).
2. Then the clean generation and CERT-2, exactly as in the evening entry's next action (now with `run-with-watchdog.js` and `start-detached.ps1`).

## 2026-10-03 (early) — party-visibility round 2 committed; clean CERT-1 generation next

**State**

| | |
|---|---|
| Branch / HEAD | `cert/full-saas-certification`, the commit adding this entry (after `ada413a`), pushed |
| Checkpoint | CERT-1 not complete (generation next). CERT-2 not started |
| Certification database | The proof bed (to be reset now) |
| Services | Cert Postgres :55433; cert API :5190 (PID in `api.pid`, round-1 code — restart on HEAD before generation); Stripe stand-in :5390 |

**Done in this entry**

1. Round 2 (`wf_add102be-96d`) on the 39 review findings: 10 P1 confirmed and fixed (R29 and R4 had been introduced by round 1), R1/R2/R6 refuted against the approval-workflow table, R12/R18 not reproducible, R5/R22 and RFI drafts left as owner decisions. Verified here: full suite 255/255, every proof and lead in process 30/30.
2. Fixed here from round 2's notes: N3 (P1, workspace dashboard queues to readers refused those modules; 3/3 mutations), burn-rate budget line (P2; 2/2), submittal step reviewers' files (2/2), R14 rule (latent; unit).
3. A mutation restore inside the OneDrive worktree read back truncated (`audit.service.js`); recovered byte-exact from the jest transform cache (the only cached source the truncated text prefixes) and verified; `scratchpad/cert/mutate.js` now backs up and re-verifies every restore.
4. Committed: `1059c6b` documents, `5966119` RFI/submittal, `3676356` commercial + burn rate, `3102c23` specs/photos + N3, `ada413a` audit/assistant. Register: fifteen leads marked fixed; a review-rounds section with every finding's verdict.

**Open launch blockers: 6 P0/P1** — L38 (cross-company, owner), L11 (jobs, CERT-6), L34-L37 (finance, CERT-5). Owner decisions: C0-3 rotation, L38, NEW-3, OPS-1, R5, R22, RFI drafts.

**Next exact action**

Clean generation on HEAD (sequence in the evening entry): restart the API on HEAD; move `state/` and `corpus/` aside; reset; layer 1 twice with `layer1-fingerprint.js` take/compare; `load-projects.js`; records detached under the watchdog; `run-lifecycles.js`; `finalize-population.js --apply`; `matrix-report.js`; then `run-cert2.js` detached.

## 2026-10-03 — CERT-1 COMPLETE: the certified hundred-company population

**State**

| | |
|---|---|
| Branch / HEAD | `cert/full-saas-certification`, the commit adding this entry (after `970dd01`), pushed |
| Checkpoint | **CERT-1 complete.** CERT-2 next |
| Certification database | The certified population, generated from empty on `970dd01`; nothing may write to it outside the sweeps |
| Services | Cert Postgres :55433; cert API :5190 (restarted fresh before CERT-2); Stripe stand-in :5390 |

**Evidence**

1. Layer 1 generated from an empty database three times (`layer1-fingerprint.js`): runs 1, 2 and 3 identical row for row — 100 companies (20 small / 50 medium / 30 large), 3,008 people, 3,052 memberships, 100 subscriptions.
2. 704 projects and 8,840 team assignments through the API, 0 notes.
3. Records through the API, detached under the watchdog: 3,895 driver runs, 0 failed, 0 API restarts (an earlier attempt failed the subcontract driver in all 325 projects after round 2's R29 — correct product behaviour; the driver was fixed, `970dd01`, and the whole population regenerated rather than re-running on half-made records).
4. The 14 certified lifecycles (021…099): 18/18 stages each, 496 known-answer checks each, 6,944 passed, 0 failed.
5. `finalize-population.js --apply`: 183 project stages, 142 deactivations, 120 invitations, user C suspended in 100, all 100 billing states (99 cards, 273 invoices).
6. `OCTAPM_100_COMPANY_MATRIX.md`: 100 companies, 2,995,962+ company rows in 198 tables; every difference from the specification explained (the 14 certified projects built by the lifecycle as a greenfield and an isolation project each). No durable data touched: the guard, a separate cluster, and the naming rule.

**Next exact action**: CERT-2 — `start-detached.ps1 -Name cert2 -Script scripts/cert/run-with-watchdog.js -ScriptArgs "scripts/cert/run-cert2.js --tag=cert2"`, then the "CERT-2 TENANT ISOLATION COMPLETE" report.

## 2026-10-03 — CERT-2 first full run on the certified population: cross-company references found; fixing

**State**: HEAD after `7d887ee`. The certified population was attacked by `run-cert2.js` (tag `cert2`, 83 min, 0 API restarts); it now holds the injection sweep's 1,787 cross-company references and will be regenerated after the fixes. Results: `C:\Temp\octapm-cert\results\isolation\cert2-*.json`, logs `logs\cert2\`.

**Measured**

| Sweep | Attacks | Outcome |
|---|---|---|
| Instruments | prove-tools, prove-judging | pass |
| Read sweep (all GET routes × 100 victims × outsider / member elsewhere / anonymous) | 73,708 | 56,206 refused, 302 filtered (proven no data), 17,200 query probes empty; **0 leaks, 0 answered, 0 server errors** |
| Fingerprint around the read sweep | — | changes in 100 companies, every created row attributed to the company's **own PM** (the sweep's owner-binding reads: GET creates notification preferences, scope matrices, closeout sheets, evaluations lazily) — no cross-company write; GET-with-side-effects recorded as P3 |
| File attacks (9 stored-file routes, real files of every company) | 5,914 | **all refused** |
| Replay (every captured request as outsider / member elsewhere / anonymous) | 234,974 | **victim data changed: 0**. 527 "writes accepted" are /reports/preview and /notifications/scan-due (act on the caller's own company); 6,892 "late" are all 402 SUBSCRIPTION_REQUIRED (the caller's own lapsed billing); 4 answered (inventory analytics/summary, caller's own figures — to confirm) |
| Foreign-reference injection (another company's ids in each company's own requests) | 28,811 | **1,787 cross-company references stored** across 18 kinds (bid lines, PO lines, progress/daily/weekly evidence and activities, commitment insurance, attachments on another company's bid package, report schedules and review/workflow templates naming another company's people); **141 leaks** (a bid line created with a foreign activity, cost code or budget line returns it); ~3,800 refused by the caller's own record locks before the reference check (coverage note) |

**Verdict so far**: cross-company reads ≠ 0 (141), cross-company writes ≠ 0 (stored references). Not a pass. Fix workflow `wf_b3f79c3b-51b` (five groups, 32 route/field pairs) is reproducing and fixing each with the tenant-reference helpers.

**Next exact action**: verify and commit the fixes; regenerate the population from empty (the census baseline must be 0); re-run `run-cert2.js`; report.

## 2026-10-03 (midday) — CERT-2 foreign-reference findings fixed; clean regeneration and second run started

**State**

| | |
|---|---|
| Branch / HEAD | `cert/full-saas-certification`, the commit adding this entry (after `89e2d9a`), pushed |
| Checkpoint | CERT-2 not complete: fixes done; the second run on a freshly regenerated population is running |
| Certification database | Being regenerated from empty by `C:\Temp\octapm-cert\regen-cert2.ps1 -Tag cert2b` (the first run's injected references made it a polluted proof bed) |
| Services | Cert Postgres :55433; cert API :5190 (restarted by the sequence on HEAD); Stripe stand-in :5390 stopped until CERT-4 |

**Done in this entry**

1. Fix workflow `wf_b3f79c3b-51b` (five groups) reproduced each of the 32 injected route/field pairs before fixing: 22 fixed, 10 no effect (proven; guards pinned by mutation). New findings fixed while reproducing: `POST /punch/bulk` items (P1: stored and returned another company's location, activity, company and people), bid package `procurementPackageId`, PO `materialMasterId`, commitment insurance on POST/PATCH (and any id counted as a certificate on file), orphan attachments for every record type, report runs and schedule PATCH, workflow action-step users, permission-template assignees, `POST /reports/export`.
2. Closed here from the groups' cross-group notes: activity material `materialMasterId` (`ensureMaterialMaster`; 4 unit tests, mutation caught); the primary `activityId` on RFI update and on correspondence, defect, ITP and material-test create/update (`assertPayloadActivity`): 24 failures reproduced by the new `workflow-activity-proof.js` before the fix, 72/72 after, 3/3 mutations caught. The injection judge now counts a batch answer refusing every item as not found as refused (`specifications/index`).
3. Verified: backend suite 258/258 suites, 3,309 tests; every proof and lead in process (36 scripts; the runner now stages the lead scripts first and reads in-process invitation mail from each script's own output, which the regenerated population needs).
4. Committed: `2fc776e` procurement/bids/materials, `e4f57e2` progress/reports, `5aa9c41` attachments/insurance, `99bdbc4` people/templates, `b820016` punch/activities, `89e2d9a` tooling. Register: a CERT-2 section (eight P1 cross-company writes and three P3, all fixed; C2-N1..N4 recorded).

**Next exact action**: when `logs\regen-cert2b\status.txt` says DONE — check layer 1 compared IDENTICAL to run 1, 0 failed driver runs and lifecycles, the matrix, then triage `results\isolation\cert2b-summary.json` and write the "CERT-2 TENANT ISOLATION COMPLETE" report.

## 2026-10-03 (evening) — second CERT-2 run clean on its sweeps; coverage triage found 40 unjudged pairs; three fix rounds

**State**

| | |
|---|---|
| Branch / HEAD | `cert/full-saas-certification`, after `2e3dbe6`, pushed; round 3 of fixes in the working tree (uncommitted) |
| Checkpoint | CERT-2 not complete: fixing what the coverage triage and the reviews found; a final regeneration and run on the final code follow |
| Certification database | The `cert2b` population, now carrying residue rows from the fix rounds' reproductions and reviews (to be regenerated) |
| Services | Cert Postgres :55433 and cert API :5190 restarted at 19:25 CDT after both received a console Ctrl-C at 18:46 (OPS-2, recorded); Stripe stand-in stopped |

**Measured on `cert2b` (population regenerated from empty on `8c445dc`; layer 1 identical to run 1; 704 projects, 8,840 assignments; 3,895 driver runs, 0 failed; 14 lifecycles × 496 checks, 0 failed)**

| Sweep | Attacks | Result |
|---|---|---|
| Read sweep (after an owners-only warm-up) | 73,708 | 56,206 refused, 302 filtered, 17,200 query probes empty; 0 leaks, 0 answered |
| Read-window fingerprint | — | 1,212 rows changed, every one attributed row by row to a member of its own company (`attribute-changes.js`): each company PM's own notification preferences (outsider-query reading its own settings), owners' own document download/preview audit. 0 rows naming anyone outside their company. Warm-up window likewise (evaluations, checklists, scope matrices) |
| File attacks | 5,910 | all refused; data changed 0 |
| Replay | 234,974 | 0 accepted writes, 0 answered; data changed 0; all 501 routes judged by the product's own refusal |
| Injection | 28,811 | 0 accepted, 0 leaks; 0 new cross-company references (census start = end = 0) |
| Injection, victims fingerprinted (odd→even, even→odd) | 28,811 | victim companies changed 0, attackers' own 0, new references 0 |
| Realtime + workspace switching (`realtime-proof.js`, 5 pairs) | 117 checks | 117 passed after the membership fixes below; controls delivered |

**Coverage triage** (`cert2-coverage.js`): 40 of 292 injection route/field pairs were refused only by the attacker's own record state (409) or billing (402) — never judged. Driving them on fresh open records (`wf_9475ec24-3af`, six groups, each independently reviewed) found real cross-company writes the sweep could not reach: daily-log entry company (stored and served back), goods-receipt bin (stored; another company's bin and canary then served by the item scan), change-event RFQ vendor, timesheet crew foreman; plus PO-line lock on another company's row, bid-invitation ordering, change-order activity oracle. Round 2 (`wf_815f0072-f13`): crew party, worker person/company (create/update/import), timesheet company, daily-log distribution people, inventory reads scoped to the company, goods-receipt daily report (operator injection), a re-runnable inventory proof, and a systematic **shape sweep** (each id sent as an array, nested array, object, number, boolean, operator): 185 5xx at baseline. Round 3 (`wf_c8cd2d06-ada`, running): daily-report engineer (stored), progress evidence in other shapes (stored), workflow-record activity links checked before the write (oracle), the remaining 5xx.

**Fixed here**: project team add and comment mentions by membership (`94bef49`, a person of two companies could not be placed or mentioned in the second); the tenant-reference helpers refuse non-identifiers instead of dropping them (`2e3dbe6`; the root of several reviewer findings).

**Next exact action**: when round 3 reports — review, full backend suite, every proof in process, commit; regenerate the population from empty on the final code (`regen-cert2.ps1 -Tag cert2c`, with the shape sweep, the victim-state injection and the gap proofs added to the run); report "CERT-2 TENANT ISOLATION COMPLETE" if every count is 0.

## 2026-10-05 — CERT-2 scope frozen (owner: "NO ROUND 8"); low-usage mode; final run on the frozen code

**State**: HEAD after `b18a86f` (fix rounds 5-7 committed `bfa9242`), pushed. Round 7 (wf_9e12a67f-00b) completed its fixes but both its attempts were stopped by the account limit before review; the tree was checked against each group's final snapshot — no mutation or partial edit left (one empty helper removed). Backend suite: 290 of 296 suites pass; the 6 others are DB-backed suites that need the shared development database on :55432, which is down (each failure is the unreachable database; they passed at the round-6 checkpoint). Cert cluster and API were down after a machine restart; cluster restarted 02:34 CDT.

**Owner rules now in force**: CERT-2 is tenant isolation only; non-tenant findings are recorded and deferred (register: D-FIN-1, D-FUN-1/2, D-DQ-1, D-OPS-1); no reviewer waves; scripts do the testing; reports are deltas. Until Oct 8 21:00: one orchestrator, Codex for bounded work where available, no agent waves.

**Final run**: `C:\Temp\octapm-cert\regen-cert2.ps1 -Tag cert2c` — regeneration from empty (CERT-1's deterministic population; a disposable baseline, not a restart), a server-side snapshot of the certified population (`scripts/cert/snapshot-db.js take cert2c`, so later baselines are a copy back), then `run-cert2.js` with every check: reads (after owner warm-up) + attribution, files, replay, injection, reference census, victim-state injection, coverage, realtime + workspace switching, shape/query/date sweeps, every CERT-2 proof in process, tally.

**Next exact action**: when `logs\regen-cert2c\status.txt` says DONE, read `results\isolation\cert2c-tally.json` and the step exits in `cert2c-summary.json`; triage only failures; report "CERT-2 TENANT ISOLATION COMPLETE" in the owner's format.

## 2026-10-05 — CERT-2 TENANT ISOLATION COMPLETE

| | |
|---|---|
| Branch / HEAD | `cert/full-saas-certification`; run on `4856924`, closed with the proof-setup correction committed after it |
| Checkpoint | **CERT-2 complete.** CERT-3 next (QUALITY-FIRST mode from here) |
| Certification database | `octapm_cert` = the `cert2c` population after the run's attacks; clean copy kept as `octapm_cert_snap_cert2c` |
| Services | Cert Postgres :55433 and cert API :5190 (PID 31384) up |

**Run** (`regen-cert2.ps1 -Tag cert2c`, 02:34-09:36 CDT): layer 1 identical; 704 projects; 3,895 driver runs, 0 failed; 14 lifecycles × 496 checks, 0 failed; snapshot taken; `run-cert2.js` 236 min, 0 API restarts.

**Tally first** (`cert2c-tally.json`): 365,950 attacks over 668 routes — leaks 0, answered 0, writes accepted 0, server errors 0; replay and file data changed 0; census start/after-injection/end 0, new 0. Victim-state halves: 0 victim (company, table) pairs changed. Realtime + workspace switching 117/117. Shapes 1,746 / query 52,255 / dates 9,854: 0 5xx, 0 new references, 0 oracle pairs differing. Attribution: read window 1,206 rows and the warm-up's rows all in the requester's own company, 0 naming an outsider. The two fingerprint comparisons exit 2 by design (they list changed rows for attribution).

**Triage of the five proof steps that did not exit 0** (no product fix needed):

1. `punch-rfi-tasks` and `quality-forms-safety-state` failed at setup: they took foreign ids from an earlier run's injection file (`cert2-inject.json`, `cert2b-inject.json`), whose rows the regeneration replaced. Now they use such a file only while its project is still the attacker's own, else read the ids from the database: 167/167 and 138/138 on the cert2c population.
2. `inventory-timesheets-state` and `inventory-3` failed only their setup check for the brief's residue rows (pinned ids of the first population's pre-fix reproduction; a clean population has none — census 0). Now required only where the pinned bin exists: 140/140 and 279/279.
3. `availability-7` 37/38: the fix passes (22 ms); the proof's own baseline comparison missed its 400 ms margin (361 ms). Not tenant: D-PERF-1, CERT-7.

Also recorded, not tenant: D-VAL-1 (transmittal / NCR submit accept non-string `storageKey` shapes and drop them; CERT-3).

**Open**: L38 (P1, cross-company: `POST /users` attaches another company's person without consent and returns their profile) — designed behaviour (membership doc §5), owner decision since 2026-10-02, outside what the sweeps exercise. Document text content: CERT-6. Backend suite: 290/296 suites passed; 6 suites were not executable because the expected development PostgreSQL on :55432 was unavailable — not green until those six pass in their intended environment before release certification.

**Next exact action**: CERT-3 (construction workflows) under QUALITY-FIRST mode: plan from `C:\Temp\octapm-cert\scratch\cert3-gaps.md` on representative deep companies, keeping the 100-company evidence; Codex adversarial plan review before high-risk changes.

## 2026-10-05 (afternoon) — L38 closed on the owner's decision; QUALITY-FIRST applied

**Owner decision** (2026-10-05): an e-mail that belongs to an existing identity joins a workspace only through an invitation it accepts with its own authenticated session; nothing about it is disclosed before; acceptance writes only the offered membership and role. Bounded L38 correction, CERT-2 not reopened.

**Process** (QUALITY-FIRST): L38 reproduced on `54a48b2` (lead exit 2: profile leaked, forced active membership, the victim saw the attacker's workspace). Plan → Codex adversarial plan review (desktop CLI 0.160; 8 HIGH, every one checked in code and adjudicated) → implementation → proof → 9 mutations → Codex verification of the diff (5 HIGH/MEDIUM gaps confirmed, fixed) → 2 more mutations → Codex check of those fixes (deadlock in party removal, OpenAPI, web hand-off: fixed; stop condition — no CRITICAL/HIGH open) → workflow code review of the final diff. Adjudication: `C:\Temp\octapm-cert\scratch\l38-adjudication.md`.

**What changed**: `POST /users` with an existing identity → invitation (202, neutral body); invitations never write a membership, one pending per (company, e-mail) under a lock, superseded links revoked and audited; "part of a workspace" = active or suspended membership (or a legacy row with none) — an invitation is not membership (lists, pickers, duties, team, party, activate); acceptance by the identity's own session only (not the password, not another session, not another company's SSO session), atomic claim, exactly the offered membership (no restored admin/owner), the offered party still the offered one (row lock), session issued as any workspace session (SSO-only policy; own-SSO sessions stay bound), a reopened home account signs in afterwards; web accept page signs the person in (password + MFA) and accepts with that session. **Also found by the review and fixed — a cross-company read (C2-CF, P1)**: custom fields of type person/company took any id and reports printed the other company's person or company by name.

**Evidence**: `l38-invitation-proof.js` 54/54 (old code: 15 of its first 35 failed); 14/14 mutations caught; L38 lead not reproduced; 14 regression proofs pass (one first failed on an unreachable database while the machine was saturated by the full suite + Codex + proofs, then 11/11 on a quiet machine); sentinel on the final code — 247,530 attacks over 666 routes: leaks 0, answered 0, writes accepted 0, 5xx 0, replay data changed 0, new cross-company references 0, realtime 117/117. The census found 38 references left by the proof's own fixture rows and by the audit trail of the mutation run that re-introduced the custom-field defect (all on the proof's records in 024): deleted, census 0 before and after a fresh proof run, and the proof now removes its fixture rows.

**Deferred** (register): D-SEC-1 (MFA-required not enforced anywhere; CERT-7), D-ID-1 (201/202 tells an admin an account exists — owner decision), D-ID-2, D-ID-3 (CERT-3), D-SSO-1 (CERT-7), D-TEST-1 (pre-release).

**Backend suite**: 290/296 suites passed on a quiet full run of the change before the last review fixes; on the final code the last full run was 289/296 — the 6 suites not executable because the expected development PostgreSQL on :55432 was unavailable, plus `identifier-shapes.routes.test.js` "POST team userId", which already took 4.3 s of jest's 5 s at round 7 and times out in some full runs (passes alone, 91/91; D-TEST-1). Affected unit suites all pass. Short sentinel on the final code: census 0 → 0, read sweep 7,513 attacks refused/filtered/empty, realtime 117/117.

**Next exact action**: CERT-3 (construction workflows) under QUALITY-FIRST: plan from `C:\Temp\octapm-cert\scratch\cert3-gaps.md` on representative deep companies, keeping the 100-company evidence; Codex adversarial plan review before high-risk changes.

## 2026-10-05 (evening) — CERT-2 accepted by the owner; CERT-3 started

**Owner acceptance**: CERT-2 = **PASS**; P0 = 0; P1 tenant-isolation = 0. The tenant-isolation evidence is authoritative; CERT-2 is not reopened. CERT-0, CERT-1 and CERT-2 are not restarted.

**Owner decision D-ID-1**: a fully invitation-based user add — the same neutral answer for new and existing e-mails; no admin creates or sets another person's password; the recipient creates or signs into their own identity and accepts; membership activates only after acceptance. First bounded identity/onboarding item of CERT-3.

**Carried to final release**: the six backend suites that need the development PostgreSQL on :55432 must pass in their intended environment; the slow "POST team userId" test (D-TEST-1) is tracked and not hidden by a timeout unless a real performance regression is proven.

**CERT-3 mode**: QUALITY-FIRST — Claude integration owner; Codex independent review of high-risk plans and diffs; automated evidence mandatory; code review at meaningful batches; PR Review Toolkit before an important merge; Ralph Loop only with explicit stop conditions. The CERT-3 plan is returned to the owner before any high-risk workflow-rule change. Representative deep companies; the 100-company CERT-2 population and evidence are kept (clean baseline: snapshot `octapm_cert_snap_cert2c`).

**Next exact action**: map D-ID-1's surface and the CERT-3 workflow areas; D-ID-1 plan → Codex plan review → implement → proof; the CERT-3 plan to the owner.

## 2026-10-05 (night) — CERT-3 plan returned; D-ID-1 design review adjudicated

**CERT-3 plan** (`OCTAPM_CERT3_PLAN.md`, `5e819c1`) returned to the owner: D-ID-1 design, deep companies 087/052/011, WP-0..WP-9, the §5 high-risk rule decisions, exit criteria and sequencing.

**Codex adversarial review of the D-ID-1 design**: INCOMPLETE. Every finding was checked in code by eight read-only checkers, then adjudicated by the integration owner (`C:\Temp\octapm-cert\scratch\did1-adjudication.md`). Confirmed HIGH:
- **MP-1**: SSO auto-provisioning is a second user-add door with no invitation. It is on by default, an empty domain list allows any domain, and a missing `email_verified` is accepted.
- **MP-2, new D-SSO-2**: a non-home company's SSO session can enrol the global second factor and bind the global SSO subject of a shared person, which locks them out of every company.
- **MP-4, new D-ID-4**: a password reset does not evict a live bearer. `POST /auth/workspaces/:orgId/session` mints a fresh refresh family from a pre-reset access or identity token, indefinitely.
- **MP-7**: an outstanding project or party link survives suspension and reverses it. For a closed identity it sets a new password without a session.

Downgraded to MEDIUM: the reset-e-mail route, registration pre-claiming (closed in production by default), flag-off acceptance (the switch is never set off), the mobile app-link catch-all and mobile MFA (unreleased client), SSO-only recipients, and sole-owner recovery. Rejected: keeping the old link valid until a resend is delivered (the fail-closed revoke-before-send stays).

**Plan §2 revised (revision 2)**:
- Settled now, no new rule: eligibility under the lock; suspension cancels outstanding links; identity-wide admin guards count present memberships; a delivery-failure contract; the reset-e-mail route specified; the web edit payload; the cross-organisation acceptance code; the helper matches its invitation.
- Questions Q1–Q14 to the owner, each with a recommendation.
- Proof checks C1–C11 and mutations M1–M16.

**Next exact action**: implement the settled part of D-ID-1 (§2.1, §2.3–§2.5) while the owner answers Q1–Q14 and the open CERT-3 plan questions.

## 2026-10-05 (late night) — owner decisions on D-ID-1 revision 2; plan revision 3

**Owner decisions:** Q1–Q14 decided. They are recorded verbatim in substance in `OCTAPM_CERT3_PLAN.md` §0.1 and §2.2, with the resulting design.
- **Now in the D-ID-1 batch (coupled security fixes):**
  - SSO never creates identities or memberships;
  - per-workspace SSO links;
  - SSO sessions cannot change the identity's factors;
  - a completed reset is a global security event (credential epoch);
  - no enumeration through sign-in or reset;
  - sign-up closed in production;
  - the emergency switch fails closed for expansion only;
  - an operator owner-recovery command with two-person approval;
  - Android leaves auth links to the web.
- **Release gates:** real e-mail delivery (D-MAIL-1); D-ID-1 before the first real user (D-ID-5); the mobile installed-app and no-app device test (D-MOB-DL-1).
- **Deep companies:** 087 and 052 are approved. The third is a small Business or Trial company, chosen in WP-0; 011 stays for Individual-plan cases.
- **Rules decided:** HR-Q1, HR-P1, HR-C1, HR-S2 and HR-X1.
- **Finance:** L34 comes into CERT-3 if reproduction confirms it; L35 and L36 stay in CERT-5.
- **The ~174 mapping findings** are suspects: reproduce, classify, then fix or defer.

**Next exact action:** implement the identity batch (server, then proofs C1–C18 and mutations M1–M24, then web, mobile, docs and scripts). Then Codex reviews the final diff and the findings are adjudicated. WP-0 follows.