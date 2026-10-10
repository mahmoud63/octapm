# CERT-3 WP-7 run plan (contract time: EOT and the weather 70% rule)

Plan `docs/certification/OCTAPM_CERT3_PLAN.md` section 7 step 4 (:1186), for WP-7 (section 4 :837-871), on snapshot `cert3d`.

**Drafted read-only 2026-10-10** (preparation agent; to be adopted, edited and committed by Claude Main) against:
- the installed proof `scripts/cert/cert3/wp7-eot-proof.js` at `bfa6287`: 55 fixed checks (`EXPECTED_CHECKS`, asserted at load) plus the harness's `G.5xx`; its CHECKS table (:217-282) carries the id, plan line, answer-book key, where each check runs and its section; `FIXES` (:520-525, all empty: HR-C10, HR-C11, HR-F4, PROMO-TX); `DECIDED_RED` (:536-560, empty at HEAD); `CONTRACT` (:575-580, all null); `CATCHERS` (:596-599: M-70, M-STAT); `OPTIONAL_CATCHERS` (:601-608: M-WF, M-PROOF, M-CUM, M-ALLOW, M-NC, M-REASON); `COLLATERAL` (:610-619); `FIX_CATCHERS` (:625-628: M-LOCK, M-C10i, M-C11z, M-C11d, M-PTX, M-F4);
- the five drafted mutation lists in `C:\Temp\octapm-cert\scratch\wp7\lists\` (section 7.1): `wp7-mutations.contract.json` (2 mutations + 1 equivalent + 1 not run), `wp7-mutations.optional.json` (6 + 1 equivalent), `wp7-mutations.unit.json` (3 + 5 noUnitCatcher lines), `wp7-fix-mutations.contract.json` (6 pending), `wp7-fix-mutations.unit.json` (6 pending); built by `build-lists-wp7.js`; every `from` counted, every mutant parsed, every id checked by `mutsyntax-wp7.js` (report `mutsyntax-wp7-report.json`, 0 problems; its teeth `teeth-mutsyntax-wp7.js` 22/22); the runner replay `check-runner-wp7.js` (ok);
- the drafted evidence checker `wp7-mutation-evidence.js` (section 7.3; its self-test `selftest-evidence-wp7.js` 30/30 on synthetic results built from the debug result; the self-test's own teeth `teeth-evidence-wp7.js` 9/9);
- the answer books `answers/commercial.js` and `answers/field-controls.js` after the WP-7 book patch (`bfa6287`; `WP7.mutations.*` :2023-2028);
- the binding adjudication `C:\Temp\octapm-cert\scratch\wp7\WP7-ADJUDICATION.md` (Q1-Q13; cited WP7ADJ) and the integration owner's WP-4 list rulings `C:\Temp\octapm-cert\scratch\wp5\PREP5-ADJUDICATION.md` "WP-4 mutation lists" L1-L6 (cited L1..L6), which this plan applies to WP-7 unchanged;
- the mutation draft `C:\Temp\octapm-cert\scratch\wp7\wp7-mutations-draft.json` and its anchor scan `mutation-anchor-scan.json`;
- the WP-2 HR-X1 r3c simulated copies of `eot.service.js` and `weather.service.js` (`C:\Temp\octapm-cert\scratch\wp2\fixplan-hrx1\r3c\syntax-r3c\sim\`), used as the second anchor tree (section 15).

**State at drafting.** HEAD `2a2efd2` on `cert/full-saas-certification`, worktree clean; `backend/src` identical to `f599e67`; the proof installed at `bfa6287`. The proof was debug-run twice by Claude Main on the partial population of build order run 1 (`C:\Temp\octapm-cert\logs\cert3-wp7-debug-1.log`, `-2.log`, `--skip=F52,CF`; run 2: 50 of 50 pass, 11 known answers BLOCKED, 0 5xx, exit 0, 22 s; PROMO-TX reproduced 3 of 3 rounds each; 6 residue rows on the archived T7). Those runs debugged the proof; they are not WP-7 evidence. No list, checker or plan here was run against the database or the API.

---

## 0. Rules that bind every step

**Owner execution rules (CERT-3 parallel execution mode, strict one-writer).**
1. **One writer.** Only Claude Main modifies the certification worktree, writes the certification database (:55433) or the cert API (:5190), runs proofs, mutation runs (they edit product files), restores snapshots, runs Codex, commits and pushes. Preparation agents are read only and write only to their scratch folders.
2. **Pipeline.** While Claude Main executes WP-7, read-only agents prepare WP-8. No open-ended defect hunting.
3. **Snapshots.** `cert3d` is the one working CERT-3 baseline. After a landed migration, every later restore re-applies it (the WP-2 batches; WP-4's HR-C1 migration and backfill; any later one); no second baseline snapshot.
4. **Reruns.** After a fix, targeted proof sections first (section 6); complete runs only where the plan requires them: the WP-7 primary run (also the HEAD mutation baseline, section 7.3), one full run on the final code if a WP-7 fix lands (also the post-fix mutation baseline), and the exit run.
5. **Codex** only for the plan's required reviews (section 8). No extra round for P2/P3 or test polish once nothing CRITICAL/HIGH is open.
6. **Long runs** (> 1.5 h) detached under the watchdog. Nothing in WP-7 is that long (the proof runs in under a minute; each mutant about as long).
7. **Manual UX** never holds WP-7 and never uses :5190 or the cert database while a proof or a mutation list runs.

**Plan rules.** Section 0.0 (no new rounds, matrices or requirements; rerun only invalid cases), section 1.4 (known answers first, A10; checks assert; reproduce before fixing; a fix is followed by a mutation that puts the defect back), section 5's defect-fix list (:1107-1121: "weather promotion in one transaction" :1115 goes ahead after reproduction only if it confirms P1; P2/P3 recorded under the scope freeze), section 6.4 gates, section 7 detached-run rules. **No HR rule is decided by this plan**: HR-C10, HR-C11 and HR-F4 stay undecided and their known answers read BLOCKED at `today` with their ref; PROMO-TX's severity is decided at the primary run from the reproduction (WP7ADJ Q6).

**Standing rulings (WP7ADJ).** Product routes only; no SQL fixtures (read-only SQL and the pure lock-holder connection are allowed); a value equal to HEAD's today under an undecided rule reads BLOCKED; every writing check and every catcher on a throwaway (T7, T7H); N-round concurrency probes; every figure a book leaf; company 087 plus the read-only 052-FLD reads only.

---

## 1. Sequence

| # | Step | Who / where | Expected |
|---|---|---|---|
| 0 | Precondition: WP-6 closed (committed, pushed, journalled); **the WP-2 batches landed** (WP7ADJ Q13: WP-7 runs on post-fix code; HR-X1 edits `eot.service.js` and `weather.service.js`); `cert3d` exists with all three deep projects (087-COM, 087-FLD and **052-FLD** with their state files) | Claude Main | the WP-6 row of the workflow report written |
| 1 | Restore `cert3d` (section 2.2), re-apply every migration landed after it | Claude Main | API up on :5190; restore journalled |
| 2 | No-DB checks: `node --check` the proof; `build-lists-wp7.js` then `mutsyntax-wp7.js --no-sim` on the post-WP-2 tree (section 15); the five lists and `wp7-mutation-evidence.js` copied in; the five `LISTS` lines added (section 7.1); `check-runner-wp7.js` | Claude Main | HEAD lists: every anchor once on the tree, every mutant parses, unit titles present; fix lists: pending only |
| 3 | **Primary run** of `wp7-eot-proof.js`, full, no flags, `FIXES` empty (section 2.3); copy the result to `.primary.json` and `.baseline-head.json` | Claude Main, lock held | exit 0, PASS: 55 + G.5xx green; 13 known answers BLOCKED; 3 confirm-first CONFIRMED; 0 wrong; 0 5xx; 6 residue rows (section 5.1) |
| 4 | Classify every reported known answer and confirm-first item (section 3); PROMO-TX severity from `observations.runObservations.promoSeverityEvidence` (WP7ADJ Q6); owner questions | journal, register | table filled |
| 5 | **HEAD mutation batch** (section 7): `wp7-contract` (M-70, M-STAT), then `wp7-optional` (six), one id per invocation; then `wp7-unit`; the evidence check against the HEAD baseline | Claude Main, lock held | M-70 and M-STAT CAUGHT; the six optional CAUGHT (recorded, untallied); unit 3/3 caught by named tests; **E6 2/2** |
| 6 | **PROMO-TX fix route** only if step 4 classifies it P1 (section 4.1) | Claude Main | targeted `--only=PROMO` green, full run exit 0 (section 5.2) |
| 7 | Owner decisions HR-C10 / HR-C11 / HR-F4 (O1-O3): no change before them. If one is decided inside CERT-3, its own fix route (section 4.2) | owner, then Claude Main | each its own targeted and full runs |
| 8 | **Post-fix mutation batch** (only if a WP-7 fix landed): the landed entries moved from `pending[]` into `mutations[]`, `mutsyntax-wp7.js --post-fix`, one id per invocation, the evidence check against the final baseline; HEAD entries whose file changed re-run (section 7.6) | Claude Main, lock held | each fix mutant CAUGHT; E6 stays 2/2 (guard 2 needs M-EOTLOCK too once HR-C10 lands) |
| 9 | Regression: the read-only lifecycle verifier (E7) | Claude Main | as at WP-0 |
| 10 | Codex: the PROMO-TX plan and diff reviews if it lands; HR-C11's migration diff if it lands (section 8) | Claude Main, one pass per window | nothing CRITICAL or HIGH open |
| 11 | `/code-review` (high) on the WP-7 batch (section 9) | Claude Main | findings adjudicated |
| 12 | Commit and push (section 10) | Claude Main | no merge of `main` |
| 13 | Journal entry (section 11) | Claude Main | figures, table, tallies, restores, census, reviews, next action |
| 14 | The WP-7 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register rows (section 12) | Claude Main | rule -> evidence -> result for every WP-7 rule |
| 15 | Restore `cert3d` before WP-8, re-apply the landed migrations | Claude Main | WP-8 starts clean |

---

## 2. Restore `cert3d` and the primary run

### 2.1 When to restore
- **Before the primary run.** WP-1..WP-6 leave archived throwaways in 087 and their mutation residue; WP-2's batches may have touched 087-FLD's progress records; WP-4 consumed 087-COM-C's one-shot I5. WP-7 reads 087-COM (claims, weather, audit counts across `/eot/calculate`), 087-FLD and 052-FLD against their state files (S.state, S.projects): a restore is cheaper than reasoning about them.
- **Not after any WP-7 HEAD list.** Every mutant writes, if at all, only on the run's throwaways T7 and T7H (archived by the proof's cleanup, which also runs after a section error). The deep sections run first and only read (087-COM's `POST /eot/calculate` writes nothing under any WP-7 mutant; the proof asserts 087-COM's EOT claims, weather delays and audit events unchanged across it, WP7ADJ Q3). 052 is signed into and read only. The census proves it (section 7.7).
- **Not after a WP-7 fix.** A PROMO-TX fix with a constraint or an HR-C11 decimal migration is applied to the running certification database by the deploy sequence, not by a restore; the stored 087-FLD / 052-FLD moments keep HEAD's answers and read STORED-PRE-FIX until the exit rebuild (WP7ADJ Q9).
- **Before WP-8.** WP-7 leaves one archived `CERT3 WP7 contract time <stamp>` and one `CERT3 WP7 half days <stamp>` project in 087 per proof run (about twenty with the primary, mutation and final runs), each T7 with its six residue rows at HEAD (WP7ADJ Q11).

### 2.2 How (the build order's own mechanism, `build-cert3d.ps1` :42-80)
From `backend/` with `DATABASE_URL` unset and the proof lock not held (`C:\Temp\octapm-cert\locks\proof.lock` absent):
1. Stop the cert API as `build-cert3d.ps1` does (`Stop-CertApi`: the process on :5190 must be the recorded `api.pid`; never stop another process).
2. `node scripts/cert/snapshot-db.js restore cert3d`
3. Every migration landed after `cert3d` was taken: `node C:\Temp\octapm-cert\migrate-cert.js` (and, where one landed, its backfill under its owner rule and the client guard `npm run prisma:generate`), the API down across all of it.
4. `powershell -NoProfile -ExecutionPolicy Bypass -File C:\Temp\octapm-cert\start-api.ps1`
5. Record the restore in the journal (time, reason).

Never run a builder after `cert3d` without taking the snapshot again: the state files `C:\Temp\octapm-cert\state\cert3\*.json` are not in the snapshot, and the proof's `S.projects` refuses a state file whose `projectId` differs from the live project (setup error).

### 2.3 The primary run
```
cd <worktree>\backend
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp7-eot-proof.js
```
- **No flags on `cert3d`.** `--only` / `--skip` / `--project` exist for targeted reruns (section 6) and partial populations (the debug runs' `--skip=F52,CF`). They are never used for the primary run, the final run or a mutation run: `mutate-multi.js` spawns the proof without arguments.
- `CERT_PASSWORD` comes from `backend/.env` through `lib/api.js`; never echoed, copied into this plan, the results or the journal.
- Setup: company 087's pm, planner and site engineer and 052's pm and planner sign in; 087-COM, 087-FLD and 052-FLD resolve by exact name, one live each, matching their state files (S.state, S.projects); T7 and T7H are created in 087 (S.T7.create, S.T7H.create); the blocker connection self-tests on T7 (S.T7.barrier) before any PROMO-TX round.
- **Expected console:**
  - `wp7-eot-proof: stamp <stamp>; 56 checks (fixed)`
  - `wp7-eot-proof: 55 of 55 checks active; sections S T1 T23 T45 W PROMO WH COM F87 F52 CF; deep projects 087-COM, 087-FLD, 052-FLD; throwaways T7 yes, T7H yes; companies 087, 052 only; fixes HR-C10 not set, HR-C11 not set, HR-F4 not set, PROMO-TX not set; in process`
  - section order: `087-COM` (COM, `probe: KA.T4.087COM.calculate`), `087-FLD`, `052-FLD`, then `T7: T7-0`, `T7-1`, `W1-W7`, `E1-E3`, `E4`, `E5`, `P0`, `P1-P4`, `CF the project date`, `the end`, then `T7H: H0`, `H1-H2`, `the end`, then `confirm-first classification`;
  - three `PrismaClientKnownRequestError ... No record was found for an update` stack traces from `daily-log.service.js:1213` during `probe: KA.PROMO.T7.failure`: the three failure rounds' promotions losing their entry (HEAD's 404 NOT_FOUND, never a 5xx), as in debug run 2; not a failure;
  - `tally: 55 pass, 0 fail of 55 recorded (55 active); failures: none; known answers: 0 value, 13 BLOCKED, 0 STORED-PRE-FIX, 0 fail (0 wrong)`
  - `confirm-first: CF.HRC11 CONFIRMED; CF.HRC10 CONFIRMED; CF.PROMOTX CONFIRMED`
  - `PASS  G.5xx  no answer was a 5xx (a 5xx never passes)`
  - cleanup: T7H archived (200, `archivedAt`), T7 archived (200); `T7 residue (WP7ADJ Q11): 6 weather rows no delay entry names (... RACE-1..3 ... FAIL-1..3 ..., each 1 contractual)`; two throwaway checks `0 live`; `companies touched: 087, 052 (087 for every write; 052 read only, and only with F52: WP7ADJ Q7)`; `blocker: a separate pg connection that only read, locked and rolled back`; `deep projects: nothing written (POST /eot/calculate on 087-COM left its claims, weather delays and audit events unchanged)`;
  - `wp7-eot-proof: 56 passed, 0 failed of 56 (fixed); PASS, exit 0`.
- The tally's `pass` counts PASS, BLOCKED and STORED-PRE-FIX records: the 13 BLOCKED known answers are passes for the harness, counted apart in the known-answer tally.
- Result: `C:\Temp\octapm-cert\results\cert3\wp7-eot-proof.json` (`checks[]`; `meta` with `decidedRed`, `fixes`, `contract`, `catchers`, `optionalCatchers`, `fixCatchers`, `collateral`, `deviations`, `leads`, `filter`, `activeChecks`; `observations.checks`, `.knownAnswers`, `.confirmFirst`, `.fixes`, `.runObservations` (barrier traces, race and failure rounds, `promoSeverityEvidence`, `residue`), `.tally`; `answers.fiveXX`; `cleanup`). **Copy it at once** to `wp7-eot-proof.primary.json` and to `wp7-eot-proof.baseline-head.json` (the HEAD mutation baseline, section 7.3); every later run overwrites the result file. Record `git rev-parse HEAD` and `git status --porcelain backend/src backend/scripts/cert/cert3` with the copy in the journal.
- Exit semantics (harness rule 5, A10): **0** every check holds (the expected answer at HEAD: no WP-7 rule is decided); **2** a check failed (DEFECT_PRESENT): at HEAD a `wrong` known answer or a HARD red, to classify first as a possible proof defect (A10); **1** setup error (a check not run, a section that threw, an R-SET probe whose own setup failed, a blocker barrier that did not form) - never a product result: fix the proof or the fixture and rerun.
- **First full execution of F52 and CF.** Both were filtered out of the debug runs (052-FLD had no `cert3d` state). A red there is read first as a possible proof defect (TEST GAP) before it is classified as a product failure. `--only=CF` registers 44 checks (CF selects its sources) if CF alone needs a rerun.

---

## 3. Classification table

Every failed check and every reported known answer and confirm-first item gets a row. Classification per plan section 0.0 item 4 / section 6.4: CONFIRMED, PARTIAL, REJECTED, EXPECTED BEHAVIOUR, TEST GAP. Severity per section 1.4. Destination: **fixed in WP-7** (section 4.1), **owner HR decision** (section 4.2), **register** (P2/P3 under the scope freeze), **proof or book corrected** (TEST GAP, logged with its derivation, A10), **closed** (EXPECTED BEHAVIOUR, rule cited).

Pre-filled rows ("observed" = the code reading and the debug runs; replaced by the `cert3d` primary run):

| # | Check id(s) | Book key | Observed (HEAD) | Expected (value) | Today + ref | Proposed classification | Severity | Destination |
|---|---|---|---|---|---|---|---|---|
| 1 | KA.PROMO.T7.race, KA.PROMO.T7.failure, CF.PROMOTX | WP7.promotion.race / failure, WP7.CF.PROMOTX | two promotions behind the blocker both 200, two contractual rows, one orphaned (3/3); a promotion racing the entry's DELETE answers 404 yet commits an orphaned contractual row (3/3) | one 200 + 409, one row; DELETE 200, the promotion refused, no row | today, PROMO-TX (fix list :1115) | CONFIRMED (debug 3/3 each) | P1 proposed if the duplicates / orphans reach contractualUsed, the 70% flag, notices or the forecast (WP7ADJ Q6; `promoSeverityEvidence`) | fixed in WP-7 if P1 (section 4.1) |
| 2 | KA.W.T7H.half28, KA.W.T7H.storedOneAndHalf, KA.FLD.087.stored, KA.FLD.087.live, KA.FLD.052.stored, KA.FLD.052.live, CF.HRC11 (E-HALF's 1.5 read back 1) | WP7.T7H.half28, WP7.weather.fractional.*, WP7.weather.087-FLD.read, WP7.weather.052-FLD | half-days stored 0 (0%, no warning); 1.5 stored 1; the FLD record sets 11/55% then 12/60% | 14/70%, the warning; 1.5; 13/65% then 14/70% | today, HR-C11 | CONFIRMED | P1 proposed (plan :868) | owner HR decision (O2) |
| 3 | KA.W.T7.allowanceZero, CF.HRC11 (zero-allowance item) | WP7.weather.allowanceZero.T7 | an allowance of 0 stored 0, read as 20 (7 / 35%) | 0, 0% | today, HR-C11 | CONFIRMED | owner's | owner HR decision (O2) |
| 4 | CF.HRC11 observations (reported, never classified) | WP7.CF.HRC11 | no notification names weather after 70%; no server reader of the summary | - | HR-C11 keeps the flag | EXPECTED BEHAVIOUR under the recommendation (a notice is the owner's call) | - | owner question (O2) |
| 5 | KA.T2.plannerPatchApproved, KA.T4.T7, KA.T4.087COM.calculate, CF.HRC10 | WP7.T2.plannerPatchApproved, WP7.T4.storedFields, WP7.T4.on087COM | the planner's PATCH of an approved claim 200 (30 days); impact summed over activities (20, LD 10,000.00) on T7 and through `/eot/calculate` on 087-COM | 409; impact 10, LD 0.00 | today, HR-C10 | CONFIRMED | owner's (P1 proposed for the summed LD) | owner HR decision (O1) |
| 6 | CF.HRC10 observations (reported, never classified) | WP7.CF.HRC10 | the project date never moves; two recommendations (EOT-REC-2: E-T3 2027-07-05 against 2027-07-15) | - | HR-C10 keeps the date manual | EXPECTED BEHAVIOUR (date); EOT-REC-2 lead P3 | P3 | register (lead) |
| 7 | KA.F4.T7.sitePromotion | WP7.promotion.sitePromotion | the site engineer (no eot:create) promotes: 200, contractual, +1 | non-contractual, +0 | today, HR-F4 | probed here, classified by WP-8 (WP7ADJ Q8) | owner's | owner HR decision (O3), WP-8 |
| 8 | Leads (WP7ADJ Q10; `meta.leads`) | - | EOT-CONC-1, WX-DEL-1, DST-1, EOT-APPLY-1, EOT-REC-2 | - | - | recorded only | P2 (EOT-CONC-1, WX-DEL-1), P3 (DST-1, EOT-APPLY-1, EOT-REC-2) | register with the WP-7 proof commit |
| 9 | Residue (WP7ADJ Q11) | WP7.T7.residue | 3 duplicated + 3 orphaned contractual weather rows on each archived T7 at HEAD | - | PROMO-TX | known residue, listed by the cleanup | - | journal; repair of existing rows is O4 |
| 10 | Every HARD check (T1.*, T2/T3, T5.T7, W.T7.*, PROMO.T7.feeds / twice, COM.*, FLD.087.allowance) | WP7.*, deep.087-COM.*, claudeMd.weather70 | as their book values (debug run 2, 087-COM / 087-FLD / T7 / T7H) | the values | - | REJECTED (no defect) expected | - | closed |
| 11 | Debug runs 1-2 (partial population) | - | run 1 setup error (engineerIds); run 2 50/50, 11 BLOCKED | - | - | not evidence | - | journal |

Owner questions carried to the consolidated list (WP7ADJ): O1 HR-C10; O2 HR-C11 (decimals or refuse; allowance 0; the 70% notice; one day against a zero allowance); O3 HR-F4; O4 repair of existing duplicate or orphan weather rows (it changes the 97-company fingerprint); O5 HR-A2 (weather delete permission, or archive).

---

## 4. What WP-7 fixes, and what waits for the owner

### 4.1 The PROMO-TX fix route (section 5 defect fix :1115; only if the primary run confirms P1, WP7ADJ Q6)
1. **Reproduction.** The primary run is the reproduction: KA.PROMO.T7.race and KA.PROMO.T7.failure at today in every round (N=3 each, every waiter confirmed through `pg_blocking_pids`), CF.PROMOTX CONFIRMED, `promoSeverityEvidence` (extra contractual days from duplicates and orphans; whether the 70% flag, the notice monitor and the forecast read those rows).
2. **Severity** by the integration owner from that evidence (WP7ADJ Q6). If P2/P3: recorded in the register under the scope freeze; nothing below happens; M-PTX stays pending.
3. **Fix plan** (read-only preparation): the entry locked or claimed first, re-checked under the lock, the weather delay created and the entry linked in one transaction (`RULES['PROMO-TX']`); the losing promotion's answer named for `CONTRACT['PROMO-TX'].failureCode`; whether `weatherService.createWeatherDelay` takes the transaction (then `weather.service.js` changes: section 7.6); any constraint (a migration: deploy sequence, re-applied after every restore).
4. **Codex adversarial plan review** (it moves contractual days: high risk). Rounds stop when nothing CRITICAL/HIGH is open; at most 3.
5. **Fix** per the adjudicated plan, its unit case (the PROMO-TX unit side, `UM-PTX`), unit suites green on a quiet machine.
6. **Fix commit** (`fix(CERT-3 WP-7): weather promotion in one transaction (PROMO-TX)`), never amended afterwards; then `FIXES['PROMO-TX']` = `{ commit, committedAt }` from `git show -s --format=%cI <sha>` and `CONTRACT['PROMO-TX'].failureCode` (S.state checks the time against git).
7. **Targeted** `--only=PROMO` (the T7 choreography runs whole), then **one full run** (section 6.3: the WP-7 result and the post-fix mutation baseline).
8. **M-PTX** derived from the fix diff (moved from `pending[]` into `mutations[]` of `wp7-fix-mutations.contract.json` with `from` / `to`), `UM-PTX` likewise; `mutsyntax-wp7.js --post-fix`; the post-fix batch (section 7.4); Codex diff review; `/code-review`; commit and push; journal and register (PROMO-TX -> Fixed at `<sha>`).
- The residue already on archived throwaways and any duplicate rows elsewhere are not repaired by the fix (O4, owner).

### 4.2 Waits for an owner decision (no change before it)

| Row | What WP-7 observes | Today | Recommendation (plan section 5) | If decided inside CERT-3 |
|---|---|---|---|---|
| HR-C10 (O1) | KA.T2.plannerPatchApproved, KA.T4.T7, KA.T4.087COM.calculate, CF.HRC10 | approved claims editable; impact summed; the project date manual | lock approved claims (409); impact = delay - the least float; keep the date manual | fix route as 4.1 (Codex plan and diff reviews: LD figures); `FIXES['HR-C10']` + `CONTRACT['HR-C10'].lockedAnswer`; M-EOTLOCK (joins M-STAT for E6) and M-C10i move into `mutations[]` |
| HR-C11 (O2) | KA.W.T7.allowanceZero, KA.W.T7H.*, KA.FLD.*, CF.HRC11 | 1.5 -> 1; 0 -> 20; the warning only a flag | store half-days (decimal migration) or refuse non-integers; 0 means 0; keep the flag | a reviewed migration (`prisma migrate diff`, dated after the future-dated ones; memory "OctaPM schema drift"); `FIXES['HR-C11']`, `CONTRACT['HR-C11']`; the FLD known answers read STORED-PRE-FIX until the exit rebuild (WP7ADJ Q9); `CATCHERS['M-70']` gains KA.W.T7H.half28; M-C11z, M-C11d; under "refuse" the T7H fixture and leaves are re-derived first |
| HR-F4 (O3) | KA.F4.T7.sitePromotion | the site engineer's promotion contractual | contractual only with eot:create | WP-8 classifies (WP7ADJ Q8); `FIXES['HR-F4']`, `CONTRACT['HR-F4'].siteAnswer`; M-F4 |
| O4 | the residue and any existing duplicates / orphans | not repaired | the owner's call (it changes the fingerprint) | - |
| O5 (HR-A2) | WX-DEL-1 | weather delays hard-deleted under eot:update | the owner's call | - |

### 4.3 The WP-2 batches (WP7ADJ Q13)
WP-7 runs after WP-2's fixes land, on post-fix code. The HR-X1 batch edits `eot.service.js` and `weather.service.js` (orgId at the `syncEvidenceReferences` calls, HRX1-FIX-PLAN.r3c): every WP-7 anchor in those files is re-scanned after it lands (section 15). T7 cites only its own uploaded documents, so XDOC-1 is never re-tested here.

---

## 5. Known answers and where each check runs

### 5.1 What the primary run WILL report (no fix set; so nobody mistakes them for failures)

**Part A, decided-rule checks:** none (DECIDED_RED is empty at HEAD). Exit 0.

**Part B, the 13 known answers BLOCKED (undecided; never exit 2):** KA.T2.plannerPatchApproved, KA.T4.T7, KA.T4.087COM.calculate (HR-C10); KA.W.T7.allowanceZero, KA.W.T7H.half28, KA.W.T7H.storedOneAndHalf, KA.FLD.087.stored, KA.FLD.087.live, KA.FLD.052.stored, KA.FLD.052.live (HR-C11); KA.PROMO.T7.race, KA.PROMO.T7.failure (PROMO-TX); KA.F4.T7.sitePromotion (HR-F4).

**Part C, confirm-first reported (CONFIRMED expected, a pass):** CF.HRC11, CF.HRC10, CF.PROMOTX.

**Green:** 11 setup + 27 HARD + 1 STORED (COM.stored.eotFigures), and G.5xx.

### 5.2 What a final run reports after a WP-7 fix
- **PROMO-TX fixed:** KA.PROMO.T7.race and KA.PROMO.T7.failure value (every round), CF.PROMOTX REJECTED (a defect check now: DECIDED_RED extends itself); the residue line lists 0 new rows on that run's T7; `known answers: 2 value, 11 BLOCKED`; exit 0, PASS.
- **HR-C10 fixed:** its three known answers value, CF.HRC10 REJECTED.
- **HR-C11 fixed:** KA.W.T7.allowanceZero, KA.W.T7H.half28, KA.W.T7H.storedOneAndHalf value; KA.FLD.087.stored / live and KA.FLD.052.stored / live STORED-PRE-FIX (rows built before the fix) until the exit rebuild; CF.HRC11 REJECTED only once the stored record sets are rebuilt (before that they are gaps: the proof's open question on PARTIAL vs REJECTED).
- **HR-F4 fixed:** KA.F4.T7.sitePromotion value.
- Stay green (regression): every HARD check, G.5xx.

### 5.3 Where each check runs (the proof's where-table)

| Where | Checks |
|---|---|
| **T7** (throwaway of 087: completion 2027-06-30, LD 1,000.00/day, allowance 20 explicit; archived by each run; WP7ADJ Q1) | S.T7.create, S.T7.network, S.T7.evidence, S.T7.barrier, S.T7.archived; T1.T7.* (9), T2.T7.approve, T3.T7.approve, KA.T2.plannerPatchApproved, KA.T4.T7, T5.T7, W.T7.* (7), KA.W.T7.allowanceZero, PROMO.T7.feeds, PROMO.T7.twice, KA.PROMO.T7.race, KA.PROMO.T7.failure, KA.F4.T7.sitePromotion: every writing check and every section 6.2 catcher |
| **T7H** (second throwaway, the half-day register) | S.T7H.create, S.T7H.archived, KA.W.T7H.half28, KA.W.T7H.storedOneAndHalf |
| **087-COM live** (reads; `POST /eot/calculate` writes nothing) | S.087COM.chain, COM.live.claims, COM.live.project, COM.live.weatherDefault, KA.T4.087COM.calculate |
| **087-COM stored** | COM.stored.eotFigures (MOMENT-MAP row 153) |
| **087-FLD live / stored** | KA.FLD.087.live, FLD.087.allowance / KA.FLD.087.stored (rows 178, 179) |
| **052-FLD live / stored** (052's planner, read only, WP7ADJ Q7) | KA.FLD.052.live / KA.FLD.052.stored (rows 247, 248) |
| **static + observations** | CF.HRC11, CF.HRC10, CF.PROMOTX |
| **setup** | S.book, S.state, S.projects |

### 5.4 Reading notes
- **The blocker queue.** Every PROMO-TX round queues behind a pure lock-holder connection (FOR UPDATE on the round's delay entry, no write, rollback); each request is confirmed waiting through `pg_blocking_pids` before the next is sent; the release comes within 2.5 s. A barrier that does not form, a request that settles before the release or a late release is a setup error (exit 1), never a verdict. So the race is deterministic: no racy catcher in WP-7 (the evidence checker's RACY set is empty).
- **The three stack traces** in the failure rounds are HEAD's P2025 (404 NOT_FOUND), the reproduced orphan; G.5xx stays green.
- **Residue.** Six rows per T7 at HEAD (three duplicates, three orphans), listed by the cleanup; one set per proof run, mutation runs included.
- **052 sign-ins** create session rows in 052 (request noise for the census), nothing else.

---

## 6. Targeted proofs, targeted reruns, the final full run

### 6.1 Before any fix
Nothing beyond the primary run (it is the reproduction). A proof defect found in it (a TEST GAP) is fixed in the proof and re-run with the narrowest `--only` that covers it (F52 and CF are the sections the debug runs never exercised); then the HEAD baseline must be retaken as a full run on the changed proof before any mutant runs (section 7.3).

### 6.2 Targeted sections after a fix
```
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp7-eot-proof.js --only=PROMO
```
PROMO-TX: S + PROMO active; the T7 choreography runs whole (its steps depend on each other); every PROMO check PASS; exit 0. HR-C10: `--only=T23,T45,COM`. HR-C11: `--only=W,WH,F87,F52`. CF classifies from its sources: `--only=CF` (44 checks). A failure here goes back to the fix (three iterations, then escalate).

### 6.3 The final full run
If a WP-7 fix lands: one full run on the final code (every landed fix's `FIXES` set), no flags (section 2.3 command): the expected answer is section 5.2. Its result is the WP-7 result and the post-fix mutation baseline: copy it to `wp7-eot-proof.final.json` and `wp7-eot-proof.baseline.json`, with `git rev-parse HEAD` in the journal. If no WP-7 fix lands inside CERT-3, the primary run is the WP-7 result (and the HEAD baseline the only one), provided no product or proof change follows; otherwise one full run on the final code.

---

## 7. Mutation runs

### 7.1 Lists and runner keys
Claude Main copies `wp7-mutations.contract.json`, `wp7-mutations.optional.json`, `wp7-mutations.unit.json`, `wp7-fix-mutations.contract.json`, `wp7-fix-mutations.unit.json` and `wp7-mutation-evidence.js` from `C:\Temp\octapm-cert\scratch\wp7\lists\` into `backend/scripts/cert/cert3/`, and **then** (never before the files exist) adds five keys to `LISTS` in `C:\Temp\octapm-cert\mutate-multi.js`, before `'unit-tests'`:
```js
  // WP-7 (WP7-RUN-PLAN.md section 7): judged by named-catcher flips against a baseline (wp7-mutation-evidence.js); one id per run, "--only=<id>," with --lists=.
  'wp7-contract': ['scripts/cert/cert3/wp7-eot-proof.js', true, 'wp7-mutations.contract.json'],
  'wp7-optional': ['scripts/cert/cert3/wp7-eot-proof.js', true, 'wp7-mutations.optional.json'],
  'wp7-unit': [null, false, 'wp7-mutations.unit.json'],
  // WP-7 fixes (HR-C10, HR-C11, HR-F4 after the owner's decisions; PROMO-TX if it confirms P1): every entry pending until its fix lands.
  'wp7fix-contract': ['scripts/cert/cert3/wp7-eot-proof.js', true, 'wp7-fix-mutations.contract.json'],
  'wp7fix-unit': [null, false, 'wp7-fix-mutations.unit.json'],
