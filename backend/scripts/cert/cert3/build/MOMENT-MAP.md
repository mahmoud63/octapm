# CERT-3 WP-0: moment map of the deep-company builds

Rule G1 of the builder adjudication (`C:\Temp\octapm-cert\scratch\wp0\builders-adjudication.md`, plan §3.3 and §7 step 4): a build that passes through a state a work-package check needs asserts that check at that moment, against its answer-book key, and stores the figures in the step output (`C:\Temp\octapm-cert\results\cert3\build-<code>.json`). Where the built end state makes a check impossible on that project, the work-package proof runs it on fresh records. This map is the record: every known-answer key that a build touches, and where its evidence is.

Legend for "where": **asserted in build: <code> <step>** — the check passed at that moment and its figures are in the step output; **observed in build … finding <ref>** — HEAD differs from the book and the departure is persisted as a finding with its register or HR ref; **BLOCKED <ref>** — the step blocks on the book's known answer for an undecided or scheduled item; **WP proof …** — the work-package proof reads the live end state, the stored step output, or fresh records, as stated.

Known-answer keys are those of `backend/scripts/cert/cert3/answers/*.js` (schedule.js, commercial.js, field-controls.js). Round 1 entries come from the builder groups after the first adjudication round; round 2 and 3 entries from the answer-book additions and builder changes of the later rounds. Entries are kept as the builders returned them.

## 087-SCH and 087-IMP (WP-1, WP-2)

| Check (answer-book key or rule) | Where the evidence is | Round |
|---|---|---|
| WP1.T1.* (all 14 rows ES/EF/LS/LF/TF, criticalCount 12, M900earlyFinishDate) | asserted in build: 087-SCH programme.hand (hand-built) and cpm.F1 (F1 activated); restored state again in cpm.T2 | 1 |
| WP1.T1.stagedSnapshot.A200physComplete / M900startEqualsFinish | asserted in build: 087-SCH import.F1 | 1 |
| WP1.revisions.submitByPlanner / approve.pm (200, HR-S2 fixed) | asserted in build: 087-SCH submit.F1, approve.F1, submit.F1b, approve.F1b; 087-IMP submit.F3 | 1 |
| WP1.revisions.mapByCode.matchType (A100 activity_code) and activityCodeAfterActivation ('A100') | asserted in build: 087-SCH activate.F1 (GET .../mapping read before activation; activated with the suggestions) | 1 |
| WP1.revisions.mapByCode.budgetAfterActivation | WP proof: wp1-activation-code-repro.js (60,000 kept) and the WP-1 proof (adjudication item 6); 087-SCH's hand-built programme carries no budget (0 to 0, noted) | 1 |
| WP1.revisions.activate.record / full | asserted in build: 087-SCH activate.F1 (updated 14, new 0, retired 0, 13 links) | 1 |
| WP1.baseline.noBoq (400 BOQ_REQUIRED_FOR_BASELINE) | asserted in build: 087-SCH baseline.noBoq (F1 active, no BOQ row) | 1 |
| WP1.baseline.notActivated (409 REVISION_NOT_ACTIVATED) | asserted in build: 087-SCH baseline.notActivated (F1b approved, not activated; BOQ uploaded first) | 1 |
| WP1.revisions.F1b.* (record 13/0/1/12, M900_EF 91, A300_TF 20, A110days 20, previousRevision superseded) | asserted in build: 087-SCH activate.F1b, cpm.F1b | 1 |
| WP1.revisions.rollback.M900_EF 81 | asserted in build: 087-SCH rollback.F1b | 1 |
| WP1.revisions.rollback.A140id | observed in build: 087-SCH rollback.F1b, persisted as finding WP1-RB-1; reproduced in the WP-1 confirm-first sweep (suspect WP1-RB-1) | 1 |
| WP1.T2.* (A110 = 20: M900 EF 91 / 2026-05-12, A140 TF 47, A300 TF 20, floats unchanged, 12 critical, 14 ids; restored M900 EF 81 / 2026-04-28) | asserted in build: 087-SCH cpm.T2 (before the baseline and the tail) | 1 |
| WP1.baseline.unallocated.refusal (names BOQ allocations) / unallocatedAmount 72,000.00 / allocatedAmount 387,000.00; inScopePriced 459,000.00 | asserted in build: 087-SCH baseline.unallocated; inScopePriced at boq.upload | 1 |
| WP1.baseline.covered.* (S-006 to A220, locked 14, equalsEarly, totalAllocated 459,000.00) | asserted in build: 087-SCH baseline | 1 |
| WP1.baseline.zeroRated / allOutOfScope | WP proof on fresh records: the WP-1 proof on 087-IMP (scratch), R1-16 | 1 |
| WP1.baseline.handBuilt (HR-S8) | WP proof on fresh records: needs a hand-built programme with a fully allocated BOQ and no revision, a state 087-SCH never passes through (its BOQ comes after F1) | 1 |
| WP1.tail.* (T900 ES 81, EF 281, 2027-02-02, TF 0; M900 TF 0, A140 TF 247, A300 TF 220, 13 critical, no baseline) | asserted in build: 087-SCH tail (after the CPM and baseline checks) | 1 |
| §3.2 assignment rule (site engineer on every activity except A330) | asserted in build: 087-SCH programme.assignments (hand-built) and assignments (closing step, live verify on resume) | 1 |
| WP2.setup.allocations / A310planned 900 / A320planned 600 / methods (A210 20/30/50, A230 inspection) | asserted in build: 087-SCH boq.allocations, progress.methods | 1 |
| WP2.T4.openList / holdState (A130 form ITP hold point pending) | asserted in build: 087-SCH itp (WP-2 T4 starts from it) | 1 |
| WP2.quantitiesA310.barePercent (400 QUANTITY_NO_ENTRIES_TO_BUNDLE) | asserted in build: 087-SCH qty.barePercent (before any entry) | 1 |
| WP2.quantitiesA310.typed450.pct / entriesCreated / evA310 67,500.00 | asserted in build: 087-SCH qty.typed450 | 1 |
| WP2.quantitiesA310.bundle90.installed 540 / pct 60 / evA310 81,000.00 | asserted in build: 087-SCH qty.bundle90 | 1 |
| WP2.quantitiesA310.replay (replayed true, same id, created 0) | asserted in build: 087-SCH qty.replay | 1 |
| WP2.quantitiesA310.dailyLog.entries 1 / installed 570 / pct 63.333 / evA310 85,500.00 | asserted in build: 087-SCH qty.dailylog, qty.dailylog570 | 1 |
| WP2.quantitiesA310.rejectedState | asserted in build: 087-SCH qty.rejected10 | 1 |
| WP2.quantitiesA310.typedZero (400 QUANTITY_INVALID) | WP proof on fresh records (WP-2). With entries present the typed-again 409 answers first (progress.service.js:1609-1611), so 087-SCH cannot serve it after the build | 1 |
| WP2.setup.evBefore 0; WP2.T1/T3/T4 project EV 24,000 / 39,000 / 61,500; dailyReport.projectEv; quantitiesA310.*.projectEv | WP proof on fresh records (WP-2): 087-SCH enters WP-2 with A310 approved at 570 m2, EV 85,500.00 (adjudication item 1) | 1 |
| WP2.quantityView.* (installed 570, committed 900, received 1,000, issued 550, certified 500, paid 250, certified>installed false) | asserted in build: 087-SCH quantities.S-003 | 1 |
| WP2.importProgress.site.A310row (dry run, PROGRESS_METHOD_MISMATCH) | asserted in build: 087-SCH progress.file. The import itself (pm, after WP-2 T1) is the WP-2 proof's, with the saved file state\cert3\files\087-SCH\CERT3-087-SCH-progress.xer | 1 |
| WP1.T3.file.stagedLate / stagedCriticalCount | asserted in build: 087-IMP import.F3 | 1 |
| WP1.T3.A.ES/EF, WP1.T3.B.* | asserted in build: 087-IMP activate.F3 | 1 |
| WP1.T3.A.LS/LF/TF, WP1.T3.criticalCount (HR-S1) | observed in build: 087-IMP activate.F3, finding HR-S1. The end state persists, so the WP-1 T3 proof judges it live on 087-IMP | 1 |
| WP1.T4.FSlead / FF / SF | WP proof on fresh records: live in the WP-1 proof on 087-IMP (scratch), R1-13 | 1 |
| WP1.imports.twoProjectXer (HR-S4) | asserted in build (HEAD: draft, 17 merged): 087-IMP import.F4, finding HR-S4; judged by the WP-1 proof | 1 |
| WP1.parity.p6xml / xlsx (identical to F1) | asserted in build: 087-IMP import.F1.p6xml, import.F1.xlsx (F1 MSPDI also asserted identical) | 1 |
| WP1.parity.mspdiDurations / mspdiLags / mspNegativeSlackDays | asserted in build: 087-IMP import.F2.mspdi | 1 |
| WP1.parity.mspNegativeSlackCritical (HR-S3) | observed in build: 087-IMP import.F2.mspdi, finding HR-S3 | 1 |
| WP1.revisions.hrS3Reproduction.file | asserted in build: 087-IMP import.F1float5 (left as the open draft) | 1 |
| WP1.revisions.hrS3Reproduction.approve | WP proof: the WP-1 proof submits and approves the F1float5 draft on 087-IMP | 1 |
| WP1.revisions.secondImport.openDraft / activeRevision | asserted in build: 087-IMP revisions.read (8 superseded, F1float5 draft, F3 the one active) | 1 |
| build choices (adjudication 087-SCH items 3, 4) | 087-SCH:<br>- contractValue 459,000.00<br>- explicit defaultRetentionRate 10 (HR-C1 configuration)<br>- end 2027-06-30<br>- subcontract 130/m2<br>- stock unit cost 20<br>- IPC period = run month (2026-10)<br>- payment 0.5 of net (33,750.00)<br>- daily log on run date -4<br>- A330 held by the planner<br>- hand-built activities and T900 keep the answer-book names<br>- numeric MSPDI UIDs in 087-IMP, rows found by name, names asserted unique<br>- validation-driven: warehouse code 087SCH-<first 8 of project id> and SKU CERT3-087-SCH-BLK200-<same>, because both are organisation-unique; stable across resumes | 1 |

