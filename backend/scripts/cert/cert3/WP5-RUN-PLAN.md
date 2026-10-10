# CERT-3 WP-5 run plan (supply chain: bids and award, orders and receipts, inventory, direct costs, the three-way match)

Plan `docs/certification/OCTAPM_CERT3_PLAN.md` section 7 step 4 (:1186), for WP-5 (section 4 :734-793), on snapshot `cert3d`.

**Drafted read-only 2026-10-10** (preparation agent; to be adopted, edited and committed by Claude Main) against:
- the committed proof `scripts/cert/cert3/wp5-supply-proof.js` at `6c5ab54` (HEAD `2a2efd2`): 142 fixed checks (`EXPECTED_CHECKS`, asserted at load) plus the harness's `G.5xx`; its CHECKS table (:191-339) carries the id, plan line, answer-book key, where each check runs and its section; `FIXES` (:505-515, all empty); `RULES` (:521-542); `DECIDED_RED` (:549-595, empty while no fix is set); `CONTRACT` (:608-613, all pending); `CATCHERS` (:621-630); `COLLATERAL` (:632-643); `FIX_CATCHERS` (:648); `meta.equivalentMutants` (:691, M-DCX). The proof has no `OPTIONAL_CATCHERS` table;
- the five drafted mutation lists in `C:\Temp\octapm-cert\scratch\wp5\lists\` (section 7.1): `wp5-mutations.supply.json` (10 mutations + 1 equivalent), `wp5-mutations.complements.json` (3, HEAD only), `wp5-mutations.unit.json` (12), `wp5-fix-mutations.supply.json` (5 pending), `wp5-fix-mutations.unit.json` (5 pending). Every `from` is counted, every mutant is parsed and every id is checked by `mutsyntax-wp5.js` (report `mutsyntax-wp5-report.json`, 0 problems). Its teeth, `teeth-mutsyntax-wp5.js`, catch 21/21. The runner lines are checked by `check-runner-wp5.js` (ok);
- the drafted evidence checker `wp5-mutation-evidence.js` (section 7.3). Its self-test, `selftest-evidence-wp5.js`, passes 37/37 on synthetic results built from the debug result;
- the answer book `answers/commercial.js` after the WP-5 book patch (`61c2f7d`: BOOK-G3, G1-G23) and the integration-owner rulings (`6c5ab54`: B1, B2, P1, P3);
- the binding adjudications `C:\Temp\octapm-cert\scratch\wp4\PREP4-ADJUDICATION.md` section D (Q1-Q12; cited WP5ADJ) and `C:\Temp\octapm-cert\scratch\wp5\PREP5-ADJUDICATION.md` (the WP-4 list design L1-L6, the WP-5 book B1-B5, the WP-5 proof P1-P3; cited R5ADJ);
- the preparation `C:\Temp\octapm-cert\scratch\wp5\WP5-PREP.md` (facts, test map, section 9 fix sketches F-1..F-4 and the HR-C8 implementation note; no fix plan exists);
- the WP-4 model: `WP4-RUN-PLAN.md`, `wp4-*.json` and `wp4-mutation-evidence.js` (the baseline design, adopted for WP-5 by R5ADJ L1).

**State at drafting.** HEAD `2a2efd2` on `cert/full-saas-certification`. `backend/src` is identical to `f599e67` (`git log f599e67..HEAD -- backend/src` is empty). The proof was debug-run twice by Claude Main on build order run 1's partial population, where 052-COM was not built: `C:\Temp\octapm-cert\logs\cert3-wp5-debug-1.log`, `-2.log`, run with `--skip=D2`, 138 of 142 active. Run 2 gave 138 pass, 0 fail, 28 known answers BLOCKED, 15 of 16 confirm-first CONFIRMED (CF.HRC9 PARTIAL, state-dependent: R5ADJ debug note), 0 5xx, exit 0, about 95 s. Those runs debugged the proof; they are not WP-5 evidence. `cert3d` is taken by build order run 2. WP-1..WP-4 run on it first; WP-4 ends by restoring it and re-applying the HR-C1 migration and backfill (WP4-RUN-PLAN.md step 16).

---

## 0. Rules that bind every step

**Owner execution rules (2026-10-10, strict one-writer; CERT-3 parallel execution mode).**
1. **One writer.** Only Claude Main modifies the certification worktree, writes the certification database (:55433) or the cert API (:5190), runs proofs, mutation runs (they edit product files), restores snapshots, runs Codex, commits and pushes. Preparation agents are read only and write only to their scratch folders.
2. **Pipeline.** While Claude Main executes WP-5, read-only agents prepare WP-6. No open-ended defect hunting.
3. **Snapshots.** `cert3d` is the one working CERT-3 baseline. It is restored before WP-5 (section 2.1) and never rebuilt for WP-5. Every restore re-applies the migrations landed after it: the WP-2 batches if they carry one, and the HR-C1 migration and backfill (P4ADJ A I-3). There is no second baseline snapshot.
4. **Reruns.** After a fix, targeted proof sections run first (section 6). Complete runs happen only where the plan requires them: the WP-5 primary run (also the HEAD mutation baseline, section 7.3), one full run on the final code if any WP-5 fix lands (also the post-fix baseline), and the exit run.
5. **Codex** only for the plan's required reviews (section 8). No extra round for P2/P3 or test polish once nothing CRITICAL or HIGH is open.
6. **Long runs** (> 1.5 h) run detached under the watchdog. Nothing in WP-5 is that long: the proof takes about 1.6 min (with the 30 s prequalification lapse, WP5ADJ Q10), and each mutant about as long.
7. **Manual UX** never holds WP-5 and never uses :5190 or the cert database while a proof or a mutation list runs.

**Plan rules.**
- Section 0.0: no new rounds, matrices or requirements; rerun only invalid cases.
- Section 1.4: known answers first (A10); checks assert; reproduce before fixing; a fix is followed by a mutation that puts the defect back.
- Section 5's defect-fix list (:1107-1121): the atomic award confirmation, one order per award and award-order coding (:1110), and the receivable PO list (:1112) go ahead after reproduction only if they confirm P1. P2/P3 are recorded under the scope freeze.
- Section 6.4 gates.
- Section 7 detached-run rules: one writer; a mutation run that stores a defect is cleaned up, then followed by a census.

**No HR rule is decided by this plan.** HR-C5, HR-C7, HR-C8 and HR-C9 wait for the owner. HR-C6 (L35, L36, X-FINANCE-1) is CERT-5's. Their 28 known answers read BLOCKED at `today` with their ref (WP5ADJ Q4; R5ADJ B2, P3).

---

## 1. Sequence

| # | Step | Who / where | Expected |
|---|---|---|---|
| 0 | Precondition: WP-4 closed (committed, pushed, journalled); `cert3d` restored after WP-4 with the HR-C1 migration and backfill re-applied (WP4-RUN-PLAN.md step 16) | Claude Main | the WP-4 row of the workflow report written |
| 1 | Restore `cert3d` (section 2.2) if anything wrote after WP-4's restore; re-apply every migration landed after `cert3d` (HR-C1; a WP-2 batch if it carries one) | Claude Main | API up on :5190; restore journalled |
| 2 | No-DB checks (section 7.2): `node --check` the proof; copy in the five lists and `wp5-mutation-evidence.js`; add the five `LISTS` lines; run `mutsyntax-wp5.js` and `check-runner-wp5.js` on the tree | Claude Main | every section 6.2, complement and unit anchor occurs once on the tree; every mutant parses; every pending locus occurs once; 0 problems |
| 3 | **Primary run** of `wp5-supply-proof.js`: full, no flags, `FIXES` empty (section 2.3). Copy the result to `.primary.json` and `.baseline-head.json` | Claude Main, lock held | exit 0, PASS: 143/143; 28 known answers BLOCKED; 16 confirm-first reported; 0 wrong; 0 5xx (section 5.1) |
| 4 | Classify every reported known answer and confirm-first item (section 3); collect the owner questions | journal, register | table filled; severities final (WP5ADJ Q3) |
| 5 | **HEAD mutation batch** (section 7): `wp5-supply` one id per invocation, then `wp5-complements` one id per invocation (before any HR-C8 implementation), then `wp5-unit`; then the evidence check against the HEAD baseline | Claude Main, lock held | 10 + 3 CAUGHT by their named catchers; unit 12/12 caught by named tests; E6 5/5 |
| 6 | Defect fixes, only for items confirmed P1 by step 4 (section 4.1): AWARD-ATOMIC is P1 as the plan says until the reproduction shows otherwise; the others are P2/P3 proposed | Claude Main | each its own fix route; its mutant moves from `pending[]` into `mutations[]` |
| 7 | Owner rules implemented, if the owner decides during WP-5 (section 4.2): HR-C8 retires the complements and brings M-PCL1 | Claude Main | as step 6 |
| 8 | **Post-fix mutation batch**, only if step 6 or 7 landed something: `wp5fix-supply` one id per invocation; `wp5fix-unit`; HEAD entries whose file changed are re-run on the final code (section 7.6); the evidence check against the final baseline | Claude Main, lock held | each landed fix CAUGHT; E6 5/5 on the final code |
| 9 | Regression: the read-only lifecycle verifier (E7) | Claude Main | as at WP-0 |
| 10 | Codex diff review of any WP-5 product diff (section 8) | Claude Main, one pass per window | nothing CRITICAL or HIGH open |
| 11 | `/code-review` (high) on the WP-5 batch (section 9) | Claude Main | findings adjudicated |
| 12 | Commit and push (section 10) | Claude Main | no merge of `main` |
| 13 | Journal entry (section 11) | Claude Main | figures, table, tallies, restores, census, reviews, next action |
| 14 | The WP-5 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register rows (section 12) | Claude Main | rule -> evidence -> result for every WP-5 rule |
| 15 | Restore `cert3d` before WP-6 and re-apply every landed migration | Claude Main | WP-6 starts clean |

---

## 2. Restore `cert3d` and the primary run

### 2.1 When to restore
- **Before the primary run**, unless the restore after WP-4 (WP4-RUN-PLAN.md step 16) is the last thing that wrote to :55433. WP-5 reads 087-COM, 087-COM-B and 052-COM. WP-1..WP-4 leave throwaway projects and mutation residue in 087, and a restore is cheaper than reasoning about them. WP-5's stored moments (087-COM rows 140-152, 155; 052-COM's O2) must be the build's.
- **Not after any WP-5 list.** Every mutant writes, if at all, only on the run's throwaway project J, which the proof's cleanup archives (the cleanup also runs after a section error). On the deep projects every probe stays a read or a refusal before any write, under every mutant of the section 6.2 list and, at HEAD, of the complements list. Each list entry's `safety` says so. The census proves it (section 7.7).
- **Never run a complement after HR-C8 is implemented** (section 14). They would close 087-COM PO-C and 052-COM PO-O2, and a restore would then be needed.
- **Before WP-6.** WP-5 leaves company-level residue in 087 on every proof run (R5ADJ P2):
  - one archived `CERT3 WP5 Supply <stamp>` project, with J's two warehouses and 13 items (projectId J);
  - the two stamped directory vendors J-QUAL and J-EXP (WP5ADJ Q6);
  - the item that goods receipt creates for J-SVC's service line.

  That is about 15-20 runs with the primary, mutation and any targeted runs.

### 2.2 How (the build order's own mechanism, `build-cert3d.ps1` :42-80)
From `backend/`, with `DATABASE_URL` unset and the proof lock not held (`C:\Temp\octapm-cert\locks\proof.lock` absent):
1. Stop the cert API as `build-cert3d.ps1` does (`Stop-CertApi`: the process on :5190 must be the recorded `api.pid`; never stop another process).
2. Run `node scripts/cert/snapshot-db.js restore cert3d`.
3. Re-apply every migration landed after `cert3d`. The HR-C1 migration is always one:
   - run `node C:\Temp\octapm-cert\migrate-cert.js`;
   - run the HR-C1 backfill: the dry run, then `--apply` under the owner's Q5 rule;
   - run the client guard (`npm run prisma:generate`, never `prisma generate` in a junctioned worktree).

   A WP-2 batch migration, if one landed, is re-applied the same way. Keep the API down across all of it (HRC1-FIX-PLAN.md s11.4, P4ADJ A I-3).
4. Run `powershell -NoProfile -ExecutionPolicy Bypass -File C:\Temp\octapm-cert\start-api.ps1`.
5. Record the restore in the journal (time, reason, migrations re-applied).

Never run a builder after `cert3d` without taking the snapshot again. The state files `C:\Temp\octapm-cert\state\cert3\*.json` are not in the snapshot, and the proof's `S.state` / `S.projects` refuse a state file whose `projectId` differs from the live project (a setup error).

### 2.3 The primary run
```
cd <worktree>\backend
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp5-supply-proof.js
```
- **No flags on `cert3d`.** `--only`, `--skip` and `--project` exist for targeted reruns (section 6) and partial populations. They are never used for the primary run, the final run or a mutation run, because `mutate-multi.js` spawns the proof without arguments.
- `CERT_PASSWORD` comes from `backend/.env` through `lib/api.js`. Never echo it, copy it into this plan, the results or the journal.
- **Setup:**
  - companies 087 and 052 are resolved and the personas sign in;
  - the three deep projects are found by exact name, one live each, matching their state files (S.projects). This is the first full execution of D2 (052-COM was not built for either debug run);
  - J is created in 087 with an explicit default retention of 10 (S.J.create), so WP-5 does not depend on HR-C1 (WP5-PREP Q11);
  - J's fixture is built (S.J.fixture).
- **Expected console** (the formats of debug run 2, `cert3-wp5-debug-2.log`):
  - `wp5-supply-proof: stamp <stamp>; 143 checks (fixed)`
  - `wp5-supply-proof: 142 of 142 checks active; sections S JO JN JR JD COM COMB D2 CF; deep projects 087-COM, 087-COM-B, 052-COM; J yes (J9 yes, J10 yes, J11 yes); fixes AWARD-ATOMIC not set, AWARD-ONE-ORDER not set, AWARD-CODING not set, RCV-LIST not set, HR-C5 not set, HR-C7 not set, HR-C8 not set, HR-C9 not set, WP5-SVC-1 not set; in process`
  - possibly `waiting <n> s for J-EXP's insurance cover to lapse (WP5ADJ Q10)`
  - `tally: 142 pass, 0 fail of 142 recorded (142 active); failures: none; known answers: 0 value, 28 BLOCKED, 0 STORED-PRE-FIX, 0 fail (0 wrong)`
  - `confirm-first: CF.awardAtomic CONFIRMED; CF.awardSecondOrder CONFIRMED; CF.awardCoding CONFIRMED; CF.HRC8 CONFIRMED; CF.receivableList CONFIRMED; CF.HRC9 <CONFIRMED|PARTIAL>; CF.HRC7 CONFIRMED; CF.HRC6 CONFIRMED; CF.L199issue CONFIRMED; CF.HRC5 CONFIRMED; CF.L107 CONFIRMED; CF.L119 CONFIRMED; CF.DFUN1delete CONFIRMED; CF.SVC1 CONFIRMED; CF.AWD1 CONFIRMED; CF.INV1 CONFIRMED`
  - `PASS  G.5xx  no answer was a 5xx (a 5xx never passes)`
  - The cleanup line. It shows J archived (200, `archivedAt` set), then the throwaway check `(GET /projects as 087 PM, 200): <n> 'CERT3 WP5 Supply' projects, 0 live`, then the company-level residue (R5ADJ P2). No deep write is listed and there are no `restorations` (the proof has none).
  - `wp5-supply-proof: 143 passed, 0 failed of 143 (fixed); PASS, exit 0`
