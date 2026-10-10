# CERT-3 WP-6 run plan (BOQ, allocations, budgets and cost codes)

Plan `docs/certification/OCTAPM_CERT3_PLAN.md` section 7 step 4, for WP-6 (section 4 :795-836; section 6.2 WP-6 guards :1150; section 5 HR-C14 :1082, HR-C15 :1083, HR-C17 :1085, HR-C18 :1086; the defect-fix list :1107-1121, "budget-revision running totals" :1113), on snapshot `cert3d`.

**Drafted read-only 2026-10-10** (preparation agent; to be adopted, edited and committed by Claude Main) against:
- the installed proof `scripts/cert/cert3/wp6-boq-proof.js` (committed in `bde300d`; HEAD `2a2efd2`): 83 fixed checks (`EXPECTED_CHECKS`, asserted at load) plus the harness's `G.5xx`; its CHECKS table (:206-296) with id, plan line, answer-book key, where each check runs and its section; `FIXES` (all eight empty); `DECIDED_RED` (:520-548, empty at HEAD); `CATCHERS` (:604-610); `COLLATERAL` (:613-626); `FIX_CATCHERS` (:633-636); `TEST_GAPS` (L121); `meta.equivalentMutants` (M-DRYq);
- the four drafted mutation lists in `C:\Temp\octapm-cert\scratch\wp6\lists\` (section 7.1): `wp6-mutations.boq.json` (12 mutations, 1 equivalent, 1 not mutable), `wp6-mutations.unit.json` (5), `wp6-fix-mutations.boq.json` (0 runnable, 6 pending, 1 not run), `wp6-fix-mutations.unit.json` (0 runnable, 6 pending); every `from` counted, every mutant parsed, every id checked by `mutsyntax-wp6.js` (report `mutsyntax-wp6-report.json`, 0 problems; its teeth `teeth-mutsyntax-wp6.js` 23/23; the runner's view `check-runner-shape-wp6.js` ok);
- the drafted evidence checker `wp6-mutation-evidence.js` (section 7.3; its self-test `selftest-evidence-wp6.js` 51/51 on synthetic results built from the debug result and the proof's in-memory model);
- the answer book `answers/commercial.js` after the WP-6 book patch (`a80ccef`, 778 figures; `WP6.mutations.*` name every catcher by check id, G21);
- the binding adjudication `C:\Temp\octapm-cert\scratch\wp6\WP6-ADJUDICATION.md` (Q1-Q14 and the rulings on the drafters' questions; cited WP6ADJ), including the L121 ruling (TEST GAP, company 087 only);
- the integration-owner rulings on the WP-4 lists, `C:\Temp\octapm-cert\scratch\wp5\PREP5-ADJUDICATION.md` "WP-4 mutation lists" L1-L6 (the baseline design, evidence on the final code, TEST GAPs), followed here exactly;
- the model of the WP-4 set: `wp4-mutations.*.json`, `wp4-fix-mutations.*.json`, `wp4-mutation-evidence.js`, `WP4-RUN-PLAN.md`.

**State at drafting.** HEAD `2a2efd2` on `cert/full-saas-certification`; `backend/src` is identical to `6c5ab54` (`git log 6c5ab54..HEAD -- backend/src` is empty), where WP6-PREP counted the anchors. The proof was debug-run twice by Claude Main on the partial population (journal 2026-10-10): run 1 recorded 78 of 78 green, 10 known answers BLOCKED, confirm-first 7 CONFIRMED and CF.HRC14 PARTIAL, no 5xx, with the five chunker checks stopped as a setup error (SCHED-RET-1, P3, now handled); run 2 (`--only=PURE`) passed the chunker through AI schedule generation ([60,60,10], [50,50,30], [60,55], [60], [60,1]). Those runs debugged the proof; they are not WP-6 evidence.

Inputs this plan relies on (all on disk): preparation `C:\Temp\octapm-cert\scratch\wp6\WP6-PREP.md` (+ `wp6-checks-draft.json`, `wp6-mutations-draft.json`, `mutation-anchor-scan.json`); the proof's in-memory model results `C:\Temp\octapm-cert\scratch\wp6\proof-r2\sim-*.json` (not evidence; the source of the lists' collateral and shifts); the runners `C:\Temp\octapm-cert\run-locked.js` and `C:\Temp\octapm-cert\mutate-multi.js` (the four WP-6 keys are to be added, section 7.1).

---

## 0. Rules that bind every step

**Owner execution rules (strict one-writer; CERT-3 parallel execution mode).**
1. **One writer.** Only Claude Main modifies the certification worktree, writes the certification database (:55433) or the cert API (:5190), runs proofs, mutation runs (they edit product files), restores snapshots, runs Codex, commits and pushes. Preparation agents are read only and write only to their scratch folders.
2. **Snapshots.** `cert3d` is the one working CERT-3 baseline: restored before WP-6 (section 2.1), never rebuilt for WP-6. Every later restore re-applies any migration landed after `cert3d` was taken (the WP-2 batches; the HR-C1 migration and backfill if WP-4's fix has landed, P4ADJ A I-3).
3. **Reruns.** After a fix, targeted proof sections first (section 6); complete runs only where the plan requires them: the WP-6 primary run (also the HEAD mutation baseline, section 7.3), one full run on the final code (also the post-fix mutation baseline, only if a WP-6 fix lands), and the exit run.
4. **Codex** only for the plan's required reviews (section 8): the plan review and the diff review of a WP-6 fix, if one lands (BR-ORDER, only if P1). No round for the proof, the lists or this plan.
5. **Long runs** (> 1.5 h) detached under the watchdog. Nothing in WP-6 is that long.
6. **Manual UX** never holds WP-6 and never uses :5190 or the cert database while a proof or a mutation list runs.

**Plan rules.** Section 0.0 (no new rounds, matrices or requirements; rerun only invalid cases), section 1.4 (known answers first, A10; checks assert; reproduce before fixing; a fix is followed by a mutation that puts the defect back), section 5's defect-fix list (:1113, BR-ORDER, fixed only if it confirms as P1), section 6.4 gates, section 7 detached-run rules. Standing rulings (WP6ADJ): no SQL fixtures; a value equal to HEAD's today under an undecided rule reads BLOCKED; every writing check and every catcher runs on the throwaway; N-round concurrency probes (WP-6 has none); every figure a book leaf. **No HR rule is decided by this plan**: HR-C14, HR-C17, HR-C18 and the leads L109, L110, L111 stay undecided and their known answers read BLOCKED at `today` with their ref; owner questions are listed (section 4.4), not answered.

---

## 1. Sequence

| # | Step | Who / where | Expected |
|---|---|---|---|
| 0 | Precondition: the previous WP closed (committed, pushed, journalled); `cert3d` exists with 087-COM and 087-SCH built | Claude Main | its row of the workflow report written |
| 1 | Restore `cert3d` (section 2.2), re-apply every migration landed after it | Claude Main | API up on :5190; restore journalled |
| 2 | No-DB checks: `node --check` the proof; the four lists and `wp6-mutation-evidence.js` copied in; the four `LISTS` lines added; `mutsyntax-wp6.js` and `check-runner-shape-wp6.js` on the tree (section 7.2) | Claude Main | every section 6.2 and unit anchor once, every mutant parses, every pending locus once; 0 problems |
| 3 | **Primary run** of `wp6-boq-proof.js`, full, no flags, `FIXES` empty (section 2.3); copy the result to `.primary.json` and `.baseline-head.json` | Claude Main, lock held | exit 0, PASS: 83 + G.5xx green; 10 known answers BLOCKED; 7 confirm-first CONFIRMED and CF.HRC14 PARTIAL; 0 wrong; 0 5xx (section 5.1) |
| 4 | Classify every reported known answer and confirm-first item (section 3); BR-ORDER's severity from `observations.runObservations.brSeverityEvidence` (the integration owner decides it after this run, WP6ADJ); Q5's provisional classification | journal, register | table filled |
| 5 | **HEAD mutation batch** (section 7): `wp6-boq` one id per invocation (12), then `wp6-unit` (5); the evidence check against the HEAD baseline | Claude Main, lock held | 12 CAUGHT by their named catchers; E6 4/4; unit 5/5 caught by named tests |
| 6 | Census (section 7.7) | Claude Main | the 97 other companies unchanged; 087 moved only on B6 / B6X tables and its AI counter |
| 7 | **BR-ORDER fix route**, only if step 4 rates it P1 (section 4.1) | Claude Main | targeted green; final full run exit 0; M-BR1 moved into `mutations[]` and CAUGHT on the post-fix baseline |
| 8 | Re-scan after the WP-2 batches, if they land after step 5 (section 7.8) | Claude Main | anchors once; the named re-runs |
| 9 | Regression: the read-only lifecycle verifier (E7) | Claude Main | as at WP-0 |
| 10 | Codex diff review of the BR-ORDER product diff, only if it landed (section 8) | Claude Main | nothing CRITICAL or HIGH open |
| 11 | `/code-review` (high) on the WP-6 batch (section 9) | Claude Main | findings adjudicated |
| 12 | Commit and push (section 10) | Claude Main | no merge of `main` |
| 13 | Journal entry (section 11) | Claude Main | figures, table, tallies, restore, census, reviews, next action |
| 14 | The WP-6 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register rows (section 12) | Claude Main | rule -> evidence -> result for every WP-6 rule |
| 15 | Restore `cert3d` before the next WP, re-apply the landed migrations | Claude Main | the next WP starts clean |

---

## 2. Restore `cert3d` and the primary run

### 2.1 When to restore
- **Before the primary run.** Earlier WPs leave archived throwaways in 087 and their mutation residue; WP-6 reads 087-COM's build moments (steps `budget-lines`, `boq`) and 087-SCH's lock. A restore is cheaper than reasoning about them.
- **Not after any WP-6 list.** Every mutant writes, if at all, only on the run's throwaway B6 (archived by the proof's cleanup, which also runs after a section error; its queued jobs cancelled through the product route, zero queued asserted, WP6ADJ Q11). On 087-COM and 087-SCH every probe is a read or the 087-SCH PATCH refusal (assertBoqEditable, before any write), which no WP-6 mutant touches. The census proves it (section 7.7).
- **Before the next WP.** WP-6 leaves one archived `CERT3 WP6 BOQ and budget <stamp>` and one archived `CERT3 WP6 AI job <stamp>` project in 087 per proof run (about 30 with the primary, targeted, final and 12 mutation runs), and 087's AI counter +2 per run (recorded residue, WP6ADJ: 087 is Enterprise, no limit).

### 2.2 How (the build order's own mechanism, `build-cert3d.ps1` :42-80)
From `backend/` with `DATABASE_URL` unset and the proof lock not held (`C:\Temp\octapm-cert\locks\proof.lock` absent):
1. Stop the cert API as `build-cert3d.ps1` does (`Stop-CertApi`: the process on :5190 must be the recorded `api.pid`; never stop another process).
2. `node scripts/cert/snapshot-db.js restore cert3d`
3. Only if a migration landed after `cert3d` was taken: `node C:\Temp\octapm-cert\migrate-cert.js` (and the HR-C1 backfill under the owner's Q5 rule, if WP-4's fix has landed), the client guard (`npm run prisma:generate`), the API down across all of it.
4. `powershell -NoProfile -ExecutionPolicy Bypass -File C:\Temp\octapm-cert\start-api.ps1`
5. Record the restore in the journal (time, reason).

Never run a builder after `cert3d` without taking the snapshot again: the state files `C:\Temp\octapm-cert\state\cert3\*.json` are not in the snapshot, and the proof's `S.projects` refuses a state file whose project differs from the live one (setup error).

### 2.3 The primary run
```
cd <worktree>\backend
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp6-boq-proof.js
```
- **No flags on `cert3d`.** `--only` / `--skip` / `--project` exist for targeted reruns (section 6). They are never used for the primary run, the final run or a mutation run: `mutate-multi.js` spawns the proof without arguments. A filter naming BQ or B6Q is refused (the L121 ruling).
- `CERT_PASSWORD` comes from `backend/.env` through `lib/api.js`; never echoed, copied into this plan, the results or the journal.
- Setup: company 087 resolved by slug, the personas sign in (087 only); 087-COM and 087-SCH by exact name, one live each, matching their state files (S.projects); B6X created with X-A1 (X0), then B6 with its team, eight activities and eight library cost codes (S.B6.create, S.B6.fixture), B6X's 130-row bill (S.B6X.bill).
- **Expected console:**
  - `wp6-boq-proof: 83 of 83 checks active; sections S BU BA BB BX PURE COM SCH CF; deep projects 087-COM, 087-SCH; throwaways B6 yes, B6X yes (bill yes, chunker product); companies 087 only; TEST GAP L121; fixes HR-C14 not set, HR-C17 not set, BR-ORDER not set, C1-TOL not set, L109 not set, L110 not set, L111 not set, WP0-BOQ-1 not set; in process`
  - `tally: 83 pass, 0 fail of 83 recorded (83 active); failures: none; known answers: 0 value, 10 BLOCKED, 0 STORED-PRE-FIX, 0 fail (0 wrong)`
  - `confirm-first: CF.HRC14 PARTIAL; CF.BRorder CONFIRMED; CF.L109 CONFIRMED; CF.L110 CONFIRMED; CF.L111 CONFIRMED; CF.HRC17 CONFIRMED; CF.HRC18 CONFIRMED; CF.WP0BOQ1 CONFIRMED`
  - `PASS  G.5xx  ...` (`<n> answers, none an unexpected 5xx`);
  - cleanup: B6 and B6X archived (`archivedAt` set); the two throwaway checks (`0 live`); `087's AI counter <n> -> <n+2>`; `companies touched: 087`; `queued jobs cancelled through the product route: B6 <k>, B6X <m>`; `deep projects: nothing written; the 087-SCH refusal was refused`;
  - `wp6-boq-proof: 84 passed, 0 failed of 84 (fixed); PASS, exit 0`. No `provisional classification` line (the harness prints none for a plan without defect checks).