```
`check-runner-wp7.js` replays these lines against the runner as it is (parsed by text): the keys parse, every runnable entry has the runner's shape, `"--only=<id>,"` selects exactly that id in its list, the fix keys select nothing (their `mutations[]` is empty), and no WP-7 runnable id is a prefix of another registered list's id. `mutsyntax-wp7.js` and its teeth stay in the scratch folder (as `mutsyntax-wp4.js`). Ids: every `catchers`, `collateral`, `shifts[].id`, `unchanged` and `catchersAfterFix` id, and every check id an `expect` names, is a CHECKS id; the contract list's catchers equal the proof's CATCHERS, the optional list's OPTIONAL_CATCHERS, the fix list's FIX_CATCHERS (through `proofKey`); no WP-7 id is used by another registered list (the proof's `M-LOCK` is listed as **M-EOTLOCK**, `proofKey: "M-LOCK"`, because `wp4-mutations.commercial.json` already has M-LOCK; section 13.3). The equivalent mutants (M-70b, M-REASONsvc), the not-run M-PROMO2 (WP-8's guard) and the pending fix entries are recorded in their lists (`equivalent`, `notRun`, `pending`) and never run by the runner (it reads `mutations` only).

The draft (`wp7-mutations-draft.json`) proposed keys `wp7-guards` / `wp7-fix` and the file `wp7-contract-time-proof.js`; these lists follow WP-4's naming (key = list file suffix) and the installed proof's name.

### 7.2 Mutant syntax (no DB, no lock)
- At drafting (`node C:\Temp\octapm-cert\scratch\wp7\lists\mutsyntax-wp7.js`): on HEAD `2a2efd2` and on HEAD with the HR-X1 r3c simulated copies overlaid, every HEAD-list anchor occurs once and every mutant parses (only M-REASON's service edit and M-REASONsvc move, 1103 -> 1091; the M-EOTLOCK locus 805 -> 799); the unit titles are in `eot-traceability.test.js` (:180, :305, :367); the pending loci occur once at HEAD; the proof's three tables equal the lists; every bookKey resolves; 0 problems. Its teeth (`teeth-mutsyntax-wp7.js`): 22 kinds of break all reported. Copies in `lists\mutsyntax\`.
- **On the day**, after the WP-2 batches landed and before the HEAD batch: `node build-lists-wp7.js` (re-counts the recorded anchors on the post-batch tree), then `node mutsyntax-wp7.js --no-sim` (section 15). **After a WP-7 fix:** derive the fix entry's `from` / `to` on the real fix diff, move it into `mutations[]`, then `node mutsyntax-wp7.js --post-fix` (every list must apply once on the fixed worktree and parse). An anchor found 0 or 2+ times is NOT APPLIED by the runner; a mutant that does not parse would be "caught" by a crash and proves nothing.

### 7.3 Runner and baseline: how a mutant is judged (the WP-4 L1 design)
**The decision (L1, applied to WP-7).** Every proof-backed mutant is judged by `wp7-mutation-evidence.js` on its **named catchers flipping from PASS in a baseline result to FAIL under the mutant, on the same tree**, never by the exit code. At HEAD the unmutated proof exits 0, so the runner's CAUGHT points the right way, but it scores any non-zero exit (an unrelated red, or a section error that leaves the catchers unrun) as CAUGHT; the checker does not.

**Why it is sound.**
1. Every HEAD catcher (W.T7.a20at14, W.T7.a30at21, W.T7.a10at7; T1.T7.patchApprovedToDraft, T1.T7.rejectApproved; the optional ones) is a HARD check that PASSES at HEAD; the checker refuses a catcher that is not PASS in the baseline, and for a known answer not at its value (BLOCKED or STORED-PRE-FIX is not PASS) - so a fix mutant can never be scored before its fix (self-test: M-C11z on the HEAD baseline reads NO EVIDENCE).
2. A fix entry names its rule (`fixRule`); the checker refuses a baseline whose `FIXES[<rule>]` is not set.
3. "Not run" is never evidence: a catcher left unrecorded by a section error reads NO EVIDENCE; a run that ends in exit 1 still counts when its catchers ran and failed (the WP-1 C1 / I1 precedent).
4. Every other red under the mutant must be named collateral with its derivation (`collateralWhy`), else CAUGHT, FLAGGED: not evidence until Claude Main classifies it (names it with a derivation, or fixes the proof) and re-runs the checker. Non-red status changes are reported as named (`shifts`), racy (none in WP-7) or unnamed (a note).
5. The baseline must be a clean comparator: a full run (no filter), no setup error, G.5xx green, and every FAIL in it a decided red (none at HEAD) or named with `--accept-baseline-red=<ids>` after it is classified in the journal with its register row (L5); otherwise it is VOID and so is every mutant judged on it. Each mutant result must carry the same `FIXES`, the same answer book and the same check ids as its baseline and start after the baseline finished.
6. What the result files cannot prove (that no product file changed between the baseline and the mutant) is procedural: no product or proof commit between the baseline and the mutants of a batch; `git rev-parse HEAD` and `git status --porcelain backend/src backend/scripts/cert/cert3` recorded at the baseline and at each invocation; after any such commit, a new full baseline before the next mutant.

**The baseline files** (the checker's defaults):
- **HEAD lists** (`--lists=contract,optional`): `C:\Temp\octapm-cert\results\cert3\wp7-eot-proof.baseline-head.json` = the primary run's copy (section 2.3), as long as nothing changed since; otherwise one unmutated full run on the current tree, copied there. The primary run is a valid baseline for the mutants that follow it: each run makes its own T7 and T7H; the deep projects are only read.
- **Fix list** (`--lists=fix`): `C:\Temp\octapm-cert\results\cert3\wp7-eot-proof.baseline.json` = the final full run on the fixed code (section 6.3; exit 0, the fix's `FIXES` set).

**Verdicts:** CAUGHT; CAUGHT, FLAGGED; SURVIVED; NO EVIDENCE (the checker's header carries the definitions). **E6** counts the contract and fix lists only: a guard counts when every judged entry it names is CAUGHT, unless one supersedes the others; the optional list is printed apart (`optional rule mutants (WP7ADJ Q5, run and recorded, never tallied)`).

### 7.4 Running: one mutant per invocation, the result copied after each
Never while a build, another proof, Codex or the full jest suite runs. One command line each. **Quote the id and end it with a comma, and always name the list**: `mutate-multi.js` treats a value without a comma as a name *prefix*, PowerShell drops an unquoted trailing comma, and ids such as M1 or G1 repeat across other lists.
```
cd <worktree>\backend
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp7-mutations.M-70.json --lists=wp7-contract "--only=M-70,"; Remove-Item Env:CERT_LOCK_HELD
New-Item -ItemType Directory -Force C:\Temp\octapm-cert\results\cert3\wp7-mutations | Out-Null; Copy-Item C:\Temp\octapm-cert\results\cert3\wp7-eot-proof.json C:\Temp\octapm-cert\results\cert3\wp7-mutations\M-70.json
```
**HEAD batch** (after the primary run and its classification, the HEAD baseline in place), each followed by its copy to `wp7-mutations\<id>.json`:
- `--lists=wp7-contract`: `"--only=M-70,"`, `"--only=M-STAT,"`;
- `--lists=wp7-optional`: `"--only=M-WF,"`, `"--only=M-PROOF,"`, `"--only=M-CUM,"`, `"--only=M-ALLOW,"`, `"--only=M-NC,"`, `"--only=M-REASON,"`.

The runner's console line per mutant: `CAUGHT      wp7-contract | M-70 the 70% line moved: ... | fails 3` (the `fails` count is the proof's FAIL lines; by derivation M-70 3, M-STAT 2, M-WF 5, M-PROOF 2, M-CUM 1, M-ALLOW 4, M-NC 8, M-REASON 1), then `DONE {"CAUGHT":1}`; the proof's own last line `wp7-eot-proof: <56-n> passed, <n> failed of 56 (fixed); DEFECT_PRESENT, exit 2`.

Then the unit side; first the unmutated suite must pass (a red suite would score every unit mutant CAUGHT):
```
npx jest src/services/__tests__/eot-traceability.test.js
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp7-mutations.unit.json --lists=wp7-unit; Remove-Item Env:CERT_LOCK_HELD
node scripts/cert/cert3/wp7-mutation-evidence.js --lists=contract,optional --unit-results=C:\Temp\octapm-cert\results\cert3\wp7-mutations.unit.json
```
The checker prints the baseline's validity, then per entry the verdict, each catcher's baseline -> mutant status, the collateral and which of it went red, any unexpected red, any baseline red turned green, the shifts, the notes, the known-answer tally, the residue count and the 5xx count; then `E6 (section 6.2 WP-7 guards): n/2`, the optional line, and the unit verdicts. **Expected at HEAD:** `E6 (section 6.2 WP-7 guards): 2/2 with evidence (1 the 70% boundary M-70 yes; 2 the approved-EOT lock M-STAT yes)`; `optional rule mutants (...): {"CAUGHT":6}`; `entries: {"CAUGHT":8}; unit: 3/3 caught by named tests (mocked, not evidence)`; exit 0. About 8 proof runs of under a minute each plus one jest invocation.

**Post-fix batch** (only after a WP-7 fix and section 6.3, the final baseline in place; the landed entries moved into `mutations[]` and `mutsyntax-wp7.js --post-fix` first): each landed fix entry (`--lists=wp7fix-contract "--only=M-PTX,"`, ...), copied to `wp7-mutations\<id>.json`; the unmutated fix-tree suites, the `wp7fix-unit` list in one invocation, and:
```
node scripts/cert/cert3/wp7-mutation-evidence.js --lists=fix --unit-results=C:\Temp\octapm-cert\results\cert3\wp7-fix-mutations.unit.json
node scripts/cert/cert3/wp7-mutation-evidence.js C:\Temp\octapm-cert\results\cert3\wp7-mutations-final --lists=contract,optional --ids=<the re-run HEAD ids> --baseline=C:\Temp\octapm-cert\results\cert3\wp7-eot-proof.baseline.json
```
HEAD entries whose file changed with the fix are re-run on the final code into their **own directory** `results\cert3\wp7-mutations-final\` (section 7.6) and judged with `--ids` against the final baseline. The WP-7 E6 tally for the report is the union of the checker runs: guard 1 from M-70 (HEAD, or its re-run), guard 2 from M-STAT (HEAD, or its re-run) and, once HR-C10 has landed, M-EOTLOCK from the fix-list run.

### 7.5 Expected per mutant (the lists carry the derivations)

| Id | List | Runner | Exit | Named catchers (PASS -> FAIL) | Expected collateral (FAIL) | Shifts | Tallied |
|---|---|---|---|---|---|---|---|
| M-70 | wp7-contract | CAUGHT | 2 | W.T7.a20at14, W.T7.a30at21, W.T7.a10at7 (exactly 70%, warning false) | none | none | E6 guard 1 |
| M-STAT | wp7-contract | CAUGHT | 2 | T1.T7.patchApprovedToDraft (E-LK1 -> draft, 200), T1.T7.rejectApproved (E-LK2 -> rejected, 200) | none | none | E6 guard 2 |
| M-WF | wp7-optional | CAUGHT | 2 | T1.T7.approveDraft, T1.T7.patchStatusDraftOnSubmitted, T1.T7.patchApprovedToDraft, T1.T7.rejectApproved | T1.T7.rejectWithoutReason (T1-B left draft) | none | no (Q5) |
| M-PROOF | wp7-optional | CAUGHT | 2 | T1.T7.submitWithoutProof (both drafts submit) | T1.T7.patchStatusSubmitted (nd left submitted) | none | no |
| M-CUM | wp7-optional | CAUGHT | 2 | T3.T7.approve (5 / 2027-07-05) | none | none | no |
| M-ALLOW | wp7-optional | CAUGHT | 2 | W.T7.a30at20, W.T7.a30at21, W.T7.a10at6, W.T7.a10at7 (allowance read 20) | none | none | no |
| M-NC | wp7-optional | CAUGHT | 2 | W.T7.nonContractual10 (24), W.T7.a30at20, W.T7.a30at21, W.T7.a10at6, W.T7.a10at7 | KA.W.T7.allowanceZero, KA.FLD.087.live, KA.FLD.052.live (all wrong: 31; 22) | none | no |
| M-REASON | wp7-optional | CAUGHT | 2 | T1.T7.rejectWithoutReason (200, no reason) | none (rejectWithReason re-rejects: 200) | none | no |
| UM-WF | wp7-unit | CAUGHT | jest red | 'submits EOT claims through the workflow endpoint and blocks direct approvals' | - | - | lead |
| UM-PROOF | wp7-unit | CAUGHT | jest red | 'rejects submitted EOT claims without affected activities and supporting documents' | - | - | lead |
| UM-CUM | wp7-unit | CAUGHT | jest red | 'approves submitted EOT claims with revised completion recommendation metadata' | - | - | lead |
| M-EOTLOCK (pending) | wp7fix-contract | after HR-C10 | 2 | KA.T2.plannerPatchApproved (today again) | CF.HRC10 | - | E6 guard 2 (joins M-STAT) |
| M-C10i (pending) | wp7fix-contract | after HR-C10 | 2 | KA.T4.T7, KA.T4.087COM.calculate | CF.HRC10 | - | fix mutation |
| M-C11z (pending) | wp7fix-contract | after HR-C11 | 2 | KA.W.T7.allowanceZero | CF.HRC11 | - | fix mutation |
| M-C11d (pending) | wp7fix-contract | after HR-C11 | 2 | KA.W.T7H.half28, KA.W.T7H.storedOneAndHalf | CF.HRC11 | - | fix mutation |
| M-PTX (pending) | wp7fix-contract | after PROMO-TX | 2 | KA.PROMO.T7.race, KA.PROMO.T7.failure (every round today) | CF.PROMOTX | - | fix mutation |
| M-F4 (pending) | wp7fix-contract | after HR-F4 | 2 | KA.F4.T7.sitePromotion | none | - | fix mutation |

### 7.6 What counts where: the E6 tally
- **E6 (plan section 6.2 WP-7, two guards), tallied on these entries only:** the 70% boundary -> **M-70**; the approved-EOT lock -> **M-STAT** now (its status half, WP7ADJ Q4), and **M-STAT + M-EOTLOCK** once the HR-C10 fix lands (its figures half; the list's `joins`). A guard counts when every current entry is CAUGHT (clean, not FLAGGED). E6 is met for WP-7 at 2/2 at HEAD.
- **Which code each entry's evidence stands on (L2).** A HEAD entry's evidence stands on the final code when its mutated file is byte-identical on the final tree and the proof diff since its baseline touches none of its catchers (`git diff <baseline sha> <final sha> -- <file> backend/scripts/cert/cert3/wp7-eot-proof.js`, read for the catcher ids). Otherwise it is re-run against the final baseline (its own result directory and `--ids`). Known at drafting: an HR-C11 fix edits `weather.service.js` (M-70, M-ALLOW, M-NC re-run; M-70 then with KA.W.T7H.half28 added to its catchers, `catchersAfterFix`); an HR-C10 fix edits `eot.service.js` (M-STAT, M-WF, M-PROOF, M-CUM, M-REASON re-run); a PROMO-TX fix re-runs M-70 / M-ALLOW / M-NC only if it edits `weather.service.js`. The HR-X1 batch lands **before** the WP-7 primary run (Q13), so it never forces a re-run; if it were to land after, every WP-7 HEAD entry is re-run (both files).
- **Optional rule mutants** (run, recorded, never tallied; WP7ADJ Q5): M-WF, M-PROOF, M-CUM, M-ALLOW, M-NC, M-REASON.
- **Equivalent, not run:** M-70b (the same three readings flip; no reading lies in (70, 70.01)); M-REASONsvc (the route's validator answers first on both reject routes). **Not run:** M-PROMO2 (WP-8's sequential promotion guard; PROMO.T7.twice would catch it).
- **Fix mutations** (plan section 1.4, not section 6.2): M-C10i, M-C11z, M-C11d, M-PTX, M-F4, all pending.
- **Unit side** (not evidence, plan section 1.4): UM-WF, UM-PROOF, UM-CUM at HEAD; the six fix-side unit entries pending. No unit catcher exists for M-70, M-STAT, M-ALLOW, M-NC or M-REASON (section 13.2).

### 7.7 Cleanup and census after the lists (plan section 7)
- **No restore after any WP-7 list** (section 2.1). Stored effects of the mutants are on T7 / T7H only: E-LK1 back in draft and E-LK2 rejected (M-STAT, M-WF), T1-B's extra transitions and T1-C approved from draft (M-WF), two claims submitted without proof (M-PROOF), E-T3's cumulative 5 (M-CUM), T1-B rejected without a reason (M-REASON); the weather mutants store nothing (the register is computed at read). Each run's T7 carries its six PROMO-TX residue rows; every T7 and T7H archived by the proof's cleanup.
- **Census**, once after each batch:
  1. `node scripts/cert/isolation/fingerprint.js take wp7-post`, then `node scripts/cert/cert3/build/fingerprint97.js cert3-post wp7-post` (exit 0: the 97 other companies unchanged). Its `.e2.json` lists 087's changed pairs: they must be T7's and T7H's tables (projects, team, activities and links, EOT claims and their activity / weather links, weather delays and their links, daily logs and delay entries, documents and attachment refs, notifications, jobs, audit) and the request-noise tables only; nothing on 087-COM, 087-FLD or 052-FLD; 052's changes request noise only (its pm and planner sessions). (If anything wrote after the restore of section 2.2 other than WP-7 runs, compare against a fingerprint taken right after the restore instead.)
  2. The last proof run's throwaway check: 0 live `CERT3 WP7 contract time` and `CERT3 WP7 half days` projects.
  3. Record the census in the journal.
- **Never commit a mutated tree.** After every invocation `git status` shows no product diff that is not the batch's; `mutate-multi.js` restores byte for byte and keeps backups in `C:\Temp\octapm-cert\mutate-backups\`; a RESTORE FAILED line stops everything until the file is restored by hand.

---

## 8. Codex (plan section 6.4; owner rule 5)
- **Required for WP-7 only if a fix lands:** PROMO-TX (P1 only): the adversarial plan review before any code and the diff review after the mutations; HR-C10 / HR-C11 if decided inside CERT-3 (LD figures; HR-C11's migration).
- **Not required for** the proof, the lists, the checkers, this plan or answer-book edits (test side): `/code-review` covers them.
- Rounds: stop when nothing CRITICAL or HIGH is open; at most 3, then escalate. No round for P2/P3 or test polish.
- Mechanics (memory `octapm-codex-review.md`): the desktop app's `codex.exe`; one whole pass per five-hour window; prompt and output in `scratch\wp7\`, adjudication beside each. Never during a build, a proof, a mutation list or the full suite.

## 9. Code review
`/code-review` (high) on the WP-7 batch before its commit: the proof (any `FIXES` / `CONTRACT` / `CATCHERS` edits, the optional COLLATERAL additions of section 13.3), the five lists, the evidence checker, this plan, any book edits, any fix diff and its tests. Findings adjudicated like Codex's. A finding that changes the proof is followed by one full proof run (a new baseline) and a rerun of only the mutants whose catchers it touches.

## 10. Commit and push
No merge of `main` into `cert/full-saas-certification` (owner rule; it overrides CLAUDE.md's "pull origin/main before committing"). Commits, each pushed: (1) any WP-7 fix (product, unit tests; before its `FIXES` entry is set); (2) the WP-7 batch, `cert(CERT-3 WP-7): <one line>` (lists, evidence checker, run plan, any proof edits, results summary); (3) the docs (journal, workflow report, register, moment map: the WP-7 deviation rows of `meta.deviations`). Messages end with the attribution line the committing session gives. `mutate-multi.js` lives in `C:\Temp` and is not committed; its five keys are recorded in the journal.

## 11. Journal
`OCTAPM_CERT_JOURNAL.md`, same heading style: the restore; the primary run (passed / failed / known answers by status, exit; the two copies and the sha); the classification table; PROMO-TX's severity and its evidence; the HEAD mutation batch (per mutant the evidence verdict with its named catchers and collateral; the optional verdicts recorded, untallied; the unit results; E6 2/2); any fix route (Codex rounds and adjudications, the fix commit, `FIXES`, targeted and full runs, the post-fix batch); the residue; the census; the reviews; the owner questions (O1-O5); the leads registered; the next exact action (restore `cert3d`, re-apply landed migrations, WP-8).

## 12. The WP-7 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register

Add `## WP-7 Contract time - <CLOSED | IN PROGRESS> (<date>)` after WP-6, in the WP-0 section's shape. The result column holds `passed/total`, the exit code, and every known answer's ref.

