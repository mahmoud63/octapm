# Answer book and F3 generator: changes for the WP-0 builders' adjudication (2026-10-09)

Binding source: `C:\Temp\octapm-cert\scratch\wp0\builders-adjudication.md` (cited below as BADJ).
Rule A10 applies: every value below changed only with the on-paper derivation written next to it in
the book (the leaf's `derivation`). Product citations keep the books' `@886c9f1` tag; every product
file cited by a new entry is unchanged at `f599e67`, except `schedule.service.js` (critical_path
readiness `:849-866 @886c9f1` is `:855-872 @f599e67`, same code). Plan lines in new entries are
numbered at `f599e67` (`PF(...)`, suffix `@f599e67`).

Figure counts: schedule 706 -> 736, field-controls 268 -> 279, commercial 580 -> 590. No key was
removed. Money is integer cents.

## 1. F3 file as P6 exports it (BADJ 087-SCH/087-IMP item 5; R1-2)

Derivation: the network is A 80 h (10 d), SS + 16 h (2 d), B 24 h (3 d); project finish = EF(A) = 10.
P6's late pass ends a path with no finish successor at the project finish, so A's backward candidate
LS(B) 7 - 2 + 10 = 15 is capped at 10 = EF(A): A LS 0, LF 10, TF 0 (0 h). B (no successor): LF 10,
LS 7, TF 5 (40 h). The early pass and the link are the same capped or not. The product's own CPM after
activation is unchanged as the HR-S1 observation: `WP1.T3.A.*` (value = HR-S1 recommendation A TF 0,
`today` A TF 5, LF 15) and `WP1.T3.criticalCount` are NOT changed.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP1.T3.file.durationHours` | none (files.F3 wrote the same hours) | `{A: 80, B: 24}` hours |
| `WP1.T3.file.link` | none | `{pred: A, succ: B, type: SS, lagHours: 16}` |
| `WP1.T3.file.projectFinish` / `projectFinishDate` | none | `10` / `2026-01-19` |
| `WP1.T3.file.A.ES` / `EF` | none | `0` / `10` |
| `WP1.T3.file.A.LS` / `LF` | none (file wrote LS 5, LF 15) | `0` / `10` |
| `WP1.T3.file.A.totalFloatHours` | none (file wrote 40 h) | `0` |
| `WP1.T3.file.A.earlyStartDate` / `earlyFinishDate` | none | `2026-01-05` / `2026-01-19` |
| `WP1.T3.file.A.lateStartDate` / `lateFinishDate` | none (file wrote 2026-01-12 / 2026-01-26) | `2026-01-05` / `2026-01-19` |
| `WP1.T3.file.B.ES` / `EF` / `LS` / `LF` | none | `2` / `5` / `7` / `10` |
| `WP1.T3.file.B.totalFloatHours` | none (file wrote 40 h) | `40` |
| `WP1.T3.file.B.earlyStartDate` / `earlyFinishDate` / `lateStartDate` / `lateFinishDate` | none | `2026-01-07` / `2026-01-12` / `2026-01-14` / `2026-01-19` |
| `WP1.T3.file.stagedCriticalCount` | none | `1` (A: round(0 h / 8) = 0 -> critical; import.service.js:253) |
| `WP1.T3.file.stagedLate` | none | `{A: {lateStart 0, lateFinish 10, totalFloat 0}, B: {7, 10, 5}}` |
| `inputs.F3file` (data, not a leaf) | none | the same figures; read by `build/files.js` `F3()` |

`build/files.js`: `programme()` takes `capLf` (passed to the book's `rules.cpm`); `F3()` builds with
`capLf: inputs.F3file.capLf` and refuses to load if any figure differs from `inputs.F3file`;
`selfCheck()` adds `F3 as P6 exports it (answers WP1.T3.file)`, which reads the XER, P6 XML and MSPDI
back with the product's parsers and compares them with the book (raw `total_float_hr_cnt` 0 / 40,
float days 0 / 5, early and late dates, the SS +2 link, staged critical `["A"]`, TotalFloat hours,
TotalSlack tenths). selfCheck: 24 checks, 0 failed. Teeth: with the cap off `F3()` refuses
(`A LS 5, the answer book says 0`); the old uncapped file read back differs from the book
(`A total_float_hr_cnt 40 vs 0`, `late_end_date 2026-01-26 vs 2026-01-19`).
For the builder: `087-imp.js` `f3AsP6` is to be removed and `files.F3()` staged as is.

## 2. Reporting zone (BADJ 087-EV item 5; 087-OTH/052/006 item 2; R1-15; R3-2; R3-8)

Derivation: `createProject` copies the workspace `defaultTimezone` onto `Project.timezone` when the
creator names none (ENT-6, project.service.js:441-459) and the project API has no timezone field, so a
build-created project holds the company zone; `resolveReportingTimeZone` labels a valid project zone
`'project'` (reporting-cutoff.js:23-27, 145-149) and the EV report and period answers carry it as
`reporting.timeZoneSource` (earned-value.service.js:966-978, 1065); `timeZoneNote` is null for the
`'project'` source (reporting-cutoff.js:201-202). A proof asserts both source `'project'` AND zone =
company zone, through the API. Plan premise A8 (:1213) is wrong for the label (kept as `planValue`);
the zone-change question is suspect WP3-TZ-1 (the creation comment, project.service.js:443-444, says an
existing project is never rewritten).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP3.setup.timeZone` | `Africa/Cairo` ("organisation zone") | `Africa/Cairo` (value unchanged; derivation rewritten) |
| `WP3.setup.timeZoneSource` | `organisation` | `project` (planValue `organisation`) |
| `WP3.setup.timeZoneNote` | none | `null` |
| `D2.WP3.timeZone` | `America/Chicago` | `America/Chicago` (value unchanged; derivation rewritten) |
| `D2.WP3.timeZoneSource` | `organisation` | `project` (planValue `organisation`) |
| `D2.WP3.timeZoneNote` | none | `null` |
| `D3.WP3.timeZone` | none (D3 carried no zone) | `Asia/Dubai` (company 006, plan :375-378) |
| `D3.WP3.timeZoneSource` | none | `project` (planValue `organisation`) |
| `D3.WP3.timeZoneNote` | none | `null` |

## 3. 087-EV future period from the run date (BADJ 087-EV item 6)

Derivation: the month after the run month (December rolls into January), start its 1st, end and cutoff
its last day; the cutoff is >= run date + 28 days, so it is never reached on the run date in any zone.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP3.periods.futurePeriod` | none (fixed `2026-11` inside `inputs.ev087.periods`) | `rules.futurePeriodFor(RUN)` = `{code 2026-11, 2026-11-01..2026-11-30, cutoff 2026-11-30}` |
| `inputs.ev087.periods` (data) | fixed list ending `2026-11` | `ev087PeriodsFor("2026-10-09")`: identical for the reference run date |
| `rules.futurePeriodFor(runDate)`, `rules.ev087PeriodsFor(runDate)` | none | new functions (the builder calls `ev087PeriodsFor(b.today)`) |

## 4. IPC-04 certified last (BADJ 087-COM/-B/-C, 052-COM item 3; R2-2)

Derivation (commercial.js, from the book's own keys): A130 this period = `WP4.I6.claimed` 200 m3 - the
150 m3 IPC-03 certified inside `WP4.I8`'s gross (22,500.00 = `WP4.I6.earnedCap`) = 50 m3; gross
50 x 150.00 = 7,500.00 = `WP4.I6.overCertificationAmount`; retention 10% (`deep.087-COM.contractRetentionRate`;
no cap, `retentionCapRate` only on IPC-02) = 750.00; advance outstanding = `deep.087-COM.advance`
200,000.00 - IPC-08's `WP4.I7.advanceRecovery` 9,750.00 = 190,250.00; recovery = min(190,250.00,
`deep.087-COM.advanceRecoveryRate` 10% x 7,500.00) = 750.00; deductions 0; tax 0 (rate back to 0 after
IPC-05, C7). certificateFinancials (prime-contract.service.js:649-692): 7,500.00 - 750.00 - 750.00 - 0
= 6,000.00 + 0 = **6,000.00**, as the builder observed. Conditions recorded in the notes: WP4-OVR-1 and
WP4-DRAFTS-1 persisted as findings.

| Key (commercial.js) | Old | New |
|---|---|---|
| `deep.087-COM.ipc04.order` | none | `{certifies: last, after IPC-08; override: PM with a reason; recoveredBefore [IPC-08]; notCertifiedBefore [IPC-09, IPC-10]}` |
| `deep.087-COM.ipc04.quantity` | none | `50` m3 |
| `deep.087-COM.ipc04.gross` | none | `750000` |
| `deep.087-COM.ipc04.overCertificationAmount` | none | `750000` |
| `deep.087-COM.ipc04.retention` | none | `75000` |
| `deep.087-COM.ipc04.advanceOutstandingBefore` | none | `19025000` |
| `deep.087-COM.ipc04.advanceRecovery` | none | `75000` |
| `deep.087-COM.ipc04.deductions` | none | `0` |
| `deep.087-COM.ipc04.taxAmount` | none | `0` |
| `deep.087-COM.ipc04.net` | none | `600000` |

## 5. 087-FLD wording (BADJ 087-FLD item 6)

| Key (field-controls.js) | Old | New | Derivation |
|---|---|---|---|
| `WP8.transmittal.meetingChangeEventReadBack` | `{origin meeting, meetingActionItemId, title, activityId, type other, romAmount 0, scheduleImpactDays 0}` | `{origin meeting, sourceRecordType 'meeting_action', sourceRecordId <item id>, sourceLinks [{type 'meeting_action', id <item id>}], title, activityId, type other, romAmount 0, scheduleImpactDays 0}` | the serializer `eventOut` exposes the typed link only as the pair and `sourceLinks` (change-event.service.js:72-77, 88-92, 191-216, 379); the `meetingActionItemId` column is not exposed |
| `WP8.rfi.overdueRecords` | text unchanged | text unchanged; derivation rewritten | "dueDate null" is a stored-row fact: the API presents `dueDate = dueDateForRecord(row) = dueDate \|\| responseRequiredBy \|\| ...` (workflow-support.service.js:840-845, 955, 1103-1107; rfi.service.js:317, 476, 717) |
| `WP8.rfi.overdueApiDueDate` | none | `{RFI-RRB: its responseRequiredBy, RFI-ANS: its dueDate}` | as above |
| `WP8.rfi.overdueStoredDueDate` | none | `{RFI-RRB: null, RFI-ANS: its past dueDate}` | read in process, read only; the column health.js reads (:174, :462-465) |

## 6. 087-HLT delayed activity, run-date rule (BADJ 087-EXC/HLT item 7; R3-10)

The book's former window inequality (start + 50 <= run date < start + 70) agrees with the plan's window
(:431); its fixed start 2026-08-10 came from no stated selection rule (it is run date - 60, the window's
midpoint) and left the WP-9 proof only until 2026-10-18. Settled on paper: "today" is the WP-9 proof's
read, after the build, so start = the Monday on or before (run date - 51), the latest Monday whose
calendar finish is already past on the run date in every zone; the window (calendar finish <= today <=
working finish - 1) then lasts 13 to 19 days from the run date, and start <= the cutoff 2026-08-31 for
run dates through 2026-10-27 (the book checks the rule for every run date 2026-10-01..2026-10-27).
This coincides with the builder's rule; the builder now calls the book's function.

| Key (field-controls.js) | Old | New |
|---|---|---|
| `WP9.health.delayedExampleDates` | `{start 2026-08-10, calendarFinish 2026-09-29, workingFinish 2026-10-19, runDate 2026-10-09}` | `{start 2026-08-17, calendarFinish 2026-10-06, workingFinish 2026-10-26, runDate 2026-10-09}` |
| `rules.delayedExampleDatesFor(runDate)` | none | new: `{runDate, start, calendarFinish, workingFinish, windowFrom, windowThrough, cutoff, startOnOrBeforeCutoff}` |

`WP9.health.delayedExpected` (0, today 1) is unchanged.

## 7. 087-HLT document control (BADJ 087-EXC/HLT item 8)

Values unchanged (80 / 80); derivations rewritten on the literal contents and the plan's 90 / 100
recorded as a plan figure correction (they belong to `docControlPlanReading`'s record set).

| Key (field-controls.js) | Old | New |
|---|---|---|
| `WP9.health.docControlRecords` | text (unchanged) | derivation: the literal §3.2 contents, decided by BADJ item 8 |
| `WP9.health.docControlCard` | `80` (planValue 100) | `80` (planValue 100): health.js:462-478 = 100 - 2x10 - 2x5 + 1x10 |
| `WP9.health.docControlExpected` | `80` (planValue 90) | `80` (planValue 90): workspace-dashboard.service.js:1168-1190 = 100 - 1x10 - 0x10 - 2x5 |

## 8. 087-HLT EV at the cutoff and on the card (BADJ 087-EXC/HLT item 6; R3-4)

Inputs: the build's record set (H10 60,000 @ 100%, H50 30,000 @ 50%; loadings 60,000 + 30,000 and
costs 50,000 + 30,000 all dated on or before 2026-08-31), adopted as `WP9.health.evRecords`. PV and AC
at the cutoff by date (earned-value.service.js:439-451, 486-514); EV at the cutoff reads approvals by
the cutoff instant (:737-753) and plan §3.3 (:467) stamps approvals at real time, so 0; the card's
default basis is an ad hoc report at today because 087-HLT has no reporting period
(earned-value.service.js:386-395; health.js:316-319).

| Key (field-controls.js) | Old | New |
|---|---|---|
| `WP9.health.evRecords` | none | the record set above |
| `WP9.health.cutoffInstant` | none | `2026-08-31T20:59:59.999Z` (Africa/Cairo, UTC+3) |
| `WP9.health.pvAtCutoff` | none | `9000000` |
| `WP9.health.acAtCutoff` | none | `8000000` |
| `WP9.health.evAtCutoff` | none | `0` (planValue `7500000`: plan figure correction) |
| `WP9.health.cardBasis` | none | `ad hoc report cut at today (no reporting period on 087-HLT)` |
| `WP9.health.pvOnCardBasis` / `acOnCardBasis` / `evOnCardBasis` | none | `9000000` / `8000000` / `7500000` |
| `WP9.health.spi` / `cpi` | 0.833333 / 0.9375 | unchanged; derivation names the card basis |
| `rules.endOfLocalDay` (field-controls) | none | new (same calculator as schedule.js) |

## 9. Timesheet multiplier 0.5 (BADJ 087-FLD item 1; adjudication F1)

Values unchanged; the plan's "one of them 0.5" crew member is marked as served by the contract refusal
(the build step is DONE on 400 VALIDATION_ERROR with `error.details` field `overtimeMultiplier`; the
import answers 200 with the row in `errors[]`). The 100.00 figure is checked in process with the
service's exported `multiplierFor` (timesheet.service.js:70), never on a built crew.

| Key (field-controls.js) | Old | New |
|---|---|---|
| `WP8.timesheet.multiplierHalf` | `10000` ("needs a guarded fixture or dropped" in the create leaf) | `10000`, in process only |
| `WP8.timesheet.multiplierHalfCreate` | `400 VALIDATION_ERROR`, planValue "...(plan :390)" | `400 VALIDATION_ERROR`, planValue "...(plan :390; :429 @f599e67)"; served by the contract refusal |
| `WP8.timesheet.multiplierHalfImport` | `{status 200, created 0, ..., errors [row 1]}` | unchanged; derivation names BADJ 087-FLD item 1 |

## 10. Round 2: leaves for the verifiers' figures (BADJ "Round 2", R2-B B1-B5) and lib pickId (R2-G)

Binding source: BADJ's final section "Round 2: adjudication of the two verifiers". Under R2-B the
builders assert these keys and compute no figure themselves (A10). Every product file cited is
unchanged between `886c9f1` and `f599e67`: `git diff 886c9f1 f599e67` is empty for export.js,
projects.js, rbac.js, export.service.js, ipc.service.js, prime-contract.service.js,
earned-value.service.js, weather.service.js and schema.prisma. Plan lines are `PF(...)` (`@f599e67`).

Figure counts after round 2:
- schedule 736 -> 788 (+52);
- field-controls 279 -> 279 (two `today` readings added to existing figures);
- commercial 590 -> 618 (+28).

No key was removed and no `value` changed. The three load tests (`scratch/wp0/load-schedule.js`,
`load-commercial.js`, `load-field-controls.js`) pass, and every leaf has a derivation and a source.

### B1. `WP9.export.sheetGate` today (field-controls.js)

Derivation from the route guard and the export service:
- GET /projects/:projectId/export/xlsx passes `nestedProjectAccess`, which checks project access
  only (projects.js:55-59, mounted at :468).
- It then passes `requirePermission('cost', 'export')` (export.js:17-19), its only permission check
  (rbac.js:138-163 -> `hasPermission` :50-66). The 087-EXTRAS member's template grants
  `cost|action:export`.
- `generateProjectExport({ projectId, orgId })` (export.js:21-24) is given no user and checks no
  permission. It reads the risks unfiltered (export.service.js:90-93) and adds six worksheets
  unconditionally, in this order: Master Schedule, Critical Path, Risks, Assumptions, Long Lead
  Items, WBS (:179, 209, 234, 259, 270, 316; 6 = `WP9.export.sheets`).

So the member denied `risk:read` gets 200 and all six sheets, Risks included. That is HR-K7's known
answer, and it equals the round-1 087-EXTRAS observation (BLOCKED HR-K7: '200', the same six names
in the same order).

| Key (field-controls.js) | Old | New |
|---|---|---|
| `WP9.export.sheetGate` (value) | `one permission per sheet` | unchanged; the derivation states the proof's value check: answer '200' and no sheet named Risks (R3-9) |
| `WP9.export.sheetGate.today` | none | `{ answer: '200', sheets: ['Master Schedule', 'Critical Path', 'Risks', 'Assumptions', 'Long Lead Items', 'WBS'] }`, the 087-EXTRAS step's `{ answer: said(res), sheets }` shape |
| `EXPORT_SHEETS_HEAD`, `EXPORT_RISK_SHEET_HEAD` (data, not leaves) | none | the six names; `'Risks'` |

### B2. IPC-09 and IPC-10 on 087-COM (commercial.js `deep["087-COM"]`)

Derivation from book keys (`IPC0910`). Totals are computed by `recomputeCertificateTotals`
(ipc.service.js:108-175) through `certificateFinancials` (prime-contract.service.js:649-692).

Advance outstanding before both certificates:
- `ipc04.advanceOutstandingBefore` 190,250.00 - `ipc04.advanceRecovery` 750.00 = 189,500.00.
- Recovery locks only at certification (prime-contract.service.js:694-732), so IPC-09, which is
  submitted, does not reduce IPC-10's outstanding.

IPC-09:
- gross: 500 m2 x 45.00 (`BOQ["B-004"]`) = 22,500.00;
- within earned: `B-004/A310` 135,000.00 at A310's 50% (the basis of `WP4.P2.progressCap`) =
  67,500.00;
- retention: 10% (`contractRetentionRate`; no cap, which is IPC-02's only) = 2,250.00;
- recovery: min(189,500.00, 10% x 22,500.00) = 2,250.00;
- deduction: 1,000.00 (the amount `WP4.I7.deductionWithoutNote` names; BADJ 087-COM item 2);
- tax: 0 (C7);
- net: 22,500.00 - 2,250.00 - 2,250.00 - 1,000.00 = 17,000.00.

IPC-10:
- gross: 1,000 m2 x 18.00 (`BOQ["B-005"]`) = 18,000.00;
- within earned at A320's 100% (a build choice; 25% or more is enough);
- retention: 1,800.00;
- recovery: 1,800.00;
- deduction: none;
- net: 14,400.00.

My derivation agrees with the builder's literals (087-com.js ~949-990). It also agrees with the
round-1 state (`ipc.09` netPayable 17,000, `ipc.10` 14,400). No difference to report.

| Key (commercial.js) | Old | New |
|---|---|---|
| `deep.087-COM.ipc09.status` / `quantity` | none | `submitted` / `500` m2 |
| `deep.087-COM.ipc09.gross` / `retention` | none | `2250000` / `225000` |
| `deep.087-COM.ipc09.advanceOutstandingBefore` / `advanceRecovery` | none | `18950000` / `225000` |
| `deep.087-COM.ipc09.deductions` / `taxAmount` / `net` | none | `100000` / `0` / `1700000` |
| `deep.087-COM.ipc10.status` / `quantity` | none | `draft` / `1000` m2 |
| `deep.087-COM.ipc10.gross` / `retention` | none | `1800000` / `180000` |
| `deep.087-COM.ipc10.advanceOutstandingBefore` / `advanceRecovery` | none | `18950000` / `180000` |
| `deep.087-COM.ipc10.deductions` / `taxAmount` / `net` | none | `0` / `0` / `1440000` |

### B3. 087-COM-C bill and IPC-01 (commercial.js `deep["087-COM-C"]`)

Derivation (`COMC`):
- B-001 is the book's row (5,000 m3 x 12.00).
- B-006 is the builder's optional, unallocated disposal row (2,000 m3 x 8.00).
- The bill is 60,000.00 + 16,000.00 = 76,000.00. This is the contract's originalValue on the
  fallback: with no contractValue, the first read after the upload takes the aggregate of the
  active BOQ amounts, with source `boq_fallback` (prime-contract.service.js:201-220).

IPC-01:
- its one item is the whole `B-001/A110` allocation: 5,000 m3 x 12.00 = 60,000.00 (A110 at 100%);
- retention 10% (the project's explicit defaultRetentionRate, HR-C1), taken by the items
  (ipc.service.js:51-54, 779, 872, 934-938) and by the contract (prime-contract.service.js:264-266) =
  6,000.00;
- no cap, advance or tax: the schema defaults are `retentionCapRate` null, `advancePaidAmount` 0 and
  `taxRate` 0 (schema.prisma:2535, 2538, 2544);
- net 54,000.00.

This agrees with 087-com-c.js:72,106 and the round-1 state (bill 7,600,000 cents, originalValue
76,000, IPC-01 net 54,000).

| Key (commercial.js) | Old | New |
|---|---|---|
| `deep.087-COM-C.billRows` | none | the two rows above (list) |
| `deep.087-COM-C.billTotal` | none | `7600000` |
| `deep.087-COM-C.ipc01.quantity` / `gross` / `retentionRate` | none | `5000` m3 / `6000000` / `10` |
| `deep.087-COM-C.ipc01.retention` / `advanceRecovery` | none | `600000` / `0` |
| `deep.087-COM-C.ipc01.deductions` / `taxAmount` / `net` | none | `0` / `0` / `5400000` |

### B4. 087-EV run-date reads after the locks (schedule.js `WP3.periods.afterLock`)

Derivation inputs:
- AC = `WP3.T2.ac` 110,000.00 + `backdatedCost` 5,000.00 = 115,000.00 (`acLedger(RUN, ROWS_LOCK)`).
  HEAD's `acHead` agrees at the run date, and the book checks this at load, so there is no L34
  today.
- PV = `WP3.T2.pv` 387,000.00.
- EV = `WP3.T2.ev` 97,500.00 after the cost, and `runDateEv` 100,500.00 after the approval.
- BAC follows the T5 delete probe:
  - `revisionKept` (the probe was refused): `WP3.T5.bac` 400,000.00;
  - `revisionDeleted` (an audited delete, or HEAD's silent L112 delete): `WP3.T1.bac` 387,000.00.

Figures (`rules.evMetrics`):

| Metric | afterCost kept | afterCost deleted | afterApproval kept | afterApproval deleted |
|---|---|---|---|---|
| BAC | 400,000.00 | 387,000.00 | 400,000.00 | 387,000.00 |
| PV | 387,000.00 | 387,000.00 | 387,000.00 | 387,000.00 |
| EV | 97,500.00 | 97,500.00 | 100,500.00 | 100,500.00 |
| AC | 115,000.00 | 115,000.00 | 115,000.00 | 115,000.00 |
| SPI (alert) | 0.251938 (yes) | 0.251938 (yes) | 0.259690 (yes) | 0.259690 (yes) |
| CPI (alert) | 0.847826 (yes) | 0.847826 (yes) | 0.873913 (yes) | 0.873913 (yes) |
| EAC (budget_over_cpi) | 471,794.87 | 456,461.54 | 457,711.44 | 442,835.82 |
| SV | -289,500.00 | -289,500.00 | -286,500.00 | -286,500.00 |
| CV | -17,500.00 | -17,500.00 | -14,500.00 | -14,500.00 |
| ETC | 356,794.87 | 341,461.54 | 342,711.44 | 327,835.82 |

The `revisionDeleted` columns equal what the round-1 087-EV build read after its L112 BLOCKED probe
(EAC 456,461.54 / 442,835.82; ETC 341,461.54 / 327,835.82; every verdict 'value').

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP3.periods.afterLock.runDateAfterCost.{revisionKept,revisionDeleted}.{bac,pv,ev,ac,spi,spiAlert,cpi,cpiAlert,eac,eacBasis,sv,cv,etc}` | none (087-ev.js computed them) | the afterCost columns above (26 leaves, assumption, no `today`) |
| `WP3.periods.afterLock.runDateAfterApproval.{revisionKept,revisionDeleted}.{...same 13}` | none | the afterApproval columns above (26 leaves) |

For the builder:
`metricsFrom('periods.afterLock.runDateAfterCost.' + (revisionKept() ? 'revisionKept' : 'revisionDeleted'))`,
and likewise for `runDateAfterApproval`.

### B5. `WP8.weather.nonContractualAddsNothing` today (field-controls.js)

- The value stays 14.
- today is 12. Every row is stored in the Int column (weather.service.js:217), so the contractual
  rows read trunc(0.5, 1.0, 1.5, 2.5, 7.5, 1.0) = 0 + 1 + 1 + 2 + 7 + 1 = 12
  (`FLD_WEATHER_AT_TODAY.used`, the same reading as `WP8.weather.todayAt` 60%).
- The non-contractual 10 adds nothing (weather.service.js:162-165), so the reading is still 12.
- This is HR-C11's known answer (truncation).

The 052-FLD (D2) twin: the book carries none. `WP8["052-FLD"]` has only `weatherBelowPct`,
`weatherAtPct` and `weatherAtWarning`, and commercial.js `WP7.weather["052-FLD"]` has only 65% / 70%.
052-FLD runs the same record set, so both builders judge against this one leaf; no twin was added.

| Key (field-controls.js) | Old | New |
|---|---|---|
| `WP8.weather.nonContractualAddsNothing` (value) | `14` | unchanged |
| `WP8.weather.nonContractualAddsNothing.today` | none | `12` (HR-C11) |

### R2-G. lib.js `pickId`

- When the payload is not a bare array, `data.items` is searched first.
- When `items` does not hold the id, every other top-level array property is searched in key
  order. For an IPC certificate (GET /ipc/:period) these are `invoices`, `payments` and
  `retentionReleases`.
- Bare arrays, `data.id`, `data.item.id`, and an id found in `items` behave as before.

Proof: a scratch script extracts `pickId` from lib.js's text and runs it on a synthetic IPC
certificate payload (17 cases pass). The pre-change `pickId` finds none of the invoice, payment or
release ids there. `node --check` passes for lib.js and every builder.

<!-- merged from CHANGES-WP0-BUILDERS-r3-com.md (round 3) -->

# Answer book: changes for the WP-0 builders' adjudication, round 3, group com (2026-10-09)

Binding source: `C:\Temp\octapm-cert\scratch\wp0\builders-adjudication.md`, section "Round 3: adjudication
of the round-2 verifier" (cited below as BADJ R3), items R3-1 and R3-3. Rule A10 applies: every value below
is a leaf whose on-paper derivation is written next to it in the book (the leaf's `derivation`), from the
book's own keys; the builders assert the leaves and compute no figure themselves. Product citations keep
the book's `@886c9f1` tag: `git diff --stat 886c9f1 f599e67` is empty for prime-contract.service.js,
ipc.service.js, change-order.service.js and schema.prisma, the files the new entries cite, and
`backend/src` is clean in the working tree. Plan lines are the working-tree plan's (`P(...)`).

Figure counts: commercial 618 -> 633 (+15: six under `deep.087-COM.contractEnd`, nine under
`deep.052-COM.ipc03`). No key was removed and no existing `value` changed. The load test
(`scratch/wp0/load-commercial.js`) passes: 633 figures, shape OK, every leaf with a derivation and a source.
Money is integer cents of the project currency (087 EGP, 052 USD).

## 1. 052-COM's IPC-03 (BADJ R3-1; commercial.js `deep["052-COM"].ipc03`)

Derivation (`COM052_IPC03`, computed in the book from its keys, in integer USD cents):
- the row is `BOQ["B-001"]` (5,000 m3 x 12.00), allocated whole to A110
  (`stage3:109.allocation.B-001/A110` = 60,000.00); the claim is 1,000 m3, a build choice (plan §3.2 fixes
  only "a submitted certificate" among the I4 states);
- gross: 1,000 x 12.00 = 12,000.00 = totalCert = grossThisPeriod; within earned at A110's 100% approved
  (60,000.00), and no earlier 052-COM certificate claims B-001/A110 (IPC-01 is on C-001/A220, IPC-02 on
  D-001/A200);
- retention: `deep["052-COM"].contractRetentionRate` 10%, explicit on the prime contract after the I1 case
  (at HEAD reached through the item PATCH, finding L114) = 1,200.00; no cap (`retentionCapRate` null by
  default, schema.prisma:2535, never configured on 052-COM);
- advance recovery 0: `advancePaidAmount` 0 by default (schema.prisma:2538), outstanding 0
  (prime-contract.service.js:539-540);
- deductions 0 (the plan's deduction is 087-COM IPC-09's); tax 0 (`taxRate` 0 by default, schema.prisma:2544,
  and set to 0 explicitly with the retention rate, step contract.retention);
- net: certificateFinancials (prime-contract.service.js:649-692) 12,000.00 - 1,200.00 - 0 - 0 = 10,800.00
  + tax 0 = 10,800.00, on the draft and on the submitted certificate (totals are recomputed on draft item
  edits, ipc.service.js:108-175, 908-914, 1024, and not moved by the submit).

My derivation agrees with the builder's former literals (052-com.js `ipc.I4-submitted`: 1000 x 12,
gross x RATE / 100, gross - retention). No difference to report.

| Key (commercial.js) | Old | New |
|---|---|---|
| `deep.052-COM.ipc03.status` | none | `submitted` |
| `deep.052-COM.ipc03.quantity` | none | `1000` m3 |
| `deep.052-COM.ipc03.gross` | none | `1200000` |
| `deep.052-COM.ipc03.retentionRate` | none | `10` percent |
| `deep.052-COM.ipc03.retention` | none | `120000` |
| `deep.052-COM.ipc03.advanceRecovery` | none | `0` |
| `deep.052-COM.ipc03.deductions` | none | `0` |
| `deep.052-COM.ipc03.taxAmount` | none | `0` |
| `deep.052-COM.ipc03.net` | none | `1080000` |
| `COM052_IPC03`, `COM052_IPC03_SRC`, `COM052_IPC03_NOTE` (data, not leaves) | none | the derivation above; a load check throws unless net = 10,800.00 |

For the builder (052-com.js `ipc.I4-submitted`): the claim sends `ipc03.quantity` and `ipc03.retentionRate`
(the item's rate asserted on the PATCH answer); `bookTotals(ipc03)` (status, totalCert, grossThisPeriod,
totalRet, advanceRecovery, deductions, taxAmount, netPayable, as 087-COM's helper) is asserted on the draft
(status draft) and again on the submitted certificate; the A110 item's qty is asserted against
`ipc03.quantity`. The step's place is unchanged (after ipc.I8).

## 2. 087-COM's contract after every prime CO (BADJ R3-3; commercial.js `deep["087-COM"].contractEnd`)

Derivation (`CONTRACT_END`, computed in the book from its CO leaves): GET /prime-contract aggregates
`approvedChangesValue` as the SUM of value over the project's COs with status in
APPROVED_CHANGE_STATUSES = ['approved'] and archivedAt null, `pendingChangesValue` the same over
PENDING_CHANGE_STATUSES = ['draft', 'pending'] (a draft counts as pending, `WP4.E2.pendingDelta`), and
`revisedValue` = originalValue + approvedChangesValue (prime-contract.service.js:35-37, 236-263, 286-307).
A rejected CO is in neither set; an archived one (status 'archived' and archivedAt set,
change-order.service.js:1687-1688) fails archivedAt null (`WP4.E3.archivePendingDelta`).

The CO set at the moment of the builder's step contract.after-cos (after co.RFI's approval and ce.E1's
convert; CO-SPLIT and CO-I3 approved after IPC-10, so `WP4.E5.revisedValue` 2,125,000.00 still held for
IPC-02's cap, `WP4.I7.retentionCap`):

| CO (builder key) | status | amount | from |
|---|---|---|---|
| CO-125 | approved | 125,000.00 | `WP4.E5.approvedChangesValue` |
| CO-SPLIT | approved | 10,000.00 | `WP4.E4.revisedDelta` (= `split01_100` 6,000.00 + `split02_100` 4,000.00, checked at load) |
| CO-I3 | approved | 7,500.00 | `WP4.I3.A120LimitAmount` 37,500.00 - `stage3:109.allocation.B-002/A120` 30,000.00 (checked at load) |
| CO-RFI | approved | 4,500.00 | `WP4.rfiCo.value` (approved: `WP4.rfiCo.revisedDeltaOnApproval`) |
| CO-40 | pending | 40,000.00 | `WP4.E5.pendingChangesValue` |
| CO-E1 | draft | 9,500.00 | `WP4.E1.convertedValue` (`WP4.E1.coStatus` draft) |
| CO-REJ | rejected | 15,000.00 | build choice; in neither aggregate |
| CO-ARC | archived | 3,000.00 | build choice; in neither aggregate |

- approvedChangesValue = 125,000.00 + 10,000.00 + 7,500.00 + 4,500.00 = **147,000.00**;
- pendingChangesValue = 40,000.00 + 9,500.00 = **49,500.00** (`WP4.E5.pendingChangesValue` 40,000.00 holds
  at its own moment only, before E1 is converted: its note; asserted at contract.after-CO-125);
- revisedValue = `deep.087-COM.contractOriginal` 2,000,000.00 + 147,000.00 = **2,147,000.00**.

My derivation agrees with the builder's literals (087-com.js `contract.after-cos`: 147,000 / 49,500 /
2,147,000) and with the round-2 state. No difference to report. CO-I3's value was itself computed in the
builder (`WP4.I3.A120LimitAmount` minus the stage-3 allocation); it is now the book's `approvedChanges`
entry for CO-I3, derived from those two keys with a load check (7,500.00).

| Key (commercial.js) | Old | New |
|---|---|---|
| `deep.087-COM.contractEnd.approvedChanges` | none | list `[{co, status, amount, from}]`: CO-125, CO-SPLIT, CO-I3, CO-RFI as above |
| `deep.087-COM.contractEnd.pendingChanges` | none | list: CO-40 (pending), CO-E1 (draft) as above |
| `deep.087-COM.contractEnd.notCounted` | none | list `[{co, status, amount, why}]`: CO-REJ (rejected), CO-ARC (archived); amounts are build choices (assumption, noted) |
| `deep.087-COM.contractEnd.approvedChangesValue` | none | `14700000` |
| `deep.087-COM.contractEnd.pendingChangesValue` | none | `4950000` |
| `deep.087-COM.contractEnd.revisedValue` | none | `214700000` |
| `CONTRACT_END`, `CONTRACT_END_SRC`, `CONTRACT_END_NOTE` (data, not leaves) | none | the derivation above; a load check throws unless 147,000.00 / 49,500.00 / 2,147,000.00 follow from the leaves |

For the builder (087-com.js): `coI3Value` reads the book's CO-I3 entry (`contractEndCo('CO-I3')`); step
`contract.after-cos` asserts the three aggregates against the leaves, then reads the register live and
asserts each listed CO (by the id this build recorded for it: `co.<key>` outputs, `co.RFI.changeOrderId`,
`ce.E1.changeOrderId`) in the book's status and at the book's amount, archived only for CO-ARC, and that the
register's approved and draft/pending rows with archivedAt null are exactly the book's two lists (nothing
else counted). Its `needs` now name every composing CO step. The step's place is unchanged (after co.RFI).


<!-- merged from CHANGES-WP0-BUILDERS-r3-ev-sch-lanes-extras.md (round 3) -->

# Answer book: round-3 changes of group `ev-sch-lanes-extras` (2026-10-09)

Binding source: `C:\Temp\octapm-cert\scratch\wp0\builders-adjudication.md`, section "Round 3: adjudication of
the round-2 verifier" (cited below as BADJ Round 3). Only R3-2 (A10) touches the answer book; R3-4, R3-5, R3-6
and R3-7 (G4) are builder-only and are listed at the end for the record. Rule A10 applies: every leaf below
carries its on-paper derivation in the book (`derivation`), and the builder asserts leaves, computing no figure.
Product citations keep the `@886c9f1` tag; every product file cited is unchanged at `f599e67`
(`earned-value.service.js`, `eac-basis.js`). Plan lines in the new entries are numbered at `f599e67` (`PF(...)`).

Figure count: schedule 788 -> 853 (+65: one set of 13 and four sets of 13). No key was removed and no existing
`value` or `today` changed. The three load tests (`scratch/wp0/load-schedule.js`: "OK: leaf contract and
cross-checks pass") and the book's own load checks (below) pass; every leaf has a derivation and a source.

## 1. The 2026-02-28 read after the back-dated cost (BADJ Round 3 R3-2 (a))

087-ev.js derived this set in builder code (`derivedMetrics` -> `rules.evMetrics` over `WP3.T3.bac`,
`WP3.T3.pv`, `WP3.periods.afterLock.cutoffReportEv` and `.cutoffReportAc`). The set is now the book's.

Derivation (from the book's own leaves):
- BAC = `WP3.T3.bac` 387,000.00. The +13,000.00 revision of T5 is effective 2026-03-01, after this cutoff, and
  the report adjusts BAC only by approved revisions effective on or before the cutoff
  (earned-value.service.js:428-437), so one set serves both outcomes of the T5 delete probe (checked at load:
  `inputs.ev087.budgetRevision.effectiveDate > 2026-02-28`).
- PV = `WP3.T3.pv` 180,000.00 (loadings planned on or before 02-28: 60,000 + 30,000 + 90,000).
- EV = `WP3.periods.afterLock.cutoffReportEv` 0 (every approval, the new A120 60% included, is stamped after
  the cutoff instant 2026-02-28T21:59:59.999Z), so the read is the same at checkpoint.afterLock.afterCost and at
  checkpoint.afterLock.afterApproval: one set serves both reads.
- AC = `WP3.periods.afterLock.cutoffReportAc`: `WP3.T3.ac` 70,000.00 + the back-dated A130 5,000.00 on
  2026-02-15 = 75,000.00; today 25,000.00 (L34: A130's cumulative 25,000.00 through 02-15 stays, A110 through
  09-30 and A120 through 10-01 drop out).
- SPI 0 / alert, CPI 0 / alert (EV 0), EAC = BAC (basis `budget_cpi_zero`), SV -180,000.00,
  CV -75,000.00 (today -25,000.00), ETC 312,000.00 (today 362,000.00). HEAD's figures (`today`) are derived
  beside each value, sentence by sentence ("HEAD (L34, ...): ... = ...").

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP3.periods.afterLock.cutoffAfterCost.bac` | none (087-ev.js computed) | `38700000` |
| `WP3.periods.afterLock.cutoffAfterCost.pv` | none | `18000000` |
| `WP3.periods.afterLock.cutoffAfterCost.ev` | none | `0` |
| `WP3.periods.afterLock.cutoffAfterCost.ac` | none | `7500000`, today `2500000` (L34) |
| `WP3.periods.afterLock.cutoffAfterCost.spi` / `spiAlert` | none | `0` / `true` |
| `WP3.periods.afterLock.cutoffAfterCost.cpi` / `cpiAlert` | none | `0` / `true` |
| `WP3.periods.afterLock.cutoffAfterCost.eac` / `eacBasis` | none | `38700000` / `budget_cpi_zero` |
| `WP3.periods.afterLock.cutoffAfterCost.sv` | none | `-18000000` |
| `WP3.periods.afterLock.cutoffAfterCost.cv` | none | `-7500000`, today `-2500000` (L34) |
| `WP3.periods.afterLock.cutoffAfterCost.etc` | none | `31200000`, today `36200000` (L34) |

The `today` columns equal what the round-2 087-EV build observed at both after-lock reads (BLOCKED L34: AC
2,500,000, CV -2,500,000, ETC 36,200,000 cents), which the builder then cited as `rules.evMetrics(...)`; it now
cites these leaves.

## 2. T6 before and after the retirement (BADJ Round 3 R3-2 (b))

087-ev.js derived both T6 checkpoints in builder code (`derivedMetrics` over `bacNow()`, `WP3.T2.pv`,
`WP3.periods.afterLock.runDateEv` and `WP3.T6.acBeforeRetirement` / `.acAfterRetirement`, overriding cpi with
`WP3.T6.cpiAfterRetirement`). Both are now full sets in the book, one per outcome of the T5 delete probe (the
same branching as `WP3.periods.afterLock.runDateAfterCost`): `revisionKept` (the probe refused, BAC
`WP3.T5.bac` 400,000.00) and `revisionDeleted` (an audited delete, or HEAD's silent L112 delete, BAC
`WP3.T1.bac` 387,000.00).

Derivation (from the book's own leaves):
- PV = `WP3.T2.pv` 387,000.00; EV = `WP3.periods.afterLock.runDateEv` 100,500.00 (A140 holds no allocation,
  so the retirement moves no EV).
- AC before = `WP3.T6.acBeforeRetirement`: `WP3.T2.ac` 110,000.00 + the back-dated A130 5,000.00 + the A140
  5,000.00 dated the run date (`WP3.T6.ledgerDelta`) = 120,000.00; HEAD agrees (no today).
- AC after = `WP3.T6.acAfterRetirement`: the same 120,000.00 by HR-S9's recommendation (retired activities keep
  their AC; undecided, AC itself is CERT-5); today 115,000.00 (HR-S9 / L118: A140's cumulative CostRecord drops
  out with the retired activity). Every figure that follows from AC carries its HEAD today, derived beside the
  value; cpi's today is stated to six places, as `WP3.T6.cpiAfterRetirement.today` is.
- The after set's `cpi` equals `WP3.T6.cpiAfterRetirement` (value 0.8375, today 0.873913) and its `ac` equals
  `WP3.T6.acAfterRetirement` (value and today): checked at load, with the before set's inputs.

| Key (schedule.js) | revisionKept | revisionDeleted |
|---|---|---|
| `WP3.T6.before.<branch>.bac` | `40000000` | `38700000` |
| `WP3.T6.before.<branch>.pv` / `ev` / `ac` | `38700000` / `10050000` / `12000000` | the same |
| `WP3.T6.before.<branch>.spi` / `spiAlert` | `0.25969` / `true` | the same |
| `WP3.T6.before.<branch>.cpi` / `cpiAlert` | `0.8375` / `true` | the same |
| `WP3.T6.before.<branch>.eac` / `eacBasis` | `47761194` / `budget_over_cpi` | `46208955` / `budget_over_cpi` |
| `WP3.T6.before.<branch>.sv` / `cv` | `-28650000` / `-1950000` | the same |
| `WP3.T6.before.<branch>.etc` | `35761194` | `34208955` |
| `WP3.T6.after.<branch>.bac` / `pv` / `ev` | as before | as before |
| `WP3.T6.after.<branch>.ac` | `12000000`, today `11500000` (HR-S9) | the same |
| `WP3.T6.after.<branch>.spi` / `spiAlert` | `0.25969` / `true` | the same |
| `WP3.T6.after.<branch>.cpi` | `0.8375`, today `0.873913` (HR-S9) | the same |
| `WP3.T6.after.<branch>.cpiAlert` | `true` | the same |
| `WP3.T6.after.<branch>.eac` | `47761194`, today `45771144` (HR-S9) | `46208955`, today `44283582` (HR-S9) |
| `WP3.T6.after.<branch>.eacBasis` | `budget_over_cpi` | the same |
| `WP3.T6.after.<branch>.sv` | `-28650000` | the same |
| `WP3.T6.after.<branch>.cv` | `-1950000`, today `-1450000` (HR-S9) | the same |
| `WP3.T6.after.<branch>.etc` | `35761194`, today `34271144` (HR-S9) | `34208955`, today `32783582` (HR-S9) |

The `revisionDeleted` after column equals what the round-2 087-EV build observed (BLOCKED HR-S9: AC
11,500,000, CPI 0.873913, EAC 44,283,582, CV -1,450,000, ETC 32,783,582 cents), which it cited as
`rules.evMetrics(...)`; it now cites these leaves. All 52 T6 leaves and the 13 cutoffAfterCost leaves are
`assumption: true` (they rest on the back-dated cost's activity choice, the T5 probe's branch and the undecided
HR-S9), none `planDisagrees`.

New helpers in schedule.js (data, not leaves): `M_CUTOFF_AFTER_COST`, `M_CUTOFF_AFTER_COST_HEAD`, `M_T6`,
`headTexts`, `headDerivations`, `cutoffAfterCostLeaves()`, `t6Leaves(stage, branch)`, and the load checks after
`WP3` (the new sets agree with the leaves they are built from). The header comment names round 3.

For the builder (087-ev.js): `cutoffAfterCost = () => metricsFrom('periods.afterLock.cutoffAfterCost', ...)`;
`t6State = (stage) => metricsFrom(\`T6.${stage}.${probeBranch()}\`, ...)` for checkpoint.T6.before and
checkpoint.T6.after (the latter with ref HR-S9); `derivedMetrics`, `bacNow` and `runDateEv` are removed, and the
builder no longer requires `rules.evMetrics`.

## 3. Builder-only items of this group (no book change)

- R3-5 (087-ev.js `importProgramme`): the adoption find returns the live revision's `activityCount`, its
  `snapshotJson.dependencies` length and `staged = status 'draft' and not active`, as 087-imp.js does.
- R3-6 (lanes.js `boqEv`): the adoption find is the live BOQ revision of this build's label from GET /boq
  `revisions` (atMostOne); the fields accept the upload's answer (revisionId, mode 'imported',
  baselineLocked false) or the adopted row (id, label, baselineLocked), as the commercial builders assert it.
- R3-7 (087-sch.js `staging` and `boq.upload`, 087-ev.js `importProgramme`, lanes.js `scheduleF1` and
  `boqEv`): after an upload record is done, the revision id falls back to the record's id
  (`data.revisionId ?? rec?.id`), as 087-imp.js `stage()` does, and is asserted present before any GET.
- R3-4 (087-extras.js): the guest's member row is read as the API gives it (company-party.service.js
  `sanitizeMember`: id, userId, role, status) with no default; each consultant party (087-EXC's and 087-HLT's)
  must hold exactly one active member, the guest (a removed member reads 'inactive'), asserted at guest.access
  and guest.hlt and re-read live by both steps' verify on a resume; POST .../members answers `{ id, status }`,
  which the create asserts.

# WP-1 proof authoring (2026-10-10)

Binding source: `C:\Temp\octapm-cert\scratch\wp1\author-adjudication.md`, items BOOK-1..BOOK-7 (cited in the book as
`WADJ(...)`), with the reviewers' findings in `author-summary.txt` and `C:\Temp\octapm-cert\scratch\wp1-prep.md` §5/§7
(`PREP1(...)`). Rule A10 applies: every leaf below carries its on-paper derivation in the book (`derivation`), worked from
the product code at `f599e67` (cited with the new helper `HF(file, lines)`, suffix `@f599e67`; `backend/src` in the
worktree is identical to `f599e67`), from existing book keys, or from the generators in `build/files.js` (restated in the
book, which still requires nothing). Plan lines are numbered at `f599e67` (`PF(...)`).

Figure count: schedule 853 -> 870 (+17). No key was removed. Three existing values changed, each as the adjudication
directs and each recording its old value: `WP1.revisions.rejectWithoutReason` and `WP1.revisions.activate.olderRevision`
(BOOK-3, the plan's codes kept as `planValue`) and `WP1.mutations.stagedImportWrites` (BOOK-7, old value in `note`). No
other `value` or `today` changed (checked by a before/after dump of `figures()`: 850 leaves byte-identical; `inputs` and
`rules` identical).

Leaf contract: leaves may now carry `ref`, the §5 row (or finding) a `today` waits on (`F(..., { ref })`; `figures()`
copies it). Every new leaf with a `today` names its `ref` and is `assumption: true` (checked at load).

New helpers in schedule.js (data, not leaves): `HF`, `WADJ`, `PREP1`; `FSL_IN` (the FS-lead inputs; `FSL_TODAY` and
`FSL_CAP` now read it, same figures), `MIXED_IN` (`MIXED` reads it, same figures), `RANGE_IN`, `F4_FIRST`, `F4_SECOND`,
`F4_ROWS`, `F6_CAL`, `A200_FILE_PCT`, `searchStatusOf`, `W_HAND_BUILT`, `CAL_CHANGE`; and a block of load checks after
`WP1` that ties every new leaf to the figures it is built from (the book refuses to load otherwise).

## BOOK-1. The project calendar change (HR-S6; adjudication M2)

Derivation: the probe is PATCH /projects/:id `{ projectCalendar: 'seven_day' }` by the PM on W (five_day, start
2026-01-05, F1 active), then back to five_day. Every F1 row carries the file's calendar id '1' (files.js:114, :160;
xer-parser.js:138; import.service.js:222-223; activation writes it on new and mapped rows, schedule.service.js:1631-1638,
1679-1688), an id the engine does not know, so it resolves to the project calendar (cpm.service.js:80-92). CPM counts
working days, so M900's early finish stays 81; its date is 2026-04-28 on five_day and 2026-03-27 on seven_day (81
calendar days from 2026-01-05). Value (HR-S6 recommendation, plan :1032): before a baseline the change recalculates
(stored endDate = derived earlyFinishDate = 2026-03-27); after the lock it is refused 409, code null, and nothing moves
(five_day; endDate = earlyFinishDate = baselineFinishDate = 2026-04-28). Today: 200 either way; updateProject writes the
project row only, no CPM (project.service.js:702-808, write :776-799), so endDate stays 2026-04-28 while every derived
date is re-dated on read on the new calendar (schedule.service.js:272-321, activity.service.js:138-187): earlyFinishDate
2026-03-27 and, after the lock, baselineFinishDate 2026-03-27 (the locked baseline moves).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP1.dates.calendarChange` | none | value `{ change: {from: five_day, to: seven_day}, beforeBaseline: {http 200, projectCalendar seven_day, M900 {earlyFinish 81, endDate 2026-03-27, earlyFinishDate 2026-03-27}}, afterBaseline: {http 409, code null, projectCalendar five_day, M900 {earlyFinish 81, endDate 2026-04-28, earlyFinishDate 2026-04-28, baselineFinishDate 2026-04-28}} }`; today `{ beforeBaseline: {http 200, seven_day, M900 endDate 2026-04-28, earlyFinishDate 2026-03-27}, afterBaseline: {http 200, seven_day, M900 endDate 2026-04-28, earlyFinishDate 2026-03-27, baselineFinishDate 2026-03-27} }`; ref HR-S6; assumption |

On W the probe runs after BL.covered.live with the start back at 2026-01-05, so it judges `afterBaseline`; CF.7 folds it
in with `WP1.dates.startMovedTo0112`.

## BOOK-2. End before start (HR-S2, decided and fixed at f599e67)

Derivation: assertDates (activity.service.js:329-340) throws 400 INVALID_DATES when end < start, or end = start with a
duration above 0; it runs on create before any write (:401-406) and on update on the row as it would become, before the
transaction (:549-555), so a refused PATCH leaves the row and its updatedAt unchanged; no route validator compares the two
dates (routes/activities.js:104-105, :284-285). The create check's other half gets its own leaf: a zero-duration milestone
with start = end passes assertDates and is created, 201 (routes/activities.js:139); CPM in the create transaction
(:430-440, :479-481) writes its early dates as start and end (cpm.service.js:654-667), so it reads back start = end.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP1.dates.endBeforeStartRefused` | none (DATES.endBeforeStart.* cited `WP1.dates.renameM900`) | `400 INVALID_DATES` (create and update) |
| `WP1.dates.zeroDurationCreate` | none (a literal 201 in DATES.endBeforeStart.create) | `201` |

## BOOK-3. The adjudicated revision contracts (WP-1 prep §7 D1, D2)

Derivation: reject without a reason is answered by the route, not the service: reasonRequired + validateWithReasons
(routes/schedule.js:107-117, :371-392; middleware/validate.js:7-12, :34-56) give 400 VALIDATION_ERROR, message 'A
rejection reason is required.', error.details holding field 'reason'; REJECTION_REASON_REQUIRED (schedule.service.js:
3960-3966) is unreachable through the API. Activating an older revision never reaches loadCurrentRevisionForLifecycle
(:965-1012): activateRevision (:3539-3564) -> activateRevisionSnapshot (:3106), whose status guard (:3130-3137) answers 409
INVALID_REVISION_STATUS for the superseded F1b. REVISION_NOT_CURRENT is what the lifecycle routes answer for the same
revision (submit-review, :3778-3790), so it gets its own leaf, which REV.notCurrent reads (L1).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP1.revisions.rejectWithoutReason` | `400 REJECTION_REASON_REQUIRED` | `400 VALIDATION_ERROR`, planValue `400 REJECTION_REASON_REQUIRED`, note `details.field=reason` |
| `WP1.revisions.activate.olderRevision` | `409 REVISION_NOT_CURRENT` | `409 INVALID_REVISION_STATUS`, planValue `409 REVISION_NOT_CURRENT` |
| `WP1.revisions.notCurrent` | none (REV.notCurrent cited the older-revision leaf) | `409 REVISION_NOT_CURRENT` (submit-review of the superseded F1b) |

## BOOK-4. F1 over two hand-built activities (adjudication P-Q1)

Derivation (assumption: the proof's W choreography): with A100 and A110 hand-built (activityCode A100, A110) active, the
mapping (suggestActivityMappings, schedule.service.js:1518-1629) pairs each by its file code (an XER row's task_code is
staged as its P6 id; matchType activity_code, confidence 1); activation updates the 2 mapped rows (:3263-3278), creates
the 14 - 2 = 12 others (:3280-3287), retires none (:3289-3303) and replaces the dependencies with F1's 13 links
(:3337-3362; record :3478-3492). The mapping GET reads the same split (suggested 2, newActivities 12, unmappedExisting 0).
`WP1.revisions.activate.record` (14/0/0, 087-SCH's choreography) is unchanged and stays asserted from the stored build out.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP1.revisions.activate.recordTwoHandBuilt.updated` / `new` / `retired` | none (literals 2 / 12 / 0 in REV.activate.full) | `2` / `12` / `0` (assumption) |
| `WP1.revisions.activate.recordTwoHandBuilt.dependencyCount` | none | `13` |

