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

## 2026-10-09 — D-ID-1 identity batch closed (with Q-KEY); WP-0 prepared

**Implemented** (`886c9f1`, then the Q-KEY commit). The owner decisions Q1–Q14 are built as one bounded identity batch:
- **User add** is invitation only: `POST /users` is an alias of the invitation, gives the same neutral answer for new and existing e-mails, and no administrator sets a password. Pending invitations can be listed, revoked and resent by invitation managers. The administrator's reset route is replaced by a reset e-mail.
- **Credential epoch.** Every token carries `cep`. A completed reset, an identity closed, an admin MFA reset and a reopening acceptance each bump the epoch and end every refresh session, SSO ticket and (Q-KEY) API key the person created. The epoch is checked on requests, refresh, workspace switching and its resolve route, the MFA challenge and sockets.
- **SSO.** SSO creates no identity or membership, links are per workspace, and an SSO session cannot change the identity's second factor.
- **No enumeration** through sign-in or the reset request.
- **Registration** is closed outside development and test.
- **The emergency switch** fails closed for expansion only.
- **Owner recovery** is an operator command with two-person approval.
- **Mobile** leaves invitation and reset links to the browser.

**Owner decision Q-KEY (2026-10-09), option (a).** A credential event revokes the keys the person created; creating or widening a key holds the session's epoch; revoking never waits. Implemented in `auth.service.endIdentitySessions`, which is now the one helper for every credential event, and in `api-client.service` (`atActorEpoch`).

**Codex review of the Q-KEY diff:**

| Finding | Severity | Verdict and fix |
|---|---|---|
| A reach field resent unchanged was written back over a concurrent narrowing | HIGH | Confirmed. Unchanged reach fields are now left out of the write. |
| A reopening acceptance did not re-check the identity under its row | HIGH | Partial, downgraded to LOW. Codex's Activate path answers 404 for a member who left (proven live). The guard is kept: it locks the row first and gives 401 INVITATION_SIGN_IN_REQUIRED. |
| Per-key audit inserts inside the 5 s transaction | MEDIUM | Confirmed. Now a fixed number of statements, with `createMany`. |
| A hand revocation audited as a credential event | LOW | Confirmed. The read-back is by the event's instant. |

The five proof gaps Codex named are all closed with checks: K1.4, K4.2, K5.3b/c, K5.5, K5.6. Adjudication: `C:\Temp\octapm-cert\scratch\qkey-adjudication.md`.

**Evidence** (final code, cert API restarted on it):

| Evidence | Result |
|---|---|
| D-ID-1 proofs | 335/335: user-add 48, guards 68, sessions 67, SSO 36, owner recovery 74, keys 23, client-static 19 |
| CERT-2 regression proofs | 506/506 |
| Realtime (`--from=040` and `--from=094`, 4 pairs each) | 188/188 |
| L26 | exits 2 as expected (D-SEC-1, CERT-7) |
| Full mutation run on `886c9f1` | 207/208 caught. The 130 proof mutations failed checks (exit 2); the 77 unit mutations failed named tests. M17 survived because no check covered the resolve route; C12.7b now covers it. |
| Targeted re-run after Q-KEY | 73/73 caught (`results\cert3\d-id-1-mutations-qkey.json`):
  - QK1–QK16 on the keys proof;
  - M17, now caught by C12.7b;
  - the re-targeted MU-5, MD-3 and R2-F3b/c/d;
  - the new unit mutations MR-4..7, MD-6 and MAPI-6..11;
  - every existing mutation in code Q-KEY touched.
  R2.9 and MA-1 had stopped parsing after the H1 guard (a dangling `else`), so their first catches proved nothing. Both were re-targeted and re-run, and both are caught by their intended checks (C12.13; the named unit test). A syntax check of all 235 applied mutations (`scratch\qkey\mutsyntax.js`) now runs before each run: 0 unparseable. Inventory: 235 mutations. |
| Backend unit suite | 6287/6288. The one failure is D-PAGE-1 (below), a product defect exposed by population growth, not caused by Q-KEY. |
| Codex | Rounds 1–3 on the batch and one round on Q-KEY: no CRITICAL or HIGH open after adjudication |

**Register:**
- D-ID-1, D-ID-4, D-SSO-2 and Q-KEY are Fixed; D-OWN-1 is Built.
- New: D-PAGE-1, and the Q-KEY follow-ups F1 and F2 (owner questions).
- The recorded LOWs are listed under the D-ID-1 section of `OCTAPM_LAUNCH_BLOCKERS.md`.

**D-PAGE-1 (new, P2 proposed, confirmed).** `GET /users` pages by `createdAt` alone. In CERT-044, 24 of 27 people share one creation instant, and 3 of them are returned by no page. The users half of `cursor-pagination.test.js` compared against a single page, so it passed only while that workspace had 20 people or fewer; its baseline now comes from the database. The fix is a separate commit: a unique tie-breaker, plus a sweep of the other cursor lists.

**WP-0 prepared** (no database work yet; the mutation runs held the tree):
- **Answer book** `scripts/cert/cert3/answers/` (schedule 706, commercial 580, field and controls 268 figures). Each section was drafted, then re-derived by an independent verifier (1,439 of 1,477 agreed). The disagreements were adjudicated in `C:\Temp\octapm-cert\scratch\wp0\adjudication.md` and applied, and the applied changes verified again.
- **Permission matrix and probe** (292 transitions × 9 roles, computed from `shared/permissions.json`).
- **Lifecycle post-hoc verifier** over the 14 certified projects, and the stage-script edits that assert the stage table's known answers. The proving run uses stamp `C087R`.
- **D-ID-2 and D-ID-3 reproduction scripts**, and the shared harness `scripts/cert/cert3/lib/harness.js`.
- **Third deep company: 006 Atlas Infrastructure** (Business, active, 4 people, AED, Asia/Dubai with no DST); one finance person is to be invited. Plan corrections:
  - 087 observes DST;
  - 087-COM-B's retention rates were swapped;
  - the 052-SCH-EV order;
  - HR-C1 written into C3 and I1;
  - the D3 lane.
- **New owner questions in plan §0 item 5:**
  - HR-A1: company administration grants beyond the policy;
  - HR-A2: deletes guarded as updates;
  - HR-A3: no finance member;
  - the Q-KEY follow-ups;
  - the 087-SCH 72,000 row.
  CLAUDE.md's "Retention default 5%" conflicts with HR-C1; that is the owner's to change.

