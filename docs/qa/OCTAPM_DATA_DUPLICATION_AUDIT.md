# OctaPM — data duplication audit

**Date:** 2026-09-07 · **Branch:** `feat/p0-foundations-sprint1` · **Head:** `ee09f5b`
**Companion to:** [`OCTAPM_SYSTEM_NERVOUS_SYSTEM.md`](./OCTAPM_SYSTEM_NERVOUS_SYSTEM.md)

The founding principle of this platform is *enter information once, then reuse
it everywhere*. This document lists every place the current implementation
breaks that promise — where a person retypes something OctaPM already holds, or
where the same fact is stored in more than one table with no authority between
them.

Each finding is verified against the schema and the services, not inferred.

**Severity:** 🔴 creates wrong data · 🟡 wastes time and drifts · ⚪ acceptable denormalisation

---

## D1 · Vendor identity is stored in eight places 🔴

`Company` (with `isVendor`) is the intended single source of truth, established
by `OCTA-ADM-COMPANY-007`. It is not honoured consistently.

| Table | Duplicated fields | Link to `Company` | Verdict |
| --- | --- | --- | --- |
| `Company` | name, legalName, registration, tax, address, contact, trades | — | **the master** |
| `ProcurementSupplier` | name, contactName, email, phone, address, status | `companyId` **nullable** | 🔴 a full second copy, **per project** |
| `BidInvitation` | companyName, contactName, contactEmail | `vendorCompanyId` nullable | 🟡 needed for ad-hoc invitees |
| `Rfq` | companyName, contactName, contactEmail | `vendorCompanyId` nullable | 🟡 same |
| `DirectCost` | `vendorName` | `vendorCompanyId` nullable | 🟡 |
| `DailyLogDelivery` | `supplierName` free text | none | 🟡 no link at all |
| `DailyLogManpower` | `companyName` free text | none | 🟡 no link at all |
| `MeetingAttendee` / `MeetingDistribution` | `companyName` free text | none | ⚪ minutes are a snapshot |

**The worst of these is `ProcurementSupplier`.** It carries a complete supplier
profile — name, contact, email, phone, address, approval status — scoped to a
single project, with `companyId` merely optional. The same supplier working on
four projects is entered four times, and each copy can drift. A
`vendorMigrationReport` exists to reconcile them after the fact, which is an
admission that the duplication is real.

**The mechanism that keeps creating duplicates.** Two code paths create a
vendor from a name, and they disagree:

| Path | Match rule | Consequence |
| --- | --- | --- |
| `company-workspace.createVendor` | `name: { equals, mode: "insensitive" }` | promotes the existing company |
| `bid.ensureVendorCompany` *(bid.service.js:852)* | `name: invitation.companyName` — **exact, case-sensitive** | creates a **new** company |

So awarding a bid to "abc piling" when "ABC Piling" already exists produces a
second company. The award then writes the commitment against the new one — and
that new company has no prequalification, no performance history, and no
insurance record. The duplicate silently defeats three of the controls built on
top of `Company`.

**Fix (small, contained):** make `ensureVendorCompany` use the same
case-insensitive match as `createVendor`, and consider trimming a trailing
legal suffix before comparing.

---

## D2 · A purchase-order line cannot be cost-coded 🔴

`ProcurementPoLine` carries `activityId` (**required**), `packageId`,
`supplierId`, `materialMasterId`, `inventoryItemId` — and **no `costCodeId`
and no `budgetLineId`**.

Consequences, all verified:

- A buyer cannot code an order to the budget at the moment they raise it, which
  is the moment they know what it is for.
- The cost coding is instead typed for the first time on the **supplier
  invoice** (`DirectCostLine` carries `costCodeId`, `budgetLineId`,
  `activityId`), by a different person — usually finance — who was not the
  buyer and is guessing.
- Committed cost by cost code can only be seen through the separate
  `Commitment` record, if the PO happens to have been linked to one
  (`ProcurementOrder.commitmentId` is nullable).

This is not duplicate entry so much as **displaced entry**: the fact is known
early and captured late, by the wrong person. It is the root cause behind
D3 as well.

---

## D3 · "Purchase order" means two different records 🟡

| Record | Where | What it is |
| --- | --- | --- |
| `Commitment` with `type = 'purchase_order'` | Commercial module | a committed value against the budget, with an SOV and change orders |
| `ProcurementOrder` | Procurement module | an operational order with lines, deliveries, invoicing status |

They are related — `ProcurementOrder.commitmentId` lets an order draw down a
commitment, and `commitment.totalsFor` computes `drawnDown` from them — but
that link is **optional**, and the two live in different workspace modules with
different registers, different permissions (`commitment` vs `procurement`) and
different lifecycles.