## BOOK-5. Inputs (L1)

Derivation: the FS-lead network is T3's A(10) and B(3) (80 h / 8, 24 h / 8; plan :524) with FS -8 (plan :525), in
working days like `WP1.T4.FF.inputs` and `WP1.T4.SF.inputs` (the file writes value x 8: 80 h, 24 h, -64 h). The mixed
pair is A five_day 5 d (from the plan's 2026-01-12: working day 5 from Monday 2026-01-05), FS 0, B seven_day 2 d (a
choice). The beyond-the-bound input is SCHEDULE_DAYS_MAX 36,500 (schedule-days.js:18) x 8 + 4 = 292,004 h, the first
whole hour that rounds past the bound (292,001..292,003 h round to 36,500); the at-bound input is
`WP1.conversion.rangeBoundary.atMax` x 8 = 292,000 h.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP1.T4.FSlead.inputs` | none (literals 80 / 24 / -64 h and 10 / 3 / -8 in the proof) | `{A: 10, B: 3, lag: -8}` working days (file hours x 8) |
| `WP1.mixedCalendar.inputs` | none | `{A: {duration 5, calendar five_day}, B: {duration 2, calendar seven_day}, link: {type FS, lag 0}}` (assumption) |
| `WP1.conversion.rangeBoundary.beyondMaxInput` | none (literal 36_500 * 8 + 4) | `292004` hours (assumption) |

## BOOK-6. Known-answer figures from the generators (M4, L1, L9)

Derivation: F4 (files.js F4() :285-301) = CERT3-FIRST (F1, 14 TASK rows) + CERT3-SECOND (B100 16 h, B110 40 h, B120 0 h,
3 rows): 17. Value (HR-S4 recommendation): no revision merges them (mergedRows 0): refused (status and code null, chosen
by the fix) or a project choice staging 14 or 3. Today: the parser reads every TASK and TASKPRED row whatever its proj_id
(xer-parser.js:113-163) and persistImport stages one draft revision (import.service.js:300-364): 201, activityCount =
imported = 17. F6 (files.js F6() :314-326) names clndr_id '2' on A300 and A330 and the default '1' elsewhere; the parser
and snapshot keep the file's id (xer-parser.js:138; import.service.js:222-223), which is HR-S4's value ("recorded") and
HEAD's staging alike (the fallback to the project calendar is downstream, cpm.service.js:80-92). A200's file percent is
F1's phys_complete_pct 40 (inputs.F1), written to physComplete at activation (schedule.service.js:1645); search derives
its status from physComplete alone (search.service.js:223-228: 40 -> in_progress, no delayed branch), lookahead and the
XER export fall back to physComplete (lookahead.service.js:273; schedule-export.service.js:140, :255), and retrieval
writes `${physComplete}% complete` (retrieval.service.js:43). The values are the plan's (:551-552): 0 everywhere and the
status /activities derives (delayed).

`WP1.imports.twoProjectXer` is not changed: build/087-imp.js:438 interpolates its `today` as text, so the machine-readable
figures live on a new leaf.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP1.imports.twoProjectXerStaging` | none (literal 17 in KA.IMP.twoProjectXer) | value `{mergedRows: 0, rowsIfChosen: {CERT3-FIRST: 14, CERT3-SECOND: 3}}`; today `{http: 201, revisionStatus: draft, mergedRows: 17, imported: 17, activityCount: 17}`; ref HR-S4; assumption |
| `WP1.imports.secondCalendarIds` | none (literals '1' / '2' in KA.IMP.secondCalendar) | `{A100..M900: '1', A300: '2', A330: '2'}` (all 14 codes) |
| `WP1.status.A200fileFortyPercent.searchStatus` | none (literal in_progress) | `delayed` (= `.status`), today `in_progress`; ref HR-P5; assumption |
| `WP1.status.A200fileFortyPercent.lookaheadPct` | none (literal 40) | `0`, today `40`; ref HR-P5; assumption |
| `WP1.status.A200fileFortyPercent.exportXerPct` | none (literal 40) | `0`, today `40`; ref HR-P5; assumption |
| `WP1.status.A200fileFortyPercent.assistantText` | none (literal '40% complete') | `0% complete`, today `40% complete`; ref HR-P5; assumption |

