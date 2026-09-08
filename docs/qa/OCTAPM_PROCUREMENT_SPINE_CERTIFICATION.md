# Procurement integration spine certification

**Phase 19** · **Written:** 2026-09-08
**Cards:** OCTA-PROC-RECEIPT-081 · OCTA-PROC-LEADALERT-082 · OCTA-PROC-LONGLEAD-083 · OCTA-PROC-QUOTES-084 · OCTA-PROC-RECEIPT-085 · OCTA-PROC-RECEIPT-086
**Harnesses:** `scratchpad/delivery-spine.js`, `longlead-spine.js`, `quote-spine.js`, `procurement-attacks.js`

Three seams, named in the Phase 18 review and built here. None of them needed a
new capability — each needed an existing one to be reachable and the duplicate
to stop being written.

**Delivery spine 11/11 · Long-lead spine 10/10 · Quote spine 11/11 · Attacks 12
held, 0 broke through, 0 skipped.**

---

## 1. DELIVERY-01 — one writer, two doors

### What the two doors actually did

Driven against identical set-ups — same project, same activity, same material
requirement, two equivalent orders, 400 units each:

| | inventory door | procurement door |
| --- | --- | --- |
| PO line received | 400 ✅ | 400 ✅ |
| **Stock movement** | **1** ✅ | **none** 🔴 |
| **`ActivityMaterial.receivedQty`** | **0** 🔴 | **400** ✅ |
| **Refuses a never-issued order** | **yes** ✅ | **no** 🔴 |

Neither was a superset of the other. A delivery booked from Procurement left the
warehouse empty and the material invisible to issues, valuation and the
three-way match. A delivery booked from the warehouse — **the only path the
product's own screen offers** — left the planner's material list reading nought
received after the lorry had been and gone. And the guard added in Phase 15
against receiving on an order nobody ever sent existed on one writer only.

That last one is the argument for unification in a sentence: **every guard added
to one writer had to be remembered on the other, and was not.**

### What was done

`goods-receipt.service` is the only writer. It already had the warehouse, the
stock movement, weighted-average valuation, the buyer's coding carried onto the
stock ledger, the over-receipt guard and the duplicate delivery note. It gained
the two things only the other one did — the material requirement, and the
lead-time alert, which is a question about whether material arrives in time and
is obviously changed by a delivery. The procurement route keeps its URL and
delegates. The second writer is gone, not left behind.

### Warehouse, not free text

Receiving stock needs a real warehouse — free text is *why* those deliveries
created nothing. A receipt takes the warehouse it names; failing that the
project's own when it has exactly one; failing that the single central one. It
never chooses between several, and never falls through silently:

```
WAREHOUSE_REQUIRED_FOR_RECEIPT
  "Say which warehouse the delivery went to — this project has more than one."
  "This delivery has nowhere to go: the project has no active warehouse."
```

Historical `warehouseLocation` values stay readable and stop being written.

### Driven — 11 / 11

| | |
| --- | --- |
| Same delivery note refused from the other door | ✅ both directions |
| 400 (Procurement) + 350 (Inventory) = 750 of 1,000, 250 remaining | ✅ |
| The material requirement keeps up with the deliveries | ✅ |
| 300 more on a 1,000 order | ✅ `409 RECEIPT_OVER_ORDER` |
| The final 250 completes the order | ✅ line and order `received` |
| A receipt naming no warehouse resolves to the only one | ✅ |
| **On hand equals what was accepted** | ✅ 1,000 |
| **Receiving stock is not a project cost** | ✅ ledger 0.00 |
| **Issuing 200 posts 100,000 at weighted average** | ✅ onto the activity |

---

## 2. 🔴 → ✅ OCTA-PROC-RECEIPT-085 · Two lorries at the gate

Found by the concurrency attack, and it took three attempts to get right —
worth recording, because each attempt exposed the next layer.

**First:** two concurrent deliveries of a new item both created the inventory
item; the second broke the unique index and surfaced as `500 P2002`. A failed
statement poisons a Postgres transaction, so catching it in place is no help.
Moved item resolution ahead of the transaction, where a collision costs one
re-read.