- The tally's `pass` counts PASS, BLOCKED and STORED-PRE-FIX records. The 28 BLOCKED known answers are passes for the harness and are counted apart in the known-answer tally.
- **Racy readings** (section 5.4):
  - A lucky serialisation of J-BP2's two confirms reads `value` on KA.R2.concurrentConfirms: `1 value, 27 BLOCKED`, and CF.awardAtomic reads PARTIAL. That is still a pass. It is recorded as a lead and never rerun for a reading (P4ADJ B5).
  - CF.HRC9 reads CONFIRMED or PARTIAL depending on which PO-00001 the scan returns (R5ADJ debug note). It is recorded as is.
- **Result:** `C:\Temp\octapm-cert\results\cert3\wp5-supply-proof.json`. It holds:
  - `checks[]`, with `ok`, `kind` and `notRun`;
  - `meta`: `decidedRed` (empty), `fixes`, `catchers`, `fixCatchers`, `collateral`, `filter`, `activeChecks`, `equivalentMutants`;
  - `observations`: `checks` (per id, with plan line, book key, where, expected, observed and verdict), `knownAnswers`, `confirmFirst`, `fixes`, `runObservations`, `tally`;
  - `answers.byStatus` and `fiveXX`;
  - `cleanup`.

  **Copy it at once** to `wp5-supply-proof.primary.json` and to `wp5-supply-proof.baseline-head.json` (the HEAD mutation baseline, section 7.3); every later run overwrites the result file. Record `git rev-parse HEAD` and `git status --porcelain backend/src backend/scripts/cert/cert3` with the copy in the journal.
- **Exit semantics** (harness rule 5, A10):
  - **0**: every check holds. This is the expected answer at HEAD, because no WP-5 rule is decided and no fix is set.
  - **2**: a check failed. Classify it first as a possible proof defect (TEST GAP), then as a product failure.
  - **1**: a setup error (a check not run, a section that threw, an R-SET probe whose own setup failed). That is never a product result: fix the proof or the fixture and rerun.
- **First full execution.** D2 (052-COM: O2.stored.052, O2.live.052, O2.closeOutstanding.052, O2.forceNoReason.052) was filtered out of both debug runs. A red there is read first as a possible proof defect.

---

## 3. Classification table

Every reported known answer and every confirm-first item gets a row, and so does any failure.
- **Classification** follows plan section 0.0 item 4 / section 6.4: CONFIRMED, PARTIAL, REJECTED, EXPECTED BEHAVIOUR or TEST GAP.
- **Severity** follows section 1.4. The severities below are WP5ADJ Q3's provisional ones, made final after the primary run.
- **Destination** is one of:
  - **fixed in WP-5** (section 4.1);
  - **owner HR decision** (section 4.2);
  - **register**: P2/P3, recorded under the scope freeze;
  - **CERT-5**;
  - **proof or book corrected**: a TEST GAP, logged with its derivation (A10);
  - **closed**: EXPECTED BEHAVIOUR, with the rule cited.

Pre-filled rows ("observed" = the code reading and the debug runs; replaced by the `cert3d` primary run):

