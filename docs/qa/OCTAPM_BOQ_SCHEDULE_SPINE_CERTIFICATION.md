# BOQ ↔ schedule ↔ cost spine certification

**Phase 18** · **Written:** 2026-09-08
**Cards:** OCTA-BOQ-ACTIVITY-078 · OCTA-BOQ-EMPTY-079 · OCTA-BILL-ARCHIVE-080
**Harnesses:** `scratchpad/boq-spine.js`, `scratchpad/reconcile.js`
**Browser:** `frontend/e2e/23-boq-schedule-spine.spec.ts`

Phase 17 found that a bill row typed into the grid always minted its own
activity, so a project that already had a programme grew a second one: zero
duration stubs holding the money beside the real activities holding the logic.
This closes it, and proves the whole chain lands on one activity.

**BOQ spine: 19 of 19. Report reconciliation: 7 of 7. Browser: 2 of 2.**

---

## 1. The relationship is an id, never a name

A bill row now says which activity it belongs to in exactly one of three ways:

| | |
| --- | --- |
| `activityId` | An activity already on the programme. Nothing is created. |
| `activityName` | Creates one, for a project with no programme yet. |
| neither | The row is left unallocated, to be split across several activities. |

Both together are refused — *"Give either activityId … or activityName … not
both"* — because guessing which the caller meant is how the shadow schedule got
built in the first place.

**Names are not identifiers, and nothing matches on one.** Two activities called
"Blockwork" on different levels are different work. This is the same rule the
programme already applies to company names.

### What is refused

| | |
| --- | --- |
| More than the bill item holds | `400 ALLOCATION_QUANTITY_EXCEEDED` |
| A negative allocation | `400 VALIDATION_ERROR` |
| Another project's activity | `404 BOQ_ACTIVITY_NOT_IN_PROJECT` |
| An activity retired by a schedule revision | `409 BOQ_ACTIVITY_RETIRED`, naming what replaced it |
| A second live allocation of the same row to the same activity | `409 DUPLICATE_ACTIVE_ALLOCATION` |

Retired activities are refused because they stop earning value the moment they
are superseded (§4), so hanging new money on one puts it where it can never be
reported.

---

## 2. Driven end to end — 19 / 19

A project with a real, imported P6 programme (S-100 Foundations 20d → S-200
Level 1 15d → S-300 Level 2 15d), then a bill entered against it.

| | |
| --- | --- |
| A BOQ row names an activity that already exists | ✅ |
| **…and no shadow activity is created** | ✅ 3 activities before the bill, 3 after |
| The allocation points at the imported activity itself | ✅ |
| A row can be created unallocated, to be split later | ✅ |
| **One bill item splits across three existing activities, creating none** | ✅ 400 / 300 / 300 m³ |
| Over-allocation, negatives, and another project's activity | ✅ all refused |
| **Greenfield: a bill row still creates its activity** | ✅ unchanged |
| The bill value on the activity is the sum of its allocations | ✅ 300,000 + 100,000 = 400,000 |
| Progress earns the bill value allocated to it | ✅ 400,000 × 60% = 240,000 |
| Earning more moves it by exactly the share earned | ✅ +120,000 at 90% |
| **Certified cost lands on the same activity** | ✅ 200,000 on the ledger, 1 entry |
| **One activity carries PV, progress, EV and AC** | ✅ PV 400,000 · EV 360,000 · AC 200,000 · SPI 0.9 · CPI 1.8 |
| Lengthening the activity moves the schedule and detaches nothing | ✅ 20d → 30d, allocations, cost and EV unchanged |

The last two rows are the point of the phase. One activity, carrying planned
quantity, planned value, approved progress, earned value and actual cost — and
a schedule change that moves the dates without breaking any of it.

---

## 3. The reports agree — 7 / 7

The same activity, read four ways:

| | |
| --- | --- |
| Schedule | p6 `S-100`, our code `null` — it was imported |
| BOQ | 2 allocations, shown as `S-100`, approved 400,000 |
| Earned value | row `S-100`, budget 400,000 = the BOQ approved value |
| Cost ledger | 200,000, matching the EV report's AC exactly |
| Report builder | p6 `S-100`, our code `null`, 90% — agreeing with the schedule |

**Both identifiers stay distinguishable.** The allocation used to collapse them
into one display field, so an imported activity showed a label with no way to
tell whether it was a P6 id or one of ours. `p6ActivityId` is now returned
beside `activityCode` everywhere a bill meets a programme.

---

## 4. What a schedule revision does to the money

Not changed — established and now written down, because §12 asked what the rule
is and the rule turned out to be right.