**Then the real defect appeared underneath it.** With both transactions now
running to completion:

```
201 / 201  —  two receipt records accepting 60 each
              the PO line reading 60 of 100
```

A **lost update**. Both read a received quantity of nought, both computed
0 + 60, both wrote 60. Two receipts totalling 120, a line saying 60, and both
storemen told it worked — the books disagreeing with themselves. The
over-receipt guard read the same stale figure, so it could not catch it either.
**The 500 had been hiding this.**

**Fixed** by locking the lines being received, and taking the true figures from
the lock itself rather than a second read that could go stale between the two:

```sql
SELECT * FROM "ProcurementPoLine" WHERE id = ANY($1::text[]) FOR UPDATE
```

**Re-driven:** `201 / 409 RECEIPT_OVER_ORDER` — the first delivery posts, the
second waits, reads 60, and is refused because 120 exceeds 100. One receipt
record, one quantity, and the books agree.

---

## 3. 🔴 → ✅ OCTA-PROC-RECEIPT-086 · A receipt on the wrong project's order

**This one was mine.** The old procurement writer scoped its order lookup by
project. The goods-receipt service scopes by organisation, because its own route
is organisation-level. Delegating the project route to it dropped the project
check, and a delivery could be booked from one project's route against another
project's order — putting the stock and the cost on the wrong job, with a `201`.

Caught only because the attack was re-run after being made to land properly
(see §6). **Fixed:** a caller that arrives through a project's route says which
project it is, and the order must be on it. Re-driven: `404 PO_NOT_FOUND`.

---

## 4. 🔴 → ✅ OCTA-PROC-LEADALERT-082 · Ordering the same material twice

`ProcurementLeadTimeAlert` is unique on `(projectId, poLineId)` **and** on
`(projectId, activityMaterialId)`, but was looked up by line alone. So the
second purchase order for a material found no alert, created one, and broke a
constraint the lookup never consulted — `500 P2002` for the ordinary act of
raising a top-up order, a split delivery, or a second supplier.

**Fixed:** a line that names a material is looked up by that material. One alert
per material, pointing at the line that most recently changed its outlook.

---

## 5. LONGLEAD-01 — link, do not duplicate

`ProcurementPackage` and `LongLeadItem` carried the same six facts with no
relationship, so the planner and the buyer maintained the dates and statuses
separately and the register could not see what had been ordered.

A nullable `procurementPackageId`, **set by id and never matched by name**.
Nullable on purpose: a long-lead item is registered before anything is ordered,
which is the whole point of the register.

Once linked, six fields are read rather than typed — status, warehouse status,
expected delivery, delivered-at, order-by, supplier — from the package, its
orders and its deliveries. Typing one is refused by name:

```
409 LONG_LEAD_FIELD_DERIVED
  "This item is linked to a procurement package, so status comes from the
   package, its orders and its deliveries. Change it there, or unlink the item
   to maintain it by hand."
```

Refused rather than quietly ignored, because a planner who edits a status and
watches it snap back has learned nothing about why.

### Driven — 10 / 10

| | |
| --- | --- |
| Registered before anything is ordered, and hand-maintained | ✅ |
| Linked by id | ✅ |
| **The package's required-on-site date replaces what was typed** | ✅ 2027-05-15 → 2027-07-01 |
| A derived field cannot be typed here as well | ✅ `409` |
| **Issuing the order moves the register to ordered** | ✅ nobody retyped it |
| **The goods receipt moves it to delivered** | ✅ warehouse `received` |
| Unlinking hands it back to the planner | ✅ |
| Another project's package | ✅ `404` |

---

## 6. RFQ-01 — surface the engine, do not build a second

`Rfq.changeEventId` is required, which makes an RFQ a change-pricing request.
That is right and was left alone. Material quote comparison is a different job,
and the bid engine already does it — `BidPackage.commitmentType` has accepted
`purchase_order` all along. What was missing was a way in from Procurement and
any connection back to the package being priced.