| # | Check id(s) | Book key | Observed (HEAD) | Expected (value) | Today + ref | Proposed classification | Severity | Destination |
|---|---|---|---|---|---|---|---|---|
| 1 | KA.R2.concurrentConfirms, CF.awardAtomic | WP5.R2.concurrentConfirms | two confirms at once: two 201, two draft commitments from J-BP2 (both pass the pre-check outside any transaction; WP5-PREP fact 6) | one 201, one 409 BID_PACKAGE_LOCKED, one commitment | today, AWARD-ATOMIC | CONFIRMED expected (racy: a single success reads value, a lead) | **P1 as the plan says** until the reproduction shows what the duplicate drafts reach; a downgrade to P2 is decided then, with evidence (WP5ADJ Q3) | section 5 defect fix in WP-5 if P1 (section 4.1) |
| 2 | KA.R3.secondOrder, CF.awardSecondOrder | WP5.R3.secondOrder | J-PP1 ordered twice: 201 and two `planned` orders | 409 (code the fix's) | today, AWARD-ONE-ORDER | CONFIRMED expected | P2 proposed (a planned duplicate needs submit -> PM approval -> issue) | register unless rated P1; F-2 needs a migration and an owner answer (section 4.2) |
| 3 | KA.R4.lineCoding.J, KA.R4.lineCoding.087, CF.awardCoding | WP5.R4.lineCoding | the award order line carries the activity only | the package line's cost code, budget line, BOQ item | today, AWARD-CODING | CONFIRMED expected (087-COM's PO-AWARD a build record) | P2 proposed | register unless rated P1 |
| 4 | KA.O5.receivableList.J / .087, CF.receivableList | WP5.O5.onJ / on087 | drafts listed, acknowledged orders missing | {issued, acknowledged, partial} | today, RCV-LIST | CONFIRMED expected | P3 proposed (no consumer; web and mobile work around it) | register (F-4 not applied unless rated P1) |
| 5 | KA.O2.forceWithReason, KA.O2.receiveAfterClose, KA.O2.fullyReceivedClose, KA.O3.cancelAfterDelivery, KA.O2.stored.closeShort, KA.O2.stored.closeReceived, CF.HRC8 | WP5.O2.*, WP5.O3.cancelAfterDelivery | a partial or received PO cannot be closed (409 PO_TRANSITION_INVALID); the cancel answers the wrong code (PO_CANCEL_AFTER_DELIVERY unreachable, fact 4); the two 087-COM build moments BLOCKED | closed; 409 PO_CANCEL_AFTER_DELIVERY; a receipt after a close refused | today, HR-C8 | CONFIRMED | owner's (D-FUN-1 P2 register) | owner HR decision; M-PCL1 then; the stored moments STORED-PRE-FIX once implemented (R5ADJ B5) |
| 6 | KA.O6.refCollision, O6.collision.live, CF.HRC9 | WP5.O6.refCollision | the keeper's scan of PO-00001 answers 200 with one arbitrary order of the company | 409, or projectId required | today, HR-C9 | CONFIRMED or PARTIAL (which order answers is state-dependent) | owner's; the plan proposes P1 | owner HR decision |
| 7 | O7.J.ignoredFields, KA.N6.issuedQty, KA.N6.usage50, CF.HRC7 | WP5.O7.ignoredFields, WP5.N6.* | the procurement door ignores issueToActivity / issuedQty (201); an issue never raises the plan row's issuedQty (0); usage 50 refused 409 | 400 (assumption, R5ADJ B2); 60; 201 (R5ADJ P1) | today, HR-C7 | CONFIRMED | owner's | owner HR decision |
| 8 | KA.D5.priceVarianceApproval, KA.D6.invoiceSideVerdict, CF.HRC5 | WP5.D5.priceVarianceApproval, WP5.D6.invoiceSideVerdict | J-VAR approved over a blocking variance; a line with no poLineId downgrades review to check; approveDirectCost reads no match | refused unless overridden; review | today, HR-C5 | CONFIRMED | owner's | owner HR decision |
| 9 | KA.D5.overInvoicedLedger, CF.SVC1 | WP5.D5.overInvoicedLedger | J-SVC over-invoiced, both approvals accepted, both capitalised: 0.00 posted (BOOK-G3) | 600.00 | today, HR-C5+WP5-SVC-1 (decided only when both fixes are recorded, R5ADJ P3) | CONFIRMED (WP5-SVC-1 wider than registered: every received PO line is stocked, fact 9) | WP5-SVC-1 P2 (register :292) | register WP5-SVC-1; the KA owner-bound |
| 10 | KA.N2.*, KA.N3.*, KA.D4.087, KA.D4.J.invoiceBeforeReceipt, CF.HRC6 | WP5.N2.*, WP5.N3.*, WP5.D4.ledgerInvoiceBeforeReceipt | never-issued and over-returns accepted (L36); a return credited at the current average (X-FINANCE-1); an invoice before its receipt counted twice (L35) | the values | today, L36 / X-FINANCE-1 / L35 | CONFIRMED (recorded) | P1 (CERT-5, owner decision section 0.1) | recorded, deferred to CERT-5 |
| 11 | CF.L199issue | WP5.CF.L199issue | the same issue body twice: two 201, two movements | one movement | L199 | CONFIRMED expected | P3 | register |
| 12 | CF.L107, CF.L119 | WP5.CF.L107, WP5.CF.L119 | J-VAR's 50.00 variance lands in neither stock nor cost; J-L119's 750.00 on the ledger, not on the budget register | recognised once; reaches the register | L107, L119 | CONFIRMED expected | P2 (leads) | register |
| 13 | CF.DFUN1delete, O1.J.submitNoLines | WP5.CF.DFUN1delete | deleting J-A-DEL drops J-DEL2's line and keeps its value (400.00 for 100.00); J-DEL1 left empty | value recomputed | D-FUN-1 | CONFIRMED expected | P2 (register :195) | register |
| 14 | CF.AWD1, R1.live.gap | WP5.R1.awardedNotLowestGap | awarded 5,400.00 above the lowest bid; the confirm route takes no not-the-lowest justification | - | WP5-AWD-1 | CONFIRMED as described | P3 (register :293), or EXPECTED BEHAVIOUR if the owner accepts the prequalification override as the record | register or closed (owner) |
| 15 | CF.INV1 | WP5.CF.INV1 | the keeper, on neither J's nor 087-COM-B's team, receives, issues to J-A110 and returns J-INV1 stock (201) and lists 087-COM-B's orders (200) | 403 PROJECT_ACCESS_DENIED / 404 PROJECT_NOT_FOUND | WP0-INV-1 | CONFIRMED (S5) and extended | P2 registered; HR-C9 (same class) proposed P1: the owner aligns them (WP5ADJ Q3) | register / owner |
| 16 | Debug runs 1-2 (partial population, `--skip=D2`) | - | 138/138, 28 BLOCKED, CF.HRC9 PARTIAL | - | - | not evidence | - | journal |

---

## 4. What WP-5 fixes, and what waits for the owner

### 4.1 Defect fixes, only if the primary run confirms P1 (section 5 :1107-1112)
**AWARD-ATOMIC** (:1110, :782; P1 as the plan says until the reproduction, WP5ADJ Q3).
1. The reproduction is KA.R2.concurrentConfirms plus CF.awardAtomic. It is racy, one shot, never retried.
2. If it confirms P1, write a read-only fix plan from WP5-PREP section 9 F-1:
   - P-A1: one interactive transaction with the package row locked;
   - P-A2: createCommitmentTx;
   - P-A3: keep the pre-check, so R2.J.confirmAgain and M-AWD0 stay valid;
   - P-A4: decide prequalification before any write.
3. Codex plan review: the award creates commitments, so this is high risk.
4. Fix and fix commit.
5. Set `FIXES['AWARD-ATOMIC']`, and `CONTRACT['AWARD-ATOMIC'].loserCode` from the adjudicated plan.
6. Run `--only=JR`, then a full run.
7. Derive **M-AWD1** from the fix diff and move it from `pending[]` into `mutations[]` of `wp5-fix-mutations.supply.json`. It supersedes M-AWD0 as the award-lock E6 entry. It is racy: one marked rerun if it survives (WP5ADJ Q8). Its unit side is UM-AWD1 (`bid.service.test.js:275-297` moves to one transaction).
8. Codex diff review.

The fix touches `commitment.service.js`, which the HR-C1 fix also edits. Re-run `mutsyntax-wp5.js`: the M-AWD1 locus at :549 moves to :557 under the HR-C1 simulation.

**AWARD-ONE-ORDER** (:1110, :783; P2 proposed). If rated P1, follow F-2 P-B1:
- `BidPackage.awardedOrderId`, a nullable column plus index. The migration comes from `prisma migrate diff` and is dated after the future-dated existing ones (schema-drift rule).
- `createPurchaseOrderTx`;
- the code `409 PROCUREMENT_AWARD_ALREADY_ORDERED` (a proposal) into `CONTRACT['AWARD-ONE-ORDER'].refusalStatusCode`.

It needs an **owner answer** first: may a cancelled award order be replaced (WP5ADJ Q4)? Then **M-ORD1** and UM-ORD1. Otherwise: register, recorded.

**AWARD-CODING** (:1110, :784; P2 proposed). If rated P1, follow F-3: the award line map copies `costCodeId`, `budgetLineId` and `boqItemId`, with no schema change. Then **M-COD1** and UM-COD1. KA.R4.lineCoding.087 (a build record) then reads STORED-PRE-FIX. Otherwise: register.

**RCV-LIST** (:1112, :786; P3 proposed: no consumer). Recorded, not fixed, unless rated P1. If it is, follow F-4 (one constant {issued, acknowledged, partial}), then **M-RCV1** and UM-RCV1. That fix edits `goods-receipt.service.js`, M-OVER's file, so M-OVER is re-run on the final code (section 7.6).

**For every landed fix:**
- Its known answers turn into defect checks: `DECIDED_RED` extends itself when `FIXES` is set, and their `today` then fails.
- Its CF must read REJECTED.
- A build record observed before the fix commit reads STORED-PRE-FIX.

Any `wrong` known answer is a failure to classify on paper first (A10): a product change since the book, a proof bug or a wrong derivation.

### 4.2 Waits for an owner decision (no change before it)

