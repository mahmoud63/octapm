# Guide Coverage Matrix

Every feature of the Phase 22 Feature Register (`docs/qa/OCTAPM_PHASE22_FEATURE_REGISTER.md`,
with the 22A and 22B additions) against the handbook. COVERED names the chapter, guide or image;
NOT APPLICABLE says why; MISSING is unexplained absence. Pilot V1 scope: the ten internal
personas and the supplier portal.

| ID | Feature | Master Guide | Role Guide | Workflow Guide | Screenshot | Quick Start |
| --- | --- | --- | --- | --- | --- | --- |
| F22-000 | Sign in (email + password) | ch. 3 | all | – | sign_in.png | yes |
| F22-001 | Sign in with company SSO | ch. 3 | Admin (Security) | – | sign_in.png | yes |
| F22-002 | Sign up / create account | NOT APPLICABLE — people join by invitation in the pilot | – | – | – | – |
| F22-003 | Forgot / reset password, OTP | ch. 3 | Admin (reset) | – | – | yes |
| F22-004 | Accept invite | ch. 3, 11 | Admin | – | – | – |
| F22-005 | Workspace Control (KPIs, My open items, Pending review, queues) | ch. 4, 7 | all (C) | – | pm_workspace.png and one per persona | yes |
| F22-006 | Project switcher | ch. 5 | all | – | pm_workspace.png | yes |
| F22-007 | Projects list / create project | ch. 5, 12 | PM, Admin | – | – (list shows the certified fixture's run-stamped name) | – |
| F22-008 | Portfolio | ch. 5 | PM | – | – | – |
| F22-009 | Global Inventory & Warehouse | ch. 20 | Storekeeper, Procurement | 7, 8, 9 | inventory_items.png, goods_receipt_*.png | – |
| F22-010 | Global Reports | ch. 24 | PM, Cost Controller (I) | – | reports.png | – |
| F22-011 | Global Tasks | ch. 23 | Planner, Site, Quality, PM | 24 | – (list shows archived fixture titles) | yes (quick action) |
| F22-012 | Global Search (Ctrl+K) | ch. 10 | all | – | search_command_menu.png | yes |
| F22-013 | Ask OctaPM (assistant) | ch. 10, 30 | – | – | – | yes |
| F22-014 | Notifications (bell; no page) | ch. 9 | all | – | notifications_bell.png, settings_notifications.png | yes |
| F22-015 | Theme / appearance toggle | ch. 6 | – | – | – | – |
| F22-016 | Account menu (settings, sign out) | ch. 3, 25 | all (sign out) | – | account_menu.png | yes |
| F22-017 | Messages / conversations | ch. 2 (table) | – | – | messages.png | – |
| F22-020–025 | Settings: Profile, Account, Security, Appearance, Notifications, Display | ch. 25 | – | – | settings_profile.png, settings_notifications.png | – |
| F22-026 | Billing / plans / checkout | NOT APPLICABLE — commercial terms of the OctaPM subscription, not project use | – | – | – | – |
| F22-027 | Company profile | ch. 25 | Admin | – | company_directory.png | – |
| F22-028 | Users (People) | ch. 25 | Admin (F) | – | – (list counts archived projects) | – |
| F22-029 | Permissions / templates | ch. 13, 25 | Admin, PM | – | company_permissions.png | – |
| F22-030 | Vendors registry | ch. 25 | Admin, Procurement | 5 | – (lists inactive residue vendors) | – |
| F22-031 | Directory / contacts | ch. 25 | Admin (F) | – | company_directory.png | – |
| F22-032 | Cost codes registry | ch. 17, 25 | Admin (F), Cost Controller | 4 | company_cost_codes.png | – |
| F22-033 | Custom fields | ch. 25 | Admin | – | company_custom_fields.png | – |
| F22-034 | Form (inspection) templates | ch. 22, 25 | Admin, Quality | 19 | company_inspection_templates.png | – |
| F22-035 | Project templates | ch. 12, 25 | Admin | – | company_project_templates.png | – |
| F22-036 | Workflows | ch. 25 | Admin | – | company_workflows.png | – |
| F22-037 | Submittal workflows | ch. 21, 25 | Admin | 23 | company_submittal_workflows.png | – |
| F22-038 | Integrations / API keys | ch. 25 | Admin | – | company_integrations.png | – |
| F22-039 | Equipment registry | ch. 25 | Admin | – | company_equipment.png | – |
| F22-100 | Project overview / health | ch. 12 | PM (F) | – | project_overview.png | yes |
| F22-110 | Schedule: Gantt | ch. 14 | Planner (F) | 3 | schedule_gantt.png | – |
| F22-111 | Activities | ch. 14 | Planner | 3 | activities.png | – |
| F22-112 | Progress | ch. 14 | Planner, Site (F) | 3 | schedule_progress.png | – |
| F22-113 | Lookahead | ch. 14 | Planner, Site | 3 | schedule_lookahead.png | – |
| F22-114 | Critical Path | ch. 14 | Planner | – | schedule_gantt.png | – |
| F22-115 | Earned Value | ch. 14 | Planner, PM (I) | 3 | schedule_earned_value.png | – |
| F22-116 | Forecast | ch. 14, 17 | Planner, Cost Controller | – | schedule_forecast.png | – |
| F22-117 | Milestones | ch. 14 | Planner | – | project_overview.png | – |
| F22-118 | Resources | ch. 14 | Planner | – | schedule_resources.png | – |
| F22-119 | Risks | ch. 14 | Planner, PM (G) | – | schedule_risks.png | – |
| F22-120 | Long Lead | ch. 14, 19 | Planner, Procurement | 6 | schedule_long_lead.png | – |
| F22-121 | Revisions | ch. 14 | Planner (F), PM (G) | – | schedule_revisions.png | – |
| F22-122 | Update Schedule / Lock Baseline / Export | ch. 14 | Planner, PM | – | schedule_gantt.png | – |
| F22-130 | Daily logs / site diary / progress submissions | ch. 15 | Site (F), PM (G) | 3, 12 | site_reporting_daily_log.png, site_reporting_timesheets.png | – |
| F22-140 | Cost Overview | ch. 17 | Cost Controller (F), PM, QS | 10 | cost_overview.png | – |
| F22-141 | By Activity | ch. 17 | Cost Controller | – | cost_by_activity.png | – |
| F22-142 | By Phase | ch. 17 | Cost Controller | – | – | – |
| F22-143 | Equipment (cost) | ch. 17 | Cost Controller | – | project_equipment.png | – |
| F22-144 | Burn Rate | ch. 17 | Cost Controller | – | – | – |
| F22-145 | Budget | ch. 17 | Cost Controller (F), QS | 4 | cost_budget.png | – |
| F22-146 | Direct Costs | ch. 17 | Cost Controller (F), Finance (G) | 11 | cost_direct_costs.png | yes (quick action) |
| F22-150 | Change Orders | ch. 18 | QS (F), PM (F) | 2 | commercial_change_orders.png, change_order_form.png, change_order_created.png, change_order_pm_register.png | yes (quick action) |
| F22-151 | Pay Applications | ch. 18 | QS, PM, Finance (F) | 13, 14, 15 | commercial_pay_apps.png | – |
| F22-152 | IPC | ch. 18 | QS, Finance (F) | 16, 17, 18 | commercial_ipc.png | – |
| F22-153 | Budget Revisions | ch. 18 | QS | – | commercial_budget_revisions.png | – |
| F22-154 | EOT | ch. 18 | QS, Planner | – | commercial_eot.png | – |
| F22-155 | Contract (prime/client) | ch. 18 | QS (F), Finance | 16 | commercial_contract.png | – |
| F22-156 | Change Events | ch. 18 | QS (D), Site | – | commercial_change_events.png | – |
| F22-157 | Commitments | ch. 18 | QS, Procurement, Finance | 13 | commercial_commitments.png | – |
| F22-158 | Bids | ch. 18 | Procurement (F), QS, PM (F), Supplier (F) | 5 | commercial_bids.png, supplier_portal_*.png, bids_register_after_submission.png | – |
| F22-159 | Sub Valuations (legacy) | ch. 18 (named) | NOT APPLICABLE — legacy register kept for history | – | – | – |
| F22-160 | Cash Flow | ch. 18 | Finance (F) | 15 | commercial_cash_flow.png | – |
| F22-161 | Weather Delays | ch. 18 | QS | – | – | – |
| F22-170 | Procurement packages | ch. 19 | Procurement (F) | 6 | procurement_packages.png | – |
| F22-171 | Purchase Orders | ch. 19 | Procurement (F), PM (F) | 6 | procurement_purchase_orders.png | – |
| F22-172 | Suppliers | ch. 19 | Procurement | – | procurement_suppliers.png | – |
| F22-173 | Goods receipt | ch. 20 | Storekeeper (F) | 7 | goods_receipt_start.png, goods_receipt_order_found.png, goods_receipt_posted.png | – |
| F22-174 | Three-way match | ch. 20 | Finance, Storekeeper | 7 | – (tab lists archived-project orders) | – |
| F22-180 | NCR | ch. 22 | Quality (F), Site, Procurement (F: closeout) | 19, 20 | ncr_*.png, needs_you_assignee.png | – |
| F22-181 | Inspections | ch. 22 | Quality (F), Site | 19 | quality_inspections.png | – |
| F22-182 | Punch list | ch. 22 | Quality (F), Site | 21 | quality_punch_list.png | – |
| F22-183 | Observations | ch. 22 | Quality, Site | – | quality_observations.png | – |
| F22-184 | Safety | ch. 22 | Quality (F) | 20 (same pattern) | quality_safety.png | – |
| F22-185 | Material Tests | ch. 22 | Quality (F) | – | quality_material_tests.png | – |
| F22-190 | RFI | ch. 21 | Site (F), PM (F) | 1 | rfi_*.png, doc_control_rfi.png | yes (quick action) |
| F22-191 | Submittals | ch. 21 | Site, PM (G) | 23 | doc_control_submittals.png | – |
| F22-192 | Drawings | ch. 21 | Planner, Site | 22 | doc_control_drawings.png | – |
| F22-193 | Specifications | ch. 21 | Site | 22 | doc_control_specifications.png | – |
| F22-194 | Transmittals | ch. 21 | Site | 22 | doc_control_transmittals.png | – |
| F22-195 | Correspondence | ch. 21 | Site | 22 | doc_control_correspondence.png | – |
| F22-196 | Emails (inbound) | ch. 21 | – | – | doc_control_emails.png | – |
| F22-197 | Document content search | ch. 10, 21 | all | 22 | doc_control_search.png | yes |
| F22-200 | Meetings | ch. 23 | PM, Planner (G) | 24 | meetings.png | – |
| F22-201 | BOQ | ch. 16 | QS (F), Planner | 4 | boq.png | – |
| F22-202 | BIM | ch. 2 (table) | – | – | bim.png | – |
| F22-203 | Equipment (project) | ch. 17 | Cost Controller | – | project_equipment.png | – |
| F22-204 | Locations | ch. 6, 25 (Admin table) | Admin, Site | – | locations.png | – |
| F22-205 | Photos | ch. 15 | Site | – | photos.png | – |
| F22-206 | Capture | ch. 15 | Site (F) | 3 | capture.png | – |
| F22-207 | Team | ch. 13 | Admin (F), PM (F) | – | project_team.png | – |
| F22-208 | Reports (project) | ch. 24 | PM, Planner (I) | – | project_reports.png | – |
| F22-209 | Comments | ch. 23 | all (task comments) | 24 | – | – |
| F22-210 | Attachments | ch. 18, 22 | QS, Quality | 2, 20 | change_order_form.png, ncr_closeout_dialog.png | – |
| F22-211 | Tasks (project) | ch. 23 | Planner, Site, Quality | 24 | – | yes |
| F22-212 | Audit trail | ch. 7, 26 | PM (F) | 1, 2 | doc_control_rfi.png (RFI Audit History) | – |
| F22-220 | Inventory: Scan | ch. 20 | Storekeeper | 7 | inventory_scan.png | – |
| F22-221 | Goods in | ch. 20 | Storekeeper (F) | 7 | goods_receipt_*.png | – |
| F22-222 | Match | ch. 20 | Finance, Storekeeper | 7 | – (residue) | – |
| F22-223 | Items (+ Issue) | ch. 20 | Storekeeper (F) | 9 | inventory_items.png, inventory_items_after_receipt.png | – |
| F22-224 | Warehouses / bins | ch. 20 | Storekeeper | 8 | – (residue) | – |
| F22-225 | Dashboard | ch. 20 | Storekeeper (I) | 8 | – (residue) | – |
| F22-226 | Ledger | ch. 20 | Storekeeper (I) | 10 | inventory_ledger.png | – |
| F22-227 | Transfers / reservations / returns / damage / quarantine | ch. 20 | Storekeeper (F) | 9 | – | – |
| 22A | Workspace quick actions | ch. 8 | all (C) | – | workspace_quick_actions.png | yes |
| 22A | Budget block + EAC cards | ch. 17 | Cost Controller | 10 | cost_overview.png | – |
| 22A | Raised By and document pickers | ch. 18 | QS (F) | 2 | change_order_form.png | – |
| 22A | Registry short links | NOT APPLICABLE — address shortcuts, no user feature | – | – | – | – |
| 22B | Quality Engineer role | ch. 11 | Quality (whole guide) | 19–21 | quality_engineer_workspace.png | – |
| 22B | Quality create dialog | ch. 22 | Quality (F), Site | 20 | ncr_new_dialog.png | – |
| 22B | Assignee submits closeout | ch. 22, 26 | Procurement (F), Site (F), Quality | 20 | ncr_closeout_dialog.png | – |
| 22B | Change order budget line / split | ch. 18, 26 | QS (F), PM (F) | 2 | change_order_form.png | – |
| 22B | Evidence from any record | ch. 18 | QS (F) | 2 | change_order_form.png | – |
| 22B | One financial vocabulary | ch. 17, glossary | Cost Controller | 10 | cost_overview.png | – |
| 22B | Goods receipt live update | ch. 26 | Storekeeper (F) | 7 | goods_receipt_posted.png | – |
| 22B | Company add/edit, inactive switch | ch. 25 | Admin (F) | – | company_directory.png | – |
| 22B | Cost-code edit | ch. 25 | Admin (F) | 4 | company_cost_codes.png | – |
| 22B | Navigation gated by permission | ch. 6 | all (D) | – | – | – |
| 22B | Invitable roles from the policy | ch. 11 | Admin (F) | – | – | – |
| 22B | E2E organisation, seed, residue script, clean demo project | NOT APPLICABLE — operator tooling, not a user feature | – | – | – | – |

**Rows:** 121. **COVERED:** 116. **NOT APPLICABLE:** 5 (sign-up, billing, legacy sub valuations,
registry short links, operator tooling). **MISSING:** 0 for supported Pilot V1 features.
Screenshots are absent, by decision, on seven rows whose live capture showed archived-project or
inactive residue or raw identifiers (Projects list, People, Vendors, Match, Warehouses, Inventory
Dashboard, Tasks); the features are covered in text.