So: no second RFQ model, no second comparison engine. A nullable
`procurementPackageId` on `BidPackage`, and a Procurement route that opens an
enquiry of the right type against it, inheriting title, description, currency
and due date. The due date is the package's **latest order date**, because that
is when the quotes are actually needed.

### Driven — 11 / 11, and the point is what survives

| | |
| --- | --- |
| Procurement asks for quotes without choosing a commitment type | ✅ |
| The enquiry inherits the requirement | ✅ linked back to the package |
| Item, quantity and unit stated once | ✅ 2,000 M² |
| Two suppliers price it through their own links | ✅ 175 and 168 |
| Compared side by side | ✅ 350,000 against 336,000 |
| Selected, then awarded | ✅ two acts, not one |
| **The order is PC-001, purchase order, 336,000** | ✅ |
| **One line: "Anodised panel, 3mm", 2,000 at 168** | ✅ nothing retyped |

---

## 7. Adversarial — 12 held, 0 broke through, 0 skipped

| | |
| --- | --- |
| Receipt before the order was issued | `409 PO_NOT_ISSUED` — **both doors** |
| The same delivery note from the other module | `409 RECEIPT_ALREADY_POSTED` |
| Two deliveries at the same moment | `201` / `409 RECEIPT_OVER_ORDER` |
| 120 against an order of 100 | `409 RECEIPT_OVER_ORDER` |
| A warehouse that does not exist | `404 WAREHOUSE_NOT_FOUND` |
| Another project's order through this project's route | `404 PO_NOT_FOUND` |
| A receipt after the order was cancelled | `409 PO_NOT_ISSUED` |
| More stock than the warehouse holds | `409 INV_INSUFFICIENT_STOCK` |
| A long-lead item on another project's package | `404` |
| Quotes for another project's package | `404` |
| A derived long-lead status typed by hand | `409 LONG_LEAD_FIELD_DERIVED` |
| Malformed receipts | refusals, no 5xx |

> **One attack passed for the wrong reason and was re-run.** "Booking another
> project's order" first answered `PO_NOT_ISSUED` — because the fixture's order
> had no supplier and never reached *issued*, so the cross-project question was
> never asked. Given a supplier, it answered `201`, which is how §3 was found.
> A harness that cannot reach the question has not answered it.

---

## 8. Codex

**CODEX INDEPENDENT REVIEW NOT PERFORMED.**

No `codex` executable on `PATH`; not installed as an npm global. A `~/.codex`
state directory exists and is active, but exposes no command-line entry point
this session can invoke. Every review recorded in this phase is Claude's own and
is not labelled independent.

---

## 9. Evidence

| | |
| --- | --- |
| Delivery spine | **11 / 11** |
| Long-lead spine | **10 / 10** |
| Quote spine | **11 / 11** |
| Adversarial | **12 held · 0 broke · 0 skipped** |
| Backend | **1,854 / 1,854 across 169 suites** |
| Browser | **126 / 126** (16.3m, one worker) |
| Migrations | 2, both additive and nullable, applied locally only |

### The gate that was red first

The run before this one failed six specs — the last four files in the suite —
and the failures said so in words: *"sign-in for finance was rate limited
(429). The login budget is shared across runs in a 15-minute window."* Seven
429s in the API log. A day of full suites and API harnesses back to back had
spent the login budget, not broken the product. Re-run after the window rolled
over: **126 passed, no 429s at all.**

Worth stating because the temptation is to read six red specs as a regression
and start changing code. The suite tells you what happened if you read it.

## 10. A note on method

The defects in this phase came in layers, and each was only visible once the one
above it was fixed:

1. Two writers, so guards were remembered on one and not the other.
2. Beneath that, a `500` on concurrent deliveries of a new item.
3. Beneath *that*, a lost update the 500 had been hiding — the worse fault,
   because it told both storemen their delivery had posted.
4. And beside it, a project scope my own refactor had dropped.

Nothing here was found by reading the code. Each one came from driving the
system and being suspicious of a green result: the concurrency attack was
recorded as **held** at first because the quantity was right, and only re-read
because a `500` had no business being in a passing test.
