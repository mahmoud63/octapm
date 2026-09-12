# Phase 21 — connected-workflow matrix

Phase 21A, 21B and 21C combined. **No connection is marked VERIFIED without
evidence** — each verified row names the figure or status that proves it, and
the stage (A / B / C) that produced it.

Project: `OCTA PHASE21 GREENFIELD 20260910093852` (`0ce999f2`), created from
nothing in 21A and continued across all three halves — the same id, proven at
the start of every stage.

| connection | state | evidence |
| --- | --- | --- |
| Company → Project Team | **VERIFIED** (A) | 4 companies created; 7 colleagues added through "add existing user"; team screen shows 8 |
| Project Team → RBAC | **VERIFIED** (A) | 7 personas 403 before assignment, 200 after; roles inherited (planner→planning_eng etc.) |
| WBS → Schedule | **VERIFIED** (A) | 14 activities across 3 WBS branches |
| Schedule → CPM | **VERIFIED** (A) | 12 activities at zero float; float drivers MEP 20d, Backfill 47d — matching the hand calculation, and shown in the browser |
| Schedule → BOQ | **VERIFIED** (A) | 5 allocations: one whole, one split across two activities, one deliberately unallocated; no shadow activities created |
| BOQ → Budget | **PARTIAL** (A) | both exist and reconcile (BOQ 459,000.00; budget 1,700,000.00) but no automated BOQ→budget derivation was exercised |
| BOQ/Activity → Procurement | **VERIFIED** (A) | PO lines carry activityId and costCodeId through to the ledger |
| Vendor prequalification → RFQ | **VERIFIED** (C) | an unqualified directory vendor cannot be invited (`PREQUAL_NOT_QUALIFIED`); scored 9 criteria, approved, then invited |
| Procurement → RFQ | **VERIFIED** (C) | package → bid package BP-001 → lines from the BOQ (60 t reinforcement) → 3 invitations published |
| RFQ → Supplier portal | **VERIFIED** (C) | each bidder priced through its own tokenised portal; the portal shows the package reference and the bidder's own invitation only — no internal ids, no estimate rate |
| RFQ → Quote comparison → Award | **VERIFIED** (C) | levelling read all three bids (1,150 / 35 d; 1,240 / 14 d; 1,190 / 21 d ex-works); soft award to Emirates (1,240, 14 d — the schedule need), idempotent; confirm refused for the ad-hoc bidder (`PREQUAL_AWARD_BLOCKED`) until a written override |
| Award → PO | **VERIFIED** (C) | `packages/{id}/order` raised **PO-00001** from the confirmed award, numbered from the atomic counter |
| PO → Long Lead | **PARTIAL** (C) | the package lives under the schedule's long-lead view and carries its need-by date; the long-lead alert on A130 ("High tensile reinforcement") is shown on the overview; no lead-time alert lifecycle was driven |
| PO → Goods Receipt | **VERIFIED** (A) | 3 receipts including a partial; outstanding correctly 40 after the first |
| Goods Receipt → Inventory | **VERIFIED** (A) | 150 bags on hand, weighted average exactly 11.00 |
| Inventory → Material Issue | **VERIFIED** (A) | 64 bags issued, stock fell to 86 |
| **Material Issue → Actual Cost** | **VERIFIED** (A) | 704.00 posted, source `material_issue`, cost type `material` |
| **Goods Receipt → NOT Actual Cost** | **VERIFIED** (A) | 1,650.00 of stock arrived and the ledger recorded 0 entries |
| Supplier Invoice → 3-way match | **VERIFIED** (C) | invoice A 100 @ 10.00 = clean match; invoice B 50 @ 14.00 against 13.00 ordered = **price variance 50.00 detected**, flag `price_variance` blocking, verdict not clean; the match names the PO line it reconciled; finance cannot book an invoice (403), the cost controller can |
| **Stock Invoice → capitalization** | **VERIFIED** (C) | both invoices approved and the ledger moved by **0.00**: cost was recognised at issue, the invoice does not post it twice |
| Subcontractor → Commitment | **VERIFIED** (B) | directory company reused as `vendorCompanyId`, not retyped |
| Commitment → agreement → execution | **VERIFIED** (B) | agreement assembled with 0 gaps, rendered to PDF, signed copy uploaded, status `executed` |
| Commitment → SOV | **VERIFIED** (B) | the pay app inherited the subcontract's SOV line; no scope retyped |
| SOV → Pay App | **VERIFIED** (B) | gross 60,000.00, retention 6,000.00, net 54,000.00 |
| **Pay App → Actual Cost** | **VERIFIED** (B) | ledger rose by the **gross** 60,000.00, source `sub_pay_app` |
| Pay App → Payment | **VERIFIED** (B) | 54,000.00 recorded |
| Payment → Cash Flow (out) | **VERIFIED** (B) | cash out 54,000.00; cost unchanged by the payment |
| Prime Contract → Client SOV | **VERIFIED** (C) | prime contract auto-created with the project; IPC-01 items one per approved allocation (B-001/A110, B-002/A120, B-002/A130); caps refuse over-certification (`IPC_ALLOCATION_QTY_EXCEEDED`, `IPC_APPROVED_PROGRESS_EXCEEDED`) |
| Client SOV → certification → invoice | **VERIFIED** (C) | certified gross **120,000.00** = the earned value of the same approved progress; retention 5 % = 12,000.00; net 108,000.00; one invoice, a second issue refused (`IPC_INVOICE_ALREADY_ISSUED`) |
| Client invoice → payment → receivables | **VERIFIED** (C) | 80,000.00 received, 28,000.00 outstanding, invoice `part_paid` |
| **Client payment → Cash Flow (in)** | **VERIFIED after fix** (C) | inflow **0.00** before (P21-009, P1), **80,000.00** after `recordIpcPayment` rebuilds the projection |
| **Change → Revised Budget** | **VERIFIED** (B, C) | Original 1,700,000.00 immutable; approved changes 250,000.00 (B) + 4,500.00 (C, from RFI-001); **Revised 1,954,500.00**; identity exact |
| Change → budget line | **PARTIAL** (C) | `budgetLineId` is accepted and discarded on create and update (P21-012); every approved change sits on the product's holding line; the total is right, its distribution is not |
| Draft change → Revised Budget | **VERIFIED (correctly not connected)** (B) | a 40,000.00 draft moves neither budget nor ledger |
| Change → Actual Cost | **VERIFIED (correctly not connected)** (B, C) | approving a variation left the ledger untouched, twice |
| Direct Cost → Actual Cost | **VERIFIED** (B) | +8,500.00 exactly, source `direct_cost`, once not twice |
| **Timesheet → Actual Cost** | **VERIFIED** (C) | 5 steelfixers × 8 h @ 50.00 = **2,000.00**; approval snapshots the rate and posts source `timesheet`, cost type `labour`; a storeman cannot approve; budget line 01-100 shows the 2,000.00 |
| Timesheet → Daily log manpower | **VERIFIED** (C) | the day's manpower entry (5 workers × 8 h) and the manpower report (40 man-hours, Steelfixer) agree with the 40 timesheet hours |
| Schedule Progress → EV | **VERIFIED** (B) | EV 97,500.00 → 120,000.00 independently derived and matched; advancing A130 moved it by exactly its extra share |
| Actual Cost → CPI | **VERIFIED** (B) | CPI = EV / AC-to-date, exact to four places; 2027-dated cost is beyond the 2026 cutoff by the report's documented rule (T-07) |
| Progress → Actual Cost | **VERIFIED (correctly not connected)** (B) | booking progress left the ledger unchanged |
| EV = certified revenue | **VERIFIED** (C) | the same approved progress governs both: EV 120,000.00 = IPC-01 certified gross 120,000.00 |
| RFI → Ball in Court | **VERIFIED** (C) | open → the planner (assignee) holds it; answered → the PM (manager); closed → nobody; the QS on distribution can read it and never holds it; a storeman cannot answer |
| **RFI → Change** | **VERIFIED** (C) | `convert-to-change` created draft VO-22 (4,500.00, same activity) linked both ways; a second conversion refused (`RFI_ALREADY_CONVERTED`); approved → Revised Budget +4,500.00, ledger +0.00 |
| Document → Responsibility | **VERIFIED** (C) | S-101 rev A→B→C: the site engineer uploads and submits for review, only the PM approves (self-approval 403), B supersedes A, C stays in review; the mill-certificate submittal rejected once, resubmitted, reviewed by the QS, approved by the PM; transmittal acknowledged; letter closed; one register lists all five record kinds |
| Document → Field visibility | **VERIFIED** (C) | the storeman sees rev B only — never rev C in review, never superseded rev A |
| Quality → Responsibility | **VERIFIED** (C) | ITP-01 passed / ITP-02 failed; NCR-001 (major) closed out with evidence by the site engineer, approved by the PM alone (site and QS 403); DEF-001 worked and closed; MT-01 passed; PL-001 closed by the PM alone; OBS-001 a safety observation with its own numbering |
| Quality → Score | **VERIFIED** (C) | dashboard score = 100 − 20·major − 8·minor − 15·failed, read not computed: 100 → 85 (failed ITP) → 65 (major NCR) — and 45 with the T-10 duplicate, named |
| Field → Daily log → approval | **VERIFIED** (C) | five sections written by the site engineer; submitted; approved by the PM alone (site 403, planner 403); an approved day cannot be edited |
| Daily log → Weather delay | **VERIFIED** (C) | raised from the log's delay entry, on the weather-delay register, contractual; EOT is not the storeman's to read (403) |
| Safety → closeout | **VERIFIED** (C) | SAF-001 near miss: closeout refused without evidence, submitted with a photo, approved by the PM; a storeman and the planner cannot raise one |
| Meetings → Actions → Tasks | **VERIFIED** (C) | MTG-01 with 5 attendees, 3 agenda items, 1 decision on A130, 2 actions; finalised and distributed by the planner (stamped who / when); the site engineer's action is a task on A130 linked back to the minutes, commented and closed by its assignee; a storeman cannot close it |
| Workflow → Ball in Court | **VERIFIED** (C) | driven through a full cycle on RFI-001 (above) and observed on every register the personas opened ("waiting on you right now" on every landing) |
| Ball in Court → Needs You | **PARTIAL** (B, C) | the landing page's responsibility panel is present for all eight personas; the PO register's "Waiting on you" card and its "Your action" row disagree (P21-018) |
| Register → Record deep link | **PARTIAL** (C) | 26 links graded after the P21-011 fix: **12 open the record** (both ITPs selected inline), 9 land on the register with the row visible, 5 land on the module home, 0 open the wrong record type (P21-015) |
| Records → Audit | **VERIFIED** (B) | change-order status history shows Draft→Pending→Approved with actor id, reason and the named attachment |
| Tenant isolation | **VERIFIED** (A, C) | 13 attacks from a separately registered tenant, zero leaks; every 21C record kind (RFI, drawing, NCR, meeting) refused to the outsider |
| Project isolation | **VERIFIED** (A) | 5 cross-project id substitutions all refused 404 |
| RBAC | **VERIFIED after fix** (A, C) | 7 wrong-role approval attempts 403 in 21A; in 21C the audit found **ten unguarded routers** (P21-010, P1) — fixed; after the fix 2 of 108 probes pass the door, both by design |

## Totals

| state | count |
| --- | ---: |
| **VERIFIED** (incl. "correctly not connected" and "after fix") | **48** |
| PARTIAL | 6 |
| MISSING from this run | 0 |
| NOT EXERCISED | 0 |
| BROKEN | **0** |

Nothing is BROKEN. The six PARTIAL rows are named and each has a defect or an
observation behind it (P21-011, P21-012, P21-015, P21-018, the BOQ→budget
derivation, and long-lead alerts). Every row that was MISSING or NOT EXERCISED
at the end of 21B was driven in 21C.
