# OCTAPM PHASE 22 — MULTI-PERSONA HANDOFF MATRIX

Realistic cross-persona handoffs, measuring clarity of responsibility, notification, and state
consistency at each hop. This pass established the mechanism live (ball-in-court, "Waiting on me",
plain-language status, the RFI→change link) as PM; a full multi-login relay drive is the recommended
completion step and is marked DRIVE-NEXT.

Refresh/event propagation legend (section J): **REALTIME** (socket push) · **NEAR REALTIME** (query
invalidation on event) · **REFRESH REQUIRED** · **STALE/DEFECT**. OctaPM uses socket room events that
invalidate React Query caches (Phase 21), so most cross-session updates are NEAR REALTIME; financial
KPI tiles refresh on navigation.

---

## Chain 1 — RFI → cost impact → change → approval (commercial)

| Hop | Persona | Action | Handoff signal | Basis | Clarity |
| --- | --- | --- | --- | --- | --- |
| 1 | Site Engineer | Raise RFI (mark "cost impact expected") | RFI enters Responsible/Owner queue | OBS (New RFI form has the toggle) | Clear |
| 2 | Planner / PM | Receives "Waiting on me" / My open items | ball-in-court = reviewer/approver | OBS (RFI ball-in-court roles) | Clear |
| 3 | PM | Answers RFI | ball moves to originator; notification | OBS/P21 | Clear |
| 4 | Site Engineer | Sees response | RFI status advances | OBS | Clear |
| 5 | QS | Sees cost-impact flag → creates change | CO created, **linked to RFI-001** | OBS ("submit from RFI-001" + RFI instruction attached in CO audit) | Clear |
| 6 | PM | Approves change | CO Draft→Pending→approved; audit line | OBS (status history feed) | Clear (but actor shows UUID, UX22-05) |
| 7 | Cost Controller | Sees revised forecast | revised budget / forecast recompute | OBS/P21 | Clear (but budget figures disagree across screens, UX22-01) |
| 8 | Finance | Sees correct commercial impact | commercial KPIs / cash flow | OBS/P21 | Clear |

**Result:** the RFI→change→approve→cost relay is **wired end to end** with a real source link and
ball-in-court at every hop. The two blemishes are display/consistency (actor UUID; disagreeing budget
numbers), not broken handoffs.

## Chain 2 — Procurement: requirement → RFQ → award → PO → receipt → invoice → match

| Hop | Persona | Handoff signal | Basis | Clarity |
| --- | --- | --- | --- | --- |
| RFQ/award → PO | Procurement | award links supplier + PO | DRIVE-NEXT / P21 | Clear (design) |
| PO issued | Procurement | "Awaiting procurement — to be sent for approval" | OBS (plain-language status) | Excellent |
| Goods received | Warehouse | inventory + 3-way-match availability | DRIVE-NEXT / P21 | Clear (design) |
| Supplier invoice | Finance | "Awaiting finance — the supplier's invoice"; match flags price variance | OBS (PO status + invoiced>value variance) | Excellent |

## Chain 3 — Subcontract: commitment → pay app → certify → pay

| Hop | Persona | Handoff signal | Basis | Clarity |
| --- | --- | --- | --- | --- |
| Pay app submitted | Subcontractor/QS | enters review queue | OBS/P21 | Clear |
| Certify | PM/QS | certified cost posts to ledger; retention held | OBS (SC-001-PA01 certified, retention 10%) | Clear |
| Pay | Finance | cash-out; "partially paid – retention held"; **Actual not re-posted** | OBS (IPC action "$28,000 balance – partially paid – retention held") + P21 | Clear |

## Chain 4 — Client billing: valuation → certify → invoice → receipt

| Hop | Persona | Handoff signal | Basis | Clarity |
| --- | --- | --- | --- | --- |
| Certify client valuation | QS | certified revenue, invoice availability, AR | DRIVE-NEXT / P21 | Clear (design) |
| Receive client payment | Finance | cash-in, AR down; **project Actual unchanged** | P21 | Clear |

## Chain 5 — Quality: inspection fail → NCR → responsibility → closeout

| Hop | Persona | Handoff signal | Basis | Clarity |
| --- | --- | --- | --- | --- |
| Inspection fail → NCR | Quality/Site | NCR raised, responsibility routed, quality score drops | DRIVE-NEXT / P21 | Clear (design) |
| Closeout | PM | NCR/safety closeout enters PM queue | OBS (workspace "QA/Safety closeout review" queue) | Clear |

## Chain 6 — Document control: RFI/submittal review

| Hop | Persona | Handoff signal | Basis | Clarity |
| --- | --- | --- | --- | --- |
| Submittal review | Consultant/party | party-routed, company-scoped | P21 (party isolation) | Clear |

---

## Handoff summary

