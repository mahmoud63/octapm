# CERT-3 WP-1 run plan (schedule: import, revisions, activation, CPM, baseline, status)

Plan `docs/certification/OCTAPM_CERT3_PLAN.md` §7 step 4 (:1185), for WP-1 (§4 :499-569), on snapshot `cert3d`.

**Aligned 2026-10-10** (supersedes the 2026-10-09 draft, which predated the proof's where-table) against:
- the final proof `scripts/cert/cert3/wp1-schedule-proof.js`: 146 fixed checks (`EXPECTED_CHECKS`, asserted at load) plus the harness's `G.5xx`; its CHECKS table (:129-277) carries the id, plan line, answer-book key and where each check runs;
- the reconciled mutation lists `wp1-mutations.{cpm,gates,imports,unit}.json` (20 mutations; every `catchers` / `collateral` id is a proof id);
- the answer book `answers/schedule.js` after BOOK-1..BOOK-7 (870 figures; `answers/CHANGES-WP0-BUILDERS.md` § "WP-1 proof authoring (2026-10-10)");
- the integration owner's adjudication of the proof authoring (`C:\Temp\octapm-cert\scratch\wp1\author-adjudication.md`: H1-H4, M1-M6, L1-L10, R-SET, R-DOC, L-Q1, L-Q3, P-Q1..P-Q7);
- the owner's execution rules of 2026-10-10 (§0).

**State at alignment.** Product HEAD `f599e67` (`backend/src` unchanged since). `cert3d` is **not taken yet**: build order run 1 stopped at 087-EXC on a weekend run date (journal 2026-10-09/10); the next launch is at or after Sunday 2026-10-11 19:10 CDT. The proof was debug-run four times against the partial population with `--skip=LANES` (logs `C:\Temp\octapm-cert\logs\cert3-wp1-proof-1.log` .. `-4.log`); run 4: exit 0, 145/145 (144 active + `G.5xx`), 21 known answers at `today`, 1 at `value`, 0 `wrong`, 16 s. Those runs debugged the proof; they are not WP-1 evidence (the partial database is discarded by the next `cert2c` restore).

Inputs this plan relies on (all on disk):
- preparation `C:\Temp\octapm-cert\scratch\wp1-prep.md` (test map, routes, confirm-first items, request shapes, §7 D1-D7);
- answer book `scripts/cert/cert3/answers/schedule.js` (`WP1.*`, `D2.WP1.*`, `D3.F1byPm.*`, `CLAUDE.*`) and `answers/CHANGES-WP0-BUILDERS.md`;
- moment map `scripts/cert/cert3/build/MOMENT-MAP.md` (lines 13-53: the WP-1 keys the build asserted, observed or left to this proof);
- the proof, the four primary mutation lists and the three landed-fix lists `wp1-fix-mutations.{milestone,activation,unit}.json`;
- the runners `C:\Temp\octapm-cert\run-locked.js` (one proof at a time, `CERT_INPROCESS=1`, no `DATABASE_URL`) and `C:\Temp\octapm-cert\mutate-multi.js` (`--lists=`, `--only=`, `CERT_LOCK_HELD`; the `wp1-cpm`, `wp1-gates`, `wp1-imports`, `wp1-unit` keys are already registered);
- the read-only evidence checker `scripts/cert/cert3/wp1-mutation-evidence.js` (§7.4).

---

## 0. Rules that bind every step

**Owner execution rules (2026-10-10).**
1. **One writer.** Only Claude Main modifies product code on `cert/full-saas-certification`, writes the certification database (:55433) or the cert API (:5190), applies migrations, runs proofs, mutation runs (they edit product files), restores snapshots, runs Codex, commits and pushes. Preparation agents are read only and write only to their scratch folders.
2. **Pipeline.** While Claude Main executes WP-1, read-only agents prepare WP-2 (known answers, routes, tests, register rows, fixtures, proof structure, mutation candidates, personas). No open-ended defect hunting.
3. **Snapshots.** `cert3d` is the working CERT-3 baseline. Restore it before a proof that needs a clean state (§2.1); never rebuild the deep population for WP-1. Only the final CERT-3 exit run rebuilds (§7 step 5).
4. **Reruns.** After a fix, run the targeted proofs and proof sections first (§6). A complete run only where the plan requires it: the WP-1 primary run, the one full run on the final code (which is also the mutation baseline, §6.3), and the exit run.
5. **Codex** only for the plan's required reviews (§8): an adversarial plan review before a set of HR fixes the owner approved, and a diff review of each high-risk product diff. No extra round for P2/P3 or test polish once nothing CRITICAL/HIGH is open.
6. **Long runs** (likely > 1.5 h) start detached under the watchdog. Nothing in WP-1 is that long (the proof runs in ~16 s; a mutation list in minutes): run the mutation lists in the background and continue WP-2 preparation; never wait interactively on a build or an exit run.
7. **Manual UX** never holds WP-1. Manual review uses the isolated UX preview, never :5190 or the cert database while a proof or a mutation list runs.

**Plan rules.** §0.0 (no new rounds, matrices or requirements; rerun only invalid cases; every full run an exit criterion needs is run), §1.4 (known answers first, A10; checks assert; reproduce before fixing; fix scope P0/P1; no rule change before the owner's decision), §7 detached-run rules (one writer; a mutation run that stores a defect is cleaned up, then a census; no Codex or full suite during a build, a proof or a mutation list).

---

## 1. Sequence (plan §7 step 4 order)

| # | Step | Who / where | Expected |
|---|---|---|---|
| 0 | Precondition: `build-cert3d.ps1` run 2 finished; `cert3d` taken; the E2 report read (run-all exit, fingerprint97 compare, BLOCKED steps against their refs) | Claude Main, journal | run-all exit 0, or 2 with only the allowed BLOCKED refs (HR-C1, HR-C8, HR-C11, RFI-DRAFT, L34, L112, HR-S9, HR-K1, HR-K2, HR-K7); the 97 other companies unchanged; state files `087-SCH.json`, `087-IMP.json`, `052-SCH-EV.json`, `006-LITE.json` present with the proof's `STATE_STEPS` done |
| 1 | Confirm-first sweep (plan §7 step 3) on `cert3d`. WP-1's items are the proof's CF section (CF.1-CF.10). If the sweep stored anything (other packages' repros), restore `cert3d` (§2.2) before step 3 | Claude Main | the classification table rows of every package |
| 2 | No-DB checks: `node --check` the proof; the mutant syntax scan (§7.2); ids already reconciled (§7.1) | Claude Main or a prep agent | parse 0 errors; 42 mutations, every anchor once, 0 unparseable |
| 3 | **Primary run** of `wp1-schedule-proof.js`, full, no flags, through `run-locked.js` (§2.3) | Claude Main, in process, lock held | exit 0: 147 harness checks passed (146 + `G.5xx`); 21 known answers BLOCKED with their refs, 1 at value (§5); CF 2 REJECTED, 8 CONFIRMED; 0 `wrong`; 0 5xx |
| 4 | Classify every failure and every reported known answer (§3); list the owner questions | journal, register | table filled; HR rows reported, not acted on |
| 5 | Fixes for confirmed P0/P1 not governed by an undecided §5 row, and rule fixes the owner has approved (§4.2, §4.4): repro red, fix, green, mutation caught, no unit regression (Ralph loop: 3 iterations, then escalate) | Claude Main, code | none expected unless the primary run or an owner decision brings one |
| 6 | Targeted proofs (§6.1) and, after a fix, targeted proof sections (§6.2); then one full run on the final code (§6.3) | in process | 11/11, 12/12; the full run as in step 3 (with any approved rule's known answers now at value) |
| 7 | Mutation runs (§7): `wp1-cpm`, `wp1-gates`, `wp1-imports` one `--only=<id>` at a time, the result copied after each; `wp1-unit` last; census (§7.6) | Claude Main, lock held, background | the five §6.2 guards CAUGHT by their named checks; C3, I2, I3 CAUGHT; C4, C5 SURVIVED as expected; UG1-UG4, UI3, UC4, UC5 CAUGHT; no restore needed |
| 8 | Codex diff review of any high-risk WP-1 product diff beyond `f599e67` (§8) | Claude Main, one pass per window | nothing CRITICAL or HIGH open; or "not needed" recorded |
| 9 | `/code-review` (high) on the WP-1 batch (§9) | Claude Main | findings adjudicated |
| 10 | Commit and push (§10) | Claude Main, git | no merge of `main` (owner rule; overrides CLAUDE.md's pull step); no mutation leftovers |
| 11 | Journal entry (§11) | Claude Main | figures, table, tallies, restores, census, reviews, next action |
| 12 | WP-1 section of `docs/certification/OCTAPM_WORKFLOW_CERTIFICATION.md` and the register rows (§12); docs commit and push | Claude Main | rule → evidence → result for every WP-1 rule |
| 13 | Restore `cert3d` before WP-2 (§2.1) | Claude Main | WP-2 starts on the clean deep population |

---

## 2. Restore `cert3d` and the primary run

### 2.1 When to restore
- **Before the primary run** if the confirm-first sweep, or anything else, wrote to the deep projects after the snapshot.
- **Not after any WP-1 mutation list.** The final proof stores only on its throwaway projects W and X (archived by its cleanup, which also runs after a section error) and writes one thing on a deep project, the F1float5 submit and approval on 087-IMP, which every mutant leaves refused (§7.6). The census proves it.
- **Before WP-2.** WP-1 leaves archived `CERT3 WP1 schedule proof W|X <stamp>` projects in 087 (two per proof run, about thirty after the mutation batch) and the F1float5 revision `under_review` on 087-IMP. A restore is cheaper than reasoning about whether WP-2 reads them (plan assumption A7).
- **After an approved rule fix that changes stored figures** (for example HR-S1): `cert3d`'s stored rows keep the pre-fix figures until a recalculation (§14). Decide per fix (§4.4); do not rebuild.

### 2.2 How (the build order's own mechanism, `build-cert3d.ps1` :64-79; no migrations: `cert3d` is taken after `migrate-cert.js`)
From `backend/` with `DATABASE_URL` unset and the proof lock not held (`C:\Temp\octapm-cert\locks\proof.lock` absent):
1. Stop the cert API as `build-cert3d.ps1` does (`Stop-CertApi`: the process on :5190 must be the recorded `api.pid`; never stop another process).
2. `node scripts/cert/snapshot-db.js restore cert3d`
3. `powershell -NoProfile -ExecutionPolicy Bypass -File C:\Temp\octapm-cert\start-api.ps1`
4. Record the restore in the journal (time, reason).

Never run a builder after `cert3d` without taking the snapshot again: the state files are not part of the snapshot, and the proof's `S.projects` refuses a state file whose `projectId` differs from the live project (setup error).

### 2.3 The primary run
```
cd <worktree>\backend
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp1-schedule-proof.js
```
- **No flags on `cert3d`.** `--skip=LANES` exists only for a partial population (052-SCH-EV and 006-LITE not built), as in the debug runs. It is never used for the primary run, the final run or a mutation run: `mutate-multi.js` spawns the proof without arguments, so on a partial population every mutant would score CAUGHT by a setup error (`S.state` / `S.projects`), and the run would prove nothing.
- `CERT_PASSWORD` comes from `backend/.env` through `lib/api.js`; never echoed, copied into this plan, the results or the journal.
- Setup (`S.*`): companies 087 and 088 (and 052, 006 for the lanes) resolved by slug `cert-<code>-%`, exactly one organisation each, `assertCertOrganisation`; the seven personas sign in (087 pm, planner, site, qs; 088 pm as the outsider; 052 pm; 006 pm); the deep projects by exact name, one live each, matching the state files; the throwaway projects W and X created in 087 with their teams.
- Expected console: `wp1-schedule-proof: 146 of 146 checks active; sections S T1 T2 T3 T4 CYC CONV IMP REV BL DATES STATUS TAIL LANES CF; deep projects 087-SCH, 087-IMP, 052-SCH-EV, 006-LITE; in process`, then `tally: 125 pass, 0 fail of 146 recorded (146 active); known answers: 1 value, 21 today (BLOCKED), 0 wrong`, then `confirm-first: CF.1.milestones REJECTED; CF.2.lfNotCapped CONFIRMED; CF.3.stagedFloat CONFIRMED; CF.4.activationCode REJECTED; CF.5..CF.10 CONFIRMED`, the cleanup notes (lookahead deleted; X and W archived with `archivedAt` set; throwaway check 0 live; the 087-IMP residue note), and `147 passed, 0 failed of 147 (fixed); PASS, exit 0`.
- **The harness line** reads `provisional classification REJECTED (0 of 2 defect checks show the reported behaviour)`. Since 2026-10-10 only the confirm-first items of a decided rule or a landed fix carry `defect` (CF.1 HR-S2 and CF.4 activation code; proof :403), so REJECTED there is the correct reading: both fixes hold. The other eight CF items (undecided rules) are reported, not defect checks; their classifications are in `observations.confirmFirst` (§5.3), which is the WP-1 classification.
- Result: `C:\Temp\octapm-cert\results\cert3\wp1-schedule-proof.json` (`checks[]` with `ok`, `kind`, `notRun`; `observations.checks` per id with plan line, book key, where, expected, observed, verdict; `observations.knownAnswers`; `observations.confirmFirst`; `observations.tally`; `answers.byStatus` and `fiveXX`; `cleanup`). Copy it to `wp1-schedule-proof.primary.json` at once; every later run overwrites it.
- Exit semantics (harness rule 5, A10): **0** every check holds, known answers at `value` (pass) or `today` (BLOCKED with its ref, counted separately, never a failure); **2** at least one check failed, a defect the plan classifies (a known answer judged `wrong`, a hard leaf red, a 5xx, a CF item of a decided rule not REJECTED); **1** setup error (a check not run, a section that threw, an R-SET probe whose own setup failed) — never classified as a product result: fix the proof or the fixture and rerun.
- First execution of LANES.052 and LANES.006: they were never exercised in the debug runs. A red lane on the primary run is read first as a possible proof defect (TEST GAP) before it is classified as a product failure.
- Upload limiter (40 uploads per hour per project and user, `middleware/rate-limit.js` :131-137): the proof uploads only to W and X, which are new on every run (W: at most five schedule files by the planner, three bills by the QS, one refused file each from the site engineer and the outsider; X: seven schedule files, one bill); nothing is uploaded to a deep project. No limit is reached.
- 087 is on the enterprise plan (no project limit), and archived projects never count against a limit (`subscription-gate.js` :56-65), so the throwaway projects accumulating over the mutation batch cannot cause a 402.

---

## 3. Classification table

Every failed check and every reported known answer gets a row. Classification per plan §0.0 item 4 / §6.4: CONFIRMED, PARTIAL, REJECTED, EXPECTED BEHAVIOUR, TEST GAP. Severity per §1.4: P0, P1, P2, P3. Destination: **fixed in WP-1** (§4.2, §4.4), **owner HR decision** (§4.3), **register** (P2/P3 recorded and deferred to a named checkpoint), **proof or book corrected** (TEST GAP, the correction logged in the journal with its derivation, A10), **closed** (EXPECTED BEHAVIOUR with the rule cited).

Pre-filled rows (known before the run; "observed" is debug run 4 on the partial population and is replaced by the `cert3d` primary run):

| # | Check id(s) | Book key | Observed | Expected (value) | Today + ref | Proposed classification | Severity | Destination |
|---|---|---|---|---|---|---|---|---|
| 1 | KA.T3.live.hrS1, KA.T3.pure.hrS1, KA.T4.pure.FSlead, KA.T4.live.FSlead; CF.2 | WP1.T3.A.LS/LF/TF, WP1.T3.criticalCount, WP1.T4.FSlead.A_TF | A LS 5, LF 15, TF 5, 0 critical; FS lead A TF 5 (pure and live on X) | LS 0, LF 10, TF 0, 1 critical; A TF 0 | today, HR-S1 | CONFIRMED (CF.2) | owner's (HR row) | owner HR decision |
| 2 | KA.CONV.mspNegativeSlackCritical, KA.REV.hrS3.approve; CF.3 | WP1.parity.mspNegativeSlackCritical, WP1.revisions.hrS3Reproduction.approve | X150 TF -10, not critical; F1float5 approval 400 SCHEDULE_NOT_READY, failing [critical_path] | critical; approved | today, HR-S3 | CONFIRMED (CF.3) | owner's | owner HR decision; book text, row 13 |
| 3 | KA.IMP.twoProjectXer, KA.IMP.windows1252; CONV.durations (3 h → 0), CONV.lags (-12 h → -1); CF.9 | WP1.imports.twoProjectXerStaging, WP1.imports.windows1252, WP1.conversion.* | F4 fresh on X: 201, draft, 17 staged (14 + 3 merged); U+FFFD in the A120/A130/A330 names; half-up rounding | refused with nothing staged, or one project chosen; names decoded | today, HR-S4 | CONFIRMED (CF.9) | owner's | owner HR decision |
| 4 | KA.IMP.secondCalendar | WP1.imports.secondCalendarIds | every staged calendar id as the file states (A300, A330 '2') | the same (recorded P2) | value | value (pass) | P2 (plan HR-S4: calendars P2) | register under HR-S4 |
| 5 | KA.CYC.mixed.B; CF.8 | WP1.mixedCalendar.B_startNoEarlierThan | B starts Saturday 2026-01-10 | on or after 2026-01-12, or a 400 refusal | today, HR-S5 | CONFIRMED (CF.8) | owner's | owner HR decision |
| 6 | KA.DATES.startMoved.before, .after; KA.DATES.calendarChange.before, .after; CF.7 | WP1.dates.startMovedTo0112.*, WP1.dates.calendarChange | 200 four times, no recalculation: endDate stays 2026-04-28 while the derived finish moves (05-05; 03-27); after the lock the baseline is re-dated (05-05; 03-27) | recalculated before a baseline; 409 after the lock, nothing moves | today, HR-S6 | CONFIRMED (CF.7) | owner's | owner HR decision |
| 7 | KA.BL.handBuilt; CF.5 | WP1.baseline.handBuilt | 404 REVISION_NOT_FOUND ("import a P6/MSP schedule or generate one ...") | a refusal that says import or generate (status and code set by the fix) | today, HR-S8 | CONFIRMED (CF.5) | owner's | owner HR decision |
| 8 | KA.STATUS.A200.search, .lookahead, .exportXer, .assistant, KA.STATUS.surfacesAgree; CF.6 (STATUS.A200.hard passes) | WP1.status.A200fileFortyPercent.*, WP1.status.surfacesAgree | search in_progress; lookahead 40; XER export 40; assistant "40% complete"; /activities, /schedule, the report source and the XLSX export 0 / delayed | 0 / delayed on every surface | today, HR-P5 | CONFIRMED (CF.6) | owner's | owner HR decision |
| 9 | KA.REV.rollback.A140id | WP1.revisions.rollback.A140id | live on W: A140 back under a new id, activityCode null, p6ActivityId A140; stored 087-SCH rollback.F1b the same, engineers [] until the builder reassigned | same id as before the retirement | today, WP1-RB-1 | CONFIRMED (suspect) | P2 proposed; P1 only if the run shows a retired activity's progress, allocations or costs orphaned on a main path | register WP1-RB-1 |
| 10 | KA.REV.concurrent; CF.10 | WP1.revisions.activate.concurrent | both activations 200; 14 active rows; 0 duplicate codes | one 200, one 409 | today, CONCURRENT (plan :569, low) | CONFIRMED | low (P3 proposed) | register |
| 11 | CF.1 (REV.approve.pm, DATES.readiness, DATES.renameM900, BL.covered.live); DATES.endBeforeStart.update, .create | HR-S2 leaves; WP1.dates.endBeforeStartRefused, zeroDurationCreate | approved; date_sanity passes; rename 200; locked; end < start 400 INVALID_DATES; zero-duration milestone 201 | the same | — | REJECTED (HR-S2 decided, fixed at f599e67) | — | closed (WP1-MS-1) |
| 12 | CF.4 (REV.mapByCode.live, REV.activate.keepsCode, REV.activate.keepsBudget) | ACT-CODE leaves | A100 and A110 suggested by activity code, confidence 1; ids and codes kept; A110 budget 60,000 kept | the same | — | REJECTED (defect fix landed at f599e67) | — | closed (WP1-ACT-1) |
| 13 | **PB-1** KA.REV.hrS3.approve (book text) | WP1.revisions.hrS3Reproduction.approve.today | only critical_path fails | — | the book's `today` prose says critical_path **and** date_sanity fail | EXPECTED BEHAVIOUR of the f599e67 HR-S2 fix; the book's `today` text is stale (TEST GAP on the book, not a product defect). The proof's `today` predicate requires critical_path only, so the verdict is unaffected | — | book corrected (derivation in CHANGES); stays an HR-S3 known answer |
| 14 | **PB-2** BL.covered.audit, BL.covered.087 | WP1.baseline.covered.auditEvents | audit log (`source=audit`): 1 BASELINE_LOCKED per lock; merged timeline (`source=all`, the route's default: audit, approval, status, comment): 2 per lock (audit + approval), on W and on 087-SCH | 1 | — | EXPECTED BEHAVIOUR (two logs; the leaf counts the audit write). The draft's count of the merged list was a TEST GAP, fixed (the proof reads `source=audit` and keeps the merged list as an observation). Plan :544 holds | — | closed |
| 15 | REV.rejectWithoutReason; REV.activate.olderRevision | WP1.revisions.rejectWithoutReason, .activate.olderRevision (BOOK-3) | 400 VALIDATION_ERROR with `details[].field = 'reason'`; 409 INVALID_REVISION_STATUS | the same; the plan's codes are the leaves' `planValue` (REJECTION_REASON_REQUIRED, REVISION_NOT_CURRENT) | — | EXPECTED BEHAVIOUR (accepted contracts D1, D2; the book is already corrected) | — | closed; the report row names the planValue |
| 16 | REV.activate.cpmInTransaction (plan :506) | WP1.T1 | passes | — | — | TEST GAP: no check can tell CPM inside the transaction from CPM after the commit, or from no CPM (C4, C5; §13.1) | — | recorded on the report row; not E6 |
| 17 | Debug-run harness defects (runs 1-4): merged audit timeline counted; XER export read as JSON; double-encoded file; allocations list shape; a `Document` table that does not exist | — | fixed in the proof before run 4 | — | — | TEST GAP | — | proof corrected; journal |

HR-S7 (exclusive finish convention) has no check of its own: every date leaf uses it (`T1.dates`: A100 ends 2026-01-12). Recorded for the owner's documentation decision, as before.

---

## 4. What WP-1 fixes, and what waits for the owner

### 4.1 Already landed at `f599e67` (not redone; regression only, §6.1)
- **WP1-MS-1 / HR-S2** (owner-decided rule): zero-duration milestones pass `date_sanity` and `assertDates`; repro `wp1-milestone-repro.js` 11/11; `wp1-fix-mutations.milestone.json` and unit entries HS2-* caught.
- **WP1-ACT-1** (defect fix from §5's "not rule changes" list, P1): activation keeps code, budget, category and milestone flag; mapping identifiers first; repro `wp1-activation-code-repro.js` 12/12; `wp1-fix-mutations.activation.json` + unit entries, 22/22 caught across the three fix lists; Codex diff rounds 1-2 adjudicated.
- The proof covers both again live: CF.1 and CF.4 must read REJECTED (a decided rule or a landed fix that reads CONFIRMED fails the run).

### 4.2 WP-1 may fix without an owner decision (plan §1.4; §0.0 item 4)
- A check that fails as a **CONFIRMED P0 or P1** in a main workflow that is **not** governed by an undecided §5 row. None is expected; anything new from the primary run goes through reproduce → classify → fix only if P0/P1 → green → mutation → Codex (high risk) → code review.
- **WP1-RB-1** only if the primary run reclassifies it P1 (data loss on a main path). The evidence is KA.REV.rollback.A140id, live on W (F1 → F1b retires A140 → rollback) and from 087-SCH's stored `rollback.F1b`; no separate reproduction is needed.
- A known answer judged **`wrong`** is always a failure to classify: a product change since the book, a proof bug or a wrong derivation, settled on paper first (A10).

### 4.3 Waits for an owner HR decision (plan §5; no change before the decision)

| HR row | What WP-1 observes (final ids) | Today | Recommendation (plan §5) | Targeted sections after a fix (§6.2) |
|---|---|---|---|---|
| HR-S1 | KA.T3.live.hrS1 (087-IMP F3, stored rows), KA.T3.pure.hrS1, KA.T4.pure.FSlead, KA.T4.live.FSlead (X); CF.2 | LF not capped at the project finish | cap LF at the project finish; floats change at the next recalculation | T1, T3, T4, TAIL, LANES |
| HR-S3 | KA.CONV.mspNegativeSlackCritical (087-IMP F2 MSPDI snapshot), KA.REV.hrS3.approve (087-IMP F1float5); REV.hrS3.file and T1.staged (the staged file figures, plain); CF.3 | a staged revision is judged on the file's float | run CPM on the snapshot; critical means TF ≤ 0 for every format | CONV, REV, IMP |
| HR-S4 | KA.IMP.twoProjectXer (fresh on X), KA.IMP.windows1252, KA.IMP.secondCalendar (value, P2); CONV.durations / CONV.lags (rounding); CF.9 | half-up rounding; two-project files merged; UTF-8 only; calendars ignored | symmetric rounding; hours never 0 days unless a milestone; refuse two-project files without a choice; detect Windows-1252; calendars P2 | CONV, IMP |
| HR-S5 | KA.CYC.mixed.B (pure); CF.8 | a successor can be dated before its predecessor finishes | refuse a differing activity calendar (400) until CPM handles calendars | CYC |
| HR-S6 | KA.DATES.startMoved.before / .after, KA.DATES.calendarChange.before / .after (W); CF.7 | no recalculation; the locked baseline moves | recalculate on change; refuse after a baseline lock (409) unless re-baselined | DATES (W runs whole) |
| HR-S7 | the finish-date convention every date leaf uses | exclusive | document for Phase 1; owner's call on inclusive display | — |
| HR-S8 | KA.BL.handBuilt (X); CF.5 | hand-built programmes cannot be approved or baselined (L124) | Phase 1: a baseline needs an import or AI generation, and the UI says so | BL |
| HR-P5 | KA.STATUS.A200.search / .lookahead / .exportXer / .assistant, KA.STATUS.surfacesAgree (W); STATUS.A200.hard must pass; CF.6 | search, lookahead, export and assistant show the file's percent | approved progress only, everywhere | STATUS |

Also observation-only: KA.REV.concurrent (low). Not WP-1's to decide: HR-K2 (delayed activities on dashboards, WP-9), HR-K7 (export sheet gate), HR-S9 (087-EV, WP-3).

### 4.4 The route for a rule fix the owner approves
1. The decision is recorded (plan §0.1 and the journal). If it differs from the plan's recommendation, the affected leaves get a new derivation first (A10).
2. Codex adversarial **plan review** of the fix set (plan §6.4: "before ... each set of HR fixes"), adjudicated.
3. Reproduction red: the WP-1 proof is the reproduction. Set the rule's `status` to `'decided'` in the proof's `RULES` (:388-400): its CF item must then read REJECTED, so the run exits 2 while the behaviour is present. (Since 2026-10-10 the KA checks resting on that rule also fail on `today` once it is marked decided: `ka()` turns a decided ref's `today` into a failure, §13.5.)
4. Fix; targeted sections green (§4.3 column); unit suites of the touched services green.
5. A10 re-derivation of any mutation `expect` the fix changes (an HR-S1 fix changes the `today` alternative C2 and C3 are judged against; the catchers stay), the mutant syntax scan again (anchors may move), and one new mutation that puts the rule's defect back (plan §1.4), in a `wp1-fix-mutations.<rule>.json` list registered in `mutate-multi.js`.
6. One full run on the final code (§6.3), the mutation lists (§7), the Codex **diff review** (§8), `/code-review` (§9).
7. Stored figures: if the fix changes what CPM stores (HR-S1, HR-S6), the live reads of `cert3d`'s stored rows (KA.T3.live.hrS1 on 087-IMP; TAIL.live087 and BL.covered.087 on 087-SCH; LANES.*) keep the pre-fix figures until a recalculation. Either the proof triggers `POST /projects/<id>/import/recalculate-cpm` on that project (a deep-project write, recorded, and a reason to restore `cert3d` before WP-2), or those reads are judged again at the exit run's rebuild. Decided per fix (open question 4).

---

## 5. Known answers and where each check runs

### 5.1 The known answers the run WILL report (so nobody mistakes them for new failures)

22 KA checks; observed in debug run 4, expected again on `cert3d`. Each is `BLOCKED <ref>` (verdict `today`) or a pass (`value`), counted separately from failures. A known answer that reads neither its `value` nor its `today` is a failure (`wrong`), classified in §3; it is never moved to this list.

| Check id | Where | Ref | Observed `today` | Verdict |
|---|---|---|---|---|
| KA.T3.live.hrS1 | 087-IMP live (F3 active; the build's `activate.F3` stored `hrS1.verdict = 'today'`) | HR-S1 | A LS 5, LF 15, TF 5; 0 critical | BLOCKED |
| KA.T3.pure.hrS1 | pure (`calculateCpm`, A(10) SS+2 B(3)) | HR-S1 | the same | BLOCKED |
| KA.T4.pure.FSlead | pure (FS -8) | HR-S1 | A TF 5 | BLOCKED |
| KA.T4.live.FSlead | X (FS -8 staged, approved, activated; probe) | HR-S1 | A TF 5, LF 15 | BLOCKED |
| KA.CYC.mixed.B | pure (A five_day, B seven_day) | HR-S5 | B starts 2026-01-10, a Saturday | BLOCKED |
| KA.CONV.mspNegativeSlackCritical | 087-IMP `import.F2.mspdi` snapshot | HR-S3 | X150 TF -10, isCritical false | BLOCKED |
| KA.REV.hrS3.approve | 087-IMP F1float5 draft: planner submits, PM approves (the only deep-project write) | HR-S3 | 400 SCHEDULE_NOT_READY, failing [critical_path] (PB-1: the book's prose also names date_sanity) | BLOCKED |
| KA.IMP.twoProjectXer | X (F4 staged fresh) | HR-S4 | 201, draft, imported 17 = activityCount = staged (14 + 3) | BLOCKED |
| KA.IMP.windows1252 | 087-IMP `import.F5` snapshot | HR-S4 | U+FFFD in the A120, A130, A330 names | BLOCKED |
| KA.IMP.secondCalendar | 087-IMP `import.F6` snapshot | HR-S4 | every staged calendar id as the file states (A300, A330 '2') | **value** (recorded P2) |
| KA.REV.rollback.A140id | W live; 087-SCH stored `rollback.F1b` | WP1-RB-1 | A140 back with a new id, activityCode null, p6ActivityId A140 | BLOCKED |
| KA.REV.concurrent | W (R5 staged, approved, activated twice at once; probe; the last W step) | CONCURRENT | both 200, 14 active rows, 0 duplicate codes | BLOCKED (race, §5.3) |
| KA.BL.handBuilt | X (hand-built A, B; priced in-scope bill fully allocated; probe) | HR-S8 | 404 REVISION_NOT_FOUND with the import/generate message | BLOCKED |
| KA.DATES.startMoved.before | W, F1 active, before any baseline | HR-S6 | 200; endDate 2026-04-28, derived 2026-05-05 | BLOCKED |
| KA.DATES.calendarChange.before | W, before any baseline | HR-S6 | 200; seven_day; endDate 2026-04-28, derived 2026-03-27 | BLOCKED |
| KA.DATES.startMoved.after | W, right after the first lock (step 9b, before F1b) | HR-S6 | 200; baseline re-dated to 2026-05-05 | BLOCKED |
| KA.DATES.calendarChange.after | W, right after the first lock | HR-S6 | 200; seven_day; baseline re-dated to 2026-03-27 | BLOCKED |
| KA.STATUS.A200.search | W | HR-P5 | in_progress | BLOCKED |
| KA.STATUS.A200.lookahead | W (a lookahead made and deleted in cleanup; probe) | HR-P5 | 40 | BLOCKED |
| KA.STATUS.A200.exportXer | W (`GET export/schedule/xer`, read as binary) | HR-P5 | phys_complete_pct 40 | BLOCKED |
| KA.STATUS.A200.assistant | W (`retrieval.retrieve` in process; probe) | HR-P5 | "40% complete" | BLOCKED |
| KA.STATUS.surfacesAgree | W (the seven surfaces) | HR-P5 | disagree: the four above at 40 / in_progress; /activities, /schedule, the report source, the XLSX export 0 / delayed | BLOCKED |

Tally expected: 21 BLOCKED, 1 value, 0 wrong. Plain checks that carry an HR note but pass: CONV.durations (3 h → 0) and CONV.lags (-12 h → -1) pass as the plan states the CLAUDE.md rule; CF.9 records the rounding as present (HR-S4). The CF items: CF.1, CF.4 REJECTED (they must be); CF.2, 3, 5, 6, 7, 8, 9, 10 CONFIRMED (reported, pass under undecided rules).

Not WP-1 keys, ignored here: 052-SCH-EV `wp3.T3` BLOCKED L34, 006-LITE `retention.unconfigured` BLOCKED HR-C1 (WP-3 / WP-4); WP3-TZ-1 (WP-3 confirm-first).

### 5.2 Where each check runs (the proof's where-table) and the recorded deviations from MOMENT-MAP

| Where | Checks |
|---|---|
| **W**: a throwaway project of 087 made by each run (hand-built A100 approved 100%, A110 budget 60,000; F1 imported, reviewed and activated over them by code), archived in cleanup (90 checks) | T1.import, T1.staged, T1.network, T1.row.* (14), T1.critical, T1.invariant, T1.dates; T2.at20, T2.restored; CYC.refusal, CYC.rowsChanged, CYC.selfLink; CONV.activeEqualsStaged; IMP.siteEngineer, IMP.outsider; REV.* except REV.mapByCode.stored, REV.activate.record.stored, REV.F1b.stored, REV.hrS3.file, KA.REV.hrS3.approve (28); BL.noBoq, BL.zeroRated, BL.allOutOfScope, BL.notActivated, BL.unallocated.live, BL.planner, BL.siteEngineer, BL.covered.live, BL.covered.audit, BL.afterA110at20, BL.secondBaseline; DATES.* (8); STATUS.* except STATUS.pure (8); TAIL.liveW, TAIL.progress; CF.1, CF.4, CF.6, CF.7, CF.10 |
| **X**: a second throwaway project of 087, archived in cleanup (11) | KA.BL.handBuilt; T4.live.FSlead, KA.T4.live.FSlead, T4.live.FF, T4.live.SF; IMP.stagedNotApplied (the FF staging); CONV.range.atMax, CONV.range.beyond; IMP.dryRun; KA.IMP.twoProjectXer; CF.5 |
| **087-IMP**: live end state (F3 active) and the staged snapshots through `GET revision`; the F1float5 submit and approval (19) | T3.file, T3.live, KA.T3.live.hrS1; CONV.durations, CONV.lags, CONV.floatMinus80, CONV.parity.p6xml, .xlsx, .mspdiF1, .mspdiF2, KA.CONV.mspNegativeSlackCritical; IMP.formats, KA.IMP.windows1252, KA.IMP.secondCalendar; REV.hrS3.file, KA.REV.hrS3.approve; CF.2, CF.3, CF.9 |
| **087-SCH live**, read only (2) | TAIL.live087, BL.covered.087 |
| **087-SCH stored** step outputs (moments gone) (8) | T1.stored, T2.stored, REV.mapByCode.stored, REV.activate.record.stored, REV.F1b.stored, BL.noBoq.stored, BL.notActivated.stored, BL.unallocated.stored (with the in-scope sum read live from the build's bill) |
| **052-SCH-EV / 006-LITE**, live `GET /schedule` and stored lane outputs (2) | LANES.052, LANES.006 |
| **pure**, in process (10) | T1.pure, T3.pure, T3.inputs, KA.T3.pure.hrS1, T4.pure, KA.T4.pure.FSlead, CYC.mixed.A, KA.CYC.mixed.B, STATUS.pure, CF.8 |
| **setup** (4) | S.companies, S.state, S.projects, S.throwaway |

**Recorded deviation from MOMENT-MAP lines 27 and 46** (adjudication L-Q3, R-DOC), chosen for re-runnability:
- line 27 (`WP1.baseline.zeroRated / allOutOfScope`: "the WP-1 proof on 087-IMP (scratch), R1-16") → run on **W**, in the plan's refusal order (:543): BL.noBoq, BL.zeroRated, BL.allOutOfScope, BL.notActivated (F1b approved, not activated), BL.unallocated.live, then the covering allocation and the lock;
- line 46 (`WP1.T4.FSlead / FF / SF`: "live in the WP-1 proof on 087-IMP (scratch), R1-13") → run on **X**.

Fresh records either way; 087-IMP's active F3 stays intact for T3.live and KA.T3.live.hrS1 on any re-run, and no restore is needed after a run or a mutation. For the same reason, and not against any MOMENT-MAP row:
- **T2** runs live on W (T2.at20, T2.restored) beside T2.stored, which reads 087-SCH's `cpm.T2` moment as MOMENT-MAP line 24 says;
- **both start-date probes and both calendar probes** run on W (the 2026-10-09 draft moved 087-SCH's start live and had to put it back);
- **the M6 site-engineer refusals** (REV.roles.siteActivate, REV.roles.siteRollback, BL.siteEngineer) run on W;
- **F4** is staged fresh on X (KA.IMP.twoProjectXer, adjudication M4). MOMENT-MAP line 47's build moment (087-IMP `import.F4`, finding HR-S4) stays the build's evidence, and IMP.formats still reads that revision's state.

Result: 087-SCH, 052-SCH-EV and 006-LITE are read only for WP-1. **The only deep-project write is the F1float5 submit and approval on 087-IMP** (MOMENT-MAP line 52 assigns it to this proof), made only when KA.REV.hrS3.approve is selected (a run filtered away from REV skips it).

### 5.3 Reading notes
- **The harness classification line** (§2.3) is not the WP-1 classification; read `observations.confirmFirst`.
- **KA.REV.concurrent is a race.** `today` (both 200) was observed in debug runs 2 and 4. A 200 + 409 split reads `value` (pass; CF.10 then REJECTED, still a pass) and is not a regression. Anything else (a 5xx, duplicate codes) is `wrong` plus a `G.5xx` failure, and is classified; it is never rerun until green.
- **F1float5 residue.** After a `cert3d` restore the revision is a draft: the planner submits, the PM's approval is refused 400, and it stays `under_review`. A later run without a restore approves again from `under_review` (refused again, same verdict); IMP.formats accepts draft, under_review or approved for that last draft. Only an HR-S3 fix turns it `approved` (verdict `value`).
- **KA.IMP.secondCalendar reads `value` at HEAD.** The staged ids are the same under HR-S4's value and today; the CPM fallback the leaf's `today` names cannot be seen in a snapshot. Recorded P2 under HR-S4; not a sign that HR-S4 is fixed.
- **Probes (R-SET).** KA.BL.handBuilt, KA.T4.live.FSlead, KA.REV.concurrent, KA.STATUS.A200.lookahead, KA.STATUS.A200.assistant and KA.STATUS.surfacesAgree run in their own sections: when what they need cannot be set up, the run ends as a setup error (exit 1) with the check "not run", never `wrong`.
- **Throwaway accumulation.** Each run adds two archived projects to 087; the cleanup's throwaway check (an observation, up to 100 listed) must say 0 live.

---

## 6. Targeted proofs, targeted reruns, the final full run

### 6.1 Regression of the landed fixes (on `cert3d`)
```
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp1-milestone-repro.js        -> 11/11, exit 0
node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp1-activation-code-repro.js  -> 12/12, exit 0
```
Both make their own scratch project in 087 and archive it. Any new repro the primary run requires (a new CONFIRMED suspect) is written as `cert3/wp1-<item>-repro.js` on the harness, exits 2 while the defect is present, and is listed here with its result.

### 6.2 Targeted reruns of the WP-1 proof after a fix
The proof filters by section: `--only=<sections>`, `--project=<code>`, `--skip=<sections>` (sections: S T1 T2 T3 T4 CYC CONV IMP REV BL DATES STATUS TAIL LANES CF). The setup checks always run, for the projects the selected checks need; a section on W or X runs the whole W or X flow but registers only the selected checks; selecting CF selects every section but LANES; a run without REV does not write the F1float5 approval. Use the HR column of §4.3 for a rule fix, or the failing checks' sections for a defect fix, e.g. `node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp1-schedule-proof.js --only=T3,T4`.

### 6.3 The final full run
If no product or proof change follows the primary run, the primary run is the WP-1 result and also the unmutated baseline of §7.3 (copy it to `wp1-schedule-proof.baseline.json`): no second full run. If anything changed, one full run on the final code, no flags; its result is the WP-1 result recorded in the report and the mutation baseline (`.final.json` and `.baseline.json`).

---

## 7. Mutation runs

### 7.1 Ids: reconciled (done 2026-10-10)
Every `catchers` and `collateral` id in the four lists is a check id exactly as the proof records it (adjudication M1). Nothing to edit before the run unless a fix changes a figure the lists derive (§4.4 step 5).

### 7.2 Mutant syntax (no DB, no lock)
Checked at alignment against the current tree: 42 mutations (20 in the primary lists, 22 in the three landed-fix lists), every anchor found exactly once, every mutated copy parses (`C:\Temp\octapm-cert\scratch\wp1\runplan\mutsyntax-wp1.js`, copies in its `mutsyntax\` folder). Rerun on the day, and after any product diff (`C:\Temp\octapm-cert\scratch\mutsyntax-all.js` does the same for every list). A mutant that does not parse would be "caught" by a crash and proves nothing.

### 7.3 Runner and baseline
- `mutate-multi.js` already registers `wp1-cpm`, `wp1-gates`, `wp1-imports` (proof `wp1-schedule-proof.js`, locked) and `wp1-unit` (jest). It spawns the proof **without arguments**, so the population must be complete (`cert3d`), and it scores any non-zero proof exit CAUGHT.
- Hence: (a) the unmutated proof must exit 0 on the same code immediately before (§6.3 baseline); a proof red at HEAD makes every mutant "CAUGHT" and voids the run; (b) CAUGHT alone is not evidence: the named catchers must read FAIL (ran and failed, not "not run") in that mutant's result file (§7.4).
- The cert API on :5190 may stay up: it runs `node src/index.js` with no watcher and loaded the services at start. Nobody uses it during a list, and it is never started or restarted while a mutant is applied (it would load the mutated file).
- Landed-fix lists: their 22/22 evidence at `f599e67` stands while their files are unchanged (`git diff f599e67 -- backend/src` empty, or the diff does not touch `schedule.service.js` / `activity.service.js`). Rerun only the entries whose file a WP-1 fix changes (targeted, owner rule 4).

### 7.4 Running: one mutant per invocation, the result copied after each
Never while a build, another proof, Codex or the full jest suite runs. One command line each (shell state does not persist between tool calls):
```
cd <worktree>\backend
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp1-mutations.C1.json --lists=wp1-cpm --only=C1; Remove-Item Env:CERT_LOCK_HELD
New-Item -ItemType Directory -Force C:\Temp\octapm-cert\results\cert3\wp1-mutations | Out-Null; Copy-Item C:\Temp\octapm-cert\results\cert3\wp1-schedule-proof.json C:\Temp\octapm-cert\results\cert3\wp1-mutations\C1.json
```
`run-locked.js` takes the proof lock once for the whole invocation, sets `CERT_INPROCESS=1` and drops `DATABASE_URL`; with `CERT_LOCK_HELD=1` the runner spawns the proof directly. Per-mutant runs are required because every run overwrites the proof's result file and the runner keeps only the first 12 FAIL lines (C1 has 15 catchers; "not run" checks also print as FAIL lines).

Order: C1, C2, C3, C4, C5 (`--lists=wp1-cpm`); G1, G2, G3, G4, G5 (`--lists=wp1-gates`); I1, I2, I3 (`--lists=wp1-imports`); then the unit list in one invocation under the lock (it needs no database, but the lock keeps any proof from starting on a mutated tree):
```
$env:CERT_LOCK_HELD='1'; node C:\Temp\octapm-cert\run-locked.js C:\Temp\octapm-cert\mutate-multi.js C:\Temp\octapm-cert\results\cert3\wp1-mutations.unit.json --lists=wp1-unit; Remove-Item Env:CERT_LOCK_HELD
```
After the 13 proof-backed runs:
```
node scripts/cert/cert3/wp1-mutation-evidence.js
```
It reads `results\cert3\wp1-mutations\<id>.json` and the lists, and prints for each entry the exit code, each catcher's state (FAIL / PASS / NOT RUN), the collateral, any unexpected red, the known-answer tally and 5xx count; then `E6 (§6.2 WP-1 guards): n/5`. Exit 0 when every entry is as its list expects. (Dry-run at alignment on the unmutated result: C1 "NO EVIDENCE" with every catcher PASS, C5 "SURVIVED as expected", as designed.) A run that ends in exit 1 counts only if its catchers already read FAIL (C1 and I1 do so by design).

Expected per mutant (the lists carry the derivations):

| Id | Runner verdict | Exit | Named catchers (must be FAIL) | Expected collateral |
|---|---|---|---|---|
| C1 | CAUGHT | 1 (W stops after BL.covered.live) | T1.pure, REV.activate.cpmInTransaction, T1.row.{A100,A110,A120,A130,A200,A210,A220,A230,A310,A320,A330,M900}, T1.critical | T2.restored, BL.unallocated.live, BL.covered.live; later W checks not run |
| C2 | CAUGHT | 2 | KA.T3.pure.hrS1 (`wrong`: LF 5) | none (CF.2 reads PARTIAL, still a pass) |
| C3 | CAUGHT | 2 | T3.pure, KA.T3.pure.hrS1 | none |
| C4 | SURVIVED (expected) | 0 | none (limitation probe, §13.1) | none |
| C5 | SURVIVED (expected) | 0 | none (limitation probe, §13.1) | none; visible trace: KA.T4.live.FSlead `value`, tally 2 value / 20 today, CF.2 PARTIAL |
| G1 | CAUGHT | 2 | BL.noBoq, BL.zeroRated, BL.allOutOfScope (each 400 SCHEDULE_NOT_READY) | none |
| G2 | CAUGHT | 2 | BL.noBoq (400 BOQ_VALUE_REQUIRED_FOR_BASELINE) | none |
| G3 | CAUGHT | 2 | BL.zeroRated (400 BOQ_SCOPE_REQUIRED_FOR_BASELINE) | none |
| G4 | CAUGHT | 2 | BL.allOutOfScope (400 SCHEDULE_NOT_READY) | none |
| G5 | CAUGHT | 2 | BL.notActivated (400 SCHEDULE_NOT_READY) | none |
| I1 | CAUGHT | 1 (W stops at REV.activate.full) | IMP.stagedNotApplied | REV.activate.unmappedNamed, REV.mapByCode.live, REV.activate.full, REV.activate.cpmInTransaction, CF.4, CF.6, CF.7, CF.10 |
| I2 | CAUGHT | 2 | IMP.dryRun (1 revision created) | none |
| I3 | CAUGHT | 2 | CONV.range.beyond (201 instead of 400 SCHEDULE_FIGURE_OUT_OF_RANGE) | none |
| UG1-UG4, UI3, UC4, UC5 | CAUGHT | jest red | the named tests in `wp1-mutations.unit.json` | — |

### 7.5 What counts where: the E6 tally
- **E6 (plan §6.2 WP-1, five guards), tallied on these five only:** TF ≤ 0 → **C1**; the SS backward branch → **C2**; the BOQ baseline gate → **G1** (G2-G4 prove its three exact codes); `REVISION_NOT_ACTIVATED` → **G5**; staged imports do not write → **I1**. E6 is met for WP-1 when the five are CAUGHT by their named catchers on the final code.
- **Complements beyond §6.2** (adjudication L-Q1: run with the batch, each has a leaf, not tallied): **C3** (SS forward), **I2** (xlsx dry run writes nothing, rule :533), **I3** (out-of-range refused, rule :504).
- **Limitation probes** (plan :506, adjudication M3; not §6.2, not tallied): **C4**, **C5**, expected SURVIVED; their unit tripwires **UC4**, **UC5** (mocked; not certification evidence, §1.4); §13.1.
- **Unit side** (not evidence; the unit gate also turns red): UG1-UG4 (G1-G4), UI3 (I3). No unit catcher exists for C1, C2, G5, I1; the live proof is their evidence.
- **Landed-fix guards:** 22 in `wp1-fix-mutations.*.json` (§7.3).

### 7.6 Cleanup and census after the lists (plan §7)
- **No restore after any WP-1 list.** Every mutant stores, if at all, only on W and X (CPM figures under C1-C3 / C5, written rows under I1, a draft revision under I2 / I3), both archived by the proof's cleanup, which also runs after a section error. No mutant changes the F1float5 outcome on 087-IMP (its approval judges the staged file's flags, not CPM's), and no list stages, recalculates or baselines on a deep project.
- **Census**, once after the batch:
  1. `node scripts/cert/isolation/fingerprint.js take wp1-post`, then `node scripts/cert/cert3/build/fingerprint97.js cert3-post wp1-post` (exit 0: the 97 other companies unchanged; 088's refused outsider requests only in the noise tables). Its `cert3-post--wp1-post.e2.json` lists 087's changed pairs: they must be the throwaway projects' tables, the F1float5 revision's status and the request-noise tables only. (If the sweep or a restore happened after `cert3-post`, compare against a fingerprint taken right after the last restore instead.)
  2. The last proof run's throwaway check: 0 live `CERT3 WP1 schedule proof` projects.
  3. Record the census in the journal.
- **Never commit a mutated tree.** After every invocation `git status` shows no product diff that is not the batch's; `mutate-multi.js` restores byte for byte and keeps backups in `C:\Temp\octapm-cert\mutate-backups\`; a RESTORE FAILED line stops everything until the file is restored by hand.

---

## 8. Codex (plan §6.4; owner rule 5)

- **Required for WP-1 only when** (a) the owner approves a set of HR fixes: an adversarial **plan review** before implementing it and a **diff review** after (§4.4); or (b) WP-1 lands another high-risk product diff beyond `f599e67` (gates, readiness or activation, anything that moves stored schedule figures, permissions): a **diff review**.
- **Not required for** the proof, the lists, this plan or answer-book edits (test side): `/code-review` covers them (§9).
- Rounds: stop when nothing CRITICAL or HIGH is open; at most 3, then escalate. If the latest review leaves no open CRITICAL/HIGH product issue, no further round for P2/P3 or test polish: those findings are recorded or deferred as the plan says.
- Mechanics (memory `octapm-codex-review.md`): the desktop app's `codex.exe`; one whole-diff pass per five-hour window; prompt `scratch\wp1-diff-codex-prompt-r<n>.txt`, output `scratch\wp1-diff-codex-review-r<n>.md`, adjudication `scratch\wp1-diff-r<n>-adjudication.md` with every finding CONFIRMED / PARTIAL / REJECTED / EXPECTED BEHAVIOUR / TEST GAP. Never during a build, a proof, a mutation list or the full suite. If the usage limit blocks it, the batch waits and the re-run is scheduled for the next window.
- No product diff: record "no Codex review needed for WP-1 (no high-risk product diff beyond f599e67)" in the journal. The two landed fixes already had theirs (`scratch\wp1-fix-diff-codex-review.md`, `-r2.md`, adjudications).

## 9. Code review

`/code-review` (high) on the WP-1 batch before it is committed: `wp1-schedule-proof.js`, the four lists, this plan, the answer-book changes (BOOK-1..7 and any PB-1 correction), any repro, any product diff. Findings adjudicated like Codex's. A finding that changes the proof is followed by one full proof run (16 s) and a rerun of only the mutants whose catchers it touches (targeted).

## 10. Commit and push

No merge of `main` into `cert/full-saas-certification` (owner rule; it overrides CLAUDE.md's "pull origin/main before committing"). Commit; push. Message `cert(CERT-3 WP-1): <one line>`, the body listing the proof, the lists, the run plan, the book changes and the results summary, ending with the attribution line the committing session gives.

## 11. Journal

`OCTAPM_CERT_JOURNAL.md`, same heading style: the primary run (passed / failed / known answers by verdict, exit), the classification table, the HR rows reported, the two product-vs-book items (PB-1, PB-2), the deviation of §5.2, the mutation results per mutant with their named catchers and the E6 tally, the restores made, the census, the reviews (or "not needed"), and the next exact action (WP-2 on a restored `cert3d`).

## 12. The WP-1 section of `OCTAPM_WORKFLOW_CERTIFICATION.md` and the register

Add `## WP-1 Schedule — <CLOSED | IN PROGRESS> (<date>)` after WP-0, in the WP-0 section's shape (rule or item → evidence → result). The result column holds `passed/total`, the exit code, and every known answer's ref.

| Rule or item (plan WP-1) | Evidence (final check ids) | Result |
|---|---|---|
| Conversion: hours / 8 with Math.round, clamped at 0; lags the same; FS, SS, FF, SF; parity | CONV.durations, CONV.lags, CONV.floatMinus80, CONV.parity.p6xml / .xlsx / .mspdiF1 / .mspdiF2 (087-IMP snapshots); KA.CONV.mspNegativeSlackCritical (HR-S3) | rounding as the plan states it; HR-S4 note |
| Imports are staged, never applied; out of range refused | IMP.stagedNotApplied, CONV.activeEqualsStaged, CONV.range.atMax, CONV.range.beyond, IMP.dryRun, IMP.formats; mutations I1 (§6.2), I2, I3; UI3 | |
| Import roles | IMP.siteEngineer (403), IMP.outsider (404 PROJECT_NOT_FOUND) | |
| Two-project files, Windows-1252, second calendar | KA.IMP.twoProjectXer (X), KA.IMP.windows1252, KA.IMP.secondCalendar | BLOCKED HR-S4 (two); P2 recorded |
| Revision state codes | REV.rejectApproved (409 INVALID_REVISION_STATUS), REV.notCurrent (409 REVISION_NOT_CURRENT), REV.activate.olderRevision (409 INVALID_REVISION_STATUS; planValue REVISION_NOT_CURRENT), REV.rejectWithoutReason (400 VALIDATION_ERROR + field; planValue REJECTION_REASON_REQUIRED), REV.activate.noMapping (MAPPING_CONFIRMATION_REQUIRED), REV.activate.unmappedNoReason / .unmappedNamed (UNMAPPED_REMOVAL_REASON_REQUIRED), REV.activate.again (REVISION_ALREADY_ACTIVE), REV.secondImport.live, KA.REV.hrS3.approve (SCHEDULE_NOT_READY) | contracts D1, D2 named |
| Activation: CPM inside the transaction; record counts; mapped ids keep approved progress; mapping by code | REV.activate.full, REV.activate.cpmInTransaction, REV.activate.record.stored, REV.mapByCode.live / .stored, REV.activate.keepsCode / .keepsBudget / .keepsApprovedProgress; `wp1-activation-code-repro.js`; `wp1-fix-mutations.activation.json` | plan :506: TEST GAP recorded (C4, C5 SURVIVED; §13.1) |
| F1b, second baseline, rollback | REV.F1b.live / .stored, BL.secondBaseline, REV.rollback.live, KA.REV.rollback.A140id | WP1-RB-1 reported |
| CPM invariants: T1, T2, cycle with no write | T1.* (W, stored, pure), T2.at20, T2.restored, T2.stored, CYC.refusal, CYC.rowsChanged, CYC.selfLink; mutation C1 (§6.2) | |
| SS / FF / SF / lead (T3, T4) | T3.pure, T3.inputs, T3.file, T3.live, T4.pure, T4.live.FSlead / .FF / .SF; KA.T3.*, KA.T4.*; mutations C2 (§6.2), C3 | HR-S1 BLOCKED |
| Mixed calendar | CYC.mixed.A, KA.CYC.mixed.B | HR-S5 BLOCKED |
| Baseline gates: BOQ_REQUIRED / VALUE / SCOPE, REVISION_NOT_ACTIVATED, coverage; baseline = early dates; one BASELINE_LOCKED; second baseline supersedes; EF 91 against 81 | BL.noBoq (+ .stored), BL.zeroRated, BL.allOutOfScope, BL.notActivated (+ .stored), BL.unallocated.live / .stored, BL.covered.live / .audit / .087, BL.afterA110at20, BL.secondBaseline; mutations G1-G5 (G1, G5 §6.2); UG1-UG4 | PB-2 closed |
| Hand-built programme (L124) | KA.BL.handBuilt (X) | HR-S8 BLOCKED |
| Roles: planner submits; PM approves, activates, baselines; site engineer and outsider refused | REV.roles.siteSubmit, REV.submitByPlanner, REV.approve.planner / .site / .pm, REV.roles.outsider, REV.roles.plannerActivate, REV.roles.siteActivate, REV.roles.siteRollback, BL.planner, BL.siteEngineer, IMP.siteEngineer, IMP.outsider; WP-0 permission probe | |
| Milestones (HR-S2, decided) | REV.approve.pm, DATES.renameM900, DATES.readiness, DATES.endBeforeStart.update / .create, CF.1 REJECTED; `wp1-milestone-repro.js`; `wp1-fix-mutations.milestone.json` | |
| Start date and calendar changes | KA.DATES.startMoved.before / .after, KA.DATES.calendarChange.before / .after; CF.7 | HR-S6 BLOCKED |
| Status: `deriveActivityStatus` boundaries; surfaces agree; unapproved 60 changes nothing; the tail | STATUS.pure, STATUS.A200.hard, STATUS.A110at40, STATUS.unapproved60, TAIL.live087, TAIL.liveW, TAIL.progress; KA.STATUS.* | HR-P5 BLOCKED (surfaces) |
| 052-SCH-EV and 006-LITE: F1 through baseline, the PM takes every step in 006 | LANES.052, LANES.006 | |
| Confirm-first items (plan :559-569) | CF.1-CF.10 (`observations.confirmFirst`) | 2 REJECTED (fixed), 8 CONFIRMED (reported) |
| Known answers and observations | §5.1 of this plan | 21 BLOCKED with refs, 1 value; owner decisions pending |
| Mutations (E6) | `results\cert3\wp1-mutations\<id>.json`, `wp1-mutations.unit.json` result, `wp1-mutation-evidence.js` output | 5/5 §6.2 guards CAUGHT by their named catchers; C3, I2, I3 caught; C4, C5 survived (TEST GAP); unit 7/7; 22 fix guards at f599e67 |
| Reviews (E11) | Codex (if any high-risk product diff), `/code-review` | |

Register (`OCTAPM_LAUNCH_BLOCKERS.md`): WP1-RB-1 gets its classification and severity; a row for the concurrent activations (low, P3 proposed); every new WP-1 finding with its destination; PB-1 as a TEST GAP row on the book (closed by the correction); PB-2 as EXPECTED BEHAVIOUR; the plan :506 TEST GAP (C4, C5); the book wording notes of §13.3.

---

## 13. Limitations, TEST GAPs and book-owner notes (the lists refer here)

### 13.1 Plan :506, "CPM runs inside the activation transaction" (C4, C5)
REV.activate.cpmInTransaction reads the stored rows straight after the activation answer. It cannot tell CPM inside the transaction from CPM run after the commit but before the answer (C4: an equivalent mutant for every API observation; the two differ only while the activation is in flight and when CPM throws, which no API path makes it do inside an activation), nor from no CPM at all (C5: the staged figures equal CPM's on every generated file the proof activates, except the capped FS-lead file, so the one visible trace is KA.T4.live.FSlead at `value` and the tally 2 / 20). Both are expected SURVIVED and recorded as a TEST GAP on the report's :506 row; neither is a §6.2 guard. The only tripwires are UC4 / UC5, mocked unit tests (not evidence, §1.4); UC4 cannot tell the transaction client from the global one. No new test is required (§0.0 item 5).

### 13.2 No unit catcher for C1, C2, G5, I1
Listed in `wp1-mutations.unit.json` so nobody looks for one; the live proof is their evidence. Adding unit tests is allowed only inside a fix batch, never as a new requirement.

### 13.3 Book wording (for the book owner, under Claude Main; each correction with its derivation in CHANGES, A10)
- **PB-1:** `WP1.revisions.hrS3Reproduction.approve.today` still says date_sanity fails beside critical_path; at `f599e67` (HR-S2 fixed) only critical_path fails.
- `WP1.mutations.dropSsBackward` prose ("LS(B) 7 - 2 = 5 → TF -5") does not match the product's mutated answer (A TF 0, LF 5); the catcher is unaffected.
- `WP1.mutations.dropBoqGate` ("no longer refused") and `WP1.mutations.dropRevisionNotActivated` ("a staged approved revision is baselined") predict writes that do not happen at `f599e67`: the readiness refuses each mutated lock with 400 SCHEDULE_NOT_READY. Their catchers are right because the proof asserts status and code.
- `WP1.revisions.activate.concurrent.today` cites `@886c9f1` and plan `:530` (pre-renumbering line references); cosmetic.
- The M6 checks borrow `WP1.revisions.roles.siteEngineerSubmit` (activate, rollback) and `WP1.baseline.planner` (baseline) as the role-refusal code, 403 FORBIDDEN; dedicated leaves are optional.

### 13.4 Harness classification for this proof
Resolved 2026-10-10 (integration owner): the plan entries carry `defect` only for confirm-first items whose rule is decided or whose fix has landed (CF.1, CF.4; proof :403). The harness' REJECTED reading applies to those two and is correct; the other eight are classified in `observations.confirmFirst`.

### 13.5 A decided rule's known answers turn red on `today`
Resolved 2026-10-10 (integration owner): `ka()` fails a `today` verdict whose ref is a decided rule in the proof's `RULES` (`knownAnswers[id].ruleDecided`), so marking a rule decided (§4.4 step 3) turns both its CF item and its known-answer checks red until the fix lands. Refs that are register suspects (WP1-RB-1) are not rules and stay BLOCKED until they are classified.

---

## 14. Hazards (read before running)
- `cert3d` must exist and the population must be complete: the default run needs the 052-SCH-EV and 006-LITE state files and projects, and `mutate-multi.js` cannot pass `--skip`. On a partial population every mutant scores CAUGHT by a setup error.
- One writer: proofs only through `run-locked.js`; a mutation list with the lock held for the whole invocation; no build, Codex or full jest suite at the same time (OPS-1).
- The unmutated proof must exit 0 on the same code right before the lists (§6.3); CAUGHT counts only when the named catchers read FAIL (§7.4).
- The cert API is never (re)started while a mutant is applied; nobody uses :5190 for a walkthrough during a list.
- Stored figures after an approved CPM rule fix: `cert3d`'s stored rows keep the old rule until recalculated (§4.4 step 7).
- After any product diff: mutant syntax scan again (anchors may move), and A10 re-derivation of any list `expect` the fix changes.
- KA.REV.concurrent is a race (§5.3): classify an unexpected outcome, never rerun until green.
- The F1float5 approval is the only deep-project write; a filtered run without REV skips it.
- State files are not in the snapshot: never run a builder after `cert3d` without taking it again.
- Long runs: none in WP-1 exceeds the 1.5 h detach threshold; background tasks are killed at 2 h; anything that could pass 1.5 h goes detached with the watchdog (a 2 h task kill duplicates records; the Prisma engine dies on this machine under load).
- Secrets: `CERT_PASSWORD` only through `lib/api.js`; results and logs are scrubbed by the harness; never paste a token or a password into the journal.
