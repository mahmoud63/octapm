# OctaPM — data duplication audit

**Audited:** `feat/p0-foundations-sprint1` @ `db176510ba76259c5adf71f889f21ec6b6f66c56` · 2026-09-07
**Companion to:** [`OCTAPM_SYSTEM_NERVOUS_SYSTEM.md`](./OCTAPM_SYSTEM_NERVOUS_SYSTEM.md)

The founding principle is *enter information once, then reuse it everywhere*.
This document lists every place the implementation breaks that promise.

Every finding is verified against the schema and the services. Nothing is
inferred from what would make sense.

**Severity**

| | |
| --- | --- |
| **P0** | can produce inconsistent **financial or legal** data |
| **P1** | major operational duplication |
| **P2** | user-efficiency cost |
| **P3** | minor convenience |

---

## D-P0-1 · Two vendor-matching rules create duplicate companies

Two code paths create a `Company` from a name, and they disagree.

| Path | Match rule | Result |
| --- | --- | --- |
| `company-workspace.createVendor:195` | `name: { equals, mode: "insensitive" }` | promotes the existing company |
| `bid.ensureVendorCompany:852` | `name: invitation.companyName` — **exact, case-sensitive** | creates a **new** company |

Awarding a bid to "abc piling" when "ABC Piling" already exists produces a
second company. The award writes the commitment against the new one — and that
new company has:

- no prequalification (so the award gate's `singleAwardLimit` cannot bite)
- no performance history (so the evaluation loop restarts at zero)
- no insurance record

**A single duplicate silently defeats three of the controls built on top of
`Company`.** This is financial and legal data: the subcontract is executed
against a company record that is not the one the business qualified.

**Fix:** one line — make `ensureVendorCompany` use the same case-insensitive
match. Optionally trim a trailing legal suffix before comparing.

---

## D-P0-2 · A purchase-order line cannot be cost-coded

`ProcurementPoLine` carries `activityId` (**required**), `packageId`,
`supplierId`, `materialMasterId`, `inventoryItemId` — and **no `costCodeId`,
no `budgetLineId`**.

Consequences, all verified:

- The buyer cannot code the order to the budget at the moment they know what it
  is for.
- The coding is typed for the first time on the **supplier invoice**
  (`DirectCostLine` carries all three keys), by finance, who were not the buyer.
- Committed cost by cost code is visible only through a separate `Commitment`,
  and `ProcurementOrder.commitmentId` is **nullable**.

This is displaced entry rather than double entry, and it is P0 because the
figure that reaches the budget is produced by someone guessing at what the
buyer intended.

---

## D-P0-3 · Two live subcontractor payment systems

| | Modern | Legacy |
| --- | --- | --- |
| Record | `SubPayApp` + `SubPayAppLine` | `SubValuation` |
| Subcontractor | `Commitment.vendorCompanyId` → `Company` | **`subcontractor String`, required, unlinked** |
| Ceiling | approved progress × SOV, revised by approved COs | none |
| Gates | over-claim, compliance, final-application closeout | none |
| Cash flow | `SubPayAppPayment` → outflow | `SubValuation.netPayable` → outflow |

**Both are read by `rebuildCashFlow`.** A project billing through the legacy
register produces cash-flow outflows attached to a free-text name — invisible to
prequalification, performance evaluation and closeout, and impossible to
reconcile against a commitment.

Two payment systems posting to the same cash flow is a financial-integrity
problem, not a tidiness one.

---

## D-P1-1 · Vendor identity is stored in eight places

`Company` (with `isVendor`) is the intended single source of truth.

| Table | Duplicated fields | Link | Verdict |
| --- | --- | --- | --- |
| `Company` | name, legalName, registration, tax, address, contact, trades | — | **the master** |
| `ProcurementSupplier` | name, contactName, email, phone, address, status | `companyId` **nullable** | 🔴 a full second profile, **per project** |
| `BidInvitation` | companyName, contactName, contactEmail | `vendorCompanyId` nullable | acceptable for ad-hoc invitees |
| `Rfq` | companyName, contactName, contactEmail | `vendorCompanyId` nullable | acceptable |
| `DirectCost` | `vendorName` | `vendorCompanyId` nullable | 🟡 |
| `DailyLogDelivery` | `supplierName` free text | **none** | 🟡 |
| `DailyLogManpower` | `companyName` free text | **none** | 🟡 |
| `MeetingAttendee`, `MeetingDistribution` | `companyName` free text | none | acceptable — minutes are a snapshot |

`ProcurementSupplier` is the worst: a complete supplier profile scoped to a
single project. The same supplier on four projects is entered four times, and
each copy drifts. A `vendorMigrationReport` exists to reconcile them after the
fact — an admission that the duplication is real.

---

## D-P1-2 · Fourteen models carry free-text party names beside proper keys

Verified by schema scan. Each of these has a free-text `owner` / `responsible` /
`subcontractor` **String** alongside its `assigneeCompanyId` / `assigneeUserId`
foreign keys:

`Risk` · `SubValuation` · `NcrRecord` (owner **and** responsible) · `ItpRecord` ·
`DefectRecord` · `SafetyIncident` (owner **and** responsible) · `MaterialTest` ·
`Rfi` · `Submittal` · `DrawingRecord` · `Transmittal` · `Correspondence`

These are legacy columns from before the party model existed. They are still
written and displayed, so two answers to "who owns this?" can disagree — and
only the FK reaches the closeout gate and the performance evaluation.

---

## D-P1-3 · Site progress is captured in four registers

| Register | Field | Feeds |
| --- | --- | --- |
| `ActivityProgress` | `pctComplete`, approved | **official EV** |
| `DailyLog*` | manpower, equipment, deliveries, delays, notes | daily report, weather delays |
| `LookaheadItem` | status planned / in progress / done / not done | PPC |
| `TimeEntry` | hours per activity | labour actual cost |

All four are activity-linked, so they *can* be reconciled — but a site engineer
records the same day's work up to four times, and **only `ActivityProgress`
moves earned value**. Marking a lookahead item "done" does not set progress; a
timesheet against the activity does not either.

This is the largest daily time cost in the product. The fix is not another
screen — it is deriving a suggested `ActivityProgress` from the lookahead status
and the daily log for a person to confirm.

---

## D-P1-4 · Insurance held per commitment, not per company

`Commitment.insuranceJson` holds required cover for **that subcontract**. A
subcontractor on three projects has their certificates entered three times, with
three expiry dates that can disagree.

Prequalification now holds `insurance` and `licenses` with their own `expiresAt`
at **company** level (`PrequalCriterion.tracksExpiry`) — the right home. Nothing
reconciles the two: a certificate that lapses on the prequalification does not
warn the three commitments relying on it, and the commitment-level gate does not
read the company-level record.

---

## D-P2-1 · "Purchase order" means two different records

| Record | Module | What it is |
| --- | --- | --- |
| `Commitment` with `type = 'purchase_order'` | Commercial | a committed value with an SOV and change orders |
| `ProcurementOrder` | Procurement | an operational order with lines, deliveries, invoicing |

Related through a **nullable** `ProcurementOrder.commitmentId`, with
`commitment.totalsFor` computing `drawnDown` from them. Different registers,
different permissions (`commitment` vs `procurement`), different lifecycles.

A team can raise an order that never appears in the commitment register, and
commit a value no order ever draws. **Nothing reconciles the two.** Each record
is individually justified; what is missing is a rule about which is
authoritative and a report showing both orphan sets.

---

## D-P2-2 · Material identity in three tables

`MaterialMaster`, `InventoryItem` and `ActivityMaterial` all describe a
material. `ProcurementPoLine` carries `materialMasterId` **and**
`inventoryItemId` as separate nullable columns, and `goods-receipt` creates an
`InventoryItem` on first delivery when a PO line has none — so the same physical
material can exist as a master, an inventory item, and an activity material,
created at different moments by different people.

---

## D-P3-1 · Reservations are a dead column

`StockBalance.reserved` exists and is **read** — `available = onHand − reserved`
is computed for display at `inventory.service:129` and `:208`. **No code ever
writes it.** Worse, the guard that actually blocks an issue
(`inventory.service:596`) checks `onHand` alone, so even if reservations existed
they would not be enforced.

Filed P3 only because nothing depends on it today; it becomes P1 the moment
anyone builds against `available`.

---

## Solved — recorded so they are not re-litigated

| | Finding |
| --- | --- |
| ✅ **Cost codes** | One org-level `CostCode` master with a `ProjectCostCode` adoption row. Every consumer — `BudgetLine`, `CommitmentSovLine`, `TimeEntry`, `ChangeEventLine`, `DirectCostLine`, `StockTransaction`, `BidPackageLine`, `AccountingCodeMapping` — points at the same master. The hypothesis that procurement and cost keep separate cost codes is **not supported**; the real problem is D-P0-2, that procurement has no cost-code field at all. |
| ✅ **Project data in documents** | `subcontract-agreement.buildAgreement` assembles the contract from the organisation, vendor profile, project, SOV, approved COs, scope matrix, programme activities, insurances and prime-contract terms. Nothing is retyped. The same holds for the certificate and the punch and commitment PDFs. |
| ✅ **Subcontractor lifecycle** | Directory → prequalification → bid → award → commitment → scope → agreement → pay app → closeout → evaluation → next prequalification is keyed on `companyId` throughout. Its one leak is D-P0-1. |

---

## Summary

| ID | Finding | Severity | Fix size |
| --- | --- | --- | --- |
| D-P0-1 | Two vendor-matching rules create duplicate companies | **P0** | one line |
| D-P0-2 | PO lines cannot be cost-coded | **P0** | medium |
| D-P0-3 | Two live subcontractor payment systems | **P0** | medium — retire or link the legacy register |
| D-P1-1 | Vendor identity in eight places; `ProcurementSupplier` duplicates per project | P1 | medium |
| D-P1-2 | 14 models carry free-text party names beside proper keys | P1 | medium |
| D-P1-3 | Progress captured in four registers, one moves EV | P1 | medium |
| D-P1-4 | Insurance per commitment, not per company | P1 | medium |
| D-P2-1 | "Purchase order" is two unreconciled records | P2 | small — a reconciliation report |
| D-P2-2 | Material identity in three tables | P2 | medium |
| D-P3-1 | Reservations are a dead column | P3 | small |

The pattern is unambiguous: **everything built recently honours the principle,
and the older procurement / supplier / legacy-billing layer does not.** All
three P0s live in that older layer, and D-P0-1 is a one-line fix.