- The tally's `pass` counts PASS, BLOCKED and STORED-PRE-FIX records: the 10 BLOCKED known answers are passes for the harness, counted apart in the known-answer tally.
- Result: `C:\Temp\octapm-cert\results\cert3\wp6-boq-proof.json` (`checks[]` with `ok`, `kind`, `notRun`; `meta` with `decidedRed` (empty), `fixes`, `catchers`, `fixCatchers`, `collateral`, `filter`, `activeChecks`, `testGaps`, `equivalentMutants`; `observations.checks`, `knownAnswers`, `confirmFirst`, `fixes`, `runObservations` (the recorder windows, `brSeverityEvidence`), `jobsCancelled`, `tally`; `answers.byStatus` and `fiveXX`; `cleanup`). **Copy it at once** to `wp6-boq-proof.primary.json` and to `wp6-boq-proof.baseline-head.json` (the HEAD mutation baseline, section 7.3); every later run overwrites the result file. Record `git rev-parse HEAD` and `git status --porcelain backend/src backend/scripts/cert/cert3` with the copy in the journal.
- Exit semantics (harness rule 5, A10): **0** every check holds (the expected answer at HEAD); **2** a check failed (a HARD check, a `wrong` known answer, or a TEST GAP classification); **1** setup error (a check not run, a section that threw, a recorder window with an unscripted AI call or an outbound request, an R-SET probe whose own setup failed) - never a product result: fix the proof or the fixture and rerun.
- What the debug runs could not show and the primary run must (proof-r2 `debug-run.txt`): the recorder windows saw only scripted AI calls and no outbound request; B6X's duration PATCH accepted and the PURE section through the product path; the two stored moments of 087-COM read as the registration check did; `brSeverityEvidence` present; CF.HRC14 PARTIAL with L121 its gap item.

---

## 3. Classification table

Every failed check and every reported known answer gets a row. Classification per plan section 0.0 item 4 / section 6.4: CONFIRMED, PARTIAL, REJECTED, EXPECTED BEHAVIOUR, TEST GAP. Severity per section 1.4. Destination: **fixed in WP-6** (section 4.1), **owner HR decision** (section 4.4), **register** (P2/P3, recorded under the scope freeze), **proof or book corrected** (TEST GAP, A10), **closed** (EXPECTED BEHAVIOUR, rule cited).

