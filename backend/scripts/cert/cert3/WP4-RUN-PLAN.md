# CERT-3 WP-4 run plan (commercial core: change, commitments, IPC, pay applications, cash flow)

Plan `docs/certification/OCTAPM_CERT3_PLAN.md` section 7 step 4 (:1186), for WP-4 (section 4 :671-732), on snapshot `cert3d`.

**Drafted read-only 2026-10-10** (preparation agent; to be adopted, edited and committed by Claude Main) against:
- the committed proof `scripts/cert/cert3/wp4-commercial-proof.js` at `999dc9c`: 150 fixed checks (`EXPECTED_CHECKS`, asserted at load) plus the harness's `G.5xx`; its CHECKS table (:213-371) carries the id, plan line, answer-book key, where each check runs and its section; `FIXES` (:541-545, all empty); `DECIDED_RED` (:570-593, the 11 HR-C1 checks); `CATCHERS` (:638-646); `COLLATERAL` (:647-653);
- the four drafted mutation lists in `C:\Temp\octapm-cert\scratch\wp4\lists\` (section 7.1): `wp4-mutations.commercial.json` (9 mutations + 3 equivalent), `wp4-mutations.unit.json` (7), `wp4-fix-mutations.commercial.json` (8 + 2 unit-only + 3 pending), `wp4-fix-mutations.unit.json` (10 + 2 pending); every `from` counted, every mutant parsed, every id checked by `mutsyntax-wp4.js` (report `mutsyntax-wp4-report.json`, 0 problems; its teeth `teeth-mutsyntax-wp4.js` 11/11);
- the drafted evidence checker `wp4-mutation-evidence.js` (section 7.3; its self-test `selftest-evidence-wp4.js` 25/25 on synthetic results built from the debug result);
- the answer book `answers/commercial.js` after the WP-4 book patch (`a9d64b8`) and the KA.I9 change (`999dc9c`);
- the binding adjudications `C:\Temp\octapm-cert\scratch\wp4\WP4-ADJUDICATION.md` (Q1-Q14; cited WP4ADJ) and `PREP4-ADJUDICATION.md` (sections A and B; cited P4ADJ);
- the HR-C1 fix plan `C:\Temp\octapm-cert\scratch\wp4\fixplan\HRC1-FIX-PLAN.md` (awaiting its Codex plan review; section 9 mutations, simulated fix copies in `work\fix\`);
- the owner's execution rules of 2026-10-10 (section 0).

**State at drafting.** HEAD `999dc9c` on `cert/full-saas-certification`; `backend/src` is identical to `f599e67` (`git log f599e67..HEAD -- backend/src` is empty). `cert3d` is taken by build order run 2 (scheduled 2026-10-11 19:12 CDT, WP4-PREP section 0); WP-1, WP-2 and WP-3 run on it first. The proof was debug-run twice by Claude Main on the partial population of build order run 1 (`C:\Temp\octapm-cert\logs\cert3-wp4-debug-1.log`, `-2.log`: `--skip=D2,D3,CF`, 108 of 150 active; run 2: 100 pass, 8 fail, exactly the HR-C1 checks of those sections, 17 BLOCKED, 0 wrong, 0 5xx, exit 2, 37 s; K and K2 archived, nothing written on the deep projects but the named exceptions; run 1 surfaced WP4-AGG-1). Those runs debugged the proof; they are not WP-4 evidence.

Inputs this plan relies on (all on disk):
- preparation `C:\Temp\octapm-cert\scratch\wp4\WP4-PREP.md` (test map, routes, register rows, fixtures, section 7 mutation candidates, section 9 HR-C1 sketch);
- the answer book (`WP4.*`, `deep.087-COM`, `-B`, `-C`, `deep.052-COM`, `deep.006-LITE`, `claudeMd.retentionDefault`), moment map `build/MOMENT-MAP.md` (087-COM rows 106-165, 052 rows 253-254, 006 rows 272-275; the WP-4 deviations rows 110, 114, 115, 124, 127, 136 recorded in `a9d64b8`);
- the runners `C:\Temp\octapm-cert\run-locked.js` (one proof at a time, `CERT_INPROCESS=1`, no `DATABASE_URL`) and `C:\Temp\octapm-cert\mutate-multi.js` (`--lists=`, `--only=`, `CERT_LOCK_HELD`; the four WP-4 keys are to be added, section 7.1);
- the Codex prompt `C:\Temp\octapm-cert\scratch\wp4\codex-hrc1-plan-review-prompt.txt` (section 8).

---

## 0. Rules that bind every step

**Owner execution rules (2026-10-10, strict one-writer).**
1. **One writer.** Only Claude Main modifies the certification worktree, writes the certification database (:55433) or the cert API (:5190), runs proofs, mutation runs (they edit product files), restores snapshots, runs Codex, commits and pushes. Preparation agents are read only and write only to their scratch folders.
2. **Pipeline.** While Claude Main executes WP-4, read-only agents prepare WP-5. No open-ended defect hunting.
3. **Snapshots.** `cert3d` is the one working CERT-3 baseline: restored before WP-4 (section 2.1), never rebuilt for WP-4. After the HR-C1 migration lands, every later restore re-applies the migration and the backfill (P4ADJ A I-3); no second baseline snapshot.
4. **Reruns.** After a fix, targeted proof sections first (section 6); complete runs only where the plan requires them: the WP-4 primary run (also the HEAD mutation baseline, section 7.3), one full run on the final code (also the post-fix mutation baseline), and the exit run.
5. **Codex** only for the plan's required reviews (section 8): the adversarial plan review and the diff review of the HR-C1 fix, and of CONVERT-ATOMIC / CCO-PARENT if they land. No extra round for P2/P3 or test polish once nothing CRITICAL/HIGH is open.
6. **Long runs** (> 1.5 h) detached under the watchdog. Nothing in WP-4 is that long (the proof runs in about a minute; each mutant in about as long).
7. **Manual UX** never holds WP-4 and never uses :5190 or the cert database while a proof or a mutation list runs.

**Plan rules.** Section 0.0 (no new rounds, matrices or requirements; rerun only invalid cases), section 1.4 (known answers first, A10; checks assert; reproduce before fixing; a fix is followed by a mutation that puts the defect back), section 5's defect-fix list (:1107-1121: the atomic convert :1109 and the commitment-CO parent check :1111 go ahead after reproduction only if they confirm P1; P2/P3 recorded under the scope freeze), section 6.4 gates, section 7 detached-run rules (one writer; a mutation run that stores a defect is cleaned up, then a census). **No HR rule is decided by this plan**: HR-C1 is decided by the owner (plan section 0.1 :49); HR-C2, C3, C4, C12, C13 and the leads stay undecided and their known answers read BLOCKED at `today` with their ref.

---

## 1. Sequence

| # | Step | Who / where | Expected |
|---|---|---|---|
| 0 | Precondition: WP-3 closed (committed, pushed, journalled); `cert3d` exists | Claude Main | the WP-3 row of the workflow report written |
| 1 | Restore `cert3d` (section 2.2), re-apply any migration landed after it (the WP-2 batches, if one carries a migration) | Claude Main | API up on :5190; restore journalled |
| 2 | No-DB checks: `node --check` the proof; the four lists and `wp4-mutation-evidence.js` copied in; the four `LISTS` lines added; `mutsyntax-wp4.js` on the tree (section 7.2) | Claude Main | section 6.2 lists: every anchor once on the tree, every mutant parses; fix lists: 0 at HEAD |
| 3 | **Primary run** of `wp4-commercial-proof.js`, full, no flags, `FIXES` empty (section 2.3); copy the result to `.primary.json` and `.baseline-head.json` | Claude Main, lock held | exit 2, DEFECT_PRESENT: exactly the 11 HR-C1 checks FAIL; 20 known answers BLOCKED; 12 confirm-first CONFIRMED (CF.HRC1 the 13th, red); 0 wrong; 0 5xx (section 5.1) |
| 4 | Classify every failure and every reported known answer (section 3); owner questions | journal, register | table filled; WP4-AGG-1 classified (section 4.3) |
| 5 | **HEAD mutation batch** (section 7): `wp4-commercial` one id per invocation, then `wp4-unit`; the evidence check against the HEAD baseline | Claude Main, lock held | M-VAR0, M-CONV0, M-OPEN, M-CEIL, M-LOCK CAUGHT by their named catchers; variants CAUGHT; unit 7/7 caught by named tests; E6 5/6 (guard 1 waits for the HR-C1 fix) |
| 6 | **HR-C1 fix route** (section 4.1): Codex plan review -> adjudication -> owner Q5 -> book contract leaves -> census -> fix, migration, backfill, unit suites, proof edits -> fix commit -> `FIXES['HR-C1']` set -> deploy sequence on :55433 -> `--only=HRC1` -> full run | Claude Main | targeted green; full run exit 0, 153/153 (section 5.2) |
| 7 | Other confirmed P1 (only if the primary run shows them P1): CONVERT-ATOMIC, CCO-PARENT (section 4.2) | Claude Main | each its own fix route; their mutants move from `pending[]` to `mutations[]` |
| 8 | K15 re-run after the HR-X1 batch, if that batch lands after step 3 (section 6.3) | Claude Main | `--only=E` green on the post-fix code |
| 9 | **Post-fix mutation batch**: `wp4fix-commercial` one id per invocation, `wp4fix-unit`, M-VAR0 again on the final code (its file changed), any landed pending entry; the evidence check against the final baseline | Claude Main, lock held | M-RET family CAUGHT (M-RET-l with exit 1 by design); unit 10/10; E6 6/6 |
| 10 | Regression: the read-only lifecycle verifier (E7) | Claude Main | as at WP-0 |
| 11 | Codex diff review of the HR-C1 product diff (section 8) | Claude Main, one pass per window | nothing CRITICAL or HIGH open |
| 12 | `/code-review` (high) on the WP-4 batch (section 9) | Claude Main | findings adjudicated |
| 13 | Commit and push (section 10) | Claude Main | no merge of `main` |
| 14 | Journal entry (section 11) | Claude Main | figures, table, tallies, restores, census, reviews, next action |
| 15 | The WP-4 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register rows (section 12) | Claude Main | rule -> evidence -> result for every WP-4 rule |
| 16 | Restore `cert3d` before WP-5, re-apply the HR-C1 migration and backfill (P4ADJ A I-3) | Claude Main | WP-5 starts clean |

---

## 2. Restore `cert3d` and the primary run

### 2.1 When to restore
- **Before the primary run.** WP-1..WP-3 leave archived throwaway projects in 087 (W, X, P, V), their mutation residue and WP-1's revision `under_review` on 087-IMP. WP-4 reads 087-COM, 087-COM-B, 087-COM-C, 052-COM and 006-LITE; a restore is cheaper than reasoning about them.
- **Not after any WP-4 HEAD list.** Every mutant writes, if at all, only on the run's throwaway projects K and K2 (archived by the proof's cleanup, which also runs after a section error). On the deep projects every probe stays a read or a refusal before any write under every mutant (each list entry's `safety`), with the proof's three named exceptions: 087-COM-C's one-shot I5 confirmation (consumed by the primary run; every later run takes the re-run branch and judges the record, WP4ADJ Q7), 087-COM's idempotent cost-controller cash-flow rebuild (CF3 / CF5), and nothing else. The census proves it (section 7.7).
- **Not after the HR-C1 fix.** The fix carries a migration and a backfill; they are applied to the running certification database by the deploy sequence (section 4.1 step 9), not by a restore. `cert3d`'s stored moments keep HEAD's answers and are read as STORED-PRE-FIX (section 4.1 step 11).
- **Before WP-5.** WP-4 leaves one archived `CERT3 WP4 Commercial <stamp>` and one `CERT3 WP4 Contract rate <stamp>` project in 087 per proof run (about forty with the targeted, full and mutation runs). The restore is followed by the HR-C1 migration and backfill (P4ADJ A I-3).

### 2.2 How (the build order's own mechanism, `build-cert3d.ps1` :42-80)
From `backend/` with `DATABASE_URL` unset and the proof lock not held (`C:\Temp\octapm-cert\locks\proof.lock` absent):
1. Stop the cert API as `build-cert3d.ps1` does (`Stop-CertApi`: the process on :5190 must be the recorded `api.pid`; never stop another process).
2. `node scripts/cert/snapshot-db.js restore cert3d`
3. Only if a migration landed after `cert3d` was taken (the WP-2 batches; after step 6 the HR-C1 migration too): `node C:\Temp\octapm-cert\migrate-cert.js`, and after the HR-C1 fix the backfill dry run, `--apply` under the owner's Q5 rule, and the client guard (`npm run prisma:generate`), the API down across all of it (HRC1-FIX-PLAN.md s11.4).
4. `powershell -NoProfile -ExecutionPolicy Bypass -File C:\Temp\octapm-cert\start-api.ps1`
5. Record the restore in the journal (time, reason).

Never run a builder after `cert3d` without taking the snapshot again: the state files `C:\Temp\octapm-cert\state\cert3\*.json` are not in the snapshot, and the proof's `S.projects` refuses a state file whose `projectId` differs from the live project (setup error).

### 2.3 The primary run
```
cd <worktree>\backend
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp4-commercial-proof.js
```
- **No flags on `cert3d`.** `--only` / `--skip` / `--project` exist for targeted reruns (section 6) and partial populations. They are never used for the primary run, the final run or a mutation run: `mutate-multi.js` spawns the proof without arguments.
- `CERT_PASSWORD` comes from `backend/.env` through `lib/api.js`; never echoed, copied into this plan, the results or the journal.
- Setup: companies 087, 052, 006 resolved by slug, the personas sign in; the five deep projects by exact name, one live each, matching their state files (S.projects); K created in 087 without `defaultRetentionRate` or `contractValue` with its team and fixture (S.K.create, S.K.fixture); K2 with an explicit 7.5 default (S.K2).
- **Expected console:**
  - `wp4-commercial-proof: 150 of 150 checks active; sections S HRC1 E C I P CASH COM COMB COMC D2 D3 CF; deep projects 087-COM, 087-COM-B, 087-COM-C, 052-COM, 006-LITE; K yes; K2 yes; fixes HR-C1 not set, CONVERT-ATOMIC not set, CCO-PARENT not set; in process`
  - `tally: 139 pass, 11 fail of 150 recorded (150 active); decided-rule RED: HRC1.projectDisplay, HRC1.contractFirstRead, I1.certifyUnconfigured, I1.afterConfiguration, L114.newPeriodItemRate, I2.contractRate, C3.noDefaultNoRate, HRC1.stored.087COM, HRC1.stored.052COM, HRC1.stored.006LITE, CF.HRC1; other failures: none; known answers: 0 value, 20 BLOCKED, 0 STORED-PRE-FIX, 10 fail (0 wrong)`
  - `confirm-first: CF.HRC1 CONFIRMED; CF.HRC2 CONFIRMED; CF.convertAtomic CONFIRMED; CF.HRC12 CONFIRMED; CF.HRC3 CONFIRMED; CF.HRC4 CONFIRMED; CF.CCOparent CONFIRMED; CF.HRC13 CONFIRMED; CF.L108 CONFIRMED; CF.CERT5 CONFIRMED; CF.OVR1 CONFIRMED; CF.DRAFTS1 CONFIRMED; CF.C1TOL CONFIRMED`
  - `PASS  G.5xx  ...` (no unexpected 5xx);
  - cleanup: K2 archived (200, `archivedAt` set), K archived (200); the throwaway check (`0 live`); `deep projects: nothing written but the named exceptions (087-COM-C's one-shot I5, 087-COM's idempotent rebuild); every refusal probe was refused`; no `restorations` (they appear only under a mutant);
  - `wp4-commercial-proof: 140 passed, 11 failed of 151 (fixed); DEFECT_PRESENT, exit 2` and `provisional classification CONFIRMED (11 of 11 defect checks show the reported behaviour)`.
- The tally's `pass` counts PASS, BLOCKED and STORED-PRE-FIX records: the 20 BLOCKED known answers are passes for the harness, counted apart in the known-answer tally. The 10 known-answer fails are the 10 HR-C1 known answers (CF.HRC1 is the 11th red, a confirm-first check).
- Racy readings (section 5.4): a lucky serialisation of K17's five converts or K27's five rebuilds reads `value` on KA.E2.concurrent (and KA.E2.pendingDelta) or KA.CASH.CF4.concurrentRebuilds: `1 value, 19 BLOCKED` (or 2 / 18) and CF.convertAtomic / CF.CERT5 PARTIAL. Still a pass; recorded as a lead, never rerun for a reading (P4ADJ B5).
- Result: `C:\Temp\octapm-cert\results\cert3\wp4-commercial-proof.json` (`checks[]` with `ok`, `kind`, `notRun`; `meta` with `decidedRed`, `fixes`, `catchers`, `collateral`, `filter`, `activeChecks`; `observations.checks` per id with plan line, book key, where, expected, observed, verdict; `observations.knownAnswers`; `observations.confirmFirst`; `observations.decidedRules`; `observations.fixes`; `observations.restorations`; `observations.tally`; `answers.byStatus` and `fiveXX`; `cleanup`). **Copy it at once** to `wp4-commercial-proof.primary.json` and to `wp4-commercial-proof.baseline-head.json` (the HEAD mutation baseline, section 7.3); every later run overwrites the result file. Record `git rev-parse HEAD` and `git status --porcelain backend/src backend/scripts/cert/cert3` with the copy in the journal.
- Exit semantics (harness rule 5, A10): **0** every check holds; **2** a check failed: here the 11 HR-C1 checks of a decided rule, which is the expected answer before the fix (a decided rule's `today` fails, the WP-1 `ka()` rule); **1** setup error (a check not run, a section that threw, an R-SET probe whose own setup failed) - never a product result: fix the proof or the fixture and rerun.
- First full execution: D2 (052-COM and the mixed 087-COM halves), D3 (006-LITE) and CF were filtered out of both debug runs. A red there is read first as a possible proof defect (TEST GAP) before it is classified as a product failure.

---

## 3. Classification table

Every failed check and every reported known answer gets a row. Classification per plan section 0.0 item 4 / section 6.4: CONFIRMED, PARTIAL, REJECTED, EXPECTED BEHAVIOUR, TEST GAP. Severity per section 1.4. Destination: **fixed in WP-4** (section 4.1, 4.2), **owner HR decision** (section 4.4), **register** (P2/P3, recorded under the scope freeze), **proof or book corrected** (TEST GAP, logged with its derivation, A10), **closed** (EXPECTED BEHAVIOUR, rule cited). Severities are WP4ADJ Q9's provisional ones, final after the primary run.

Pre-filled rows ("observed" = the code reading and the debug runs; replaced by the `cert3d` primary run):

| # | Check id(s) | Book key | Observed (HEAD) | Expected (value) | Today + ref | Proposed classification | Severity | Destination |
|---|---|---|---|---|---|---|---|---|
| 1 | the 11 decided-rule checks (section 5.1 part A) | WP4.HRC1.*, WP4.I1.*, WP4.L114.newPeriodItemRate, WP4.I2.retention, WP4.C3.noDefaultNoRate, WP4.HRC1.storedPreFix | an unset default shown as 5; the contract's first read stores 5; an unconfigured certificate settles at 0; the contract rate never reaches items (L114); K2 certified at the project's 7.5; a commitment at a silent 5 | no silent rate; refused until configured; 4,000.00 / 36,000.00 after 10% | today, HR-C1 (decided) | CONFIRMED | P1 | fixed in WP-4 (section 4.1) |
| 2 | KA.E2.concurrent, KA.E2.pendingDelta, KA.E2.midwayOrphans, CF.convertAtomic | WP4.E2.* | five converts make k >= 2 COs; a refusal midway leaves an orphan CO, the event priced | one CO; no orphan | today, CONVERT-ATOMIC | CONFIRMED expected | P1 proposed (duplicate prime COs double pending and, on approval, the revised value) | section 5 defect fix in WP-4 if P1 (section 4.2) |
| 3 | KA.CCO.voidParent, KA.CCO.closedParent, CF.CCOparent | WP4.CCO.* | a CO approved on a void parent (nothing posted) and on a closed parent (committed 6,000.00 after closeout) | refused (409) | today, CCO-PARENT | CONFIRMED expected | P1 for the closed parent, P2 for the void parent | section 5 defect fix in WP-4 if P1 (section 4.2) |
| 4 | KA.E2.pendingDelta's `storedLag` (WP4-AGG-1) | WP4.E2.pendingDelta (today note) | the stored pending total lags the register under concurrent writes (debug run 1: 38,000.00 for 47,500.00) | stored = register | - | suspect, classify at the run (section 4.3) | P2 proposed | register WP4-AGG-1 |
| 5 | KA.I3.limits.A130, KA.I3.patchA130Qty650, CF.HRC2 | WP4.I3.* | the A120-only variation raises A130's limit (650 / 97,500.00); the K13 PATCH to 650 accepted | 600 / 90,000.00; 400 IPC_ALLOCATION_QTY_EXCEEDED | today, HR-C2 | CONFIRMED | P1 proposed (owner's) | owner HR decision; M-VAR1 waits for it |
| 6 | KA.HRC12.secondAccept, KA.HRC12.archivedCoEvent, KA.HRC12.dropsBudgetLines, CF.HRC12 | WP4.HRC12.* | two accepted quotes on one line; an event stuck after its CO is archived; the CO drops the lines' budget line | one quote; back to priced; the line's budget line | today, HR-C12 | CONFIRMED | owner's | owner HR decision |
| 7 | KA.I8.afterReleaseStatus, KA.I11.backToDraft, KA.HRC3.emptyPeriod, CF.HRC3 | WP4.I8.afterReleaseStatus, WP4.I11, WP4.HRC3 | 'paid' one-way; no route back from submitted; an empty period certifies | status follows payment; a route back; refused | today, HR-C3 | CONFIRMED | owner's | owner HR decision |
| 8 | KA.I9.statementVsReceivables, CF.HRC4 | WP4.I9 | statement and receivables disagree by the released retention (9,750.00 on each company) | - (never a value while undecided) | today, HR-C4 | CONFIRMED (recorded) | CERT-5 decides | recorded (integration owner 2026-10-10: BLOCKED, never a value) |
| 9 | CF.HRC13 (E6.deductiveCo, C5.closeWithRetentionHeld pass) | WP4.E6, WP4.C5 | no deductive prime CO; no subcontractor retention release; the close refused with retention held | - | HR-C13 | CONFIRMED (reported) | owner's | owner HR decision |
| 10 | KA.C4.sameLine, CF.L108 | WP4.C4.sameLine | a purchase order's committed on 02-100/material, its actual on 02-100/subcontract | the same line | today, L108 | CONFIRMED | P2 proposed | register |
| 11 | KA.CASH.CF2.advanceInflow, KA.CASH.CF3.deleteSystemRow, KA.CASH.CF4.concurrentRebuilds, CF.CERT5 | WP4.CF2-CF4 | the advance never reaches cash flow; a system row deletable; concurrent rebuilds unserialised | inflow 200,000.00; 409; one set | today, L115 / L120 | CONFIRMED | P2 | recorded, deferred to CERT-5 (plan :732) |
| 12 | KA.CASH.CF3.period13 | WP4.CF3.period2026_13 | month '2026-13' accepted (201) | 400 | today, CF-PERIOD | CONFIRMED expected | P3 proposed | register WP4-CF-1 when confirmed (WP4ADJ Q13) |
| 13 | KA.P4.payOverNet, CF.C1TOL | WP4.P4.payOverNet | 45,000.01 accepted against a net of 45,000.00 (tolerance 0.01) | refused | today, C1-TOL | CONFIRMED | P3 proposed | register (WP4ADJ Q12) |
| 14 | CF.OVR1 | WP4.OVR1.* | IPC-09 (nothing on A130) needs a PM override; finance cannot certify | - | WP4-OVR-1 | CONFIRMED (reported) | P2 (register :290) | recorded |
| 15 | CF.DRAFTS1 | WP4.DRAFTS1.* | two drafts each within earned both PATCH; the certify gate refuses the second | - | WP4-DRAFTS-1 | CONFIRMED (reported) | P3 | EXPECTED BEHAVIOUR proposed (the gate is the control) |
| 16 | I12.pmPayment (pass) | WP4.I12.pmRecordsPayment | the PM's client payment refused 403 (finance only) | as HEAD | L211, HR-A3 | - | - | owner question (WP4ADJ Q14) |
| 17 | L114.routeBound (pass) | WP4.L114.routeBound | `retentionRate 150` refused 400 (route max 100) | - | - | L114 part 2 REJECTED | - | closed (folded into HR-C1, plan :726) |
| 18 | Debug runs 1-2 (partial population) | - | 8-9 HR-C1 fails, 15-17 BLOCKED; run 1 the WP4-AGG-1 lag | - | - | not evidence | - | journal |

---

## 4. What WP-4 fixes, and what waits for the owner

### 4.1 The HR-C1 fix route (decided, P1; plan section 0.1 :49, :90, :726; HRC1-FIX-PLAN.md s13)
1. **Reproduction.** The primary run (section 2.3) is the reproduction: the 11 decided-rule checks red, harness CONFIRMED 11/11; the live and fresh ones on K and K2 (HRC1.projectDisplay, HRC1.contractFirstRead, I1.certifyUnconfigured, I1.afterConfiguration, L114.newPeriodItemRate, I2.contractRate, C3.noDefaultNoRate) and CF.HRC1 are the in-proof evidence.
2. **Codex adversarial plan review** of `HRC1-FIX-PLAN.md` (plan section 6.4; prompt `scratch\wp4\codex-hrc1-plan-review-prompt.txt`; output `scratch\wp4\codex-hrc1-plan-review.md`; adjudication `scratch\wp4\codex-hrc1-plan-review-adjudication.md`, every finding CONFIRMED / PARTIAL / REJECTED / EXPECTED BEHAVIOUR / TEST GAP). The integration owner's I-1..I-4 go in as decided (P4ADJ A: P-11b adopted, HRC1.contractShapes adopted, re-apply after every restore, P-2 kept); Codex may challenge any. The next free Codex window after the L34 review, unless WP-2 needs a round 3 first. Rounds stop when nothing CRITICAL/HIGH is open; at most 3.
3. **Owner.** Q5 (which existing contracts and lines count as configured; Q5-a proposed) before the deploy; O-2, O-3, Q10 (CLAUDE.md "Retention default 5%", the owner's file) and Q3 (the commitment create-time refusal) in the consolidated decision list.
4. **Book.** The eight `WP4.HRC1.contract.*` leaves get their adjudicated values with A10 derivations (fix plan s16); the book's load check that the value equals `HR_C1_PENDING` is replaced. `WP4.mutations.retentionDefaultGuard` names the new catchers (I1.submitUnconfigured for M-RET-s, I1.afterConfiguration for M-RET-r, HRC1.contractShapes for M-RET-o, HRC1.projectDisplay for M-RET-p): the proof's load guard G23 (:655-660) refuses a CATCHERS id the book's WP4.mutations text does not name.
5. **Census** on :55433 (fix plan s11.3; read only, before the fix).
6. **Fix** per the adjudicated plan (schema and migration, backfill script, four services, two routes, OpenAPI, web, four unit suites). Unit suites green on a quiet machine, never beside a proof, build or Codex (fix plan s7 command, from `backend/`).
7. **Proof edits in the same batch** (they land with the fix commit, P4ADJ A I-1, I-2): `I1.submitUnconfigured` and `HRC1.contractShapes` (`EXPECTED_CHECKS` 150 -> 152, the move journalled); the K5-K10 texts for P-11b (fix plan s8.2); **R-SET recording** of the K5 / K7 / K9 answers so the HRC1 section goes on under a mutant (section 13.3); `CATCHERS` gains `M-RET-s`, `M-RET-r`, `M-RET-o`, `M-RET-p` (the lists' catchers, `wp4-fix-mutations.commercial.json` `catchersTableNote`); `STORED_UNITS` updated with the builder edits (P4ADJ B9).
8. **Fix commit** (`fix(CERT-3 WP-4): no silent retention rate (HR-C1, L114)`), so the fix has a commit time. Never amend it afterwards: `FIXES['HR-C1']` names its sha. A later Codex or code-review follow-up is a new commit.
9. **Deploy on :55433** (fix plan s11.4): stop the API -> `migrate-cert.js` -> the backfill dry run, the owner's Q5 rule confirmed -> `--apply` -> `npm run prisma:generate` through the guard (never `prisma generate` in a junctioned worktree) -> start the API. The API stays down across the migration and the backfill (R-2). The proofs run in process and load the worktree at their start; never restart the API while a proof or a mutant runs.
10. **Set `FIXES['HR-C1']`** in the proof (:542) to `{ commit: '<sha>', committedAt: '<git show -s --format=%cI <sha>>' }`. `S.state` checks it against git (a mismatch is a setup error).
11. **STORED-PRE-FIX reading** (WP4ADJ Q4; `WP4.HRC1.storedPreFix`): the three stored HR-C1 checks (087-COM, 052-COM, 006-LITE moments built on `cert3d` before the fix commit) whose observation shows exactly the leaves' `today` read STORED-PRE-FIX: a pass, counted apart, reported with the register link HR-C1. Every read on K and K2 is strict. The exit run's rebuild (plan section 7 step 5) judges every moment on the fixed code with the builders of fix plan s10.
12. **Targeted sections** (section 6.2), then **one full run** (section 6.4: the WP-4 result and the post-fix mutation baseline).
13. **Regression:** the read-only lifecycle verifier `node scripts/cert/cert3/lifecycle-posthoc-verifier.js` (E7; the phase21 lifecycle names every rate explicitly, fix plan s10).
14. **Mutations** (section 7), **Codex diff review** (section 8), **`/code-review`** (section 9), commit and push (section 10), journal and register (HR-C1 -> Fixed at `<sha>`; L114 part 1 fixed, part 2 REJECTED); builders changed (fix plan s10) and judged at the exit rebuild.

### 4.2 Defect fixes only if the primary run confirms P1
- **CONVERT-ATOMIC** (section 5 :1109; L199): the deterministic reproduction is KA.E2.midwayOrphans (one orphan prime CO per attempt, the event left priced); KA.E2.concurrent is racy. If it confirms P1 (duplicate prime COs reach the pending and, on approval, the revised contract value): a read-only fix plan (as HR-C1's), the Codex plan review (financial figures: high risk), the fix and its commit, `FIXES['CONVERT-ATOMIC']` and `CONTRACT['CONVERT-ATOMIC'].midwayRollback` from the adjudicated plan, `--only=E` then a full run, then **M-CONV1** derived from the fix diff (moved from `pending[]` into `mutations[]` of `wp4-fix-mutations.commercial.json`; it supersedes M-CONV0 as the convert-lock E6 entry), its unit side, the Codex diff review. If the fix rewrites the :804 check, M-CONV0 no longer applies (NOT APPLIED) and is retired with a journal note.
- **CCO-PARENT** (section 5 :1111): KA.CCO.closedParent is the P1 evidence (committed rises after closeout), KA.CCO.voidParent P2. If P1: the same route with `FIXES['CCO-PARENT']` and `CONTRACT['CCO-PARENT'].refusalStatusCode`, `--only=C` then a full run, then **CCO-M1** (a fix mutation, plan section 1.4; not an E6 entry) from the fix diff. The fix edits `commitment.service.js`, which the HR-C1 fix also edits: land them one after the other and re-run `mutsyntax-wp4.js` (fix plan R-12).
- Either fix, once landed, turns its KA checks into defect checks (`DECIDED_RED` extends itself when `FIXES` is set): their `today` then fails.
- Any `wrong` known answer is a failure to classify on paper first (A10): a product change since the book, a proof bug or a wrong derivation.

### 4.3 WP4-AGG-1 (suspect, P2 proposed; register `OCTAPM_LAUNCH_BLOCKERS.md` :297)
Classified at the primary run from KA.E2.pendingDelta's observation (`storedLag`: the stored `pendingChangesValue` short of the register's delta). CONFIRMED if the lag is seen; otherwise PARTIAL (the code reading stands: `recomputeChangeValues`, `prime-contract.service.js:284-309`, sums and writes outside any lock). Not on the section 5 defect-fix list: recorded under the scope freeze. P1 only if the run shows a wrong total that persists after the writes settle (approved or revised value), which plan section 0.0 rule 4 then routes. The CONVERT-ATOMIC fix, if it lands, removes the concurrent recomputes of converts only; concurrent approvals keep the exposure (the register row says so).

### 4.4 Waits for an owner decision (no change before it)

| Row | What WP-4 observes | Today | Recommendation |
|---|---|---|---|
| HR-C2 | KA.I3.limits.A130, KA.I3.patchA130Qty650, CF.HRC2 | the variation leaks to sibling allocations of the BOQ item | only the linked allocation (P1 proposed); then M-VAR1 |
| HR-C3 | KA.I8.afterReleaseStatus, KA.I11.backToDraft, KA.HRC3.emptyPeriod, CF.HRC3 | 'paid' one-way; no route back; empty periods certify | status follows payment; a route back; refuse empty |
| HR-C4 | KA.I9.statementVsReceivables, CF.HRC4 | the two 'invoiced' figures disagree | CERT-5 decides, CERT-3 records |
| HR-C12 | KA.HRC12.*, CF.HRC12 | two accepted quotes; a stuck event; no budget line on the CO | one quote per line; back to priced; carry the line |
| HR-C13 | CF.HRC13, E6.deductiveCo, C5.closeWithRetentionHeld | no deductive CO; no sub retention release | the owner's call |
| HR-A3 (L211) | I12.pmPayment | client payments are finance's | the owner's call (WP4ADJ Q14) |
| Q5, O-2, O-3, Q10, Q3 (HR-C1) | the fix's data rule and its visible choices | - | fix plan s15 |

---

## 5. Known answers and where each check runs

### 5.1 What the primary run WILL report (before the fix; so nobody mistakes them for new failures)

**Part A, the 11 decided-rule checks (FAIL, exit 2, DEFECT_PRESENT):**

| Check id | Where | Observed `today` | Value |
|---|---|---|---|
| HRC1.projectDisplay | fresh K (K5) | defaultRetentionRate 5 | no rate shown for an unset default |
| HRC1.contractFirstRead | fresh K (K5) | retentionRate 5, no source | no silent rate stored |
| I1.certifyUnconfigured | fresh K (K7) | 200 certified at item rate 0, 0.00 / 40,000.00 | refused 4xx, nothing settled |
| I1.afterConfiguration | fresh K (K10) | 409 IPC_INVALID_CERTIFICATION_STATE (settled at 0 at K7) | certified 4,000.00 / 36,000.00 |
| L114.newPeriodItemRate | fresh K (K11) | 0 | 10 |
| I2.contractRate | fresh K2 | 3,000.00 / 37,000.00 (project 7.5) | 4,000.00 / 36,000.00 (contract 10) |
| C3.noDefaultNoRate | fresh K (K8) | 201 at 5 | refused 4xx |
| HRC1.stored.087COM | stored 087-COM | project 5, contract 5, items 0 (BLOCKED step) | no silent rate |
| HRC1.stored.052COM | stored 052-COM | the same, in USD | the same |
| HRC1.stored.006LITE | stored 006-LITE | project 5, contract 5, items 0, no refusal | the refusal first |
| CF.HRC1 | fresh K, K2 | CONFIRMED | REJECTED |

**Part B, the 20 known answers BLOCKED (undecided; never exit 2):** KA.E2.concurrent, KA.E2.pendingDelta, KA.E2.midwayOrphans (CONVERT-ATOMIC; the first two racy), KA.HRC12.secondAccept, KA.HRC12.archivedCoEvent, KA.HRC12.dropsBudgetLines (HR-C12), KA.CCO.voidParent, KA.CCO.closedParent (CCO-PARENT), KA.C4.sameLine (L108), KA.I3.limits.A130, KA.I3.patchA130Qty650 (HR-C2), KA.I8.afterReleaseStatus, KA.I11.backToDraft, KA.HRC3.emptyPeriod (HR-C3), KA.P4.payOverNet (C1-TOL), KA.CASH.CF2.advanceInflow (L115), KA.CASH.CF3.period13 (CF-PERIOD), KA.CASH.CF3.deleteSystemRow, KA.CASH.CF4.concurrentRebuilds (L120; racy), KA.I9.statementVsReceivables (HR-C4; BLOCKED on HEAD's 9,750.00 disagreement, never a value).

**Part C, confirm-first reported (CONFIRMED expected, a pass):** CF.HRC2, CF.convertAtomic, CF.HRC12, CF.HRC3, CF.HRC4, CF.CCOparent, CF.HRC13, CF.L108, CF.CERT5, CF.OVR1, CF.DRAFTS1, CF.C1TOL (12).

### 5.2 What the final run reports (after the HR-C1 fix, `FIXES['HR-C1']` set, 152 checks)
- `tally: 152 pass, 0 fail of 152 recorded (152 active); decided-rule RED: none; other failures: none; known answers: 7 value (8 if the fix commit makes I1.submitUnconfigured a known answer), 20 BLOCKED, 3 STORED-PRE-FIX, 0 fail (0 wrong)`; `confirm-first: CF.HRC1 REJECTED;` then the twelve as in section 2.3; `wp4-commercial-proof: 153 passed, 0 failed of 153 (fixed); PASS, exit 0`; harness REJECTED.
- **value (7):** HRC1.projectDisplay, HRC1.contractFirstRead, I1.certifyUnconfigured (409 IPC_RETENTION_NOT_CONFIGURED, the adjudicated code), I1.afterConfiguration (4,000.00 / 36,000.00), L114.newPeriodItemRate (10), I2.contractRate (4,000.00 / 36,000.00), C3.noDefaultNoRate (400 COMMITMENT_RETENTION_REQUIRED, if adopted); plus I1.submitUnconfigured and HRC1.contractShapes green; CF.HRC1 REJECTED.
- **STORED-PRE-FIX (3):** HRC1.stored.087COM, .052COM, .006LITE (section 4.1 step 11).
- **Stay green (regression):** I1.explicitNoRetention (now discriminating), L114.routeBound, C3.projectDefault, K.IPC.D, every stored check, every refusal probe. CF.OVR1 and I6.qsCertify depend on the backfill having run on :55433 (fix plan s8.1): without it IPC-09's PM certify answers the new 409 first. CONVERT-ATOMIC / CCO-PARENT checks move only if their fixes land (section 4.2).

### 5.3 Where each check runs (the proof's where-table)

| Where | Checks |
|---|---|
| **K** (throwaway of 087, created without retention and archived by each run; WP4ADJ Q1) | S.K.create, S.K.fixture, S.K.archived; every writing check and every section 6.2 catcher: HRC1 (K5-K12), E (K14-K19), C (K18, K20-K21), I (K12-K13, K25-K26), P (K22-K24), CASH (K27) |
| **K2** (second throwaway, project 7.5 explicit, contract 10; WP4ADJ Q11) | S.K2, I2.contractRate |
| **087-COM live** (writes nothing at HEAD but the idempotent rebuild) | E1.patchConverted / voidConverted / voidWithoutReason / deleteWithRfqs, E4.split, E5.*, RFI.convertTwice, C1.voidExecuted, KA.C4.sameLine, C4.actualPosted, I4.paymentBeforeInvoice, I6.*, I7.*, I10.live, KA.I11.backToDraft, I12.pmPayment, IPC.itemsFromAllocations, P3.*, P6.live, P7.rejectWithoutReason, CASH.CF1.live, KA.CASH.CF2, CASH.CF3.manualSurvivesRebuild, CASH.CF5.* |
| **087-COM stored** | HRC1.stored.087COM, E1.stored, E5.stored, RFI.stored, I6.stored, I7.stored, P6.stored, CASH.CF1.stored, and the stored halves of the D2 mixed checks |
| **087-COM-B** (read only) | C3.projectDefault |
| **087-COM-C** (the one-shot I5, WP4ADJ Q7) | I5.stored, I5.gateLive, I5.afterValueEntered |
| **052-COM** (reads and pre-write refusals) | I3.limits.A120 (M-VAR0's catcher), KA.I3.limits.A130, I4.*, D2.*, HRC1.stored.052COM, C2.live, I8.*, KA.I9, P3.ledger.052, P4.revokeAfterPayment, P4.cashOutflowWithoutRebuild |
| **006-LITE** | HRC1.stored.006LITE, D3.stored.ipc, D3.live.ipc, D3.certifierRole |
| **static** | the scans behind CF.convertAtomic, CF.HRC2, CF.CCOparent, CF.HRC3, CF.HRC13, KA.I11.backToDraft |
| **setup** | S.book, S.state, S.projects |

### 5.4 Reading notes
- **Races.** KA.E2.concurrent / pendingDelta (K17) and KA.CASH.CF4.concurrentRebuilds (K27) are races: today was observed 5 of 5 in both debug runs; a lucky serialisation reads `value` (a pass, a lead). No repetition loop (P4ADJ B5); KA.E2.midwayOrphans carries the deterministic reproduction. The evidence checker treats their status shifts between two runs as racy, never as a flag (section 7.3).
- **WP4-AGG-1** shows as `storedLag: true` in KA.E2.pendingDelta's observation; the check accepts a stored delta of j x 9,500.00 with 1 <= j <= k and records the lag.
- **087-COM-C's I5 is one-shot.** The first run on a restored `cert3d` (the primary run) consumes the confirmation and certifies IPC-01; every later run judges the record (WP4.I5.rerunRule). Both pass; a run on a fresh restore takes the first branch again.
- **Restorations.** Under M-OPEN / M-OPENa / M-OPENb the extra or reopened application on K is voided at once and a `LEAD  K restoration ...` line printed (`observations.restorations`); the unmutated runs print none.
- **Throwaway accumulation.** One archived K and one archived K2 per run; the cleanup's throwaway check must say 0 live. 087 is on the enterprise plan; archived projects never count against a limit.

---

## 6. Targeted proofs, targeted reruns, the final full run

### 6.1 Before the fix
Nothing beyond the primary run (it is the reproduction). A proof defect found in it (a TEST GAP) is fixed in the proof and re-run with the narrowest `--only` that covers it; then the HEAD baseline must be retaken as a full run on the changed proof before any mutant runs (section 7.3).

### 6.2 Targeted sections after the HR-C1 fix (`FIXES['HR-C1']` set)
```
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp4-commercial-proof.js --only=HRC1
```
Expected: S 7 + HRC1 9 + the two new checks (if the fix commit puts them in HRC1) active; the K choreography runs whole (its steps depend on each other); K2 runs; every HRC1 check PASS; exit 0. Then `--only=COM,D2,D3` for the three stored checks (STORED-PRE-FIX) and the live 087-COM reads that depend on the backfill (CF.OVR1 is in CF: `--only=CF` selects its sources too). A failure here goes back to the fix (three iterations, then escalate).

### 6.3 The K15 re-run after the HR-X1 batch (P4ADJ B7; a recorded dependency of the WP-2 run plan)
The HR-X1 batch (WP-2) changes change-order evidence (`change-order.service.js` `assertApprovalProof`, HRX1-FIX-PLAN.r2 s4.9), which K15's E3 probes and K14's approval cross. If the batch lands **after** the WP-4 primary run:
```
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp4-commercial-proof.js --only=E
```
Expected: every E check green on the post-fix code (K15's E3.submitWithoutSummaries / submitWithoutDocument take their document handling from the landed batch; XDOC-1's scope rule accepts K's own uploads). Then `mutsyntax-wp4.js` (the M-LOCK anchors are in that file; the batch replaces `assertApprovalProof` :494-559, next to but not over the lock at :465-483) and, if M-LOCK, M-LOCKa or M-LOCKb already ran, one full unmutated run on the post-batch tree as their new baseline (`wp4-commercial-proof.baseline-hrx1.json`) and the three re-run into `wp4-mutations-hrx1\`, judged with `--ids=M-LOCK,M-LOCKa,M-LOCKb --baseline=<that file>` (sections 7.4, 7.6). If the batch lands **before** the primary run, nothing extra: the primary run covers it.

### 6.4 The final full run
One full run on the final code (every landed WP-4 fix, its `FIXES` set), no flags (section 2.3 command): the expected answer is section 5.2. Its result is the WP-4 result recorded in the report and the post-fix mutation baseline: copy it to `wp4-commercial-proof.final.json` and `wp4-commercial-proof.baseline.json`, with `git rev-parse HEAD` in the journal. If a later product or proof change follows (a Codex or code-review finding), run it again and re-run only the mutants whose catchers or anchors that change touches (owner rule 4).

---

## 7. Mutation runs

### 7.1 Lists and runner keys
Claude Main copies `wp4-mutations.commercial.json`, `wp4-mutations.unit.json`, `wp4-fix-mutations.commercial.json`, `wp4-fix-mutations.unit.json` and `wp4-mutation-evidence.js` from `C:\Temp\octapm-cert\scratch\wp4\lists\` into `backend/scripts/cert/cert3/`, and **then** (never before the files exist: the runner reads every registered list on every invocation, P4ADJ B11) adds four keys to `LISTS` in `C:\Temp\octapm-cert\mutate-multi.js`, before `'unit-tests'`:
```js
  // WP-4 (WP4-RUN-PLAN.md section 7): the section 6.2 guards runnable at HEAD; judged by wp4-mutation-evidence.js against a baseline, never by the exit code.
  'wp4-commercial': ['scripts/cert/cert3/wp4-commercial-proof.js', true, 'wp4-mutations.commercial.json'],
  'wp4-unit': [null, false, 'wp4-mutations.unit.json'],
  // WP-4 fixes (HR-C1; CONVERT-ATOMIC and CCO-PARENT when they land): the defect put back (anchors exist only on the fix tree).
  'wp4fix-commercial': ['scripts/cert/cert3/wp4-commercial-proof.js', true, 'wp4-fix-mutations.commercial.json'],
  'wp4fix-unit': [null, false, 'wp4-fix-mutations.unit.json'],