| | |
| --- | --- |
| An activity **mapped** in the revision | Updated **in place**. Same `Activity.id`, so allocations, progress, cost postings, documents, RFIs and submittals all stay attached. Mapping is how history survives a re-plan. |
| An activity **not mapped** | Retired: `isActive: false`, with `retiredAt`, `retiredBy`, `retiredReason` and the revision that did it. **Never deleted.** A reason is required. |
| A retired activity's allocations | Stay on it, and stop earning — `getApprovedActivityAllocationTotals` filters `activity: { isActive: true }`, so EV excludes them. |
| A retired activity's cost postings | Stay on the ledger. Money already spent is not unspent by re-planning. |
| New allocations to a retired activity | Refused, `409 BOQ_ACTIVITY_RETIRED` (added this phase). |

**Nothing is silently moved.** The only thing that moves financial history is a
person choosing a mapping, and that choice is recorded on the revision.

---

## 5. 🔴 → ✅ OCTA-BOQ-EMPTY-079 · An empty bill had no way in

The BOQ grid — and the button that adds to it — only rendered once at least one
row existed. On a project with an empty bill the only thing on the page was the
upload zone, so a small job priced by hand could not enter its first row at all
without a spreadsheet.

Found by trying to drive the greenfield path in a browser, which is the point of
driving it in a browser.

**Fixed:** the empty state offers the grid as well as the upload zone.

---

## 6. 🔴 → ✅ OCTA-BILL-ARCHIVE-080 · Archiving a project never gave its place back

Found because this session's harnesses filled the demo organisation's
twenty-five project allowance, and deleting them did not help.

- `DELETE /projects/:id` **archives** — right for a construction record, which
  has to outlive the job.
- `GET /projects` hides archived projects.
- `enforceProjectLimit` counted **every** project row, archived or not.

So an organisation that archives finished jobs sees three projects on screen and
is told it has used all twenty-five, and **cannot find the other twenty-two,
because nothing in the product shows them.** The only apparent remedy is to pay
more.

**Fixed:** the limit counts live projects, and the refusal now says how many are
live and that archiving frees a place, so it can be acted on. This is the third
defect found on this one gate — after the unknown plan reading as an allowance
of nought (Phase 16), it is worth saying plainly that **a counting gate wants
its own tests**, which it now has.

---

## 7. 🟡 Reported, not merged: the shadow-activity diagnostic

`GET /projects/{projectId}/boq/shadow-activities` reports activities that carry
bill value but have no duration and no logic, on a project whose other
activities have both — the trace the old behaviour left.

```
1 flagged · SH-001 "Foundations" 4,000.00
   why: Carries bill value but has no duration and no logic,
        on a project that already has a programme
   sameNameAs: [{ p6ActivityId: "S-100", duration: 30 }]
```

It names same-named activities alongside each finding, so a person can see the
likely twin — and **stops there**. Verified: a properly connected project
reports none; after deliberately creating one the old way it reports exactly
one; and the activity count is unchanged by the report. Deciding two activities
are the same piece of work is a judgement about the job, and acting on it would
move financial history.

---

## 8. The screen says which it is doing

The add-row dialog now asks, rather than implying:

```
Schedule Activity
 ( ) Use an activity already on the programme
 ( ) Create a new activity for this row
 ( ) Decide later — split this row across activities
```

- On a project with a programme it opens on **using** one, and lists activities
  by their identifier and name. Nothing about the activity is retyped: the
  relationship is the id.
- On a project with none, the first option is **shown but disabled**, labelled
  *"there are none yet"* — so the reason is visible rather than the option being
  absent — and it opens on creating one.
- The same choice is on the dialog that splits a bill item across activities.

> **A bug this introduced, and caught.** The programme loads asynchronously, so
> the dialog first defaulted to *create new* whenever it opened before the
> activities arrived — on a project that had a programme. The default now
> settles when the data does, and stops adjusting once the person has chosen.
> The browser test caught it; the API harness could not have.

---

## 9. Evidence

| | |
| --- | --- |
| BOQ spine (API, driven) | **19 / 19** |
| Report reconciliation | **7 / 7** |
| Browser (`23-boq-schedule-spine`) | **2 / 2** |
| New tests | 9 on the activity choice, 2 on the project count |

## 10. A note on method

Six failures during this phase; **four were the harness's and two were the
product's**:

- The revision refused approval — `SCHEDULE_NOT_READY`, because my fixture XER
  had two activities and no logic between them. A schedule without logic has no
  critical path; the product was right.
- `GET /projects?limit=200` returned a validation error my probe's `?? []`
  swallowed, so the org appeared to have no projects at all.
- Two locator mistakes: an unscoped `getByLabel` matching the page behind the
  dialog, and a default asserted before the data it depends on had loaded.

