# CERT-3 WP-3 run plan (earned value, reporting periods, forecast)

Plan `docs/certification/OCTAPM_CERT3_PLAN.md` §7 step 4 (:1186), for WP-3 (§4 :626-669), on snapshot `cert3d`.

**Drafted read-only 2026-10-10** (preparation agent; to be adopted, edited and committed by Claude Main) against:
- the committed proof `scripts/cert/cert3/wp3-ev-proof.js` at `48db9e9`: 93 fixed checks (`EXPECTED_CHECKS`, asserted at load) plus the harness's `G.5xx`; its CHECKS table (:234-336) carries the id, plan line, answer-book key and where each check runs; its CATCHERS table (:573-579); `L34_FIX` (:526, empty);
- the four drafted mutation lists in `C:\Temp\octapm-cert\scratch\wp3\lists\` (§7.1): `wp3-mutations.ev.json` (8), `wp3-mutations.unit.json` (2), `wp3-fix-mutations.l34.json` (6), `wp3-fix-mutations.unit.json` (5); every `from` counted, every mutant parsed, every id checked by `mutsyntax-wp3.js` (report `mutsyntax-report.json`, 0 problems);
- the answer book `answers/schedule.js` after the WP-3 book patch (965 figures; `answers/CHANGES-WP0-BUILDERS.md` § "WP-3 answer-book leaves (2026-10-10)");
- the binding adjudication `C:\Temp\octapm-cert\scratch\wp3\WP3-ADJUDICATION.md` (Q1-Q16; cited WP3ADJ);
- the L34 fix plan `C:\Temp\octapm-cert\scratch\wp3\fixplan\L34-FIX-PLAN.md` (§4-§7, §11; awaiting its Codex plan review);
- the owner's execution rules of 2026-10-10 (§0).

**State at drafting.** HEAD `48db9e9` on `cert/full-saas-certification`; `backend/src` is identical to `f599e67`. `cert3d` is not taken yet (the §3.3 build order run 2 is scheduled 2026-10-11 19:12 CDT); WP-1 and WP-2 run on it first. The proof was debug-run once by Claude Main on the partial population of build order run 1 (`C:\Temp\octapm-cert\logs\cert3-wp3-proof-1.log`: `--skip=D2,D3,FCS,CF`, 77 active, 61 pass, 10 fail, exactly the L34 checks of those sections, 6 BLOCKED, 0 wrong, 0 5xx, exit 2, 16 s; V archived, nothing written on 087-EV). That run debugged the proof; it is not WP-3 evidence.

Inputs this plan relies on (all on disk):
- preparation `C:\Temp\octapm-cert\scratch\wp3\WP3-PREP.md` (test map, routes, register rows, fixtures, §7 mutation candidates, §9 L34);
- the answer book (`WP3.*`, `D2.WP3.*`, `D3.WP3.*`, `CLAUDE.SPI/CPI/EAC`), moment map `build/MOMENT-MAP.md` (087-EV rows 60-104; 052 rows 238-245; 006 row 252; the WP-3 deviation is already recorded at :283);
- the runners `C:\Temp\octapm-cert\run-locked.js` (one proof at a time, `CERT_INPROCESS=1`, no `DATABASE_URL`) and `C:\Temp\octapm-cert\mutate-multi.js` (`--lists=`, `--only=`, `CERT_LOCK_HELD`; the four WP-3 keys are to be added, §7.1);
- the drafted evidence checker `C:\Temp\octapm-cert\scratch\wp3\lists\wp3-mutation-evidence.js` (§7.4) and syntax checker `mutsyntax-wp3.js` (§7.2);
- the Codex prompt `C:\Temp\octapm-cert\scratch\wp3\codex-l34-plan-review-prompt.txt` (§8).

---

## 0. Rules that bind every step

**Owner execution rules (2026-10-10, strict one-writer).**
1. **One writer.** Only Claude Main modifies the certification worktree, writes the certification database (:55433) or the cert API (:5190), runs proofs, mutation runs (they edit product files), restores snapshots, runs Codex, commits and pushes. Preparation agents are read only and write only to their scratch folders; they never open a database connection or send a request.
2. **Pipeline.** While Claude Main executes WP-3, read-only agents prepare WP-4. No open-ended defect hunting.
3. **Snapshots.** `cert3d` is the working CERT-3 baseline: restored before WP-3 (§2.1), never rebuilt for WP-3 (WP3ADJ Q3: no new `cert3d`). Only the CERT-3 exit run rebuilds (§7 step 5).
4. **Reruns.** After a fix, targeted proof sections first (§6.2); complete runs only where the plan requires them: the WP-3 primary run, one full run on the final code (also the mutation baseline, §6.3), and the exit run.
5. **Codex** only for the plan's required reviews (§8): the adversarial plan review of the L34 fix (high risk: financial figures) and the diff review of the L34 product diff. No extra round for P2/P3 or test polish once nothing CRITICAL/HIGH is open.
6. **Long runs** (> 1.5 h) detached under the watchdog. Nothing in WP-3 is that long (the proof runs in well under a minute; a mutation in about as long).
7. **Manual UX** never holds WP-3 and never uses :5190 or the cert database while a proof or a mutation list runs.

**Plan rules.** §0.0 (no new rounds, matrices or requirements; rerun only invalid cases), §1.4 (known answers first, A10; checks assert; reproduce before fixing; a fix is followed by a mutation that puts the defect back), §5's defect-fix list (:1107-1121: a listed fix goes ahead after reproduction only if it confirms P1; P2/P3 recorded under the scope freeze), §6.4 gates, §7 detached-run rules (one writer; a mutation run that stores a defect is cleaned up, then a census).

---

## 1. Sequence

| # | Step | Who / where | Expected |
|---|---|---|---|
| 0 | Precondition: WP-2 closed (committed, pushed, journalled); `cert3d` exists | Claude Main | the WP-2 row of the workflow report written |
| 1 | Restore `cert3d` (§2.2), re-apply any migration made after it | Claude Main | API up on :5190; restore journalled |
| 2 | No-DB checks: `node --check` the proof; the four lists and the evidence checker copied in; `mutsyntax-wp3.js` on the tree (§7.2) | Claude Main | §6.2 lists: every anchor once, every mutant parses; fix lists: 0 at HEAD |
| 3 | **Primary run** of `wp3-ev-proof.js`, full, no flags, `L34_FIX` empty (§2.3) | Claude Main, lock held | exit 2, DEFECT_PRESENT: exactly the 13 decided-rule checks FAIL (the L34 reproduction in CERT-3); 6 known answers BLOCKED; 0 wrong; 0 5xx (§5.1) |
| 4 | Classify every failure and every reported known answer (§3); owner questions | journal, register | table filled |
| 5 | **L34 fix route** (§4.2): Codex plan review -> adjudication -> contract leaves in the book -> fix + unit suites -> fix commit -> `L34_FIX` set -> targeted sections -> full run | Claude Main | targeted 51/51; full run exit 0, 94/94 (§5.2) |
| 6 | Other confirmed P1 (only if the primary run shows one: L106, L112; §4.3) | Claude Main | none expected (both P2 proposed) |
| 7 | Regression after the fix: the read-only lifecycle verifier (E7) | Claude Main | as at WP-0 (1,694/1,694) |
| 8 | Mutation runs on the final code (§7): `wp3-ev` one id per invocation, `wp3fix-l34` one id per invocation, then `wp3-unit` and `wp3fix-unit`; the evidence check; census (§7.6) | Claude Main, lock held | E6 4/4; L34-M1, M1R, M2 caught; L34-M3, L34-M4 survive as recorded; L34-M5 per the contract; unit 7/7 |
| 9 | Codex diff review of the L34 product diff (§8) | Claude Main, one pass per window | nothing CRITICAL or HIGH open |
| 10 | `/code-review` (high) on the WP-3 batch (§9) | Claude Main | findings adjudicated |
| 11 | Commit and push (§10) | Claude Main | no merge of `main` |
| 12 | Journal entry (§11) | Claude Main | figures, table, tallies, restores, census, reviews, next action |
| 13 | The WP-3 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register rows (§12) | Claude Main | rule -> evidence -> result for every WP-3 rule |
| 14 | Restore `cert3d` before WP-4 (§2.1) | Claude Main | WP-4 starts clean |

---

## 2. Restore `cert3d` and the primary run

### 2.1 When to restore
- **Before the primary run.** WP-1 and WP-2 leave archived throwaway projects in 087 (W, X, P), WP-1's F1float5 revision `under_review` on 087-IMP, and their mutation residue. WP-3 reads 087-EV, 087-SCH, 087-EXTRAS, 052-SCH-EV and 006-LITE; a restore is cheaper than reasoning about them (assumption A7).
- **Not after the L34 fix.** The fix writes no data and needs no migration (L34-FIX-PLAN.md §8 R-8); `cert3d`'s stored moments and frozen snapshots keep HEAD's figures and are read as STORED-PRE-FIX (§4.2.4).
- **Not after any WP-3 list.** Every mutant writes, if at all, only on the run's throwaway project V (archived by the proof's cleanup, which also runs after a section error). On 087-EV the proof sends only probes HEAD refuses or answers from a stored snapshot (the relocks; under M2b they are refused at the blocked gate); 087-SCH, 052-SCH-EV and 006-LITE are only read. The census proves it (§7.6).
- **Before WP-4.** WP-3 leaves one archived `CERT3 WP3 Earned value <stamp>` project in 087 per proof run (about seventeen with the targeted, full and mutation runs).

### 2.2 How (the build order's own mechanism, `build-cert3d.ps1` :42-80)
From `backend/` with `DATABASE_URL` unset and the proof lock not held (`C:\Temp\octapm-cert\locks\proof.lock` absent):
1. Stop the cert API as `build-cert3d.ps1` does (`Stop-CertApi`: the process on :5190 must be the recorded `api.pid`; never stop another process).
2. `node scripts/cert/snapshot-db.js restore cert3d`
3. Only if WP-1 or WP-2 landed a migration after `cert3d` was taken: `node C:\Temp\octapm-cert\migrate-cert.js` (the build order's step).
4. `powershell -NoProfile -ExecutionPolicy Bypass -File C:\Temp\octapm-cert\start-api.ps1`
5. Record the restore in the journal (time, reason).

Never run a builder after `cert3d` without taking the snapshot again: the state files `C:\Temp\octapm-cert\state\cert3\*.json` are not in the snapshot, and the proof's `S.projects` refuses a state file whose `projectId` differs from the live project (setup error).

### 2.3 The primary run
```
cd <worktree>\backend
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp3-ev-proof.js
```
- **No flags on `cert3d`.** `--only` / `--skip` / `--project` exist for targeted reruns (§6.2) and partial populations. They are never used for the primary run, the final run or a mutation run: `mutate-multi.js` spawns the proof without arguments.
- `CERT_PASSWORD` comes from `backend/.env` through `lib/api.js`; never echoed, copied into this plan, the results or the journal.
- Setup: companies 087, 052, 006 resolved by slug `cert-<code>-%`, one organisation each; the personas sign in (087 pm, planner, qs, cost, site, finance; 052 pm, cost; 006 pm; the 087-EXTRAS T-NOBOQ member as its state names them; the actor-role member, the first free 087 staff QS); the four deep projects by exact name, one live each, matching their state files; `S.gate087EV` reads 087-EV's reporting gate blocked; V is created in 087 with its team (S.throwaway) and its fixture (S.V.fixture).
- **Expected console:**
  - `wp3-ev-proof: 93 of 93 checks active; sections S EVS EVL PER PERV T4 T7 FC FCS DP D2 D3 CF; deep projects 087-EV, 087-SCH, 052-SCH-EV, 006-LITE; V yes; L34 fix not set; in process`
  - `tally: 74 pass, 13 fail of 93 recorded (93 active); decided-rule RED (L34): KA.EVS.T3, KA.EVS.febOpen, KA.EVS.febSnapshot, KA.EVS.janSnapshot, KA.EVS.afterLock.cutoff0228, KA.EVL.febPeriod.figures, KA.EVL.janPeriod.figures, KA.D2.stored.T3, KA.EVL.cutoff0228, KA.PER.V.lockAc, PER.V.afterLock.cutoffChanges, KA.D2.live.T3, CF.L34; other failures: none; known answers: 0 value, 6 BLOCKED, 0 STORED-PRE-FIX, 12 fail (0 wrong)`
  - `confirm-first: CF.L34 CONFIRMED; CF.L118 CONFIRMED; CF.L112 CONFIRMED; CF.L113 CONFIRMED; CF.L106 CONFIRMED; CF.HRE3 CONFIRMED; CF.HRE4 CONFIRMED; CF.concurrentLocks CONFIRMED; CF.actorRole CONFIRMED; CF.WP3TZ1 REJECTED`
  - cleanup: the actor-role member off V's team (200); V archived (200, `archivedAt` set); the throwaway check (`0 live`); `deep projects: nothing written`;
  - `wp3-ev-proof: 81 passed, 13 failed of 94 (fixed); DEFECT_PRESENT, exit 2` and `provisional classification CONFIRMED (13 of 13 defect checks show the reported behaviour)`.
- The tally's `pass` counts PASS records only: BLOCKED (and, after the fix, STORED-PRE-FIX) known answers are passes for the harness but are counted apart in the tally.
- Result: `C:\Temp\octapm-cert\results\cert3\wp3-ev-proof.json` (`checks[]` with `ok`, `kind`, `notRun`; `observations.checks` per id with plan line, book key, where, expected, observed, verdict; `observations.knownAnswers`; `observations.confirmFirst`; `observations.decidedRules`; `observations.l34Fix`; `observations.tally`; `answers.byStatus` and `fiveXX`; `cleanup`). **Copy it to `wp3-ev-proof.primary.json` at once**; every later run overwrites it.
- Exit semantics (harness rule 5, A10): **0** every check holds (known answers at `value`, `today` of an undecided rule = BLOCKED, or STORED-PRE-FIX); **2** a check failed: here the 13 L34 checks of a decided rule, which is the expected answer before the fix (a decided rule's `today` fails, the WP-1 `ka()` rule); **1** setup error (a check not run, a section that threw, an R-SET probe whose own setup failed) - never a product result: fix the proof or the fixture and rerun.
- First full execution: D2 (052-SCH-EV), D3 (006-LITE), FCS (087-SCH + 087-EXTRAS) and CF were filtered out of the debug run. A red there is read first as a possible proof defect (TEST GAP) before it is classified as a product failure.

---

## 3. Classification table

Every failed check and every reported known answer gets a row. Classification per plan §0.0 item 4 / §6.4: CONFIRMED, PARTIAL, REJECTED, EXPECTED BEHAVIOUR, TEST GAP. Severity per §1.4. Destination: **fixed in WP-3** (§4.2, §4.3), **owner HR decision** (§4.4), **register** (P2/P3, recorded under the scope freeze), **proof or book corrected** (TEST GAP, logged with its derivation, A10), **closed** (EXPECTED BEHAVIOUR, rule cited). Severities are WP3ADJ Q16's provisional ones, final after the primary run.

Pre-filled rows ("observed" = the code reading and the debug run; replaced by the `cert3d` primary run):

| # | Check id(s) | Book key | Observed (HEAD) | Expected (value) | Today + ref | Proposed classification | Severity | Destination |
|---|---|---|---|---|---|---|---|---|
| 1 | the 13 decided-rule checks (§5.1 part A), CF.L34 | WP3.T3, WP3.periods.feb/jan.snapshot, WP3.periods.afterLock.cutoffAfterCost, WP3.V.lockA, WP3.V.cutoffAfter, D2.WP3.T3, WP3.L34.acRule | AC at a past cutoff drops an activity's whole cost when it has a later posting; locks freeze it (Feb 20,000.00 for 70,000.00; Jan 0 for 50,000.00) | ledger entries dated by `incurredOn` | today, L34 (decided) | CONFIRMED | P1 | fixed in WP-3 (§4.2) |
| 2 | KA.EVS.T5delete, CF.L112 | WP3.T5.deleteProbe, WP3.V.l112 | the PM's delete of an approved revision: 200, no audit event, BAC back to 387,000.00; V24 the amount edit and the delete silent | refused or audited | today, L112 | CONFIRMED | P2 proposed (P1 only if the run shows money moved on a main path without trace beyond this) | register (WP3ADJ Q8); HR-K9 / HR-C15 stay undecided |
| 3 | KA.EVS.T6.after, KA.EVL.runDate, CF.L118 | WP3.T6.after | A140 retired: its 5,000.00 leaves AC (115,000.00; CPI 0.873913) | AC 120,000.00, CPI 0.8375 | today, HR-S9 | CONFIRMED | owner's | owner HR decision (the L34 fix keeps the isActive filter, WP3ADJ Q4) |
| 4 | KA.FC.L106, CF.L106 | WP3.forecast.L106budgetLines | a line within its budget listed as an overrun (revised 0, overrun 100,000.00, medium) | `[]` | today, L106 | CONFIRMED | P2 proposed | register; fixed in WP-3 only if it confirms P1 (§5 list, WP3ADJ Q7; §4.3) |
| 5 | KA.PER.futureCutoffLock, CF.L113 | WP3.periods.futureCutoffLock | V-F locked before its cutoff: 200, a snapshot, one OVERRIDDEN event; no unlock route; a normal lock writes no audit event | 409 (code undecided) | today, HR-E2 | CONFIRMED | owner's (P2 proposed) | owner HR decision |
| 6 | KA.PER.concurrentLocks, CF.concurrentLocks | WP3.periods.concurrentLocks | both 200, one snapshot row, two OVERRIDDEN events (debug run: lockedAt 3 ms apart) | one 200, one 409 | today, CONCURRENT | CONFIRMED | P3 proposed | register (WP3-CONC-1, as WP1-CONC-1; WP3ADJ Q12) |
| 7 | CF.actorRole | WP3.V.inputs (actorRoleLoading) | the loading's approvalHistory records the organisation role `qs` for a member assigned `cost_controller` | the effective role | ACTOR-ROLE (low) | CONFIRMED | P3 proposed | register (WP3ADJ Q13) |
| 8 | CF.HRE3 (T4.ev0.eac, T4.ev0.eacBasis pass) | WP3.T4.ev0.* | CPI 0: EAC = BAC, `budget_cpi_zero` | HR-E3's recommendation | - | HEAD equals the recommendation | not a defect | owner question "keep as is?" (WP3ADJ Q15) |
| 9 | CF.HRE4 | WP3.T1.spiAlert | the report flag is the only alert; no notice; no SPI exception kind | HR-E4 (exception kind when the engine is on) | - | CONFIRMED (reported) | owner's | owner question; the exception kind is WP-9's (WP3ADJ Q15) |
| 10 | CF.WP3TZ1 | WP3.confirmFirst.zoneChange | no path writes a company zone after creation; the project API takes no zone; a project keeps its copied zone | - | - | REJECTED (code reading, WP3ADJ Q14) | - | register WP3-TZ-1 closed REJECTED; plan premise A8 keeps the label |
| 11 | FC.siteEngineerMoney | WP3.forecast.siteEngineerMoney, siteEngineerWithBoqRead | T-NOBOQ member: cost withheld; the site engineer persona (boq:read) receives the forecast's money | plan :655 "no money fields" (planValue) | - | EXPECTED BEHAVIOUR under owner decision E1 | - | closed; reported to the owner for information (WP3ADJ Q6) |
| 12 | PER.loadingLocked | WP3.periods.afterLock.loadingInLockedPeriod | a loading naming the locked period: 409 REPORTING_PERIOD_LOCKED; a loading only dated inside it is accepted | - | - | EXPECTED BEHAVIOUR (HEAD's period-linked rule asserted) | - | recorded for the owner: a date rule would be a rule change (WP3ADJ Q11) |
| 13 | PER.duplicateCode | WP3.periods.duplicateCode | 409 CONFLICT; the service logs a Prisma unique-constraint stack before mapping it | - | - | EXPECTED BEHAVIOUR (logged, not a 5xx) | - | closed |
| 14 | Debug run 1 (partial population) | - | 10 L34 fails, 6 BLOCKED, as designed | - | - | not evidence | - | journal |

---

## 4. What WP-3 fixes, and what waits for the owner

### 4.1 Nothing landed for WP-3 yet
`backend/src` equals `f599e67` plus whatever the WP-2 batches land (WP-2 r2 changes `earned-value.service.js` only at the EV prefetch `orderBy`, :751, and a require: no WP-3 anchor or expected figure moves; `mutsyntax-report.json` "wp2r2").

### 4.2 The L34 fix route (decided in CERT-3, P1; plan §0.1 :53-55, HR-E1 :1092; WP3ADJ)
1. **Reproduction.** The primary run (§2.3) is the reproduction: the 13 decided-rule checks red, harness CONFIRMED 13/13, the four live/fresh ones (KA.EVL.cutoff0228, KA.PER.V.lockAc, PER.V.afterLock.cutoffChanges, KA.D2.live.T3) and CF.L34 being the in-proof evidence (WP3-PREP §9). Optionally `scripts/cert/cert3/wp3-l34-repro.js` (WP3-PREP §9 R1-R9; exit 2 at HEAD on R1, R2, R4, R5): it is the only live catcher of L34-M3 (R6, §13.1).
2. **Codex adversarial plan review** of `L34-FIX-PLAN.md` (plan §6.4; prompt `scratch\wp3\codex-l34-plan-review-prompt.txt`; output `scratch\wp3\codex-l34-plan-review.md`; adjudication `scratch\wp3\codex-l34-plan-review-adjudication.md`, every finding CONFIRMED / PARTIAL / REJECTED / EXPECTED BEHAVIOUR / TEST GAP). Rounds stop when nothing CRITICAL/HIGH is open; at most 3. The owner sees O-1..O-6 (fix plan §10) and the contract choices (WP3ADJ Q5: `formulaVersion`, the `actualCostSource` value, the basis texts; L-6 or L-6b).
3. **Book.** The three contract leaves `WP3.L34.formulaVersion`, `actualCostSource`, `basisTexts` get their adjudicated values with A10 derivations (fix plan §11); the proof then judges them on the live and fresh checks (`CONTRACT_L34`, :496-517). Until then they read `contract pending the L34 plan review` and L34-M5 is not catchable (§13.1). The 18 STORED-PRE-FIX leaves keep their `today` (G21's clearing waits for the exit rebuild).
4. **Fix** per the adjudicated plan (`earned-value.service.js`, `figure-truth.js`, the texts, the web badge; `earned-value.service.test.js` rewritten: U-2..U-7, plus `figure-truth.ev-version.test.js` U-8). Unit suites green on a quiet machine, never beside a proof, build or Codex (fix plan §5 command, from `backend/`):
   `npx jest src/services/__tests__/earned-value.service.test.js src/utils/__tests__/figure-truth.ev-version.test.js src/services/__tests__/workspace-dashboard.service.test.js src/services/__tests__/forecast.service.test.js src/services/__tests__/exception-rules.test.js src/routes/__tests__/reports.routes.test.js src/routes/__tests__/health-material-lines.test.js src/utils/__tests__/boq-figures.per-activity-budget.test.js`
5. **Fix commit** (`fix(CERT-3 WP-3): official AC from the cost ledger by incurredOn (L34)`), so the fix has a commit time. Never amend it afterwards: `L34_FIX` names its sha. A later Codex or code-review follow-up is a new commit.
6. **Restart the cert API** (`Stop-CertApi`, `start-api.ps1`) so :5190 serves the fixed code; the proofs run in process and load the worktree at their start. Never while a proof or a mutant runs.
7. **Set `L34_FIX`** in the proof (:526) to `{ commit: '<sha>', committedAt: '<git show -s --format=%cI <sha>>' }`. `S.state` checks it against git (a mismatch is a setup error).
8. **STORED-PRE-FIX reading** (WP3ADJ Q3 (b) + (c); `WP3.L34.storedPreFix`). A known answer of rule L34 whose observation is a stored build moment or a frozen snapshot, whose `storedAt` (the step's `capturedAt` or `finishedAt`, or the snapshot's `lockedAt`) is earlier than `L34_FIX.committedAt`, and which shows exactly the leaf's `today`, is STORED-PRE-FIX (`kaStatus`, :629-636): a pass, counted apart in the tally, recorded with the register link `OCTAPM_LAUNCH_BLOCKERS.md L34`. It applies to eight checks: KA.EVS.T3, KA.EVS.febOpen, KA.EVS.febSnapshot, KA.EVS.janSnapshot, KA.EVS.afterLock.cutoff0228, KA.EVL.febPeriod.figures, KA.EVL.janPeriod.figures, KA.D2.stored.T3. It is not a waiver: a stored figure that is neither `value` nor `today` is `wrong` and fails; the live and fresh checks (KA.EVL.cutoff0228, KA.PER.V.lockAc, PER.V.afterLock.cutoffChanges, KA.D2.live.T3, CF.L34) are judged strictly; and the exit run's rebuild (plan §7 step 5) judges every moment on the fixed code (L34 then leaves the builders' allowed BLOCKED refs and the proof's `ALLOWED_BLOCKED`).
9. **Targeted sections** (§6.2), then **one full run** (§6.3: the WP-3 result and the mutation baseline).
10. **Regression:** the read-only lifecycle verifier `node scripts/cert/cert3/lifecycle-posthoc-verifier.js` (E7; fix plan R-8: stage9's AC equals the ledger by construction). The WP-1 proof reads no EV; the WP-2 proof compares EV report hashes within one run and reads EV only, so neither reruns (owner rule 4).
11. **Mutations** (§7), **Codex diff review** (§8), **`/code-review`** (§9), commit and push (§10), journal and register (L34 -> Fixed at `<sha>`; the ev.v2 snapshots that stay understated in `cert3d`: 087-EV 2026-01 and 2026-02, 087-EXC P1; fix plan R-2, O-2).

### 4.3 Defect fixes only if the primary run confirms P1
- **L106** is on §5's defect-fix list (:1117): fixed in WP-3 only if it confirms P1 (WP3ADJ Q7); proposed P2 -> register. A P1 fix follows the WP-1 route: reproduce (KA.FC.L106 is the live catcher), fix, green, a mutation that puts it back, Codex diff review if high risk, code review.
- **L112** is not on the list: recorded P2 unless the reproduction shows P1, when §0.0 rule 4 applies (WP3ADJ Q8).
- Any `wrong` known answer is a failure to classify on paper first (A10): a product change since the book, a proof bug or a wrong derivation.

### 4.4 Waits for an owner decision (no change before it)

| Row | What WP-3 observes | Today | Recommendation |
|---|---|---|---|
| HR-S9 (L118) | KA.EVS.T6.after, KA.EVL.runDate, CF.L118 | a retired activity's AC and EV leave the totals | keep them (the L34 fix keeps the isActive filter until decided, WP3ADJ Q4) |
| HR-E2 (L113) | KA.PER.futureCutoffLock, CF.L113 | a lock before the cutoff succeeds; no unlock; normal locks unaudited | refuse (409), no unlock, audit every lock |
| HR-E3 | T4.ev0.eac / eacBasis, CF.HRE3 | EAC = BAC at CPI 0, labelled | HEAD is the recommendation: "keep as is?" |
| HR-E4 | CF.HRE4 | the report flag only | an exception kind when the engine is on (WP-9's) |
| CONCURRENT, ACTOR-ROLE | KA.PER.concurrentLocks, CF.actorRole | unserialised; organisation role recorded | observations (P3) |
| Q6, Q11 | FC.siteEngineerMoney, PER.loadingLocked | E1 behaviour; period-linked rule | information for the owner |

---

## 5. Known answers and where each check runs

### 5.1 What the primary run WILL report (before the fix; so nobody mistakes them for new failures)

**Part A, the 13 decided-rule checks (FAIL, exit 2, DEFECT_PRESENT):**

| Check id | Where | Observed `today` | Value |
|---|---|---|---|
| KA.EVS.T3 | stored 087-EV checkpoint.T3 | AC 20,000.00, CV -20,000.00, ETC 367,000.00 | 70,000.00 / -70,000.00 / 317,000.00 |
| KA.EVS.febOpen | stored checkpoint.feb.open | AC 20,000.00 | 70,000.00 |
| KA.EVS.febSnapshot | stored lock.2026-02 | AC 20,000.00 | 70,000.00 |
| KA.EVS.janSnapshot | stored lock.2026-01 | AC 0; CPI null; no alert; budget_no_cost_performance; CV 0; ETC 387,000.00 | 50,000.00; CPI 0; alert; budget_cpi_zero; -50,000.00; 337,000.00 |
| KA.EVS.afterLock.cutoff0228 | stored checkpoint.afterLock.* | 20,000.00 then 25,000.00 | 70,000.00 then 75,000.00 |
| KA.EVL.febPeriod.figures | frozen, served live | AC 20,000.00 | 70,000.00 |
| KA.EVL.janPeriod.figures | frozen, served live | AC 0 | 50,000.00 |
| KA.D2.stored.T3 | stored 052 wp3.T3 | AC 20,000.00 | 70,000.00 |
| KA.EVL.cutoff0228 | live 087-EV, ?cutoffDate=2026-02-28 | AC 25,000.00 | 75,000.00 |
| KA.PER.V.lockAc | fresh V-A snapshot | AC 100,001.00 | 120,001.00 |
| PER.V.afterLock.cutoffChanges | fresh V, ?cutoffDate=2026-02-28 | AC 105,001.00 | 125,001.00 |
| KA.D2.live.T3 | live 052, ?cutoffDate=2026-02-28 | AC 20,000.00 | 70,000.00 |
| CF.L34 | live/fresh only | CONFIRMED | REJECTED |

**Part B, the 6 known answers BLOCKED (undecided; never exit 2):**

| Check id | Where | Ref | Observed `today` |
|---|---|---|---|
| KA.EVS.T5delete | stored probe.T5.delete | L112 | 200, 0 audit events, BAC back to 387,000.00 |
| KA.EVS.T6.after | stored checkpoint.T6.after | HR-S9 | AC 115,000.00, CPI 0.873913, EAC 442,835.82 |
| KA.EVL.runDate | live 087-EV at the Cairo run date | HR-S9 | EV 100,500.00, AC 115,000.00, CPI 0.873913, EAC 442,835.82 (debug run: the same) |
| KA.FC.L106 | V5, before any cost | L106 | one line: revised 0, forecast 100,000.00, overrun 100,000.00, medium; counts.lines 1 |
| KA.PER.futureCutoffLock | V-F (futurePeriodFor(the Cairo run date)) | HR-E2 | 200, a snapshot, one OVERRIDDEN event |
| KA.PER.concurrentLocks | V-B, two PM locks at once | CONCURRENT | both 200, one row, two OVERRIDDEN events |

Plain checks with an HR note that pass: T4.ev0.eac and T4.ev0.eacBasis (HR-E3, HEAD = the recommendation). Not WP-3 keys, ignored here: the other packages' BLOCKED build steps.

### 5.2 What the final run reports (after the fix, `L34_FIX` set)
- `tally: 79 pass, 0 fail of 93 recorded (93 active); decided-rule RED (L34): none; other failures: none; known answers: 4 value, 6 BLOCKED, 8 STORED-PRE-FIX, 0 fail (0 wrong)`; `confirm-first: CF.L34 REJECTED; ...` (the other nine as in §2.3); `wp3-ev-proof: 94 passed, 0 failed of 94 (fixed); PASS, exit 0`; harness `REJECTED (0 of 13 defect checks ...)`.
- **value (4):** KA.EVL.cutoff0228 (AC 75,000.00, CV -75,000.00, ETC 312,000.00), KA.PER.V.lockAc (120,001.00; V-A locked after the fix), PER.V.afterLock.cutoffChanges (125,001.00), KA.D2.live.T3 (70,000.00 at 2026-03-01T05:59:59.999Z); and CF.L34 REJECTED. Once the contract leaves are adjudicated these four also judge `formulaVersion` and `actualCostSource` (§4.2.3).
- **STORED-PRE-FIX (8):** §4.2.8.
- **Stay green (regression):** EVL.febPeriod.hash and PER.relock.jan / .feb are the C-1 guards (fix plan §6.1): a pre-fix locked period must answer byte for byte. If either fails after the fix, the fix broke C-1 (a fix defect, not a mutation result). Also EVS.T1, EVS.T2, EVS.T5, EVS.T6.before, EVS.T7, EVS.afterLock.*, EVS.feb.*, EVS.jan.lockNormal, all T4.* (read4 at 2026-01-31: the ledger gives HEAD's 50,000.00), T7.live.hash, PER.V.*, FC.*, DP.*, D2.stored.T1 / T2, D3.stored.T1; KA.EVL.runDate stays BLOCKED HR-S9.

### 5.3 Where each check runs (the proof's where-table)

| Where | Checks |
|---|---|
| **V** (throwaway project of 087 made and archived by each run; WP3ADJ Q1) | S.throwaway, S.V.fixture; KA.FC.L106; T4.inputs + 14 T4; T7.live.hash; the 11 PERV checks; FC.evBasedFinish (in process on V) |
| **087-EV live** (writes nothing at HEAD) | S.gate087EV; KA.EVL.runDate, KA.EVL.cutoff0228, EVL.febPeriod.hash, KA.EVL.febPeriod.figures, KA.EVL.janPeriod.figures; PER.relock.jan / .feb, PER.loadingLocked, PER.duplicateCode, PER.endBeforeStart, PER.overrideAudit.feb |
| **087-EV stored** (state file step outputs) | S.branch; the 23 EVS checks |
| **087-SCH live** (with 087-EXTRAS's T-NOBOQ member) | FC.siteEngineerMoney |
| **052-SCH-EV** | D2.stored.T1, D2.stored.T2, KA.D2.stored.T3 (stored); KA.D2.live.T3 (live) |
| **006-LITE** | D3.stored.T1 (stored) |
| **pure / static** | FC.pace.*, DP.*; the scans behind CF.WP3TZ1, CF.HRE4, CF.L113, CF.L106 |
| **setup** | S.companies, S.state, S.projects |

The deviation from MOMENT-MAP rows 93-94 (L113 and the concurrent locks on V, not on 087-EV's future period) is already recorded (MOMENT-MAP.md :283).

### 5.4 Reading notes
- **KA.PER.concurrentLocks is a race.** `today` (both 200) was observed in the debug run. A 200 + 409 split reads `value` (CF.concurrentLocks REJECTED, still a pass). Two sends that did not overlap (the second returns the first's stored snapshot, one event) are an R-SET setup error (exit 1), not a verdict: rerun once, since it is the probe's setup that failed. Any other shape is `wrong` and is classified, never rerun until green.
- **The harness classification line** is the decided-rule table only (13 defect checks); the WP-3 classification of the other confirm-first items is `observations.confirmFirst`.
- **Cairo midnight.** Run-date reads are cut at `cairoToday()` per read. Do not start a run or a mutation in the minutes around Cairo midnight (21:00 UTC while Egypt keeps summer time, 22:00 UTC after it ends late in October): an approval stamped after midnight against a read cut before it is a T4.inputs setup error.
- **Throwaway accumulation.** One archived V per run; the cleanup's throwaway check must say 0 live. 087 is on the enterprise plan; archived projects never count against a limit.

---

## 6. Targeted proofs, targeted reruns, the final full run

### 6.1 Before the fix
Only the optional reproduction `wp3-l34-repro.js` (§4.2.1), if written: own throwaway project R in 087, exit 2 at HEAD, archived.

### 6.2 Targeted sections after the fix (`L34_FIX` set)
```
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp3-ev-proof.js --only=EVS,EVL,PERV,D2
```
Expected: 50 of 93 active (S 7, EVS 23, EVL 5, PERV 11, D2 4); `tally: 37 pass, 0 fail of 50 recorded (50 active); ... known answers: 4 value, 5 BLOCKED, 8 STORED-PRE-FIX, 0 fail (0 wrong)`; `51 passed, 0 failed of 51`; exit 0. (V runs its whole choreography; V5, V15, V24, V25 are skipped as no selected check reads them.) A failure here goes back to the fix (Ralph loop: three iterations, then escalate). Sections: S EVS EVL PER PERV T4 T7 FC FCS DP D2 D3 CF; selecting CF selects every section CF classifies from (EVS EVL PER PERV T4 FC D2).

### 6.3 The final full run
One full run on the final code, no flags (§2.3 command): the expected answer is §5.2. Its result is the WP-3 result recorded in the report and the mutation baseline: copy it to `wp3-ev-proof.final.json` and `wp3-ev-proof.baseline.json`. If a later product or proof change follows (a Codex or code-review finding), run it again and re-run only the mutants whose catchers or anchors that change touches (owner rule 4).

---

## 7. Mutation runs

### 7.1 Lists and runner keys
Claude Main copies `wp3-mutations.ev.json`, `wp3-mutations.unit.json`, `wp3-fix-mutations.l34.json`, `wp3-fix-mutations.unit.json` and `wp3-mutation-evidence.js` from `C:\Temp\octapm-cert\scratch\wp3\lists\` into `backend/scripts/cert/cert3/`, and adds four keys to `LISTS` in `C:\Temp\octapm-cert\mutate-multi.js`, before `'unit-tests'`:
```js
  // WP-3 (WP3-RUN-PLAN.md section 7): only on the L34-fixed tree, after the unmutated full run exits 0.
  'wp3-ev': ['scripts/cert/cert3/wp3-ev-proof.js', true, 'wp3-mutations.ev.json'],
  'wp3-unit': [null, false, 'wp3-mutations.unit.json'],
  // WP-3 L34 fix: the defect put back (anchors exist only on the fix tree).
  'wp3fix-l34': ['scripts/cert/cert3/wp3-ev-proof.js', true, 'wp3-fix-mutations.l34.json'],
  'wp3fix-unit': [null, false, 'wp3-fix-mutations.unit.json'],