Pre-filled rows ("observed" = the code reading, the model and the debug runs; replaced by the `cert3d` primary run):

| # | Check id(s) | Book key | Observed (HEAD) | Expected (value) | Today + ref | Proposed classification | Severity | Destination |
|---|---|---|---|---|---|---|---|---|
| 1 | KA.B6.registerOrder, CF.BRorder | WP6.B6.BR-B / BR-A, WP6.CF.BRorder | BR-A (+10,000.00, run date - 10) then BR-B (+5,000.00, - 20): stored BR-B 2,015,000.00, BR-A 2,010,000.00; the waterfall already in effective order; healed by the CO approval's recompute | BR-B 2,005,000.00, BR-A 2,015,000.00 | today, BR-ORDER | CONFIRMED expected | **decided after the run** from `brSeverityEvidence` (WP6ADJ Q6: P1 if the stored figure reaches a financial calculation, export, report or forecast; P2 if display-only and healed on the next edit) | fix in WP-6 if P1 (section 4.1); register if P2 |
| 2 | KA.U2.omitB005, KA.U5.B6X.sections, KA.U5.B6X.aiJobCalls, KA.U5.B6X.aiAfterBaseline, KA.U5.087.sections, CF.HRC14 | WP6.U2.omitB005, WP6.U5.*, WP6.CF.HRC14 | a dropped row stays active, unflagged; no section read back (B6X, 087-COM); one AI call of 130 rows (L131); the AI job writes on a locked bill (L130) | flag; sections 50/50/30; 3 calls; refused | today, HR-C14 | CF.HRC14 PARTIAL (seven items present, L121 the gap item) | owner's (O1) | owner HR decision |
| 3 | KA.A2.resubmitRejected, CF.HRC17 | WP6.A2.resubmitRejected | submit 400 INVALID_ALLOCATION_STATUS, PATCH 400 ALLOCATION_NOT_EDITABLE | back to draft, submitted | today, HR-C17 | CONFIRMED | owner's (O3) | owner HR decision |
| 4 | CF.HRC18 | WP6.CF.HRC18 | budget register and ledger eight cost types; the activity cost record seven category fields | - (an observation) | HR-C18 | CONFIRMED (reported) | owner's (O4) | owner HR decision |
| 5 | KA.B5.afterRepoint, CF.L109 | WP6.B5.afterRepoint | re-pointing the approved CO releases LA's Original lock (200, original 1.00) | 409 BUDGET_ORIGINAL_LOCKED | today, L109 | CONFIRMED | P2 proposed (O6) | register |
| 6 | KA.B7.archivedActual, CF.L110 | WP6.B7.archivedActual | lines' actual 26,000.00 against the reconciliation's 28,000.00 after MAT is archived | equal | today, L110 | CONFIRMED | P2 proposed (O6) | register |
| 7 | CF.L111 | WP6.CF.L111 | a line at -500.00 and a revision of -999,999.00 both 201 | refused | L111 | CONFIRMED | P2 proposed (O6) | register |
| 8 | KA.B3.overTransfer | WP6.B3.overTransfer | 100,000.01 accepted (T1 -0.01, T2 200,000.01) | 409 BUDGET_TRANSFER_EXCEEDS | today, C1-TOL | CONFIRMED (WP-4's item reused, no new item, WP6ADJ Q14) | P3 (WP-4) | WP-4's register row |
| 9 | CF.WP0BOQ1 | WP6.CF.WP0BOQ1 | template and stored upload 403 to the cost controller and the site engineer although boq:read allows them | 200 | WP0-BOQ-1 | CONFIRMED | P3 | register; owner may narrow the policy through HR-A1 (O5) |
| 10 | U3.B6.uploadMissingColumns (pass) | WP6.U3.realUploadWrites | a refused real upload keeps one rejected ProjectDocument; no row, revision, job, allocation or budget figure | - | - | EXPECTED BEHAVIOUR provisionally (WP6ADJ Q5): classified at this run | - | closed or register |
| 11 | L121 (no check) | WP6.U6.* (record only) | the quota refusal on a non-AI import is not run | - | - | TEST GAP (ruling 2026-10-10) | - | journal, register note; M-C14q has no catcher |
| 12 | SCHED-RET-1 | - | the AI-generation job result always reports `revisionId: null` (`schedule.service.js:2580` re-declares `stagedRevisionId`) | the staged revision's id | - | CONFIRMED (debug run 1) | P3 | register (done at `bde300d`) |
| 13 | Q10 leads (record only) | - | the orphan upload on a quota refusal (P3; not observed now, L121); the activity-delete cascade of approved allocations (D-FUN-1 class, P2); the concurrent-capacity race (the trigger's isolation noted) | - | - | recorded | P2 / P3 | register, no probing |
| 14 | 087's AI counter +2 per run | - | B6X's two handler runs | - | - | recorded residue (WP6ADJ) | - | journal |
| 15 | Debug runs 1-2 (partial population) | - | run 1: 78/78, the chunker setup error; run 2: PURE green | - | - | not evidence | - | journal |

---

## 4. What WP-6 fixes, and what waits for the owner

### 4.1 BR-ORDER, only if the primary run rates it P1 (section 5 :1113; WP6ADJ Q6)
1. **Reproduction.** The primary run: KA.B6.registerOrder at today, CF.BRorder CONFIRMED, and `observations.runObservations.brSeverityEvidence` (what reads the stored `cumulativeBudget`).
2. **Severity.** Decided by the integration owner after the primary run (the ruling on the drafters' questions). P2 -> register row, no change (scope freeze); M-BR1 stays pending.
3. **If P1: a read-only fix plan** (as HR-C1's), **compute on read preferred** (WP6ADJ Q6: `listBudgetRevisions`, `budget-revision.service.js:59`, derives each row's running total in effective-date order; no stored-data rewrite, so the 97 other companies' fingerprint does not move). Any data remediation is owner question O2.
4. **Codex adversarial plan review** (financial figures: high risk), adjudicated finding by finding; at most 3 rounds.
5. **Fix** and its unit case (`budget-revision.service.test.js`), **fix commit** (`fix(CERT-3 WP-6): budget-revision running totals in effective-date order (BR-ORDER)`), never amended afterwards.
6. **Set `FIXES['BR-ORDER']`** in the proof to `{ commit: '<sha>', committedAt: '<git show -s --format=%cI <sha>>' }` and `CONTRACT['BR-ORDER'].readOrStored` from the adjudicated plan. `DECIDED_RED` then holds KA.B6.registerOrder and CF.BRorder (their today fails; CF.BRorder must read REJECTED). `S.state` checks the commit against git.
7. **Targeted run** `--only=CF` (it selects BU BA BB BX COM with it; CF.BRorder and KA.B6.registerOrder both run), then **one full run** (section 6.4: the WP-6 result and the post-fix mutation baseline).
8. **M-BR1** derived from the fix diff: `from` / `to` put the stored running total back where the fix computes it (the pending entry's loci: `budget-revision.service.js` :130, :154, :59), the entry moved from `pending[]` into `mutations[]` of `wp6-fix-mutations.boq.json` (UM-BR1 likewise, with its test title from the diff); `mutsyntax-wp6.js --post-fix`; the post-fix batch (section 7.4); the Codex diff review (section 8).

### 4.2 HR-C14, HR-C17, HR-C18: owner decisions; no change before them
HR-C14 (O1), HR-C17 (O3) and HR-C18 (O4) are undecided. When one is decided and implemented (after WP-6, or inside it if the owner decides in time): its commit, `FIXES` and `CONTRACT` fields from the decision, its known answers turn value checks (`DECIDED_RED`), and its pending fix mutations (M-C14s, M-C14b, M-C14l, M-C14d; M-C17) are derived from the diff and moved into `mutations[]`. M-C14q (HR-C14's quota-only-for-AI change reverted) has no catcher (L121, TEST GAP) and stays `notRun`.

### 4.3 Leads L109, L110, L111 (P2 proposed) and WP0-BOQ-1 (P3)
Recorded in the register under the scope freeze; severities are owner question O6; WP0-BOQ-1 is the owner's through HR-A1 (O5). No fix in WP-6.

### 4.4 Owner questions (listed for the consolidated decision list, not answered)
| Id | Question | What WP-6 observes |
|---|---|---|
| O1 | HR-C14 package (section column, AI batches of at most 60 by section, dropped rows flagged not deactivated, AI quota only for the AI job, the AI job refused after the baseline) | KA.U2.omitB005, KA.U5.*, CF.HRC14 (L121 a TEST GAP) |
| O2 | HR-C15: the BR-ORDER fix's data treatment (compute on read leaves stored rows; any rewrite is the owner's) | KA.B6.registerOrder, CF.BRorder |
| O3 | HR-C17: a rejected allocation returns to draft | KA.A2.resubmitRejected, CF.HRC17 |
| O4 | HR-C18: seven or eight cost categories | CF.HRC18 |
| O5 | WP0-BOQ-1 / HR-A1: the template and stored upload follow boq:read, or the policy narrows | CF.WP0BOQ1 |
| O6 | Severities of L109, L110, L111 | KA.B5.afterRepoint, KA.B7.archivedActual, CF.L109-L111 |
| (integration owner) | BR-ORDER's severity after the primary run; Q5's classification (the rejected document kept on a refused upload) | rows 1, 10 |

---

## 5. Known answers and where each check runs

### 5.1 What the primary run WILL report (before any fix; so nobody mistakes them for failures)
**Known answers BLOCKED (10; undecided; never exit 2):** KA.U2.omitB005, KA.U5.B6X.sections, KA.U5.B6X.aiJobCalls, KA.U5.B6X.aiAfterBaseline, KA.U5.087.sections (HR-C14); KA.A2.resubmitRejected (HR-C17); KA.B3.overTransfer (C1-TOL); KA.B6.registerOrder (BR-ORDER); KA.B5.afterRepoint (L109); KA.B7.archivedActual (L110).

**Confirm-first reported (8, a pass):** CF.BRorder, CF.L109, CF.L110, CF.L111, CF.HRC17, CF.HRC18, CF.WP0BOQ1 CONFIRMED; CF.HRC14 PARTIAL (seven items present, L121 the gap item).

**Green:** 9 setup + 54 HARD + 2 STORED, and G.5xx (no route answers 5xx on B6 at HEAD; M-CAP is where the allocation trigger's 500 shows).

### 5.2 What the final run reports (only if BR-ORDER is fixed)
`FIXES['BR-ORDER']` set: KA.B6.registerOrder reads its value (PASS, `1 value, 9 BLOCKED`), CF.BRorder REJECTED; everything else as in 5.1; exit 0. Without a WP-6 fix there is no separate final run: the primary run is the WP-6 result.

### 5.3 Where each check runs (the proof's where-table)
| Where | Checks |
|---|---|
| **B6** (throwaway of 087, created and archived by each run; WP6ADJ Q1) | S.B6.create, S.B6.fixture, S.B6.archived; every writing check and every section 6.2 catcher: BU (B2, B4, B5), BA (B3), BB (B6), the B6 confirm-first reads |
| **B6X** (the AI-job throwaway; the 130-row bill; the recorder stub, WP6ADJ Q2-Q3) | S.B6X.create, S.B6X.bill, S.B6X.archived; KA.U5.B6X.*; U5.pure.* (the chunker through AI schedule generation); A1.B6.foreignActivity names X-A1. No catcher |
| **087-COM stored** | U5.stored.087.bill, B1.stored.087.original |
| **087-COM live** (reads only) | U5.live.087.rows, KA.U5.087.sections, B1.live.087.original, B1.live.087.costTypes |
| **087-SCH** (a read and one PATCH refusal before any write) | U4.live.087SCH.lock, U4.live.087SCH.patch |
| **static** | the scans behind CF.HRC14, CF.BRorder, CF.HRC18 |
| **setup** | S.book, S.state, S.projects |

### 5.4 Reading notes
- **No races.** WP-6 has no concurrency probe (WP6ADJ); the evidence checker's racy set is empty.
- **Recorder windows.** An unscripted AI call or an outbound request inside a window is a setup error (R-SET, exit 1), never a verdict.
- **Queued jobs.** Every job a throwaway queues is run through the stub where a check needs it and then cancelled through `POST /projects/:id/jobs/:jobId/cancel`; zero queued asserted at each end step. Under M-DRY / M-DRYr / M-DRYs the "dry run" queues one more boq.parse job on B6; it is cancelled the same way (`jobsCancelled` shows B6 one higher).
- **087's AI counter** +2 per run (B6X's handler runs): recorded residue, no limit on 087.

---

## 6. Targeted proofs, targeted reruns, the final full run

### 6.1 Before any fix
Nothing beyond the primary run (it is the reproduction). A proof defect found in it (a TEST GAP) is fixed in the proof and re-run with the narrowest `--only` that covers it; then the HEAD baseline must be retaken as a full run on the changed proof before any mutant runs (section 7.3).

### 6.2 After the BR-ORDER fix (only if P1)
```
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp6-boq-proof.js --only=CF
```
CF selects BU BA BB BX COM with it (CF classifies from them). Expected: KA.B6.registerOrder value (PASS), CF.BRorder REJECTED, everything else as in 5.1; exit 0. A failure goes back to the fix (three iterations, then escalate).

### 6.3 After the WP-2 batches, if they land after the primary run
See section 7.8 for the anchors. The HR-X1 / XDOC batch rewrites the change-order approval evidence (`change-order.service.js` `assertApprovalProof` :494-559, `workflow-support.service.js`, `routes/change-orders.js`, `routes/workflow-uploads.js`; `HRX1-FIX-PLAN.r3c.md`). B6's B6 step crosses it: the QS creates a 10,000.00 CO on A110 naming LA, attaches an instruction, summaries and an activity link, submits, and the PM approves (B5.B6.lockedAfterCo, KA.B5.afterRepoint, CF.L109, CF.BRorder's healed read).
```
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp6-boq-proof.js --only=BB
```
Expected: every BB check as in 5.1 on the post-batch code (the CO's attachment is B6's own upload, which XDOC's scope rule accepts). If it needs a proof edit (an R-SET in the CO step), make it, then one full unmutated run as the new baseline (`wp6-boq-proof.baseline-wp2.json`) and re-run the entries section 7.8 names into `wp6-mutations-wp2\`, judged with `--ids=<their ids> --baseline=<that file>`. If the batches land **before** the primary run, nothing extra.

### 6.4 The final full run (only if a WP-6 fix landed)
One full run on the final code, no flags: the expected answer is section 5.2. Copy it to `wp6-boq-proof.final.json` and `wp6-boq-proof.baseline.json` (the post-fix mutation baseline), with `git rev-parse HEAD` in the journal. If a later product or proof change follows (a Codex or code-review finding), run it again and re-run only the mutants whose catchers or anchors that change touches (owner rule 3).

---

## 7. Mutation runs

### 7.1 Lists and runner keys
Claude Main copies `wp6-mutations.boq.json`, `wp6-mutations.unit.json`, `wp6-fix-mutations.boq.json`, `wp6-fix-mutations.unit.json` and `wp6-mutation-evidence.js` from `C:\Temp\octapm-cert\scratch\wp6\lists\` into `backend/scripts/cert/cert3/`, and **then** (never before the files exist: the runner reads every registered list file on every invocation without `--lists=`) adds four keys to `LISTS` in `C:\Temp\octapm-cert\mutate-multi.js`, before `'unit-tests'`:
```js
  // WP-6 (WP6-RUN-PLAN.md section 7): the section 6.2 guards runnable at HEAD; judged by wp6-mutation-evidence.js against a baseline, never by the exit code.
  'wp6-boq': ['scripts/cert/cert3/wp6-boq-proof.js', true, 'wp6-mutations.boq.json'],
  'wp6-unit': [null, false, 'wp6-mutations.unit.json'],
  // WP-6 fixes (BR-ORDER if P1; HR-C14 / HR-C17 after the owner): the defect put back; every entry pending until its fix lands.
  'wp6fix-boq': ['scripts/cert/cert3/wp6-boq-proof.js', true, 'wp6-fix-mutations.boq.json'],
  'wp6fix-unit': [null, false, 'wp6-fix-mutations.unit.json'],
```
`mutsyntax-wp6.js`, `teeth-mutsyntax-wp6.js`, `check-runner-shape-wp6.js`, `selftest-evidence-wp6.js` and `build-lists-wp6.js` stay in the scratch folder (as WP-4's). Ids: every `catchers`, `collateral`, `shifts[].id` and `unchanged` id, and every check id an `expect` names, is a CHECKS id or G.5xx; the section 6.2 catchers equal the proof's CATCHERS table and the fix entries' FIX_CATCHERS; no WP-6 id is used by another registered list (26 registered at drafting, 0 clashes; the unregistered WP-5 and WP-7 drafts, 0 clashes). The equivalent mutant (M-DRYq), the not-mutable trigger, the pending fix mutants (M-BR1, M-C14s, M-C14b, M-C14l, M-C14d, M-C17; UM-*) and the not-run M-C14q are recorded in their lists (`equivalent`, `notMutable`, `pending`, `notRun`) and never run by the runner (it reads `mutations` only). **No optional (untallied) list:** neither the adjudication nor the proof (no `OPTIONAL_CATCHERS`) names an optional mutant; the variants are untallied entries of the main list, the WP-4 precedent.

### 7.2 Mutant syntax (no DB, no lock)
- At drafting (`node C:\Temp\octapm-cert\scratch\wp6\lists\mutsyntax-wp6.js`), on the worktree at `2a2efd2`: every section 6.2 and unit anchor occurs once and every mutant parses with its line endings kept (M-DRY 163 + 1244 + 200; M-DRYr 163; M-DRYs 1244; M-DRYm 200; M-CAP 289 + 302; M-CAPq 289; M-CAPa 302; M-CAPi 281; M-XFER 678; M-ORIG 416; M-ORIG2 351; M-ORIG4 375 + 377; M-DRYq 1174; the unit entries the same edits as their live mutants, byte for byte); the pending loci occur once (M-BR1 130, 154, 59; M-C14s 46, 463, 1967; M-C14b 1647, 1649; M-C14l 1593, 1662; M-C14d 395; M-C17 1449, 1295; M-C14q 1174); the six product files are CRLF only; the answer book's WP6.mutations names every entry and catcher; the five unit titles are in their suites (activity-boq-allocation.service.test.js :25, :36; budget.service.test.js :125, :243); 0 problems. Its teeth (`teeth-mutsyntax-wp6.js`): 23 kinds of break all reported. `check-runner-shape-wp6.js`: the four proposed `LISTS` lines parse as the runner's rows, every runnable entry has name, file, from, to (and a suite for the unit list), every `"--only=<id>,"` selects exactly one entry, every edit plans.
- **On the day**, before the HEAD batch: `node mutsyntax-wp6.js` and `node check-runner-shape-wp6.js` again (the tree may have moved: a WP-2 batch). **After a WP-6 fix:** derive the fix entry's `from` / `to` on the real fix diff, then `node mutsyntax-wp6.js --post-fix` (every list, the fix lists included, must apply once on the fixed worktree and parse). An anchor found 0 or 2+ times is NOT APPLIED by the runner; a mutant that does not parse would be "caught" by a crash and proves nothing.

### 7.3 Runner and baseline: how a mutant is judged
**The design (the WP-4 L1 ruling, applied to WP-6).** Every proof-backed mutant is judged by `wp6-mutation-evidence.js` on its **named catchers flipping from PASS in a baseline result to FAIL under the mutant, on the same tree**, never by the runner's exit code. At HEAD the unmutated WP-6 proof exits 0 (no decided red), so the runner's CAUGHT agrees with the evidence in direction; it still never says which check went red, and a mutant whose catchers stayed green while an unrelated check failed would read CAUGHT there. The checker refuses that.

**Why it is sound.**
1. Every HEAD catcher (U1.B6.writes, A5.B6.dryRun, A1.B6.overCapacity, A1.B6.amountOverCapacity, A4.B6.bulk, G.5xx, B3.B6.overTransferPlus2, B5.B6.lockedByLedger, B5.B6.lockedAfterCo) is a check that PASSES at HEAD; none is a known answer. The checker refuses a catcher that is not PASS in the baseline (and, for a known answer, not at its value: BLOCKED or STORED-PRE-FIX is not PASS), so a fix entry judged on the HEAD baseline reads NO EVIDENCE by design (self-test: M-BR1 on the HEAD baseline).
2. The HEAD baseline has no red at all (`meta.decidedRed` empty); any red in it voids it unless it is classified by name in the journal with its register row and named with `--accept-baseline-red=<ids>` (the WP-4 L5 ruling).
3. "Not run" is never evidence: a catcher left unrecorded by a section error reads NO EVIDENCE; a run that ends in exit 1 still counts when its catchers ran and failed (the WP-1 C1 / I1 precedent).
4. Every other red under the mutant must be named collateral with its derivation in the list (`collateralWhy`), else the entry is CAUGHT, FLAGGED: not evidence until Claude Main classifies it and re-runs the checker. G.5xx is a named catcher of M-CAP and M-CAPa (the trigger's 500, WP6ADJ Q9) and an unexpected red for every other entry. Non-red status changes (a classification CONFIRMED -> PARTIAL) are reported as named (`shifts`) or unnamed (a note).
5. The baseline must be a full run (no filter), no setup error, G.5xx green; each mutant result must carry the same `FIXES`, the same answer book and the same check ids as its baseline and start after the baseline finished (else NO EVIDENCE: mismatched or stale).
6. What the result files cannot prove (that no product file changed between the baseline and the mutant) is procedural: no product or proof commit between the baseline and the mutants of a batch; `git rev-parse HEAD` and `git status --porcelain backend/src backend/scripts/cert/cert3` recorded at the baseline and at each invocation; after any such commit, a new full baseline before the next mutant.

**The baseline files** (the checker's defaults):
- **HEAD lists** (`--lists=boq`): `C:\Temp\octapm-cert\results\cert3\wp6-boq-proof.baseline-head.json` = the primary run's copy (section 2.3), as long as nothing changed since; otherwise one unmutated full run on the current tree, copied there. The primary run is a valid baseline for the mutants that follow it: each run makes its own B6 and B6X; the deep projects are read only.
- **Fix lists** (`--lists=fix`): `C:\Temp\octapm-cert\results\cert3\wp6-boq-proof.baseline.json` = the final full run on the fixed code (section 6.4; exit 0, the fix's `FIXES` set).

**Verdicts** (per entry; the checker's header carries the same text): **CAUGHT** (every named catcher PASS in the baseline and FAIL, ran, under the mutant; every other red named collateral or a baseline red; no baseline red turned green); **CAUGHT, FLAGGED** (the catchers flipped, but an unnamed red appeared or a baseline red turned green; not counted until classified); **SURVIVED** (every catcher ran and is still PASS: a guard with no live teeth, a TEST GAP or a wrong list); **NO EVIDENCE** (no result file; a VOID or mismatched baseline; a stale result; a catcher not PASS in the baseline; a catcher not run or missing; only some catchers flipped).

### 7.4 Running: one mutant per invocation, the result copied after each
Never while a build, another proof, Codex or the full jest suite runs. **Quote the id and end it with a comma, and always name the list**: `mutate-multi.js` treats a value without a comma as a name *prefix* (`--only=M-DRY` would also run M-DRYr, M-DRYs and M-DRYm; `--only=M-CAP` M-CAPq, M-CAPa and M-CAPi; `--only=M-ORIG` M-ORIG2 and M-ORIG4; `--only=UM-CAP` UM-CAPq and UM-CAPa), PowerShell drops an unquoted trailing comma, and ids such as M1 or G1 repeat across other lists.

**HEAD batch** (after the primary run and its classification, the HEAD baseline in place), from `<worktree>\backend`, one pair of lines per id, in this order:
```
New-Item -ItemType Directory -Force C:\Temp\octapm-cert\results\cert3\wp6-mutations | Out-Null
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp6-mutations.M-DRY.json --lists=wp6-boq "--only=M-DRY,"; Remove-Item Env:CERT_LOCK_HELD
Copy-Item C:\Temp\octapm-cert\results\cert3\wp6-boq-proof.json C:\Temp\octapm-cert\results\cert3\wp6-mutations\M-DRY.json
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp6-mutations.M-DRYr.json --lists=wp6-boq "--only=M-DRYr,"; Remove-Item Env:CERT_LOCK_HELD
Copy-Item C:\Temp\octapm-cert\results\cert3\wp6-boq-proof.json C:\Temp\octapm-cert\results\cert3\wp6-mutations\M-DRYr.json
```
and the same two lines for **M-DRYs, M-DRYm, M-CAP, M-CAPq, M-CAPa, M-CAPi, M-XFER, M-ORIG, M-ORIG2, M-ORIG4** (12 invocations; each one full proof run; 087's AI counter +2 each). After each: the runner line reads `CAUGHT      wp6-boq | <id> ...` (exit 2; SURVIVED or NOT APPLIED stops the batch for a look), `git status --porcelain backend/src` is empty (restored byte for byte), and the copy is made before the next invocation overwrites the result.

Then the unit side: first the unmutated suites must pass (a red suite would score every unit mutant CAUGHT):
```
npx jest src/services/__tests__/activity-boq-allocation.service.test.js src/services/__tests__/budget.service.test.js
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp6-mutations.unit.json --lists=wp6-unit; Remove-Item Env:CERT_LOCK_HELD
node scripts/cert/cert3/wp6-mutation-evidence.js --lists=boq --unit-results=C:\Temp\octapm-cert\results\cert3\wp6-mutations.unit.json
```
The checker prints the baseline's validity, then per entry the verdict, each catcher's baseline -> mutant status, the collateral and which of it went red, any unexpected red, any baseline red turned green, the shifts (named / unnamed), the notes, the known-answer and confirm-first tallies, the jobs cancelled and the 5xx count; then `E6 (section 6.2 WP-6 guards): n/4` and the unit verdicts (`CAUGHT BY NAMED TESTS`: every title in the entry's `tests` in a jest failure line). **Expected at HEAD:** `entries: {"CAUGHT":12}`, `E6 (section 6.2 WP-6 guards): 4/4 with evidence (1 dry runs write nothing M-DRY yes; 2 allocation capacity M-CAP yes; 3 transfer limit M-XFER yes; 4 the Original lock M-ORIG yes)`, `unit: 5/5 caught by named tests (mocked, not evidence)`; exit 0.

**Post-fix batch** (only if BR-ORDER lands; after section 6.4, the final baseline in place; M-BR1 and UM-BR1 moved into `mutations[]`, `mutsyntax-wp6.js --post-fix` first):
```
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp6-mutations.M-BR1.json --lists=wp6fix-boq "--only=M-BR1,"; Remove-Item Env:CERT_LOCK_HELD
New-Item -ItemType Directory -Force C:\Temp\octapm-cert\results\cert3\wp6-mutations-final | Out-Null; Copy-Item C:\Temp\octapm-cert\results\cert3\wp6-boq-proof.json C:\Temp\octapm-cert\results\cert3\wp6-mutations-final\M-BR1.json
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp6-fix-mutations.unit.json --lists=wp6fix-unit; Remove-Item Env:CERT_LOCK_HELD
node scripts/cert/cert3/wp6-mutation-evidence.js C:\Temp\octapm-cert\results\cert3\wp6-mutations-final --lists=fix --unit-results=C:\Temp\octapm-cert\results\cert3\wp6-fix-mutations.unit.json
```
Expected: M-BR1 CAUGHT (KA.B6.registerOrder PASS -> FAIL, collateral CF.BRorder), UM-BR1 caught by its named test. The BR-ORDER fix edits `budget-revision.service.js` only, which no section 6.2 entry mutates: the HEAD batch's evidence stands on the final code (section 7.6).

### 7.5 Expected per mutant (the lists carry the derivations; the proof's in-memory model agrees, 12/12 in the self-test)

| Id | Runner | Exit | Named catchers (PASS -> FAIL) | Expected collateral (FAIL) | Shifts (not red) |
|---|---|---|---|---|---|
| M-DRY | CAUGHT | 2 | U1.B6.writes (the bill dry run writes a document, a revision, 5 rows, a job), A5.B6.dryRun (the mapping dry run creates 2 drafts) | U3.B6.dryRunMissingColumns, U1.B6.dryRun, U2.B6.import, U4.B6.lockFlow, A5.B6.apply, A5.B6.undo | none |
| M-DRYr | CAUGHT | 2 | U1.B6.writes | U3.B6.dryRunMissingColumns, U1.B6.dryRun, U2.B6.import, U4.B6.lockFlow | none |
| M-DRYs | CAUGHT | 2 | U1.B6.writes (no document: the route's branch stores none) | U1.B6.dryRun, U2.B6.import, U4.B6.lockFlow | none |
| M-DRYm | CAUGHT | 2 | A5.B6.dryRun | A5.B6.apply, A5.B6.undo | none |
| M-CAP | CAUGHT | 2 | A1.B6.overCapacity, A1.B6.amountOverCapacity, A4.B6.bulk (each 500 from the trigger), G.5xx | none | none |
| M-CAPq | CAUGHT | 2 | A1.B6.overCapacity, A4.B6.bulk (ALLOCATION_AMOUNT_EXCEEDED instead) | none | none |
| M-CAPa | CAUGHT | 2 | A1.B6.amountOverCapacity (500), G.5xx | none | none |
| M-CAPi | CAUGHT | 2 | A5.B6.dryRun (matched 3, breaches 0) | A5.B6.apply (failed 1) | none |
| M-XFER | CAUGHT | 2 | B3.B6.overTransferPlus2 (100,000.02 accepted) | B3.B6.move20000 | CF.L111 CONFIRMED -> PARTIAL |
| M-ORIG | CAUGHT | 2 | B5.B6.lockedByLedger, B5.B6.lockedAfterCo | none | CF.L109 CONFIRMED -> PARTIAL |
| M-ORIG2 | CAUGHT | 2 | B5.B6.lockedAfterCo | none | CF.L109 CONFIRMED -> PARTIAL |
| M-ORIG4 | CAUGHT | 2 | B5.B6.lockedByLedger | none | none |
| UM-CAP | CAUGHT | jest red | 'rejects totals above the BOQ quantity', 'rejects totals above the BOQ amount' | - | - |
| UM-CAPq | CAUGHT | jest red | 'rejects totals above the BOQ quantity' | - | - |
| UM-CAPa | CAUGHT | jest red | 'rejects totals above the BOQ amount' | - | - |
| UM-XFER | CAUGHT | jest red | 'transfers only what a line has, writing both ledger rows' | - | - |
| UM-ORIG4 | CAUGHT | jest red | 'CX21-102: bringing an archived line back keeps the actual the ledger posted on it - and its original budget (PC-7a)' (the title's dash is an em dash, U+2014, escaped in the list) | - | - |
| M-BR1 (pending) | CAUGHT once BR-ORDER is fixed | 2 | KA.B6.registerOrder (value -> today) | CF.BRorder | - |
| M-C14s / b / l / d (pending) | after HR-C14 | 2 | KA.U5.B6X.sections / KA.U5.B6X.aiJobCalls / KA.U5.B6X.aiAfterBaseline / KA.U2.omitB005 | CF.HRC14 | - |
| M-C17 (pending) | after HR-C17 | 2 | KA.A2.resubmitRejected | CF.HRC17 | - |

### 7.6 What counts where: the E6 tally
- **E6 (plan section 6.2 WP-6, four guards), tallied on these entries only:** dry runs write nothing -> **M-DRY**; allocation capacity -> **M-CAP**; the transfer limit -> **M-XFER**; the Original lock -> **M-ORIG** (WP6ADJ Q9). A guard counts when its entry is CAUGHT (clean, not FLAGGED). E6 is met for WP-6 at 4/4 at HEAD.
- **Variants** (run, not tallied): M-DRYr, M-DRYs, M-DRYm, M-CAPq, M-CAPa, M-CAPi, M-ORIG2, M-ORIG4.
- **Equivalent, not run:** M-DRYq (the dry run's quota skip; on 087 assertAiQuota returns before the counter). **Not mutable:** the capacity trigger (its second holder).
- **Fix mutations** (plan section 1.4, not section 6.2): M-BR1 (pending, BR-ORDER if P1), M-C14s, M-C14b, M-C14l, M-C14d (pending, HR-C14), M-C17 (pending, HR-C17); M-C14q has no catcher (TEST GAP L121).
- **Which code each entry's evidence stands on (WP-4 L2).** A HEAD entry's evidence stands on the final code when its mutated file is byte-identical on the final tree and the proof diff since its baseline touches none of its catchers (`git diff <baseline sha> <final sha> -- <file> backend/scripts/cert/cert3/wp6-boq-proof.js`, read for the catcher ids). Otherwise the entry is re-run against the final baseline (its own result directory and `--ids`, section 7.4). Files per entry: M-DRY (`routes/boq.js`, `services/boq.service.js`, `routes/activity-boq-allocations.js`), M-DRYr (`routes/boq.js`), M-DRYs (`services/boq.service.js`), M-DRYm (`routes/activity-boq-allocations.js`), M-CAP / M-CAPq / M-CAPa (`services/activity-boq-allocation.service.js`), M-CAPi (`services/mapping-import.service.js`), M-XFER / M-ORIG / M-ORIG2 / M-ORIG4 (`services/budget.service.js`). Known at drafting: the BR-ORDER fix (`budget-revision.service.js`) moves none of them; the WP-2 QP batch edits `activity-boq-allocation.service.js` (M-CAP family re-run if it lands after them, section 7.8); a later HR-C14 fix (boq files) or HR-C17 fix (allocation files) would re-run the entries on the files it touches.
- **Unit side** (not evidence, plan section 1.4): UM-CAP, UM-CAPq, UM-CAPa, UM-XFER, UM-ORIG4. No unit catcher exists for M-DRY, M-DRYr, M-DRYs, M-DRYm, M-CAPi, M-ORIG, M-ORIG2 (section 13.2).

### 7.7 Cleanup and census after the lists (plan section 7)
- **No restore after any WP-6 list** (section 2.1). Stored effects of the mutants are on B6 only: an extra imported revision with its rows, document and a cancelled job (M-DRY, M-DRYr, M-DRYs), draft allocations from a "dry run" (M-DRY, M-DRYm), transfer rows over the limit (M-XFER), locked originals moved (M-ORIG family); B6 and B6X archived by each run's cleanup.
- **Census**, once after the HEAD batch (and after the post-fix batch if any):
  1. `node scripts/cert/isolation/fingerprint.js take wp6-post`, then `node scripts/cert/cert3/build/fingerprint97.js cert3-post wp6-post` (exit 0: the 97 other companies unchanged). Its `.e2.json` lists 087's changed pairs: they must be B6's and B6X's tables (projects, team, activities, cost codes and budget lines, BOQ revisions, items, documents, allocations, background jobs, direct costs, ledger, budget revisions and line changes, change orders, audit), 087's subscription AI counter (+2 per run, recorded residue) and the request-noise tables only. Nothing on 087-COM or 087-SCH; nothing on any other company. (If anything wrote after the restore of section 2.2 other than WP-6 runs, compare against a fingerprint taken right after the restore.)
  2. The last proof run's throwaway checks: 0 live `CERT3 WP6 BOQ and budget` and `CERT3 WP6 AI job` projects; zero queued jobs on both (S.B6.archived, S.B6X.archived).
  3. Record the census in the journal.
- **Never commit a mutated tree.** After every invocation `git status` shows no product diff that is not the batch's; `mutate-multi.js` restores byte for byte and keeps backups in `C:\Temp\octapm-cert\mutate-backups\`; a RESTORE FAILED line stops everything until the file is restored by hand.

### 7.8 Anchors to re-scan after the WP-2 batches land
| WP-2 batch (final plan) | Product file it edits that WP-6 reads | WP-6 anchors / paths affected | Action |
|---|---|---|---|
| QP (`WP2-FIX-PLAN.r3c.md` section 2.5, reader RD11) | `services/activity-boq-allocation.service.js` :813-818 (the allocation summary's official-progress order) | M-CAP, M-CAPq, M-CAPa (:289, :302); UM-CAP, UM-CAPq, UM-CAPa (same edits); M-C17's loci (:1295, :1449) | `node mutsyntax-wp6.js` (every anchor must still occur once; lines may shift); if the batch lands after the HEAD batch, re-run M-CAP, M-CAPq, M-CAPa (their file changed, L2) into `wp6-mutations-wp2\`, judged with `--ids=M-CAP,M-CAPq,M-CAPa` against a new full baseline, and UM-CAP* once more |
| QP (reader RD13) | `services/schedule.service.js` :2825-2832 | no WP-6 anchor; U5.pure.* read chunkBoqRows (:1929-1956) through AI schedule generation | the `--only=PURE` targeted run on the post-batch tree |
| HR-X1 / XDOC (`HRX1-FIX-PLAN.r3c.md`) | `services/change-order.service.js` (`assertApprovalProof` :494-559 replaced), `services/workflow-support.service.js`, `routes/change-orders.js`, `routes/workflow-uploads.js` | no WP-6 anchor; B6's CO step (B5.B6.lockedAfterCo, the catcher of M-ORIG and M-ORIG2; KA.B5.afterRepoint; CF.L109; CF.BRorder's healed read) | section 6.3: `--only=BB`; if a proof edit is needed there, a new full baseline and M-ORIG, M-ORIG2 re-run (the proof diff touches their catcher's path, L2) |
| any batch | `routes/boq.js`, `services/boq.service.js`, `routes/activity-boq-allocations.js`, `services/mapping-import.service.js`, `services/budget.service.js`, `services/budget-revision.service.js`, `services/boq/excel-parser.js` | every other entry and locus | not named by either final plan; `mutsyntax-wp6.js` confirms (0 problems) |

---

## 8. Codex (plan section 6.4; owner rule 4)
- **Required for WP-6 only if BR-ORDER is fixed:** the adversarial **plan review** of its fix plan before any code, and the **diff review** of its product diff after the mutations. Financial figures: high risk.
- **Not required for** the proof, the lists, this plan or answer-book edits (test side): `/code-review` covers them.
- Rounds: stop when nothing CRITICAL or HIGH is open; at most 3, then escalate. No round for P2/P3 or test polish.
- Mechanics (memory `octapm-codex-review.md`): the desktop app's `codex.exe`; one whole pass per five-hour window; prompt and output in `scratch\wp6\`, adjudication beside each. Never during a build, a proof, a mutation list or the full suite.

## 9. Code review
`/code-review` (high) on the WP-6 batch before its commit: the proof (any edit), the four lists, the evidence checker, this plan, the book's leaves, and the BR-ORDER diff and its tests if it landed. Findings adjudicated like Codex's. A finding that changes the proof is followed by one full proof run (a new baseline) and a rerun of only the mutants whose catchers it touches.

## 10. Commit and push
No merge of `main` into `cert/full-saas-certification` (owner rule; it overrides CLAUDE.md's "pull origin/main before committing"). Commits, each pushed: (1) the BR-ORDER fix if it lands (product and unit test; before `FIXES['BR-ORDER']` is set); (2) the WP-6 batch, `cert(CERT-3 WP-6): <one line>` (the lists, the evidence checker, this plan, any proof edit and `FIXES`, the results summary); (3) the docs (journal, workflow report, register, moment map: the WP-6 row-159 deviation). Messages end with the attribution line the committing session gives. `mutate-multi.js` lives in `C:\Temp` and is not committed; its four keys are recorded in the journal.

## 11. Journal
`OCTAPM_CERT_JOURNAL.md`, same heading style: the restore; the primary run (passed / failed / known answers by status, exit; the two copies and the sha); the classification table; BR-ORDER's severity and its evidence; Q5's classification; the HEAD mutation batch (per mutant the evidence verdict with its named catchers, collateral and shifts; any FLAGGED entry and how it was classified; the unit results; E6 4/4); the census; the BR-ORDER route if it ran; the WP-2 re-scan if needed; the TEST GAP (L121; M-C14q) and the equivalent (M-DRYq); the reviews; the owner questions (O1-O6); the next exact action (restore `cert3d`, the next WP).

## 12. The WP-6 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register

Add `## WP-6 BOQ, allocations, budgets and cost codes - <CLOSED | IN PROGRESS> (<date>)` after the previous WP, in the WP-0 section's shape. The result column holds `passed/total`, the exit code, and every known answer's ref.

| Rule or item (plan WP-6) | Evidence (final check ids) | Result |
|---|---|---|
| Dry runs write nothing (:797, :803, :1150) | U1.B6.dryRun, U1.B6.writes, U3.B6.dryRunMissingColumns, A5.B6.dryRun; mutation M-DRY (section 6.2), variants M-DRYr, M-DRYs, M-DRYm | |
| BOQ upload, re-upload, roles (:804, :805, :809) | U2.*, U3.B6.uploadMissingColumns, U7.*, KA.U2.omitB005 | HR-C14 owner; Q5 classified |
| The revision lock (:806) | U4.B6.*, U4.live.087SCH.* | |
| AI job, sections, the chunker (:807, :88) | KA.U5.B6X.*, U5.pure.*, U5.stored.087.bill, U5.live.087.rows, KA.U5.087.sections, CF.HRC14 | BLOCKED HR-C14; L121 TEST GAP |
| Allocation capacity and lifecycle (:811-816, :1150) | A1.*, A2.*, A3.B6.coverage, A4.B6.bulk, A5.*, A6.*, KA.A2.resubmitRejected, CF.HRC17; mutation M-CAP (section 6.2), variants M-CAPq, M-CAPa, M-CAPi | BLOCKED HR-C17 |
| Budget lines and costs (:818-819) | B1.*, B2.*, CF.HRC18 | HR-C18 owner |
| Transfers (:820, :1150) | B3.*, KA.B3.overTransfer; mutation M-XFER (section 6.2) | C1-TOL (WP-4) |
| Revisions and the register (:821, :823, :1113) | B4.*, KA.B6.registerOrder, CF.BRorder; M-BR1 if fixed | BR-ORDER: <severity>; Fixed at `<sha>` or registered |
| The Original lock (:822, :1150) | B5.*, KA.B5.afterRepoint, CF.L109; mutation M-ORIG (section 6.2), variants M-ORIG2, M-ORIG4 | L109 P2 |
| Archived lines (:824) | KA.B7.archivedActual, CF.L110, B3.B6.archivedLine | L110 P2 |
| Negative budgets (:833) | CF.L111 | L111 P2 |
| 087-COM build moments (:427) | U5.stored.087.bill, B1.stored.087.original, B1.live.087.* | |
| Confirm-first items (:830-835) | CF.* (`observations.confirmFirst`) | 7 CONFIRMED, CF.HRC14 PARTIAL |
| Known answers | section 5 of this plan | 10 BLOCKED with refs |
| Mutations (E6) | `results\cert3\wp6-mutations\<id>.json`, the unit results, `wp6-mutation-evidence.js` output | 4/4 section 6.2 guards; variants; fix mutations pending; TEST GAP and equivalent named |
| Reviews (E11) | `/code-review`; Codex only if BR-ORDER is fixed | |

Register (`OCTAPM_LAUNCH_BLOCKERS.md`): BR-ORDER with its classification, severity and, if fixed, the sha; L109, L110, L111 (P2 proposed); WP0-BOQ-1 (P3); SCHED-RET-1 (P3, already at `bde300d`); the Q10 leads; L121 as a TEST GAP; HR-C14, HR-C17, HR-C18 as owner questions.

---

## 13. Limitations, TEST GAPs and notes (the lists refer here)

### 13.1 Mutations the live proof cannot catch
- **M-C14q** (HR-C14's quota-only-for-AI change reverted, once HR-C14 lands): its only catcher, KA.U6.nonAiImportAtLimit, was removed by the integration-owner ruling of 2026-10-10 (L121 a TEST GAP). Recorded in `wp6-fix-mutations.boq.json` `notRun[]` and the proof's `TEST_GAPS`.
- **M-DRYq** (the dry run's quota skip removed): equivalent on 087 (assertAiQuota returns before the counter for an unlimited plan, `subscription-gate.js:86-87`); not a write guard. Recorded in `equivalent[]`.
- **The capacity trigger** (`validate_activity_boq_allocation`, migration `20260610090000_decimal_money_values` :138-142): not a code mutant; it is why M-CAP and M-CAPa are caught through the refusal-code checks and G.5xx (a 500, never a success).

### 13.2 No unit catcher
M-DRY, M-DRYr, M-DRYs, M-DRYm (no mocked suite sends a dry run: the boq, allocation and budget suites contain no "dry"), M-CAPi (mapping-import.service has no suite; identifier-shapes.routes.test.js mocks it whole), M-ORIG and M-ORIG2 (no test asserts BUDGET_ORIGINAL_LOCKED; CX21-102 asks the guard with refuse:false and carries no change row). Listed in `wp6-mutations.unit.json` `noUnitCatcher` so nobody looks for one. Adding unit tests is allowed only inside a fix batch, never as a new requirement.

### 13.3 Notes for the integration owner
- **The baseline design (section 7.3)** is the WP-4 L1 ruling applied unchanged. At HEAD the WP-6 proof exits 0, so the WP-3 rule (lists on the final code after a full run exits 0) coincides with it for the HEAD batch: the primary run is the baseline either way.
- **The proof's COLLATERAL table vs the lists.** The lists name exactly the reds the proof's COLLATERAL text names (mutsyntax-wp6.js checks every id it names is listed). The lists add three non-red shifts the table does not mention: CF.L109 CONFIRMED -> PARTIAL under M-ORIG and M-ORIG2, CF.L111 CONFIRMED -> PARTIAL under M-XFER (read off the model; a pass for undecided leads). Adding them to the proof's descriptive table is an optional one-line edit (no check reads the table's text).
- **The fix lists hold no runnable entry** (no WP-6 fix and no fix draft exists); every fix mutant is `pending` with the HEAD loci its fix would change, counted once. The WP-4 HR-C1 shape (from / to with `anchors.head` 0 and a simulated fix copy) applies once a fix plan with edits exists.
- **New list fields** beside WP-4's: `notMutable` (a guard holder that is not code), `notRun` without from / to (a fix mutant with no catcher), `loci[].head` (the count and line at drafting).
- **Runner prefix match.** `--only=<value>` without a comma is a prefix match; the quoted trailing comma (section 7.4) is the exact match; `--lists=` is mandatory.

### 13.4 Book notes (for the book owner, under Claude Main; A10)
- `WP6.mutations.*` already names every catcher by check id (G21) and M-DRYq; nothing to change for the HEAD lists.
- When BR-ORDER, HR-C14 or HR-C17 lands, a `WP6.mutations` leaf for its fix mutation (naming M-BR1 / M-C14x / M-C17 and their catchers) is optional: the proof's G21 guard reads CATCHERS only, and FIX_CATCHERS is checked against CHECKS.

---

## 14. Hazards (read before running)
- `cert3d` must exist with 087-COM and 087-SCH built and their state files present; `mutate-multi.js` cannot pass flags.
- One writer: proofs only through `run-locked.js`; a mutation list with the lock held for the whole invocation; no build, Codex or full jest suite at the same time.
- The runner's CAUGHT is direction only: only `wp6-mutation-evidence.js` against a valid baseline on the same tree counts (section 7.3).
- The WP-6 keys go into `LISTS` only after the four list files exist in `backend/scripts/cert/cert3/`.
- `--only` values quoted with a trailing comma and `--lists=` always given (section 7.4); one id per invocation; the result copied after each, before the next run overwrites it.
- `--lists=wp6fix-boq` runs nothing until a fix entry moves into `mutations[]`.
- After any product or proof commit: `mutsyntax-wp6.js` again, a new full baseline before the next mutant, and A10 re-derivation of any list `expect` the change moves.
- Never amend a fix commit once `FIXES` names it; `S.state` checks the time against git.
- The cert API is never (re)started while a mutant is applied; the proof runs in process and loads the worktree at its start.
- The recorder stub: an outbound request or an unscripted AI call in a window is a setup error, never a verdict; never activate an AI API.
- Each run adds 2 to 087's AI counter (B6X's handler runs): about 30 over WP-6; recorded residue, no limit on 087.
- State files are not in the snapshot: never run a builder after `cert3d` without taking it again.
- Secrets: `CERT_PASSWORD` only through `lib/api.js`; results and logs are scrubbed by the harness; never paste a token or a password into the journal.
