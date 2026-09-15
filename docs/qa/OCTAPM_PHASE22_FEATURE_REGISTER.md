# OCTAPM PHASE 22 — FEATURE REGISTER

Audit-first inventory of every user-facing feature, grouped by module, with a unique Phase 22 ID.
Built from the live application navigation (module bar, sub-tab menus, top-nav, settings) on branch
`feat/p0-foundations-sprint1`, frontend `http://localhost:5173`, backend API `:5000`, signed in as
Dana Okafor (`pm@octapm.demo`, Project Manager). Sub-tab lists were read from the live module
dropdowns; the route list was cross-checked against `frontend/src/routeTree.gen.ts`.

Legend for **Seen**: `live` = opened in the browser this pass · `nav` = present in the live
navigation but not individually opened · `route` = exists as a route only.

---

## 0. Global workspace shell (outside any project)

| ID | Feature | Route / entry | Seen |
| --- | --- | --- | --- |
| F22-000 | Sign in (email + password) | `/sign-in` | live |
| F22-001 | Sign in with company SSO | `/sign-in` → SSO | nav |
| F22-002 | Sign up / create account | `/sign-up` | route |
| F22-003 | Forgot / reset password, OTP | `/forgot-password`, `/reset-password`, `/otp` | route |
| F22-004 | Accept invite | `/accept-invite` | route |
| F22-005 | Workspace Control (PM cockpit: Official KPIs, My open items, Pending review, Workflow queues, Health dimensions, Watchlist) | `/` | live |
| F22-006 | Project switcher (combobox) | top bar "Select project" | live |
| F22-007 | Projects list / create project | `/projects` | nav |
| F22-008 | Portfolio | `/portfolio` | nav |
| F22-009 | Global Inventory & Warehouse | `/inventory` | live |
| F22-010 | Global Reports | `/reports` | nav |
| F22-011 | Global Tasks | `/tasks` | nav |
| F22-012 | Global Search (Cmd+K command menu) | top bar Search | nav |
| F22-013 | Ask OctaPM (assistant) | top bar | nav |
| F22-014 | Notifications | `/notifications` + bell | nav |
| F22-015 | Theme / appearance toggle | top bar | live |
| F22-016 | Account menu (Plans & billing, Account, Billing settings, Notifications, Sign out) | avatar | live |
| F22-017 | Messages / conversations | `/messages` | route |

## 1. Personal & org settings

| ID | Feature | Route | Seen |
| --- | --- | --- | --- |
| F22-020 | Settings: Profile | `/settings` | live |
| F22-021 | Settings: Account | `/account` | nav |
| F22-022 | Settings: Security (password, MFA) | `/security` | nav |
| F22-023 | Settings: Appearance | `/appearance` | nav |
| F22-024 | Settings: Notifications prefs | `/notifications` | nav |
| F22-025 | Settings: Display | `/display` | nav |
| F22-026 | Billing / plans / checkout | `/billing`, `/billing/checkout` | nav |
| F22-027 | Company profile | `/company` | route |
| F22-028 | Users (org members) | `/users` | route |
| F22-029 | Permissions / permission templates | `/permissions` | route |
| F22-030 | Vendors registry | `/vendors` | route |
| F22-031 | Directory / contacts | `/directory` | route |
| F22-032 | Cost codes registry | `/cost-codes` | route (direct URL 404 — see UX register) |
| F22-033 | Custom fields | `/custom-fields` | route |
| F22-034 | Form templates | `/form-templates` | route |
| F22-035 | Templates (project/company) | `/templates` | route |
| F22-036 | Workflows | `/workflows` | route |
| F22-037 | Submittal workflows | `/submittal-workflows` | route |
| F22-038 | Integrations / API keys | `/integrations` | route |
| F22-039 | Equipment registry | `/equipment` | route |

## 2. Project workspace — module bar

Modules: Overview · Schedule · Site Reporting · Cost Control · Commercial · Quality · Doc Control ·
Meetings · BOQ · BIM (overflow: "More"). Project header shows name, start→finish dates, contract
value, status, and Export / primary-action / "…" controls.

### 2.1 Overview
| ID | Feature | Seen |
| --- | --- | --- |
| F22-100 | Project overview / health landing | nav |

### 2.2 Schedule (`/schedule/*`)
| ID | Sub-tab | Seen |
| --- | --- | --- |
| F22-110 | Gantt (default) | live |
| F22-111 | Activities (14) | nav |
| F22-112 | Progress | nav |
| F22-113 | Lookahead | nav |
| F22-114 | Critical Path (11) | nav |
| F22-115 | Earned Value | nav |
| F22-116 | Forecast | nav |
| F22-117 | Milestones (1) | nav |
| F22-118 | Resources | nav |
| F22-119 | Risks | nav |
| F22-120 | Long Lead | nav |
| F22-121 | Revisions | nav |
| F22-122 | Update Schedule / Lock Baseline / Export | live |