| Row | What WP-5 observes | Today | Recommendation (plan section 5) | After an implementing commit |
|---|---|---|---|---|
| HR-C8 (:1076) | KA.O2.forceWithReason, receiveAfterClose, fullyReceivedClose, KA.O3.cancelAfterDelivery, the two stored closes, CF.HRC8 | no close after any delivery; the wrong cancel code | partial -> closed with force and a reason, received -> closed, cancel after delivery 409 PO_CANCEL_AFTER_DELIVERY | `FIXES['HR-C8']`, `CONTRACT['HR-C8'].cancelCode`; the four live KAs judged on the value; the stored ones STORED-PRE-FIX until the builder changes (R5ADJ B5); **the complements list is retired before the commit is run on :55433**; M-PCL1 from the diff supersedes M-PCL0 |
| HR-C5 (:1073) | KA.D5.priceVarianceApproval, KA.D6.invoiceSideVerdict, CF.HRC5 (and KA.D5.overInvoicedLedger with WP5-SVC-1) | the match is advisory | a blocking verdict refuses approval unless overridden with a reason | its fix mutation is named then (fix list `notNamed`); M-DCL re-run (its file changes) |
| HR-C7 (:1075) | O7.J.ignoredFields, KA.N6.*, CF.HRC7 | ignored fields; issuedQty never raised | the issue raises issuedQty; the door honours or refuses the fields | likewise |
| HR-C9 (:1077) | KA.O6.refCollision, CF.HRC9 | the scan crosses projects | 409 or projectId required | likewise; M-OVER re-run if `goods-receipt.service.js` changes |
| HR-C6 (:1074) | KA.N2.*, KA.N3.*, KA.D4.*, CF.HRC6 | L35, L36, X-FINANCE-1 | CERT-5 decides | recorded only |
| AWARD-ONE-ORDER F-2 | - | - | may a cancelled award order be replaced? | before F-2 |
| WP0-INV-1 vs HR-C9 | CF.INV1 | P2 vs proposed P1, the same authorisation class | align the two | - |
| WP5-AWD-1 | CF.AWD1 | no not-the-lowest justification | P3, or EXPECTED BEHAVIOUR | - |

---

## 5. Known answers and where each check runs

### 5.1 What the primary run WILL report (no fix set; so nobody mistakes them for new failures)
- **Green: 6 setup + 88 HARD + 4 STORED, and G.5xx.** No decided-rule red: WP-5 has none (WP5-PREP section 0 fact 3).
- **28 known answers BLOCKED** (passes, counted apart), by ref:
  - HR-C8: KA.O2.stored.closeShort, KA.O2.stored.closeReceived, KA.O3.cancelAfterDelivery, KA.O2.forceWithReason, KA.O2.receiveAfterClose (not sent: J-C stays partial), KA.O2.fullyReceivedClose;
  - AWARD-CODING: KA.R4.lineCoding.087, KA.R4.lineCoding.J;
  - AWARD-ATOMIC: KA.R2.concurrentConfirms (racy);
  - AWARD-ONE-ORDER: KA.R3.secondOrder;
  - RCV-LIST: KA.O5.receivableList.087, KA.O5.receivableList.J;
  - HR-C9: KA.O6.refCollision;
  - L36: KA.N2.returnNeverIssued, KA.N2.stockAfterRefusal, KA.N2.projectCostAfterRefusal, KA.N2.return30After10;
  - X-FINANCE-1: KA.N3.credit, KA.N3.activity, KA.N3.stock;
  - HR-C7: O7.J.ignoredFields, KA.N6.issuedQty, KA.N6.usage50;
  - L35: KA.D4.087, KA.D4.J.invoiceBeforeReceipt;
  - HR-C5: KA.D5.priceVarianceApproval, KA.D6.invoiceSideVerdict;
  - HR-C5+WP5-SVC-1 (R5ADJ P3): KA.D5.overInvoicedLedger.
- **16 confirm-first reported** (a pass): CF.awardAtomic, CF.awardSecondOrder, CF.awardCoding, CF.HRC8, CF.receivableList, CF.HRC9, CF.HRC7, CF.HRC6, CF.L199issue, CF.HRC5, CF.L107, CF.L119, CF.DFUN1delete, CF.SVC1, CF.AWD1, CF.INV1. All are CONFIRMED expected, except CF.HRC9, which may read PARTIAL.

### 5.2 What a final run reports after fixes (only if section 4 landed something)
- For each landed fix, its known answers read **value** (pass).
- Its CF reads **REJECTED**.
- A build record observed before the fix commit (KA.R4.lineCoding.087; after HR-C8, the two stored closes) reads **STORED-PRE-FIX**: a pass, counted apart, reported with the register link.
- Everything else is as section 5.1. Exit 0 and 143/143 are expected.
- If no fix lands, the primary run is also the final run: the WP-5 result, and the baseline every HEAD entry stands on.

### 5.3 Where each check runs (the proof's where-table)

| Where | Checks |
|---|---|
| **J** (throwaway in 087, explicit default retention 10, archived by every run; WP5ADJ Q1): 97 | S.J.create, S.J.fixture, S.J.archived; every writing check and every section 6.2 catcher: JR (R1.J.*, R5.J.*, R2.J.confirmAgain, KA.R2.concurrentConfirms, R3.J.firstOrder, KA.R3.secondOrder, KA.R4.lineCoding.J), JO (O1.J.*, O2.J.*, O4.J.*, KA.O3, KA.O2.forceWithReason / receiveAfterClose / fullyReceivedClose, O7.J.ignoredFields, KA.O5.receivableList.J), JN (N1.J.*, KA.N2.*, N2.J.activityAfterReturn4, KA.N3.*, N4.J.*, N5.J.*, KA.N6.*, N6.J.usage70, N7.J.*), JD (D1.J.*, D2.J.*, D3.J.*, KA.D4.J, D4.J.controlPath, D5.J.*, KA.D5.*, KA.D6, D7.J.balanced), CF.HRC7, CF.L199issue, CF.L107, CF.L119, CF.DFUN1delete |
| **087-COM live** (reads; two refusals before any write): 20 | R1.live.package / ranking / gap / commitment, R1.cancelAwarded (cancelPackage :415), R4.live.awardPoValue, KA.R4.lineCoding.087, O.live.087.statuses, O2.live.087, O2.closeOutstanding.087, O2.forceNoReason.087, KA.O5.receivableList.087, N1.live.087, N.live.087.store, D.live.087.stateCoverage, D.live.087.voidedAfterApproval, KA.D4.087, D5.live.087.priceVariance, D5.live.087.overInvoiced, D7.087.balanced |
| **087-COM stored**: 5 | R1.stored.bids, O2.stored.087, KA.O2.stored.closeShort, KA.O2.stored.closeReceived, N.stored.087 |
| **087-COM-B with 087-COM** (read only): 3 | O6.collision.live, KA.O6.refCollision, CF.HRC9 |
| **052-COM** (a read and two refusals, WP5ADJ Q2): 3 + 1 stored | O2.live.052, O2.closeOutstanding.052, O2.forceNoReason.052; O2.stored.052 |
| **mixed CF** | CF.awardAtomic, CF.awardSecondOrder (J, static); CF.awardCoding, CF.HRC5 (J, 087-COM, static); CF.HRC8 (J, stored 087-COM); CF.receivableList, CF.HRC6, CF.SVC1 (J, 087-COM); CF.AWD1 (stored, 087-COM, static); CF.INV1 (J, 087-COM-B) |
| **setup** | S.book, S.state, S.projects |

### 5.4 Reading notes
- **Races.** J-BP2's two confirms (KA.R2.concurrentConfirms) are one shot. A lucky serialisation reads `value`: a pass and a lead (P4ADJ B5). D2.J.concurrentApprove runs 5 rounds (FIXTURE.d2Rounds) and must be green in every round at baseline (WP5ADJ Q8). The evidence checker treats status shifts of KA.R2.concurrentConfirms, CF.awardAtomic and CF.HRC9 between two runs as racy, never as a flag (section 7.3).
- **The 30 s lapse.** R5.J.expired waits for J-EXP's cover to lapse (WP5ADJ Q10). Every run, mutants included, takes about 1.6 min.
- **No restorations.** No WP-5 mutant needs one: every extra write is on J, archived by the cleanup.
- **Residue.** Each run leaves company-level residue in 087 (section 2.1; R5ADJ P2, WP5ADJ Q6). The cleanup lists it, and the census expects it (section 7.7). 087 is on the enterprise plan, so archived projects never count against a limit.

---

## 6. Targeted proofs, targeted reruns, the final full run

### 6.1 Before any fix
Nothing beyond the primary run: it is the reproduction. A proof defect found in it (a TEST GAP) is fixed in the proof and re-run with the narrowest `--only` that covers it. Then the HEAD baseline must be retaken as a full run on the changed proof before any mutant runs (section 7.3), and `mutsyntax-wp5.js` is re-run (a proof change can move CHECKS or CATCHERS).

### 6.2 Targeted sections after a fix (its `FIXES` entry set)
```
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp5-supply-proof.js --only=JR      # AWARD-ATOMIC, AWARD-ONE-ORDER, AWARD-CODING
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp5-supply-proof.js --only=JO,COM  # RCV-LIST, HR-C8 (J and the 087-COM stored closes)
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp5-supply-proof.js --only=CF      # selects every section CF classifies from
```
The J choreography J0-J8 runs whole whenever one selected check runs on J. A failure goes back to the fix: three iterations, then escalate.

### 6.3 The final full run
One full run on the final code, with every landed WP-5 fix and its `FIXES` set, and no flags (section 2.3 command). The expected answer is section 5.2. Its result is the WP-5 result and the post-fix mutation baseline: copy it to `wp5-supply-proof.final.json` and `wp5-supply-proof.baseline.json`, and record `git rev-parse HEAD` in the journal. If nothing landed, skip this run: the primary run stands, and every HEAD entry's evidence stands on it.

---

## 7. Mutation runs

