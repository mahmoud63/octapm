# Phase 21 — financial reconciliation

**Project:** `OCTA PHASE21 GREENFIELD 20260910093852` (`0ce999f2-b175-432b-8551-20182b4fc990`)
**Created from nothing** in Phase 21A and continued in 21B — identity proven by
id and by state before 21B added a transaction (29 snapshot checks, all green).
**Runs:** 2026-09-10, branch `feat/p0-foundations-sprint1`.

Every figure was chosen before the run so it could be checked on paper, and
every comparison is made in integer cents.

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

## 2. Certification table

| # | figure | expected | actual | delta | |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | Original Budget | 1,700,000.00 | 1,700,000.00 | **0.00** | PASS |
| 2 | Approved Budget Revisions | 0.00 | 0.00 | **0.00** | PASS |
| 3 | Approved Change Orders | 250,000.00 | 250,000.00 | **0.00** | PASS (§3) |
| 4 | **Revised Budget** | **1,950,000.00** | **1,950,000.00** | **0.00** | PASS |
| 5 | Executed Commitments | 100,000.00 | 100,000.00 | **0.00** | PASS |
| 6 | Certified Subcontract Cost | 60,000.00 | 60,000.00 | **0.00** | PASS |
| 7 | Material Issue Cost | 704.00 | 704.00 | **0.00** | PASS |
| 8 | Direct Cost | 8,500.00 | 8,500.00 | **0.00** | PASS |
| 9 | Timesheet / Labour Cost | — | — | — | NOT EXERCISED |
| 10 | Direct-to-site Invoice Cost | 0.00 | 0.00 | **0.00** | PASS (none raised) |
| 11 | Legacy opening balance | 0.00 | 0.00 | **0.00** | PASS |
| 12 | **Total from source transactions** | **69,204.00** | **69,204.00** | **0.00** | PASS |
| 13 | **CostLedgerEntry total (SQL)** | **69,204.00** | **69,204.00** | **0.00** | PASS |
| 14 | CostLedgerEntry total (API) | 69,204.00 | 69,204.00 | **0.00** | PASS |
| 15 | Budget-line actual projection | 69,204.00 | 69,204.00 | **0.00** | PASS |
| 16 | Activity actual projection | 69,204.00 | 69,204.00 | **0.00** | PASS |
| 17 | Client Certified Revenue | — | — | — | NOT EXERCISED |
| 18 | Client Cash Received | 0.00 | 0.00 | **0.00** | PASS |
| 19 | Subcontract Cash Paid | 54,000.00 | 54,000.00 | **0.00** | PASS |
| 20 | Retention held | 6,000.00 | 6,000.00 | **0.00** | PASS |
| 21 | EV | 97,500.00 → 120,000.00 | same | **0.00** | PASS |
| 22 | AC-to-date | 704.00 | 704.00 | **0.00** | PASS |
| 23 | CPI | 138.4943 | 138.4943 | **0.0000** | PASS |
| 24 | PV / SPI | 0.00 / null | 0.00 / null | — | correct, see §6 |

**Financial delta: 0.00 on every exercised line.**

---

## 3. Why Revised Budget is 1,950,000.00, not 1,825,000.00

The brief suggested one 125,000.00 variation, giving 1,825,000.00. The project
carries **two** approved variations of 125,000.00 each.

The second was raised by a repeated run of stage 8, and **it cannot be taken
back**: reopen, disapprove, reject and edit are all refused —

```
POST .../change-orders/{id}/reopen      -> 409 APPROVAL_WORKFLOW_INVALID_TRANSITION
POST .../change-orders/{id}/disapprove  -> 409 APPROVAL_WORKFLOW_INVALID_TRANSITION
POST .../change-orders/{id}/reject      -> 409 APPROVAL_WORKFLOW_INVALID_TRANSITION
PATCH .../change-orders/{id}            -> 409 CHANGE_ORDER_APPROVED_LOCKED
```

That is **correct commercial behaviour** — an approved variation is a
contractual fact, not a draft — and it is now asserted as such. The stage was
made idempotent afterwards, and the arithmetic is asserted as an **identity**
rather than a fixed total, because the fixed total is no longer the truth:

```
ORIGINAL 1,700,000.00 + approved changes 250,000.00 + revisions 0.00
  = REVISED 1,950,000.00      exact, to the cent
```

A **40,000.00 draft variation is correctly excluded** from all of it, and
approving a variation moved the cost ledger by **0.00**.

---

## 4. Material issue — cost at the weighted average