## BOOK-7. The staged-import guard's catcher (M1)

Derivation: the mutation (a tx.activity.createMany after `revisionId = revision.id;`, import.service.js:350, inside
persistImport's transaction :319-351) makes every staging import write active rows. The WP-1 proof's
IMP.stagedNotApplied (X: the active activities' fingerprint and count around a staging import) sees them: red. The xlsx dry
run cannot catch it (it answers at import.service.js:587-604, before persistImport at :606), and on W the run stops at
REV.activate.full (setup error, exit 1) before activeEqualsStaged is read.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP1.mutations.stagedImportWrites` | `WP1.imports.xlsxDryRun / activeEqualsStaged red` | `IMP.stagedNotApplied red` (old value in note) |

## For the proof and the lists (no change made outside the book)

- REV.notCurrent reads `WP1.revisions.notCurrent` (its bookKey still names `WP1.revisions.activate.olderRevision`).
- DATES.endBeforeStart.update/.create read `WP1.dates.endBeforeStartRefused` (and `.zeroDurationCreate` for the 201).
- KA.IMP.twoProjectXer judges a fresh F4 staging against `WP1.imports.twoProjectXerStaging` (value / today);
  KA.IMP.secondCalendar's value branch is `WP1.imports.secondCalendarIds`.
- KA.STATUS.A200.search / lookahead / exportXer / assistant read the four `WP1.status.A200fileFortyPercent.*` surface
  leaves (value and today). Note: the book's search value is `delayed` (statuses agree, plan :551); the proof's draft also
  accepted `todo` there.
- REV.activate.full and REV.mapByCode.live read `WP1.revisions.activate.recordTwoHandBuilt`.
- T4_FILES.FSlead and the in-process FS lead read `WP1.T4.FSlead.inputs` (x 8 for hours); the mixed-calendar call reads
  `WP1.mixedCalendar.inputs`; the range files read `WP1.conversion.rangeBoundary.atMax` x 8 and `.beyondMaxInput`.
- The calendar probe reads `WP1.dates.calendarChange` (its `afterBaseline` branch on W after the lock).
- Not added (not in BOOK-1..7): leaves for the site engineer's refusals on activate / rollback / baseline (M6) and for
  "CPM runs inside the activation transaction" (M3).

Validation: `node --check` exit 0; the module loads (870 figures, the new load checks pass, no DB access);
`scratch/wp0/load-schedule.js`: "OK: leaf contract and cross-checks pass"; a scratch cross-check against `build/files.js`
(F1, F4, F6, the FS-lead model parsed back with the product's XER parser) and the product's pure `calculateCpm` /
`workingDayToDate`: every new figure agrees (F4 17 parsed rows; F6 ids; FS lead B ES 2 / EF 5; mixed B 2026-01-10;
36,500 / 36,501 days; M900 on five_day / seven_day with calendar id '1': 2026-04-28 / 2026-03-27). Bytes: UTF-8 without
BOM, no double-encoding; schedule.js LF, this file CRLF.

# WP-1 proof verification (2026-10-10, integration owner)

Applied by Claude Main after the read-only verifier of the WP-1 fix round (`C:\Temp\octapm-cert\scratch\wp1\verify\verify-report.md`). 3 leaves added, 2 `today` values added or corrected; no value changed.

| Key | Change | Derivation |
|---|---|---|
| WP1.revisions.roles.siteEngineerActivate | new: 403 FORBIDDEN | routes/schedule.js:242-245 `requirePermission('schedule', 'approve', { transition: 'revision.activate' })`; shared/permissions.json gives schedule.approve and revision.activate to the PM only; rbac.js:149-153 answers 403 FORBIDDEN before the service (plan :509). |
| WP1.revisions.roles.siteEngineerRollback | new: 403 FORBIDDEN | routes/schedule.js:300-303, transition revision.rollback (PM only); same refusal path. |
| WP1.baseline.siteEngineer | new: 403 FORBIDDEN | routes/schedule.js:396-399 and :421-424, `requirePermission('schedule', 'baseline', { transition: 'revision.baseline' })` (PM only); refused before the BOQ gates. |
| WP1.revisions.hrS3Reproduction.approve.today | corrected: exactly one blocking check fails, critical_path | The old text named date_sanity as well, true at 886c9f1; since f599e67 (HR-S2 decided and fixed) M900's start = finish passes date_sanity. Observed in WP-1 debug run 4 and 5. ref HR-S3. |
| WP1.revisions.rollback.A140id.today | new: A140 re-created with a new id, activityCode null, p6ActivityId 'A140'; the retired row stays inactive | rollbackRevision (schedule.service.js:3609-3726) re-activates the old snapshot through activateRevisionSnapshot; the retired A140 is not active, so no mapping pairs it and its staged row is created (:3280-3287). Observed on every build run (finding WP1-RB-1). ref WP1-RB-1. |

# WP-2 answer-book leaves (2026-10-10)

Binding source: `C:\Temp\octapm-cert\scratch\wp2\WP2-ADJUDICATION.md` (Q1-Q12; cited in the book as `WP2ADJ(...)`),
settling the answer-book gaps G1-G23 of `C:\Temp\octapm-cert\scratch\wp2\WP2-PREP.md` §9 (cited `PREP2(...)`). Applied
here: G1-G11, G15-G17, G22 and G23; the mutation leaves `dropMethodStands`, `removeNegativeGuard` and
`splitBulkTransaction` now name their catchers (G3/Q5, G2/Q4, G5). Rule A10 applies: every leaf below carries its
on-paper derivation in the book, worked from the product code at `f599e67` (`HF(file, lines)`; `backend/src`, `shared`
and `backend/prisma` in the worktree are identical to `f599e67`), from existing book keys, or from the deep-company
builders read at `fc29478` (new helper `BLD(file, lines)`). Plan lines are numbered at `f599e67` (`PF(...)`).

Figure count: schedule 873 -> 900 (+27). No key was removed. Ten existing leaves changed, each as the adjudication
directs and each recording what it was in its `note`: seven values (`WP2.rules.rejectWithoutReason`,
`WP2.quantitiesA310.entryRefusals.negative`, `WP2.quantityView.withoutBoqRead.reason`, `WP2.T4.siteVoid` and the three
mutation leaves), one value and `today` (`WP2.T4.probes.retroactiveTemplateEdit`), one derivation and `today`
(`WP2.T6.methodBypass`, value 409 unchanged) and one note only (`WP2.bulk.mixedBatch.written`). planDisagrees 5 -> 7
(G1, G2: the earlier codes kept as `planValue`), assumption 265 -> 270, leaves with a `today` 77 -> 77. No other leaf
changed (checked by a before/after dump of `figures()`: 863 leaves identical in every field; WP0, CLAUDE, WP1, WP3, D2
and D3 identical; `inputs`, `rules`, `meta` and the exports identical).

Leaf contract: as WP-1's. Both leaves changed here that carry a `today` (`retroactiveTemplateEdit`, `methodBypass`)
now name their `ref` (HR-Q2, HR-P2) and are `assumption: true` (checked at load).

New helpers in schedule.js (data, not leaves): `WP2ADJ`, `PREP2`, `BLD`; `FLD_ITP` (087-FLD's form ITP and its six
instances as the build makes them), `fldHoldsOn` (form.service's hold-point rule restated, in the builder's `holdsOn`
shape), `FLD_HOLDS_V1`, `FLD_HOLDS_V2`, `METHOD_STANDS`, `METHOD_BYPASS`, `METHOD_BYPASS_PCT`, `EV_AFTER_IMPORT`; and a
block of load checks after `WP2` that ties every new or changed leaf to the figures it is built from (the book refuses to
load otherwise; each check was shown to fire by a mutant).

## G1. Reject without a reason (adjudication Q7; WP-1 BOOK-3 precedent)

Derivation: POST .../activities/:id/progress-submissions/:submissionId/reject with no reason is answered by the route,
not the service: `body('reason').isString().trim().notEmpty()` (routes/activities.js:492) and `validate` (:493;
middleware/validate.js:14-25) give 400 VALIDATION_ERROR, message 'Validation failed', error.details holding an entry
whose field is 'reason' (message 'Invalid value'; details are sent outside production, error-handler.js:306).
REJECTION_REASON_REQUIRED (progress.service.js:2288-2295) is unreachable through the API.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.rules.rejectWithoutReason` | `400 REJECTION_REASON_REQUIRED` | `400 VALIDATION_ERROR`, planValue `400 REJECTION_REASON_REQUIRED`, note `details.field=reason` |

## G2. The negative quantity (adjudication Q4 (a) + (b), Q8)

Derivation: the POST /quantity-progress entry validator refuses -5 before the service, 'must be zero or more'
(routes/quantity-progress.js:48-53): 400 VALIDATION_ERROR, error.details field 'quantity' for a single-entry body
('entries[0].quantity' under entries[]). The service's 400 QUANTITY_NEGATIVE (quantity-progress.service.js:489-491,
details.field 'entries[0].quantity') answers only in process: quantityProgressService.createEntries on P as the site
engineer (:588-600 -> :430-574), before any write. It is the only catcher of the service guard removed alone (N2).
Behind both layers the database keeps a third: CHECK QuantityProgressEntry_quantity_nonnegative
(migration 20261005050000_quantity_progress:205).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.quantitiesA310.entryRefusals.negative` | `400 QUANTITY_NEGATIVE` | `400 VALIDATION_ERROR`, planValue `400 QUANTITY_NEGATIVE` (the plan's list :580 and the book's earlier value), note `details.field=quantity` |
| `WP2.quantitiesA310.entryRefusals.negativeService` | none | `400 QUANTITY_NEGATIVE` (in process; check `QTY.entry.negative.service`) |
| `WP2.mutations.removeNegativeGuard` | `WP2.quantitiesA310.entryRefusals.negative red` | `QTY.entry.negative red (N3, the E6 entry; N1 too); QTY.entry.negative.service red (N2)` |

Expected observation under the mutations (not a stored entry): N3 (both application layers removed) meets the database
CHECK, so the API is expected to answer a 5xx (an unlisted database error maps to 500 INTERNAL_ERROR,
error-handler.js:244-255) and nothing is stored; N2's in-process probe gets a database error instead of the HttpError.
Both are red. WP2-PREP §7 and `wp2-mutations-draft.json` describe N3 as "201, -5 stored"; that description should be
corrected (the catch is unaffected).

## G3. The method-stands check's catcher (adjudication Q5)

Derivation: on P, A220 has no method row (METHODS_087SCH names none), no allocation (S-006 stays unallocated on P) and
no ITP instance, and the site engineer is assigned. The site engineer submits percent 10: with no row the client's
method is taken (progress.service.js:1516-1518). The planner PUTs A220 to quantity m2: allowed, because
assertMethodChangeAllowed reads approved progress only (:1023-1036). The QS approves: the method row is read again
(:2063-2064) and assertSubmissionMethodStands (:2065 -> :1545-1561) refuses 409 PROGRESS_METHOD_MISMATCH, details
{ activityId, effectiveMethod 'quantity', effectiveMethodBasis 'method_config', requestedMethod 'percent',
submissionId } (:1555-1560), before the one writer (:2171). The transaction rolls back (:2254-2255): A220 stays at 0.
With the mutation (`void configRow;`) the approval writes 10% (the quantity steps follow the submission's own method,
:2111-2147): METHOD.stands red, while QTY.percentMethod (the submit-time rule) stays green and remains its own check.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.methodStands.choreography` | none | the A220 sequence above (assumption) |
| `WP2.methodStands.approve` | none | `409 PROGRESS_METHOD_MISMATCH` |
| `WP2.methodStands.detailsSubmissionId` | none | `true` |
| `WP2.methodStands.official` | none | `0` percent |
| `WP2.mutations.dropMethodStands` | `WP2.quantitiesA310.percentMethod red` | `METHOD.stands red` |

## G4. The withheld view: route, reason text, member, item route (adjudication Q7)

Derivation: the 200-with-withheld answer is GET /activities/<A310>/quantities (schedule:read, routes/activities.js:
253-269; withheldActivityQuantities, boq-figures.js:1859-1884). Its `reason` is the text held by the constant
QUANTITY_FIGURES_WITHHELD (boq-figures.js:1834-1835, exported :2333), compared by importing the constant. The member is
087-EXTRAS's T-NOBOQ site engineer on 087-SCH (build/087-extras.js:79, :139-159, :184-195; the template decides before
the role, rbac.js:50-68). GET /boq/items/<S-003>/quantities is guarded by boq:read (routes/boq.js:318-339), so the same
member is refused 403 FORBIDDEN, details source 'template' (rbac.js:138-165).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.quantityView.withoutBoqRead.reason` | `QUANTITY_FIGURES_WITHHELD` | `Installed, certified, paid, received, issued and committed quantities are worked from the BOQ's rows, available only to members who may read the BOQ` (old value in note; no planValue: the plan's word names the constant) |
| `WP2.quantityView.withoutBoqRead.route` | none | `GET /projects/:projectId/activities/<A310>/quantities` |
| `WP2.quantityView.withoutBoqRead.member` | none | the 087-EXTRAS T-NOBOQ member on 087-SCH (people.noBoq, tariq.okafor.2) |
| `WP2.quantityView.withoutBoqRead.itemRoute` | none | `403 FORBIDDEN` |