```
`mutsyntax-wp4.js` stays in the scratch folder (as `mutsyntax-wp3.js`). Ids: every `catchers`, `collateral`, `shifts[].id` and `unchanged` id, and every check id an `expect` names, is a CHECKS id (or, in the fix lists, one of the two `pendingCheckIds` the HR-C1 fix commit adds); the section 6.2 catchers equal the proof's CATCHERS table; no WP-4 id is used by another registered list (`mutsyntax-wp4-report.json`). The equivalent mutants (M-CEILa, M-CEILb, M-VAReq-alloc), the unit-only fix mutants (M-RET-w, M-RET-n) and the pending ones (M-VAR1, M-CONV1, CCO-M1) are recorded in their lists (`equivalent`, `notRun`, `pending`) and never run by the runner (it reads `mutations` only).

### 7.2 Mutant syntax (no DB, no lock)
- At drafting (`node C:\Temp\octapm-cert\scratch\wp4\lists\mutsyntax-wp4.js`): on HEAD `999dc9c` and on HEAD with the simulated HR-C1 fix copies overlaid, every section 6.2 and HEAD unit anchor occurs once and every mutant parses (M-VAR0's line moves 187 -> 252 under the fix, the others stay); every fix-list anchor occurs 0 times at HEAD and once on the simulated fix copy, and parses there; the pending entries' loci occur once at HEAD; 0 problems. Its teeth (`teeth-mutsyntax-wp4.js`): 11 kinds of break all reported. Copies in `lists\mutsyntax\`.
- **On the day**, before the HEAD batch: `node mutsyntax-wp4.js` again (the tree may have moved: a WP-2 batch). **After the real HR-C1 fix:** re-derive the fix lists' `from` / `to` on the real fix diff (the reviewed fix may differ from the simulation), then `node mutsyntax-wp4.js --post-fix` (every list, the fix lists included, must apply once on the fixed worktree and parse; the CHECKS count must read 152). An anchor found 0 or 2+ times is NOT APPLIED by the runner; a mutant that does not parse would be "caught" by a crash and proves nothing.

### 7.3 Runner and baseline: how a mutant is judged (the decision this plan makes)
**The problem.** `mutate-multi.js` scores any non-zero exit CAUGHT. At HEAD the unmutated proof already exits 2 on the 11 decided HR-C1 reds, so every mutant would read CAUGHT whatever it does: the exit code proves nothing. WP-3 solved the same problem by running its lists only on the final code (WP3-RUN-PLAN.md section 7.3). For WP-4 that would hold the five HEAD-runnable section 6.2 guards (variation scope, the convert lock, one open pay application, the payment ceiling, the approved-CO lock), none of which touches retention, behind a fix that still needs a Codex plan review, an owner answer (Q5), a migration and a backfill.

**The decision.** Every proof-backed mutant is judged by `wp4-mutation-evidence.js` on its **named catchers flipping from PASS in a baseline result to FAIL under the mutant, on the same tree**, never by the exit code. So the HEAD-runnable mutants run right after the primary run, before the HR-C1 fix.

**Why it is sound.**
1. Every HEAD catcher (I3.limits.A120, K.E1.convertAgain, P1.secondOpen, P1.reopenWhileOpen, P4.payOverNetPlus2, E3.patchApproved, E3.archiveApproved) is a check that PASSES at HEAD and none is an HR-C1 check; the checker refuses a catcher that is not PASS in the baseline (and, for a known answer, not at its value: BLOCKED or STORED-PRE-FIX is not PASS) - so a decided red can never stand in for a catch (self-test: M-RET judged on the HEAD baseline reads NO EVIDENCE).
2. The baseline's own reds (`meta.decidedRed`, the 11 HR-C1 checks at HEAD) are FAIL in both runs and excluded from "unexpected"; one of them turning green under a mutant is flagged, because it would mean the mutant reached retention.
3. "Not run" is never evidence: a catcher left unrecorded by a section error reads NO EVIDENCE; a run that ends in exit 1 still counts when its catchers ran and failed (the WP-1 C1 / I1 precedent).
4. Every other red under the mutant must be named collateral with its derivation in the list (`collateralWhy`), else the entry is CAUGHT, FLAGGED: not evidence until Claude Main classifies it (names it with a derivation, or fixes the proof) and re-runs the checker. Non-red status changes (a known answer BLOCKED -> PASS, a classification CONFIRMED -> PARTIAL) are reported as named (`shifts`), racy, or unnamed (a note).
5. The baseline must be a clean comparator: a full run (no filter), no setup error, G.5xx green, and every FAIL in it a decided red (or named with `--accept-baseline-red=<ids>`, after it is classified in the journal); otherwise it is VOID and so is every mutant judged on it. Each mutant result must carry the same `FIXES`, the same answer book and the same check ids as its baseline and start after the baseline finished (else NO EVIDENCE: mismatched or stale).
6. What the result files cannot prove (that no product file changed between the baseline and the mutant) is a procedural rule: no product or proof commit between the baseline and the mutants of a batch; `git rev-parse HEAD` and `git status --porcelain backend/src backend/scripts/cert/cert3` recorded at the baseline and at each invocation; after any such commit, a new full baseline before the next mutant.

**The baseline files** (the checker's defaults):
- **HEAD lists** (`--lists=commercial`): `C:\Temp\octapm-cert\results\cert3\wp4-commercial-proof.baseline-head.json` = the primary run's copy (section 2.3), as long as nothing changed since; otherwise one unmutated full run on the current tree, copied there. The primary run is a valid baseline for the mutants that follow it: each run makes its own K and K2; the deep projects differ only by the named exceptions, whose checks pass on either branch (I5's one-shot then its re-run rule; the idempotent 087-COM rebuild).
- **Fix lists** (`--lists=fix`): `C:\Temp\octapm-cert\results\cert3\wp4-commercial-proof.baseline.json` = the final full run on the fixed code (section 6.4; exit 0, `FIXES['HR-C1']` set).

**Verdicts** (per entry; the checker's header carries the same text):
- **CAUGHT**: every named catcher PASS in the baseline and FAIL (ran) under the mutant; every other red is named collateral or a baseline red; no baseline red turned green. A racy catcher (`racy[]`, M-CONV1 only) that did not flip is reported, not failed, when every deterministic catcher flipped.
- **CAUGHT, FLAGGED**: the catchers flipped, but an unnamed red appeared or a baseline red turned green. Not counted until classified.
- **SURVIVED**: every named catcher ran and is still PASS under the mutant. A guard with no live teeth: a TEST GAP, or a wrong list.
- **NO EVIDENCE**: no result file; a VOID or mismatched baseline; a stale result; a catcher not PASS in the baseline; a catcher not run or missing under the mutant; only some catchers flipped.

The runner's own column (CAUGHT for exit 2) is ignored at HEAD; after the fix it agrees with the checker only in direction.

### 7.4 Running: one mutant per invocation, the result copied after each
Never while a build, another proof, Codex or the full jest suite runs. One command line each. **Quote the id and end it with a comma, and always name the list**: `mutate-multi.js` treats a value without a comma as a name *prefix* (`--only=M-OPEN` would also run M-OPENa and M-OPENb; `--only=M-LOCK` M-LOCKa and M-LOCKb; `--only=M-RET` every M-RET-x), PowerShell drops an unquoted trailing comma, and ids such as M1 or G1 repeat across other lists.
```
cd <worktree>\backend
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp4-mutations.M-VAR0.json --lists=wp4-commercial "--only=M-VAR0,"; Remove-Item Env:CERT_LOCK_HELD
New-Item -ItemType Directory -Force C:\Temp\octapm-cert\results\cert3\wp4-mutations | Out-Null; Copy-Item C:\Temp\octapm-cert\results\cert3\wp4-commercial-proof.json C:\Temp\octapm-cert\results\cert3\wp4-mutations\M-VAR0.json
```
**HEAD batch** (after the primary run and its classification, the HEAD baseline in place): M-VAR0, M-CONV0, M-OPEN, M-OPENa, M-OPENb, M-CEIL, M-LOCK, M-LOCKa, M-LOCKb (`--lists=wp4-commercial`), each followed by its copy. Then the unit side: first the unmutated suites must pass (a red suite would score every unit mutant CAUGHT):
```
npx jest src/services/__tests__/ipc-allocation-impact.test.js src/services/__tests__/change-event.service.test.js src/services/__tests__/sub-pay-app.service.test.js
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp4-mutations.unit.json --lists=wp4-unit; Remove-Item Env:CERT_LOCK_HELD
node scripts/cert/cert3/wp4-mutation-evidence.js --lists=commercial --unit-results=C:\Temp\octapm-cert\results\cert3\wp4-mutations.unit.json
```
The checker prints the baseline's validity, then per entry the verdict, each catcher's baseline -> mutant status, the collateral and which of it went red, any unexpected red, any baseline red turned green, the shifts (named / racy / unnamed), the notes (setup error after the catch), the known-answer tally, the restorations and the 5xx count; then `E6 (section 6.2 WP-4 guards): n/6` and the unit verdicts (`CAUGHT BY NAMED TESTS`: every title in the entry's `tests` in a jest failure line). Expected at HEAD: 9 CAUGHT, unit 7/7, `E6 ... 5/6` (guard 1, retention default, has no judged entry until the fix). Exit 0 when every judged entry is as its list expects. (Dry run at drafting on the debug result as its own baseline: `NO EVIDENCE: baseline VOID: not a full run`, as designed.)

**Post-fix batch** (after section 6.4, the final baseline in place; re-derive and `mutsyntax-wp4.js --post-fix` first): M-RET, M-RET-s, M-RET-l, M-RET-r, M-RET-o, M-RET-c, M-RET-d, M-RET-p (`--lists=wp4fix-commercial`), each copied to `wp4-mutations\<id>.json`; any pending entry whose fix landed and was moved into `mutations[]` (M-CONV1, CCO-M1; M-VAR1 after HR-C2), likewise. M-VAR0 again on the final code (`--lists=wp4-commercial "--only=M-VAR0,"`: its file, `ipc.service.js`, changed with the fix; section 7.6), its result copied to its **own directory** `results\cert3\wp4-mutations-final\M-VAR0.json` so the HEAD batch's results stay as they were. Then the unmutated fix-tree suites (fix plan s7 command), the `wp4fix-unit` list in one invocation, and:
```
node scripts/cert/cert3/wp4-mutation-evidence.js --lists=fix --unit-results=C:\Temp\octapm-cert\results\cert3\wp4-fix-mutations.unit.json
node scripts/cert/cert3/wp4-mutation-evidence.js C:\Temp\octapm-cert\results\cert3\wp4-mutations-final --lists=commercial --ids=M-VAR0 --baseline=C:\Temp\octapm-cert\results\cert3\wp4-commercial-proof.baseline.json
```
`--ids` judges only the named entries (exact ids) and prints `E6 (... judged here for --ids=M-VAR0)`. The WP-4 E6 tally for the report is the union of the three checker runs: guard 1 from the fix-list run, guard 2 from the `--ids=M-VAR0` run on the final code, guards 3-6 from the HEAD batch (or from their re-runs, section 7.6). Any later re-run of a HEAD entry against a newer baseline (the M-LOCK family after a late HR-X1 landing, section 6.3) follows the same pattern: its own directory `wp4-mutations-<tag>\`, `--ids=<its ids>`, that baseline. About 9 + 9 proof runs of about a minute each.

### 7.5 Expected per mutant (the lists carry the derivations)

| Id | Runner | Exit | Named catchers (PASS -> FAIL) | Expected collateral (FAIL) | Shifts (not red) |
|---|---|---|---|---|---|
| M-VAR0 | CAUGHT | 2 | I3.limits.A120 (052-COM A120 limit 200 / 30,000.00 for 250 / 37,500.00) | none | KA.I3.limits.A130 and KA.I3.patchA130Qty650 BLOCKED -> PASS; CF.HRC2 CONFIRMED -> PARTIAL |
| M-CONV0 | CAUGHT | 2 | K.E1.convertAgain (a second CO from K-E1) | E1.convertAgain (K-E2 a sixth time), KA.HRC12.archivedCoEvent (K-ARC re-converts: wrong); KA.E2.concurrent / pendingDelta only if wrong | CF.HRC12 CONFIRMED -> PARTIAL |
| M-OPEN | CAUGHT | 2 | P1.secondOpen, P1.reopenWhileOpen (each extra write voided at once: two LEAD lines) | none | none |
| M-OPENa | CAUGHT | 2 | P1.secondOpen | none | none |
| M-OPENb | CAUGHT | 2 | P1.reopenWhileOpen | none | none |
| M-CEIL | CAUGHT | 2 | P4.payOverNetPlus2 (45,000.02 accepted) | KA.P4.payOverNet (wrong: 90,000.03 paid), CF.C1TOL (TEST GAP) | none |
| M-LOCK | CAUGHT | 2 | E3.patchApproved, E3.archiveApproved | none (G.5xx only if the approved-CO edit answers a 5xx: flagged) | none |
| M-LOCKa | CAUGHT | 2 | E3.patchApproved | none | none |
| M-LOCKb | CAUGHT | 2 | E3.archiveApproved | none | none |
| M-RET | CAUGHT | 2 | I1.certifyUnconfigured (K7 certified at 0.00 / 40,000.00) | I1.afterConfiguration, HRC1.contractShapes, CF.HRC1 | - |
| M-RET-s | CAUGHT | 2 (1 if K7's second submit is need()ed) | I1.submitUnconfigured (K5 submitted) | CF.HRC1 if it reads I1.submitUnconfigured | - |
| M-RET-l | CAUGHT | 1 by design (K25's probe setup fails after the catch) | L114.newPeriodItemRate (null), I2.contractRate (3,000.00 / 37,000.00) | I1.explicitNoRetention, I1.afterConfiguration, HRC1.contractShapes, CF.HRC1, CF.DRAFTS1 (TEST GAP) | - |
| M-RET-r | CAUGHT | 2 | I1.afterConfiguration (0.00 / 40,000.00) | HRC1.contractShapes, CF.HRC1 | - |
| M-RET-o | CAUGHT | 2 | HRC1.contractShapes (D-001 { 10, contract }) | none | - |
| M-RET-c | CAUGHT | 2 | C3.noDefaultNoRate (201 at 5) | CF.HRC1 | - |
| M-RET-d | CAUGHT | 2 (1 if K7's second submit is need()ed) | HRC1.contractFirstRead (5 / project_default) | I1.submitUnconfigured, I1.certifyUnconfigured, I1.afterConfiguration, HRC1.contractShapes, CF.HRC1 | - |
| M-RET-p | CAUGHT | 2 | HRC1.projectDisplay (5 shown) | CF.HRC1 | - |
| UM-VAR0 | CAUGHT | jest red | 'includes approved variation allowance when enforcing IPC item limits', 'allows only the partially allocated approved variation allowance', 'answers every allocation/BOQ pair of the approved-variation rule from one query' | - | - |
| UM-CONV0 | CAUGHT | jest red | 'accepts a quote onto the lines, drafts a commitment change order, converts to a prime change order and links it' | - | - |
| UM-OPEN, UM-OPENa, UM-OPENb | CAUGHT | jest red | 'seeds a numbered application from the executed commitment with previous claims' (raise site), 'CX21-601: a rejected application cannot come back to draft while another application is open on the commitment' (back-to-draft site) | - | - |
| UM-CEIL | CAUGHT | jest red | 'payments cannot exceed the net approved and paid in full closes the application', 'CX21-005: a payment is checked against the payment rows under a lock, not the figure read before the transaction' | - | - |
| UM-CEILb | CAUGHT | jest red | 'CX21-005: ...' (the only catcher of the live-equivalent M-CEILb) | - | - |
| UM-RET .. UM-RET-p | CAUGHT | jest red | the fix's U-2b..U-7 and rewritten cases, per entry (titles reconciled with the fix diff) | - | - |

### 7.6 What counts where: the E6 tally
- **E6 (plan section 6.2 WP-4, six guards), tallied on these entries only:** retention default -> **M-RET** (post-fix); variation scope -> **M-VAR0** (M-VAR1 once HR-C2 is decided and fixed); the convert lock -> **M-CONV0** (M-CONV1 once the atomic convert lands); one open pay application -> **M-OPEN**; the payment ceiling -> **M-CEIL**; the lock on approved COs -> **M-LOCK**. A guard counts when its current entry is CAUGHT (clean, not FLAGGED). E6 is met for WP-4 at 6/6 on the final code.
- **Which code each entry's evidence stands on.** A HEAD entry's evidence stands on the final code when its mutated file is byte-identical on the final tree and the proof diff since its baseline touches none of its catchers (`git diff <baseline sha> <final sha> -- <file> backend/scripts/cert/cert3/wp4-commercial-proof.js`, read for the catcher ids). Otherwise the entry is re-run against the final baseline (its own result directory and `--ids`, section 7.4). Known at drafting: M-VAR0 is re-run (the HR-C1 fix edits `ipc.service.js`); M-LOCK, M-LOCKa, M-LOCKb are re-run if the HR-X1 batch landed after them (`change-order.service.js`, HRX1-FIX-PLAN.r2 s4.9); M-CONV0 is superseded if the atomic convert lands; M-OPEN* and M-CEIL (`sub-pay-app.service.js`, untouched by the HR-C1 fix, the HR-X1 batch and the two conditional fixes) keep their HEAD evidence.
- **Variants** (run, not tallied): M-OPENa, M-OPENb, M-LOCKa, M-LOCKb; and the HR-C1 surface variants M-RET-s, -l, -r, -o, -c, -d, -p.
- **Equivalent, not run:** M-CEILa and M-CEILb (each single removal of the payment ceiling: the other check answers the same code for the proof's sequential probe), M-VAReq-alloc (the allocation leg: every CO link carries its allocation's boqItemId).
- **Fix mutations** (plan section 1.4, not section 6.2): CCO-M1 (pending), M-CONV1 (pending, also the E6 entry once it lands); M-RET-w and M-RET-n unit only (TEST GAPs, section 13.1).
- **Unit side** (not evidence, plan section 1.4): UM-VAR0, UM-CONV0, UM-OPEN, UM-OPENa, UM-OPENb, UM-CEIL, UM-CEILb at HEAD; UM-RET .. UM-RET-p after the fix. No unit catcher exists for M-LOCK / M-LOCKa / M-LOCKb or M-CEILa (section 13.2).

### 7.7 Cleanup and census after the lists (plan section 7)
- **No restore after any WP-4 list** (section 2.1). Stored effects of the mutants are on K and K2 only: a second / sixth / re-converted CO (M-CONV0), PA-K1b and PA-K3a voided by the restorations (M-OPEN*), an over-paid PA-K1 (M-CEIL), an edited and archived approved CO (M-LOCK*), certificates certified at a silent or a wrong rate (M-RET family); every K and K2 archived by the proof's cleanup.
- **Census**, once after each batch:
  1. `node scripts/cert/isolation/fingerprint.js take wp4-post`, then `node scripts/cert/cert3/build/fingerprint97.js cert3-post wp4-post` (exit 0: the 97 other companies unchanged). Its `.e2.json` lists 087's changed pairs: they must be K's and K2's tables (projects, activities, BOQ, allocations, cost codes and budget lines, change events, RFQs, change orders, commitments, pay applications, IPCs, payments, cash flow, ledger, team, audit), the named exceptions (087-COM-C's IPC-01 certification and confirmation event from the primary run; 087-COM's rebuilt cash-flow rows, the same values) and the request-noise tables only. Nothing on 052 or 006. (If anything wrote after the restore of section 2.2 other than WP-4 runs, compare against a fingerprint taken right after the restore instead; after the HR-C1 deploy, against one taken right after the backfill.)
  2. The last proof run's throwaway check: 0 live `CERT3 WP4` projects.
  3. Record the census in the journal.
- **Never commit a mutated tree.** After every invocation `git status` shows no product diff that is not the batch's; `mutate-multi.js` restores byte for byte and keeps backups in `C:\Temp\octapm-cert\mutate-backups\`; a RESTORE FAILED line stops everything until the file is restored by hand.

---

## 8. Codex (plan section 6.4; owner rule 5)
- **Required for WP-4:** (a) the adversarial **plan review** of the HR-C1 fix before any code (section 4.1 step 2); (b) the **diff review** of the HR-C1 product diff after the mutations; (c) the same pair for CONVERT-ATOMIC and CCO-PARENT only if they confirm P1 and land (both move financial figures: high risk).
- **Not required for** the proof, the lists, this plan or answer-book edits (test side): `/code-review` covers them.
- Rounds: stop when nothing CRITICAL or HIGH is open; at most 3, then escalate. No round for P2/P3 or test polish.
- Mechanics (memory `octapm-codex-review.md`): the desktop app's `codex.exe`; one whole pass per five-hour window; prompt and output in `scratch\wp4\` (`codex-hrc1-plan-review*.md`, `codex-hrc1-diff-review-r<n>.md`), adjudication beside each. Never during a build, a proof, a mutation list or the full suite; if the usage limit blocks it, the batch waits and the re-run is scheduled for the next window.
- Review focus for the plan: fix plan s14 items 1-12 (the resolution order, P-11 / P-11b placement, P-10 re-resolution, the nullable columns, the backfill rule, the mutation family's faithfulness, the deploy sequence and the `cert3d` restore hazard).

## 9. Code review
`/code-review` (high) on the WP-4 batch before its commit: the proof (the `FIXES` edit, the two new checks, the R-SET recording, the CATCHERS additions), the four lists, the evidence checker, this plan, the book's contract and mutation leaves, the HR-C1 product diff and its tests. Findings adjudicated like Codex's. A finding that changes the proof is followed by one full proof run (a new baseline) and a rerun of only the mutants whose catchers it touches.

## 10. Commit and push
No merge of `main` into `cert/full-saas-certification` (owner rule; it overrides CLAUDE.md's "pull origin/main before committing"). Commits, each pushed: (1) the HR-C1 fix (product, migration, backfill script, web, unit tests; before `FIXES['HR-C1']` is set, section 4.1 step 8); (2) the WP-4 batch, `cert(CERT-3 WP-4): <one line>` (proof `FIXES` and its edits, lists, evidence checker, run plan, book leaves, results summary); (3) the docs (journal, workflow report, register, moment map). Messages end with the attribution line the committing session gives. `mutate-multi.js` lives in `C:\Temp` and is not committed; its four keys are recorded in the journal. CONVERT-ATOMIC / CCO-PARENT, if they land, each get their own fix commit before their `FIXES` entry is set.

## 11. Journal
`OCTAPM_CERT_JOURNAL.md`, same heading style: the restore; the primary run (passed / failed / known answers by status, exit; the two copies and the sha); the classification table; WP4-AGG-1's classification; the HEAD mutation batch (per mutant the evidence verdict with its named catchers, collateral and shifts; any FLAGGED entry and how it was classified; the unit results; E6 5/6); the HR-C1 route (Codex rounds and adjudications, the owner's answers to Q5 / O-2 / O-3, the census, the fix commit, `FIXES`, the deploy sequence, the targeted and full runs with the STORED-PRE-FIX reading, the 150 -> 152 move); CONVERT-ATOMIC / CCO-PARENT if they ran; the K15 re-run if HR-X1 landed after the primary run; the post-fix batch and E6 6/6; the TEST GAPs (section 13.1); the census; the reviews; the owner questions (HR-C2, HR-C3, HR-C4, HR-C12, HR-C13, HR-A3, Q5, O-2, O-3, Q10, Q3); the next exact action (restore `cert3d`, re-apply the HR-C1 migration and backfill, WP-5).

## 12. The WP-4 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register

Add `## WP-4 Commercial core - <CLOSED | IN PROGRESS> (<date>)` after WP-3, in the WP-0 section's shape. The result column holds `passed/total`, the exit code, and every known answer's ref.