- **Responsibility is legible at every hop tested** — ball-in-court roles, "Waiting on me"/"My open
  items", and plain-language "Awaiting <role>" status are consistent across modules and matched by user
  id. This is a real differentiator versus typical internal tools.
- **No MISSING HANDOFF was observed** in the driven flows.
- **Event propagation:** NEAR REALTIME across sessions by design (socket → query invalidation);
  financial KPI tiles are REFRESH-on-navigation. A two-open-session latency test (section J) is the
  recommended completion step — no STALE/DEFECT is expected given Phase-21 realtime work, but it should
  be confirmed live.
- **To finish:** run the six chains as separate logins (Site Eng → Planner → PM → QS → Cost → Finance,
  etc.) to convert DRIVE-NEXT hops to live-observed and to record per-hop click counts.

---

## Phase 22A — two-session handoff test (2026-09-15)

Two independent browser contexts (separate cookies, separate sockets), product UI only, on the
disposable Riverside Tower project. Session A = PM (Dana Okafor). Session B = site engineer (Priya
Raman) for the RFI, QS (Sofia Lindqvist) for the change order, cost controller (Tomás Herrera) for the
direct cost. Classification: REALTIME ≤ 3 s without refresh · NEAR REALTIME ≤ 20 s · REFRESH REQUIRED ·
STALE. Four runs; figures from the last run, ranges across runs.

| Handoff | From → to | Seen | Class |
| --- | --- | --- | --- |
| RFI raised | site engineer → PM register | 485–550 ms, no refresh | **REALTIME** |
| RFI answered and closed | PM → site engineer register; "My open items" empties | 11–60 ms, no refresh | **REALTIME** |
| Change order created (Raised By from the team) | QS → PM register | 0.5–1.1 s, no refresh | **REALTIME** |
| Change order approved | PM → QS register, Cost Overview | not reached: the register's "Needs proof" gate (activities + evidence document + both impact summaries) blocks submission, and Riverside has no register document with a file to attach. Business rule, not a propagation fault. |
| Direct cost approved ($750) | PM → cost controller's Cost Overview "Actual cost" | 3 ms, no refresh ($34,712,564 → $34,713,314) | **REALTIME** |

Mechanism: the socket transport (`lib/realtime.ts`) invalidates the TanStack queries of the project room on
`record.changed`, so lists refetch within a round-trip. Script kept at `scratchpad/p21/two-session.mjs`.

## Phase 22B — four two-session handoffs (2026-09-15, E2E organisation)

Two independent browser contexts per chain (separate cookies, separate sockets), product UI only, on the
E2E organisation's Riverside Tower after a reset. Classification: REALTIME ≤ 3 s without refresh · NEAR
REALTIME ≤ 20 s · REFRESH REQUIRED · STALE. Checks made by navigating to another screen are marked
"on navigation" (they are not a live-update measurement). Figures from the final run
(`scratchpad/p21/two-session-22b.mjs`, log `two-session-22b-final2.log`); four earlier runs agree.

| Chain | Handoff | From → to | Seen | Class |
| --- | --- | --- | --- | --- |
| RFI | RFI raised | site engineer → PM register | 77–965 ms, no refresh | **REALTIME** |
| RFI | answered and closed | PM → site engineer register | 7–14 ms, no refresh | **REALTIME** |
| Change / Commercial | change order created with budget line 01-100 and the RFI's letter as evidence | QS → PM register | 0.8 s, no refresh | **REALTIME** |
| Change / Commercial | submitted for approval | QS → PM approval queue ("1 pending") | 5 ms, no refresh | **REALTIME** |
| Change / Commercial | approved | PM → QS register ("Approved") | 3 ms, no refresh | **REALTIME** |
| Change / Commercial | approved value on Cost Overview and on budget line 01-100 ($150,000 → $162,500) | QS, Cost Overview and Budget tab | correct on navigation | on navigation |
| Procurement / Inventory | goods received against PO-0001 | warehouse (Goods in) → PM purchase-order list ("Delivered") | 4 ms, no refresh | **REALTIME** (new: the receipt publishes a project event) |
| Procurement / Inventory | stock on hand after the receipt | warehouse → PM Inventory items (1,560 bags, avg 6.40) | correct on navigation | on navigation |
| Quality | NCR raised on the procurement lead | quality engineer → procurement lead's "My open items" | 0.5–0.8 s, no refresh | **REALTIME** |
| Quality | closeout submitted with photo/file evidence by the assignee | procurement lead → quality engineer (NCR "submitted", Approve offered) | 5 ms, no refresh | **REALTIME** (new: the assignee may submit) |
| Quality | closeout approved | quality engineer → procurement lead (NCR "closed") | 5 ms, no refresh | **REALTIME** |
| Quality | the closed NCR leaves "My open items" | procurement lead's workspace | correct on navigation | on navigation |

No handoff was STALE; no responsibility or financial figure was misleading in either session; 0
responses were refused and 0 console errors were logged across the eight sessions.
