# OctaPM company vs project ownership matrix (§100)

Which workspace-level (company) object owns what, which project-level object owns what, how a project consumes company masters, and what happens on the two lifecycle events that expose ownership: **personal → company conversion** (nothing moves — same `orgId`) and **project archive**. [C] = confirmed at the cited line, [D] = decision.

Legend for "Owner": **Company** = row carries `orgId` and no project; **Company (library)** = `orgId` with nullable `projectId`, null means every project; **Project** = row carries `projectId` (with or without a denormalised `orgId`); **Identity** = per user across workspaces.

| Object | Owner today [C] | Evidence | Project consumes it via | Target [D] / note |
|---|---|---|---|---|
| Organisation profile, SSO/MFA policy, subscription | Company | `schema.prisma:11-27`, `Subscription :4530` | — | + `kind`, `slug` |
| Membership (role, admin, owner) | Company ↔ Identity | new `OrganizationMembership` | `ProjectAssignment` FK to membership | membership doc |
| People directory (`/company/directory`) | Company | `routes/company-workspace.js` directory readable by any member | project team picker lists members | guests excluded from the directory |
| Company (vendor / subcontractor / client directory) | Company | `Company` unique `[orgId, name]` `:336-403`; 666 rows | `ProjectParty.companyId`, `Commitment.vendorCompanyId`, `ProcurementSupplier.companyId`, `PrimeContract.clientCompanyId`, `DirectCost/Rfq.vendorCompanyId` | keep; same real subcontractor exists once per org — no platform identity (§99 extension: `linkedOrgId`) |
| Vendor prequalification | Company | `VendorPrequalification.companyId @unique` `:7999` | read on bid invitation / commitment | keep |
| Cost code master | Company | `CostCode @@unique([orgId, code])` `:4649`; 47 rows | `ProjectCostCode` subset `:4683` (314 rows) → `BudgetLine` `:4707` | keep; MFK `(costCodeId, orgId)` added (arch doc §7); a project never creates a cost code — it selects from the library (`budget.service.js:62-122`) |
| Budget register (lines, changes, snapshots) | Project | `BudgetLine/BudgetLineChange/BudgetSnapshot :4707-4810` | — | certified; untouched |
| Cost ledger | Project (org-qualified idempotency) | `CostLedgerEntry @@unique([orgId, sourceKey]) :8190` | — | certified; untouched |
| Permission templates | Company | `PermissionTemplate @@unique([orgId, name]) :6546`; 12 system templates seeded per org (`auth.service.js:251-281`) | `ProjectUserPermission.templateId`, `ProjectParty.permissionTemplateId` | keep; MFK `(templateId, orgId)`; three orgs missing seeds are re-seeded in ENT-1 |
| Project templates | Company | `ProjectTemplate @@unique([orgId, name]) :5252` | `Project.templateId` at creation | keep |
| Form (ITP/inspection) templates | Company (library) | `FormTemplate.projectId?` `:6683`; 8 rows all company-wide | `FormInstance.templateId` (Restrict) | keep; a project-owned template (`projectId` set) stays private to that project |
| Workflow templates | Company (library) | `WorkflowTemplate :7360` | `WorkflowInstance.templateId` | keep |
| Submittal workflow templates | Company (library) | `:6897` | `SubmittalPackage` | keep |
| Custom field definitions / fieldsets | Company (library) / Company | `CustomFieldDefinition :7453`, `CustomFieldset :7485` | `ProjectFieldset :7507`, `CustomFieldValue` | keep; key namespace is org-wide (matrix §2) |
| Record type definitions | Company | `RecordTypeDefinition @@unique([orgId, tool, key]) :7524` | `Correspondence.recordTypeKey` (string) | keep |
| Report definitions | Company (library, viewer-scoped) | `ReportDefinition.projectId?` = "every project the viewer can see" `:7198-7211` | `ReportRun` | keep; viewer scope = the membership's project access |
| Webhooks, API clients, accounting connection | Company | `WebhookSubscription :7597`, `ApiClient :7572`, `AccountingConnection :7650` | project filter optional | keep; API client gains `membershipId` |
| Company equipment master | Company | `CompanyEquipment @@unique([orgId, name]) :5231` | `Equipment.companyEquipmentId` (project row) | keep |
| Workers (labour master) | Company | `Worker @@unique([orgId, employeeNumber]) :5665` | `CrewMember`, `TimeEntry` | keep |
| Inventory: items, warehouses, stock, transfers, counts | Company, project optional | `InventoryItem/Warehouse/StockTransaction.projectId?` "null = company-owned / central" `:3043, 3091, 3208`; `StockBalance/StockTransfer/InventoryCount` no project `:3163-3357`; 5 central warehouses | `StockTransaction.projectId/activityId/boqItemId` on issue | keep; inventory is a company module (`routes/inventory.js:24-64` org-wide) — project-bounded views are a later product decision |
| Unit-of-measure master (new, PC-1) | Company | — | `BoqItem.unitCode`, `ActivityProgressMethod`, `CommitmentSovLine` normalise against it | new; seeded per org with the canonical list |
| BOQ templates (new, PC-2) | Company (library) | — (the xlsx template is static today: `services/boq/template.js:7-14`) | `POST /projects/:id/boq/from-template` copies rows | new; a company can keep standard BOQ section structures |
| **Project BOQ** (items, revisions, sections) | Project | `BoqItem :1260`, `BoqRevision :1300` | — | project-owned; never shared |
| WBS (new, PC-1) | Project | `WbsNode` | `Activity.wbsNodeId`, `BoqItem.wbsNodeId` | project-owned; a company WBS *template* is a later option (not built) |
| Locations | Project | `Location :4604` (84 rows, 3 projects) | photos, punch, RFIs, … + activities/BOQ (PC-1) | project-owned |
| Schedule (activities, dependencies, revisions, baseline) | Project | `Activity :1452`, `ScheduleRevision :1724` | — | project-owned |
| BOQ ↔ activity mapping | Project | `ActivityBoqAllocation :1587` | — | project-owned |
| Progress, EV, reporting periods | Project | `ActivityProgress`, `EvPeriodSnapshot`, `ReportingPeriod` | — | project-owned; certified |
| Commitments, pay apps, direct costs, change events/orders, IPC | Project | `:4811-5230, 6153-6420, 1919-2226` | vendor from company directory | project-owned; certified |
| Documents, photos, drawings, sheets | Project | `ProjectDocument :1349`, `Attachment :5279`, storage key `orgs/{org}/projects/{project}/…` | — | project-owned |
| Conversations, inbound email | Company (library) | `Conversation.projectId?` `:5861`; `InboundEmail :5941` | linked record | keep |
| Notifications, preferences, push devices | Company / Identity / Identity | `Notification.orgId`, `NotificationPreference [userId, category]`, `PushSubscription.endpoint` | — | preferences and devices are identity-level (PO decision 6) |
| Assistant conversations | Company per identity | `AssistantConversation {orgId, userId, projectId?} :7909` | — | per workspace |
| Gantt layouts, RFI saved views, quick-action project | Identity per project (browser) | `localStorage` keys (`gantt-layouts.ts:183`, `rfi-saved-views.tsx:30`, `quick-actions.tsx:22`); `GanttLayout :7238` server-side per `(project, createdBy)` | — | keep |
| Reference counters | Company/Project (embedded in key) | `ReferenceCounter.scope` `orgId:…\|…`, `projectId:…\|…` `:8217`; `utils/reference-number.js:19-20` | — | keep; purge by prefix on delete |
| Background jobs, outbound events, audit | Company (attribution only, no FK) | `:6623, 6657, 830` | — | sweep for deleted tenants |
| Extra services config (VAT/OH/contingency) | **none** today | `:1444-1449`; read unfiltered `boq-calculation.service.js:5` | BOQ financial summary | becomes Company (`orgId`); project override is a later option |