```
Optional fifth, only if `wp3-l34-repro.js` is written (it reuses the L34 list; each entry's `repro` field names its R catchers, read by hand): `'wp3fix-l34-repro': ['scripts/cert/cert3/wp3-l34-repro.js', true, 'wp3-fix-mutations.l34.json'],`.
Ids: every `catchers`, `collateral` and `unchanged` id, and every check id an `expect` names, is a CHECKS id; the §6.2 catchers equal the proof's CATCHERS table (`mutsyntax-report.json`). The equivalent status-filter mutants and the legacy-flag site are recorded in the ev list (`equivalent`, `notRun`) and never run (WP3ADJ Q10).

### 7.2 Mutant syntax (no DB, no lock)
- At drafting (`node C:\Temp\octapm-cert\scratch\wp3\lists\mutsyntax-wp3.js`): on HEAD `48db9e9`, on the simulated fix copy and on HEAD with the WP-2 r2 edit simulated, every §6.2 and unit anchor occurs once and every mutant parses; every L34 anchor occurs 0 times at HEAD and once on the simulated fix copy (and parses there). Copies in `lists\mutsyntax\`.
- **On the day**, after the real fix: re-derive the L34 lists' `from` / `to` on the real fix diff (the reviewed fix may differ from the simulation), then `node mutsyntax-wp3.js --post-fix` (every list, the fix lists included, must apply once on the fixed worktree and parse). An anchor found 0 or 2+ times is NOT APPLIED by the runner; a mutant that does not parse would be "caught" by a crash and proves nothing.

### 7.3 Runner and baseline
- The lists run **only on the final code** (the L34-fixed tree, `L34_FIX` set), right after the unmutated full run exits 0 (§6.3). At HEAD the unmutated proof exits 2 (the 13 L34 checks), which would score every mutant CAUGHT and prove nothing; and E6 is met on the final code only.
- `mutate-multi.js` spawns the proof **without arguments** (the population must be complete: `cert3d` restored, all five state files) and scores any non-zero exit CAUGHT. CAUGHT alone is not evidence: the named catchers must read FAIL (ran and failed, not "not run") in that mutant's copied result, and PASS in the baseline (§7.4).
- The cert API on :5190 is not used by the proof (in process). It is never started or restarted while a mutant is applied (it would load the mutated file); nobody uses it during a list.

### 7.4 Running: one mutant per invocation, the result copied after each
Never while a build, another proof, Codex or the full jest suite runs. One command line each. **Quote the id and end it with a comma**: `mutate-multi.js` treats a value without a comma as a name *prefix* (`--only=M1` would also run M1a and M1b; `--only=L34-M1` also L34-M1R), and PowerShell drops an unquoted trailing comma.
```
cd <worktree>\backend
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp3-mutations.M1.json --lists=wp3-ev "--only=M1,"; Remove-Item Env:CERT_LOCK_HELD
New-Item -ItemType Directory -Force C:\Temp\octapm-cert\results\cert3\wp3-mutations | Out-Null; Copy-Item C:\Temp\octapm-cert\results\cert3\wp3-ev-proof.json C:\Temp\octapm-cert\results\cert3\wp3-mutations\M1.json
```
Order: M1, M1a, M1b, M2, M2b, M3, M3b, M4 (`--lists=wp3-ev`); then L34-M1, L34-M1R, L34-M2, L34-M5, L34-M3, L34-M4 (`--lists=wp3fix-l34`). Then the two unit lists, each in one invocation under the lock (no database, but the lock keeps any proof from starting on a mutated tree):
```
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp3-mutations.unit.json --lists=wp3-unit; Remove-Item Env:CERT_LOCK_HELD
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp3-fix-mutations.unit.json --lists=wp3fix-unit; Remove-Item Env:CERT_LOCK_HELD
```
After the 14 proof-backed runs:
```
node scripts/cert/cert3/wp3-mutation-evidence.js --baseline=C:\Temp\octapm-cert\results\cert3\wp3-ev-proof.baseline.json
```
It reads `results\cert3\wp3-mutations\<id>.json`, prints per entry the exit code, each catcher's state in the mutant and in the baseline, the collateral, any unexpected red, the known-answer tally, the 5xx count and whether `L34_FIX` was set, then `E6 (section 6.2 WP-3 guards): n/4`. Limitation probes (L34-M3, L34-M4; L34-M5 while the contract is pending) must SURVIVE with exit 0. Exit 0 when every entry is as its list expects. (Dry-run at drafting on the debug result: M1 "NO EVIDENCE", catchers PASS, not on the final code, as designed.) A run that ends in exit 1 counts only if its catchers already read FAIL (L34-M2 by design).

### 7.5 Expected per mutant (the lists carry the derivations)

| Id | Runner | Exit | Named catchers (must be FAIL) | Expected collateral (FAIL) |
|---|---|---|---|---|
| M1 | CAUGHT | 2 | T4.spi09.spiAlert, T4.cpi09.cpiAlert | none |
| M1a | CAUGHT | 2 | T4.spi09.spiAlert | none |
| M1b | CAUGHT | 2 | T4.cpi09.cpiAlert | none |
| M2 | CAUGHT | 2 | EVL.febPeriod.hash, PER.V.afterLock.periodHash | KA.EVL.febPeriod.figures (wrong: Feb recomputed, AC 75,000.00), KA.EVL.janPeriod.figures (isSnapshot false), PER.V.relock (its stored id is taken from a recomputed read) |
| M2b | CAUGHT | 2 | PER.relock.jan, PER.relock.feb, PER.V.relock (each 409 REPORTING_READINESS_BLOCKED, nothing written) | none; precondition S.gate087EV ready false (the relock probe refuses to send otherwise) |
| M3 | CAUGHT | 2 | PER.V.financeBlocked | PER.V.financeOverride, PER.V.pmOverride, PER.V.overrideAudit, KA.PER.concurrentLocks (wrong: 0 events), CF.concurrentLocks (TEST GAP) |
| M3b | CAUGHT | 2 | PER.V.financeOverride | PER.V.pmOverride, PER.V.overrideAudit |
| M4 | CAUGHT | 2 | T7.live.hash, KA.EVL.runDate (wrong: EV 177,900.00) | none (CF.L118 reads PARTIAL, still a pass; the V20 lead shows EV 129,700.00) |
| L34-M1 | CAUGHT | 2 | KA.EVL.cutoff0228, KA.PER.V.lockAc, KA.D2.live.T3, CF.L34 | PER.V.afterLock.cutoffChanges |
| L34-M1R | CAUGHT | 2 | the same four | PER.V.afterLock.cutoffChanges |
| L34-M2 | CAUGHT | 1 | the same four (wrong: 115,000.00; 130,001.00; >= 110,000.00; TEST GAP) | PER.V.afterLock.cutoffChanges, T4.inputs (read4 AC 100,001.00), the 14 T4 checks not run |
| L34-M5 | CAUGHT if `WP3.L34.formulaVersion` is adjudicated, else SURVIVED | 2 / 0 | KA.EVL.cutoff0228, KA.PER.V.lockAc, PER.V.afterLock.cutoffChanges, KA.D2.live.T3, CF.L34 (contract: formulaVersion ev.v2) | none |
| L34-M3 | SURVIVED (expected) | 0 | none (no proof step voids a cost) | none |
| L34-M4 | SURVIVED (expected) | 0 | none (no check reads officialActualThroughDate) | none |
| UM3 | CAUGHT | jest red | 'blocks official snapshot lock when reporting readiness fails without override', 'audits a PM readiness override before locking an official snapshot' | - |
| UM2 | CAUGHT | jest red | U-6 (frozen ev.v2 snapshot), from the fix | - |
| UL34-M1..M5 | CAUGHT | jest red | the fix's edited :203-209 case, U-2..U-4, U-7 per entry | - |

### 7.6 What counts where: the E6 tally
- **E6 (plan §6.2 WP-3, four guards), tallied on these four only:** the 0.9 alert boundary -> **M1**; the locked-period snapshot -> **M2**; the readiness gate on lock -> **M3**; EV reads approved progress only -> **M4** (the accepted read swap). E6 is met for WP-3 when the four are CAUGHT by their named catchers on the final code.
- **Variants** (run, not tallied; WP3ADJ Q10): M1a, M1b, M2b, M3b.
- **Equivalent, not run:** the status filters of the progress include (:742) and of `selectApprovedProgressForCutoff` (:156): `ActivityProgress` rows exist only as approved (the single writer), so no API observation can see them.
- **L34 fix mutations** (plan §1.4, not §6.2): L34-M1 (primary), L34-M1R, L34-M2 must be CAUGHT; L34-M5 per the contract; L34-M3 and L34-M4 are limitation probes (TEST GAPs, §13.1).
- **Unit side** (not evidence, plan §1.4): UM3, UM2, UL34-M1..M5. No unit catcher exists for M1/M1a/M1b, M2b, M3b, M4 (a crash, not an assertion) or L34-M1R (a crash); the live proof is their evidence (§13.2).

### 7.7 Cleanup and census after the lists (plan §7)
- **No restore after any WP-3 list** (§2.1). Stored effects of the mutants are on V only: V-A locked by finance (M3) or on finance's override (M3b), V's snapshots with mutated alerts (M1), EV (M4) or AC (L34-M1, M1R, M2) or version (L34-M5); every V archived by the proof's cleanup.
- **Census**, once after the batch:
  1. `node scripts/cert/isolation/fingerprint.js take wp3-post`, then `node scripts/cert/cert3/build/fingerprint97.js cert3-post wp3-post` (exit 0: the 97 other companies unchanged). Its `.e2.json` lists 087's changed pairs: they must be V's tables (projects, activities, BOQ, allocations, cost codes and budget lines, direct costs and the ledger, loadings, periods, EV and budget snapshots, revisions, team, audit) and the request-noise tables only. Nothing on 087-EV (its two `EvPeriodSnapshot` rows keep their `lockedAt`), 087-SCH, 087-EXTRAS, 052 or 006. (If anything wrote after the restore of §2.2 other than WP-3 runs, compare against a fingerprint taken right after the restore instead.)
  2. The last proof run's throwaway check: 0 live `CERT3 WP3 Earned value` projects.
  3. Record the census in the journal.
- **Never commit a mutated tree.** After every invocation `git status` shows no product diff that is not the batch's; `mutate-multi.js` restores byte for byte and keeps backups in `C:\Temp\octapm-cert\mutate-backups\`; a RESTORE FAILED line stops everything until the file is restored by hand.

---

## 8. Codex (plan §6.4; owner rule 5)
- **Required for WP-3:** (a) the adversarial **plan review** of the L34 fix before any code (§4.2.2); (b) the **diff review** of the L34 product diff after the mutations; (c) the same pair for L106 only if it confirms P1 and is high risk.
- **Not required for** the proof, the lists, this plan or answer-book edits (test side): `/code-review` covers them.
- Rounds: stop when nothing CRITICAL or HIGH is open; at most 3, then escalate. No round for P2/P3 or test polish.
- Mechanics (memory `octapm-codex-review.md`): the desktop app's `codex.exe`; one whole pass per five-hour window; prompt and output in `scratch\wp3\` (`codex-l34-plan-review*.md`, `codex-l34-diff-review-r<n>.md`), adjudication beside each with every finding CONFIRMED / PARTIAL / REJECTED / EXPECTED BEHAVIOUR / TEST GAP. Never during a build, a proof, a mutation list or the full suite; if the usage limit blocks it, the batch waits and the re-run is scheduled for the next window.
- Review focus for the diff: fix plan §9 (completeness of the ledger read, `incurredOn` writers, C-1 byte identity, the `groupBy` relation filter, `formulaVersion` consumers, STORED-PRE-FIX soundness, reversal dating, consumers).

## 9. Code review
`/code-review` (high) on the WP-3 batch before its commit: the proof (the `L34_FIX` edit), the four lists, the evidence checker, this plan, the book's contract leaves, any repro, the L34 product diff and its tests. Findings adjudicated like Codex's. A finding that changes the proof is followed by one full proof run and a rerun of only the mutants whose catchers it touches.

## 10. Commit and push
No merge of `main` into `cert/full-saas-certification` (owner rule; it overrides CLAUDE.md's "pull origin/main before committing"). Commits, each pushed: (1) the L34 fix (product and unit tests; before `L34_FIX` is set, §4.2.5); (2) the WP-3 batch, `cert(CERT-3 WP-3): <one line>` (proof `L34_FIX`, lists, evidence checker, run plan, book leaves, results summary); (3) the docs (journal, workflow report, register). Messages end with the attribution line the committing session gives. `mutate-multi.js` lives in `C:\Temp` and is not committed; its four keys are recorded in the journal.

## 11. Journal
`OCTAPM_CERT_JOURNAL.md`, same heading style: the restore; the primary run (passed / failed / known answers by status, exit); the classification table; the L34 route (Codex rounds and adjudications, the owner's answers to O-1..O-6, the fix commit, `L34_FIX`, the targeted and full runs with the STORED-PRE-FIX reading); the mutation results per mutant with their named catchers, the E6 tally and the TEST GAPs (L34-M3, L34-M4, and L34-M5 if the contract was pending); the census; the reviews; the owner questions (HR-S9, HR-E2, HR-E3, HR-E4, Q6, Q11); the next exact action (restore `cert3d`, WP-4).

## 12. The WP-3 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register

Add `## WP-3 Earned value, reporting periods, forecast - <CLOSED | IN PROGRESS> (<date>)` after WP-2, in the WP-0 section's shape. The result column holds `passed/total`, the exit code, and every known answer's ref.