## G5, G6. The bulk batch: its catcher and its order (adjudication Q7)

Derivation: bulkUpdateProgress writes the batch in one transaction (activity.service.js:797-826); the writer refuses
update 1 (A310 percent, PROGRESS_METHOD_MISMATCH, progress.service.js:1516-1529) and the throw rolls update 0 back.
details.batch.written is the constant 0 in every refusal (:783, :819), so only A330's submission count shows a split.
The order binds once HR-P1 is fixed: the batch runs before T6, when A330's official progress is 0 (T2's planner
submission at 30 is still pending), so update 0 at 10 is not a lower figure and cannot mask the method refusal.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.bulk.mixedBatch.a330SubmissionsDelta` | none | `0` (A330's submissions before = after; the catcher, BULK.mixed.count) |
| `WP2.bulk.mixedBatch.choreography` | none | before T6, the planner's [A330 {pctComplete 10}, A310 {method percent, pctComplete 10}], A330 official 0 (assumption) |
| `WP2.bulk.mixedBatch.written` | value 0, no note | value 0 unchanged; note: the constant 0, see a330SubmissionsDelta |
| `WP2.mutations.splitBulkTransaction` | `WP2.bulk.mixedBatch.written red` | `BULK.mixed.count red` |

## G7, G8. The daily report: approver, hold instance, release (adjudication Q7)

Derivation: POST .../daily-reports/:reportId/approve is guarded by progress.approve + daily_report.approve
(routes/daily-reports.js:252-268); shared/permissions.json gives the transition to pm only, so the planning engineer and
the QS (who hold progress.approve) are refused 403 FORBIDDEN (rbac.js:138-165); the WP-0 probe observed it. The
progressLine note is promoted to leaves: the approval runs the one writer on the report's own activity
(daily-report.service.js:994-1005 -> progress.service.js:2084-2098), so the 409 needs an ITP instance on A320 itself
(scheduled counts, form.service.js:1416-1431); it is released in the form HR-Q1 keeps (a completed instance, hold item
passed), valid before and after the HR-Q1 fix.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.dailyReport.approver` | none | `pm` |
| `WP2.dailyReport.plannerApprove` | none | `403 FORBIDDEN` |
| `WP2.dailyReport.qsApprove` | none | `403 FORBIDDEN` |
| `WP2.dailyReport.holdInstance` | none (note on progressLine) | a T-HOLD form ITP instance on A320, scheduled: 1 open, pending (assumption) |
| `WP2.dailyReport.release` | none | started, hold answered 'pass', completed: 0 open on A320 |