## Lifecycle consequences

**Personal → company conversion.** Every row above already carries the personal workspace's `orgId`; conversion flips `Organisation.kind` and the plan. Nothing in this matrix moves, is copied, or is re-keyed. The 12 system permission templates and the UoM list are seeded at workspace creation for both kinds, so conversion has no seeding step either.

**Project archive** (`Project.archivedAt`, `:462`). Project-owned rows stay; company masters referenced by the project are untouched (Restrict on `CostCode`/`FormTemplate`). Reference counters keyed `projectId:` are left in place (numbering must not restart if un-archived).

**Moving a project between companies** is **not supported** by this programme: it would re-key `CostLedgerEntry.orgId` (idempotency key) and strand cost codes and vendor identities (project-controls-money stop condition). If ever required it is a copy-with-new-ids operation, not a re-key.

**Guests (§99).** A guest membership owns nothing at company level; its project access is exactly the party predicate. A guest cannot see the company directory, cost codes or inventory.

## Workspace project defaults (ENT-6, acceptance §16)

`Organisation.defaultCurrency` (ISO 4217, default `USD`) and `Organisation.defaultTimezone` (IANA zone, nullable) are what a new project of the workspace starts with when its creator names no currency or zone (`project.service.js createProject`). They are optional on sign-up and on `POST /organisations` (validated in `middleware/workspace-defaults.js`), returned in the organisation summary, and never rewrite an existing project: `Project.currency` and `Project.timezone` stay the values of record. A workspace that names no zone gives its projects none, which is what every project created before ENT-6 already has. Migration `20261005040000_organisation_defaults` is additive (a defaulted and a nullable column; no backfill).