The two real ones were both found only by trying to *use* the product: the empty
BOQ had no way in, and archiving a project never gave its place back. Neither
was reachable from the API alone.

---

# Appendix — procurement gap review

Three seams carried forward from the nervous-system document. Reviewed against
the code, **not implemented**, as instructed. Each proposal is the smallest
change that removes the duplication rather than papering over it.

## DELIVERY-01 · Two doors to one delivery, one of which loses the stock

**What is actually there.** Both endpoints write the *same* `DeliveryReceipt`
and `DeliveryReceiptLine` rows. They differ in what else they do:

| | `POST /procurement/purchase-orders/{id}/receipts` | `POST /inventory/goods-receipt` |
| --- | --- | --- |
| Delivery record | ✅ | ✅ |
| Where it went | `warehouseLocation`, **free text** | `warehouseId` + `locationId`, real records |
| Stock | **none** | `postMovement` at weighted average |
| Buyer's coding carried to the stock ledger | — | cost code, BOQ item, PO line, activity |

So a delivery recorded from Procurement leaves the warehouse empty and the
material invisible to issues, valuation and the three-way match. The same
delivery recorded from Inventory is complete. Which one a person uses depends
only on which module they had open.

**Smallest change: one write path, two doors.** Make the procurement route
delegate to `goods-receipt.service` rather than keep its own writer. It keeps
its URL, so nothing outside breaks.

- `warehouseId` becomes the way to say where it went. When it is absent, fall
  back to the project's default warehouse; when there is none, refuse with a
  code that names the problem rather than silently recording a delivery that
  creates nothing.
- `warehouseLocation` free text is retained on existing rows as history and
  stops being written.
- The duplicate-receipt guard already on the inventory path then covers both.

**Cost:** one service call replaced, one migration of intent (not of data), one
new refusal. **Risk:** an API consumer posting to the procurement route without
a warehouse now gets a refusal where it used to get a silent no-op — which is
the point, and worth a release note.

## LONGLEAD-01 · The same dates kept in two places

**What is actually there.** `ProcurementPackage` and `LongLeadItem` carry the
*same six fields* — `requiredOnSiteDate` / `expectedDeliveryDate`,
`requiredTiming`, `needOffsetDays`, `leadWeeks`, `bufferDays`,
`latestOrderDate` / `orderBy` — and **there is no foreign key between them.**
`LongLeadItem` relates only to `Project` and `Activity`.

So the buyer maintains the procurement dates twice, and the long-lead register
cannot see what has been ordered: `LongLeadItem.status` (`not_ordered`,
`ordered`, `delivered`) and `warehouseStatus` are typed by hand while the
package and its receipts already know the answer.

**Smallest change: a nullable link, and derive what is already known.**

- `LongLeadItem.procurementPackageId String?` — nullable on purpose. A long-lead
  item exists *before* anything is ordered; that is what the register is for.
- Where the link is set, derive rather than store: `status` from the package's
  status, `expectedDeliveryDate` from its `requiredOnSiteDate`, `deliveredAt`
  and `warehouseStatus` from its delivery receipts.
- Where it is not set, the item behaves exactly as it does today.

**Cost:** one nullable column, one migration, and four fields that stop being
typed. **Risk:** low — the unlinked path is unchanged, and nothing is
back-filled by guessing which package matches which item.

## RFQ-01 · Material quote comparison lives under the wrong module

**What is actually there.** `Rfq.changeEventId` is **required** — an RFQ is
structurally a change-pricing request and cannot be raised for materials.
Comparing supplier quotes for materials is done by the bid module, which already
supports it: `BidPackage.commitmentType` accepts `purchase_order`. It works. It
just lives under Commercial and reads as subcontract bidding, and nothing links
it to the procurement package it is pricing.

**Smallest change: surface it, do not rebuild it.**

- `BidPackage.procurementPackageId String?` — nullable.
- A Procurement-side entry point that opens a bid package with
  `commitmentType: 'purchase_order'` and that link already set, so the buyer
  never chooses the type or wonders why they are in Commercial.
- Procurement lists the linked packages as *Quotes* against the package.

**Do not** add a second RFQ model or relax `Rfq.changeEventId` — that field is
what makes an RFQ a change request, and loosening it would blur two different
documents. **Cost:** one nullable column and one route. **Risk:** low; the
bidding engine, levelling and award are untouched.

## What these three have in common

Each is a second implementation of something the system already does: a second
receipt writer, a second set of procurement dates, a second place to compare
prices. None needs a new capability — each needs the existing one to be
reachable, and the duplicate to stop being written. That is the cheapest kind of
integration work and the easiest to get wrong by building a third thing.