## G9. The retroactive template edit, per activity (adjudication Q7, Q11)

Derivation: 087-FLD's form ITP version 1 has two hold items; its six instances (build/087-fld.js:1186-1233) are A110
scheduled and in progress (holds unanswered), A120 complete (hold 1 'fail', hold 2 'pass'), A140 void, A150 closed and
A170 complete (both passed). openHoldPoints reads the hold items of the instance's template id, any non-void status
(form.service.js:1416-1431; pass/na/yes/checked pass, fail/no fail, :34-35, :808-825). The edit adds a third hold item
to the same template (:1267-1290). HR-Q2's recommendation (gate on the instance's own version) leaves the before-edit
figures; HEAD reads the current template, so the new item is open on every non-void instance. The 2026-10-10 build run
stored exactly the `today` figures (state/cert3/087-FLD.json itp.template-edit afterEdit; corroboration only).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.T4.probes.retroactiveTemplateEdit` | value `gate reads the instance's own template version`, today `gates read the current template` | value `{A100 {0,[]}, A110 {4, 4 x pending}, A120 {1,[failed]}, A140 {0}, A150 {0}, A170 {0}}`; today `{A100 {0}, A110 {6, 6 x pending}, A120 {2,[failed,pending]}, A140 {0}, A150 {1,[pending]}, A170 {1,[pending]}}`; ref HR-Q2; assumption |
| `WP2.T4.probes.retroactiveBeforeEdit` | none | the value's figures, as the build stores them (itp.holds.before-edit, asserted at its moment) |

## G10. The progress import on P (adjudication Q1, Q7)

Derivation (import.service.js importProgress :715): the site engineer's second upload finds the first upload's A110 70
and A130 50 submissions waiting at the same figure and cannot approve: already_pending (:768-770, :847-862); A310's
percent row is refused by the method rule first (:786-796, :828-833). The PM's upload approves the waiting A110
submission rather than making a second (approvesPending, :834-846, :1045-1049, writer :1079-1092); A130's is left
pending by the hold (:1093-1100). Project EV after it, in WP2-PREP §5.1's order: 151,800.00 (Q320) + 18,000.00 =
169,800.00 (BULK, T5, T6 and METHOD.stands move no allocated activity).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.importProgress.site.reuploadRows` | none | `{A110: already_pending, A130: already_pending, A310: refused}` |
| `WP2.importProgress.pm.A110approvesPending` | none | `true` |
| `WP2.importProgress.pm.projectEvAfter` | none | `16980000` cents = 169,800.00 (assumption: the §5.1 order) |

## G11. The site engineer's void (adjudication Q7)

Derivation: POST .../forms/:instanceId/void is guarded by inspection.approve + inspection.void (routes/forms.js:183-188);
the site engineer holds neither: 403 FORBIDDEN (rbac.js:138-165); the WP-0 probe observed it.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.T4.siteVoid` | `403` (bare status) | `403 FORBIDDEN` |

## G15. 087-SCH's end state (optional; adjudication Q7)

Derivation: the 087-SCH build approves progress on A310 only (build/087-sch.js:801-1043: every claim is on A310), ending
at 570 m2 (MOMENT-MAP row 40); its A130 instance stays scheduled and unanswered (:801-838). No fixed check depends on
these leaves (read live for the record).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.endState087SCH.projectEv` | none | `8550000` cents = 85,500.00 (= `WP2.quantitiesA310.dailyLog.evA310`) |
| `WP2.endState087SCH.A320official` | none | `0` percent |
| `WP2.endState087SCH.A130openHolds` | none | `1` (= `WP2.T4.openList`) |

## G16. The EV report's 2 dp percent (adjudication Q7)

Derivation: the EV report's activity row rounds pct to 2 dp (earned-value.service.js:827, copied :1023) while EV uses the
unrounded figure (:790-792); `WP2.quantitiesA310.dailyLog.pct` (63.333..., 3 dp) is read on GET /activities/<A310>, as
the builder does (087-sch.js:1014-1015). The build's stored qty.dailylog570 out shows pct 63.33.

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.quantitiesA310.dailyLog.evReportPct` | none | `63.33` percent |

## G17. The T3 evidence shape (adjudication Q3, Q7)

Derivation: the site engineer's upload answer (file-storage.service.js serializeUploadedDocument :696-717) put into
evidence.photos[]; the writer accepts key, documentId and fileName (progress.service.js EVIDENCE_PHOTO_FIELDS :168-175)
and matches key and documentId to this project's documents (prepareEvidence :585-650). The canonical stored-document
shape is valid before and after the HR-X1 batch (Q3: both formats accepted during the transition).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.T3.withDocument.evidence` | none | `{photos: [{key: <upload.key>, documentId: <upload.documentId>, fileName: <upload.fileName>}]}` |

## G22. The site engineer on A330 (adjudication Q7)

Derivation: assertProgressSubmitAllowed refuses with details { activityIds: the unassigned ids } (progress.service.js:
917-959, :951-958) before the submission row is created (:1871-1877 before :1889, one transaction).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.T2.siteOnA330ActivityIds` | none | `["A330"]` (mapped to the id by the check) |
| `WP2.T2.siteOnA330SubmissionsDelta` | none | `0` |

## G23. The HR-P2 probe typed 30 of 100 (adjudication Q7)

Derivation: A300 has no method row and no allocation; after percent 20 is approved, a typed quantity is taken under the
client's method (progress.service.js:1516-1518; the approval asks nothing without a row, :1545-1546) and planned figure
(deriveQuantityFigures :1422-1450): 30 / 100 = 30%. 30% is above the approved 20%, so HR-P1's lower-figure rule, once
fixed, cannot answer first and mask HR-P2 (10 of 100 would have been refused as a lower figure).

| Key (schedule.js) | Old | New |
|---|---|---|
| `WP2.T6.methodBypass` | value 409; probe typed 10 of 100; today `200; approval makes 10% official under quantity` | value 409 (code null) unchanged; probe typed 30 of 100; today `200; approval makes 30% official under quantity (A300's official figure moves 20 -> 30 and its method from percent to quantity)`; ref HR-P2 |
| `WP2.T6.methodBypassInputs` | none | `{activity: A300, approvedPercent: 20, quantityComplete: 30, quantityPlanned: 100}` (assumption) |

## Not applied here

- G12, G13 (HR-P1, HR-Q1 contracts): wait for the fix plan's Codex review and its adjudication (Q2). `T6.olderLower.*`,
  `Q320.typed40.reasonRequired`, `T4.hrQ1.*` keep their current leaves until then.
- G19 (text-only evidence after HR-X1): the owner decided the batch (Q3, 2026-10-10); what text-only evidence answers is
  part of the batch fix plan's review, so no contract is written yet. Note: `WP2.confirmFirst.textOnlyEvidence`'s value
  ("not evidence: at least one stored project document is required") predates the transition rule (both formats accepted)
  and is for that review to confirm or change.
- G14 (052 live end state): not added (Q9).
- G18 (`WP2.personas`): not added; Q6 drops the seven PERSONA.* checks (no new matrices), so the leaves would have no
  reader. The plan-named role cases already have leaves (T1.siteApprove, T2.*, T4.siteVoid, dailyReport.approver).
- G20 (`WP2.rules.concurrentApprove`): not needed; Q8 adopts CONC.approveTwice only if nothing else catches the idempotent
  approval mutation, and T1.approveAgain does (WP2-PREP §7 P4).
- G21 (plan citations): the new and changed leaves cite PF (f599e67 numbering). The existing WP2 / D2.WP2 `P(...)`
  citations are left as they are (refreshing them would change the source of about 130 leaves). Mapping, by identical
  line text (tools/plan-map.json): book :27/:28/:31 -> :47/:48/:51 (+20); every other cited line (:366-:1012) +39 (e.g.
  :548 -> :587, :997 -> :1036). The worktree plan now also carries the owner's HR-X1 scope line at :52 (uncommitted), so
  the worktree numbering is PF + 1 from :52 on.

## For the proof and the lists (no change made outside the book)

- METHOD.stands reads `WP2.methodStands.*` (it had no leaf); VIEW.itemRoute reads
  `WP2.quantityView.withoutBoqRead.itemRoute`; VIEW.withheld.reason compares with the imported constant (the leaf restates
  it); QTY.entry.negative.service reads `entryRefusals.negativeService`.