| Rule or item (plan WP-7) | Evidence (final check ids) | Result |
|---|---|---|
| EOT transitions only through the workflow actions; proof required (:839) | T1.T7.createApproved, submitWithoutProof, patchStatusSubmitted, patchStatusDraftOnSubmitted, approveDraft, patchApprovedToDraft, rejectApproved, refsNotFound; mutations M-STAT (section 6.2), M-WF, M-PROOF (optional) | |
| Rejection needs a reason (:840) | T1.T7.rejectWithoutReason, rejectWithReason, resubmitRejected; M-REASON (optional) | |
| Approval records cumulative days and a recommendation (:841, :847-848) | T2.T7.approve, T3.T7.approve, COM.stored.eotFigures, COM.live.claims; M-CUM (optional) | |
| The approved-EOT lock (:847, :1151) | T1.T7.patchApprovedToDraft, T1.T7.rejectApproved (status half); KA.T2.plannerPatchApproved (figures half, HR-C10) | BLOCKED HR-C10 (figures half) |
| Impact and LD (:849-850) | KA.T4.T7, KA.T4.087COM.calculate, T5.T7, CF.HRC10 | BLOCKED HR-C10 |
| Weather allowance, consumed %, the 70% warning (:842, :855-859) | W.T7.* (7), COM.live.weatherDefault, FLD.087.allowance; mutation M-70 (section 6.2); M-ALLOW, M-NC (optional) | |
| Fractional days, allowance 0 (:860-861) | KA.W.T7H.*, KA.W.T7.allowanceZero, KA.FLD.*, CF.HRC11 | BLOCKED HR-C11 |
| Promotion from the daily log (:843, :1115) | PROMO.T7.feeds, PROMO.T7.twice, KA.PROMO.T7.race, KA.PROMO.T7.failure, CF.PROMOTX; M-PTX if fixed | BLOCKED PROMO-TX or Fixed at `<sha>` |
| HR-F4 site promotion (:1061) | KA.F4.T7.sitePromotion (classified by WP-8) | BLOCKED HR-F4 |
| Known answers | section 5 of this plan | values, 13 BLOCKED with refs |
| Mutations (E6) | `results\cert3\wp7-mutations\<id>.json`, the unit results, `wp7-mutation-evidence.js` output | 2/2 section 6.2 guards; 6 optional recorded; fix mutations pending or caught |
| Reviews (E11) | Codex plan and diff reviews of any landed fix, `/code-review` | |

