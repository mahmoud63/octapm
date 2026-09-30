# Forecast change-order impacts — census (PC-7a item 4)

What PC-7a item 4 (commit `5ea4b2b`, authorised by the owner in the wave
text) changes in the forecast of every durable project, measured before and
after on the same data at the same instant. **No money figure, snapshot or
certified financial value changes: only the forecast's projections do.**

## 1. The change

`forecast.service` counts an approved change order's schedule impact as a
recorded impact on the activity it names:
`ChangeOrderActivityLink.approvedScheduleImpactDays > 0` on an **approved,
unarchived** change order (a pending order's estimate is not counted). One
order's impact on one activity counts once (the largest of its relation rows),
and a workflow link whose record became that order — a link on the order
itself, an RFI whose `changeOrderId` names it, or a record a change event
converted into it — is dropped for that activity in favour of the approved
order. Before item 4 the forecast counted workflow links (RFI, submittal and
other records with scheduleImpactDays) and weather delays only, so an
approved change order's delay never reached the projected finish.

The impact is a projection input (an activity's `impactDays`, which adds to
its slip, its risk level and the critical driver). It feeds nothing else.

## 2. Method (read only)

- Script: `C:\Temp\r5\census\forecast-change-impacts-census.js` (scratch,
  not in the repository). It loads the backend in-process and builds the
  forecast twice per project at one fixed instant (`asOf`
  2026-09-30T07:37:42.165Z):
  - **before** — `forecast.service.js` as of `06308dc` (the commit before
    item 4), compiled in memory from `git show` (no file written);
  - **after** — `forecast.service.js` at `79853d6` (this branch).
  Both use the same current dependencies (EV report, budget register), so
  the difference is item 4 alone.
- One database connection (`DATABASE_CONNECTION_LIMIT=1`), set
  `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` before anything ran;
  `SHOW transaction_read_only` read `on` before and after the run, so any
  write would have been refused by Postgres. `forecast.service` and
  `buildOfficialEvReport` issue no writes. Run under the cross-wave DB lock.
- Scope: every project of every organisation not named `LiveTest <uuid>` —
  **431 projects** (OctaPM Demo Contracting 424, OctaPM E2E 4, PMcopilots UAT
  Fixtures 2, Rival Construction 1). A project **moves** when its projected
  finish, slip or schedule level differs.

## 3. Results

### 3.1 The three named projects

| project | approved CO links / days | Σ impactDays | projected finish | slip (days) | schedule level | moves |
|---|---|---|---|---|---|---|
| `0ce999f2` OCTA PHASE21 GREENFIELD (certified) | 7 / 63 | 6 → 63 | 2027-04-08 → **2027-05-23** | 0 → **45** | medium → **high** | yes |
| `4735659e` Marina Bay Residences (showcase) | 1 / 5 | 0 → 5 | 2027-08-05 → 2027-08-05 | 0 → 0 | medium → medium | no |
| `225d9477` Riverside Tower (E2E) | 2 / 6 | 0 → 6 | 2030-02-15 → 2030-02-15 | 1142 → 1142 | high → high | no |

- `0ce999f2`: six approved orders (VO-10, 12, 14, 16, 18, 20) each give
  "Blockwork walls" 10 days, and VO-22 gives "Foundation concrete" 3. Before,
  only the two RFI links on "Foundation concrete" counted (3 days each, one
  RFI: 6); that RFI became VO-22, so its links are dropped for that activity
  in favour of the approved order's 3 days — nothing is counted twice
  (60 + 3 = 63). The critical driver becomes "Blockwork walls" (slip 60)
  instead of "Foundation concrete" (6). Planned finish 2027-04-08 is
  unchanged.
- `4735659e`: the 5-day approved impact lands on an activity that does not
  drive the finish (the schedule's "low" risk count goes from 1 to 2); the
  finish does not move.
- `225d9477`: the 6-day impact lands on an activity of a project already
  1,142 days late, driven by "Unitised facade installation"; the finish does
  not move. Its `cost.topRisks[2].impactDays` reads 0 → 6 (see 3.3).

### 3.2 All durable projects

| | projects |
|---|---|
| durable projects | 431 |
| with an approved, unarchived CO link with approvedScheduleImpactDays > 0 | 75 |
| **move** (projected finish, slip or level) | **71** |
| — 70 "GREENFIELD REGRESSION …" certification copies | +3 days each, low → medium |
| — `0ce999f2` | +45 days, medium → high |
| with links that do not move | 4 (`4735659e`, `5c492505` Marina Bay first build, `225d9477`, `95c188f3` archived Riverside fixture) |
| without such links | 356 — every summary identical before and after |
| forecast unavailable before or after | 0 |

No project moves without an approved change-order link. No E2E-org project
moves (the E2E specs read projected dates from the project they create).

### 3.3 Money, EV and snapshots

- Every money figure in the forecast — the cost block (`budget`, `bac`,
  `eac`, `bottomUp`, `projected`, `overrun`, `overrunPct`, `actual`), each
  budget line's figures, and each activity's `cost` — is **identical before
  and after in all 431 projects**.
- The EV figures the forecast reads (`schedule.spi`, `schedule.cpi`,
  `earnedValueCutoff`) are identical in all 431.
- The cost block differs in two projects only in `cost.topRisks[].impactDays`
  — a schedule field of the activity rows the cost view lists, not money:
  `95c188f3` 0 → 564, `225d9477` 0 → 6.

## 4. The forecast is not an input to any financial record

- `forecast.service` is required only by `routes/forecast.js`
  (`GET /projects/{id}/forecast` and `POST /projects/{id}/forecast/explain`,
  each withheld per reader by `utils/boq-figures withheldForecast`). No other
  backend module imports it or calls `buildForecast` (grep of `backend/src`,
  tests excluded).
- It writes nothing: no `create`, `update`, `upsert`, `delete` or raw SQL in
  `forecast.service.js`; the forecast is computed per request and never
  stored.
- The financial snapshots are built without it: the EV period snapshot by
  `earned-value.service lockReportingPeriod` from `buildOfficialEvReport`;
  the budget snapshot by `budget.service snapshotForPeriod` /
  `buildSnapshotPayload` from `listBudgetLines` and `reconcile`; IPC
  certificates, the cost ledger, cash flow, retention and the prime contract
  never read it.

So item 4 moves only the projections a reader sees on the Forecast panel and
in its explanation (projected finish, slip, risk levels, critical driver,
each activity's `impactDays`). No stored row, no snapshot, no certified
figure and no money figure moves, and existing rows are not rewritten.

## 5. Trace of the certified project's 45 days (owner decision R5-1)

The census shows what the calculation does; it does not show that the
certified project `0ce999f2` is 45 days late. This section is the narrow
trace R5-1 asks for. Every figure below was read on 2026-09-30 through one
database connection whose session was `SET SESSION CHARACTERISTICS AS
TRANSACTION READ ONLY` (`SHOW transaction_read_only` = `on` before and after
every query); no endpoint was called and nothing was written. The forecast
itself was built in-process by `forecast.service.buildForecast` at
`asOf` 2026-09-30T09:01:37Z on the same read-only connection and gave the
census figures: planned finish 2027-04-08, projected finish 2027-05-23, slip
45, basis `activities`, critical driver "Blockwork walls" (60), SPI and CPI
null (so no EV-based finish).

### 5.1 The seven approved change-order links

| order | id | description (after the harness tag `P21-20260910093852`) | value | created | approved | activity | approvedScheduleImpactDays |
|---|---|---|---|---|---|---|---|
| VO-10 | `2ac52caf` | Client instruction: upgrade blockwork to fair-faced, grid A-F | 0.00 | 2026-09-10 16:55:48.246Z | 16:55:49.668Z | Blockwork walls (A310) | 10 |
| VO-12 | `a6bb2d69` | same text | 0.00 | 16:56:07.013Z | 16:56:08.207Z | A310 | 10 |
| VO-14 | `6b571a8b` | same text | 0.00 | 16:56:17.098Z | 16:56:18.091Z | A310 | 10 |
| VO-16 | `1ba56d05` | same text | 0.00 | 16:56:48.920Z | 16:56:50.382Z | A310 | 10 |
| VO-18 | `536ee046` | same text | 125,000.00 | 16:57:49.978Z | 16:57:51.230Z | A310 | 10 |
| VO-20 | `84ec8b03` | same text | 125,000.00 | 16:58:36.943Z | 16:58:38.066Z | A310 | 10 |
| VO-22 | `939d5357` | From RFI-01: additional 150mm excavation to competent stratum at grid A-D | 4,500.00 | 2026-09-12 17:59:08.531Z | 17:59:10.516Z | Foundation concrete (A130) | 3 |

- All seven are `approved`, none archived. VO-10…VO-20 were created by the
  QS demo user (`qs@octapm.demo`) and approved by the PM demo user
  (`pm@octapm.demo`); each has the same five audit events — `created`,
  `updated`, `updated`, `status_changed` draft → pending, `approved` — inside
  about 1.5 seconds, which is a script, not a person.
- The six Blockwork orders share one description, one
  `scheduleImpactSummary` ("Ten working days on the blockwork chain (A310).
  The completion milestone moves ten days; the MEP spur absorbs its share in
  float."), one link note ("Blockwork upgraded to fair-faced") and one
  relation (`impacted`, 10 days, critical-path impact 10).
- They are what the Phase-21 harness stage 8 writes:
  `backend/scripts/phase21/stage8-change-directcost.js:74` (the
  description), `:108` (the schedule summary), `:117` (the link note) and
  `:126` (the attached "Client instruction 07": "Programme effect: 10
  working days"). The stage ran eleven times on 2026-09-10 between 16:52:49
  and 17:01:01 — each run first raises the retaining-wall draft on A130
  (VO-01, 03, …, 21), then the blockwork order (VO-02, 04, …, 20). Runs 1–4
  left their blockwork order in draft, runs 5–10 approved theirs (VO-10…20;
  the first four with value 0.00, the last two with 125,000.00 as the
  script evolved), and run 11 created only the draft VO-21. The committed
  script (`e901e7a`, 2026-09-10 17:01:32Z, three minutes after VO-20's
  approval) carries a re-run guard at `:76–:85`: "approving a second
  identical variation would move the budget again", reusing an already
  approved order with the same description.
- Across every durable project, this is the only group of approved,
  unarchived orders on one project with an identical description (a read-only
  `GROUP BY projectId, description HAVING count(*) > 1`).

**Finding.** The six ten-day Blockwork impacts are one client instruction
recorded six times by the certification harness while stage 8 was being
written, not six distinct approved changes. For this data "additive" is not
right: the evidenced delay on Blockwork is one change of 10 working days,
not 60 days. (VO-18 and VO-20 also each posted a 125,000.00 `change_order`
budget-line change, so the same instruction stands twice in the approved
changes. Nothing here changes that; it is the owner's to decide, see 5.6.)

VO-22 is distinct: it came from RFI-001 ("Founding level at grid A-D
against borehole BH-3", now `closed`, `changeOrderId` = VO-22). RFI-001 has
two workflow links of 3 days on Foundation concrete (`impacted` and
`schedule_impact`); both are dropped in favour of VO-22's approved 3 days
(`forecast.service.js:126–:131`), so A130 counts 3, not 9.

### 5.2 Blockwork walls and the arithmetic of 45

| | value |
|---|---|
| activity | A310 Blockwork walls, `02c09d81`, calendar `six_day` |
| planned | 2027-03-13 → 2027-03-24 (duration 9 working days; ES 59 / EF 68, LS 59 / LF 68 in working days from 2027-01-04) |
| progress | 0 % — no `ActivityProgress` row |
| projected finish (engine) | 2027-03-24, basis `planned` (not started, today before its start: no velocity, pace or late start applies) |
| total float / critical | 0 / true |
| predecessor | A230 Columns level 2, FS 0 |
| successor chain | A310 → A320 Internal plastering (7 wd, 03-24 → 04-01) → A330 Painting and decoration (6 wd, 04-01 → 04-08) → M900 Practical completion (2027-04-08), all FS 0, all TF 0 |
| project planned finish (forecast) | 2027-04-08 — the latest activity finish (M900). `Project.endDate` and the prime contract's `completionDate` are 2027-12-17; the forecast does not read either |

The engine's steps (`forecast.service.js`):

1. `impactDays` for A310 = Σ impacts = 6 × 10 = **60** (`:291–:292`).
2. `slipDays` for A310 = projected − planned = 0; A310 is a driver because
   it is critical and `totalSlip` 60 > float 0 (`:295–:296`, `:418`).
3. activity-based finish = the latest, over the drivers, of
   `projectedFinish + impactDays × DAY` (`:419`): A310 2027-03-24 + 60 × 24 h
   = **2027-05-23**; A130 (50 %, velocity basis, projected 2026-10-02) + 3 =
   2026-10-05; every other driver + 0.
4. SPI is null, so there is no EV-based finish; projected finish =
   2027-05-23 (`:428`).
5. project slip = 2027-05-23 − 2027-04-08 = **45** days (`:429`).

So 45 = 60 − 15: the 15 calendar days between Blockwork's own planned
finish (2027-03-24) and the project's planned finish (2027-04-08). The
engine does not move successors — A320, A330 and M900 keep their planned
dates in the forecast — it compares the delayed activity's own finish with
the project finish, so the 13 working days (15 calendar days) of
zero-float work after Blockwork are treated as if they could absorb the
delay. They cannot: their total float is 0.

### 5.3 Are the impacts already in the current schedule?

No, on every marker the data has:

- The project has **no `ScheduleRevision` row** — no import, revision,
  activation or baseline after the change orders were approved.
- Every activity was last written at 2026-09-10 09:38:58Z, one second after
  it was created and seven hours before the first approval, except A100 Site clearance
  (2026-09-15 03:23:59Z), which starts the project and is not downstream of
  Blockwork. Blockwork's dates are the dates it was created with.
- No `AuditEvent` records an activity or schedule change on the project.
- The change-order links carry no incorporation evidence: `impactedStart`,
  `impactedFinish`, `baselineStart`, `baselineFinish` and `impactBasis` are
  null, and `cpmSnapshotJson` holds only the figures typed on the link. The
  schema has no "applied to schedule" marker on `ChangeOrder` or
  `ChangeOrderActivityLink`. There is no EOT claim on the project.

So nothing is double counted in this data. But the engine does not check:
if a later revision or re-import moved Blockwork's (or the project's) dates
to include an approved delay, the forecast would add the same approved
days again on top of the moved dates.

### 5.4 Overlap

The engine sums every counted impact on an activity (`:292`). Its only
de-duplication is one count per (activity, order) — the largest of an
order's relation rows — and dropping a workflow link whose record became
that order (`recordedImpacts`, `:115–:136`). It has no concurrency or
overlap handling: two delays covering the same days on one activity count
twice. The six Blockwork links carry no delay window (the dates above are
null; the link has no `delayStart`/`delayEnd`), so the data cannot place
them in time; by content (5.1) they are the same event, i.e. they overlap
completely.

### 5.5 Calendar and day convention

- **Entry.** The web form asks for "Schedule Impact (days)"
  (`frontend/src/features/commercial/components/change-order-form.tsx:258`)
  and per activity "Days" (`:404`); the API accepts any integer
  (`backend/src/routes/change-orders.js:63–:67`, `:170–:174`) and the
  OpenAPI `ActivityLinkInput` says only `integer`
  (`backend/src/openapi/spec.js:6215–:6216`). No surface says whether the
  days are working or calendar days. On approval the typed
  `scheduleImpactDays` is copied unchanged into `approvedScheduleImpactDays`
  (`backend/src/services/change-order.service.js:646`, `:674`). The
  certified data's own wording is working days ("Ten working days",
  "Programme effect: 10 working days").
- **Engine.** The forecast adds `impactDays × DAY`, `DAY` = 86,400,000 ms
  (`forecast.service.js:53`, `:419`): calendar days, whatever the
  activity's calendar.
- **Schedule.** The project calendar and every activity's calendar is
  `six_day`; durations, float and the CPM engine are in working days
  (`backend/src/services/cpm.service.js:20–:23`, `resolveCalendar` `:78`,
  `workingDayToDate` `:107`), and the importers convert P6 hours ÷ 8 to
  working days (`backend/src/parsers/xer-parser.js:43`,
  `p6xml-parser.js:51`, `msp-parser.js:39`).
- **Mismatch.** A working-day impact is added as the same number of
  calendar days. On this six-day calendar 10 working days after a Thursday
  is 12 calendar days, so each such impact is understated by about one day
  in six (two in seven on a five-day calendar).

### 5.6 Conclusion — the calculation cannot support "45 days late"

The 45 days are a faithful result of the engine's conventions applied to
this data, but they are not a validated projection. Three limitations
combine, and they point in opposite directions:

1. **Duplicated orders (data).** Five of the six Blockwork impacts are
   harness re-creations of one instruction; the evidence supports one
   10-working-day delay on Blockwork plus VO-22's 3 working days on
   Foundation concrete.
2. **No successor propagation (engine).** An impact moves only its own
   activity's projected finish; the project slip is that finish minus the
   project finish. Downstream zero-float work is ignored: here it hides 15
   calendar days. With the one real Blockwork change the engine would show
   **0** days project slip (2027-03-24 + 10 = 2027-04-03, before
   2027-04-08) although the change's own summary says completion moves ten
   days.
3. **Calendar days (engine).** Impacts entered as working days are added
   as calendar days.

For comparison only (not computed by the product): propagated through the
existing CPM logic on the six-day calendar, 10 working days on A310 and 3
on A130 (the same zero-float chain A130 → A200 → A210 → A220 → A230 → A310
→ A320 → A330 → M900) move Practical completion 13 working days, from
2027-04-08 to 2027-04-23 (15 calendar days); counting all six Blockwork
orders it would be 63 working days, to 2027-06-21. Neither is 45.

**Proposed smallest corrections — proposals awaiting the owner; none is
implemented, and the calculation is unchanged:**

- **P1 — the duplicated orders (data, owner's decision).** Decide whether
  VO-12, VO-14, VO-16, VO-18 and VO-20 are duplicates of VO-10. The product
  refuses to archive an approved order ("Approved change orders cannot be
  archived after contract budget revision sync"), and VO-18/VO-20 carry
  money, so any correction is a financial decision and needs an explicit,
  owner-approved procedure. In the engine, do not dedupe by description
  automatically (two genuine identical instructions can exist); instead add
  a data-quality note when one activity carries approved orders with the
  same description and impact.
- **P2 — working days.** Convert each impact through the activity's
  calendar with the existing `cpm.service` `dateToWorkingDay` /
  `workingDayToDate` instead of `× DAY`, and say "working days" on the entry
  field and in the API description.
- **P3 — successor propagation.** Take the project's projected finish from
  the existing CPM engine (`cpm.service calculateCpm`) run in memory on the
  activities with each impacted activity's remaining duration extended by
  its impact — no new engine, nothing written — rather than comparing one
  activity's finish with the project finish.
- **P4 — incorporation.** There is no marker today; until one exists the
  forecast should say in its data-quality notes that approved impacts are
  assumed not yet in the schedule dates. (An option for the owner: ignore
  an impact whose order was approved before the active schedule revision
  was activated.)

What R5-1 requires holds regardless: approved impacts stay in the forecast;
the forecast writes nothing (no activity, baseline, contract completion
date, order or amount — see §4 and the regression case below); and every
surface calls it a projection, never an extension of time.

The behaviour described here — additive, calendar days, no successor
propagation, a pending or archived order not counted, an RFI's days not
counted twice — is pinned by
`backend/src/services/__live__/r5-1-forecast-change-impacts.live.test.js`,
each convention marked there as a documented limitation.

## Appendix — every project with an approved CO impact

| project | name | approved CO links / days | Σ impactDays | projected finish | slip | level | moves |
|---|---|---|---|---|---|---|---|
| `9f0c31e4` | GREENFIELD REGRESSION MTYQU5Y241I | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `9711285f` | GREENFIELD REGRESSION MTYR4WCK6ID | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `0e0da205` | GREENFIELD REGRESSION MTYR5YYUXV | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `bf6eae13` | GREENFIELD REGRESSION MTYRS0AB6B4 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `d6a0fb3a` | GREENFIELD REGRESSION MTYRSEGZ5UE | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `db329a3c` | GREENFIELD REGRESSION MTYRV2ED6LS | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `18a0cddc` | GREENFIELD REGRESSION MTYRVFM97KQ | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `db0eeaf5` | GREENFIELD REGRESSION MTYSHF9E5VC | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `83923d4f` | GREENFIELD REGRESSION MTYW1ZJY2CP | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `057f204c` | GREENFIELD REGRESSION MTYW2B8UZU | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `a2d72104` | GREENFIELD REGRESSION MTYYSVUU5TQ | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `137b506f` | GREENFIELD REGRESSION MTYZWP5584 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `d088914f` | GREENFIELD REGRESSION MTZ0ZAL55NI | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `c10af1c0` | GREENFIELD REGRESSION MTZ24NMB632 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `cf9e6935` | GREENFIELD REGRESSION MTZCMBVS4V1 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `53dcd5d5` | GREENFIELD REGRESSION MTZCMTGE27B | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `9b3f9f9a` | GREENFIELD REGRESSION MTZDCHDW5UT | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `73f67654` | GREENFIELD REGRESSION MTZDZSK059S | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `9155eb02` | GREENFIELD REGRESSION MTZE0ALY1BG | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `a30b267e` | GREENFIELD REGRESSION MTZEOX6E7M4 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `e6aa667e` | GREENFIELD REGRESSION MTZF4S3B2B0 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `546d5b84` | GREENFIELD REGRESSION MTZF57UN3GR | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `9dd44eda` | GREENFIELD REGRESSION MTZFSXH32A4 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `46a531e8` | GREENFIELD REGRESSION MTZNOCWK6WB | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `748c128a` | GREENFIELD REGRESSION MTZNOTYM5C6 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `c70a41c5` | GREENFIELD REGRESSION MTZOB8MT28I | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `e2822a6b` | GREENFIELD REGRESSION MTZY0UX430P | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `b814b0d1` | GREENFIELD REGRESSION MTZY1BRD695 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `5989d118` | GREENFIELD REGRESSION MTZYOF3T4BO | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `d834edc4` | GREENFIELD REGRESSION MTZYYL8D67B | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `3b14c8e2` | GREENFIELD REGRESSION MTZYZ0IJ54K | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `9981244d` | GREENFIELD REGRESSION MTZZK1Z21ID | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `d1dc0383` | GREENFIELD REGRESSION MU00K2OC49C | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `86ba3335` | GREENFIELD REGRESSION MU00KDZK4SA | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `e53d0802` | GREENFIELD REGRESSION MU014FKW4XN | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `c84da0d0` | GREENFIELD REGRESSION MU08KKZQ2MW | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `e993f31f` | GREENFIELD REGRESSION MU08L0WFHA | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `3f7ab847` | GREENFIELD REGRESSION MU0A7M1D2XE | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `54bdc9e1` | GREENFIELD REGRESSION MU0AMYCH1UU | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `c6393449` | GREENFIELD REGRESSION MU0ANDDP5U3 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `d1d3354c` | GREENFIELD REGRESSION MU0B92JC4KA | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `a48b1378` | GREENFIELD REGRESSION MU0BOMCS3RG | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `2544ef01` | GREENFIELD REGRESSION MU0BP4SX45B | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `d401a8db` | GREENFIELD REGRESSION MU0CBWNC7MC | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `55086597` | GREENFIELD REGRESSION MU0K3SR85VN | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `3377062e` | GREENFIELD REGRESSION MU0K4B525QK | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `a418040f` | GREENFIELD REGRESSION MU0KPXOCH5 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `67b99afa` | GREENFIELD REGRESSION MU0L88C56RK | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `e498d7e1` | GREENFIELD REGRESSION MU0L8PCI1ZF | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `b6ba3ffe` | GREENFIELD REGRESSION MU0LWNHEAX | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `c04eef76` | GREENFIELD REGRESSION MU0M6Z4K3EP | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `5e61ab7a` | GREENFIELD REGRESSION MU0M7AI13RV | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `756bd506` | GREENFIELD REGRESSION MU0MSXMDKM | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `6a62ddea` | GREENFIELD REGRESSION MU0WG1712UL | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `b5b3fe72` | GREENFIELD REGRESSION MU0WGFE657L | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `2bd27011` | GREENFIELD REGRESSION MU0X13X63T2 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `fd2f7035` | GREENFIELD REGRESSION MU0XQ0DS33Q | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `b4b9fe6d` | GREENFIELD REGRESSION MU0XQH747PG | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `183c991d` | GREENFIELD REGRESSION MU0YASMF5MB | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `74c3cb8e` | GREENFIELD REGRESSION MU21O3R06ZG | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `a917b11b` | GREENFIELD REGRESSION MU21OL4H49C | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `a9ea7716` | GREENFIELD REGRESSION MU22C1TYE8 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `2447e10e` | GREENFIELD REGRESSION MU24M9GI20Y | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `f8b3db06` | GREENFIELD REGRESSION MU24MR1M4EE | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `c579f16c` | GREENFIELD REGRESSION MU25A2W07IE | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `597a1a8e` | GREENFIELD REGRESSION MU2CKC0O14 | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `51ec195f` | GREENFIELD REGRESSION MU2DD87E6OJ | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `78d91f11` | GREENFIELD REGRESSION MU2E0OWV1SU | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `55b7db7d` | GREENFIELD REGRESSION MU2EWXWE5Z | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `5b4a14f7` | GREENFIELD REGRESSION MU2FMVXY1RT | 1 / 3 | 0 → 3 | 2027-01-27 → 2027-01-30 | 0 → 3 | low → medium | yes |
| `0ce999f2` | OCTA PHASE21 GREENFIELD 20260910093852 | 7 / 63 | 6 → 63 | 2027-04-08 → 2027-05-23 | 0 → 45 | medium → high | yes |
| `4735659e` | Marina Bay Residences | 1 / 5 | 0 → 5 | 2027-08-05 → 2027-08-05 | 0 → 0 | medium → medium | no |
| `5c492505` | Marina Bay Residences (first build, superseded) | 1 / 5 | 0 → 5 | 2027-08-05 → 2027-08-05 | 0 → 0 | medium → medium | no |
| `225d9477` | Riverside Tower | 2 / 6 | 0 → 6 | 2030-02-15 → 2030-02-15 | 1142 → 1142 | high → high | no |
| `95c188f3` | Riverside Tower (original test fixture, archived Phase 22B) | 94 / 564 | 0 → 564 | 2030-02-15 → 2030-02-15 | 1176 → 1176 | high → high | no |
