# OCTAPM PHASE 22 — ENTER-ONCE / USE-EVERYWHERE AUDIT

Mandatory Phase 22 gate. For each major entity: its authoritative owner, and whether the system asks
the user to retype data that already exists (DUPLICATE ENTRY) instead of referencing the record.

Evidence is from the live New RFI form, the Add Change Order form, and the module/registry structure.
Selectors that reference existing records are the preferred model; free-text fields that duplicate an
existing record are flagged.

---

## Authoritative registries (single owner — good)

| Entity | Authoritative owner | Referenced elsewhere by selector? |
| --- | --- | --- |
| Company | `/company`, Vendors `/vendors` | Yes — vendor/supplier pickers on POs, commitments, direct costs |
| Contact | Directory `/directory` | Yes (assignees, distribution) |
| Vendor / Subcontractor | Vendors registry | Yes — supplier shown on PO/commitment |
| Cost Code | Cost codes registry `/cost-codes` | Yes — cost-code pickers in cost/commitment flows |
| BOQ item | Project BOQ | Yes — BOQ allocations reference items |
| Activity | Schedule Activities | **Yes — strong**: New RFI "Activity" picker; Add Change Order "Affected Activities" checkboxes; pay-app SOV lines carry activityId |
| Location | Project Locations | Yes — New RFI "Location" picker |
| Party (project party member) | Team | Yes — "Owner party" picker on RFI |
| User | Users registry | Mostly — assignees/manager/distribution are pickers |
| Warehouse / Bin | Inventory Warehouses | Yes — movements reference them |
| Commitment / PO | Commercial / Procurement | Yes — pay apps and invoices reference them |

## Reuse observed as GOOD (reference, not retype)

- **New RFI form:** Activity, Location, Owner party, Manager, Assignees, and Distribution are all
  reference selectors of existing records. No retyping of people, activities or locations. (Strong.)
- **Add Change Order:** "Affected Activities" is a checkbox list of the project's real activities.
- **Cost chain:** Actual cost is derived from the cost ledger (verified: P21 ledger = Actual =
  $71,204), not re-entered per report.

## DUPLICATE ENTRY / reuse gaps (flagged)

| # | Where | Field | Problem | Severity |
| --- | --- | --- | --- | --- |
| DR-1 | Add Change Order | "Supporting Document IDs" | User must **type raw document UUIDs**; no document picker. A normal user cannot know a document's ID. | UX-P1 (duplicate/■blocking for the intended reuse) |
| DR-2 | Add Change Order | "Raised By" | **Free text** instead of a user selector; the raiser already exists as a user/contact. | UX-P2 (duplicate entry) |
| DR-3 | Add Change Order | "Category" | Free text ("Variation, Claims, etc.") rather than a controlled list → inconsistent categories across records. | UX-P3 |
| DR-4 | Inventory items | Item master | Seed shows repeated near-duplicate items ("Aggregate DUPA …", uncategorised) — indicates the item create flow does not steer users to an existing item / category, allowing duplicate masters. | UX-P2 (data-model hygiene) |
| DR-5 | Change Order → budget | budget line allocation | Known from Phase 21 (P21-012): a variation's `budgetLineId` is not carried, so approved change value sits on a holding line and must be redistributed by a manual budget transfer — the allocation entered once is not reused downstream. | CONNECTIVITY / UX-P2 |

## Verdict

**Data reuse is strong for the "hard" relational entities** (activity, location, cost code, party,
user, vendor, BOQ item, warehouse) — these are referenced, not retyped, and the cost ledger is a
single derived source of truth. **The gaps are at the edges of forms**: document references and the
"raised by" person are typed rather than picked, one controlled list is free text, and the item master
permits duplicates. These are contained, fixable form-level issues rather than a duplicated data model.

**Gate result: PASS with conditions** — clear the document-picker and person-picker gaps (DR-1, DR-2)
before external pilot, since typing raw IDs is not something a construction client will accept.

---

## Phase 22A update (2026-09-15)

| Field | Before | After | Source reused |
| --- | --- | --- | --- |
| Change order — Raised By | free text | picker: Project team (name, role) · Parties (company, role) · Other / external free text; stores the display name in the existing column, so every earlier record reads as before | project team API, project parties API |
| Change order — Supporting documents | raw `ProjectDocument` UUIDs typed by hand | searchable picker over the document register (reference, title, number, revision, status) with chips; same ids persisted, same backend validation | document register API |
| Audit / approval / status feeds — actor | raw user id | person's name (one batched lookup in `audit.service.listEvents`), "Former user" when the account is gone | users |
| Workspace quick actions — project | n/a | remembered per person (local), defaults to the first active project; each action opens the module's own dialog | projects API |

Residual (recorded): workflow attachments such as RFI instruction letters are not register documents, so the
document picker cannot offer them (22A-P2-01); Category stays free text (UX22-15).