**Next exact action:**
1. Commit the D-PAGE-1 fix separately.
2. Run WP-0 live, one database writer at a time:
   - confirm the 006 facts;
   - D-ID-2 and D-ID-3 repro;
   - the permission probe in process;
   - the post-hoc verifier with the API idle;
   - the C087R proving lifecycle, detached.
3. Classify every finding.
4. Build the deep companies 087, 052 and 006 (detached, with watchdog); snapshot `cert3d`.


## 2026-10-09 — D-PAGE-1 fixed (pagination ties); D3 confirmed

**D-PAGE-1.** Four cursor lists sorted on a value that rows can share, without a unique last key, so tied rows were returned by no page or twice:
- `listUsers`: in CERT-044, 24 of 27 people share one createdAt, and 3 were unreachable;
- `listTasks`;
- `listMeetings`;
- `listMessages`: it read older messages by createdAt alone.

The fix:
- every sort ends on `id`;
- `GET /users` honours `limit`, as its OpenAPI already documented;
- an unknown message cursor pages nothing, instead of the newest page.

Evidence:
- `scripts/cert/cert3/d-page-1-proof.js` passes 17/17. It is read only and walks each list two rows per page, for every sort and direction, over certification data with real ties and NULL dates.
- Mutations: 7/7 caught. The runner now has the lists `dpage` and `dpage-unit`.
- Unit suite: 6289/6290 in the full run. The one failure was a 5 s timeout under load in `module-action-permissions.test.js`, a D-TEST-1-class timing flake; the suite passes alone 693/693.
- Found along the way: 052 and 025 hold thousands of throwaway proof people (3,518 and 1,840 listed). The WP-0 build restores `cert2c` first, which removes them.

**D3 confirmed** (`scripts/cert/cert3/wp0-d3-confirm.js`, read only, 8/8):
- 006 is active on Business with 4 members (the PM is owner and admin), no finance member, no pending invitation, 3 live projects including 006-01, and no residue;
- PostgreSQL agrees Cairo is UTC+3 in July 2026;
- 052, 087 and 018 are active.

**Next exact action:** the WP-0 live runs, one database writer at a time:
1. D-ID-2 and D-ID-3 repro;
2. the permission probe;
3. the post-hoc verifier with the API idle;
4. the C087R proving lifecycle, detached.
Then classify the findings, then build the deep companies (restore `cert2c` first).

## 2026-10-09 (afternoon) — WP-0 live runs: identity leftovers, permission probe, lifecycle checks

The runs below went one database writer at a time, in process unless noted.

- **D3 confirmed:** `wp0-d3-confirm.js`, 8/8 (the entry above).
- **D-ID-2:** `d-id-2-repro.js` CONFIRMED (13/13 defect checks). A former member renamed by their home company appears under the new name and with their e-mail in project history, the API-key owner, tasks and comments, and the team and party lists. Project history breaks its own contract: it should show "Former user" (null) for someone who left. The rest waits for an owner rule on what past records may show.
- **D-ID-3:** `d-id-3-repro.js` CONFIRMED (8/8). Caller-supplied acceptance dates are stored: past, future and numeric values. A re-add overwrites or erases a real acceptance time. Proposed: P2.
- **New register items:**
  - D-ID-7: a party add makes a legacy home member a guest of their own workspace.
  - D-ID-8: suspension leaves party places active, and a direct party add accepts a suspended member.
  - D-ID-9: a member homed elsewhere cannot be assigned a task.
  - D-ID-10: the key list shows the home role and lists a departed owner's key as active.
- **Permission probe:** `permission-probe.js`, 292 transitions × 087's nine personas, plus 052's finance administrator. Every policy decision matched (124/126). The two failures are the registered suspects, now confirmed:
  - WP0-INV-1: stock received for a project the person cannot open (201);
  - WP0-BOQ-1: BOQ template and upload routes narrower than `boq:read`.
  The first two runs found 22 defects in the probe's own requests on 8 entries, all fixed: request bodies, a query placeholder, and one answer that depends on project state (`anyOf`).
- **Lifecycle post-hoc verifier:** `lifecycle-posthoc-verifier.js`, read only. Over the 14 certified projects, 1,694 of 1,694 stored figures match the known answers, 0 contradict, and 7 are not verifiable post hoc. The projects' rows are identical before and after.
- **Proving lifecycle, stamp C087R, detached:** all 18 stages and the snapshot passed, 582/582 checks, on a fresh project in 087. The certified runs had 496 checks; the stage edits add the stage table's known-answer assertions. The certified C087 project was not touched.

**WP-0 status:**
- Done: answer book, harness, permission matrix and probe, weak lifecycle checks, identity leftovers, D3.
- Remaining: the deep-company builders (plan §3.3: drivers in `scripts/cert/cert3/build/`, files generated from the answer book, resumable, every creation asserted), then the build itself. Restore `cert2c` first: the proof residue in 052 and 025 runs to thousands of throwaway people. Then the fingerprint and snapshot `cert3d`.

**Next exact action:** write the deep-company builders (087, 052, 006) from the answer book, review them, restore `cert2c`, build detached with the watchdog, then fingerprint and take `cert3d`.

## 2026-10-09 — WP-0 CLOSED (PASS); fast closure mode; WP-1 started

**Owner directive: CERT-3 fast closure mode.** It is recorded in plan §0.0 and the workflow report.
- Per work package: known answers, one primary run, classification, fixes only for P0, P1, invariant or owner-rule failures, targeted proofs, one final run, close.
- P2 and P3 go to the register with destinations.
- No product-wide discovery.
- Agents prepare the next work package read only.

**WP-0 closure.**
- The permission probe, the lifecycle verifier and C087R had already completed (entry above).
- `snapshot.js` was then run read only on the 14 certified projects: 14 × 52/52.
- Every WP-0 finding is classified: register, "CERT-3 WP-0 closure".

| Item | Result |
|---|---|
| P0 / P1 | 0 / 0 |
| P2 deferred | D-ID-9 → WP-8; WP0-INV-1 → WP-5 |
| P3 deferred | D-ID-2 → CERT-7; D-ID-3, D-ID-7, D-ID-8 → WP-8; D-ID-10 → CERT-7; WP0-BOQ-1 → WP-6 |
| Fixed in WP-0 | D-PAGE-1 (P2; it blocked the unit gate) |

Result rows are in `OCTAPM_WORKFLOW_CERTIFICATION.md` §WP-0.