| Rule or item (plan WP-3) | Evidence (final check ids) | Result |
|---|---|---|
| PV from approved loadings up to the cutoff date (:630) | EVS.setup, EVS.T1, T4.inputs (V), the PV of KA.EVS.T3 and KA.D2.stored.T3 | |
| EV = approved allocation x latest progress approved by the cutoff instant; EV reads approved progress only (:631, :644) | EVS.T1, EVS.T7, T7.live.hash, KA.EVL.runDate (EV), EVS.afterLock.runDateAfterApproval; mutation M4 (§6.2); the status-filter mutants equivalent | |
| AC: ledger entries dated by `incurredOn` (L34, decided; :632, HR-E1) | the 13 decided-rule checks; fix `<sha>`; L34-M1, L34-M1R, L34-M2 caught; UL34-*; 8 STORED-PRE-FIX | L34 Fixed; ev.v2 snapshots in `cert3d` recorded |
| Formulas SPI, CPI, EAC, SV, CV, ETC; alerts below 0.9 only (:633) | EVS.T1, EVS.T2 (CLAUDE.SPI / CPI / EAC), the 15 T4 checks on V; mutations M1 (§6.2), M1a, M1b | HR-E3 owner question |
| Cutoff = end of the reporting date in the project's zone; +05:30 and +05:45 (:633, :392) | EVS.zone, the cutoffs of KA.EVS.T3, KA.D2.stored.T3 (Chicago), D3.stored.T1 (Dubai), DP.halfHour; CF.WP3TZ1 | WP3-TZ-1 REJECTED |
| Period code and date refusals (:634, :646) | PER.duplicateCode (409 CONFLICT), PER.endBeforeStart (400 INVALID_REPORTING_PERIOD_DATES), EVS.periods | |
| Lock roles and the gate (:634, :647) | EVS.feb.lockAsPlanner, .financeWhileBlocked, .financeWithOverride, .lockByPm, EVS.jan.lockNormal; PER.V.planner, .financeBlocked, .financeOverride, .pmOverride; mutations M3 (§6.2), M3b; UM3 | |
| A PM override is audited (:634, :647) | PER.overrideAudit.feb, PER.V.overrideAudit | |
| A locked period is served from its snapshot; relock returns it (:634, :648) | EVS.afterLock.periodReport, EVL.febPeriod.hash, PER.V.afterLock.periodHash, PER.relock.jan, PER.relock.feb, PER.V.relock; mutations M2 (§6.2), M2b; UM2 | |
| After the lock the cutoff-date report changes (:648) | KA.EVS.afterLock.cutoff0228 (STORED-PRE-FIX), KA.EVL.cutoff0228, PER.V.afterLock.cutoffChanges | |
| Loadings in a locked period refused (:634, :648) | PER.loadingLocked (409 REPORTING_PERIOD_LOCKED; the loading names the period) | Q11 recorded |
| Default period (:649) | DP.on20260305, DP.on20260401, DP.chicagoCaution, DP.halfHour | |
| A lock before the cutoff is recorded (L113, :650) | KA.PER.futureCutoffLock (V-F), CF.L113 | BLOCKED HR-E2 |
| Forecast pace and EV-based finish (:652-653) | FC.pace.basis, FC.pace.projectedFinish, FC.pace.slipDays, FC.evBasedFinish | |
| L106 budget lines (:654, :666) | KA.FC.L106, CF.L106 | BLOCKED L106 (P2) or fixed (P1) |
| The site engineer and forecast money (:655) | FC.siteEngineerMoney | E1 behaviour; Q6 reported |
| T5 budget revision; L112 (:642, :664) | EVS.T5, KA.EVS.T5delete, CF.L112 | BLOCKED L112 (P2) |
| T6 retirement (L118 -> HR-S9) (:643, :663) | EVS.T6.before, KA.EVS.T6.after, KA.EVL.runDate, CF.L118 | BLOCKED HR-S9 |
| 052-SCH-EV and 006-LITE lanes (:443, :449) | D2.stored.T1, D2.stored.T2, KA.D2.stored.T3, KA.D2.live.T3, D3.stored.T1 | |
| Confirm-first items (:661-669) | CF.* (`observations.confirmFirst`) | CF.L34 REJECTED (fixed); 8 CONFIRMED reported; CF.WP3TZ1 REJECTED |
| Known answers | §5 of this plan | 4 value, 6 BLOCKED with refs, 8 STORED-PRE-FIX |
| Mutations (E6) | `results\cert3\wp3-mutations\<id>.json`, the two unit results, `wp3-mutation-evidence.js` output | 4/4 §6.2 guards; variants; L34 fix mutations; TEST GAPs named |
| Reviews (E11) | Codex plan and diff reviews of L34, `/code-review` | |