Register (`OCTAPM_LAUNCH_BLOCKERS.md`): PROMO-TX with its classification, severity and, if fixed, the sha; HR-C10, HR-C11, HR-F4 as owner questions (O1-O3) with this run's evidence; O4, O5; the leads EOT-CONC-1, WX-DEL-1, DST-1, EOT-REC-2, EOT-APPLY-1 (WP7ADJ Q10).

---

## 13. Limitations, TEST GAPs and notes (the lists refer here)

### 13.1 Mutations the live proof cannot catch, or does not run
- **M-70b** (`>= 70` -> `>= 70.01`): equivalent to M-70 on this data (every reading is 0, 10, 35, 60, 65, 66.67 or exactly 70). Not a gap: M-70 is the entry.
- **M-REASONsvc** (the service's reason check alone): equivalent through the API (both reject routes validate the reason first); no unit test calls `rejectEotClaim`. Not a gap for the API; M-REASON mutates both halves.
- **M-PROMO2** (the sequential promotion guard): WP-8's guard (plan :878), recorded for WP-8.
- No new TEST GAP: every section 6.2 guard has a live catcher at HEAD.

### 13.2 No unit catcher
M-70, M-ALLOW, M-NC (no `weather.service.js` suite; the route-guard suite mocks the service), M-STAT (no case moves an approved claim), M-REASON (no case sends a rejection without a reason). Listed in `wp7-mutations.unit.json` `noUnitCatcher` so nobody looks for one. Adding unit tests is allowed only inside a fix batch, never as a new requirement.

### 13.3 Notes and open questions for the integration owner / Claude Main
- **M-LOCK id clash.** WP-4's registered list already has `M-LOCK` (and M-LOCKa / M-LOCKb); the WP-7 fix list carries the proof's `M-LOCK` as **M-EOTLOCK** with `proofKey: "M-LOCK"` (the anchor checker compares through it). In the HR-C10 fix batch either rename `FIX_CATCHERS['M-LOCK']` to `'M-EOTLOCK'` together with the book's `WP7.mutations.approvedEotLock` text "(M-LOCK," (the proof's G15 load guard requires the book to name every table key), or keep the mapping. Which?
- **Guard 2 after HR-C10: joins, not supersedes.** WP7ADJ Q4 says M-LOCK "is added"; the book calls M-STAT and M-LOCK the lock's status and figures halves. The lists and the checker read that as both halves required (`joins`), unlike WP-4 Q8 where the post-fix entry replaces the HEAD one (`supersedes`). Confirm.
- **Collateral derived beyond the proof's COLLATERAL table.** M-WF also reddens T1.T7.rejectWithoutReason (T1-B left in draft by the catch on patchStatusDraftOnSubmitted); M-PROOF also reddens T1.T7.patchStatusSubmitted (nd left submitted). The lists name both with their derivation; adding them to the proof's descriptive table is an optional one-line edit (no check depends on its text).
- **M-70 after HR-C11.** KA.W.T7H.half28 becomes an M-70 catcher (book `WP7.mutations.seventyBoundary`); `CATCHERS['M-70']` and the list (`catchersAfterFix`) gain it in the HR-C11 fix batch, and M-70 is re-run against that baseline.
- **Optional verdicts and the exit code.** The checker counts the optional entries in its exit code (as WP-4's untallied variants), but never in E6. Accept, or report them only?
- **Unit sides of optional mutants.** UM-WF, UM-PROOF, UM-CUM are the unit sides of untallied mutants (mocked leads). Run them in the HEAD batch (as drafted), or skip?
- **Runner keys.** `wp7-contract` / `wp7-optional` / `wp7-unit` / `wp7fix-contract` / `wp7fix-unit` (WP-4's pattern) instead of the draft's `wp7-guards` / `wp7-fix`.
- **Runner prefix match.** `--only=<value>` without a comma is a prefix match; the quoted trailing comma is the exact match; `--lists=` is mandatory.

### 13.4 Book notes (for the book owner, under Claude Main; A10)
- `WP7.mutations.approvedEotLock`: names "(M-LOCK," (see the id clash note).
- `WP7.mutations.fixMutations`: the fix entries' anchors are counted when their fixes land (the pending entries).

---

## 14. Hazards (read before running)
- `cert3d` must exist and the population must be complete (087-COM, 087-FLD and 052-FLD with their state files); `mutate-multi.js` cannot pass flags, so a mutant always runs F52 and CF.
- One writer: proofs only through `run-locked.js`; a mutation list with the lock held for the whole invocation; no build, Codex or full jest suite at the same time (OPS-1).
- The runner's CAUGHT is only a direction: only `wp7-mutation-evidence.js` against a valid baseline on the same tree counts (section 7.3).
- The WP-7 keys go into `LISTS` only after the five list files exist in `backend/scripts/cert/cert3/`.
- `--only` values quoted with a trailing comma and `--lists=` always given; one id per invocation; the result copied after each, before the next run overwrites it.
- Never run `--lists=wp7fix-contract` expecting a mutant before a fix entry is moved into `mutations[]`: it selects nothing by design.
- After any product or proof commit: `build-lists-wp7.js` and `mutsyntax-wp7.js` again, a new full baseline before the next mutant, and A10 re-derivation of any list `expect` the change moves.
- Never amend a fix commit once `FIXES` names it; `S.state` checks the time against git.
- The cert API is never (re)started while a mutant is applied.
- The blocker connection: a mutant that leaves it open is rolled back by the cleanup (`blocker: ... rolled back`); a barrier that does not form is a setup error, never a catch.
- State files are not in the snapshot: never run a builder after `cert3d` without taking it again.
- Secrets: `CERT_PASSWORD` only through `lib/api.js`; results and logs are scrubbed by the harness; never paste a token or a password into the journal.

---

## 15. Anchors to re-scan after the WP-2 batches land

The WP-2 HR-X1 batch edits `eot.service.js` and `weather.service.js` (WP7ADJ Q13); the QP batch and any later migration can move other lines. After the batches land, and before the WP-7 HEAD batch: `node build-lists-wp7.js` (re-counts every recorded anchor on the post-batch worktree), then `node mutsyntax-wp7.js --no-sim` (every anchor once, every mutant parses, the unit titles present, 0 problems). Anchors as counted at drafting (HEAD `2a2efd2` / the HR-X1 r3c simulation):

| File | Entry | Anchor (one line each) | HEAD | r3c sim |
|---|---|---|---|---|
| `backend/src/services/weather.service.js` | M-70, M-70b | `      warning: consumedPct >= 70,` | 1x @200 | 1x @200 |
| same | M-ALLOW; M-C11z locus | `  const allowance = Number(project.weatherAllowanceDays) \|\| 20;` | 1x @161 | 1x @161 |
| same | M-NC | `    if (!row.contractual) return sum;` | 1x @163 | 1x @163 |
| same | M-C11d locus | `  const contractualUsed = rows.reduce((sum, row) => {` | 1x @162 | 1x @162 |
| `backend/src/services/eot.service.js` | M-STAT, M-WF, UM-WF | `  if (workflowAction && workflowAction === expectedAction) return;` | 1x @275 | 1x @275 |
| same | M-PROOF, UM-PROOF | `  if (activityCount > 0 && documentCount > 0) return;` | 1x @246 | 1x @246 |
| same | M-CUM, UM-CUM | `    priorApprovedDays + (Number(eotDaysGranted) \|\| 0);` | 1x @318 | 1x @318 |
| same | M-REASON (2nd edit), M-REASONsvc | `  if (!rejectionReason) {` | 1x @1103 | 1x @1091 |
| same | M-EOTLOCK locus | `  const recalculate = needsEotRecalculation(payload);` | 1x @805 | 1x @799 |
| same | M-C10i locus | `  const criticalPathImpactDays = affectedActivities.reduce(` | 1x @404 | 1x @404 |
| `backend/src/routes/eot.js` | M-REASON (1st edit) | `  body("reason").isString().trim().notEmpty().isLength({ max: 2000 }),` | 1x @235 | (not simulated) |
| `backend/src/services/daily-log.service.js` | M-PROMO2; M-PTX locus | `  if (entry.weatherDelayId) throw new HttpError(409, "DAILY_LOG_WEATHER_DELAY_EXISTS", ...);` | 1x @1198 | (not simulated) |
| same | M-PTX locus | `  const created = await weatherService.createWeatherDelay({` | 1x @1201 | (not simulated) |
| same | M-F4 locus | `      contractual: payload.contractual !== undefined ? Boolean(payload.contractual) : true,` | 1x @1209 | (not simulated) |
| `backend/src/routes/daily-logs.js` | M-F4 locus | `  "/:date/entries/delays/:entryId/weather-delay",` | 1x @239 | (not simulated) |
| `backend/prisma/schema.prisma` | M-C11d locus | `model WeatherDelay {` | 1x @2953 | (moves with any WP-2 migration) |
| `backend/src/services/__tests__/eot-traceability.test.js` | UM-WF, UM-PROOF, UM-CUM titles | the three `it(...)` titles | @305, @180, @367 | (re-check: an HR-X1 unit edit may touch this suite) |

The r3c simulation is LF-only and collapses each multi-line `syncEvidenceReferences({...})` call to one line, so only lines after the first collapsed call move; the real batch keeps CRLF, so its lines will differ: the counts are what matter (each exactly once). If a count changes, re-derive the entry on the post-batch text (A10) before the HEAD batch.
