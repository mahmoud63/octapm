# Procurement and inventory — user experience test

**Phase 12** · **Written:** 2026-09-08 · **Cards:** OCTA-PROC-APPROVAL-067, OCTA-INV-PROJECT-068
**Drive:** [`frontend/e2e/21-procurement-lifecycle.spec.ts`](../../frontend/e2e/21-procurement-lifecycle.spec.ts)

> Requirement → purchase order → approval → issue → long lead → delivery →
> goods receipt → scan → warehouse → inventory → issue to an activity →
> actual cost → supplier invoice → three-way match

Numbers below were emitted by the drive. **Two defects were found, fixed and
re-driven**, one of which was silently losing material cost.

---

## 1. The journeys, as measured

| Persona | Goal | Steps | Typed | Inherited | Duplicates | Friction |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| **Procurement Manager** | Buy the rebar and get it on site | 3 | **8** | 1 | **4** | 1 |
| **Project Manager** | Approve and issue | 2 | **0** | 1 | 0 | 0 |
| **Warehouse Manager** | Receive and put away | 4 | 2 | 4 | 0 | 0 |
| **Finance** | Match the invoice | 1 | 0 | 1 | 0 | 0 |

The buyer types eight values to raise one order line. Four of them are values
the system already holds — see below. Everything downstream is clean: the PM
approves without typing anything, the storeman types only the quantity that
turned up.

---

## 2. Duplicate data entry

### UX-DUP-PROC-001 · The purchase-order reference is typed — 🟡
Every other record in the product numbers itself: bid packages `BP-001`,
subcontracts `SC-001`, pay applications `SC-001-PA01`, goods receipts nothing.
A purchase order alone asks the buyer to invent a reference. Two buyers working
the same afternoon can collide, and nothing in the register suggests a format.

### UX-DUP-PROC-002 · The line description repeats the order `item` — 🟡
Typed one field apart, on the same form, for a single-line order.

### UX-DUP-PROC-003 · The unit is typed although the item states it — 🟡
The order line names an inventory item that already carries `unit: "bag"`. The
buyer types "bag" again, and nothing checks the two agree.

### UX-DUP-PROC-004 · The required date is typed twice — 🟡
`requiredBy` on the header and `requiredDate` on the line, adjacent fields on
the same screen, both meaning the same delivery.

### UX-DUP-PROC-005 · The goods-receipt number is typed — 🟡
Same problem as the order reference, in the warehouse, where somebody is
holding a delivery note and a phone.

---

## 3. Defects found, fixed and re-driven

### 🔴 → ✅ OCTA-PROC-APPROVAL-067 · A purchase order was born "issued"

`POST /projects/{id}/procurement/purchase-orders` stored every new order as
`status: 'issued'`:

```js
status: payload.status || 'issued',
```

Straight from the database, before the fix:

```
PO-9hem7   stored="issued"   submitted=false approved=false issued=false
PO-ratpj   stored="issued"   submitted=false approved=false issued=false
```

An order that reads as *sent to a supplier*, with no submission, no approval and
no issue behind it — the register's `submit → approve → issue` workflow bypassed
entirely, and nothing in the record saying so. Anybody with `procurement:create`
could produce one. The audit trail has no decision to show, because none was
made.