### 7.1 Lists and runner keys
Claude Main copies the five lists and `wp5-mutation-evidence.js` from `C:\Temp\octapm-cert\scratch\wp5\lists\` into `backend/scripts/cert/cert3/`:
- `wp5-mutations.supply.json`
- `wp5-mutations.complements.json`
- `wp5-mutations.unit.json`
- `wp5-fix-mutations.supply.json`
- `wp5-fix-mutations.unit.json`

**Then** he adds these lines to `LISTS` in `C:\Temp\octapm-cert\mutate-multi.js`, before `'unit-tests'`. Never add them before the files exist: an unfiltered invocation reads every registered list (P4ADJ B11). `check-runner-wp5.js` checked these exact lines.
```js
  // WP-5 (WP5-RUN-PLAN.md section 7): judged by named-catcher flips against a baseline (wp5-mutation-evidence.js); one id per run, "--only=<id>," with --lists=.
  'wp5-supply': ['scripts/cert/cert3/wp5-supply-proof.js', true, 'wp5-mutations.supply.json'],
  // HEAD-only complements of the PO close guard: never run once HR-C8 lands (they would close 087-COM PO-C and 052-COM PO-O2).
  'wp5-complements': ['scripts/cert/cert3/wp5-supply-proof.js', true, 'wp5-mutations.complements.json'],
  'wp5-unit': [null, false, 'wp5-mutations.unit.json'],
  // WP-5 fixes (HR-C8, AWARD-ATOMIC, AWARD-ONE-ORDER, AWARD-CODING, RCV-LIST when they land): every entry pending until then.
  'wp5fix-supply': ['scripts/cert/cert3/wp5-supply-proof.js', true, 'wp5-fix-mutations.supply.json'],
  'wp5fix-unit': [null, false, 'wp5-fix-mutations.unit.json'],