| Rule or item (plan WP-4) | Evidence (final check ids) | Result |
|---|---|---|
| Change events: convert once, refusals (:683) | E1.stored, K.E1.converted, K.E1.convertAgain, E1.convertAgain, E1.patchConverted, E1.voidConverted, E1.voidWithoutReason, E1.deleteWithRfqs, D2.E1.stored; mutation M-CONV0 (section 6.2) | |
| Atomic, idempotent convert (:684, :1109) | KA.E2.concurrent, KA.E2.pendingDelta, KA.E2.midwayOrphans, CF.convertAtomic; M-CONV1 if fixed | BLOCKED CONVERT-ATOMIC or Fixed at `<sha>` |
| Prime CO refusals, reject / reopen, archive (:685) | E3.*; mutations M-LOCK (section 6.2), M-LOCKa, M-LOCKb | |
| The approved-CO lock (:674, :685) | E3.patchApproved, E3.archiveApproved | |
| CO budget split (:686) | E4.split, E4.splitMismatch | |
| Contract totals after COs (:687) | E5.stored, E5.contractEnd, E5.budgetRevision | WP4-AGG-1 recorded |
| Deductive CO (:688) | E6.deductiveCo, CF.HRC13 | HR-C13 owner |
| HR-C12 (:728) | KA.HRC12.*, CF.HRC12 | BLOCKED HR-C12 |
| Commitments: refusals and roles (:690) | C1.*, C2.* | |
| A commitment CO on a dead parent (:731, :1111) | KA.CCO.*, CF.CCOparent; CCO-M1 if fixed | BLOCKED CCO-PARENT or Fixed at `<sha>` |
| Retention: no silent rate (HR-C1 decided; :49, :90, :692, :696-697) | the 11 decided-rule checks (+ I1.submitUnconfigured, HRC1.contractShapes); fix `<sha>`; M-RET family caught; UM-RET*; 3 STORED-PRE-FIX | HR-C1 Fixed; L114 part 1 fixed, part 2 REJECTED |
| IPC limits and variations (:698) | I3.limits.A120, KA.I3.*, CF.HRC2; M-VAR0 (section 6.2) | BLOCKED HR-C2 |
| IPC workflow refusals (:699-707) | I4.*, I5.*, I6.*, I7.*, I8.*, KA.I8, KA.I9, I10.live, KA.I11, I12.pmPayment, KA.HRC3, IPC.itemsFromAllocations, K.IPC.D, IPC.noCost, K.cashInflow, D3.* | HR-C3 / HR-C4 / HR-A3 owner |
| Pay applications (:709-713) | P1.*, P2.*, P3.*, P4.*, KA.P4.payOverNet, P5.*, P6.*, P7.*; mutations M-OPEN (section 6.2), M-OPENa, M-OPENb, M-CEIL (section 6.2) | C1-TOL P3 |
| Cash flow (:715-719) | CASH.*, KA.CASH.* | L115 / L120 to CERT-5; WP4-CF-1 |
| Confirm-first items (:726-732) | CF.* (`observations.confirmFirst`) | CF.HRC1 REJECTED (fixed); 12 reported |
| Known answers | section 5 of this plan | values, 20 BLOCKED with refs, 3 STORED-PRE-FIX |
| Mutations (E6) | `results\cert3\wp4-mutations\<id>.json`, the unit results, `wp4-mutation-evidence.js` output | 6/6 section 6.2 guards; variants; fix mutations; TEST GAPs named |
| Reviews (E11) | Codex plan and diff reviews of HR-C1 (and of any other landed fix), `/code-review` | |