### 2.3 Site Reporting (`/site-reporting`)
| ID | Feature | Seen |
| --- | --- | --- |
| F22-130 | Daily logs / site diary / progress submissions | nav |

### 2.4 Cost Control (`/cost/*`)
| ID | Sub-tab | Seen |
| --- | --- | --- |
| F22-140 | Overview (scenario forecast, Budget/Committed/Actual/Forecast) | live |
| F22-141 | By Activity | nav |
| F22-142 | By Phase | nav |
| F22-143 | Equipment | nav |
| F22-144 | Burn Rate | nav |
| F22-145 | Budget | nav |
| F22-146 | Direct Costs | nav |

### 2.5 Commercial (`/commercial/*`)
| ID | Sub-tab | Seen |
| --- | --- | --- |
| F22-150 | Change Orders (+ Add Change Order, status history) | live |
| F22-151 | Pay Applications | nav |
| F22-152 | IPC | nav |
| F22-153 | Budget Revisions | nav |
| F22-154 | EOT | nav |
| F22-155 | Contract (prime/client) | nav |
| F22-156 | Change Events | nav |
| F22-157 | Commitments (subcontracts/POs as commitments) | nav |
| F22-158 | Bids | nav |
| F22-159 | Sub Valuations (legacy) | nav |
| F22-160 | Cash Flow | nav |
| F22-161 | Weather Delays | nav |

### 2.6 Procurement (`/procurement/*`)
| ID | Sub-tab | Seen |
| --- | --- | --- |
| F22-170 | Packages (RFQ / bid packages) | nav |
| F22-171 | Purchase Orders (+ waiting-on-you, status) | live |
| F22-172 | Suppliers | nav |
| F22-173 | Goods receipt (also global Inventory → Goods in) | nav |
| F22-174 | 3-way match (also Inventory → Match) | nav |

### 2.7 Quality (`/quality/*`)
| ID | Sub-tab | Seen |
| --- | --- | --- |
| F22-180 | NCR | nav |
| F22-181 | Inspections | nav |
| F22-182 | Punch list | nav |
| F22-183 | Observations | nav |
| F22-184 | Safety | nav |
| F22-185 | Material Tests | nav |

### 2.8 Doc Control (`/doc-control/*`)
| ID | Sub-tab | Seen |
| --- | --- | --- |
| F22-190 | RFI (+ inline quick-add, New RFI form, ball-in-court) | live |
| F22-191 | Submittals | nav |
| F22-192 | Drawings | nav |
| F22-193 | Specifications | nav |
| F22-194 | Transmittals | nav |
| F22-195 | Correspondence | nav |
| F22-196 | Emails (inbound) | nav |
| F22-197 | Document content search | nav |

### 2.9 Other project modules
| ID | Feature | Seen |
| --- | --- | --- |
| F22-200 | Meetings (+ actions) | nav |
| F22-201 | BOQ (bill of quantities, allocations) | nav |
| F22-202 | BIM | nav |
| F22-203 | Equipment (project) | nav |
| F22-204 | Locations | nav |
| F22-205 | Photos | nav |
| F22-206 | Capture (punch/inspection/progress fast entry) | nav |
| F22-207 | Team (project team + party members) | nav |
| F22-208 | Reports (project) | nav |
| F22-209 | Comments (on any record) | nav |
| F22-210 | Attachments (on any record) | nav |
| F22-211 | Tasks (project) | nav |
| F22-212 | Audit trail (per record + status history feeds) | live (CO history) |

## 3. Inventory (global, `/inventory`)
| ID | Sub-tab | Seen |
| --- | --- | --- |
| F22-220 | Scan (barcode) | nav |
| F22-221 | Goods in (GRN) | nav |
| F22-222 | Match (3-way) | nav |
| F22-223 | Items (+ inline Issue) | live |
| F22-224 | Warehouses / bins | nav |
| F22-225 | Dashboard | nav |
| F22-226 | Ledger (stock transactions) | nav |
| F22-227 | Transfers / reservations / returns / damage / quarantine | nav |

---

## Coverage summary

- **Modules inventoried:** 10 project modules + global inventory + settings/admin.
- **Distinct user-facing features/sub-tabs catalogued:** ~110 (F22-000 … F22-227).
- **Opened live this pass:** Workspace Control, Schedule (Gantt), Cost Control (Overview), Commercial
  (Change Orders + Add form + audit), Procurement (Purchase Orders), Doc Control (RFI + New RFI form),
  global Inventory (Items), Settings (Profile), plus sign-in/out.