```
The two fix keys can be registered now: their `mutations` are `[]`, so the runner runs nothing from them. Registering them only when the first fix entry moves into `mutations[]` is equally fine.

`mutsyntax-wp5.js`, `teeth-mutsyntax-wp5.js`, `check-runner-wp5.js` and `selftest-evidence-wp5.js` stay in the scratch folder (as WP-4's do).

Ids are checked in two ways:
- Every `catchers`, `collateral`, `racy`, `shifts[].id` and `unchanged` id, and every check id an `expect` names, is a CHECKS id (or G.5xx).
- The catchers equal the proof's CATCHERS or FIX_CATCHERS. Every key of CATCHERS, FIX_CATCHERS and COLLATERAL has an entry. No WP-5 id is used by another registered list: 26 lists read, 0 clashes (`mutsyntax-wp5-report.json`).

These entries are recorded in their lists and never run by the runner, which reads `mutations` only:
- the equivalent M-DCX (`equivalent`);
- the pending fix entries M-PCL1, M-AWD1, M-ORD1, M-COD1, M-RCV1 and their unit sides (`pending`).

**The proof has no OPTIONAL_CATCHERS**, and no WP-5 adjudication asks for optional mutants. Following WP-4, the variants (M-PCL0i, M-PCL0k, M-AVLa, M-AVLb) stay in the section 6.2 list: run, not tallied. The one separate, untallied list is the complements list, a drafting choice made for safety (section 13.3).

### 7.2 Mutant syntax (no DB, no lock)
**At drafting** (`node C:\Temp\octapm-cert\scratch\wp5\lists\mutsyntax-wp5.js`) on HEAD `2a2efd2`:
- Every section 6.2, complement, equivalent and unit anchor occurs once and every mutant parses on HEAD. The same holds on **preWp5Sim**: HEAD with the simulated WP-2 batch (r3c) and HR-C1 fix copies overlaid.
- Lines (HEAD = sim):

  | Mutant | File | Line(s) |
  |---|---|---|
  | M-PCL0 | purchase-order.service.js | :121 + :122 |
  | M-PCLg | purchase-order.service.js | :633 + :642 |
  | M-AWD0 | bid.service.js | :1035 |
  | M-OVER | goods-receipt.service.js | :635 |
  | M-AVL | inventory.service.js | :1031 + :756 |
  | M-DCL | direct-cost.service.js | :483 |
  | M-DCK | cost-ledger.service.js | :114 |
  | M-DCX | cost-ledger.service.js | :318 |
- The pending entries' loci occur once at HEAD and on the sim. The only move is M-AWD1's `commitment.service.js` locus, :549 -> :557 under the HR-C1 sim.
- No sim touches a file a WP-5 edit names.
- 0 problems. Teeth (`teeth-mutsyntax-wp5.js`): 21 kinds of break, all reported. The mutated copies are in `lists\mutsyntax\`.

**On the day**, before the HEAD batch, run `node mutsyntax-wp5.js` again: the tree has moved (the WP-2 batches, the HR-C1 fix; see the re-scan list below). Expected: 0 problems and no `ANCHOR DRIFT` on the six WP-5 files.

**After a WP-5 fix:**
1. Re-derive its entry's `from` / `to` on the real fix diff.
2. Move it into `mutations[]`.
3. Run `node mutsyntax-wp5.js --post-fix`: every list, the fix lists included, must apply once on the fixed worktree and parse.

An anchor found 0 or 2+ times is NOT APPLIED by the runner. A mutant that does not parse would be "caught" by a crash and proves nothing.

**Anchors to re-scan after the WP-2 batches land** (and after the HR-C1 fix and any CONVERT-ATOMIC / CCO-PARENT fix of WP-4). `mutsyntax-wp5.js` re-scans all of them in one command:
- the HEAD edits:
  - `purchase-order.service.js` :121, :122, :633, :642;
  - `bid.service.js` :1035;
  - `goods-receipt.service.js` :635;
  - `inventory.service.js` :756, :1031;
  - `direct-cost.service.js` :483;
  - `cost-ledger.service.js` :114, and :318 for the equivalent.
- the pending loci:
  - `purchase-order.service.js` :123, :551;
  - `bid.service.js` :1033, :1049;
  - **`commitment.service.js` :549** (edited by the HR-C1 fix and by WP-4's CCO-PARENT if it lands; :557 under the HR-C1 sim);
  - `procurement.service.js` :1762, :1815;
  - `goods-receipt.service.js` :197.
- the six unit suites' titles:
  - `purchase-order.service.test.js` :168, :177, :375;
  - `bid.service.test.js` :247;
  - `goods-receipt.service.test.js` :407;
  - `inventory.service.test.js` :474, :504;
  - `direct-cost.service.test.js` :392;
  - `cost-ledger.repost.test.js` :39, :60.

The r3c fix plans of the WP-2 batch and the HR-X1 batch name none of the six WP-5 product files and none of the six suites; `peek-wp2-files.js` lists every file name they cite. So no drift is expected, but the scan is the proof.

### 7.3 Runner and baseline: how a mutant is judged (the WP-4 design, R5ADJ L1)
**The problem.** `mutate-multi.js` scores any non-zero exit CAUGHT. At HEAD the unmutated WP-5 proof exits 0, so the runner's column points the right way. But a setup error, an unrelated red or a stray 5xx would read CAUGHT just the same, and after an owner rule lands the decided reds would make every mutant read CAUGHT, as in WP-4.

**The decision.** Every proof-backed mutant is judged by `wp5-mutation-evidence.js`. The test is its **named catchers flipping from PASS in a baseline result to FAIL under the mutant, on the same tree**. The exit code is never the test.

**Why it is sound** (the WP-4 argument, unchanged).
1. Every HEAD catcher (O2.J.issued.forceWithReason, O2.J.ack.forceWithReason, R2.J.confirmAgain, O4.J.overOrder, N1.J.issue41, N1.J.issue41bin, D2.J.concurrentApprove, D2.J.ledger, and for the complements O2.J.issued.closeOutstanding, O2.J.closeOutstanding, O2.closeOutstanding.087 / .052, O2.J.issued.forceNoReason, O2.J.forceNoReason, O2.forceNoReason.087 / .052) PASSES at HEAD. None is a known answer. The checker refuses a catcher that is not PASS in the baseline. For a known answer, BLOCKED or STORED-PRE-FIX is not PASS. So a pending fix entry judged on the HEAD baseline reads NO EVIDENCE (self-test: M-RCV1).
2. The baseline's own reds (`meta.decidedRed`, none at HEAD) are excluded from "unexpected". A baseline red turning green under a mutant is flagged.
3. "Not run" is never evidence. A run that ends in exit 1 still counts when its catchers ran and failed (the WP-1 C1 / I1 precedent).
4. Every other red under the mutant must be named collateral, with its derivation (`collateralWhy`), or the entry reads CAUGHT, FLAGGED. Non-red status changes are reported as named (`shifts`), racy or unnamed.
5. The baseline must be a clean comparator: a full run, no setup error, G.5xx green, and every FAIL a decided red. A red outside them counts only when named with `--accept-baseline-red=<ids>`, and only for a red classified by name in the journal with its register row (R5ADJ L5). Otherwise the baseline is VOID. Each mutant result must carry the same `FIXES`, answer book and check ids as its baseline, and must start after the baseline finished.
6. What the result files cannot prove (that no product file changed between the baseline and the mutant) is a procedural rule:
   - no product or proof commit between the baseline and the mutants of a batch;
   - `git rev-parse HEAD` and `git status --porcelain backend/src backend/scripts/cert/cert3` recorded at the baseline and at each invocation;
   - after any such commit, a new full baseline before the next mutant.

**WP-5 specifics.**
- **`racy[]`** names a catcher whose flip depends on timing. For M-DCL it is **G.5xx**: a loser of the race answers 500 or 200, and only a 500 turns G.5xx red. The entry is CAUGHT when D2.J.concurrentApprove flips, and a G.5xx that stays green is reported. For the pending M-AWD1, every catcher is racy. A survivor gets **one marked rerun** into its own directory, judged with `--rerun --ids=M-AWD1` (WP5ADJ Q8; WP5.mutations.awardLock).
- **`headOnly: HR-C8`** marks the complements. The checker reads NO EVIDENCE for a complement judged on a baseline whose `FIXES['HR-C8']` is set (self-test: M-PCLga).
- **The E6 tally needs both entries of guard 5** (M-DCL and M-DCK). For guards 1 and 2, a judged entry that `supersedes` another (M-PCL1, M-AWD1) replaces it.

**The baseline files** (the checker's defaults):
- **HEAD lists** (`--lists=supply,complements`): `C:\Temp\octapm-cert\results\cert3\wp5-supply-proof.baseline-head.json`. This is the primary run's copy (section 2.3), as long as nothing changed since. Otherwise take one unmutated full run on the current tree and copy it there. The primary run is a valid baseline for the mutants that follow it: each run makes its own J, and the deep projects are only read or refused.
- **Fix lists** (`--lists=fix`): `C:\Temp\octapm-cert\results\cert3\wp5-supply-proof.baseline.json`, the final full run on the fixed code (section 6.3).

**Verdicts** (per entry; the checker's header carries the same text):
- **CAUGHT**: every named catcher PASS in the baseline and FAIL (ran) under the mutant. Every other red is named collateral or a baseline red. No baseline red turned green. A racy catcher that did not flip is reported when every deterministic catcher flipped.
- **CAUGHT, FLAGGED**: the catchers flipped, but an unnamed red appeared or a baseline red turned green. Not counted until classified.
- **SURVIVED**: every named catcher ran and is still PASS under the mutant. That is a guard with no live teeth: a TEST GAP, or a wrong list.
- **NO EVIDENCE**: no result file; a VOID or mismatched baseline; a stale result; a catcher not PASS in the baseline; a catcher not run or missing under the mutant; only some catchers flipped; a HEAD-only complement on an HR-C8 baseline.

### 7.4 Running: one mutant per invocation, the result copied after each
- Never run while a build, another proof, Codex or the full jest suite is running.
- One command line each.
- **Quote the id, end it with a comma, and always name the list.** `mutate-multi.js` treats a value without a comma as a name *prefix*, so `--only=M-AVL` would also run M-AVLa and M-AVLb, `--only=M-PCL0` M-PCL0i and M-PCL0k, and `--only=M-PCLg` M-PCLga and M-PCLgb (`check-runner-wp5.js` lists them all). PowerShell drops an unquoted trailing comma. Ids such as M1 or G1 repeat across other lists.
```
cd <worktree>\backend
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp5-mutations.M-OVER.json --lists=wp5-supply "--only=M-OVER,"; Remove-Item Env:CERT_LOCK_HELD
New-Item -ItemType Directory -Force C:\Temp\octapm-cert\results\cert3\wp5-mutations | Out-Null; Copy-Item C:\Temp\octapm-cert\results\cert3\wp5-supply-proof.json C:\Temp\octapm-cert\results\cert3\wp5-mutations\M-OVER.json
```
**HEAD batch** (after the primary run and its classification, with the HEAD baseline in place):
- `--lists=wp5-supply`: M-PCL0, M-PCL0i, M-PCL0k, M-AWD0, M-OVER, M-AVL, M-AVLa, M-AVLb, M-DCL, M-DCK.
- Then `--lists=wp5-complements`: M-PCLg, M-PCLga, M-PCLgb. Only while `FIXES['HR-C8']` is empty and no HR-C8 implementation is on the tree.
- Each mutant is followed by its copy: 13 proof runs of about 1.6 min each, about 25 min.

Then the unit side. First the unmutated suites must pass; a red suite would score every unit mutant CAUGHT.
```
npx jest src/services/__tests__/purchase-order.service.test.js src/services/__tests__/bid.service.test.js src/services/__tests__/goods-receipt.service.test.js src/services/__tests__/inventory.service.test.js src/services/__tests__/direct-cost.service.test.js src/services/__tests__/cost-ledger.repost.test.js
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp5-mutations.unit.json --lists=wp5-unit; Remove-Item Env:CERT_LOCK_HELD
node scripts/cert/cert3/wp5-mutation-evidence.js --lists=supply,complements --unit-results=C:\Temp\octapm-cert\results\cert3\wp5-mutations.unit.json
```
**What the checker prints:**
- the baseline's validity;
- per entry: the verdict, each catcher's baseline -> mutant status, the collateral and which of it went red, any unexpected red, any baseline red turned green, the shifts (named / racy / unnamed), the notes (a racy catcher not flipped, a setup error after the catch), the known-answer tally and the 5xx count;
- `E6 (section 6.2 WP-5 guards): n/5`;
- the unit verdicts: `CAUGHT BY NAMED TESTS` when every title in the entry's `tests` appears in a jest failure line.

Expected at HEAD: 13 CAUGHT, unit 12/12, `E6 ... 5/5`. Exit 0 when every judged entry is as its list expects. As a dry run at drafting, with no baseline yet: `NO EVIDENCE: no result file` for each entry, `E6 ... 0/5`, exit 2. With the debug result as baseline: `baseline VOID: not a full run`, as designed.

**Post-fix batch**, only if a fix or an implemented owner rule landed (section 4):
1. Take the final baseline (section 6.3).
2. Re-derive the landed entries' `from` / `to` and move them into `mutations[]`.
3. Run `mutsyntax-wp5.js --post-fix`.
4. Run each landed entry with `--lists=wp5fix-supply "--only=<id>,"`, each copied to `wp5-mutations\<id>.json`.
5. For M-AWD1, if it survives: one marked rerun into `results\cert3\wp5-mutations-rerun\M-AWD1.json`, judged with `--rerun --ids=M-AWD1`.
6. Re-run the HEAD entries whose mutated file changed with the fix (section 7.6), into their **own directory** `results\cert3\wp5-mutations-final\<id>.json`.
7. Run the fix-tree suites, the `wp5fix-unit` list in one invocation, then:
```
node scripts/cert/cert3/wp5-mutation-evidence.js --lists=fix --unit-results=C:\Temp\octapm-cert\results\cert3\wp5-fix-mutations.unit.json
node scripts/cert/cert3/wp5-mutation-evidence.js C:\Temp\octapm-cert\results\cert3\wp5-mutations-final --lists=supply --ids=<the re-run ids> --baseline=C:\Temp\octapm-cert\results\cert3\wp5-supply-proof.baseline.json
```
The WP-5 E6 tally for the report is the union of the checker runs. A guard is taken from the run on its current entry: the HEAD batch for M-OVER, M-AVL, M-DCL and M-DCK unless re-run; the fix list for M-PCL1 / M-AWD1 once they supersede.

### 7.5 Expected per mutant (the lists carry the derivations; derived, not observed)

| Id | List | Runner | Exit | Named catchers (PASS -> FAIL) | Expected collateral (FAIL, or allowed) | Shifts (not red) |
|---|---|---|---|---|---|---|
| M-PCL0 | supply | CAUGHT | 2 | O2.J.issued.forceWithReason, O2.J.ack.forceWithReason (409 PO_TRANSITION_INVALID) | O2.J.issued.receiveAfterClose (J-ISS still issued: 201) | none |
| M-PCL0i | supply | CAUGHT | 2 | O2.J.issued.forceWithReason | O2.J.issued.receiveAfterClose | none |
| M-PCL0k | supply | CAUGHT | 2 | O2.J.ack.forceWithReason | none | none |
| M-AWD0 | supply | CAUGHT | 2 | R2.J.confirmAgain (400 BID_NOT_FOUND for 409 BID_PACKAGE_LOCKED, nothing written) | KA.R2.concurrentConfirms, allowed and racy (wrong only if the confirms serialise) | CF.awardAtomic CONFIRMED -> PARTIAL only then (racy) |
| M-OVER | supply | CAUGHT | 2 | O4.J.overOrder (41 of 40 accepted, 101 / 100) | O2.J.closeOutstanding, O2.J.forceNoReason (409 PO_TRANSITION_INVALID), KA.O2.forceWithReason, KA.O3.cancelAfterDelivery, KA.O2.receiveAfterClose, KA.O5.receivableList.J (wrong: J-C received) | CF.HRC8, CF.receivableList CONFIRMED -> PARTIAL |
| M-AVL | supply | CAUGHT | 2 | N1.J.issue41 (201 issuing 40), N1.J.issue41bin (201 issuing 41) | N1.J.issue40 (201, nothing drawn) | none |
| M-AVLa | supply | CAUGHT | 2 | N1.J.issue41 | N1.J.issue41bin (on hand 50, not 90), N1.J.issue40 | none |
| M-AVLb | supply | CAUGHT | 2 | N1.J.issue41bin | N1.J.issue40 (409 INV_INSUFFICIENT_AVAILABLE) | none |
| M-DCL | supply | CAUGHT | 2 | D2.J.concurrentApprove (no 409 in a round); G.5xx (racy: only when a loser answers 500) | none | none |
| M-DCK | supply | CAUGHT | 2 | D2.J.ledger (one entry of 1,000.00) | D2.J.voidMirror (one reversal of -1,000.00) | none |
| M-PCLg | complements | CAUGHT | 2 | O2.J.issued.closeOutstanding (200 closed), O2.J.closeOutstanding, O2.closeOutstanding.087, O2.closeOutstanding.052 (409 PO_TRANSITION_INVALID, nothing written) | O2.J.forceNoReason, O2.J.issued.forceNoReason, O2.J.issued.forceWithReason, O2.forceNoReason.087, O2.forceNoReason.052 | none |
| M-PCLga | complements | CAUGHT | 2 | O2.J.issued.closeOutstanding (400 PO_CLOSE_REASON_REQUIRED) | O2.J.closeOutstanding, O2.closeOutstanding.087, O2.closeOutstanding.052 (the same 400) | none |
| M-PCLgb | complements | CAUGHT | 2 | O2.J.issued.forceNoReason (200 closed), O2.J.forceNoReason, O2.forceNoReason.087, O2.forceNoReason.052 (409 PO_TRANSITION_INVALID) | O2.J.issued.forceWithReason (J-ISS already closed) | none |
| M-PCL1 (pending) | fix | CAUGHT once HR-C8 is implemented | 2 | KA.O2.forceWithReason, KA.O2.receiveAfterClose, KA.O2.fullyReceivedClose | CF.HRC8 | - |
| M-AWD1 (pending) | fix | CAUGHT once AWARD-ATOMIC lands (racy) | 2 | KA.R2.concurrentConfirms | CF.awardAtomic | - |
| M-ORD1 / M-COD1 / M-RCV1 (pending) | fix | CAUGHT once fixed | 2 | KA.R3.secondOrder / KA.R4.lineCoding.J / KA.O5.receivableList.J + .087 | CF.awardSecondOrder / CF.awardCoding / CF.receivableList | - |
| UM-PCL0, UM-PCL0i | unit | CAUGHT | jest red | 'close: likewise; issue and acknowledge leave the alerts alone' | - | - |
| UM-PCLg | unit | CAUGHT | jest red | 'refuses to close an order with deliveries outstanding', 'closes short only when forced and told why' | - | - |
| UM-PCLga / UM-PCLgb | unit | CAUGHT | jest red | the first / the second of those | - | - |
| UM-AWD0 | unit | CAUGHT | jest red | 'levels submitted bids with plugs, exports XLSX, soft-awards and creates the commitment SOV on confirmation' | - | - |
| UM-OVER | unit | CAUGHT | jest red | 'refuses to take more than was ordered' | - | - |
| UM-AVL, UM-AVLa | unit | CAUGHT | jest red | 'counts the whole warehouse before refusing an issue', 'refuses to issue stock that is not there' (the INV_INSUFFICIENT_STOCK leg of :1031) | - | - |
| UM-DCL | unit | CAUGHT | jest red | 'CX21-204: a submit and an approve each refuse when the status moved under the lock' | - | - |
| UM-DCK, UM-DCX | unit | CAUGHT | jest red | 'posts once, refuses the same event twice, and posts again once the first posting is reversed', 'a second reversal frees the second posting for a third' | - | - |

The runner's column is CAUGHT for every live entry at HEAD, as at WP-4's: any non-zero exit. Only the checker's verdict counts.

### 7.6 What counts where: the E6 tally
**E6 (plan section 6.2 WP-5, five guards)** is tallied on these entries only:

| Guard | Entry at HEAD | Entry after its fix |
|---|---|---|
| PO close transitions | **M-PCL0** | **M-PCL1**, once HR-C8 is decided and implemented |
| the award lock | **M-AWD0** | **M-AWD1**, once the atomic award confirmation lands |
| RECEIPT_OVER_ORDER | **M-OVER** | - |
| INV_INSUFFICIENT_AVAILABLE | **M-AVL** | - |
| one posting per direct-cost line | **M-DCL and M-DCK**, both | - |

A guard counts when its current entries are CAUGHT (clean, not FLAGGED). E6 can be met at **5/5 at HEAD**, and is met on the final code when every guard's current entry stands on it.

**Which code each entry's evidence stands on** (R5ADJ L2, the WP-4 section 7.6 rule). A HEAD entry's evidence stands on the final code when two things hold:
- its mutated file is byte-identical on the final tree;
- the proof diff since its baseline touches none of its catchers (`git diff <baseline sha> <final sha> -- <file> backend/scripts/cert/cert3/wp5-supply-proof.js`, read for the catcher ids).

Otherwise the entry is re-run against the final baseline (its own result directory and `--ids`, section 7.4). Expected:

| Change | Entries affected |
|---|---|
| HR-C8 (`purchase-order.service.js`) | M-PCL0 / M-PCL0i / M-PCL0k re-run if kept beside M-PCL1. The complements are retired (journal note). |
| AWARD-ATOMIC (`bid.service.js`) | M-AWD0 superseded by M-AWD1; re-run only if it still applies and is kept as the sequential guard's evidence. |
| RCV-LIST, HR-C9, HR-C7 or WP5-SVC-1 (`goods-receipt.service.js`) | M-OVER re-run |
| HR-C5 or WP5-SVC-1 (`direct-cost.service.js`) | M-DCL re-run |
| AWARD-ONE-ORDER, AWARD-CODING (`procurement.service.js`) | no HEAD entry's file |
| the WP-2 batches, the HR-C1 fix | none of the six files |

**Variants** (run, not tallied): M-PCL0i, M-PCL0k, M-AVLa, M-AVLb. **Complements** (HEAD only, run, not tallied): M-PCLg, M-PCLga, M-PCLgb.

**Equivalent, not run:** M-DCX, the ledger key pre-check (the unique index answers the same for every proof step; section 13.1).

**Fix mutations** (plan section 1.4, not section 6.2): M-ORD1, M-COD1, M-RCV1 (pending). For HR-C5, HR-C7, HR-C9 and WP5-SVC-1, none is named yet (the fix list's `notNamed`).

**Unit side** (not evidence, plan section 1.4): 12 entries at HEAD. UM-AWD1, UM-PCL1, UM-ORD1, UM-COD1 and UM-RCV1 are pending. There is no unit catcher for M-PCL0k or M-AVLb, and none asserts INV_INSUFFICIENT_AVAILABLE (section 13.2).

### 7.7 Cleanup and census after the lists (plan section 7)
- **No restore after any WP-5 list** (section 2.1). The stored effects of the mutants are all on J, and every J is archived by the proof's cleanup:
  - J-ISS received into J-INV1 (M-PCL0*);
  - J-ACKC left acknowledged;
  - J-C over-received (M-OVER);
  - J-CEM issued past its reservation (M-AVL*);
  - J-DC3 rounds approved twice (M-DCL);
  - J-DC2 under-posted (M-DCK);
  - J-ISS closed by a plain or reasonless close (complements).
- **Census**, once after each batch:
  1. Run `node scripts/cert/isolation/fingerprint.js take wp5-post`, then `node scripts/cert/cert3/build/fingerprint97.js cert3-post wp5-post` (exit 0: the 97 other companies unchanged). Its `.e2.json` lists 087's changed pairs. They must be only:
     - J's tables: projects, activities, BOQ, cost codes and budget lines, purchase orders and lines, receipts, stock balances and movements, reservations, transfers, bid packages, bids and invitations, commitments, direct costs and payments, the ledger, cash flow, team, audit;
     - the company-level residue: directory vendor companies and their prequalification, warehouses, bins and items;
     - the request-noise tables.

     Nothing may change on 052 or on the 087-COM / 087-COM-B rows. If anything wrote after the restore other than WP-5 runs, compare against a fingerprint taken right after the restore instead.
  2. The last proof run's throwaway check: 0 live `CERT3 WP5 Supply` projects.
  3. Record the census in the journal.
- **Never commit a mutated tree.** After every invocation, `git status` must show no product diff that is not the batch's. `mutate-multi.js` restores byte for byte and keeps backups in `C:\Temp\octapm-cert\mutate-backups\`. A RESTORE FAILED line stops everything until the file is restored by hand.

---

## 8. Codex (plan section 6.4; owner rule 5)
- **Required for WP-5, only if a fix lands:**
  - (a) the adversarial **plan review** of the AWARD-ATOMIC fix plan before any code (it creates commitments: high risk), and of AWARD-ONE-ORDER (a migration) if rated P1;
  - (b) the **diff review** of each landed product diff after its mutations;
  - (c) the same pair for an implemented owner rule of the money paths (HR-C5, HR-C8).
- **Not required for** the proof, the lists, this plan or answer-book edits (test side): `/code-review` covers them. If nothing lands, WP-5 needs no Codex pass.
- Rounds stop when nothing CRITICAL or HIGH is open; at most 3, then escalate.
- Mechanics follow memory `octapm-codex-review.md`: the desktop app's `codex.exe`, one whole pass per five-hour window, prompt and output in `scratch\wp5\`. Never run Codex during a build, a proof, a mutation list or the full suite.

## 9. Code review
`/code-review` (high) runs on the WP-5 batch before its commit. It covers:
- any proof edit (a TEST GAP fix; the COLLATERAL table note, section 13.3);
- the five lists and the evidence checker;
- this plan;
- the book's notes;
- any WP-5 product diff and its tests.

Findings are adjudicated like Codex's. A finding that changes the proof is followed by one full proof run (a new baseline) and a rerun of only the mutants whose catchers it touches.

## 10. Commit and push
No merge of `main` into `cert/full-saas-certification`: the owner rule overrides CLAUDE.md's "pull origin/main before committing". Each commit is pushed:
1. each landed fix, before its `FIXES` entry is set;
2. the WP-5 batch, `cert(CERT-3 WP-5): <one line>` (lists, evidence checker, run plan, any proof edit, `FIXES` if set, results summary);
3. the docs (journal, workflow report, register, moment map: the WP-5 deviation rows 144, 148, 150, 151 if not yet recorded, WP5ADJ Q1).

Messages end with the attribution line the committing session gives. `mutate-multi.js` lives in `C:\Temp` and is not committed; its five keys are recorded in the journal.

## 11. Journal
`OCTAPM_CERT_JOURNAL.md`, in the same heading style. It records:
- the restore and the migrations re-applied;
- the primary run: pass / fail / known answers by status, exit, the two copies and the sha;
- the classification table, with the final severities (WP5ADJ Q3);
- the HEAD mutation batch: per mutant the evidence verdict with its named catchers, collateral and shifts; any FLAGGED entry and how it was classified; the unit results; E6 5/5;
- each fix route, if any: plan, Codex rounds, adjudication, commit, `FIXES`, targeted and full runs, the post-fix batch;
- the TEST GAPs (section 13.1) and the census;
- the reviews;
- the owner questions (section 13.4);
- the next exact action: restore `cert3d`, re-apply the landed migrations, WP-6.

## 12. The WP-5 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register

Add `## WP-5 Supply chain - <CLOSED | IN PROGRESS> (<date>)` after WP-4, in the WP-0 section's shape. The result column holds `passed/total`, the exit code, and every known answer's ref.