Register (`OCTAPM_LAUNCH_BLOCKERS.md`): HR-C1 -> Fixed at `<sha>` (the stored moments in `cert3d` read STORED-PRE-FIX until the exit rebuild); CONVERT-ATOMIC and CCO-PARENT with their classification, severity and, if fixed, the sha; WP4-AGG-1 classified; WP4-OVR-1 and WP4-DRAFTS-1 with this run's classification; new rows WP4-CF-1 (month 13, P3) when confirmed and C1-TOL (one cent over, P3); the TEST GAPs of section 13.1; HR-C2, C3, C4, C12, C13, HR-A3 as owner questions.

---

## 13. Limitations, TEST GAPs and notes (the lists refer here)

### 13.1 Mutations the live proof cannot catch
- **M-CEILb** (the payment ceiling's locked re-check alone removed): equivalent for the proof's sequential +0.02 probe, NOT equivalent in general (the re-check guards a payment landing between the pre-check and the lock, CX21-005). Its only catcher is the mocked UM-CEILb: a TEST GAP of the live proof, recorded. A live catcher would need two concurrent payments on one approved application on K: a new step (plan section 0.0), not added.
- **M-CEILa** (the pre-check alone removed): equivalent in effect for every observation (the locked re-check refuses with the same code); no catcher anywhere, none needed.
- **M-RET-w** (a PATCH without a rate drops an entered line rate) and **M-RET-n** (a null contract rate stored as 0): no K step exercises either (fix plan s9); unit catchers U-5 and the updateContract-null case only. TEST GAPs of the live proof.
- **M-VAReq-alloc**: equivalent on this data until HR-C2 removes the BOQ-item leg.

### 13.2 No unit catcher
M-LOCK / M-LOCKa / M-LOCKb (no test asserts CHANGE_ORDER_APPROVED_LOCKED; CX21-496 / CX21-512 answer CHANGE_ORDER_CHANGED from the status re-read, which neither edit touches), M-CEILa (unit-equivalent too). Listed in the unit lists so nobody looks for one. Adding unit tests is allowed only inside a fix batch, never as a new requirement.

### 13.3 Notes for the integration owner
- **The baseline design (section 7.3) is this plan's decision**, made so the five HEAD-runnable guards are proven before the HR-C1 fix; adopt it or fall back to the WP-3 rule (every list only on the final code, after the full run exits 0).
- **Post-fix proof requirements (land with the HR-C1 fix commit).** (a) R-SET recording: under M-RET-l the K9 claim on K-IPC-NR is refused at submission and the current `kHrc1` need()s that submit (:1570), which would end the HRC1 section before K10-K11 and leave L114.newPeriodItemRate NOT RUN (no evidence for M-RET-l); K9's refusal must be recorded as I1.explicitNoRetention FAIL and the choreography go on. Likewise the K5 and K7 submit answers under M-RET-s and M-RET-d (the fix plan s8.2 already says "setup, recorded"). (b) `CATCHERS` gains M-RET-s, M-RET-r, M-RET-o, M-RET-p, and the book's `WP4.mutations.retentionDefaultGuard` names their catchers (the G23 load guard). (c) `EXPECTED_CHECKS` 152 with I1.submitUnconfigured and HRC1.contractShapes (P4ADJ A I-1, I-2). Until then the fix lists' catchers I1.submitUnconfigured and HRC1.contractShapes are `pendingCheckIds`.
- **Proof COLLATERAL table vs the lists.** The proof's `COLLATERAL` (:647-653) is descriptive and names nothing for M-CONV0's K19 effect: KA.HRC12.archivedCoEvent reads wrong under M-CONV0 (K-ARC's re-convert answers 201). The list names it with its derivation; adding it to the proof table is an optional one-line edit (no check depends on the table's text).
- **Racy catchers of M-CONV1** (KA.E2.concurrent, KA.E2.pendingDelta): the checker reports a racy catcher that did not flip without failing the entry when every deterministic catcher (KA.E2.midwayOrphans) flipped. One marked rerun of a mutant whose racy catcher survives follows the WP-5 adjudication's Q8 precedent; confirm it for WP-4.
- **The pending entries** (M-VAR1, M-CONV1, CCO-M1) carry their catchers, collateral, requirements and the HEAD loci; their `from` / `to` are derived from the real fix diffs and the entries moved into `mutations[]` then (re-run `mutsyntax-wp4.js --post-fix`). M-VAR1 waits for an owner decision on HR-C2.
- **New list fields** beside WP-3's: `shifts` (named non-red status changes), `collateralWhy` (a derivation per collateral id), `racy`, `pending`, `pendingCheckIds`, `requires`.
- **Runner prefix match.** `--only=<value>` without a comma is a prefix match; the quoted trailing comma (section 7.4) is the exact match; `--lists=` is mandatory (ids such as M1 and G1 repeat across registered lists).

### 13.4 Book notes (for the book owner, under Claude Main; A10)
- `WP4.mutations.retentionDefaultGuard`: name the new catchers (section 4.1 step 4); its derivation's "Anchors are counted when the fix lands" points to `wp4-fix-mutations.commercial.json`.
- `WP4.mutations.convertLock` and `commitmentCoParent`: their anchors are counted when their fixes land (the pending entries).
- The HR-C1 contract leaves after the plan review (fix plan s16).

---

## 14. Hazards (read before running)
- `cert3d` must exist and the population must be complete (five deep projects with their state files); `mutate-multi.js` cannot pass flags.
- One writer: proofs only through `run-locked.js`; a mutation list with the lock held for the whole invocation; no build, Codex or full jest suite at the same time (OPS-1).
- The runner's CAUGHT means nothing at HEAD (the unmutated proof exits 2): only `wp4-mutation-evidence.js` against a valid baseline on the same tree counts (section 7.3).
- The WP-4 keys go into `LISTS` only after the four list files exist in `backend/scripts/cert/cert3/` (the runner reads every registered list).
- `--only` values quoted with a trailing comma and `--lists=` always given (section 7.4); one id per invocation; the result copied after each, before the next run overwrites it.
- Never run `--lists=wp4fix-commercial` before the HR-C1 fix: every entry is NOT APPLIED by design.
- After any product or proof commit: `mutsyntax-wp4.js` again, a new full baseline before the next mutant, and A10 re-derivation of any list `expect` the change moves.
- Never amend a fix commit once `FIXES` names it; `S.state` checks the time against git.
- The cert API is never (re)started while a mutant is applied.
- The HR-C1 migration and backfill are re-applied after every restore of `cert3d` (the API down across both); a pre-migration snapshot with the post-fix client fails at the first query.
- Races (section 5.4): never rerun the primary run for a reading.
- State files are not in the snapshot: never run a builder after `cert3d` without taking it again.
- Secrets: `CERT_PASSWORD` only through `lib/api.js`; results and logs are scrubbed by the harness; never paste a token or a password into the journal.
