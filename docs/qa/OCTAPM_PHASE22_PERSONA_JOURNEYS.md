# OCTAPM PHASE 22 — PERSONA JOURNEYS

Per-persona experience. **Project Manager was driven live end-to-end** this pass (Dana Okafor,
`pm@octapm.demo`). Other personas are assessed from the permission model, the module structure, and
the shared navigation; a dedicated login pass per persona is the recommended completion step and is
called out where it matters.

---

## Project Manager — LIVE

- **Landing:** "Workspace Control" cockpit — Official KPIs (Portfolio Health 81, Active Projects 6,
  Open Tasks 2, Critical Activities 14, Official Cost Actuals 3, Procurement Risks 408, Overdue
  QA/Safety/Docs 0), "My open items" (0, user-matched), Pending Review, Workflow Queues, 7-dimension
  Health, Project Health Watchlist. This is a genuine PM cockpit and the strongest first impression in
  the product.
- **Enters a project:** "Select project" combobox → project workspace with a module bar. Schedule is
  the default module (Gantt, critical-path explanation, baseline lock with readiness blockers).
- **Sees everything:** all modules visible; approvals flow to the workspace queues and the per-module
  "Waiting on me" filters.
- **Friction:** no quick-create from the landing; must enter a project first for any create. Budget
  numbers differ across Schedule/Cost/header (see UX register). Procurement is behind "More".
- **Verdict:** strong, professional, information-dense. Efficient once inside a project.

## Site Engineer — assessed (RFI form driven live)

- **Primary jobs:** raise RFI, capture inspections/punch/observations, submit progress.
- **RFI:** the New RFI form (driven live) is excellent — clear hints, AI-draft option, and reference
  selectors for activity/location/party/manager/assignees. Inline quick-add ("subject + Add") is a
  1-click create. This persona's core action is well served.
- **Check next pass:** that the site-engineer *login* sees a task-focused landing (not the full PM
  cockpit) and that capture is reachable in ≤2 clicks.

## Planner / Planning Engineer — assessed

- **Primary jobs:** schedule maintenance, progress approval, lookahead, critical path.
- Schedule module is rich (Gantt, Activities, Progress, Lookahead, Critical Path, EV, Forecast,
  Milestones, Resources, Risks, Long Lead, Revisions) with a baseline-lock readiness gate.
- **Check next pass:** progress-approval handoff and revision approval as this persona.

## QS / Commercial — assessed (Change Orders driven live)

- **Primary jobs:** change orders, pay applications, IPC, budget revisions, commitments, contract.
- Change Orders register + Add form + full status-history audit were driven live. Register is
  well-structured; the Add form has the document-ID/raised-by data-reuse gaps (DR-1/DR-2).
- **Check next pass:** certify/approve pay-app and client valuation as this persona.

## Cost Controller — assessed (Cost cockpit driven live)

- Cost Control cockpit (scenario forecast, Budget/Committed/Actual/Forecast) driven live. Actual is
  correctly the cost ledger. **But** the scenario cards look inverted and the "budget" figure disagrees
  with other screens (UX register) — this persona is the one most exposed to those inconsistencies.

## Procurement — assessed (PO list driven live)

- Purchase Orders tab driven live: Orders/Committed/Invoiced KPIs, "Waiting on you", plain-language
  status ("Awaiting procurement", "Awaiting finance"), supplier references. Professional.
- **Friction:** the whole Procurement module sits behind the "More" overflow.

## Warehouse / Storekeeper — assessed (Inventory driven live)

- Global Inventory driven live: Scan / Goods-in / Match / Items / Warehouses / Dashboard / Ledger,
  inline "Issue" per item. Strong operational structure.
- **Demo-data caveat:** the item master shows e2e residue names ("Aggregate DUPA …") and an inflated
  $18.7M stock value — clean before any client demo.

## Quality — assessed

- Quality module (NCR, Inspections, Punch, Observations, Safety, Material Tests) present with a wired
  quality score. Inspection-failure → NCR propagation is design-verified (Phase 21); drive live next.

## Finance / Accounts — assessed

- Pay applications, client valuations, receipts, cash flow present. Verified rule (Phase 21): client
  receipt updates cash-in only and does **not** change project Actual; subcontractor payment does not
  double-post Actual. Financially sound.

## Subcontractor / External party — SUPPORTED (party-scoped), assessed

- Party membership with company-scoped visibility, hardened extensively in Phase 21 (documents,
  valuations, comments, attachments, commitments all party-isolated). A live party login was not driven
  this pass — recommended, to confirm the *party landing experience* is coherent and minimal.

## Client / Owner — NOT CONFIRMED AS A LOGIN PERSONA

- Client commercial data (prime contract, client valuations, invoices, receipts) exists, but a
  dedicated client/owner **login** with a client-appropriate read-only portal was not confirmed. If
  external client visibility is a pilot requirement, this is a gap to scope explicitly.

---

## Cross-persona observations

- **"Needs You" / ball-in-court is a genuine cross-cutting strength** — matched by user id (not name),
  surfaced on the workspace ("My open items"), in per-module "Waiting on me" filters, and in
  plain-language status on POs and pay apps.
- **The workspace landing is PM-shaped.** Whether each non-PM persona gets an equally purposeful
  landing (vs. the same cockpit) is the key open question for the per-persona login pass.

---

## Phase 22A persona pass (2026-09-15, one browser session per persona)

| Persona | Account | Landing and project access | Role-aware modules | Quick actions offered | Needs You / open items | Leaked actions |
| --- | --- | --- | --- | --- | --- | --- |
| PM | Dana Okafor | Workspace Control → certified project, every module | all, Procurement first-class | New RFI · New change order · New direct cost · New task | "My open items" user-matched | none |
| Planner | Ravi Menon | Workspace → project Schedule | Schedule, Cost, Commercial, Procurement, Quality, Doc Control… | New RFI · New task | 0 open | none |
| QS | Sofia Lindqvist | Workspace → Commercial / Cost | Commercial, Cost… | New change order · New direct cost | 0 open | none |
| Cost Controller | Tomás Herrera | Workspace → Cost Overview (budget block, EAC cards) | Cost… | New direct cost | 0 open | none |
| Procurement | Amina Bello | Workspace → project Procurement (Packages / Purchase Orders / Suppliers) | Overview, Schedule, Commercial, Procurement, Quality, Doc Control, Meetings, BOQ, BIM | none — the row is hidden rather than showing an action the role cannot perform | 0 open | none |
| Warehouse | Jonas Weber | Workspace → Inventory (Scan, Goods in, Match, Items, Warehouses, Dashboard, Ledger) | Overview, Schedule, Procurement, Quality, Doc Control… | none (hidden) | 0 open | none |
| Site Engineer | Priya Raman | Workspace → project RFI register | Doc Control… | New RFI · New task | 0 open | none |
| Finance | Grace Mbeki | Workspace → Commercial pay applications ($54,000 paid, $6,000 retention, actors named) | Commercial… | none (hidden) | 0 open | none |
| Quality | — | **Unsupported**: the product has eight roles and no Quality account; not faked. | | | | |
| Client / Owner / Subcontractor | — | **Unsupported**: no persona accounts; not faked. | | | | |

Every persona signed out with "Signed out" (never "Session expired!") and signed back in on the same
sign-in page; no persona saw a control its role cannot use.
