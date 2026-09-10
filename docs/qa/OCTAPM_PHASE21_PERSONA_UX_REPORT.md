# Phase 21 — persona UX report

Browser-driven observations on the greenfield project
`OCTA PHASE21 GREENFIELD 20260910093852`.

**Scope honesty first:** two personas were driven properly in the browser
(planning engineer, and a company-admin/PM session used to diagnose and verify
P21-001). The other nine were exercised at the API only, in stages 1, 4, 5, 7
and 8. This report says which is which, and §4 lists what a complete drive
still needs.

---

## 1. Planning engineer — driven in the browser

Signed in through the real form at `/sign-in` with the persona's own
credentials.

### Landing

**Workspace Control** — "Construction health, approval queues, and project
risk signals", stamped *Official cutoff Sep 10, 2026*.

| what they see | value |
| --- | --- |
| Portfolio health | 74 |
| Active projects | 2 |
| Open tasks | 0 overdue |
| Critical activities | 13, "2 delayed by latest approved progress" |
| Official cost actuals | 3, "14 active activities missing actual-through cost" |
| Procurement risks | 156 |
| Overdue QA/safety/docs | 0 |

Every card is labelled **Official** with the cutoff date, and the page says
what that means: "Approved source values with drill-through to source records".
Submitted-but-unapproved values are shown **separately** under *Pending
Review*, not mixed into the official figures. For a planner that distinction
is the whole job, and the screen makes it without being asked.

### Ball in court

The action centre is headed **"My open items"** and defines itself:

> Records where you are owner, reviewer, approver, assignee, or hold the ball
> — **matched by user, not by name**.

That is the exact distinction the phase asked about: *can act* is not *is
responsible*. It reported **0 open — "Nothing is waiting on you right now"**,
which was correct; nothing in this scenario was waiting on the planner.

### Their module

`/projects/{id}?module=schedule&child=gantt` resolved directly on a fresh
load — a deep link into a module and child, not just the module homepage.

| | |
| --- | --- |
| Total activities | **14** |
| Critical path | **12** activities |
| Milestones | **1** |
| Total budget | **$387,000** |
| Revision | **"Planned in OctaPM"** |

**Critical Path Explanation** listed the driving chain in order — Site
clearance → Bulk excavation → Blinding → Foundation → Columns L1 → Beams L1 →
Slab L1 → Columns L2 — each annotated `FS from A1xx · TF 0d`.

**Float drivers** named exactly the two spurs, with the float the API
measured: *MEP first fix rough-in TF 20d*, *Backfill and compaction TF 47d*.

This is independent confirmation of the CPM in the interface, and it is the
screen that P21-001 made reachable at all.

### Honest friction found here

**Baseline setup blockers** reported two items, one of which is a real
consequence of the P21-001 fix:

- *"BOQ Allocation: BOQ value remains unallocated to approved schedule
  activities"* — **correct**. B-003 (72,000.00) is deliberately unallocated.
- *"Schedule Approval: No schedule revision is available"* — **a real
  limitation**. A schedule planned in the product now displays, but it has no
  stored revision to lock as a baseline. Recorded as **P21-007 (P2)**.

### Commercial module

The planner could open `?module=commercial` and see Approved VOs **$250,000 ·
6 orders**, Pending **$0**, Schedule Impact **+20d** — matching the API
figures exactly — plus a full **Change Order Status History**: Draft → Pending
→ Approved, each entry naming the actor, the reason and the attached
`client-instruction-07.txt`.

Whether a *planning engineer* should see and be offered "Add Change Order" is
a permissions question worth a decision. Recorded as **P21-008 (P3)**.

---

## 2. Company admin / project manager — driven in the browser

Used to diagnose and verify P21-001. Saw the schedule module in both its
broken state (upload prompt, "Activities (0)") and its fixed state (14
activities, critical path 12, 1 milestone), and navigated module and child
routes directly by URL.

---

## 3. The other nine personas — API only

Exercised through the API in stages 1, 4, 5, 7 and 8, with real permission
outcomes but **no browser observation**:

| persona | what was proven at the API |
| --- | --- |
| Quantity surveyor | raises BOQ, commitments and pay applications; submits changes; refused `execute` on a subcontract (403) |
| Cost controller | writes budget lines and direct costs; reads the reconciliation |
| Procurement manager | creates suppliers, raises and issues POs |
| Warehouse / storekeeper | builds warehouse, zone and bin; posts receipts; issues stock (200 — his job) |
| Site engineer | books progress; **refused** PO approval, team changes and change-order approval (403) |
| Finance | records payments; **refused** PO approval (403) |
| Quality engineer | not exercised |
| Subcontractor / external portal | not exercised |
| Client / owner | not exercised |

Nobody was given admin rights to make a step pass.

---

## 4. What a complete persona drive still needs

- Browser sessions for QS, cost controller, procurement, warehouse, site
  engineer, finance, quality, and the external portal personas.
- For each: landing, primary module, record visibility, next action,
  ball-in-court badge, one unauthorised attempt with its on-screen feedback,
  and per-record deep-link behaviour.
- The client/owner persona, if the product supports one.

---

## 5. Enter-once observations from what was driven

| information | verdict |
| --- | --- |
| Subcontractor identity | **VALID REUSE** — picked from the directory on the commitment, carried to the pay app |
| Supplier identity | **VALID REUSE** — selected on both POs and on the direct cost |
| SOV line | **VALID REUSE** — the pay app inherited it; no scope retyped |
| Activity + cost code | **VALID REUSE** — PO line → receipt → issue → ledger |
| Subcontract agreement | **VALID REUSE** — assembled from the record with 0 gaps |
| Change-order impact summaries | **VALID CONFIRMATION** — a variation may not be approved until somebody writes down what it does to the programme and the money, names the activities, and attaches the instruction. Three gates, all of them the kind of evidence a claim is later argued from |
| Supplier invoice number | **VALID CONFIRMATION** — booking the same invoice twice is refused (409) |
| PO reference, GRN number | **VALID** — generated; hand entry still allowed |
| Activity engineer | **VALID CONFIRMATION** — an activity may not exist with nobody responsible |

No unnecessary duplicate entry was found in the paths driven.
