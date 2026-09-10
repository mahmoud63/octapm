# Phase 21 — connected-workflow matrix

Phase 21A and 21B combined. **No connection is marked VERIFIED without
evidence** — each verified row names the figure or status that proves it.

Project: `OCTA PHASE21 GREENFIELD 20260910093852` (`0ce999f2`), created from
nothing and continued across both halves.

| connection | state | evidence |
| --- | --- | --- |
| Company → Project Team | **VERIFIED** | 4 companies created; 7 colleagues added through "add existing user"; team screen shows 8 |
| Project Team → RBAC | **VERIFIED** | 7 personas 403 before assignment, 200 after; roles inherited (planner→planning_eng etc.) |
| WBS → Schedule | **VERIFIED** | 14 activities across 3 WBS branches |
| Schedule → CPM | **VERIFIED** | 12 activities at zero float; float drivers MEP 20d, Backfill 47d — matching the hand calculation, and shown in the browser |
| Schedule → BOQ | **VERIFIED** | 5 allocations: one whole, one split across two activities, one deliberately unallocated; no shadow activities created |
| BOQ → Budget | **PARTIAL** | both exist and reconcile (BOQ 459,000.00; budget 1,700,000.00) but no automated BOQ→budget derivation was exercised |
| BOQ/Activity → Procurement | **VERIFIED** | PO lines carry activityId and costCodeId through to the ledger |
| Procurement → RFQ | **MISSING from this run** | POs were raised directly; the RFQ/quote path was not driven |
| RFQ → Quote comparison → Award | **MISSING from this run** | not driven |
| Award → PO | **PARTIAL** | PO lifecycle draft→submit→approve→issue verified; the award that precedes it was not |
| PO → Long Lead | **MISSING from this run** | not driven |
| PO → Goods Receipt | **VERIFIED** | 3 receipts including a partial; outstanding correctly 40 after the first |
| Goods Receipt → Inventory | **VERIFIED** | 150 bags on hand, weighted average exactly 11.00 |
| Inventory → Material Issue | **VERIFIED** | 64 bags issued, stock fell to 86 |
| **Material Issue → Actual Cost** | **VERIFIED** | 704.00 posted, source `material_issue`, cost type `material` |
| **Goods Receipt → NOT Actual Cost** | **VERIFIED** | 1,650.00 of stock arrived and the ledger recorded 0 entries |
| Supplier Invoice → 3-way match | **MISSING from this run** | not driven |
| Stock Invoice → capitalization | **NOT EXERCISED** | no stocked-goods supplier invoice raised |
| Subcontractor → Commitment | **VERIFIED** | directory company reused as `vendorCompanyId`, not retyped |
| Commitment → agreement → execution | **VERIFIED** | agreement assembled with 0 gaps, rendered to PDF, signed copy uploaded, status `executed` |
| Commitment → SOV | **VERIFIED** | the pay app inherited the subcontract's SOV line; no scope retyped |
| SOV → Pay App | **VERIFIED** | gross 60,000.00, retention 6,000.00, net 54,000.00 |
| **Pay App → Actual Cost** | **VERIFIED** | ledger rose by the **gross** 60,000.00, source `sub_pay_app` |
| Pay App → Payment | **VERIFIED** | 54,000.00 recorded |
| Payment → Cash Flow | **VERIFIED** | cash out 54,000.00, in 0.00; cost unchanged by the payment |
| Prime Contract → Client SOV → invoice → client payment | **MISSING from this run** | the client revenue chain was not driven |
| **Change → Revised Budget** | **VERIFIED** | Original 1,700,000.00 immutable; approved changes 250,000.00; **Revised 1,950,000.00**; identity exact |
| Draft change → Revised Budget | **VERIFIED (correctly not connected)** | a 40,000.00 draft moves neither budget nor ledger |
| Change → Actual Cost | **VERIFIED (correctly not connected)** | approving a variation left the ledger untouched |
| Direct Cost → Actual Cost | **VERIFIED** | +8,500.00 exactly, source `direct_cost`, once not twice |
| Timesheet → Actual Cost | **MISSING from this run** | not driven |
| Schedule Progress → EV | **VERIFIED** | EV 97,500.00 independently derived and matched; advancing A130 moved it by exactly its extra share |
| Actual Cost → CPI | **VERIFIED** | CPI 138.4943 = EV / AC-to-date, exact to four places |
| Progress → Actual Cost | **VERIFIED (correctly not connected)** | booking progress left the ledger unchanged |
| RFI → Change | **NOT EXERCISED** | no RFI was created |
| Document → Responsibility | **PARTIAL** | a supporting instruction was uploaded, linked to the change order, and gates its approval; the wider document-control registers were not driven |
| Quality → Responsibility | **NOT EXERCISED** | |
| Workflow → Ball in Court | **PARTIAL** | the action centre states the semantics explicitly — "records where you are owner, reviewer, approver, assignee, or **hold the ball** — matched by user, not by name" — and reported 0 open for the planner; transitions were not driven through a full cycle |
| Ball in Court → Needs You | **PARTIAL** | same evidence |
| Register → Deep Link | **PARTIAL** | workspace KPI cards deep-link into this project (`?module=schedule&child=critical&status=official&source=activity`), and module/child deep links resolve after a reload; per-record deep links were not systematically tested |
| Records → Audit | **VERIFIED** | change-order status history shows Draft→Pending→Approved with actor id, reason and the named attachment |
| Tenant isolation | **VERIFIED** | 13 attacks from a separately registered tenant, zero leaks, and a real project answers identically to a non-existent one |
| Project isolation | **VERIFIED** | 5 cross-project id substitutions all refused 404 |
| RBAC | **VERIFIED** | 7 wrong-role approval attempts all 403, attacked at the API |

## Totals

| state | count |
| --- | ---: |
| **VERIFIED** | **26** |
| PARTIAL | 6 |
| MISSING from this run | 7 |
| NOT EXERCISED | 3 |
| BROKEN | **0** |

Nothing is BROKEN. The MISSING and NOT EXERCISED rows are scope the two runs
did not reach, not connections that were tried and failed.