**Deep-company builder workflow stopped.** It wrote everything for every work package up front, which conflicts with the mode. Only the shared generator draft `scripts/cert/cert3/build/files.js` was written; it is kept for WP-1. From now on, each work package builds its own deep projects in its primary run.

**Next exact action: WP-1 (schedule).**
1. Write the primary proving run `scripts/cert/cert3/wp1-schedule-proof.js` from plan §4 WP-1 and `answers/schedule.js`. It builds 087-SCH and 087-IMP plus the 052 and 006 schedule lanes, and runs T1–T4, conversion and parity, revisions, baseline gates, dates and status.
2. Run it once.
3. Classify.
4. Fix in WP-1, because they violate an approved owner rule or are P1:
   - milestones blocking approval and baseline (HR-S2, decided);
   - activation losing `activityCode` and the budget (proposed P1).
   The HR-S1/S3–S6/S8 rows wait for owner decisions.
5. Targeted proofs, mutations of the WP-1 guards (§6.2), the final run, close.

## 2026-10-09 — Owner: the original CERT-3 plan stays authoritative; the WP-0 closure is withdrawn

**Owner instruction.**
- `OCTAPM_CERT3_PLAN.md` remains the source of truth, and nothing is reduced: permissions, personas, known answers, mutations, Codex, lifecycle, deep-company testing, WP-0..WP-9 and the final exit criteria all stand.
- Only execution gets faster:
  - rerun just invalid cases where that gives valid evidence;
  - never rerun a whole matrix for one fixture;
  - use targeted regression after a fix;
  - run every full run the exit criteria require.
- Classification stays CONFIRMED / PARTIAL / REJECTED / EXPECTED BEHAVIOUR / TEST GAP, with the plan's severity handling.

These rules are recorded in plan §0.0. They replace the "fast closure mode" text recorded earlier the same day.

**Corrections made.**
- **WP-0 is NOT closed.** E1, E7 and E8 are met. E2 is outstanding: the deep population is built (builder exit 0), the 97-company fingerprint is unchanged, and snapshot `cert3d` is taken. The workflow report and register say so, and the register's WP-0 findings table uses the plan's classification.
- **The WP-1 authoring workflow was stopped before it wrote anything.** It built its own projects, while the plan has WP-1 evidence run on the WP-0-built 087-SCH, 087-IMP and 052. It restarts once the builders exist.
- **The deep-company builder workflow resumes.** Then the build runs in plan §3.3 order:
  1. stop the API, restore `cert2c` and re-apply the migrations made since the snapshot;
  2. start the API and run the D-ID-1 proof;
  3. run the builders, detached with the watchdog;
  4. take the fingerprint, then snapshot `cert3d`.
- **Known dependency:** the 087-SCH build passes through WP-1 transitions. A builder step blocked by a confirmed P1 is fixed when it is reached, as the plan's severity handling says, for example a milestone blocking approval (HR-S2 is decided). Steps that depend on an undecided rule are marked BLOCKED with their HR id.

**Next exact action:** finish the builders, then follow the §3.3 build order to close WP-0, then WP-1.

## 2026-10-09 — WP-1 blocker fixes WP1-MS-1 (HR-S2) and WP1-ACT-1 land

**Why now.** The 087-SCH, 052 and 006 builders pass through WP-1 transitions. At HEAD `c5c79aa`, two confirmed defects stopped them:
- the F1 approval answered 400 `SCHEDULE_NOT_READY` on the 0 h milestone M900;
- activation left `activityCode` null on every mapped activity.

The plan's severity handling fixes a blocking confirmed P1, and an approved owner rule, when the build reaches it. Register: WP1-MS-1, WP1-ACT-1.

**Method (plan §6).**
1. Fix plan, reviewed by Codex and adjudicated (activation: identifiers before resemblance; a mapped activity keeps its budget, and keeps its code, category and milestone flag unless the revision states them).
2. Implementation, live repros confirm-first: both fail at HEAD's behaviour and pass on the fix.
3. Codex diff round 1. R-H1, R-M1, G1 and G2 CONFIRMED:
   - a generated row's P6 id could steal another activity's direct code match;
   - a crossed file mapping could export two activities under one ID;
   - two rules had no test.
4. Round 2 fixed them. Mapping now runs in four tiers, each across all activities. The file-code alias is built only from rows that state no code. A mapped activity keeps no code that another row of the revision carries; this was widened to cover the doubly crossed case.
5. Codex diff round 2: all four CORRECT. One LOW, CONFIRMED and recorded as WP1-ACT-2 (P3, CERT-7). One test gap, closed by a test and mutation M14. No round 3 (plan §0.0 rule 7).

**Evidence.**
- 21 unit suites that load schedule.service or activity.service: 1165/1165.
- `wp1-milestone-repro.js` 11/11; `wp1-activation-code-repro.js` 12/12.
- 22/22 mutations caught, each by its named check. Mutant syntax: 263/263 parse. Every anchor occurs once.
- Review and adjudication notes: `C:\Temp\octapm-cert\scratch\wp1-fix-*`.

**WP-0 state is unchanged.** E1, E7 and E8 are met. E2 (the deep population) comes next: settle the builder workflow, then the §3.3 build order on this commit.

## 2026-10-09 — WP-0 deep builders: first build, three reviews, adjudication

**The builder workflow** wrote 15 builders in `scripts/cert/cert3/build/` (untracked until the build is final), with:
- a shared `lib.js`, which guarantees resumable runs with no duplicates and asserts every creation;
- generated schedule and BOQ files.

Every builder was debug-run against the dirty certification DB, one writer at a time. With the WP-1 fixes, the builders built every step except BLOCKED steps of these kinds:
- undecided owner rules: HR-C8 (PO closes), HR-C11 (weather half-days), RFI-DRAFT;
- the decided HR-C1, whose fix is in WP-4;
- confirmed L34, whose fix is in WP-3;
- three items that were plan sequencing, not defects, now decided in the adjudication.

**Three adversarial reviews** raised 60 problems. All were adjudicated by the integration owner (`C:\Temp\octapm-cert\scratch\wp0\builders-adjudication.md`). The main decisions:
- **Moment-bound evidence (G1).** A build that passes through a state a work-package check needs asserts that check at that moment. Checks the built end state makes impossible run in the WP proof on fresh records (plan §7 step 4). Every case is mapped in `build/MOMENT-MAP.md`.
  - Example: 087-SCH keeps A310's quantity entries, which §3.2 requires. So EV(A310) 67,500 / 81,000 / 85,500 and the bare-percent refusal are asserted in the build, while WP-2's EV-0 set-up checks use fresh records.
  - Likewise, WP-1 T2 is asserted before the baseline and the tail.