A team can therefore raise a purchase order that never appears in the
commitment register, and commit a purchase-order value that no operational
order ever draws. Nothing reconciles the two.

**This is a naming and reconciliation problem, not a bug.** The two records are
each individually justified. What is missing is a rule about which one is
authoritative and a report that shows commitments with no orders and orders
with no commitment.

---

## D4 · Subcontractor data across the lifecycle 🟢 mostly solved

This chain is the one the platform gets **right**, and it is worth recording as
the pattern the others should copy.

| Stage | Where the data comes from |
| --- | --- |
| Registration | `Company` — entered once |
| Prequalification | reads `Company`; assessment held at org level, reused on every project |
| Bid invitation | pre-fills company, contact and email from `Company` |
| Award | creates the `Commitment` with the SOV built from the bid lines |
| **Subcontract agreement** | **assembled from records** — org, vendor profile, project, SOV, approved COs, scope matrix, programme activities, insurances, prime-contract terms. Nothing is retyped |
| Pay applications | ceilings derived from the SOV and approved progress |
| Closeout | reads the punch register, insurance, payment applications, retention |
| Evaluation | reads NCRs, punch, safety, change orders, closeout |
| Next prequalification | reads the evaluation history |

The one leak is D1: an award to a name that does not match an existing company
exactly starts a **second** company, and the whole chain above then runs on the
duplicate.

---

## D5 · Project data in generated documents ⚪ solved

Checked and clean. `subcontract-agreement.service.buildAgreement` reads the
organisation, the vendor's `Company` profile, the project, the commitment SOV,
approved change orders, the scope matrix, the activities for the programme, the
`insuranceJson` and the `PrimeContract` for governing terms — and prints them.
No project or party fact is retyped into a contract.

The same is true of the certificate (`prime-contract.certificateFinancials`)
and the punch and commitment PDFs.

---

## D6 · Cost codes 🟢 solved

Verified: there is **one** org-level `CostCode` master and a `ProjectCostCode`
adoption row that points at it. Every consumer —
`BudgetLine`, `CommitmentSovLine`, `CommitmentChangeOrder`, `TimeEntry`,
`ChangeEventLine`, `DirectCostLine`, `StockTransaction`,
`AccountingCodeMapping`, `BidPackageLine` — references the same `CostCode`.

The user's hypothesis that procurement and cost keep separate cost codes is
**not** supported by the schema. The real problem is D2: procurement has no
cost code field at all.

---

## D7 · Progress is captured in four registers 🟡

| Register | Field | Feeds |
| --- | --- | --- |
| `ActivityProgress` | `pctComplete`, approved | **official EV** |
| `DailyLog*` | manpower, equipment, deliveries, delays, notes | daily report, weather delays |
| `LookaheadItem` | `status` planned/in progress/done/not done | PPC |
| `Timesheet` / `TimeEntry` | hours per activity | labour actual cost |

All four are activity-linked, which is the saving grace — they can be
reconciled. But a site engineer records the same day's work up to four times,
and only `ActivityProgress` moves earned value. `LookaheadItem.status` "done"
does not set progress; a timesheet against an activity does not either.

**This is the largest daily-time cost to a site team in the product**, and the
fix is not another screen — it is deriving a suggested `ActivityProgress` from
the lookahead status and the daily log, for a person to confirm.

---

## D8 · Insurance is recorded per commitment, not per company 🟡

`Commitment.insuranceJson` holds the required cover for **that subcontract**.
A subcontractor working on three projects has their certificates entered three
times, with three expiry dates that can disagree.

Prequalification now holds `insurance` and `licenses` criteria with their own
`expiresAt` at **company** level (`PrequalCriterion.tracksExpiry`), which is
the right home. Nothing reconciles the two: a certificate that lapses on the
prequalification does not warn the three commitments relying on it, and the
commitment-level insurance gate does not read the company-level record.

---

## Summary

| ID | Finding | Severity | Fix size |
| --- | --- | --- | --- |
| D1 | Vendor identity in 8 places; two disagreeing match rules create duplicate companies | 🔴 | small (one line) + medium (supplier consolidation) |
| D2 | PO lines cannot be cost-coded; coding displaced to the invoice | 🔴 | medium |
| D3 | "Purchase order" is two unreconciled records | 🟡 | small (a reconciliation report) |
| D7 | Site progress captured in four registers, only one moves EV | 🟡 | medium (derive and confirm) |
| D8 | Insurance held per commitment, not per company | 🟡 | medium |
| D4 | Subcontractor lifecycle | 🟢 solved | — |
| D5 | Project data in documents | 🟢 solved | — |
| D6 | Cost codes | 🟢 solved | — |

The pattern is clear: **everything built recently honours the principle, and
the older procurement/supplier layer does not.** D1 and D2 are both in that
older layer, and both are cheap to fix relative to their impact.