```
PO-A   100 bags @ 10.00   delivered 60, then 40   1,000.00
PO-B    50 bags @ 13.00   delivered 50              650.00
                          150 bags               = 1,650.00
weighted average                                 =    11.00 exactly
```

| moment | stock | stock value | **actual cost** |
| --- | ---: | ---: | ---: |
| brand new project | 0 | 0.00 | **0.00** — 0 ledger entries |
| after all three deliveries | 150 bags | 1,650.00 | **0.00** — `bySource` still `{}` |
| after issuing 60 bags | 90 bags | 990.00 | **660.00** |
| after 4 more bags (RBAC probes) | 86 bags | 946.00 | **704.00** |

**Receiving stock creates no project cost.** Issuing it does, at 11.00 a bag.
The four extra bags were issued by the stage-7 authorisation probes proving a
storeman and a site engineer may draw stock; stage 7 asserts the ledger moved
by exactly `bags × 11.00`, so they are counted rather than hidden.

---

## 5. Subcontract — cost is the gross

```
executed subcontract   100,000.00   (2,000 m2 @ 50.00, blockwork, A310)
certified gross         60,000.00
retention at 10%         6,000.00
net paid                54,000.00
```

Actual cost rose by the **gross 60,000.00**, asserted in both directions
(`delta === 60,000.00` and `delta !== 54,000.00`). Recording the payment left
the ledger unchanged. Cash out 54,000.00; the 6,000.00 difference is exactly
the retention.

---

## 6. Earned value

EV was computed from the approved allocations and approved percentages
**before** the report was read:

```
A110  60,000.00 x 100%  =  60,000.00
A120  30,000.00 x  50%  =  15,000.00
A130  90,000.00 x  25%  =  22,500.00
                           97,500.00     product reported 97,500.00
```

Advancing A130 to 50% moved EV to **120,000.00** — exactly a further quarter
of its allocation — and left the cost ledger untouched.

**AC-to-date is 704.00, not 69,204.00, and that is correct.** The report
defines `AC = sum(CostRecord.actual where actualThroughDate <= cutoffDate)`.
This project runs in 2027 while the clock says 2026-09-10, so two of its three
cost records sit beyond the cutoff:

| cost record | amount | through | |
| --- | ---: | --- | --- |
| material (A130) | 704.00 | 2026-09-10 | within cutoff |
| direct cost (A200) | 8,500.00 | 2027-03-20 | **after cutoff, excluded** |
| subcontract (A310) | 60,000.00 | 2027-03-31 | **after cutoff, excluded** |

69,204.00 − 68,500.00 = 704.00, asserted. This is a **test-data property, not
a product defect** — I dated transactions in the project's construction year.

`CPI = 97,500.00 / 704.00 = 138.4943`, matched to four places. PV is 0.00 and
SPI `null` because every planned date is beyond the cutoff — correct, and
untested as a result.

---

## 7. Independent verification of the ledger

My own adversarial review noted that every actual-cost figure trusted one
endpoint. Summed straight from PostgreSQL instead:

```sql
SELECT "sourceType", COUNT(*), SUM(amount)
FROM "CostLedgerEntry" WHERE "projectId" = '0ce999f2…' GROUP BY "sourceType";

  direct_cost      1     8,500.00
  material_issue   5       704.00
  sub_pay_app      1    60,000.00
  TOTAL                 69,204.00      reversal entries: 0
```

This matches `/cost/reconciliation` exactly, from a different direction.

---

## 8. Lineage

```
69,204.00  reported actual cost
   └── budget projection 69,204.00 ═ activity projection 69,204.00 ═ ledger 69,204.00 (SQL and API)
       ├── 60,000.00  sub_pay_app
       │      └── pay app SC-002-PA01 (approved) → SOV line → commitment SC-002
       │            └── executed against a signed agreement → subcontractor company from the directory
       ├──  8,500.00  direct_cost
       │      └── DC-001, tower crane hire → cost code 09-100 → activity A200
       └──    704.00  material_issue  (5 entries, 64 bags @ 11.00)
              └── stock balance from GRN-00001/2/3 → PO-A and PO-B → activity A130, cost code 02-100
```

`ledger.entries` = 7, and the three sources sum to the total. No unexplained
value.

---

## 9. Not exercised

- **Timesheet / labour cost** — no labour booked.
- **Client commercial chain** — no prime contract, SOV, valuation, invoice or
  client payment, so revenue and AR are untested.
- **3-way match** and **direct-to-site invoice recognition**.
- **Retention release** — the 6,000.00 is held and was never released, so
  whether release posts cost a second time is unknown.

None of these failed. They were not reached.