- BULK.mixed.count reads `WP2.bulk.mixedBatch.a330SubmissionsDelta` (its bookKey still names `.written`).
- KA.T4.retroactive judges the live 087-FLD reading against `retroactiveTemplateEdit` value / today (objects in the
  builder's holdsOn shape); FLD.beforeEdit reads `retroactiveBeforeEdit`.
- IMP.site.reupload reads `importProgress.site.reuploadRows`; the PM import reads `pm.A110approvesPending` and
  `pm.projectEvAfter`.
- T4.void.site expects `403 FORBIDDEN`; KA.T6.methodBypass sends `WP2.T6.methodBypassInputs` (30 of 100).
- Red at HEAD before the fixes, from the book side: RULES.rejectWithoutReason and QTY.entry.negative now expect HEAD's
  answer, and METHOD.stands, VIEW.itemRoute have leaves; D2.live has none (G14 not added). What stays red is the HR-Q1 and
  HR-P1 rows (T4.hrQ1.*, T6.olderLower.*, Q320.typed40.reasonRequired).
- `wp2-mutations-draft.json` N3 (and WP2-PREP §7): the expected observation is a database refusal (5xx), not "201, -5
  stored" (see G2).

Validation (scratch `C:\Temp\octapm-cert\scratch\wp2\book\`): `book-insert.js` applied to a copy of schedule.js at
fc29478 (sha256 a097bd35...): 22 exact-anchor edits, each counted once before any write; `node --check` exit 0; the copy
loads (900 figures, the new load checks pass, no DB access); `verify.js`: no key removed, 27 new keys exactly the expected
list, 10 changed keys each with exactly the expected fields, 863 identical, other sections, inputs, rules, meta
identical, LF only, non-ASCII count unchanged, no double-encoding, a second run refused; `teeth.js`: 13 mutants of the new
leaves and models each refused at load by its own check; the WP-0 load test (`scratch/wp0/load-schedule.js`, adapted
path): "OK: leaf contract and cross-checks pass" on the copy before and after; `tools/refusal-test.js`: a repeated
anchor, a missing anchor and the same input/output path are refused with nothing written. Bytes: book-insert.js and the
patched copy UTF-8 without BOM, no double-encoding, schedule.js LF; every inserted line ASCII.

# WP-3 answer-book leaves (2026-10-10)

Binding source: `C:\Temp\octapm-cert\scratch\wp3\WP3-ADJUDICATION.md` (Q1-Q16; cited in the book as `WP3ADJ(...)`),
settling the answer-book gaps G1-G21 of `C:\Temp\octapm-cert\scratch\wp3\WP3-PREP.md` section 10 (cited `PREP3(...)`).
Applied here: G1-G14 and G16-G21, as the adjudication rules them: G14 `DP.halfHour` adopted (Q9); G9 HEAD's behaviour for
loadings (Q11); G6 the T-NOBOQ member (Q6); L34's contract-visible leaves (formulaVersion, actualCostSource, the basis
texts) marked `contract pending the L34 plan review` (Q5); the STORED-PRE-FIX reading of Q3 as a rule leaf (G12). G15
(plan citations) is a citation convention, applied to the new and changed leaves only (below). Rule A10 applies: every
leaf below carries its on-paper derivation in the book, worked from the product code at `f599e67` (`HF(file, lines)`;
`backend/src`, `shared` and `backend/prisma` at HEAD `114e9f1` are identical to `f599e67`), from existing book keys, or
from the deep-company builders read at `fc29478` (`BLD(file, lines)`; the build scripts are unchanged since, the moment
map has one appended line). Plan lines are numbered at `f599e67` (`PF(...)`).

Input: `answers/schedule.js` at HEAD `114e9f1`, sha256
`6ffc7689aa40b5ec1f50f4d47042e770826bcb8c9e2b63e680cc6ea71251e1c0` (the working tree's file is the same). Output of
`book-insert.js` on a copy: sha256 `f0957af2a9e3d31818c07b17584ba1fbc17aef97e71242b3cd6a72cad7dc40b9`. Only
`schedule.js` changes: no WP-3 leaf belongs in `commercial.js` or `field-controls.js` (they mention WP3 only in text:
`commercial.js` D3's assumption note, `field-controls.js` 087-HLT's zone, both unchanged).

Figure count: schedule 900 -> 965 (+65; WP3 256 -> 321). No key was removed. Seventeen existing leaves changed, each as
the adjudication directs and each recording in its `note` what changed (a changed value keeps its old value there): five
values (`WP3.forecast.siteEngineerMoney` and the four `WP3.mutations` leaves), one value and `today`
(`WP3.periods.concurrentLocks`), one value, unit, assumption and `today` (`WP3.forecast.L106budgetLines`), derivations
and sources of eight (`WP3.T5.deleteProbe`, `WP3.periods.feb.overriddenAuditEvents`,
`WP3.periods.afterLock.relockSameSnapshotId` / `relockSameLockedAt` / `loadingInLockedPeriod`,
`WP3.periods.futureCutoffLock`, `WP3.forecast.evBasedFinish`), `ref` and `assumption` of two (`WP3.T4.ev0.eac`,
`eacBasis`) and one note (`D2.WP3.T4`). Refs added to three existing todays (`T5.deleteProbe` L112, `futureCutoffLock`
HR-E2, `concurrentLocks` CONCURRENT). planDisagrees 7 -> 8 (`WP3.forecast.siteEngineerWithBoqRead`, planValue "no money
fields"), assumption 270 -> 285, leaves with a `today` 77 -> 89, with a `ref` 10 -> 28. No other leaf changed (checked
by a before/after dump of `figures()`: 883 leaves identical in every field; WP0, CLAUDE, WP1, WP2 and D3 identical, D2
identical but for `D2.WP3.T4`'s note; `inputs`, `rules`, `meta` and the exports identical). No leaf a builder reads
changed its value or today (`build/087-ev.js` reads `WP3.T5.deleteProbe` value and today: both unchanged; `052-sch-ev.js`
names `D2.WP3.T4` in a note only).

Leaf contract: as WP-1's and WP-2's. Every new or changed leaf that carries a `today` names its `ref`; under an undecided
row (HR-E2, L106, L112, CONCURRENT) it is `assumption: true`; under L34 (decided in CERT-3, fixed in WP-3) a figure leaf
is not an assumption, and the three contract-pending L34 leaves are. Checked at load.

New helpers in schedule.js (data, not leaves): `WP3ADJ`, `PREP3`; `V_EV` (V's records, in currency units) and its models
`V_ALLOC`, `V_BAC`, `vPvAt`, `V_EV_T4`, `V_T4_READS`, `V_T4_INPUTS`, `V_T4_SERVES`, `V_PERIOD_A`, `V_LOADINGS`,
`V_ROWS_LOCK`, `V_ROWS_AFTER`, `M_VA_LOCK` / `_HEAD`, `M_VA_AFTER` / `_HEAD`, `V_RUN_AC`, `V_FORECAST_SPI`,
`V_PLANNED_FINISH`, `V_EV_FINISH`, `V_EV_AFTER_APPROVAL`, `V_L112_BAC`; `HALF_HOUR`; `L34_PENDING`,
`FC_WITHHELD_REASON`; `refToday`, `vPeriodLeaves`, `V_STEPS`, `L34_TODAY_KEYS`, `l34HeadDiff`, `L34_STORED_LEAVES`;
the subtrees `WP3_V`, `WP3_L34`, `WP3_CF` (joined to `WP3` as `V`, `L34`, `confirmFirst`); and a block of load checks
after `D2` that ties every new or changed leaf to the figures it is built from (the book refuses to load otherwise; each
check was shown to fire by a mutant, 28 in all). Every figure is worked with the book's own rules (`evMetrics`,
`acLedger`, `acHead`, `endOfLocalDay`, `defaultPeriod`, `forecastEvFinish`); V's key figures are also pinned to
`C:\Temp\octapm-cert\scratch\wp3\derive-v.json` (worked independently from the same rules, the half-hour cutoffs
cross-checked there against the product's pure `resolveReportingCutoff`).

## G1. T4 on V, through the report (adjudication Q2)

Derivation: the SPI and CPI alert flags exist only in `buildOfficialEvReport` (earned-value.service.js:953-956) and, for
legacy snapshots, `snapshotToReport` (:688-691); the exported `computeEvMetrics` (:219-245) has no flag. So T4 reads
GET .../reports/ev on V's live records through the in-process app. Four reads give exactly the inputs the T4 leaves are
worked from (`EVT4`, unchanged): the load check runs `evMetrics` on each read and compares every field with `EVT4`, and
checks that HEAD's cumulative AC equals the ledger at each read (T4 carries no L34 today).

| Key | Old | New |
|---|---|---|
| `WP3.T4.fixture` | none | V, steps V6-V13; reader the cost controller; read1-read3 at the Cairo run date, read4 at 2026-01-31; the sets each serves (assumption) |
| `WP3.T4.inputs.read1` | none | BAC 38,700,000; PV 0; EV 9,000,000; AC 10,000,000 (cents) -> pv0 |
| `WP3.T4.inputs.read2` | none | PV 10,000,000; EV 9,000,000; AC 10,000,000 -> spi09, cpi09 |
| `WP3.T4.inputs.read3` | none | AC 10,000,100 -> ac100001 |
| `WP3.T4.inputs.read4` | none | PV 10,000,000; EV 0; AC 5,000,000 -> ev0 |

## G2-G4. The mutation leaves name their live catchers (adjudication Q10)

No stored moment can catch a mutation (WP3-PREP section 0 fact 4), so each leaf now names the live checks.

| Key | Old | New |
|---|---|---|
| `WP3.mutations.alertBoundary` | `WP3.T4.spi09.spiAlert red` | `T4.spi09.spiAlert red and T4.cpi09.cpiAlert red (M1, the E6 entry: both flags); T4.spi09.spiAlert red (M1a); T4.cpi09.cpiAlert red (M1b)` |
| `WP3.mutations.lockedRecomputed` | `WP3.periods.afterLock.periodReport red` | `EVL.febPeriod.hash red and PER.V.afterLock.periodHash red (M2, the E6 entry: the read path); PER.relock.jan, PER.relock.feb and PER.V.relock red (M2b: the relock path)` |
| `WP3.mutations.readinessSkipped` | `WP3.periods.financeWhileBlocked red` | `PER.V.financeBlocked red (M3, the E6 entry); PER.V.financeOverride red (M3b)` |
| `WP3.mutations.evNonApproved` | `WP3.T7 red` | `T7.live.hash red and KA.EVL.runDate wrong (M4, the E6 entry: EV read from every progress submission)`; the status-filter mutants (:742, :156) recorded as equivalent, with the reason, not run as evidence |

## G5. The relocks (adjudication Q1)

| Key | Old | New |
|---|---|---|
| `WP3.periods.afterLock.relockSameSnapshotId` / `relockSameLockedAt` | value true; "same id" / "Same lockedAt." | value true unchanged; derivation names the personas, the empty body, the path that returns before the gate (:1708-1710) and M2b's 409 |
| `WP3.periods.afterLock.relockProbes` | none | finance on 087-EV 2026-01; the PM on 087-EV 2026-02 and on V-A; each body `{}` |

## G6. The site engineer's money (adjudication Q6)

Derivation: GET /forecast answers `withheldForecast(forecast, boqFigureAccess(req))` (routes/forecast.js:33). A member
with neither `boq:read` (the T-NOBOQ template) nor `cost:read` (site_engineer) gets the cost block without its money and
mapping keys, budget lines without amounts, counts without atRisk, `withheld: true` with "Cost figures are not available
to you", and each activity's cost `{ withheld: true, reason }` (utils/boq-figures.js:169-172, :400-423, :488-513). A BOQ
reader gets the forecast as built (:489-491): owner decision E1, expected behaviour (Q6).

| Key | Old | New |
|---|---|---|
| `WP3.forecast.siteEngineerMoney` | `no money fields` | the T-NOBOQ member's withheld view: `{ costWithheld: true, costReason, costKeysAbsent [budget, bac, eac, bottomUp, projected, overrun, overrunPct, actual, eacBasis, topRisks], budgetLineKeysAbsent [...6], countsAtRiskAbsent: true, activityCost: { withheld: true, reason } }` |
| `WP3.forecast.siteEngineerMoneyMember` | none | 087-EXTRAS, tariq.okafor.2, site_engineer, T-NOBOQ, on 087-SCH |
| `WP3.forecast.siteEngineerWithBoqRead` | none | `the forecast as built: money present`, planValue `no money fields` |

## G7. The EV-based finish on V (adjudication Q1, Q2)

| Key | Old | New |
|---|---|---|
| `WP3.forecast.evBasedFinish` | 2026-07-31 | 2026-07-31 unchanged; derivation: V after V14, `buildForecast({ asOf: 2026-06-01 })` in process, SPI from the EV report at the real run date (loadContext :336; no period on V yet), planned finish X3's 2026-07-01 |
| `WP3.forecast.evBasedFinishInputs` | none | `{ project: V after V14, asOf 2026-06-01T00:00:00.000Z, plannedFinish 2026-07-01, spi 0.5, call, field schedule.evBasedFinish }` |

## G8. L106 (adjudication Q7)

Derivation: one budget line on 02-100 (originalBudget 100,000.00, nothing else) on V before any cost. The register emits
`revisedBudget` (budget.service.js:177) and a forecast of 100,000.00 (:146): no overrun, so `cost.budgetLines` is [].
`budgetLineRisks` reads `line.revised` (forecast.service.js:530): 0, so HEAD reports one line, overrun 100,000.00,
overrunPct null, level medium. L106 is on the plan's defect-fix list: fixed in WP-3 only if it confirms as P1 (Q7).

| Key | Old | New |
|---|---|---|
| `WP3.forecast.L106budgetLines` | 0 (count); today `1 line {revised: 0, forecast: 100,000, overrun: 100,000.00} (reads line.revised)` | `[]` (list); today `[{ costCode 02-100, revised 0, committed 0, actual 0, forecast 10,000,000, overrun 10,000,000, overrunPct null, level medium }]` (cents); ref L106; assumption |
| `WP3.forecast.L106counts` | none | 0; today 1; ref L106 |
| `WP3.forecast.L106fixture` | none | V, V5 before any cost; the 02-100 line; the PM's GET /forecast |

## G9. A loading in a locked period (adjudication Q11)

| Key | Old | New |
|---|---|---|
| `WP3.periods.afterLock.loadingInLockedPeriod` | `409 REPORTING_PERIOD_LOCKED`, "A cost loading in the locked period." | value unchanged; the loading names the period (`reportingPeriodId`, :1354-1357 -> :1319-1339 -> :1231-1239); a date-only loading is accepted at HEAD; a date rule would be a rule change, recorded for the owner, not probed on 087-EV |
| `WP3.periods.afterLock.loadingInLockedPeriodRequest` | none | the cost controller, A110, the locked 2026-02, plannedDate 2026-02-20, 1,000.00; loading count unchanged |

## G10. The lock before the cutoff, on V (adjudication Q1)

| Key | Old | New |
|---|---|---|
| `WP3.periods.futureCutoffLock` | 409 (code null), today 200 | unchanged; located on V-F = `rules.futurePeriodFor(<Cairo run date>)`, the PM with a reason; ref HR-E2 |

## G11. The February override's audit event

| Key | Old | New |
|---|---|---|
| `WP3.periods.feb.overriddenAuditEvents` | 1 | 1 unchanged; the lock's audit write (:1807-1836), the filter, the build's reason |
| `WP3.periods.feb.overriddenAuditFilter` | none | `{ query: { entityType project_setup_readiness, action overridden, source audit }, match: { summary.periodId, reason }, count: 1 }` |

## G12, G21. L34: the rule, the STORED-PRE-FIX reading, the contract pending its plan review (adjudication Q3, Q4, Q5)

| Key | Old | New |
|---|---|---|
| `WP3.L34.acRule` | none | AC to a cutoff = the sum of the project's cost-ledger entries that carry an activity, dated incurredOn on or before the cutoff date (HR-E1; L34 decided in CERT-3) |
| `WP3.L34.isActiveFilter` | none | kept: active activities only (Q4); HR-S9 unmoved |
| `WP3.L34.reversals` | none | a reversal counts at the original's incurredOn (cost-ledger.service.js:414) (assumption; L34-M3's leaf) |
| `WP3.L34.formulaVersion` | none | `contract pending the L34 plan review`; today `ev.v2`; ref L34 (proposed ev.v3) |
| `WP3.L34.actualCostSource` | none | pending; today `{ actualCostSource: cost_record.actual_through_date, officialSourcePriority: [...] }`; ref L34 |
| `WP3.L34.basisTexts` | none | pending; today the three HEAD texts (basis.ac, basis.actualCosts, the missing-actuals warning); ref L34 |
| `WP3.L34.storedPreFix` | none | `{ verdict: STORED-PRE-FIX, appliesTo, judged, strict, leaves: [18 keys] }` |

STORED-PRE-FIX (Q3 (b) + (c)): an observation from a stored build moment or a frozen snapshot whose build predates the
L34 fix commit is judged against the leaf's today: equal is STORED-PRE-FIX (reported with the register link to L34, not
a WP-3 failure), the value is value, anything else is wrong. Live and fresh observations (an open report recomputed now,
a period locked after the fix, every read on V) are strict, and the exit run's rebuild (plan section 7 step 5) judges
every moment on the value. The 18 leaves: `WP3.T3.ac/cv/etc/acNote`, `WP3.periods.feb.snapshot.ac/cv/etc`,
`WP3.periods.jan.snapshot.ac/cpi/cpiAlert/eacBasis/cv/etc`, `WP3.periods.afterLock.cutoffReportAc`,
`WP3.periods.afterLock.cutoffAfterCost.ac/cv/etc`, `D2.WP3.T3.ac` (checked at load to be exactly the stored and frozen
leaves with an L34 today). Their todays are kept after the fix, since STORED-PRE-FIX compares with them (G21's "today
cleared once fixed" is not applied: see the open question below).

## G13. V's records and figures (adjudication Q1, Q13)

| Key | Value |
|---|---|
| `WP3.V.inputs` | V's records (`V_EV`; assumption) |
| `WP3.V.choreography` | V0-V25 and the end, 27 steps (assumption) |
| `WP3.V.reportingGateReady` | false (assumption; the 409 precondition) |
| `WP3.V.cutoffA` | 2026-02-28T21:59:59.999Z |
| `WP3.V.bac` | 38,700,000 (= WP3.T1.bac) |
| `WP3.V.runDateAc` | { afterT4 10,000,100, afterL34Costs 13,000,100, afterBackdated 13,500,100 } |
| `WP3.V.forecastSpi` | 0.5 |
| `WP3.V.lockA.*` (13) | V-A at the PM's override lock: BAC 38,700,000, PV 10,000,000, EV 0, AC 12,000,100 (today 10,000,100, L34), SPI 0 alert, CPI 0 alert, EAC = BAC budget_cpi_zero, SV -10,000,000, CV -12,000,100 (today -10,000,100), ETC 26,699,900 (today 28,699,900) |
| `WP3.V.cutoffAfter.*` (13) | the 2026-02-28 read after X1 5,000.00 dated 02-15: AC 12,500,100 (today 10,500,100), CV -12,500,100 (today -10,500,100), ETC 26,199,900 (today 28,199,900); the rest as lockA |
| `WP3.V.evAfterNewApproval` | 10,970,000 |
| `WP3.V.l112.bac` | { before 38,700,000, afterApproval 40,000,000, afterEdit 40,700,000, afterDelete 38,700,000 } |
| `WP3.V.l112.edit` / `delete` | `refused_or_audited`; today the silent 200s; ref L112 |

## G14. The half-hour zones (adjudication Q9: adopted, in the fixed count)

| Key | Value |
|---|---|
| `WP3.periods.halfHourZones.kolkata.cutoff` | 2026-02-28T18:29:59.999Z (UTC+05:30) |
| `WP3.periods.halfHourZones.kolkata.defaultJustBefore` / `defaultAtCutoff` | 2026-01 / 2026-02 |
| `WP3.periods.halfHourZones.kathmandu.cutoff` | 2026-02-28T18:14:59.999Z (UTC+05:45) |
| `WP3.periods.halfHourZones.kathmandu.defaultJustBefore` / `defaultAtCutoff` | 2026-01 / 2026-02 |

The default-period probes inject now = the cutoff minus 1 ms and the cutoff itself, over 087-EV's two fixed periods: the
flip is exactly at the end of the local day (`pickDefaultReportingPeriod` passes over a period only when its cutoff is
after now, earned-value.service.js:417).

## G16. The T5 delete probe (adjudication Q8)

| Key | Old | New |
|---|---|---|
| `WP3.T5.deleteProbe` | `refused_or_audited`; today `silent delete; BAC back to 387,000.00` | unchanged value and today; the PM is the prober (the cost controller would be refused for approval authority, not L112); a refusal's code null; ref L112 |

## G17. Concurrent locks (adjudication Q12)

| Key | Old | New |
|---|---|---|
| `WP3.periods.concurrentLocks` | `{ succeeded: 1, refused: { status: 409, code: null } }`; today "not established ... reproduce" | `{ succeeded: 1, refused: { status: 409, code: null }, snapshotRows: 1, overriddenAuditEvents: 1 }`; today `{ succeeded: 2, refused: null, snapshotRows: 1, overriddenAuditEvents: 2 }` (code-derived, to be confirmed by the primary run); ref CONCURRENT; on V-B; non-overlapping sends are a setup error (R-SET) |

## G18, G19, G20

- G18: `D2.WP3.T4` keeps its value `as WP3.T4`; its note says V's T4 serves it (no separate 052 check, MOMENT-MAP row
  245). `CLAUDE.SPI/CPI/EAC` are unchanged; a load check ties them to `WP3.T1` / `WP3.T2` (EVS.T1 / EVS.T2 assert them).
- G19: `WP3.T4.ev0.eac` and `eacBasis` gain `ref: 'HR-E3'` and `assumption: true`, values unchanged (HEAD equals HR-E3's
  recommendation; owner question Q15; CF.HRE3 reported until decided).
- G20: `WP3.confirmFirst.zoneChange` (no path changes a company zone after creation; a project keeps its copied zone;
  WP3-TZ-1 REJECTED, Q14) and `WP3.confirmFirst.zonePrecedence` (`{ timeZone: Africa/Cairo, source: project }`, the pure
  `resolveReportingTimeZone` with a different organisation zone).

## G15. Plan citations

The new and changed leaves cite PF (plan lines numbered at `f599e67`). The existing WP-3 `P(...)` citations are left as
they are (refreshing them would change the source of about 250 leaves): book `P(n)` in the WP-3 range is `PF(n + 39)`
(e.g. `P(598)` = `PF(637)`, T1), and the worktree plan at `114e9f1` is `PF + 1` from :52 on (the owner's HR-X1 scope
line), so WP3-PREP's "current" lines are `PF + 1` (WP-3 is PF :625-668, current :626-669).

## For the proof and the lists (no change made outside the book)

- `wp3-checks-draft.json` bookKeys: `KA.PER.V.lockAc` reads `WP3.V.lockA.*` (draft: "WP3.V.lockAc"),
  `PER.V.afterLock.cutoffChanges` reads `WP3.V.cutoffAfter.*`, `S.V.fixture` reads `WP3.V.inputs` / `choreography` /
  `reportingGateReady` / `bac` / `runDateAc`, `T4.inputs` reads `WP3.T4.inputs.read1-4` and `WP3.T4.fixture`,
  `DP.halfHour` reads `WP3.periods.halfHourZones.*` and is no longer optional (Q9; the count stays 92 + G.5xx = 93),
  `FC.siteEngineerMoney` reads `siteEngineerMoney`, `siteEngineerMoneyMember`, `siteEngineerWithBoqRead`, `KA.FC.L106`
  reads `L106budgetLines` (list, money in cents) and `L106counts`, `FC.evBasedFinish` reads `evBasedFinishInputs`,
  `CF.L112` reads `WP3.V.l112.*`, `CF.WP3TZ1` reads `WP3.confirmFirst.*`, `CF.L34` reads `WP3.L34.*`, and every stored or
  frozen L34 check (KA.EVS.T3, KA.EVS.febOpen, KA.EVS.febSnapshot, KA.EVS.janSnapshot, KA.EVS.afterLock.cutoff0228,
  KA.EVL.febPeriod.figures, KA.EVL.janPeriod.figures, KA.D2.stored.T3) applies `WP3.L34.storedPreFix` once the fix
  commit exists.
- `PER.loadingLocked`, `PER.relock.*`, `PER.V.relock`, `PER.overrideAudit.feb` read the new request, probe and filter
  leaves; `KA.PER.concurrentLocks` compares with the new value/today shape.
- `wp3-mutations-draft.json`: unchanged; the book's mutation leaves now name the same catchers and variants.
- The L34 contract leaves are not asserted by any check until the adjudicated fix plan fills them (as WP-2's CONTRACT).

Validation (scratch `C:\Temp\octapm-cert\scratch\wp3\book\`): `book-insert.js` applied to a copy of schedule.js at
114e9f1 (sha256 6ffc7689...): 24 exact-anchor edits, each counted once before any write, none overlapping, every
inserted line ASCII with no backtick or template interpolation; `node --check` exit 0 on the script and the patched
copy; the copy loads (965 figures, the new load checks pass, no DB access); `verify.js`: no key removed, 65 new keys
exactly the expected list, 17 changed keys each with exactly the expected fields (unit and assumption only where named,
every changed value's old value in its note), 883 identical, other sections, inputs, rules, meta and exports
identical, LF only, non-ASCII count unchanged (523: the existing section signs and box-drawing banners), no BOM, no
double-encoding, the 19 removed lines exactly the replaced ones, a second run refused with nothing written;
`teeth.js`: 28 mutants of the new leaves and models each refused at load by its own check, the unmutated copy loading;
the WP-0 load test (`scratch/wp0/load-schedule.js`, adapted path, `tools/run-wp0-load-test.js`): "OK: leaf contract and
cross-checks pass" before and after; `tools/refusal-test.js`: a repeated anchor, a missing anchor, the same input and
output path and a CRLF input are refused with nothing written. Bytes: every deliverable UTF-8 without BOM, no
double-encoding (the checks name the markers as `\u` escapes), LF.

Open question for the integration owner: G21 asks for the L34 todays to be "cleared once fixed", while Q3 (b) judges
pre-fix moments against HEAD's reading. The book keeps them (STORED-PRE-FIX compares with them); clearing them is a book
change for after the exit rebuild, when no pre-fix moment remains to read.

# WP-4 answer-book leaves (2026-10-10)

Binding source: `C:\Temp\octapm-cert\scratch\wp4\WP4-ADJUDICATION.md` (Q1-Q14; cited in the book as `WP4ADJ(...)`),
settling the answer-book gaps G1-G29 of `C:\Temp\octapm-cert\scratch\wp4\WP4-PREP.md` section 10 (cited `PREP4(...)`).
Applied here: G1-G28 as the adjudication rules them: every writing check and every section 6.2 catcher on the fresh
throwaway K (Q1); I2 certified on a second throwaway K2, 087-COM-B's shape (Q11); the HR-C1 contract-visible fields
marked `contract pending the HR-C1 plan review` with HEAD's today (Q2, Q3); the STORED-PRE-FIX reading of the stored
HR-C1 moments as a rule leaf (Q4); I5's one-shot confirmation and its re-run rule (Q7); the E6 catchers named by check
id, M-VAR0 / M-CONV0 now and M-VAR1 / M-CONV1 / M-RET after their decision or fix (Q8); C1-TOL kept a known answer
(Q12); '2026-13' under the suspect CF-PERIOD, registered as WP4-CF-1 when confirmed (Q13); CLAUDE.md's 5% left to the
owner (Q10). G29 (plan citations) is a citation convention, applied to the new and changed leaves only (below). Rule
A10 applies: every leaf below carries its on-paper derivation in the book, worked from the product code at `f599e67`
(`HF(file, lines)`; `backend/src`, `shared` and `backend/prisma` at HEAD `48db9e9` are identical to `f599e67`), from
existing book keys, or from the deep-company builders read at `48db9e9` (`BLD(file, lines)`; the commercial builders
are unchanged since `363651a`). Plan lines are numbered at `f599e67` (`PF4(...)`).

Inputs (copies proven on, sha256): `answers/commercial.js` at HEAD `48db9e9` (the working tree's file is the same; the
file is unchanged since `363651a`) `5934973943f7c41d5dec5a4f1bd916458b3b7ce9aa937d47de85605275d45daa`;
`answers/schedule.js` `f0957af2a9e3d31818c07b17584ba1fbc17aef97e71242b3cd6a72cad7dc40b9` and `answers/field-controls.js`
`ebc5c740850636a63b116d851f33d44d5bfeaa4c13a795f5ab91ebd37a99e73a` (both unchanged: no WP-4 key lives there, neither
names WP4); `answers/CHANGES-WP0-BUILDERS.md` `16d1aa714bda897e314d73945ce453c4d9017b25763339ceb72dc9a88d5be033`;
`WP4-ADJUDICATION.md` `64eb3e8c577aa9698aa0c81c19527c5f557276d4630513527b9910a92edae7e3`; `WP4-PREP.md`
`b92a311be8ea7f6f2182f2fcb34f064fcfb97d05c552b6972d916e50912b6ed2`; `derive-k.json`
`8edc4a77fdb3f2c048527b79170c206db2bdb3ab3b96eec97c41ea338b19391f`. Output of `book-insert.js` on the copy: sha256
`1304ef7ecb7384707c7860cdd9bdeacab04df6e8dd4bcec3baa6d67147c43952` (`work/commercial.applied.js`; the diff is
`wp4-book.diff`). Only `commercial.js` changes.

Figure count: commercial 633 -> 698 (+65; WP4 185 -> 250). No key was removed; no key was added under `deep` (the
052-COM mirror does not grow). 59 existing leaves changed, each as the adjudication directs and each recording in its
`note` what changed where more than a `ref` was added (a changed value keeps its old value there): 40 WP4 leaves, 12
052-COM mirrors that change with them (`deep.052-COM.E2.*` x3, `I1.*` x2, `I3.*` x3, `I8.afterReleaseStatus`,
`P4.*` x2, `C1.voidExecuted`: each change is project-independent, a ref, an assumption, HEAD's today or a derivation
that holds for 052-COM too), 6 deep leaves and `claudeMd.retentionDefault`. Values changed: `WP4.E2.concurrentConverts`
(five converts), `WP4.P1.noPeriod` (the route's code), the six `WP4.mutations` leaves (catchers by check id). planDisagrees
5 -> 2 (`WP4.I1.certifyUnconfigured`, its 052-COM mirror and `WP4.C3.noDefaultNoRate`: the plan now agrees, see G3 and
G2/Q3), assumption 154 -> 207, leaves with a `today` 70 -> 94, with a `ref` 0 -> 66. No other leaf changed (a
before/after dump of `figures()`: 574 leaves identical in every field; stage3/4/5, WP5, WP6, WP7 identical; deep and
claudeMd identical but for the listed leaves; `meta` and the exports identical). No value or today a builder reads in
code changed (`verify.js` scans `build/*.js` for `<leaf>.value` / `<leaf>.today`); three changed leaves are only named
in builder comments or messages (`WP4.I1.silentContractRate`, its 052-COM mirror, `deep.006-LITE.retentionDefaultCase`),
and their new todays are what those builders observe.

`figures()` now emits `ref` (as schedule.js and field-controls.js do); no existing commercial leaf had one, so every
existing row is unchanged by it.

Leaf contract (checked at load): every WP-4 leaf (WP4, deep 087-COM / -B / -C / 006-LITE, the 052-COM mirrors but O2,
which is WP-5's) that carries a `today` names its `ref`, from HR-C1, HR-C2, HR-C3, HR-C4, HR-C12, CONVERT-ATOMIC,
CCO-PARENT, L108, L115, L120, C1-TOL, CF-PERIOD, WP4-OVR-1, WP4-DRAFTS-1; under any row but the decided HR-C1 it is
`assumption: true`. HR-C1 figure leaves are not assumptions; its contract-pending leaves are.

New helpers in commercial.js (data, not leaves), inserted before the WP-0 stage table: `WP4ADJ`, `PREP4`, `PF4` (the
deep section's `PF` is defined after WP4), `HF`, `BLD`, `DERIVE_K`, `HR_C1_PENDING`, `HR_C1_STORED_LEAVES`; `K_COM` (K's
records, in currency units) and its models `K_ROWS`, `K_RATE`, `K_BILL_TOTAL`, `K_ALLOCATIONS`, `K_EARNED`,
`K_NR_GROSS`, `K_D`, `K_DRAFT_CLAIM`, `K_COMMITMENTS`, `K_PAY_APPS`, `K_CHANGE_EVENTS`, `K_STEPS`, `K_CHECKS`; `K2_COM`,
`K2_STEPS`; `COM087_ALLOCATIONS`, `COM087_INVOICED`, `COM087_STATEMENT`; `K_SRC`, `HRC1_SRC`; the new WP4 subtrees
`HRC1`, `L114`, `K`, `K2`, `CCO`, `OVR1`, `DRAFTS1`, `HRC3`, `IPC` (inside the WP4 literal after CF5, so not mirrored);
and a block of load checks after `claudeMd` that ties every new or changed leaf to the figures it is built from (the
book refuses to load otherwise; each check was shown to fire by a mutant, 45 in all). K's figures are also pinned to
`derive-k.json` (worked independently with the same arithmetic) by `verify.js`.

## G1, G26. The throwaway K (adjudication Q1)

K is the WP-4 proof's own project in 087, created WITHOUT defaultRetentionRate and contractValue, archived at the end
(as WP-1's W, WP-2's P, WP-3's V). Rows reuse book shapes: C-001 is I1's row, B-002 stage 3's split row, D-001 stage
10's 97,500.00 certificate, K-SC1's line P2-P4's 100,000.00 at 50%. Vendors are the 087 directory companies the
087-COM build made. `K.choreography` is K0-K27 and the end (29 steps); every check id K serves is named by exactly one
step (checked at load against `K_CHECKS`, 59 ids; `C2.coOnClosed` is served by K18 and K21 and is not in the list).

| Key | New |
|---|---|
| `WP4.K.project`, `team` | 087-COM's create payload without ldRatePerDay, no defaultRetentionRate / contractValue; planner, qs, cost_controller, procurement, site_engineer, finance |
| `WP4.K.budgetLines` | 02-100/material 10,000,000; 03-100/subcontract 50,000,000 |
| `WP4.K.bill`, `billTotal` | C-001, B-002, D-001, E-001, F-001; 33,750,000 |
| `WP4.K.allocations`, `progress` | six approved allocations with earned (C-001/K-A220 4,000,000 at 40%; B-002 split 3,000,000 / 9,000,000; D-001 9,750,000; E-001 500,000 at 50%; F-001 1,000,000) |
| `WP4.K.commitments` | K-SC-NR (no rate), K-SC-C1, K-SC-V, K-PC-CL (PO, rate 0), K-SC1, K-SC3, K-SC5 (each one line; every one but K-SC-NR names its rate) |
| `WP4.K.payApps` | PA-K1 5,000,000 / 500,000 / 4,500,000; PA-K3a/b/c 1,000,000 / 500,000 / 200,000; PA-K5 1,000,000, paid 900,000 |
| `WP4.K.changeEvents` | K-E1, K-E2 (E1's lines and quotes), K-E3 (RFQ carries K-SC-V), K-TWO (1,200,000; quotes 1,100,000 / 1,150,000), K-ARC (300,000 quoted 280,000; a choice) |
| `WP4.K.choreography` | K0-K27, end |
| `WP4.K.ipcD.*` (G26) | 9,750,000 / 975,000 / 8,775,000, paid 8,000,000, balance 775,000, partially_paid, certified, 2026-09 inflow 8,000,000, ledger delta 0 (= WP4.existing stage10.*, checked at load) |

## G4. I2 on the second throwaway K2 (adjudication Q11)

K2: project defaultRetentionRate 7.5 explicit, contract PATCHed to 10 with its value 2,000,000.00 (087-COM-B's
contract step), C-001 1,000 m3 @ 100.00 on K2-A110 at 40%, 400 m3 claimed WITHOUT retentionRate. I2 is judged on the
CERTIFIED certificate (a choice of this book: the draft preview depends on the HR-C1 contract, whether items take the
contract's rate at creation (P-7) or only at certification (P-10); certification settles 10% either way). The draft's
item rate is recorded as `WP4.K2.itemRetentionRate`.

| Key | Old | New |
|---|---|---|
| `WP4.K2.project`, `choreography` | none | K2's payload; K2-0..K2-4, end |
| `WP4.K2.itemRetentionRate` | none | 10, today 7.5, ref HR-C1, assumption (= deep.087-COM-B.ipcItemRetention) |
| `WP4.I2.retention` | derivation on 087-COM-B | + 'Judged on K2 ... certified by the PM'; ref HR-C1; value 400,000 and today 300,000 unchanged |
| `WP4.I2.net`, `netIfRatesSwapped` | no ref | ref HR-C1 (net's note: K2's certified net) |
| `deep.087-COM-B.ipcItemRetention` | no ref | ref HR-C1; note: I2 runs on K2, 087-COM-B builds no IPC |

## G2, G24, Q2-Q4. HR-C1, L114

| Key | Old | New |
|---|---|---|
| `WP4.HRC1.rule` | none | the decided rule and the book's resolution order (contract rate, else explicit project default, or explicit no retention; else certification refused); HEAD's four silent defaults |
| `WP4.HRC1.contract.{refusalStep, refusalStatusCode, contractUnconfiguredShape, projectUnconfiguredShape, commitmentRefusal, reresolveAtCertify, itemOverrideKept, explicitNoRetentionInput}` | none | each `contract pending the HR-C1 plan review`, HEAD's today, ref HR-C1, assumption; the proposal (WP4-PREP section 9 P-1..P-12) in its note |
| `WP4.HRC1.afterConfiguration.{status, retention, net}` | none | certified / 400,000 / 3,600,000 (= I2); today 409 IPC_INVALID_CERTIFICATION_STATE / 0 / 4,000,000; ref HR-C1 |
| `WP4.HRC1.explicitNoRetention.{gross, retention, net}` | none | K-IPC-NR on F-001: 1,000,000 / 0 / 1,000,000 (HEAD the same) |
| `WP4.HRC1.storedPreFix` | none | `{ verdict: STORED-PRE-FIX, appliesTo, judged, strict, moments (087-COM, 052-COM, 006-LITE steps), leaves: [7 keys] }` |
| `WP4.L114.newPeriodItemRate` | none | 10, today 0, ref HR-C1, assumption (P-7 / P-10) |
| `WP4.L114.routeBound` | none | 400 VALIDATION_ERROR (routes/ipc.js:95; L114's 'no upper bound' REJECTED) |
| `WP4.I1.silentContractRate` (+ 052 mirror) | no today | today 5, ref HR-C1 |
| `WP4.C3.noDefaultNoRate` | planDisagrees true, planValue 5; note 'this book's reading, needs the owner's confirmation' | runs on K (K8); ref HR-C1; planDisagrees false (plan C3 :691 now agrees); WP4ADJ Q3: HR-C1 covers commitments, the leaf stays an assumption (owner's decision list); old note kept in the note |
| `deep.006-LITE.retentionDefaultCase` | no today; note a template literal | today = the BLOCKED step's observation `{ projectDefaultRetentionRate: 5, contractRetentionRate: 5, itemRetentionRateIfCreated: 0, certificateRefused: false }`, ref HR-C1 (Q4) |
| `deep.006-LITE.ipcAfterConfiguration.retention`, `net` | no ref | ref HR-C1 |

STORED-PRE-FIX (Q4, the WP-3 Q3 (b) precedent): an observation from a stored build moment made before the HR-C1 fix
commit is judged against the leaf's today: equal is STORED-PRE-FIX (reported with the register link to HR-C1, not a
WP-4 failure), the value is value, anything else is wrong. Every read on K and K2 is strict; the exit run's rebuild
(plan section 7 step 5, :1186), with the builders changed by Claude Main with the fix (087-COM and 052-COM assert the
unconfigured draft's refusal, not a certify; 006-LITE keeps the plan's order), judges every moment on the value. The 7
leaves: `WP4.I1.certifyUnconfigured`, `WP4.I1.silentContractRate`, `WP4.HRC1.contract.projectUnconfiguredShape`,
`WP4.L114.newPeriodItemRate`, `deep.052-COM.I1.certifyUnconfigured`, `deep.052-COM.I1.silentContractRate`,
`deep.006-LITE.retentionDefaultCase` (checked at load: each has an HR-C1 today that differs from its value, and the
list covers each project's moments). Their todays stay after the fix.

The proof's `CONTRACT['HR-C1']` has eight fields (the preparation's seven plus `explicitNoRetentionInput`, which K9
depends on).

## G3, G25. I1's refusal and the deep notes

| Key | Old | New |
|---|---|---|
| `WP4.I1.certifyUnconfigured` (+ 052 mirror) | planDisagrees true, planValue `{ retention: 200000, net: 3800000 }` | ref HR-C1; planDisagrees false (plan I1 :695 now reads 'refused because configuration is required'); value and today unchanged (087-com.js:679 and 052-com.js:453 read the today); the live refusal runs on K (K7) |
| `deep.087-COM.contractRetentionRate`, `deep.052-COM.contractRetentionRate` | note | + after the fix the builder's item PATCH becomes an explicit override; the stored L114 findings are STORED-PRE-FIX |

## G5. E2 (adjudication Q1, Q8, Q9)

| Key | Old | New |
|---|---|---|
| `WP4.E2.concurrentConverts` (+ 052 mirror) | `{ ok2xx: 1, conflict409: 1, changeOrders: 1 }`, today text | `{ converts: 5, ok2xx: 1, conflict409: 4, changeOrders: 1 }`; today 'k >= 2 of the five succeed ...'; ref CONVERT-ATOMIC, assumption |
| `WP4.E2.pendingDelta` (+ mirror) | today 1,900,000 | value 950,000 unchanged; today `{ perSuccessfulConvert: 950000, successfulConverts: "k >= 2" }`; ref CONVERT-ATOMIC |
| `WP4.E2.midwayRefusalOrphans` (+ mirror) | no today | value 0; today `{ status: 409, code: COMMITMENT_LOCKED, orphanPrimeCosPerAttempt: 1, eventStatus: priced }`; the deterministic fixture (an accepted RFQ carrying a commitment voided before the convert) |

052-COM's E2 is left priced and unused (Q6); its mirror carries the same project-independent answers.

## G6-G12, G21, G22

| Key | Old | New |
|---|---|---|
| `WP4.E3.archivePendingDelta` | on 087-COM | value unchanged; on K (K15), a moment-map deviation |
| `WP4.E3.patchApproved` | none | 409 CHANGE_ORDER_APPROVED_LOCKED (change-order.service.js:91-109, 465-483, :1168); M-LOCK(a)'s catcher |
| `WP4.C1.voidExecuted` (+ mirror) | 'void is allowed only from draft/pending/approved.' | value unchanged; the probe sends a reason (without one, 400 COMMITMENT_VOID_REASON_REQUIRED, commitment.service.js:746-749) |
| `WP4.P1.noPeriod` | 400 SUB_PAY_APP_PERIOD_REQUIRED | 400 VALIDATION_ERROR (routes/sub-pay-apps.js:41); the plan's P1 names no code, so no planValue |
| `WP4.P1.reopenWhileOpen` | none | 409 SUB_PAY_APP_OPEN_EXISTS at the back-to-draft site (sub-pay-app.service.js:822-832); M-OPENb's catcher |
| `WP4.P4.payOverNet` (+ mirror) | no ref | ref C1-TOL, assumption (Q12: BLOCKED while today holds); on K's PA-K1 |
| `WP4.P4.payOverNetPlus2` (+ mirror) | no note | note: on K's PA-K1, M-CEIL's catcher |
| `WP4.I5.afterValueEntered` | 'After PATCH /prime-contract originalValue ...' | established by the PM's `{confirmOriginalValue: true}` (the stored 76,000.00 sent back is a save, prime-contract.service.js:392-402) |
| `WP4.I5.confirmRequest` | none | `{ by: pm, PATCH /prime-contract, body { confirmOriginalValue: true }, 200, 7,600,000, boq_fallback -> contract_entry, audit { contract.manage, originalValueConfirmation: confirmed } }` |
| `WP4.I5.rerunRule` | none | one-shot; a re-run that finds IPC-01 certified judges its figures and the audit event, skips I5.gateLive (Q7) |
| `WP4.I3.A130LimitQuantity`, `A130LimitAmount`, `patchA130Qty650` (+ mirrors) | no ref | ref HR-C2, assumption; the limits read on 052-COM, the PATCH on K (K13) |
| `WP4.C5.closeWithRetentionHeld` | set-up unnamed | on K (K24): K-SC5's final PA-K5 approved on a complianceOverrideReason, paid 9,000.00, then the close |
| `WP4.C5.outstandingLabel` | none | 'Retention released': error.details.outstanding lists LABELS (closeout.service.js:317-330, 478), not the key retention_released the preparation named |
| `WP4.P7.rejectedReopen` | 'rejected -> reopen -> draft -> resubmit.' | on K (K23, PA-K3c) |

## G13-G17

| Key | Old | New |
|---|---|---|
| `WP4.I9.disagreement` | no ref | ref HR-C4 |
| `WP4.I9.on087.statementInvoiced`, `receivablesInvoiced`, `difference` | none | 35,663,750 (IPC-02, -03, -05, -06 netPayable) / 36,638,750 / 975,000 (today 975,000, ref HR-C4) |
| `WP4.I10.gross` | no ref | ref HR-C4, assumption (invoice gross, plan :729) |
| `WP4.CF1.summary.inflow`, `outflow`, `net` | project summary | read as the 2026-08..2026-09 window on 087-COM; values unchanged |
| `WP4.CF2.advanceInflow` | no ref | ref L115; 087-COM month 2026-07 |
| `WP4.CF3.period2026_13` | no ref | ref CF-PERIOD; on K (K27); WP4-CF-1 (P3) when confirmed (Q13) |
| `WP4.CF3.deleteSystemRow`, `WP4.CF4.concurrentRebuilds` | no ref | ref L120; on K (K27) |
| `WP4.HRC12.dropsBudgetLines` | none | the CO carries each line's budget line and cost code; today `{ budgetLineId: null, budgetAllocations: [] }`; ref HR-C12 |
| `WP4.HRC12.secondAcceptOnSameLine`, `archivedCoEvent` | no ref | ref HR-C12 (K19) |

## G18-G20, G24, G27, G28

| Key | Old | New |
|---|---|---|
| `WP4.CCO.parentVoid` | none | 409 (code null, the fix's; COMMITMENT_LOCKED proposed); today `{ 200, approved, committedDelta 0 }`; ref CCO-PARENT |
| `WP4.CCO.parentClosed` | none | 409 (code null); today `{ 200, approved, committedRises: true }`; ref CCO-PARENT |
| `WP4.CCO.parentClosedCommitted` | none | 500,000; today 600,000; ref CCO-PARENT |
| `WP4.OVR1.pmWithoutReason`, `financeWithReason`, `review` | none | 400 IPC_PM_OVERRIDE_REASON_REQUIRED; 403 IPC_PM_OVERRIDE_REQUIRED; `{ requiresPmOverride: true, a130OverEarned: { atStepIpc09: 750000, atEndStateToday: 562500 } }`; ref WP4-OVR-1, assumption (observations for CF.OVR1) |
| `WP4.DRAFTS1.*` (6) | none | earned 500,000; each draft 400,000; both PATCHes 200; the first certify certified; the second 400 IPC_PM_OVERRIDE_REASON_REQUIRED; over by 300,000; ref WP4-DRAFTS-1, assumption |
| `WP4.HRC3.emptyPeriod` | none | 409 (code null); today `{ 200, certified, 0, 0, retentionStatus released }`; ref HR-C3 |
| `WP4.IPC.itemsFromAllocations` | none | 11 (087-COM IPC-10, one item per approved allocation) |
| `claudeMd.retentionDefault` | derivation | value, planValue unchanged; maps onto I1.certifyUnconfigured and I1.afterConfiguration; the CLAUDE.md change is the owner's (Q10) |

G19 correction to the preparation: at the build's step ipc.09 A130 was over earned by 7,500.00, but at 087-COM's end
state CO-I3 (approved after IPC-10) raises A130's limit to 97,500.00 through HEAD's variation scope (the BOQ-item leg,
HR-C2), so earned at 25% is 24,375.00 and the live review shows 5,625.00 over (an HR-C2 fix restores 7,500.00).
requiresPmOverride stays true, which is what CF.OVR1 classifies.

## G23. The mutation leaves name their catchers (adjudication Q8)

| Key | Old | New (catchers by check id) |
|---|---|---|
| `retentionDefaultGuard` | `['WP4.I1.certifyUnconfigured']` | I1.certifyUnconfigured (M-RET, post-fix); C3.noDefaultNoRate (M-RET-c); HRC1.contractFirstRead (M-RET-d); L114.newPeriodItemRate and I2.contractRate (M-RET-l) |
| `variationScopeMatch` | `['WP4.I3.A130LimitQuantity', 'WP4.I3.patchA130Qty650']` | I3.limits.A120 (M-VAR0 at HEAD); KA.I3.limits.A130 and KA.I3.patchA130Qty650 (M-VAR1 after HR-C2) |
| `convertLock` | `['WP4.E2.concurrentConverts', 'WP4.E2.pendingDelta']` | K.E1.convertAgain (M-CONV0 at HEAD); KA.E2.concurrent, pendingDelta, midwayOrphans (M-CONV1 after the fix) |
| `oneOpenPayApp` | `['WP4.P1.secondOpen']` | P1.secondOpen and P1.reopenWhileOpen (M-OPEN); M-OPENa; M-OPENb |
| `payAppPaymentCeiling` | `['WP4.P4.payOverNetPlus2']` | P4.payOverNetPlus2 (M-CEIL); M-CEILa/b equivalent, not run |
| `approvedCoLock` | `['WP4.E3.archiveApproved']` | E3.patchApproved and E3.archiveApproved (M-LOCK); M-LOCKa; M-LOCKb |
| `commitmentCoParent` (new) | none | KA.CCO.voidParent and KA.CCO.closedParent (CCO-M1, post-fix; not a section 6.2 guard) |

## G29. Plan citations

The new and changed leaves cite `PF4` (plan lines numbered at `f599e67`). The existing WP-4 `P(...)` trail it by 39
(P(656) = PF4(695)); the worktree plan is PF4 + 1 from :52 on (the owner's HR-X1 scope line). Existing `P(...)`
citations are left as they are.

## Not applied here

- No leaf is filled from the HR-C1 fix plan: the eight contract leaves wait for the Codex high-risk plan review and its
  adjudication (Q2); the proposals P-1..P-12 are only named in their notes.
- Q5 (the data migration for existing contracts) and Q10 (CLAUDE.md's 5%) are owner questions; Q14 (HR-A3 / L211)
  keeps `WP4.I12.pmRecordsPayment` as it is.
- `WP4.I1.explicitNoRetention` keeps its value 4,000,000 (the rule on I1's shape; the WP-0 recomputation reads it); K's
  own figures are `WP4.HRC1.explicitNoRetention.*` (G2 proposed re-parameterising the old leaf; that would also have
  moved its 052-COM mirror).
- `WP4.HRC1.projectDisplay` and `WP4.I1.afterConfiguration` (G2's names) are not separate keys: the project display is
  the contract leaf `WP4.HRC1.contract.projectUnconfiguredShape`, the after-configuration figures are
  `WP4.HRC1.afterConfiguration.*` (new I1 leaves would have been mirrored into deep.052-COM.I1, whose IPC-01 stays a
  draft).
- MOMENT-MAP.md is not edited (one writer): the WP-4 deviations go in its deviation section when the proof lands.

## For the proof and the lists (no change made outside the book)

- Check -> key changes against `wp4-checks-draft.json`: HRC1.projectDisplay reads
  `WP4.HRC1.contract.projectUnconfiguredShape`; HRC1.contractFirstRead reads `WP4.I1.silentContractRate` (today 5) and
  `WP4.HRC1.contract.contractUnconfiguredShape`; I1.explicitNoRetention reads `WP4.HRC1.explicitNoRetention.*`;
  I1.afterConfiguration reads `WP4.HRC1.afterConfiguration.*`; I2.contractRate runs on K2 and reads `WP4.I2.retention`,
  `WP4.I2.net` (certified) and `WP4.K2.itemRetentionRate` (the draft read); K.IPC.D, K.cashInflow and IPC.noCost read
  `WP4.K.ipcD.*`; KA.CCO.closedParent reads `WP4.CCO.parentClosed` and `parentClosedCommitted`; KA.I9 on 087-COM reads
  `WP4.I9.on087.*`; CF.OVR1 reads `WP4.OVR1.*`; CF.DRAFTS1 reads `WP4.DRAFTS1.*`; IPC.itemsFromAllocations reads
  `WP4.IPC.itemsFromAllocations`; the mutation lists take their catchers from `WP4.mutations.*`.
- P1.noPeriod expects 400 VALIDATION_ERROR (it was BOOK-G8; HARD now). C1.voidExecuted sends a reason. C5's refusal is
  matched by the label 'Retention released' in `error.details.outstanding` (WP4-PREP section 5.1 said the key).
- KA.E2.concurrent: value only on exactly one 2xx, four 409 CHANGE_EVENT_CONVERTED and one CO; KA.E2.pendingDelta's
  today is the object `{ perSuccessfulConvert, successfulConverts }` (judge: delta = 9,500.00 -> value; delta = k x
  9,500.00 with k >= 2 -> today).
- I5: the PM sends `{confirmOriginalValue: true}`; on a re-run with IPC-01 already certified, judge the certified
  figures and the contract.manage audit event, skip I5.gateLive (`WP4.I5.rerunRule`).
- The proof's RULES need the refs the book uses: HR-C1 (decided), HR-C2, HR-C3, HR-C4, HR-C12, CONVERT-ATOMIC,
  CCO-PARENT, L108, L115, L120, C1-TOL, CF-PERIOD, WP4-OVR-1, WP4-DRAFTS-1; `CONTRACT['HR-C1']` has eight fields.
- Moment-map deviations to record when the proof lands: rows 110 (I1's refusal), 114 (E3's archive), 115 (E2), 124
  (I3's PATCH), 136 (P4's probes) per Q1, and row 127 (I2 on 087-COM-B) per Q11.
- Expected at HEAD from the book side is unchanged from WP4-PREP section 6 (11 HR-C1 checks red), except that
  P1.noPeriod is green (BOOK-G8 resolved) and I2.contractRate fails on K2's certified certificate (300,000 / 3,700,000)
  rather than on a draft preview.

Validation (scratch `C:\Temp\octapm-cert\scratch\wp4\book\`): `book-insert.js` applied to a copy of commercial.js at
48db9e9 (sha256 5934973943f7...): 34 exact-anchor edits, each counted once before any write (rewrites of existing
leaves derived from their anchors by substitutions each counted once); `node --check` exit 0; the copy loads (698
figures, the new load checks pass, nothing required of the product); `verify.js`: no key removed, 65 new keys exactly
the expected list, 59 changed keys each with exactly the expected fields, 574 identical, the other sections, meta and
exports identical, no value or today a builder reads changed, K's figures equal derive-k.json, the WP-0 recomputation
(`scratch/wp0/verify-commercial.js`) 116 of 116 agree, LF only, no BOM, no double-encoding, no new non-ASCII character
(449 -> 446: the three section signs of the rewritten I2 and 006-LITE lines are written \u00a7 and kept at runtime),
every removed line (49) lies in a replaced range, a second run refused; `teeth.js`: 45 mutants of the new and changed
leaves and models each refused at load by its own check, the unmutated copy loads; the WP-0 load test adapted to a path
(`tools/load-commercial.adapted.js`): shape OK before (633) and after (698); `tools/refusal-test.js`: a repeated anchor,
a missing anchor, CR line endings and the same input/output path are refused with nothing written. Bytes: every
deliverable UTF-8 without BOM, LF, ASCII; commercial.js LF; every inserted line ASCII.