| Rule or item (plan WP-5) | Evidence (final check ids) | Result |
|---|---|---|
| Bids: states, refusals, ranking (:748) | R1.stored.bids, R1.live.*, R1.cancelAwarded, R1.J.* | |
| Prequalification at award (:752) | R5.J.overLimit, R5.J.overLimitOverride, R5.J.expired | |
| The award lock (:749, :1149) | R2.J.confirmAgain; mutation M-AWD0 (section 6.2); M-AWD1 if fixed | |
| Atomic award confirmation (:782, :1110) | KA.R2.concurrentConfirms, CF.awardAtomic | BLOCKED AWARD-ATOMIC or Fixed at `<sha>` |
| One order per award (:750, :783) | R3.J.firstOrder, KA.R3.secondOrder, CF.awardSecondOrder | BLOCKED AWARD-ONE-ORDER (P2 register) or Fixed |
| Award order coding (:751, :784) | R4.live.awardPoValue, KA.R4.lineCoding.*, CF.awardCoding | BLOCKED AWARD-CODING or Fixed |
| PO approvals and refusals (:754) | O1.J.* | |
| PO close transitions (:755-756, :1149) | O2.J.*, O2.*.087 / .052, KA.O2.*, KA.O3, CF.HRC8; mutations M-PCL0 (section 6.2), M-PCL0i, M-PCL0k, complements M-PCLg* | HR-C8 owner |
| Receipts: RECEIPT_OVER_ORDER and the other codes (:757, :1149) | O4.J.*; mutation M-OVER (section 6.2) | |
| The receivable list (:758, :786) | KA.O5.*, CF.receivableList | RCV-LIST P3 |
| The reference scan (:759, :787) | O6.collision.live, KA.O6.refCollision, CF.HRC9 | HR-C9 owner |
| Ignored fields, issued quantity (:760, :767, :788) | O7.J.ignoredFields, KA.N6.*, N6.J.usage70, CF.HRC7 | HR-C7 owner |
| Inventory: INV_INSUFFICIENT_AVAILABLE and the stock rules (:762-768, :1149) | N.stored.087, N1.*, N2.J.activityAfterReturn4, N4.J.*, N5.J.*, N7.J.*, N.live.087.store; mutation M-AVL (section 6.2), M-AVLa, M-AVLb | |
| Returns and stocked-material cost (:763-764, :773, :789) | KA.N2.*, KA.N3.*, KA.D4.*, CF.HRC6 | CERT-5 (HR-C6) |
| Direct costs: states, one posting per line, payments (:770-772, :1149) | D1.J.*, D2.J.*, D3.J.*, D.live.087.*; mutations M-DCL, M-DCK (section 6.2); M-DCX equivalent | |
| The three-way match (:774, :791) | D5.*, KA.D5.*, KA.D6, CF.HRC5, CF.SVC1 | HR-C5 owner; WP5-SVC-1 P2 |
| Reconciliation (:775) | D7.087.balanced, D7.J.balanced | |
| Confirm-first items (:781-793) | CF.* (`observations.confirmFirst`) | 16 reported |
| Known answers | section 5 of this plan | 28 BLOCKED with refs (values once fixed) |
| Mutations (E6) | `results\cert3\wp5-mutations\<id>.json`, the unit results, the `wp5-mutation-evidence.js` output | 5/5 section 6.2 guards; variants; complements; TEST GAPs named |
| Reviews (E11) | Codex reviews of any landed fix; `/code-review` | |