Register (`OCTAPM_LAUNCH_BLOCKERS.md`): L34 -> Fixed at `<sha>` (with the ev.v2 snapshots that stay understated in `cert3d`); L112, L106, L113 / HR-E2, L118 / HR-S9 with their classification and severity; new rows WP3-CONC-1 (concurrent locks, P3 proposed) and WP3-ACTOR-1 (the actor role on cost loadings, P3 proposed); WP3-TZ-1 closed REJECTED; the TEST GAPs of §13.1; HR-E3 / HR-E4 as owner questions.

---

## 13. Limitations, TEST GAPs and notes (the lists refer here)

### 13.1 L34 fix mutations the proof cannot catch
- **L34-M3** (reversals left out): no WP-3 proof step voids a cost (plan §0.0: no new step) and no build writes a ledger reversal on 087-EV or 052-SCH-EV. Expected SURVIVED; recorded as a TEST GAP. Live catcher only R6 of the optional `wp3-l34-repro.js`; unit catcher U-3 (not evidence).
- **L34-M4** (through-date blanked): no check of the 93 reads `activityBreakdown[].officialActualThroughDate`. Expected SURVIVED unless the owner adopts the fix plan's recommended `L34.contract` check (§6.3 there; count 94). Unit U-2 / U-3.
- **L34-M5** (version back to ev.v2): caught by the contract check of the four live/fresh L34 checks only when `WP3.L34.formulaVersion` carries its adjudicated value; SURVIVED while it is pending. The evidence checker reads the result's `observations.l34Fix.contract` to decide.

