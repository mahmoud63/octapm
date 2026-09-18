# OctaPM Mobile — Feature Matrix

**Audience:** the product owner, the mobile team and the UAT leads.
**Status:** planned coverage per platform, as of 2026-09-18. "Phone" and "Tablet" describe the native app on Android and iOS/iPadOS; "Web" is the existing web platform, which remains the complete product. The milestone column refers to the [implementation plan](OCTAPM_MOBILE_IMPLEMENTATION_PLAN.md); roles come from the [permission matrix](OCTAPM_MOBILE_PERMISSION_MATRIX.md), which is generated from the backend policy.

**Levels.** FULL = create, edit and every transition the role holds. VIEW = read only. APPROVE = the approve/decide step is available (only where the role holds it and the step is safe on a phone). LIMITED = a deliberate subset, described in the notes. NOT AVAILABLE = web only; the app hands over with a link.

Every level assumes the role holds the permission on the server for that project; the app never widens a permission.

## Global

| Feature | Phone | Tablet | Web | Milestone | Roles | Notes |
|---|---|---|---|---|---|---|
| Sign in (email/password), biometric unlock, sign out | FULL | FULL | FULL | M0 | all | native session contract; SSO opens the web sign-in in the system browser |
| Company SSO | LIMITED | LIMITED | FULL | M0 | all | the identity-provider round trip completes on the web; the app has no app-scheme callback yet |
| Workspace / Home (Needs You, today, quick actions, outbox) | FULL | FULL | FULL | M1 | all | Home is field-first: Needs You before anything else |
| Projects list and switch | FULL | FULL | FULL | M1 | all | switching clears project-scoped state |
| Needs You | FULL | FULL | FULL | M1 | all | per project from the assignments endpoint; role-derived PO/commitment/pay-app items appear on the web only |
| Global search | FULL | FULL | FULL | M1 | all | typed results, deep links into records |
| Notifications | LIMITED | LIMITED | FULL | M1 / M9 | all | list, read, preferences view; native push delivery waits for a backend registration endpoint (M9) |
| Messages / conversations | VIEW | VIEW | FULL | M1 | all | read and reply later; not a field priority |
| Portfolio, company settings, people, billing, reports | NOT AVAILABLE | NOT AVAILABLE | FULL | — | PM, admin | administration stays on the web |

## Documents and communication

| Feature | Phone | Tablet | Web | Milestone | Roles | Notes |
|---|---|---|---|---|---|---|
| RFI list, filters, ball in court, detail, history | FULL | FULL | FULL | M2 | PM, Plan, QS, Cost, Proc, Site, Qual, Fin; parties per policy | |
| RFI create and quick create | FULL | FULL | FULL | M2 | PM, Plan, Site, Qual + contractor, subcontractor | pre-fills project, person, date; no replay key, so sent once online |
| RFI respond, close, convert to change | FULL | FULL | FULL | M2 | per policy transitions | convert only where the role holds change-order create |
| Submittals list, ball in court, detail | FULL | FULL | FULL | M2 | per policy | |
| Submittal submit, review comment, decide | FULL | FULL | FULL | M2 | submit: PM, Plan, Site, Qual + contractor, subcontractor; review: PM, Plan, QS + consultant; decide/approve: PM + consultant | revision evidence required by the server |
| Document register, search, extracted text | VIEW | VIEW | FULL | M2 | document_control readers | |
| Document revision submit-review / approve | NOT AVAILABLE | NOT AVAILABLE | FULL | — | PM, Plan | web only |
| Drawing register, sheet viewer (zoom, pan, fit width), latest revision, favourites, recents | FULL | FULL | FULL | M2 | document_control readers | source PDF rendered on device; no server page images |
| Superseded-drawing warning | FULL | FULL | FULL | M2 | all viewers | never silently shows an obsolete sheet |
| Offline drawings | FULL | FULL | NOT AVAILABLE | M7 | all viewers | manifest-based; supersession marked after sync |
| Drawing markups and pins (create punch/RFI/inspection from a pin) | FULL | FULL | FULL | M2 | per target module | personal markups; publish stays on web |
| Transmittals, correspondence, specifications, emails | VIEW | VIEW | FULL | M2 | document_control readers | |
| Comments, mentions, subscriptions on any record | FULL | FULL | FULL | M2 | all with read | |
| Attachments and photos on any record | FULL | FULL | FULL | M2 / M3 | any of update/submit/create on the module | unified endpoint with replay key |
| Tasks (mine, cursor paging, close, comment) | FULL | FULL | FULL | M2 | all; parties comment | |
| Meetings | VIEW | VIEW | FULL | M2 | meeting readers | action items surface as tasks |

## Site and schedule