Register (`OCTAPM_LAUNCH_BLOCKERS.md`):
- AWARD-ATOMIC, AWARD-ONE-ORDER, AWARD-CODING and RCV-LIST with their classification, severity and, if fixed, the sha;
- WP5-SVC-1 (scope wider than registered: every received PO line), WP5-AWD-1, WP0-INV-1 and D-FUN-1 with this run's classification;
- L107, L119 and L199;
- the TEST GAPs of section 13.1;
- HR-C5, HR-C7, HR-C8 and HR-C9 as owner questions; HR-C6 for CERT-5.

---

## 13. Limitations, TEST GAPs and notes (the lists refer here)

### 13.1 Mutations the live proof cannot catch
- **M-DCX** (the ledger key pre-check dropped). It is equivalent for every proof step: the unique index on (orgId, sourceKey) answers the same, already_posted. It is NOT equivalent in general: with the pre-check gone, a re-approval after a reversal collides with the reversed key (CX21-006's :r2 path) and aborts its transaction. No WP-5 step re-approves a reversed cost, so its only catcher is the mocked UM-DCX: a TEST GAP of the live proof, outside the section 6.2 guard, recorded (the M-CEILb precedent).
- **M-AWD0 is caught on the code, not on a write.** Without the pre-check, the bid lookup (:1037) still refuses the sequential second confirm, so the proof sees 400 BID_NOT_FOUND instead of 409 BID_PACKAGE_LOCKED. That is the HEAD guard's only observable at HEAD (WP5-PREP fact 6). The concurrent race is M-AWD1's, after the fix.

### 13.2 No unit catcher
- M-PCL0k: no case closes an acknowledged order.
- M-AVLb: no case issues from a named bin past its reservation.
- No suite asserts INV_INSUFFICIENT_AVAILABLE. UM-AVL and UM-AVLa are caught through the INV_INSUFFICIENT_STOCK leg of the same `if` (reserved 0).

These are listed in `wp5-mutations.unit.json` `noUnitCatcher` so nobody looks for one. Adding unit tests is allowed only inside a fix batch, never as a new requirement.

### 13.3 Notes for the integration owner (drafting choices; adopt or change)
- **The complements list.** The task's template asks for "optional mutants in a separate untallied list where the adjudication says so". The WP-5 proof has no `OPTIONAL_CATCHERS` table and no WP-5 adjudication names optional mutants. WP5ADJ Q7 makes M-PCLg HEAD-only. So the variants stay in the section 6.2 list (the WP-4 pattern), and the HEAD-only complement M-PCLg with its two variants gets its own key, `wp5-complements`, with `headOnly: HR-C8`, which the evidence checker enforces. The point is that no post-HR-C8 invocation of the section 6.2 list can reach a mutant that would close a deep order. Folding them back into `wp5-mutations.supply.json` is a one-line change if preferred.
- **Proof COLLATERAL table vs the lists.** The proof's COLLATERAL (:632-643) is descriptive, and four derived collateral ids are missing from it:

  | Mutant | Missing collateral |
  |---|---|
  | M-OVER | KA.O3.cancelAfterDelivery, KA.O2.receiveAfterClose (J-C reads received, the todays need partial: wrong) |
  | M-AVLa | N1.J.issue41bin (on hand 50, not 90) |
  | M-PCLgb | O2.J.issued.forceWithReason (J-ISS already closed) |

  M-AWD0's racy KA.R2.concurrentConfirms is also absent. The lists name all of them with their derivations. Adding them to the proof table is an optional one-line edit per entry: no check depends on the table's text, and it would make `mutsyntax-wp5.js`'s COLLATERAL cross-check two-way.
- **RACY set.** The checker treats status shifts of KA.R2.concurrentConfirms, CF.awardAtomic and CF.HRC9 as racy (the R5ADJ debug note for CF.HRC9). Confirm CF.HRC9's inclusion: it is state-dependent rather than timing-dependent.
- **M-DCL and G.5xx.** The proof's CATCHERS names G.5xx for M-DCL, but a 500 occurs only when the loser meets the unique index mid-transaction. The list marks G.5xx `racy`, so the entry is CAUGHT on D2.J.concurrentApprove alone, with G.5xx reported. If all five rounds serialise and D2.J.concurrentApprove survives, that is a finding to classify, not a rerun: Q8's rerun is for expensive rounds, and the D2 rounds are cheap.
- **Fix mutations not yet named.** HR-C5, HR-C7, HR-C9 and WP5-SVC-1 have no fix mutation in the proof's tables or the book. Each is derived with its implementing commit (plan section 1.4). The fix list's `notNamed` records this, and no catcher is guessed.

### 13.4 Owner questions (listed, not answered)
- HR-C5, HR-C7, HR-C8, HR-C9: the four undecided WP-5 rules (plan :1073, :1075-1077).
- AWARD-ONE-ORDER (F-2): may a cancelled award order be replaced (WP5ADJ Q4)?
- WP0-INV-1 (P2 registered) against HR-C9 (P1 proposed), the same in-company authorisation class: align them (WP5ADJ Q3).
- WP5-AWD-1: P3, or EXPECTED BEHAVIOUR with the prequalification override as the record (WP5ADJ Q3)?
- HR-A1 (plan :16): J's vendor prequalification needs the company admin (the PM persona in 087); noted in S.J.fixture.

---

## 14. Hazards (read before running)
- **Population.** `cert3d` must exist and the population must be complete: 087-COM, 087-COM-B and 052-COM with their state files. This is the first full D2 execution. `mutate-multi.js` cannot pass flags.
- **One writer.** Proofs run only through `run-locked.js`; a mutation list holds the lock for the whole invocation; no build, Codex or full jest suite at the same time (OPS-1).
- **The checker is the evidence.** The runner's CAUGHT is any non-zero exit. Only `wp5-mutation-evidence.js`, against a valid baseline on the same tree, counts (section 7.3).
- **Registration order.** The WP-5 keys go into `LISTS` only after the five list files exist in `backend/scripts/cert/cert3/`.
- **Invocation form.** Quote `--only` values with a trailing comma and always give `--lists=` (section 7.4). Run one id per invocation and copy the result after each, before the next run overwrites it.
- **Never run `--lists=wp5-complements` once HR-C8 is implemented on the tree.** M-PCLg* would then close 087-COM PO-C and 052-COM PO-O2. Retire the list (journal note) in the same batch as the HR-C8 commit. The evidence checker refuses to judge them on an HR-C8 baseline, but the write would already have happened.
- **Fix keys.** Never run `--lists=wp5fix-supply` before an entry has moved into `mutations[]`: it runs nothing.
- **After any product or proof commit:** run `mutsyntax-wp5.js` again, take a new full baseline before the next mutant, and re-derive (A10) any list `expect` the change moves.
- **Fix commits.** Never amend a fix commit once `FIXES` names it: `S.state` checks the time against git.
- **The cert API** is never (re)started while a mutant is applied.
- **Migrations after a restore.** The HR-C1 migration and backfill, and any WP-2 batch migration, are re-applied after every restore of `cert3d`, with the API down. A pre-migration snapshot with the post-fix client fails at the first query.
- **Races** (section 5.4): never rerun the primary run for a reading; no retry at baseline (WP5ADJ Q8).
- **State files** are not in the snapshot: never run a builder after `cert3d` without taking it again.
- **Secrets.** `CERT_PASSWORD` is used only through `lib/api.js`. Results and logs are scrubbed by the harness. Never paste a token or a password into the journal. Portal tokens stay in memory (the proof's header).