## Billing recipient (ENT-6, acceptance §18)

Billing mail — the trial reminders (`jobs/billing-scheduler.js pmEmail`) and the cancellation email (`subscription.service.js orgEmail`) — goes to the workspace's **owner**: the earliest active owner membership's user, for personal and company workspaces alike. Both call sites ask one function, `membership.service.js findBillingRecipient`; a workspace with no owner row (seeded before the membership backfill) answers null there and the caller keeps its legacy pick, the earliest user with role `pm`.

**Extension point [D].** The billing model has no organisation-level contact today (`Organisation` and `Subscription` carry no billing e-mail), so the owner is only the default and billing must not stay tied to one person's permanent address. When an organisation billing contact is added — a column such as `Organisation.billingContactEmail` (or `Subscription.billingEmail`, or a `BillingContact` row) — it is read inside `findBillingRecipient`, first, and takes precedence over the owner. The resolution order is then:

1. the organisation's billing contact, when set;
2. the owner membership's user;
3. the legacy earliest `pm` (in the two callers, only when 1 and 2 give nothing).

No caller changes when the contact is added: `findBillingRecipient` is the single hook.

## Personal → company, as shipped (ENT-6)

The conversion described above is `POST /organisations/:id/convert` (owner only, the session's own workspace). What shipped differs in three names from the earlier design text, and the design documents are aligned to it:

- the audit event is `AuthAuditEvent` **`workspace.converted`** (metadata: from/to kind, plan, name, slug), alongside `workspace.created`;
- the refusal of a second member in a personal workspace is **`409 PERSONAL_WORKSPACE_CONVERT_REQUIRED`** (the code names the way out); it covers direct add, workspace, project and company-directory invitations (refused before an invitation is minted), invitation acceptance, SSO auto-provisioning (the identity and its seat are one transaction, so a refusal leaves no identity behind) and the membership backfill (which reports such a person as `held` and never seats them). The seat check is serialised on the organisation row (`SELECT … FOR NO KEY UPDATE` inside the seating transaction);
- the plan that changes is the label `Organisation.plan` (`individual` → `standard`); **`Subscription` is not touched**, so a conversion never re-prices billing — moving the subscription to a team plan stays the billing flow's decision.

The web app routes an invitation attempt in a personal workspace to the conversion: "+ Create → Invite people" opens the workspace settings, and a refused invite or add shows the conversion prompt instead of an error toast.