## 087-SCH, 087-IMP, 087-EV (round 2)

| Check (answer-book key or rule) | Where the evidence is | Round |
|---|---|---|
| WP3.periods.afterLock.runDateAfterCost.<revisionKept\|revisionDeleted>.{bac,pv,ev,ac,spi,spiAlert,cpi,cpiAlert,eac,eacBasis,sv,cv,etc} (new book leaves, R2-B4) | asserted in build: 087-EV step checkpoint.afterLock.afterCost (its 'today' read, right after cost.backdated). Its verdict is in verdict.checkpoint.afterLock.afterCost. The branch follows probe.T5.delete; at HEAD it is revisionDeleted (L112). | 2 |
| WP3.periods.afterLock.runDateAfterApproval.<revisionKept\|revisionDeleted>.{same 13 leaves} (new book leaves, R2-B4) | asserted in build: 087-EV step checkpoint.afterLock.afterApproval (its 'today' read, right after progress.afterLock A120 60%). Its verdict is in verdict.checkpoint.afterLock.afterApproval. The L34 block there comes from the period and 2026-02-28 reads only. | 2 |
| WP1.T3.A.LS/LF/TF + WP1.T3.criticalCount (now strict: value or today, R2-F) | asserted in build: 087-IMP step activate.F3 (place unchanged). The verdict is stored in out.hrS1, and the HR-S1 finding is made only on the today match. | 2 |
| WP3.T5.deleteProbe ('refused_or_audited'; today: silent delete, L112) | asserted in build: 087-EV step probe.T5.delete, between checkpoint.T5 and checkpoint.T7.before (place unchanged; now judged per the book, R2-F). | 2 |
| 087-EV checkpoint.afterLock.afterCost and .afterApproval, read cutoff0228 (GET /reports/ev?cutoffDate=2026-02-28 after the back-dated cost): expected figures | answers/schedule.js WP3.periods.afterLock.cutoffAfterCost.{bac,pv,ev,ac,spi,spiAlert,cpi,cpiAlert,eac,eacBasis,sv,cv,etc} (was computed in 087-ev.js derivedMetrics); asserted by 087-ev.js cutoffAfterCost() -> metricsFrom('periods.afterLock.cutoffAfterCost'); verdict steps cite these leaves (L34 today on ac/cv/etc) | 3 |
| 087-EV checkpoint.T6.before (run-date read after the A140 cost): expected figures | answers/schedule.js WP3.T6.before.<revisionKept\|revisionDeleted>.{13 metrics} (was computed in 087-ev.js); asserted by 087-ev.js t6State('before') -> metricsFrom('T6.before.<probeBranch>') | 3 |
| 087-EV checkpoint.T6.after (run-date read after the retiring revision): expected figures incl. cpi | answers/schedule.js WP3.T6.after.<revisionKept\|revisionDeleted>.{13 metrics} (cpi equals WP3.T6.cpiAfterRetirement, ac equals WP3.T6.acAfterRetirement, both checked at load); asserted by 087-ev.js t6State('after') with ref HR-S9; verdict.checkpoint.T6.after cites WP3.T6.after.<branch>.{ac,cpi,eac,cv,etc} | 3 |
| 087-EXTRAS: each consultant party (087-EXC, 087-HLT) holds exactly one active member, the guest | 087-extras.js partyMembers() at steps guest.access and guest.hlt (out.members records the rows read), and on resume in both steps' verify | 3 |
| 087-EXTRAS guest.hlt.member adoption (interrupted POST .../members) | 087-extras.js memberOf: the live member row (id, userId, role, status) via atMostOne, fields { id present, status 'active' } | 3 |
| lanes boq.upload adoption (052-SCH-EV, 006-LITE) | lanes.js boqEv find: GET /boq revisions row of label b.name('Bill') via atMostOne; fields accept the upload's answer or the adopted row | 3 |

