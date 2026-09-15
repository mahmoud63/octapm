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