- **Personas exercised live:** Project Manager (full). Other personas assessed by permission model and
  navigation (see PERSONA_JOURNEYS); a dedicated per-persona browser pass is the recommended next step.

## Personas — support status

| Persona | Supported | Notes |
| --- | --- | --- |
| Project / Company Admin | Yes | org settings, users, permissions, company |
| Project Manager | Yes | full workspace cockpit (tested live) |
| Planner / Planning Engineer | Yes | schedule module, approvals |
| QS / Commercial | Yes | commercial module, change/pay-app |
| Cost Controller | Yes | cost module, direct costs |
| Procurement | Yes | procurement module |
| Warehouse / Storekeeper | Yes | inventory module |
| Site Engineer | Yes | capture, RFI, quality, progress |
| Quality | Yes | quality module |
| Finance / Accounts | Yes | payments, receipts, cash flow |
| Subcontractor / External party | Yes (party-scoped) | party membership; company-scoped visibility (hardened in Phase 21) |
| Client / Owner user | **NOT CONFIRMED AS A DISTINCT LOGIN PERSONA** | client commercial data exists (prime contract, client valuations, receipts) but a dedicated client/owner *login* was not verified in this pass — treat as NOT CONFIRMED pending a login test |

---

## Phase 22A additions (2026-09-15)

| Feature | Where | Personas | Notes |
| --- | --- | --- | --- |
| Workspace quick actions | Workspace Control, under the header | any persona whose role can create the record | New RFI · New change order · New direct cost · New task; project remembered; each opens the module's own dialog (`?new=rfi`, `?new=change_order`, `?new=direct_cost`, `/tasks?new=task`); hidden entirely when the role can create none of them |
| Budget block + EAC cards | Cost Control → Overview | PM, Cost Controller, QS | Original / Approved changes / Revisions & transfers / Revised (budget register) · Allocated to activities · Committed · Actual cost · Forecast (EAC) · Optimistic / Most likely / Pessimistic |
| Raised By picker · Document picker | Commercial → Add / Edit Change Order | QS, PM | project team, parties, other/external; register documents with an uploaded revision |
| Registry short links | `/cost-codes`, `/vendors`, `/directory` | any | redirect to `/company/…` |
| Residue archive script | `backend/scripts/demo/archive-e2e-residue.js` | operator | dry-run by default; `--apply` |

## Phase 22B additions (2026-09-15)

| Feature | Where | Status |
| --- | --- | --- |
| Quality Engineer role (policy, labels, pickers, invitations, templates) | `shared/permissions.json`, users, team, report schedules | live |
| Quality create dialog (NCR, safety incident, material test with severity, activity, responsible person and company, due date) | Quality dashboard | live |
| Assignee may submit an NCR or safety closeout regardless of role | `requirePermissionOr`, ncr and safety close routes, dashboard | live |
| Change order names a budget line or a split; applied on approval | change-order form and register, budget service | live |
| Change-order evidence from any record's attachments | document picker "Attached to records", `GET /projects/:id/attachments/search` | live |
| One financial vocabulary (Executed commitments, PO value, Committed (manual)) | cost, commercial, procurement, forecast, reports | live |
| Goods receipt publishes a project event (buyer's list updates live) | goods-receipt service | live |
| Company add and edit from the Directory; active-only listing with an inactive switch | Company, Directory | live |
| Cost-code edit | Company, Cost codes | live |
| Navigation gated by permission (People, Company); sub-tabs follow their permission module; content waits for permissions | top navbar, project detail | live |
| Every role reads project parties | policy | live |
| Invitable roles from the policy | user service | live |
| Dedicated E2E organisation, reset on every Playwright run, count report | `scripts/e2e/reset-e2e-org.js`, `e2e/global-setup.ts` | live |
| Seeded cost codes and budget lines (only when a project has none) | `prisma/seed.js` | live |
| Residue script: company clean-up (inactive, opt-in delete), greenfield cost codes archived, archivedAt stamped, pinned to the certified project's organisation, live demo project protected by name | `scripts/demo/archive-e2e-residue.js` | live |
| Clean demo Riverside Tower (original fixture archived with its history) | demo organisation | live |

Personas, support status after 22B: Company/Admin, PM, Planner, QS, Cost Controller, Procurement,
Warehouse, Site Engineer, Quality, Finance are SUPPORTED (browser-certified). Supplier / Bidder is
SUPPORTED by invitation link (portal, no login). Client / Owner and Subcontractor logins are NOT
SUPPORTED as external users (an invited representative receives an internal role) and are excluded
from Pilot V1.