- **No silent workarounds.** A departure is a BLOCKED step with a register or HR ref and the observed answer, or a persisted `b.finding`. Code comments never carry findings. "PLAN-*" and "ADJ-*" refs are not allowed.
- **Fixed on paper (A10), with derivations:**
  - F3 is generated as P6 exports it (the capped late pass). The builder had rewritten the file to get it approved.
  - The reporting `timeZoneSource` is 'project', with the zone asserted equal to the company's.
  - 087-HLT's EV "at the cutoff" (an internal plan contradiction with §3.3).
  - 087-HLT's document-control figure follows the literal §3.2 contents.
  - IPC-04's net when it is certified last.
- **Plan items served elsewhere, not dropped:**
  - Change events raised from an exception: by the WP-9 handling proof, since the build cannot evaluate the engine without consuming WP-9 T2's first evaluation.
  - The 0.5 overtime multiplier: by the contract refusal (adjudication F1).
  - 087-OTH's finance officer: invited by D-ID-1, since 087 has no finance staff and assumption A1 does not hold.
- **API only, by identity, resumable:**
  - SQL reads removed;
  - records selected by identity, never by position;
  - every interruptible create or act gets a live find or verify;
  - the product's CPM is no longer the oracle for 087-EXC dates;
  - tokens are redacted from build logs.
- **Seven product suspects registered** for their work packages' confirm-first lists: WP1-RB-1, WP3-TZ-1, WP4-OVR-1, WP4-DRAFTS-1, WP5-SVC-1, WP5-AWD-1, WP8-TRN-1.

**E2 at this point.** BLOCKED steps remain, each observing its exact known answer:
- undecided owner rules (HR-C8, HR-C11, RFI-DRAFT), which plan §0 item 3 has waiting for the confirm-first sweep that itself runs on `cert3d`;
- fixes scheduled in their work packages (HR-C1 in WP-4, L34 in WP-3).

E2's "builder exit 0" cannot be met until those land. **WP-0 stays formally open on that one item.** The confirm-first sweep and WP-1 then run on `cert3d`, as §7 sequences them.

**Next exact action:**
1. The fix workflow (`wf_b689052f-5e1`) applies the adjudication; two adversarial verifiers check it.
2. Adjudicate their verdicts.
3. Run the §3.3 build order on `f599e67` plus the builders: stop the API; restore `cert2c`; migrate deploy; start the API; D-ID-1 proofs; fingerprint before; run-all detached with the watchdog; fingerprint after and compare; snapshot `cert3d`.
4. Commit the builders.

## 2026-10-09 (late) — Builder adjudication closed after three bounded fix rounds; the build order is ready

**Rounds 2 and 3** (adjudication `C:\Temp\octapm-cert\scratch\wp0\builders-adjudication.md`, results `fix2-result.json`, `fix3-result.json`). Each round applied the integration owner's decisions, reran only the touched builders fresh and uninterrupted on the final bytes, and ended with an adversarial read-only verifier:
- Round 2 (6 agents): every item verified. It aligned 087-HLT with 052-FLD (health departures BLOCKED under HR-K1 and HR-K2), moved every builder-computed figure into the answer book with a derivation (export sheet gate, IPC-09/10, 087-COM-C, 087-EV run-date reads, the weather invariance), fixed the fabricated adoption in 052-FLD and the missing finds in 006-LITE, made 087-FLD's template edit resumable, replaced the IPC-09 certify probe with a read, and added uniqueness to every identity find.
- Round 3 (3 agents, resumed after the 16:59 CDT cluster crash, which this session restarted): the last seven A10/G4 leftovers; all verified. One cross-check accepted (087-COM read a pre-final answer book that it does not use); the final build covers it.