| Feature | Phone | Tablet | Web | Milestone | Roles | Notes |
|---|---|---|---|---|---|---|
| Daily log day view, entries by section, copy-previous structure, weather refresh | FULL | FULL | FULL | M3 | progress submit: PM, Plan, Site, Qual + parties for own entries | draft offline; entries carry a replay key |
| Daily log submit, approve, distribute, entry review | LIMITED | LIMITED | FULL | M3 | submit/distribute: submit holders; approve: PM; entry review: PM, Plan, Site, Qual | approve stays on the web |
| Daily reports and site diaries (create, submit) | FULL | FULL | FULL | M3 | progress submit holders | offline drafts with replay key |
| Site photos: capture, caption, tags, location, association | FULL | FULL | FULL | M3 | document_control create | GPS never sent to the server; EXIF stays with the file |
| Photo markup and annotation | LIMITED | FULL | LIMITED | M3 | as above | arrows and text; richer on tablet |
| Today's work, activities, milestones, critical activities | FULL (view) | FULL (view) | FULL | M3 | schedule readers | no Gantt editing on phone |
| Progress submission (percent, quantity, milestones, inspection, evidence) | FULL | FULL | FULL | M3 | progress submit holders, assigned engineers | `source: 'mobile'`; online only (no replay key) |
| Progress approval | NOT AVAILABLE | APPROVE | FULL | M3 / M8 | PM, Plan, QS | tablet only, with hold-point warnings |
| Lookahead items and field status | FULL | FULL | FULL | M3 | lookahead holders + contractor, subcontractor | variance reason required when not done |
| Schedule revisions, baseline, activate, rollback, AI generation | NOT AVAILABLE | NOT AVAILABLE | FULL | — | PM, Plan | |
| Gantt | NOT AVAILABLE | LIMITED | FULL | M8 | schedule readers | read-only timeline on tablet |
| Earned value, health dimensions | LIMITED | LIMITED | FULL | M3 | health: all; EV report: cost readers | tiles from `/health`; the EV report stays on the web |
| Risks | VIEW | VIEW | FULL | M3 | risk readers | |
| Long lead | VIEW | VIEW | FULL | M3 / M5 | all with project access | |
| Timesheets (create, submit; workers and crews for own company) | FULL | FULL | FULL | M3 | timesheet holders + contractor, subcontractor | approve stays on the web |
| Equipment, locations | VIEW | VIEW | FULL | M2 | readers | location picker everywhere a record takes one |

## Quality and safety

| Feature | Phone | Tablet | Web | Milestone | Roles | Notes |
|---|---|---|---|---|---|---|
| Quality home (due, failed, open NCRs, punch, tests, safety, overdue) | FULL | FULL | FULL | M4 | all with project access | from `/quality/dashboard` |
| Inspections and forms: start, answer, photos per item, hold points, complete | FULL | FULL | FULL | M4 (built) | inspection submit: PM, Plan, Site, QS, Qual + consultant, contractor, subcontractor | answers saved in one request; completion gate enforced by the server; offline drafts come with M7 |
| Inspection signatures | NOT AVAILABLE | NOT AVAILABLE | FULL | M8 | signature holders | the signature pad comes with the tablet work; the checklist says so on a signature item |
| Inspection close, reopen, void | APPROVE | APPROVE | FULL | M4 (built) | close/reopen: PM, Plan, Qual; void: PM, Qual | simple confirmations; safe on a phone |
| Deficiency from a failed item (punch item) | FULL | FULL | FULL | M4 (built) | inspection complete + punch create | observation as the target stays on the web |
| Form templates (project and company) | VIEW | VIEW | FULL | M4 (built) | readers; template admin on web | the active templates appear in the new-inspection picker |
| Punch items and observations: quick create from camera, transitions, photos | FULL | FULL | FULL | M4 (built) | create: PM, Plan, Site, QS, Qual + consultant, contractor; close/void: PM, Qual + consultant | replay key on create; bulk actions stay on the web |
| NCR: create, submit with evidence, view | FULL | FULL | FULL | M4 (built) | PM, Plan, Site, Qual (no party access) | closeout evidence through workflow uploads, online; the list is filtered on the device (no single-record route) |
| NCR approve, reject, reopen | APPROVE | APPROVE | FULL | M4 (built) | PM, Qual | |
| Safety incidents: report, investigate, submit | FULL | FULL | FULL | M4 (built) | PM, Site, Qual (no party access) | same closeout contract as NCR |
| Safety approve, reject, reopen | APPROVE | APPROVE | FULL | M4 (built) | PM, Qual | |
| Material tests | LIMITED | LIMITED | FULL | M4 (built) | inspection holders | schedule and record the result; no workflow exists on the server |
| Legacy ITP and defects registers | NOT AVAILABLE | NOT AVAILABLE | FULL | — | inspection / punch holders | superseded by forms and punch on the server; stay on the web |

## Inventory and procurement

