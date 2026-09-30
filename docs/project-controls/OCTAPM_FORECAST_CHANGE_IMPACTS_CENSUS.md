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