**Allowed BLOCKED refs at E2** (each keyed to the answer book's recorded known answer; lib refuses any other): HR-C1, HR-C8, HR-C11, RFI-DRAFT, L34, L112, HR-S9, HR-K1, HR-K2, HR-K7. Every other step must build.

**Artefacts.** `build/MOMENT-MAP.md` (225 entries after round 3); `answers/CHANGES-WP0-BUILDERS.md` (rounds 1-3 merged); the three answer books now carry 633 / 853 / 618 derived figures.

**Incident.** At 16:59 CDT a client backend of the certification cluster was terminated by exception 0x40010004 (as on 2026-10-06) and the cluster, the cert API and the web app went down with the session. Restarted 21:09 CDT; recovery from the 16:38 checkpoint; `octapm_cert` and the `cert2c` snapshot intact. No builder was mid-run.

**Next exact action:** run `C:\Temp\octapm-cert\build-cert3d.ps1` detached (plan §3.3: stop the API, scrub api logs, restore cert2c, migrate deploy, start the API, the six D-ID-1 proofs, fingerprint before, run-all --fresh under the watchdog, stop the API, scrub, fingerprint after, fingerprint97 compare, snapshot cert3d, start the API). Then commit the builders, the answer books and the moment map. The owner is viewing the software on the pre-restore database first; the build starts when that viewing is done.

## 2026-10-09/10 — §3.3 build order, run 1: stopped at 087-EXC on a weekend run date (no product defect)

**Launched** 22:58 CDT 2026-10-09 (`C:\Temp\octapm-cert\build-cert3d.ps1`, detached), on the owner's instruction not to wait for the manual dashboard viewing.

| Step | Result |
|---|---|
| scrub api logs (pre) | exit 0 |
| restore `cert2c` | exit 0 (0.8 min) |
| migrate deploy | exit 0: `20261006010000_identity_security` applied (cert2c predates it) |
| D-ID-1 proofs | all exit 0: user-add 48/48, guards 68/68, sessions 67/67, SSO 36/36, owner-recovery 74/74, keys 23/23 (316 checks) |
| fingerprint before (`cert3-pre`) | exit 0 |
| run-all --fresh | **exit 1 after 4.5 min**: 087-SCH, 087-IMP, 087-COM-B, 087-COM-C BUILT; 087-EV (L34 ×7, L112, HR-S9), 087-COM (HR-C1, HR-C8 ×2), 087-FLD (HR-C11 ×3, RFI-DRAFT) INCOMPLETE with allowed refs only; **087-EXC FAILED at its first assertion**; nothing after it ran. 0 5xx, 0 failed steps in the builders that ran. |
| fingerprint after, compare, snapshot | not reached; **no `cert3d`** |

**Cause.** The run reached 087-EXC at 04:26 UTC on Saturday 2026-10-10, so 087's run date (the earlier of the UTC and Cairo dates) was a Saturday. 087-EXC places WP-9 T3's slip of 7 on the answer book's five-day calendar and, by the round-2 adjudication (R2-F), fails closed on a Saturday or Sunday run date rather than borrow the product's own weekend snapping. Working as designed; not a product defect, not a data problem.

**Decision.** Re-run the whole build order fresh (it restores `cert2c` again) when 087's run date is a weekday: the earliest instant is Monday 2026-10-12 00:00 UTC (Sunday 19:00 CDT). Resuming this partial build instead would mix run dates across builders, whose resume checks depend on the run date. A paper rule for weekend run dates would be a builder change needing review; the owner ruled out another builder-review round. Only 087-EXC (through `kit-controls.js`) depends on a weekday; 087-HLT's run-date window (10-06..10-25 for this population) and every other builder are weekday-free.

**Meanwhile.** The builders, answer books and moment map are committed (this commit). The WP-1 proving run, mutation lists and run plan are being authored write-only and will be debug-run against the partial database; it is discarded by the next `cert2c` restore.

**Next exact action:** at or after Sunday 2026-10-11 19:10 CDT, launch `build-cert3d.ps1` detached again; report the eight items the owner asked for; then the confirm-first sweep and WP-1 on `cert3d`.

## 2026-10-10 — Parallel execution mode; WP-1 proof ready for `cert3d`

**Owner instruction (CERT-3 PARALLEL EXECUTION MODE).** The plan stays authoritative and coverage is not reduced. Claude Main is the only writer: product code, the certification database, migrations, commits and pushes, and mutation runs. Other agents prepare read-only and write only to scratch. While WP-N executes, WP-(N+1) is prepared. Long runs go detached. Reruns are targeted; full runs only at the plan's checkpoints. Codex only for the plan's required reviews. Once `cert3d` exists it is the baseline, restored rather than rebuilt. Manual UX never holds certification.

**Applied at once.** A WP-1 fix workflow whose agents were editing the worktree and debug-running against the database was stopped when the instruction arrived. Its finished work (answer-book leaves BOOK-1..7; the proof fixes H1-H4, M2-M6, L1-L10, R-SET) and the stopped agent's nearly finished list reconciliation were taken over by Claude Main and verified by a read-only verifier: every adjudicated item VERIFIED except the run plan, which a read-only agent redrafted.

**Integration owner's decisions on the verifier's questions** (applied by Claude Main):
- Three dedicated answer-book leaves for the site engineer's refusals (activate, rollback, baseline: 403 FORBIDDEN, PM-only transitions). The HR-S3 approval's `today` corrected to critical_path only (date_sanity passes since the HR-S2 fix). A `today` leaf for the rollback A140 id (ref WP1-RB-1).
- Confirm-first checks carry `defect` only for a decided rule or a landed fix (CF.1, CF.4), so the harness's classification line is now correct. A known answer at `today` fails once its rule is decided.
- Plan :506 "CPM runs inside the activation transaction" is recorded as a TEST GAP (the live check proves the figures are stored when the activation answers; mutations C4/C5 survive live; the mocked unit catchers are not evidence under plan §1.4). The check's description says so.
- The mutation runner keeps every FAIL line (C1's catchers fell past its cap of 12). The mutation evidence checker is committed as `wp1-mutation-evidence.js`. The WP-1 mutation lists run on `cert3d` only.
- The `cert3d` primary run doubles as WP-1's part of the confirm-first sweep. The 22 landed-fix mutations are not rerun while their files are unchanged.
- WP1-CONC-1 registered (concurrent activations not serialised, P3 proposed). Two product-vs-book items recorded: PB-1 (the HR-S3 book text, corrected) and PB-2 (two audit entries per baseline lock in the merged timeline: EXPECTED BEHAVIOUR).

**Evidence (debug only; the partial database is discarded by the next `cert2c` restore).** Debug run 5 on the partial population (`--skip=LANES`, by Claude Main): exit 0, 145/145; 123 plain passes; 21 known answers at `today` (BLOCKED with their refs), 1 at value, 0 wrong; confirm-first CF.1 and CF.4 REJECTED (fixes hold), CF.2, 3, 5-10 CONFIRMED under undecided rules; throwaway projects archived.

**WP-2 prepared read-only** (`C:\Temp\octapm-cert\scratch\wp2\WP2-PREP.md`): test map, routes, existing tests, register rows, fixtures (one throwaway 087 project P), a 164-check proof structure, mutation candidates for every §6.2 WP-2 guard, persona cases, and 23 proposed answer-book leaves. Its open questions are adjudicated before WP-2 authoring.

**Next exact action:** the §3.3 build order run 2 at 2026-10-11 19:12 CDT (scheduled). Then the eight-item report, the WP-1 primary run on `cert3d`, and WP-1 per `WP1-RUN-PLAN.md`.

## 2026-10-10 — Owner decision: HR-X1 scope

**HR-X1: one batch at WP-2, accept both formats.** The canonical evidence reference lands as one coordinated batch at WP-2, covering every evidence surface plan §5's HR-X1 row names (progress, NCR, safety, change orders: L129, L149). During the transition the backend accepts both formats: the current references (file name, URL, text note) and the canonical stored project document, so mobile clients keep working while they move. Recorded in plan §0.1 and in the WP-2 adjudication (Q3).

**Consequence for the sequence.** WP-2 carries three decided-rule fixes: HR-Q1, HR-P1 and HR-X1. Each gets a fix plan, a Codex high-risk plan review and adjudication before any code, then the fix, targeted proofs, mutations and a Codex diff review (plan §6.4). The HR-X1 batch fix plan is drafted read-only alongside the HR-Q1/HR-P1 one.

## 2026-10-10 — WP-2 fix plans: Codex plan review round 1; XDOC-1 confirmed (P1, write only)

**Codex high-risk plan review, round 1** of the HR-Q1/HR-P1 and HR-X1 fix plans (`scratch\wp2\codex-plan-review.md`, 138k tokens): no CRITICAL; six HIGH, all CONFIRMED (adjudication `scratch\wp2\codex-plan-review-adjudication.md`):
- HR-Q1/HR-P1: the "official" row differs between the EV report and the activity payload (the writer never stamps `updatedAt`); Close can act on an inspection the closer cannot see; Close can release a hold on a stale state.
- HR-X1: references resolving to another company's or project's document could count or be stored as "legacy"; change-order sync revives rejected documents; the NCR/safety closeout check runs outside its transaction.
Both plans were revised read-only (r2). Round 2 runs in the next Codex window (08:41 CDT); the plan allows three rounds.

**XDOC-1 (raised by the review), CONFIRMED P1, write only.** A read-only trace of 19 read paths found every one org- and project-scoped: a stored foreign reference cannot expose another company's file. Legacy data: 0 cross-project rows among 2,925 commercial and 9,009 workflow attachment references. The live reproduction (`scripts/cert/cert3/xdoc-1-repro.js`, by Claude Main on the partial population) confirmed the write gap: change orders and EOT claims store another company's document id as a storage key or in a URL (through either company's route); NCR and safety store such URLs and keys embedding the id. Exit 2, 24/34: the 10 write checks fail; every read check, control and CERT-2 regression passes; no 5xx. On CERT-2's scale a stored reference to another company's record is a P1 cross-company write. It is fixed by the HR-X1 batch in WP-2 (its scope rule refuses exactly these references); the repro's write checks are the batch's live catcher. Whether a key that embeds a foreign id (`<id>.pdf`) is a reference or legacy goes to Codex round 2.

## 2026-10-10 — WP-3 and WP-4 prepared ahead of their runs; WP4-AGG-1 raised

Prepared read-only by agents, then installed, checked and run by Claude Main, the only writer (parallel execution mode).

**WP-3 (earned value).** The proving run and its 65 new book leaves landed in `48db9e9`; its debug run on the partial population exits 2 on the L34 checks only. Now added:
- four mutation lists (`wp3-mutations.ev.json`, `wp3-mutations.unit.json`, `wp3-fix-mutations.l34.json`, `wp3-fix-mutations.unit.json`), the run plan `WP3-RUN-PLAN.md` and the evidence checker `wp3-mutation-evidence.js`;
- the lists are registered in the mutation runner. The anchor scan finds every anchor once, and every mutant parses, on HEAD, on the simulated L34 fix and with the WP-2 batch's change simulated.

Every WP-3 list waits for the L34 fix. At HEAD the unmutated proof already exits 2, so a mutant run would prove nothing. The L34 plan's Codex review runs at 13:53 CDT today.

**WP-4 (commercial).** The answer book gains 65 leaves and changes 59 (633 to 698 figures).
- The patch was applied on a copy, its output hash equals the reviewed draft, and the verifier passes.
- No changed leaf is read by a builder, and the WP-0 recomputation agrees on all 116 figures.
- All 45 load-check mutants are refused.

The proving run `wp4-commercial-proof.js` has 150 checks plus G.5xx. Every writing check and every §6.2 catcher runs on the throwaway project K, and I2 runs on a second throwaway K2. The moment map records the deviations.

**WP-4 debug runs** on the partial population, with D2, D3 and CF skipped because 052-COM and 006-LITE are not built:

| Run | Result | Reds |
|---|---|---|
| 1 | 100 of 109, exit 2 | the 8 decided HR-C1 checks, plus KA.E2.pendingDelta read "wrong" |
| 2 | 101 of 109, exit 2 | the 8 decided HR-C1 checks only; 17 known answers BLOCKED, none wrong; no 5xx |

Run 1 used 087-COM-C's one-shot I5 confirmation. Run 2 took the re-run branch and passed it.

**WP4-AGG-1 (suspect, P2 proposed).** On both runs, five concurrent converts of one change event all succeeded. That reproduces the non-atomic convert, CONVERT-ATOMIC. They made five 9,500.00 draft change orders. The contract's stored pending total rose by only 38,000.00 instead of 47,500.00, and the next status change healed it.
- **Cause.** `recomputeChangeValues` sums the register and writes the totals without a lock, so concurrent recomputes can store a sum that misses a sibling's row.
- **Exposure.** The same code writes the approved total and the revised value, so concurrent approvals share the exposure. That case is not yet reproduced.
- **Book and proof.** The book's known answer now states this lag. The proof judges the register's delta and records the stored lag.
- **Next.** It is classified at the WP-4 run on `cert3d`.

## 2026-10-10 — WP-4 lists, the L34 repro and WP-5 installed; WP-2 plan review round 2

**Installed by Claude Main** (`61c2f7d` and the commit of this entry):
- **WP-4 mutation lists.** They are judged by named-catcher flips against a baseline, so the five §6.2 HEAD guards can run right after the primary run, before the HR-C1 fix.
- **WP-3 L34 live repro.** At HEAD it gave exit 2 with exactly R1, R2, R4, R5 and R7 failing, and every control passing. The draft's R8 was dropped because it wrote through a SQL fixture: proofs write through product routes only.
- **WP-5.** The answer book (BOOK-G3 and 23 gaps), the supply-chain proof (142 checks on the throwaway J) and the integration owner's rulings:
  - O7's ignored fields become a known answer under HR-C7;
  - KA.N6.usage50's value takes the create status 201;
  - KA.D5 is decided only when both the HR-C5 fix and the WP5-SVC-1 fix land;
  - the 087-COM order statuses are judged on the build's end state.

The WP-5 debug runs on the partial population, with 052-COM's section skipped:

| Run | Passed | Known answers BLOCKED | Confirm-first |
|---|---|---|---|
| 1 | 139 of 139 | 27 | 15 CONFIRMED, HR-C9 PARTIAL (state-dependent) |
| 2, after the rulings | 138 of 138 | 28 | 15 CONFIRMED, HR-C9 PARTIAL (state-dependent) |

Neither run had a 5xx. Rulings are in `scratch\wp4\PREP4-ADJUDICATION.md` and `scratch\wp5\PREP5-ADJUDICATION.md`.

**Codex plan review round 2** of the WP-2 fix plans (181k tokens) found no CRITICAL and five HIGH:
- **QP.** PATCH and DELETE can remove a released hold. Several "official progress" readers still select a different row than the plan's definition.
- **X.** Storage keys embedding a foreign id are still treated as legacy. EOT, weather and sub-valuation skip the reference check. Daily-report submit skips the gate when linked progress exists.

Under r2, five of XDOC-1's ten writes would still be stored. Two read-only verifiers tried to refute each finding against the code. Every finding stands (two PARTIAL), with the severities adjusted. The integration owner's binding dispositions are in `scratch\wp2\codex-plan-review-r2-adjudication.md`:
- **QP.** Every official-progress reader adopts one ordering; the method reader stays unchanged, being HR-P2-adjacent. The lifecycle re-checks move onto the locked row for PATCH, DELETE, start, sign and Close. Race tests queue behind a blocker connection; there is no test hook in product code.
- **X.** An embedded foreign id in a key or a product link is refused as a scope-only name; bare text stays legacy. The commercial reference check becomes unconditional on all seven callers. Daily-report submit reads the stored evidence. `xdoc-1-repro.js` becomes a mandatory proof that must exit 0 after the fix.

**New suspects:**
- **XDOC-1b (P1 if confirmed).** XDOC-1's write class on the 18 `syncWorkflowReferences` call sites outside HR-X1. A live repro is being drafted. If it confirms, the batch's judge moves into the shared helper.
- **WP3-ALLOC-1 (P2).** The allocation summary does not filter progress by the cutoff. It goes to WP-3's confirm-first and the L34 plan review.

Codex round 3 is the last of the three allowed plan-review rounds. It runs in the next window (session cron 18:57 CDT) on r3, which is being written read-only.

## 2026-10-10 — XDOC-1b and XDOC-1c confirmed; WP-2 r3 plans; WP-6 prepared and debug-run

**XDOC-1b (P1, cross-company write, reads closed).** XDOC-1's class on the 18 other `syncWorkflowReferences` call sites (RFI, submittal, drawing, transmittal, correspondence, defect, ITP, material test and punch).
- **Repro.** `xdoc-1b-repro.js`, companies 087/088, product routes only.
- **Result.** Exit 2; exactly the 54 write checks fail: foreign URLs through either route and keys embedding the foreign id, on create and update. All read checks and controls pass.
- **First run.** It was a setup error: an RFI was sent with status `draft`, while the service defaults a new RFI to `open`.

**XDOC-1c (P1, the revisions door) and XDOC-UPB (P1 on workflow and commercial references).**
- **Repro.** `xdoc-1c-repro.js`. Exit 2; exactly 72 write checks fail:
  - 40 revision-door writes;
  - 12 drawing and transmittal file-field writes;
  - 20 uploader writes, which store another company's user id as `uploadedBy`.
- **Photos.** Daily-report and site-diary photos already take the uploader from the document, so XDOC-UPB is narrowed.
- **Residue.** 63 revision rows naming the foreign file stay in the archived throwaway project, because no product route deletes a revision. The partial database is restored from cert2c on 2026-10-11.
- **Lead XDOC-L1.** Revisions take `issuedBy` from the request; `ContractProfile.documentIds` is stored as sent.

**WP-2 fix plans r3.** Written read-only under the binding round-2 adjudication.
- **QP r3.** Every official-progress reader adopts one ordering. Locked re-checks are added for PATCH, DELETE, start, sign and Close. Race tests queue behind a blocker connection.
- **X r3b.** The judge moves into the shared workflow helper (XDOC-1b). §12b covers the revisions door and §14 a server-stamped uploader. An embedded foreign id is a scope-only name. The commercial check becomes unconditional.
- **Rulings** on the authors' questions are in `scratch\wp2\r3-rulings.md`. Codex round 3, the last plan-review round, runs at 18:57 CDT.

**WP-6 (BOQ, allocations, budgets, cost codes).** Prepared, adjudicated (`scratch\wp6\WP6-ADJUDICATION.md`), book patch installed (`a80ccef`, 726 to 778 figures), and the proof `wp6-boq-proof.js` installed.
- **Scope.** Throwaways B6 and B6X in 087; 83 checks plus G.5xx. Company 087 only.
- **AI jobs.** They run in process through a recorder stub. Outbound requests are refused inside the stub window, and no queued job is left behind (the product's cancel route).
- **TEST GAP L121.** The quota refusal on a non-AI import is not run live. Driving company 011's AI counter to its limit would change one of the 97 fingerprinted companies on every run.

| WP-6 debug run | Result |
|---|---|
| 1 | 78 of 78 recorded checks pass; 10 known answers BLOCKED; confirm-first: 7 CONFIRMED, CF.HRC14 PARTIAL; no 5xx. The five chunker checks stopped as a setup error. |
| 2 (`--only=PURE`) | The chunker passes through AI schedule generation: [60,60,10], [50,50,30], [60,55], [60], [60,1], which is CLAUDE.md's "max 60 per batch, by section". |

The setup error in run 1 came from finding **SCHED-RET-1 (P3)**. The job result always reports `revisionId: null`, because `stagedRevisionId` is re-declared inside a block (`schedule.service.js:2580`). The staged revision is created, and nothing reads the returned id. The proof now judges completion on the staged revision itself.

## 2026-10-10 — WP-7 prepared, installed and debug-run; PROMO-TX reproduced

**WP-7 (contract time: EOT and the weather 70% rule).** Prepared read-only and adjudicated (`scratch\wp7\WP7-ADJUDICATION.md`).
- **Books.** Commercial 778 to 814 figures, plus two field-controls leaves taking ref HR-C11. Every WP-7 leaf with a today now names its rule. Verified on copies: no builder read changed; the WP-0 recomputations agree; the WP-4 to WP-7 load-check mutants are refused.
- **Proof.** `wp7-eot-proof.js`: 55 checks plus G.5xx, on throwaways T7 and T7H in 087, with a read-only 052-FLD live read. PROMO-TX is probed through the WP-2 blocker-queue mechanism: a second connection holds FOR UPDATE and writes nothing; each waiter is confirmed through `pg_blocking_pids`; N=3 rounds.

**Debug runs** on the partial population (`--skip=F52,CF`):

| Run | Result |
|---|---|
| 1 | Setup error. The proof created activities without the required `engineerIds`; it now assigns T7's site engineer. |
| 2 | 50 of 50 pass; 11 known answers BLOCKED (HR-C10, HR-C11, PROMO-TX, HR-F4); no 5xx. |

**PROMO-TX reproduced, 3 of 3 rounds each.**
- **Race.** Two promotions of one daily-log delay entry both answer 200 and leave two contractual weather rows, one orphaned.
- **Failure.** A promotion racing the entry's DELETE answers 404, yet commits an orphaned contractual row.
- **Plan.** Weather promotion in one transaction is on the plan's defect-fix list. P1 is proposed; the primary run on cert3d classifies it, and the fix lands in WP-7.
- **Residue.** Six orphaned rows sit on archived T7, listed by the cleanup.

**Leads registered:** EOT-CONC-1 (P2), WX-DEL-1 (P2), DST-1, EOT-REC-2 and EOT-APPLY-1 (P3).

**Codex scheduling.** Session crons do not fire while background work runs, so the 08:41 and 13:53 Codex crons were skipped.
- WP-2 plan review round 3, the last round, was started by hand at 15:12 CDT. WP-2 comes first in the sequence.
- The L34 plan review moves to the next window (session cron 20:23), and the HR-C1 plan review to the window after.

## 2026-10-10 — WP-2 plan review round 3 (the last); final plans r3c

**Codex round 3** (256k tokens, started by hand at 15:12 CDT because session crons do not fire while background work runs) found no CRITICAL.
- **QP (HR-Q1, HR-P1).** Implementable after adjudication; no HIGH. Its mutation evidence must separate staging validity from behavioural failures. The locked re-check of HEAD's existing `FORM_DEFICIENCY_EXISTS` is added.
- **X (HR-X1 batch).** One HIGH, X-R3-H1, confirmed against the code by Claude Main. The normalisers turn an array-valued `fileUrl` into its string (`String(["…"])`), and the routes validate only the outer list. A foreign URL sent as `["…"]` would therefore escape a judge that reads string fields only.
- **Closure.** Codex gave the smallest closure and said a fourth round is unnecessary: the judge reads the union of raw aliases and normalised rows on every judged path. Array-valued catchers and a mutation are added. Medium findings are adopted: the cap over selected ids, the waiter correlation, and the C-WF seed project.

**Decision.** The plan allows at most three plan-review rounds. The closures go into the final plans r3c, and the Codex stable diff review of the implementation verifies them (plan §6.4). The owner is told that one HIGH remained at round 3 and how it was closed. Adjudication: `scratch\wp2\codex-plan-review-r3-adjudication.md`.

**New suspects and leads:**
- **XDOC-ISS (P1 suspect).** Revision `issuedBy` stores a request value unchecked.
- **XDOC-CP (P1 suspect).** Contract-profile `documentIds` are stored unscoped.

  Both are reproduced live by `xdoc-1d-repro.js`, drafted read-only, before the batch is implemented. If confirmed, they join the batch.
- **FCST-WIN-1 (P3).** The forecast window limitation.
- **L-DETAILS.** Production strips `error.details`; it goes to the WP-8 client sweep.

**Codex windows.** L34 plan review next, at the 20:23 CDT session cron, or by hand if the cron is skipped. Then the HR-C1 plan review.

**XDOC-ISS and XDOC-CP confirmed (16:21 CDT).** `xdoc-1d-repro.js` (087/088, product routes only) exited 2 with exactly the 23 predicted defect checks failing. All 21 revision `issuedBy` writes store another company's user (five records, create and update, entry and record, plus document control), and both contract-profile `documentIds` writes store another company's document. The own, label and random controls, every read check and G.5xx pass. Both are P1 cross-company writes with no exposure. They join the HR-X1 batch through the final plan r3c §15 and §16. The plans are final after review round 3: `scratch\wp2\fixplan\r3c\WP2-FIX-PLAN.r3c.md` and `scratch\wp2\fixplan-hrx1\r3c\HRX1-FIX-PLAN.r3c.md`, with rulings in `scratch\wp2\r3c-rulings.md`.

## 2026-10-10 (evening) — Owner: execution reset, phase 1; Codex loop closed

Recorded in plan §0.1.
- **Codex loop closed.** The scheduled L34 Codex plan review was cancelled, along with its wake timer, and the HR-C1 Codex plan review will not be run. Claude reviews both plans and every implementation diff. Round 3 of the WP-2 plan review was the last Codex run. It was read once, adjudicated and committed (`14a3db2`, `a93d028`).
- **Execution rules.** Fix now only P0/P1, corruption, security, financial, blockers, and failed invariants the current work needs; record P2/P3 and move on. Testing is targeted; full runs happen only at the plan's checkpoints or final close. No new frameworks or sweeps.
- **Current item:** the §3.3 deep build and `cert3d`.
  - It cannot run before 087's run date is a weekday. 087-EXC fails closed on a Saturday or Sunday run date (run 1's documented stop). The first weekday run date is Monday 00:00 UTC, which is Sunday 19:00 CDT.
  - The prepared order (`build-cert3d.ps1`) starts at the session cron, Sunday 2026-10-11 19:12 CDT. If background work causes the cron to be skipped, it is started by hand.
  - Then comes the checkpoint report.
- **Installed tonight with no new review:** the WP-5, WP-6 and WP-7 mutation lists, evidence checkers and run plans, registered in the runner. Every list is runnable.
- **Kept as prepared, without further prep rounds:** the WP-8 book and proof drafting already in progress, which is installed and debug-run when it returns, and the WP-9 preparation (`scratch\wp9\WP9-PREP.md`), which is adjudicated when WP-9 is reached.

## 2026-10-10 (night) — WP-8 installed and debug-run; section 3.3 run date verified

- **WP-8 book.** `field-controls.js` goes from 279 to 333 figures. Every WP-8 leaf with a today names its rule, and the 73 load-check mutants are refused. The plan citations hold: the owner's execution reset was moved to the plan's Appendix A, and the reference plan was checked to be an exact line-for-line prefix of the current plan.
- **WP-8 proof.** `wp8-field-proof.js` has 112 checks plus G.5xx, on the throwaways F8 and F8V in 087.
- **Debug run.** With `--skip=F52,CF`, 91 of 91 recorded checks passed. One probe stopped as a setup error, which was a TEST defect: the submittal GET serves its steps as `reviewSteps` (`submittal-workflow.service.js:660`, `:668`), and the proof read `steps`. After the fix, the targeted rerun `--only=SUB` passed 14 of 14. 26 known answers are BLOCKED and there was no 5xx.
- **Register.** RFI-RESP-1 (provisional P1) and SAFE-ARCH-1 (P2) are on the fix list and settled at the primary run. Leads DL-REPLAY-1, SUB-LINK-1 and MTG-SENT-1 are recorded.
- **Section 3.3 run date verified for the owner.** The run date is the earlier of the UTC date and the company-zone date (`build/lib.js:879`). For 087, in Africa/Cairo, that is the UTC date. At Sunday 2026-10-11 19:12 CDT it is Monday 2026-10-12 00:12 UTC, a weekday, so 087-EXC's guard (`087-exc.js:71-72`) passes. It stays Monday until 19:00 CDT Monday. The build order keeps its Sunday 19:12 CDT start.