### 13.2 No unit catcher
M1 / M1a / M1b (no test has SPI or CPI exactly 0.9), M2b (no test relocks), M3b (no test overrides as a non-PM), M4 (the mocked activities carry no `progressSubmissions`: a TypeError, a crash), L34-M1R (`costRecord` leaves the suite's mock: a crash). Listed in the unit lists so nobody looks for one. Adding unit tests is allowed only inside the fix batch, never as a new requirement.

### 13.3 Notes for the integration owner
- **CATCHERS (:578) and PER.V.afterLock.cutoffChanges.** The proof names four catchers for L34-M1 / L34-M2; PER.V.afterLock.cutoffChanges fails under both as well (the fix plan names it). The lists keep it as collateral; adding it to CATCHERS is a one-line proof edit, optional.
- **M2's collateral** (KA.EVL.janPeriod.figures, PER.V.relock) is derived from the proof's code paths; the book's `WP3.mutations.lockedRecomputed` names the catchers only, which stays right.
- **L34-M1R corrected.** The fix plan's L34-M1R (and its scratch copy) also deletes `const LEDGER_AC_SOURCE`, which `sourceSummary.ac.officialSourcePriority` still reads: it parses but throws a ReferenceError in every report at run time (a crash, no evidence). The list's L34-M1R swaps only the `groupBy` call and the reduce head and keeps the constant.
- **L34-M1's nested `none` filter** in a `groupBy` where needs Prisma's acceptance (fix plan R-4). If Prisma refuses it, the probes throw, the catchers read NOT RUN, and L34-M1R is the put-back of record.
- **Served-version cross-check.** The fix plan §6.2 (ii) proposes also requiring a frozen snapshot to serve `formulaVersion` ev.v2 before STORED-PRE-FIX applies; the committed proof judges by time only (`kaStatus`). Optional hardening.
- **Runner prefix match.** `--only=<value>` without a comma is a prefix match; the quoted trailing comma (§7.4) is the exact match. Alternatively `mutate-multi.js` gains an exact `--id=` (a runner change).

### 13.4 Book notes (for the book owner, under Claude Main; A10)
- The contract leaves after the plan review (§4.2.3); G21's "today cleared once fixed" waits for the exit rebuild (CHANGES-WP0-BUILDERS.md :1295-1297).
- `field-controls.js:808` (087-HLT `acAtCutoff`) keeps its value; its HEAD-reading sentence may be reworded (fix plan §11).

---

## 14. Hazards (read before running)
- `cert3d` must exist and the population must be complete (five state files: 087-EV, 087-SCH, 052-SCH-EV, 006-LITE, 087-EXTRAS); `mutate-multi.js` cannot pass flags.
- One writer: proofs only through `run-locked.js`; a mutation list with the lock held for the whole invocation; no build, Codex or full jest suite at the same time (OPS-1).
- The mutation lists run only after the L34 fix with `L34_FIX` set and the unmutated full run exiting 0 on the same code (§7.3); CAUGHT counts only when the named catchers read FAIL and read PASS in the baseline (§7.4).
- `--only` values quoted with a trailing comma (§7.4), one id per invocation, the result copied after each.
- After any product diff (the fix, a review follow-up, a WP-2 landing): `mutsyntax-wp3.js` again, and A10 re-derivation of any list `expect` the change moves.
- Never amend the L34 fix commit once `L34_FIX` names it; S.state checks the time against git.
- The cert API is never (re)started while a mutant is applied.
- KA.PER.concurrentLocks is a race (§5.4); Cairo midnight (§5.4).
- State files are not in the snapshot: never run a builder after `cert3d` without taking it again.
- Secrets: `CERT_PASSWORD` only through `lib/api.js`; results and logs are scrubbed by the harness; never paste a token or a password into the journal.