| Feature | Phone | Tablet | Web | Milestone | Roles | Notes |
|---|---|---|---|---|---|---|
| Inventory home, item search, item detail and balances | FULL | FULL | FULL | M5 | all nine roles read | balances shown with their age when cached |
| Barcode / QR scan to resolve an item | FULL | FULL | NOT AVAILABLE | M5 | inventory readers | resolves items by barcode, QR or SKU; bins, warehouses and POs have no codes on the server |
| Goods receipt against a purchase order | FULL | FULL | FULL | M5 | PM, Proc, Store | client receipt number; replay-safe |
| Direct goods-in (no PO) | FULL | FULL | FULL | M5 | PM, Proc, Store | online only |
| Issue, return, reserve | FULL | FULL | FULL | M5 | PM, Store, Site, Qual | online only; never auto-retried (cost posts) |
| Adjust, damage, quarantine, release | FULL | FULL | FULL | M5 | PM, Store | online only |
| Transfers: create, dispatch, receive | FULL | FULL | FULL | M5 | PM, Store | no cancel on the server |
| Movement ledger, summary, low stock | VIEW | VIEW | FULL | M5 | inventory readers | polled; no realtime for inventory |
| Stock counts | NOT AVAILABLE | NOT AVAILABLE | NOT AVAILABLE | — | — | no endpoint exists |
| Item and warehouse master data | VIEW | LIMITED | FULL | M5 | item/warehouse manage: PM, Proc, Store | create/edit on tablet later; web preferred |
| Procurement packages, suppliers, purchase orders, lead-time alerts | VIEW + acknowledge | VIEW + acknowledge | FULL | M6 | procurement readers; acknowledge: PM, Plan, Proc, Store | |
| Purchase order submit, approve, issue, acknowledge, cancel, close | NOT AVAILABLE | NOT AVAILABLE | FULL | — | per policy | web only |
| Deliveries against a PO (procurement route) | FULL | FULL | FULL | M5 | PM, Proc, Store | same writer as goods receipt |
| Bids and RFQs | NOT AVAILABLE | NOT AVAILABLE | FULL | — | bid holders | supplier portals are web links |

## Commercial and approvals

| Feature | Phone | Tablet | Web | Milestone | Roles | Notes |
|---|---|---|---|---|---|---|
| Change events: create, view, RFQ send | FULL | FULL | FULL | M6 | create: PM, Plan, QS, Site, Qual + contractor; RFQ: PM, QS, Proc + contractor | subcontractor parties have no access on the server |
| Change events: quote accept, convert, close, void | NOT AVAILABLE | NOT AVAILABLE | FULL | — | PM, QS | |
| Change orders | VIEW | VIEW | FULL | M6 | change_order readers | create/update are PM and QS on the web |
| Workflow inbox: my steps, respond | FULL | FULL | FULL | M6 | step assignees | the safe way to answer a running workflow |
| Commitments | VIEW | VIEW | FULL | M6 | commitment readers | |
| Pay applications: view; submit as a party | LIMITED | LIMITED | FULL | M6 | readers; submit: contractor, subcontractor | review, approve, pay stay on the web |
| IPC, budget, cost, direct costs, cash flow, EOT, weather delays, contract | NOT AVAILABLE | NOT AVAILABLE | FULL | — | commercial roles | financial posting stays on the web |
| Weather delay from a daily-log delay entry | FULL | FULL | FULL | M3 | progress update holders | promotes the entry; the register stays on the web |

## Cross-cutting

| Feature | Phone | Tablet | Web | Milestone | Roles | Notes |
|---|---|---|---|---|---|---|
| Offline reading of cached records | FULL | FULL | NOT AVAILABLE | M7 | all | per the offline policy |
| Offline capture and outbox | FULL | FULL | NOT AVAILABLE | M7 | as per feature | replay-safe endpoints only |
| Deep links and universal links | FULL | FULL | FULL | M9 | all | every record type in the API map's link table |
| Push notifications | LIMITED | LIMITED | FULL (Web Push) | M9 | all | needs a native registration endpoint on the server |
| Realtime updates | FULL | FULL | FULL | M9 | all | socket.io project rooms |
| Master–detail layouts, rail, split view | — | FULL | — | M8 | all | tablet only |
| Accessibility (labels, targets, dynamic type, reduced motion) | FULL | FULL | FULL | every milestone | all | |
| Custom fields on records | FULL | FULL | FULL | M2 | module holders | schema-driven |
| AI assistant features (photo analysis, daily-log drafts, spec conflicts) | LIMITED | LIMITED | FULL | later | assistant readers | offered only where the org has AI enabled |

## Role applicability at a glance

| Role | Primary mobile use |
|---|---|
| Project Manager | Needs You, approvals that are safe on a phone (inspection close, NCR/safety decisions, workflow steps), oversight of every module |
| Planning Engineer | progress review, lookaheads, RFI/submittal flow, daily-log review |
| QS | RFI and submittal review, change events, pay-application review (view) |
| Cost Controller | view-first: health, EV tiles, timesheets approval stays on web |
| Procurement | purchase orders and deliveries, lead-time alerts, goods receipt, item master |
| Warehouse (storekeeper) | scanning, goods receipt, issue, return, transfer, adjustments, ledger |
| Site Engineer | daily logs, progress, photos, RFIs, punch, inspections, safety, lookahead status, timesheets |
| Quality Engineer | inspections, NCR, punch, safety, material tests, quality home |
| Finance | view-only; IPC, payments and retention stay on the web |
| Parties (owner, consultant, contractor, subcontractor) | exactly the modules and transitions the party policy grants; NCR and safety are never visible |