## 087-EV (WP-3)

| Check (answer-book key or rule) | Where the evidence is | Round |
|---|---|---|
| WP3.setup.boq / allocations / allocatedTotal / loadings / progress / directCosts | asserted in build at creation: steps boq, allocations, loadings, progress, directCosts (fields and statuses); the live end state keeps them | 1 |
| WP3.setup.timeZone / timeZoneSource / timeZoneNote | asserted in build on every EV read (all checkpoint.* and lock.* steps) and on the period answers (periods); zone also asserted equal to the company zone | 1 |
| WP3.T1.* (BAC 387,000.00, PV, EV 97,500.00, AC 80,000.00, SPI/CPI/EAC/alerts) | asserted in build: checkpoint.T1 | 1 |
| WP3.T2.* and WP3.T2.addedCost | asserted in build: checkpoint.T2 | 1 |
| WP3.T3.* and WP3.T3.cutoff (AC per L34) | asserted in build: checkpoint.T3; verdict.checkpoint.T3 BLOCKED L34 | 1 |
| WP3.T4.* (SPI/CPI 0.9 boundaries, AC 100,001, EV 0, PV 0) | WP proof in process (WP-3) | 1 |
| WP3.T5.budgetRevision / bac / eac / etc | asserted in build: checkpoint.T5 (T2-state PV/EV/AC/SPI/CPI per WP3.T5.eac's derivation) | 1 |
| WP3.T5.deleteProbe (L112) | asserted in build: probe.T5.delete (BLOCKED L112 at HEAD; revision gone afterwards); after an L112 fix, WP proof on fresh records | 1 |
| WP3.T7 (byte_identical) | asserted in build: checkpoint.T7.before (reference hash) and checkpoint.T7.after | 1 |
| WP3.periods.futurePeriod | asserted in build: periods (rules.futurePeriodFor of the company-local run date) | 1 |
| WP3.periods.jan.cutoff / feb.cutoff | asserted in build: periods (period answers) and the period reads in lock.2026-01, checkpoint.feb.open, lock.2026-02, checkpoint.afterLock.* | 1 |
| WP3.periods.lockAsPlanner / financeWhileBlocked / financeWithOverride / feb.lockByPmWithReason | asserted in build: lock.2026-02 (needs the gate blocked; moment-bound) | 1 |
| WP3.periods.feb.snapshot (equal to the open report; AC per L34) | asserted in build: checkpoint.feb.open and lock.2026-02; verdict.checkpoint.feb.open and verdict.lock.2026-02 BLOCKED L34 | 1 |
| WP3.periods.feb.overriddenAuditEvents | WP proof on live 087-EV (audit history persists) | 1 |
| WP3.periods.jan.lock / jan.snapshot | asserted in build: lock.2026-01; verdict.lock.2026-01 BLOCKED L34 | 1 |
| WP3.periods.afterLock.periodReport / backdatedCost / cutoffReportAc / cutoffReportEv / newApproval / runDateEv | asserted in build: checkpoint.afterLock.before (hash reference), checkpoint.afterLock.afterCost, checkpoint.afterLock.afterApproval; their verdicts BLOCKED L34 | 1 |
| WP3.periods.afterLock.relockSameSnapshotId / relockSameLockedAt / loadingInLockedPeriod | WP proof on live 087-EV (locked 2026-01/2026-02) | 1 |
| WP3.periods.duplicateCode / endBeforeStart | WP proof on live 087-EV (new period codes) | 1 |
| WP3.periods.futureCutoffLock (L113 / HR-E2) | WP proof on the live future period of 087-EV; the earlier builder report says the gate is blocked again after T6 (BASELINE_NOT_LOCKED), so the PM with a reason is needed (not re-asserted by this build) | 1 |
| WP3.periods.concurrentLocks | WP proof on fresh records (a new open period) | 1 |
| WP3.periods.defaultPeriod.* | WP proof in process | 1 |
| WP3.forecast.* | WP proof in process | 1 |
| WP3.mutations.* | WP proof (WP-3 mutation runs) | 1 |
| WP3.T6.ledgerDelta / acBeforeRetirement | asserted in build: checkpoint.T6.before | 1 |
| WP3.T6.acAfterRetirement / cpiAfterRetirement (L118 -> HR-S9) | asserted in build: checkpoint.T6.after; verdict.checkpoint.T6.after BLOCKED HR-S9 | 1 |
| build choice (087-EV item 2): February locked first on the PM override while the gate is blocked; then progress methods on all 14 activities, the baseline, January normally by finance | steps lock.2026-02, gate.methods, baseline, gate.ready, lock.2026-01 | 1 |
| build choice (087-EV item 4): T6 retiring revision = F1 without A140, A110 80 h | import.F1r / activate.F1r | 1 |
| build choice (087-EV item 4): T7 = A310 30% draft, A320 20% submitted, A130 50% submitted then rejected | T7.submissions | 1 |
| build choice (087-EV item 4): site engineer on A110, A120, A130, A310, A320; direct costs coded 01-100 (A110, A140) and 02-100 (A120, A130); endDate = F1 finish 2026-04-28; no contract value | activities, costCodes, directCosts, project | 1 |
| build choice (R1-21): the T5 delete probe is sent by the PM (cost:delete + cost:approve); the cost controller would be refused by the approval-authority rule, which is not L112 | probe.T5.delete | 1 |

## 087-COM, 087-COM-B, 087-COM-C, 052-COM (WP-4, WP-5, WP-6, WP-7)

| Check (answer-book key or rule) | Where the evidence is | Round |
|---|---|---|
| WP4.I1.currentCert / certifyUnconfigured.today (items 0, retention 0, net 40,000) + refusal | asserted in build: 087-COM ipc.I1, 052-COM ipc.I1. The refusal is BLOCKED HR-C1 (not sent); IPC-01 is left a draft for the WP-4 proof | 1 |
| WP4.I1.silentContractRate | asserted in build: contract.value (087-COM, 052-COM), finding HR-C1 | 1 |
| WP4.E5 pending 40,000 / approved 125,000 / revised 2,125,000 | asserted in build: 087-COM contract.after-CO-125 (CO-40 is then the only pending/draft CO) | 1 |
| WP4.E1 romTotal, afterRfqSend, afterAccept, convertedValue, coStatus, eventStatus | asserted in build: 087-COM ce.E1; 052-COM ce.E1 / ce.E2 (deep["052-COM"].E1) | 1 |
| WP4.E1 convertAgain / patchConverted / voidConverted; WP4.E3 archivePendingDelta | WP proof on end state: 087-COM E1 is converted; CO-40 stays pending | 1 |
| WP4.E2 concurrentConverts / pendingDelta | WP proof on 052-COM ce.E2 (left priced) | 1 |
| WP4.I7 retentionCap / totalRetCapped / netCapped | asserted in build: 087-COM ipc.02 (the cap is on for IPC-02 only) | 1 |
| WP4.I7 taxAmount / netWithTax | asserted in build: 087-COM ipc.05 (tax 5 only for its certification) | 1 |
| WP4.I7 advanceRecovery / netWithAdvance (and outstanding 190,250) | asserted in build: 087-COM ipc.08 | 1 |
| WP4.I8 payOverBalance, payFull, balanceDueAfterPay, releaseOverHeld, afterReleasePaymentStatus, afterReleaseBalanceDue, afterReleaseStatus (HR-C3), paySecond, amountPaidTotal | asserted in build at each moment: 087-COM ipc.03 and 052-COM ipc.I8 | 1 |
| WP4.I8.cashInflowWithoutRebuild | WP proof on end state: 087-COM month 2026-05 / 052-COM month 2026-08 each hold only that payment | 1 |
| WP4.I6 noReason / financeWithReason / pmWithReason / overCertificationAmount; deep.087-COM.ipc04.* | asserted in build: 087-COM ipc.04 (advanceOutstandingBefore at its moment; outstanding after = before - recovery) | 1 |
| WP4-OVR-1 consequence (087-COM item 7) | observed in build: 087-COM ipc.09, finding WP4-OVR-1. WP-4 proofs that certify IPC-09 (submitted) or IPC-10 (draft) need a PM overrideReason; finance gets 403 | 1 |
| WP4.I10 materials / gross / retention / net | asserted in build: 087-COM ipc.07 | 1 |
| WP4.I3 A120/A130 limits, patchA130Qty650 | WP proof on 052-COM: A130 is never certified there. 087-COM certifies A130, so not there | 1 |
| WP4.I4 refusals | WP proof on 052-COM: IPC-01 draft, IPC-02 paid, IPC-03 submitted | 1 |
| WP4.I5 certifyOnBoqFallback / afterValueEntered | certifyOnBoqFallback asserted in build: 087-COM-C ipc.01. afterValueEntered: WP proof on 087-COM-C (IPC-01 left submitted) | 1 |
| WP4.I2 retention / net | WP proof on 087-COM-B: I1-shaped row, A110 at 40%, no IPC built | 1 |
| WP4.C1 insuranceMissing / overrideWithoutReason | asserted in build: commitment.SC-002.execute (087-COM, 052-COM) | 1 |
| WP4.C2 committedExecuted / committedCoDraftPending / committedCoApproved / committedCoRejected | asserted in build at each moment: commitment.SC-001.execute and commitment.SC-001.change-orders (087-COM; 052-COM without the rejected CO) | 1 |
| WP4.C3.projectDefault | asserted in build: 087-COM-B commitment.C3 | 1 |
| WP4.C4 sameLine (L108) | WP proof on 087-COM end state: PC-001 (line on 02-100 only) and approved PA-PC1. actualPosted gross asserted in build: payapp.PC-001 | 1 |
| WP4.P3 gross / retention / net at approval; certificationRevision 1 | asserted in build: 087-COM payapp.01, 052-COM payapp.P3 | 1 |
| WP4.P3 approvePosts / revokeMirror / reapprovePosts | WP proof reading the ledger entries, which persist (087-COM PA-01, 052-COM PA-01) | 1 |
| WP4.P3.qsRevoke | WP proof on an approved, unpaid application: 087-COM PA-03 or 052-COM PA-P4 | 1 |
| WP4.P4 payPartStatus / paidAmount / paySecond | asserted in build, in the payments' own answers: 087-COM payapp.01 and 052-COM payapp.P3 (part payment only) | 1 |
| WP4.P4 payOverNet / payOverNetPlus2 / cashOutflowWithoutRebuild | WP proof on 052-COM: PA-P4 approved with nothing paid; PA-01 has only 20,000 paid in 2026-07 | 1 |
| WP4.P6 finalCloseoutGate | asserted in build: 087-COM payapp.08-final (PA-08 left submitted) | 1 |
| WP4.CF1 months | asserted in build: 087-COM cash-flow.months | 1 |
| WP4.CF3.manualSurvivesRebuild | row asserted in build: cash-flow.manual. The rebuild is a WP proof | 1 |
| WP5.R1 bid totals / submitAfterDue / unqualifiedAward | asserted in build: 087-COM bids (finding WP5-AWD-1) | 1 |
| WP5.R4.awardPoValue | asserted in build: 087-COM po.from-award | 1 |
| WP5.O2 ordered / received / statusAfterPartial / order1000 | asserted in build: 087-COM receipts (PO-C) and 052-COM po.O2 | 1 |
| WP5.O2 forceWithReason / fullyReceivedClose | BLOCKED HR-C8 in build: po.C.close-short and po.A.close-received | 1 |
| WP5.O2 closeOutstanding / forceNoReason / receiveAfterClose | WP proof on 087-COM PO-C or 052-COM PO O2 (both partial) | 1 |
| WP5.O4 acceptedStock / rejectedQty | asserted in build: 087-COM receipts (PO-O4). The other O4 codes: WP proof on fresh records | 1 |
| WP5.O6 refCollision setup (PO-00001 on both) | asserted in build, live: 087-COM-B po.PO-00001 | 1 |
| WP5.N1 availableAfterReserve / costCodeOnly / existing 90 @ 11 = 990 | asserted in build: 087-COM inventory and reservation | 1 |
| WP5.N1 issue41 / issue40Cost / release51 | WP proof on the 087-COM cement (exact 90/50/40, no other movement) | 1 |
| WP5.N4 transfer 110 / 77 / 33 | WP proof on fresh records: the build's transfers are on O2's cement at 10.00 | 1 |
| WP5.N6 issuedQty / usage | WP proof on the 087-COM A130 plan row (60 issued from PO-A's cement) | 1 |
| WP5.D5 overInvoicedLedger / priceVarianceVerdict | WP proof (ledger and match) on SINV-OVER1/2 and SINV-VAR. Capitalisation observed in build: finding WP5-SVC-1 | 1 |
| deep.087-COM.supplierInvoiceVoidedAfterApproval approvePosts / voidMirror; WP5.D4 | WP proof reading the ledger entries, which persist (SINV-VOID, SINV-EARLY plus the membrane) | 1 |
| WP7.T2 / T3 cumulative and recommendation; deep.087-COM.ldRatePerDay | asserted in build: 087-COM eot.figures, project, and each eot.<key> | 1 |
| WP6.B1.original 410,000 | asserted in build: 087-COM budget-lines (including the 0-original 02-100/subcontract line) | 1 |
| build choices (087-COM) | contract 2,000,000; retention 10 configured after I1; cap only for IPC-02; tax only for IPC-05; advance from IPC-08; IPC-04 certified last; SC-004 split from SC-001 for C2; O2 cement on PO-C; O4 blocks on PO-O4; side movements on CEM2; late bid waits about 150 s | 1 |
| deep.087-COM.ipc09.* (status submitted, quantity 500 m2, gross 22,500.00, retention 2,250.00, advanceOutstandingBefore 189,500.00, advanceRecovery 2,250.00, deductions 1,000.00, taxAmount 0, net 17,000.00) | asserted in build: 087-COM step ipc.09, after the deduction and the submit (the outstanding is read from GET prime-contract at that moment). Previously literals computed in builder code. | 2 |
| deep.087-COM.ipc10.* (status draft, quantity 1,000 m2, gross 18,000.00, retention 1,800.00, advanceOutstandingBefore 189,500.00, advanceRecovery 1,800.00, deductions 0, taxAmount 0, net 14,400.00) | asserted in build: 087-COM step ipc.10 (draft preview, with IPC-09 submitted). Previously literals computed in builder code. | 2 |
| WP4-OVR-1 (suspect): after IPC-04's PM override, a later certificate needs a PM override with nothing claimed on A130 | observed in build: 087-COM step ipc.09, by reading GET /ipc/:period certificationReview (requiresPmOverride, overrideLineCount, overEarnedAmount, and A130's item review), persisted as finding WP4-OVR-1. The certify refusals (400 IPC_PM_OVERRIDE_REASON_REQUIRED for the PM without a reason, 403 IPC_PM_OVERRIDE_REQUIRED for finance) are no longer probed in the build. They are WP-4 confirm-first proof checks, on 087-COM IPC-09 in its proof or on fresh records. | 2 |
| deep.087-COM.boqSections (3 sections, 50/50/30) | asserted in build: 087-COM step boq, on the generated workbook. The read-back departure (no section on any row) is the persisted finding HR-C14. The read-back 50/50/30 and WP6.U5.aiJobCalls087 [50, 50, 30] go to the WP-6 proof after the HR-C14 fix; the same step asserts the read-back 50/50/30 automatically once rows carry sections. | 2 |
| deep.087-COM-C.billRows / billTotal (B-001 5,000 x 12.00 + B-006 2,000 x 8.00 = 76,000.00) | asserted in build: 087-COM-C step boq (each row's quantity, rate and amount; the total) and step contract.fallback (originalValue = billTotal on boq_fallback) | 2 |
| deep.087-COM-C.ipc01.* (quantity 5,000 m3, gross 60,000.00, retentionRate 10, retention 6,000.00, advanceRecovery 0, deductions 0, taxAmount 0, net 54,000.00) | asserted in build: 087-COM-C step ipc.01, on the draft after the claim and again on the submitted certificate left at the 409 CONTRACT_VALUE_NOT_ESTABLISHED gate | 2 |
| deep.052-COM.ipc03.* (status submitted, quantity 1,000 m3, gross 12,000.00, retentionRate 10, retention 1,200.00, advanceRecovery 0, deductions 0, taxAmount 0, net 10,800.00) | asserted in build: 052-COM step ipc.I4-submitted (place unchanged, after ipc.I8), on the draft after the claim (status draft) and again on the submitted certificate; the claim sends the book's quantity and retentionRate and asserts the item's rate on the PATCH answer. Previously literals computed in builder code (1000 x 12, x RATE / 100). Round 3. | 3 |
| deep.087-COM.contractEnd.approvedChangesValue / pendingChangesValue / revisedValue (147,000.00 / 49,500.00 / 2,147,000.00) | asserted in build: 087-COM step contract.after-cos (place unchanged: after co.RFI's approval and ce.E1's convert, before any WP-4 proof moves a CO). Previously sums computed in builder code. Round 3. | 3 |
| deep.087-COM.contractEnd.approvedChanges / pendingChanges / notCounted (the CO set: CO-125, CO-SPLIT, CO-I3, CO-RFI approved; CO-40 pending, CO-E1 draft; CO-REJ rejected and CO-ARC archived in neither) | asserted live in build: 087-COM step contract.after-cos reads the change-order register (includeArchived) and checks each listed CO by the id the build recorded (co.<key> outputs, co.RFI.changeOrderId, ce.E1.changeOrderId) in the book's status and amount, archivedAt only on CO-ARC, and that the register's approved and draft/pending rows with archivedAt null are exactly the two lists. New in round 3. | 3 |
| CO-I3's value 7,500.00 (WP4.I3.A120LimitAmount 37,500.00 - stage3:109.allocation.B-002/A120 30,000.00) | 087-COM step co.CO-I3 now takes the value from deep.087-COM.contractEnd.approvedChanges (the CO-I3 entry, derived in the book with a load check); previously subtracted in builder code at 087-com.js:1053. Round 3. | 3 |

## 087-FLD (WP-7, WP-8)

| Check (answer-book key or rule) | Where the evidence is | Round |
|---|---|---|
| WP8.timesheet.multiplierHalfCreate (plan 'one of them 0.5', served by the contract refusal) | asserted in build (worker.multiplier-half): 400 VALIDATION_ERROR, error.details field overtimeMultiplier | 1 |
| WP8.timesheet.multiplierHalfImport | asserted in build (worker.multiplier-half): 200, created/updated/skipped 0, errors [row 1, 'The overtime multiplier must be between 1 and 5'], no worker made | 1 |
| WP8.timesheet.multiplierHalf (100.00) | WP-8 proof, in process (multiplierFor + amount rule); no 0.5 worker can exist on 087-FLD | 1 |
| WP8.timesheet.reopenNet (0.00 between reopen and re-approval) | asserted in build (timesheet.2000, reopen act totalCost); reopenTwoThousand / reapprovedNet at the two approvals | 1 |
| WP8.dailyLog.promote2h / promote6h / promote10h (the promotion's echoed 0.5 / 1.0 / 1.5) | asserted in build (dailylog.D1 / D2 / D3, promotion answer); if that answer is lost to an interruption (adopted), a note is recorded and the check is the WP-8 proof's on fresh delay entries | 1 |
| WP8.dailyLog.promoteResponseVsStored (stored 0.5/1.0/1.5) | asserted in build (weather.at13.read -> weather.at13): BLOCKED HR-C11, stored 0/1/1 | 1 |
| promotion by a persona without eot:create (HR-F4 probe, contractual default) | WP proof on fresh records (WP-7: a new delay entry on 087-FLD promoted by the site engineer); the build's three promotions are by the planner (R2-16) | 1 |
| WP8.weather.belowContractualUsed / belowConsumedPct / belowWarning / belowRemaining; WP7.weather allowance20.at13.* | asserted in build (weather.at13.read -> weather.at13, before the 1.0-day delay exists): BLOCKED HR-C11, product 11 / 55% / no warning / 9 remaining | 1 |
| WP8.weather.atContractualUsed / atConsumedPct / atWarning / atRemaining; WP7.weather allowance20.at14.* | asserted in build (weather.at14.read -> weather.at14, before the non-contractual delay): BLOCKED HR-C11, product 12 / 60% / no warning / 8 remaining | 1 |
| WP-7 13->14 boundary after the HR-C11 fix | WP proof on fresh records (WP-7): the built register cannot be cut back to 13, and rows written before the fix keep their truncated values | 1 |
| WP8.weather.nonContractualAddsNothing / monthlyNonContractual | asserted in build (weather.non-contractual): contractualUsed equals the product's 14 reading (12 = 12 today), stored 10, month 2026-10 nonContractual 10 | 1 |
| WP8.dailyLog.approveFromOpen (HR-F4, recorded) | asserted in build (dailylog.D1: approved straight from open) | 1 |
| WP2.T4.probes.retroactiveTemplateEdit (HR-Q2) - the before state | asserted in build (itp.template-edit, before the edit: A110 4 pending, A120 1 failed, A140/A150/A170 released); the after-edit state is recorded as a note and stays on the end state for the WP-2 proof | 1 |
| WP8.rfi.overdueApiDueDate | asserted in build (rfi: RFI-RRB dueDate = its responseRequiredBy; RFI-ANS its own dueDate) | 1 |
| WP8.rfi.overdueStoredDueDate (stored null) | WP-8 proof, in process, read only (prisma rfi.findUnique); not observable through the API | 1 |
| WP8.timesheet rejectEditApprove intermediate state (rejected, then edited to 35 h) | asserted in build (timesheet.rejected-edited: reject act status rejected, edit regularHours 35, approve 1,750.00) | 1 |

## 087-FLD, 087-EXC, 087-HLT (round 2)

| Check (answer-book key or rule) | Where the evidence is | Round |
|---|---|---|
| WP9.health.delayedExpected (value 0, today 1) | 087-HLT step health.delayed (new, needs health.read): BLOCKED HR-K2 at the build, observed delayedActivities 1. Previously asserted as today inside health.read. The WP-9 proof still reads the card inside health.read.out.delayedWindow (2026-10-06..2026-10-25 for this build). | 2 |
| WP9.health.safetyExpected (value 75, today 70) | 087-HLT step health.safety (new, needs health.read): BLOCKED HR-K1, observed score 70, openInvestigations 2, matching the detail under rules.safetyScore. Previously asserted as today, and openInvestigations 2, inside health.read. | 2 |
| WP8.weather.nonContractualAddsNothing (value 14, today 12) | 087-FLD step weather.non-contractual.adds-nothing (new, needs weather.non-contractual): judges the product's readings from weather.at14.read and weather.non-contractual. BLOCKED HR-C11, observed 12, added 0. Previously asserted as '12 === the at-14 reading' inside weather.non-contractual. | 2 |
| 087-FLD HR-Q2 probe: hold points before the template edit | 087-FLD step itp.holds.before-edit (new; after itp.pending/failed/voided/closed/passed, before the edit). itp.template-edit keeps its out.beforeEdit (copied) and out.afterEdit, and now also asserts the edited template live (version 2, holdPointCount 3). | 2 |
| WP9.health.docControlRecords: the open RFI's dueDate (S+9) | 087-HLT steps documents and variant.documents: the create fields of HLT.rfi.open and VAR.rfi.open (new assertion beside responseRequiredBy). | 2 |
| 087-EXC run-date precondition (WP9.T3.slipMeasured placed from a weekday R) | 087-EXC top of build, before step project: b.assert(kit.isWorkingDay(R)). kit.workingDayOf also refuses a weekend date (fail closed). | 2 |

## 087-EXC and 087-HLT (WP-9)

| Check (answer-book key or rule) | Where the evidence is | Round |
|---|---|---|
| WP9.history.activationKeepsIds (true) | asserted in build: 087-EXC step schedule.R2 (all 6 R1 ids kept after the R2 activation; out.activationKeepsIds) | 1 |
| WP9.T3.slipMeasured 7 (premise: X20 baseline finish = D - 7 on the book calendar) | asserted in build: 087-EXC steps baseline and schedule.R2 (baselineFinishDate = addWorkingDays(2026-06-01, D-7)). The measured slip is checked by the WP proof on 087-EXC, evaluated as of an instant of out.runDate (Africa/Cairo) after out.approvals.latestProgressApprovedAt, or that instant injected. | 1 |
| WP9.T2c.periodUnlockedMeasured 8 (P2 cutoff R-9, unlocked) | build asserts the P1 locked / P2, P3 open statuses (step periods, plus verify). Measured 8 by the WP-9 T2c proof on 087-EXC at an instant of the build's run date (out.p2Cutoff). | 1 |
| WP9.T2c.staleMeasured 15 | WP-9 T2c proof on 087-EXC with cutoff = out.approvals.latestProgressApprovedAt + 15 d (out.approvals.staleCutoffFrom; per-activity instants in out.approvals.byActivity) | 1 |
| WP9.T2/T2b.quantityFirst 105 | asserted in build: 087-EXC controls.read (Q1 installed on X10 = 105); severity checked by the WP-9 T2 proof's first evaluation | 1 |
| WP9.T2/T2b.quantityLater* 113 / quantityWithCo* 110 | WP-9 T2 proof on 087-EXC approves the staged submission, then CO-Q (routes in controls.read.out.staged); build asserts both staged (quantity and change-orders verifies) | 1 |
| WP9.T2/T2b.methodSwitch (not_comparable) | WP-9 T2b proof on an activity with no approved progress, or in process (adjudication item 3; HR-P2 undecided) | 1 |
| WP9.T2/T2b.committedOverBudget* (premise 10,500 vs 10,000) | asserted in build: 087-EXC steps commitment and controls.read (L1 committed/revised); severity by the WP-9 T2 proof | 1 |
| WP9.T2/T2b.forecastOverRevised* (premise 23,000 vs 20,000) | asserted in build: 087-EXC steps budget and controls.read (L2 forecast/revised/manual); severity by the WP-9 T2 proof | 1 |
| WP9.T2/T2b.certifiedOverEarned* (premise 500.00 over-certified on a PM override) | asserted in build: 087-EXC step ipc (IPC-2 overCertificationAmount 500) | 1 |
| WP9.T2/T2b.duplicateCo* / orphanLinkRows (premises) | asserted in build: 087-EXC steps change-orders (two approved, same description) and budget-revision (VO-999); the rows by the WP-9 T2 proof | 1 |
| WP9.handling.raise / raiseAgain / voidReleases / concurrentConverts (plan §3.2 'change events raised from an exception, voided and converted') | WP-9 handling proof on 087-EXC, on fresh exception rows after T2's first evaluation (adjudication item 1) | 1 |
| WP9.T2/T2b.secondRunOpens 0, WP9.notices.* | WP-9 T2/notices proofs on 087-EXC (the build runs no evaluation) | 1 |
| WP9.risk.activitySummary {count 3, open 1, monitoring 1, submitted 1, overdue 1} | asserted in build: 087-EXC controls.read (X40 projectRiskSummary; out.x40RiskSummary) | 1 |
| WP9.risk.mix (one risk per state) | asserted in build: 087-EXC step risks (plus verify) | 1 |
| WP9.health.pvAtCutoff / acAtCutoff / evAtCutoff (0) / cutoffInstant | asserted in build: 087-HLT step ev.check (?cutoffDate=2026-08-31; out.atCutoff) | 1 |
| WP9.health.cardBasis / pv,ev,acOnCardBasis / spi / cpi | asserted in build: 087-HLT step ev.check (no reporting period, default report; out.cardBasis) | 1 |
| WP9.health.delayedExpected 0 (today 1) and delayedExampleDates | build asserts the H50 dates from rules.delayedExampleDatesFor (activities) and today's 1 (health.read). The expected 0 is checked by the WP-9 health proof, reading the card on a date in health.read.out.delayedWindow (2026-10-06..2026-10-25 for this run). | 1 |
| WP9.health.docControlCard 80 / docControlIfcVariant 75 | asserted in build: 087-HLT health.read | 1 |
| WP9.health.docControlExpected 80 (rule basis), safetyExpected 75, qualityByRule 42, commercialWorkspace 94, supplyChainWorkspace 88, workspaceScheduleWithOverdueRisk 55 | WP-9 health proof on 087-HLT's end state. The build asserts the card's HEAD figures (schedule 60, cost 80, commercial 91, quality 57, safety 70, doc 80, supply 75). | 1 |
| WP9.health.partyGuestTopRisks | WP-9 health proof after 087-EXTRAS (oth group, item 9) adds the party guest to 087-HLT | 1 |

## 087-OTH, 087-EXTRAS, 052-SCH-EV, 052-FLD, 006-LITE

| Check (answer-book key or rule) | Where the evidence is | Round |
|---|---|---|
| WP2.T1.officialAfterSubmit (0) and WP2.T1.evReportAfterSubmit (byte_identical) on 052 | asserted in build: 052-SCH-EV wp2.T1.before (reference hash) + wp2.T1 beforeApprove | 1 |
| WP2.T1.siteApprove 403 FORBIDDEN on 052 | asserted in build: 052-SCH-EV wp2.T1 (record wp2.T1.site-approve) | 1 |
| WP2.T1.qsApprove / D2.WP2.T1ev 24,000.00 | asserted in build: 052-SCH-EV wp2.T1, wp2.T1.ev | 1 |
| WP2.T1.approveAgain (200, progressRows 1) and WP2.T1.rejectApproved 400 APPROVED_PROGRESS_LOCKED | asserted in build: 052-SCH-EV wp2.T1 afterApprove | 1 |
| WP2.T3.submittedNoEvidence / rowsWritten 0 / draft 200 / approveDraft 400 | asserted in build: 052-SCH-EV wp2.T3.gates | 1 |
| D2.WP2.T3ev 39,000.00 | asserted in build: 052-SCH-EV wp2.T3.ev | 1 |
| WP2.T4.approve 409, holdPoints 1, holdState pending, openList 1, evUnchanged 39,000.00 | asserted in build: 052-SCH-EV itp + wp2.T4.pending | 1 |
| WP2.T4.failed.approve 409 / failed.state failed | asserted in build: 052-SCH-EV wp2.T4.failed | 1 |
| WP2.T4.reopenedPassed.approve 200 / D2.WP2.T4ev 61,500.00 | asserted in build: 052-SCH-EV wp2.T4.passed + wp2.T4 | 1 |
| D2.WP3.T1.ev at A110 = 100 (97,500.00) | asserted in build: 052-SCH-EV a110.100.ev | 1 |
| D2.WP3.T1 every leaf + BAC + D2.WP3.timeZone/timeZoneSource/timeZoneNote | asserted in build: 052-SCH-EV wp3.T1 (gone once A310 quantities are approved) | 1 |
| D2.WP3.T2 (ac, cpi, cpiAlert, eac) | asserted in build: 052-SCH-EV wp3.T2 | 1 |
| D2.WP3.T3 (pv, ev, cutoff; ac 70,000 after L34) | asserted in build: 052-SCH-EV wp3.T3 (pv, ev, cutoff; AC BLOCKED L34). The WP-3 proof reads build-052-SCH-EV.json and re-reads the live end state after the L34 fix (later records add no cost before the cutoff). | 1 |
| WP2.quantitiesA310.typedZero 400 QUANTITY_INVALID / typed450 (pct 50, entriesCreated 1, D2.WP2.quantityT2evA310 67,500) / typedAgain 409 | asserted in build: 052-SCH-EV wp2.qty.T2 | 1 |
| WP2.quantitiesA310.bundle90 (installed 540, pct 60, D2.WP2.quantityT3evA310 81,000) | asserted in build: 052-SCH-EV wp2.qty.T3 | 1 |
| WP2.quantitiesA310.refusalsLeaveEv / barePercent / percentMethod / entryRefusals / replay / dailyLog, WP2.T2, T4 void and probes, T5-T7 on 052 | WP proof on fresh records: WP-2 proof (087-SCH, or fresh 052 activities); not a 052 core gate the plan builds | 1 |
| WP3.T4 on 052 (D2.WP3.T4) | WP proof: WP-3, in process (nothing to build) | 1 |
| WP8.dailyLog.promote2h / 6h / 10h echo (0.5 / 1.0 / 1.5) on 052 | asserted in build: 052-FLD dailylog.D1..D3. If a promotion answer is adopted after an interruption: WP-8 proof on a fresh entry (noted by the build) | 1 |
| "052-FLD".weatherBelowPct 65 at 13 days (before the 14th delay exists) | asserted in build: 052-FLD weather.at13 (BLOCKED HR-C11 with the observed answer) | 1 |
| "052-FLD".weatherAtPct 70 / weatherAtWarning at 14 days | asserted in build: 052-FLD weather.at14 (BLOCKED HR-C11) | 1 |
| WP8.weather non-contractual adds nothing | asserted in build: 052-FLD weather.non-contractual | 1 |
| "052-FLD".qualityScore 21 and "052-FLD".labour 650.00 | asserted in build: 052-FLD quality.score, timesheet.mixed | 1 |
| "052-FLD".safetyHealth 75 | asserted in build: 052-FLD safety.score (BLOCKED HR-K1: today 70, archived near miss counted open) | 1 |
| D3.WP3.T1 every leaf + D3.WP3 zone (Asia/Dubai, 'project', null) | asserted in build: 006-LITE ev.T1 | 1 |
| deep.006-LITE.retentionDefaultCase (unconfigured retention, before configuration) | asserted in build: 006-LITE retention.unconfigured (BLOCKED HR-C1 with the observed project, contract and IPC rates) | 1 |
| deep.006-LITE.ipcAfterConfiguration (gross 97,500, retention 9,750, net 87,750, paid) | asserted in build: 006-LITE ipc.certify, ipc.invoice, ipc.payment | 1 |
| WP9.export.sheetGate (cost:export without risk:read: 200, no risk sheet) | asserted in build: 087-EXTRAS export.sheet-gate (BLOCKED HR-K7: 200 with all 6 sheets) | 1 |
| WP9.health.partyGuestTopRisks | WP proof: WP-9 health reads 087-HLT's card as the guest the build puts on the 087-HLT consultant party (087-EXTRAS guest.hlt) | 1 |
| WP9.workflowNotifications.commercialOptOut, WP9.reportBuilder.* | WP proof: WP-9 (records built by 087-EXTRAS opt-out and reports) | 1 |
| WP9.workflowNotifications.otherProjectStaff 0 (headcount 5) | Headcount and only-here asserted in build: 087-OTH staff.only-here. The notifications: WP-9 proof on a fresh commitment.executed on 087-COM. | 1 |
| WP8.weather.below* + WP8['052-FLD'].weatherBelowPct (052-FLD at 13 contractual days) | Asserted in build 052-FLD. The product's GET /weather-delays reading is kept in step weather.at13.read, before the 14th delay exists. It is judged in step weather.at13: BLOCKED HR-C11, known answer COMPOSITION.today / WP8.weather.todayBelow (11, 55%, no warning). | 2 |
| WP8.weather.at* + WP8['052-FLD'].weatherAtPct / weatherAtWarning (052-FLD at 14) | Asserted in build 052-FLD. The reading is in step weather.at14.read, which needs weather.at13.read and weather.manual.14. It is judged in step weather.at14: BLOCKED HR-C11, known answer COMPOSITION.today / WP8.weather.todayAt (12, 60%, no warning). | 2 |
| WP8.weather.nonContractualAddsNothing (052-FLD) | Asserted in build 052-FLD. The reading is in step weather.non-contractual.read, after weather.at14.read. It is judged in step weather.non-contractual against value 14 / today 12, together with the at-14 reading: BLOCKED HR-C11. | 2 |
| WP8.dailyLog.promote2h/6h/10h echo (052-FLD) | Asserted in build 052-FLD steps dailylog.D1-D3, with the promotions now made by the planner (eot:create). If a promotion is adopted after an interruption, its echo goes to the WP-8 proof on fresh records (a note is persisted). | 2 |
| HR-F4 site-engineer weather promotion (052-FLD) | WP-7 proof probe on fresh records. The 052-FLD build no longer promotes as the site engineer. | 2 |
| WP9.export.sheetGate (087-EXTRAS member with cost:export, denied risk:read) | Asserted in build 087-EXTRAS step export.sheet-gate against the leaf. The value check ('200' and no sheet named Risks) gives DONE. Exactly the leaf's today gives BLOCKED HR-K7. | 2 |

## Answer-book leaves added in round 2

| Check (answer-book key or rule) | Where the evidence is | Round |
|---|---|---|
| WP3.periods.afterLock.runDateAfterCost.{revisionKept\|revisionDeleted}.* | asserted in build: 087-EV step checkpoint.afterLock.afterCost (today read), branch chosen by the probe.T5.delete outcome | 2 |
| WP3.periods.afterLock.runDateAfterApproval.{revisionKept\|revisionDeleted}.* | asserted in build: 087-EV step checkpoint.afterLock.afterApproval (today read) | 2 |
| deep.087-COM.ipc09.* | asserted in build: 087-COM step ipc.09 (submitted, after the deduction) | 2 |
| deep.087-COM.ipc10.* | asserted in build: 087-COM step ipc.10 (draft preview) | 2 |
| deep.087-COM-C.billTotal / billRows | asserted in build: 087-COM-C step boq (and contract.fallback originalValue) | 2 |
| deep.087-COM-C.ipc01.* | asserted in build: 087-COM-C step ipc.01 (draft, then left submitted at the certify gate) | 2 |
| WP9.export.sheetGate (value; today = HR-K7 known answer) | asserted in build: 087-EXTRAS step export.sheet-gate (BLOCKED HR-K7 while today holds) | 2 |
| WP8.weather.nonContractualAddsNothing (value 14; today 12 = HR-C11 known answer) | asserted in build: 087-FLD and 052-FLD steps weather.non-contractual | 2 |

## Deviations recorded by the work packages

- **WP-1** (run plan `WP1-RUN-PLAN.md` §5.2, integration owner 2026-10-10): the WP-1 proof runs the T4 networks, the zero-rated and all-out-of-scope baseline refusals, the two-project XER (F4), T2, both start-date probes and both calendar probes on its own throwaway projects W and X in 087, not on 087-IMP or 087-SCH (the rows for WP1.T4.*, WP1.baseline.zeroRated / allOutOfScope and WP1.imports.twoProjectXer above). Fresh records either way; the deep projects keep their end state for re-runs. The proof's only write on a deep project is the F1float5 submit and approval on 087-IMP.
- **WP-2** (WP-2 adjudication Q1, integration owner 2026-10-10): the live progress import runs on the WP-2 proof's own throwaway project P after T1 (A110 at 40, the book's +18,000.00), with the generated progress XER proven byte-identical (sha256) to the file 087-SCH saved; 087-SCH keeps only its stored dry run (the WP2.importProgress row above). Every WP-2 write is on P; on the deep projects the proof only reads (one replay POST on 087-SCH is sent only when exactly the build's own entry carries its clientRequestId, so it cannot write).
- **WP-3** (WP-3 adjudication Q1, integration owner 2026-10-10): T4, the live T7, the lock-rule catchers, the L34 lock, L113 (future cutoff), the concurrent locks, L106, L112 and the actor-role reproduction run on the WP-3 proof's own throwaway project V in 087, not on 087-EV (the rows for WP3.T4, WP3.periods.futureCutoffLock / concurrentLocks and the related keys above): a lock on 087-EV's future period is one-shot and would add a second override audit event. On live 087-EV the proof sends only probes that HEAD refuses before any write. Stored or frozen L34 figures recorded before the L34 fix are judged STORED-PRE-FIX (adjudication Q3) and strictly at the exit rebuild.
- **WP-4** (WP-4 adjudication Q1, Q6, Q7 and Q11, integration owner 2026-10-10): every writing check and every §6.2 catcher runs on the WP-4 proof's own throwaway project K in 087, created without a retention default or contract value and archived at the end. That moves I1's refusal and its configuration, E3's archive of a pending CO (K-CO-40, not 087-COM's CO-40), the E2 convert race and E1.convertAgain (on K-E2, not 087-COM's E1: M-CONV0 would convert that a second time), I3's PATCH, P4's payment probes and P7's reject-and-reopen (087-COM PA-05 cannot reopen while PA-07 is open) off the deep projects (the rows for WP4.I1, WP4.E1.convertAgain, WP4.E2, WP4.E3, WP4.I3, WP4.P4 and WP4.P7 above). I2 is certified on a second throwaway K2 (project 7.5%, contract 10%), not on a draft left on 087-COM-B (the WP4.I2 row). 052-COM's E2 stays unused; its priced state is the build's evidence. On the deep projects the proof only reads or sends requests refused before any write, with three exceptions: 087-COM-C's one-shot I5 confirmation and certification (a later run judges the certified record and the contract.manage audit event), and one idempotent cash-flow rebuild of 087-COM by the cost controller. Stored HR-C1 moments recorded before the HR-C1 fix are judged STORED-PRE-FIX and strictly at the exit rebuild (adjudication Q4).

225 entries.
