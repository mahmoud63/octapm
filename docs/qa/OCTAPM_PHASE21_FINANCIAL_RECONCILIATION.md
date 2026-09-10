# Phase 21 — financial reconciliation

**Project:** `OCTA PHASE21 GREENFIELD 20260910093852` (`0ce999f2-b175-432b-8551-20182b4fc990`)
**Created from nothing.** No seeded business record was used — see the certification.
**Run:** 2026-09-10 · branch `feat/p0-foundations-sprint1`

Every figure below was chosen before the run so it could be checked on paper,
and every comparison is made in integer cents. Nothing is "approximately".

---

## 1. The anchor

| line | cost code | type | original |
| --- | --- | --- | ---: |
| Site works and earthmoving | 01-100 | labour | 120,000.00 |
| Concrete supply | 02-100 | material | 400,000.00 |
| Reinforcement supply | 02-200 | material | 250,000.00 |
| Blockwork subcontract | 03-100 | subcontract | 300,000.00 |
| MEP first fix subcontract | 04-100 | subcontract | 350,000.00 |
| Finishes subcontract | 05-100 | subcontract | 180,000.00 |
| Preliminaries | 09-100 | indirect | 100,000.00 |
| **ORIGINAL BUDGET** | | | **1,700,000.00** |

---

## 2. The certification table

| # | figure | expected | actual | delta | |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | Original Budget | 1,700,000.00 | 1,700,000.00 | **0.00** | PASS |
| 2 | Approved Budget Revisions | 0.00 | 0.00 | **0.00** | PASS |
| 3 | Approved Change Orders | — | — | — | NOT EXERCISED (§5) |
| 4 | Revised Budget | 1,700,000.00 | 1,700,000.00 | **0.00** | PASS |
| 5 | Executed Commitments | 100,000.00 | 100,000.00 | **0.00** | PASS |
| 6 | Certified Subcontract Cost | 60,000.00 | 60,000.00 | **0.00** | PASS |
| 7 | Material Issue Cost | 704.00 | 704.00 | **0.00** | PASS |
| 8 | Direct Cost | 0.00 | 0.00 | **0.00** | PASS (none raised) |
| 9 | Timesheet / Labour Cost | — | — | — | NOT EXERCISED (§5) |
| 10 | Direct-to-site Invoice Cost | 0.00 | 0.00 | **0.00** | PASS (none raised) |
| 11 | **Total Actual Cost from source transactions** | **60,704.00** | **60,704.00** | **0.00** | PASS |
| 12 | **Total Actual Cost from CostLedgerEntry** | **60,704.00** | **60,704.00** | **0.00** | PASS |
| 13 | Actual Cost from budget projection | 60,704.00 | 60,704.00 | **0.00** | PASS |
| 14 | Actual Cost from activity projection | 60,704.00 | 60,704.00 | **0.00** | PASS |
| 15 | Legacy opening balance | 0.00 | 0.00 | **0.00** | PASS |
| 16 | Client Certified Revenue | 0.00 | 0.00 | **0.00** | PASS (§5) |
| 17 | Client Cash Received | 0.00 | 0.00 | **0.00** | PASS |
| 18 | Subcontract Cash Paid | 54,000.00 | 54,000.00 | **0.00** | PASS |
| 19 | Retention held | 6,000.00 | 6,000.00 | **0.00** | PASS |

**Financial delta: 0.00 on every exercised line.**

---

## 3. Material issue — cost recognised at the weighted average

Numbers picked so the weighted average is exact, with no repeating decimal:

```
PO-A   100 bags @ 10.00   delivered 60, then 40   1,000.00
PO-B    50 bags @ 13.00   delivered 50              650.00
                          150 bags               = 1,650.00
weighted average                                 =    11.00   exactly
```

| moment | stock | stock value | **project actual cost** |
| --- | ---: | ---: | ---: |
| brand new project | 0 | 0.00 | **0.00** — ledger empty, 0 entries |
| after all three deliveries | 150 bags | 1,650.00 | **0.00** — `bySource` still `{}` |
| after issuing 60 bags | 90 bags | 990.00 | **660.00** |

**Receiving stock creates no project cost.** That is the gate, and it holds:
1,650.00 of material arrived across three delivery notes — including a partial
delivery that correctly left 40 outstanding — and the cost ledger recorded
nothing at all. Issuing 60 bags posted **660.00 = 60 × 11.00**, classified
`material`, sourced `material_issue`.

Stock value fell by exactly the issue cost: 1,650.00 − 660.00 = 990.00.

A further **4 bags (44.00)** were issued by the stage 7 authorisation probes —
proving a storeman and a site engineer may draw stock — which is why the
material total is 704.00 rather than 660.00. Those probes are counted, not
hidden: stage 7 asserts the ledger moved by exactly `bags × 11.00`.

---

## 4. Subcontract — certified cost is the gross

```
executed subcontract   100,000.00   (2,000 m2 @ 50.00, blockwork, activity A310)
certified gross         60,000.00
retention at 10%         6,000.00
net paid                54,000.00
```

| | expected | actual |
| --- | ---: | ---: |
| gross certified | 60,000.00 | 60,000.00 |
| retention | 6,000.00 | 6,000.00 |
| net payable | 54,000.00 | 54,000.00 |
| gross − retention = net | 54,000.00 | 54,000.00 |
| **actual cost recognised at certification** | **60,000.00** | **60,000.00** |
| actual cost after the payment | 60,000.00 | 60,000.00 (unchanged) |

**Cost is recognised at the gross, not at what left the bank, and retention
does not reduce it.** Executing the subcontract posted committed cost and no
actual cost. Recording the payment moved cash and left the ledger untouched.

---

## 5. Cash against cost

| | |
| --- | ---: |
| certified subcontract cost | 60,000.00 |
| cash paid out | 54,000.00 |
| **difference** | **6,000.00** |
| retention held | 6,000.00 |

Cash flow reports `inflow 0.00, outflow 54,000.00, net −54,000.00`. The
difference between recognised cost and cash out is exactly the retention.

---

## 6. Lineage

Every figure traces back to a business record:

```
60,704.00  reported actual cost
   └── budget projection 60,704.00  ═  activity projection 60,704.00  ═  ledger 60,704.00
       ├── 60,000.00  sub_pay_app
       │      └── pay app SC-002-PA01 (approved)
       │            └── SOV line, inherited from the subcontract
       │                  └── commitment SC-002 (executed, signed agreement attached)
       │                        └── vendor = the subcontractor company created in stage 1
       └──    704.00  material_issue
              └── 64 bags at weighted average 11.00
                    └── stock balance built from GRN-00001/2/3
                          └── PO-A and PO-B, activity-linked to A130, cost code 02-100
```

There is no unexplained value: `ledger.entries` = 6, and the two sources sum
to the total.

---

## 7. What was not exercised

Stated plainly rather than left implied. These lines of the certification
table are marked NOT EXERCISED above:

- **Change management** — no change order was raised, so Revised Budget was
  never tested as anything other than equal to Original Budget.
- **Client billing** — no prime contract, SOV, valuation or client invoice.
- **Timesheets / labour cost** — no labour was booked.
- **Direct costs** and **direct-to-site supplier invoices** — none raised, so
  the ledger correctly shows 0.00 for both, but the posting rules for them are
  untested by this run.
- **Progress / earned value** — no progress was recorded, so PV, EV, SPI and
  CPI were not computed or checked.

None of these is a failure. They are scope this run did not reach, and the
figures above are complete and exact for what it did reach.