**Fix:** a new order starts `planned` (the schema's own default), and planning
may set only `planned` or `draft`. Declaring one `approved`, `issued` or
`acknowledged` at creation is refused with `PO_STATUS_NOT_PLANNABLE`, which
names the route that makes the decision properly.

**Re-driven:**

```
PO_VALUE                  status="planned"  submittedAt=null approvedAt=null issuedAt=null
PO_CANNOT_BE_BORN_ISSUED  400
PO_SUBMIT                 200   (procurement)
PROCUREMENT_CAN_APPROVE   403   (correctly not theirs)
PO_ISSUE                  200   (after the PM approved)
```

### 🔴 → ✅ OCTA-INV-PROJECT-068 · Material was consumed and cost nothing

`postConsumptionCost` began:

```js
if (!sign || !movement.projectId) return null;
```

and `projectId` is **optional** on the issue endpoint. So a storeman issuing
stock to an activity — naming the work exactly — produced a movement with no
project, and the posting was skipped. Stock left the warehouse, was consumed on
site, and **no cost was recognised anywhere**. Silently: the response was a
normal `201`.

Measured before the fix, on a real issue to an activity:

```
MATERIAL_ISSUE      201
ISSUE_BECOMES_COST  moved: 0
```

**Fix:** an issue that names an activity takes that activity's project, because
the caller has already said which project it is — making them say it twice is
what invited them to leave it out.

**Re-driven:**

```
ISSUE_BECOMES_COST   moved: 640   balanced: true
ISSUE_COST_CODING    material_issue · 640 · costType material · on the activity
                     unitCost 640, from the weighted average, not the last price
```

**And the case that legitimately has no project is now audible.** An issue
against a company cost code with no project — yard consumables — still posts no
project cost, because the cost ledger is project-scoped and inventing a project
would be worse. But `issueStock` now returns `costPosted: false` with a note
saying why, instead of leaving the absence to be discovered later.

A first attempt at this fix **refused** the cost-code-only issue outright. That
was wrong — it would have blocked a legitimate company-level issue — and three
existing tests said so. The guard was withdrawn and replaced with the report.

---

## 4. Disconnected nerves found (not fixed in this phase)

### 🔴 DELIVERY-01 · Two receipt endpoints, and one of them creates no stock

| | Creates a receipt record | Creates stock |
| --- | :---: | :---: |
| `POST …/procurement/purchase-orders/{id}/receipts` | ✅ | **❌** |
| `POST /inventory/goods-receipt` | ✅ | ✅ |

`recordDeliveryReceipt` in the procurement service contains no reference to
inventory at all — no stock transaction, no movement, no item. It takes a
free-text `warehouseLocation` and has **no `warehouseId`**, so it could not put
stock anywhere even if it tried.

Driven, both against the same order:

```
PROCUREMENT_RECEIPT_CREATES_STOCK  201, on-hand unchanged, acceptsWarehouseId: false
GOODS_RECEIPT (inventory)          201, stock created
```

A delivery recorded by the buyer in Procurement therefore never becomes
inventory, and the storeman has to record it a second time. Which of the two a
user reaches depends on which module they opened.

### 🟡 LONGLEAD-01 · The required-on-site date does not reach the long-lead view

`LONG_LEAD {"rows": 0, "mentionsThisOrder": false}` for an order carrying a
`requiredBy` 45 days out. The long-lead view reads procurement *packages*, not
orders, so an order raised without a package is invisible to it.

### 🟡 RFQ-01 · There is no material RFQ

The brief's chain has *Procurement Request → RFQ → Supplier Quotes → Comparison
→ Selection*. In the product:

- `Rfq` is bound to a `changeEventId` — it is a **change-order pricing request**,
  not a materials enquiry.
- Comparing supplier quotes for materials is done by the **bid module** with
  `commitmentType: purchase_order` — which works, and was driven in Phase 11,
  but lives under Commercial and is presented as subcontract bidding.

So the capability exists and is good; the route to it from Procurement does not.
**Documented rather than built**, per the brief.

---

## 5. Data lineage, traced

| Chain | Result |
| --- | --- |
| Supplier → PO → invoice | ✅ supplier chosen from the register, carried through |
| Material → PO → receipt → inventory → issue | 🟡 works through the **inventory** receipt only (DELIVERY-01) |
| Cost coding → PO line → issue → `CostLedgerEntry` → activity | ✅ after the fix — activity, cost type and weighted-average unit cost all arrive |
| Required-on-site → procurement → long lead → schedule | 🔴 not connected for orders (LONGLEAD-01) |

Verified from the database rather than from a screen: the PO line stored
`activity=set costCode=set budgetLine=set`, and the resulting ledger entry
carried the activity and `costType: material` at the weighted average.

---

## 6. Three-way match

`GET /inventory/match/order/{id}` returned `verdict: "matched"` for an order with
one receipt and no invoice.

The scenarios the brief enumerates are covered by the existing suite
(`e2e/11-inventory.spec.ts`), which drives an invoice for more than was accepted
and an order with nothing wrong. **Not re-driven here**, and the remaining
enumerated cases — partial delivery, invoice beyond PO, duplicate invoice,
cancelled PO, direct-to-site material — are **⚪ not yet tested** and are carried
into the Phase 15 adversarial pass rather than claimed.

**Stocked material is not double-counted**: proven in Phase 8 and re-confirmed
here — the goods receipt moved actual cost by **0.00**, because receiving stock
is an asset, and only the issue is a cost.

---

## 7. Permission boundaries observed

| | |
| --- | --- |
| Procurement raises an order | ✅ |
| Procurement approves its own order | **403** — correct separation |
| PM approves and issues | ✅ |
| Warehouse posts a goods receipt | ✅ |
| Warehouse issues to an activity | ✅ |

As in the subcontractor chain, the handoffs are correct but silent: nothing on a
submitted order says it is now waiting on the PM.

---

# Addendum — Phase 19: what changed underneath, and what has not changed on screen

*2026-09-08. Full write-up: `OCTAPM_PROCUREMENT_SPINE_CERTIFICATION.md`.*

## Duplicate entry removed

Classified as the brief asked — auto-generate, inherit, keep manual, or keep
with override.

| Was typed twice | Now | How |
| --- | --- | --- |
| Goods-receipt number | **AUTO-GENERATE, with override** | It was already generated when omitted, but by counting rows and adding one — two storemen scanning at the same moment got the same number. It now reads the highest already issued; the unique index remains the real guarantee. A delivery note the supplier printed is still accepted as given. |
| Where the delivery went | **INHERIT, with override** | A free-text `warehouseLocation` that created no stock is replaced by a real `warehouseId`. Omit it and the project's own warehouse is used when it has exactly one, otherwise the single central one; when neither is unambiguous the receipt is refused rather than posted into nowhere. |
| Long-lead status, warehouse status, expected delivery, delivered-at, order-by, supplier | **INHERIT** | Derived from the linked procurement package, its orders and its deliveries. Typing one is refused by name, not ignored. |
| Quote enquiry title, description, currency, due date | **INHERIT** | Taken from the procurement package. The due date is its latest order date, because that is when the quotes are needed. |
| Commitment type on a materials enquiry | **AUTO** | Chosen for the buyer. Asking a buyer to pick "purchase order" over "subcontract" is asking them to know which engine they are in. |
| Item, quantity, unit, rate through quote → award → order | **INHERIT** | Stated once on the enquiry and carried to the purchase order unchanged: "Anodised panel, 3mm", 2,000 at 168, verified end to end. |

### Kept manual, deliberately

- **Purchase-order reference.** Buyers match these against supplier paperwork
  and their own numbering. Auto-numbering was considered and not applied: the
  `ref` is how a person finds the order in an email thread.
- **Accepted and rejected quantities.** What actually came off the lorry is an
  observation, not a derivation.

## What has *not* changed, and is the honest gap

**Everything above is API-level.** The Procurement module's own screens were not
touched in this phase:

- 🔴 No "Request quotes" entry point on a procurement package page — the route
  exists and is driven, the button does not.
- 🔴 No warehouse picker on a procurement receipt screen, because there is no
  procurement receipt screen; the only goods-receipt UI is under Inventory.
- 🔴 No linked long-lead indicator, so a planner cannot see on screen that a
  status is derived rather than theirs to edit — they will find out from the
  refusal.
- 🔴 **Ball-in-court is not implemented.** It was asked for in this phase and is
  not built: no record shows *Awaiting Procurement*, *Awaiting PM Approval*,
  *Awaiting Supplier*, *Awaiting Warehouse Receipt* or *Awaiting Finance*.

The four-persona browser drive that would measure steps, dialogs, inherited
values and dead ends across PM, Procurement Manager, Warehouse Manager and
Finance was **not performed**, because the screens those personas would use for
the new capabilities do not exist yet. Measuring the old screens again would
re-report the Phase 12 findings, not this phase's.

**This is the next phase's work, and it is stated here rather than implied.**
