# OctaPM tenant model matrix — all 239 models

Source: `backend/prisma/schema.prisma` at HEAD a19ea99 (`grep -c '^model '` = 239; no `@@map` except `SocketIoAttachment → socket_io_attachments`). Line numbers are the model header. Live counts are from the read-only probe of `octapm_verify` on 2026-09-26. Classifications: **P+O** = non-null `orgId` AND non-null `projectId`; **P** = `projectId` only (inherits org through `Project.orgId`); **P/parent** = no tenant column, resolves through a project-scoped parent; **O** = direct `orgId`, no project; **O?P** = `orgId` with nullable `projectId` ("null = company-wide"); **O/user** = `orgId` + `userId`; **O/parent** = resolves through an org-scoped parent; **SYS** = system-internal; **ROOT** = tenant root; **NONE** = no owner.

Target column codes: **CFK** = composite FK `(projectId, orgId) → Project(id, orgId)` (§36); **REL** = add the missing Prisma relation/FK; **+orgId** = add a direct `orgId` (§35); **inherit** = keep resolving through the project, no change; **keep** = no change; **sweep** = no FK, retention sweep for orphans; **MFK** = composite FK to an org master `(masterId, orgId) → Master(id, orgId)`.

---

## 1. Merged matrix

### 1.1 Identity, tenancy, access (schema lines 11-900)

| Model (line) | Class | Resolves via | Tenant-scoped uniques | Global uniques on customer ids | Target |
|---|---|---|---|---|---|
| Organisation (11) | ROOT | — | — | — | **+kind, +slug @unique, +createdByUserId** |
| User (157) | identity, O-bound | `orgId` non-null | — | **email @unique** (kept) | orgId/role/isCompanyAdmin → `OrganizationMembership`; columns nullable M8, dropped M9 |
| *OrganizationMembership (new)* | O/user | `orgId`+`userId` | `[orgId, userId]` | — | new (membership doc §1) |
| UserSetting (307) | O/user | orgId + userId @unique | userId @unique | — | keep per identity; `orgId` becomes informational (drop in M9) |
| Company (336) | O | orgId | `[orgId, name]` | — | keep; `+linkedOrgId?` reserved (§99) |
| CompanyMembership (405) | O | orgId (dup of Company.orgId) | `[companyId, userId]` | — | keep as directory link; **not** the tenant membership |
| Project (427) | O | orgId | — | inboundEmailToken (system) | **+@@unique([id, orgId])** |
| ProjectParty (637) | P | projectId | `[projectId, companyId, role]` | — | inherit; MFK `(companyId, orgId)` deferred (no orgId column) — service check `company-party.service.js:385` stays |
| ProjectPartyMember (676) | P/parent | party→project | `[projectPartyId, userId]` | — | inherit; user must hold a `guest` or `member` membership (service check, ENT-2) |
| ProjectAssignment (698) | P | projectId | `[projectId, userId]` | — | **+orgId, CFK, + FK (orgId,userId)→OrganizationMembership** |
| RefreshSession (711) | O/user | orgId + userId | — | tokenHash (system) | **+membershipId** |
| PasswordResetToken (734) | O/user | orgId + userId | — | tokenHash (system) | keep; orgId informational |
| InvitationToken (759) | O?P | orgId; project/company/party nullable | — | tokenHash (system) | keep; CFK where projectId set; acceptance creates a membership |
| AuthAuditEvent (800) | SYS/O? | orgId nullable, SetNull | — | — | keep (pre-login rows are unowned by design); `+membershipId?` |
| AuditEvent (830) | O?P, no FK | bare orgId | — | — | **sweep** (7,335 orphan rows); no FK |
| RecordHistorySnapshot (860) | O?P, no FK | bare orgId | auditEventId @unique | — | sweep with AuditEvent |
| ActivityAssignment (889) | P/parent | activity→project | `[activityId, userId]` | — | inherit |

### 1.2 Collaboration and documents (900-1450)

| Model (line) | Class | Resolves via | Tenant-scoped uniques | Global | Target |
|---|---|---|---|---|---|
| Task (904) | P+O | both | `[projectId, taskNumber]` | — | CFK |
| TaskComment (949) / TaskAttachment (970) / TaskHistory (995) | P+O | both | — | — | CFK |
| Meeting (1021) | P+O | both | `[projectId, meetingNumber]` | — | CFK |
| MeetingAttendee (1073), MeetingAgendaItem (1107), MeetingDecision (1134), MeetingActionItem (1162, `[meetingId,itemNumber]`), MeetingDistribution (1198), MeetingComment (1235) | P+O | both | as noted | — | CFK |
| BoqItem (1260) | P | projectId | `[projectId, activeCodeKey]` | — | inherit (+wbsNodeId, locationId, costCodeId, unitCode, mappingRule — PC-1/PC-3) |
| BoqRevision (1300) | P | projectId | `[projectId, revisionNumber]` | — | inherit |
| BoqItemCodeIntegrityReport (1335) | P, no FK | projectId column | — | — | **REL** to Project |
| ProjectDocument (1349) | P+O | both | — | storageKey (system) | CFK |
| BoqActivity (1412) | P | projectId | `[projectId, activityCode]` | — | inherit; dead table (0 rows, no writers) — drop only after production count verified (PC-3) |
| ExtraServicesConfig (1444) | **NONE** | — | — | — | **+orgId non-null, @@unique([orgId, label])**; service reads `where {orgId}` (0 rows, no backfill) |

### 1.3 Schedule, cost, commercial (1452-2700)

| Model (line) | Class | Resolves via | Uniques | Global | Target |
|---|---|---|---|---|---|
| Activity (1452) | P | projectId | — (activityCode/p6ActivityId/wbsCode indexed) | — | inherit (+wbsNodeId, locationId — PC-1) |
| ActivityDependency (1561) | P | projectId | `[projectId, pred, succ]` | — | inherit |
| ActivityBoqAllocation (1587) | P | projectId | partial unique active pair (raw SQL, migration 20260608170000 l.44) | — | inherit (+locationId, unitCode, suggestion fields — PC-3) |
| ActivityProgress (1629) | P/parent | activity→project | submissionId @unique | — | inherit |
| ActivityProgressMethod (1660) | P | projectId | activityId @unique | — | inherit |
| ProgressSubmission (1683) | P | projectId | — | — | inherit (+locationId — PC-5) |
| ScheduleRevision (1724) | P | projectId | — | — | inherit |
| WeeklyReport (1769) | P | projectId | `[projectId, ref]` | — | inherit |
| CostRecord (1798) | P | projectId | `[projectId, activityId]` | — | inherit (certified projection table — untouched) |
| ReportingPeriod (1828) | P | projectId | `[projectId, code]` | — | inherit |
| ActivityCostLoading (1854) | P | projectId | — | — | inherit |
| EvPeriodSnapshot (1887) | P | projectId | reportingPeriodId @unique | — | inherit |
| ChangeOrder (1919) | P | projectId | `[projectId, ref]` from PC-7b migration 20261005060100 (unapplied; dry run 0 duplicate groups) | — | inherit; +`locationId?` → Location, `wbsNodeId?` → WbsNode SET NULL (PC-7b 20261005060000) |
| ChangeOrderActivityLink (1963) | P | projectId | `[co, activity, relationType]` | — | inherit |
| ChangeOrderAllocationLink (1996) | P | projectId | `[co, allocationId]` (nullable) | — | inherit |
| IpcItem (2020) | P | projectId | none | — | inherit |
| IpcItemProgressLink (2053) | P | projectId | `[ipcItemId, progressId]` | — | inherit |
| IpcCertificate (2082) | P | projectId | `[projectId, period]` | — | inherit |
| IpcInvoice (2134) | P | projectId | `[projectId, invoiceNumber]`; ipcCertificateId @unique | — | inherit |
| IpcPayment (2166) | P | projectId | `[projectId, paymentReference]` | — | inherit |
| IpcRetentionRelease (2192) | P | projectId | `[projectId, releaseReference]` | — | inherit |
| PrimeContract (2228) | P+O | both; projectId @unique | `[orgId, ref]` | — | CFK; clientCompanyId MFK deferred |
| PrimeContractAdvance (2280) | P+O | both | `[projectId, reference]` | — | CFK |
| Risk (2304) | P | projectId | `[projectId, ref]` from PC-7b migration 20261005060100 (unapplied; dry run 0 duplicate groups) | — | inherit |
| RiskActivityLink (2366) | P | projectId | `[risk, activity, relationType]` | — | inherit |
| LongLeadItem (2389), BurnRateEntry (2427) | P | projectId | — | — | inherit |
| SubValuation (2447) | P (retired) | projectId | `[projectId, ref]` | — | inherit; 0 rows |
| SubValuationActivityLink (2478), SubValuationAllocationLink (2500) | P | projectId | as noted | — | inherit |
| BudgetRevision (2526) | P | projectId | `[projectId, ref]` | — | inherit |
| CashFlowEntry (2551) | P | projectId | — | — | inherit |
| EotClaim (2567) | P | projectId | `[projectId, ref]` | — | inherit |
| EotClaimActivityLink (2604), EotClaimWeatherDelayLink (2637) | P | projectId | as noted | — | inherit |
| WeatherDelay (2659), WeatherDelayActivityLink (2678) | P | projectId | — / `[wd, activity]` | — | inherit |

### 1.4 Procurement, inventory, equipment, quality, document control (2702-4200)

| Model (line) | Class | Resolves via | Uniques | Global | Target |
|---|---|---|---|---|---|
| ProcurementSupplier (2702) | P | projectId | `[projectId, name]` (code NOT unique) | — | inherit; companyId MFK deferred |
| ProcurementPackage (2738) | P | projectId | `[projectId, packageNumber]` | — | inherit |
| ProcurementOrder (2781) | P | projectId | — (ref NOT unique; 2 live duplicate groups, 4 rows — owner's stop, OCTAPM_CHANGE_INTELLIGENCE.md "PC-7b migrations") | — | inherit |
| ProcurementPoLine (2866) | P | projectId | `[orderId, lineNumber]` | — | inherit |
| DeliveryReceipt (2936) | P | projectId | `[projectId, receiptNumber]` | — | inherit |
| DeliveryReceiptLine (2970) | P | projectId | — | — | inherit |
| MaterialMaster (3003) | P | projectId | — (code indexed) | — | inherit |
| InventoryItem (3040) | O?P | orgId; projectId nullable ("company-owned") | `[orgId, sku]`, `[orgId, barcode]` | — | CFK (MATCH SIMPLE) |
| Warehouse (3088) | O?P | orgId; projectId nullable ("central") | `[orgId, code]` | — | CFK (MATCH SIMPLE) |
| WarehouseLocation (3125) | O | orgId + warehouseId | `[warehouseId, code]` | — | keep |
| StockBalance (3163) | O | orgId | `[itemId, warehouseId, locationId]` (nullable locationId) | — | keep; nullable-in-unique noted (§2) |
| StockTransaction (3193) | O?P | orgId; projectId nullable | — | — | CFK (MATCH SIMPLE) |
| StockTransfer (3254) | O | orgId | `[orgId, ref]` | — | keep |
| StockTransferLine (3286) | O | orgId | — | — | keep |
| InventoryCount (3309) | O | orgId | `[orgId, ref]` | — | keep |
| InventoryCountLine (3334) | O | orgId | `[countId, itemId, locationId]` (nullable) | — | keep |
| Equipment (3360) | P | projectId | — | — | inherit |
| ActivityEquipment (3378) | P/parent | activity→project | `[activityId, equipmentId]` | — | inherit |
| ActivityEquipmentUsage (3391) | P | projectId | `[dailyReportId, sourceLineIndex]` | — | inherit |
| ActivityMaterial (3426), ActivityMaterialUsage (3476) | P | projectId | — | — | inherit |
| ProcurementLeadTimeAlert (3508) | P | projectId | three `[projectId, x]` | — | inherit |
| ResourceAllocation (3549) | P | projectId | — | — | inherit |
| NcrRecord (3570) | P | projectId | `[projectId, ref]` from PC-7b migration 20261005060100 (unapplied; dry run 0 duplicate groups) | — | inherit |
| ItpRecord (3620), DefectRecord (3663), SafetyIncident (3709), MaterialTest (3767) | P | projectId | `[projectId, ref]` | — | inherit |
| Rfi (3813) | P | projectId | `[projectId, ref]` | — | inherit; `changeOrderId` becomes FK → ChangeOrder SET NULL (PC-7b 20261005060000; census 10/10 same-project) |
| RfiAssignee (3899) | P/parent | rfi→project | `[rfiId, userId, role]` | — | inherit |
| RfiResponse (3917) | P+O, **no FK to either** | bare orgId + bare projectId | — | — | **REL + CFK** |
| Submittal (3936) | P | projectId | `[projectId, ref]` | — | inherit |
| DrawingRecord (4016) | P | projectId | `[projectId, ref]` (drawingNumber not unique) | — | inherit |
| WorkflowAttachment (4062), WorkflowStatusHistory (4084) | P | projectId | — | — | inherit |
| ApprovalWorkflowEvent (4102) | P+O, orgId no FK | bare orgId + projectId FK | — | — | **REL (org) + CFK** |
| Notification (4130) | O?P | orgId + recipientUserId | — | dedupeKey (system, [I]) | CFK (MATCH SIMPLE); `+membershipId?` |
| NotificationPreference (4170) | O/user | orgId + userId | `[userId, category]` | — | keep per identity (PO question 6) |
| PushSubscription (4194) | O/user | orgId + userId | — | **endpoint @unique** (device URL) | keep endpoint unique; `orgId` becomes informational — device belongs to the identity |

### 1.5 Second half (4215-8272)

| Model (line) | Class | Resolves via | Uniques | Global | Target |
|---|---|---|---|---|---|
| NotificationDeliveryAttempt (4215) | O/user, no relation | orgId column; notificationId | — | — | REL (org) |
| WorkflowActivityLink (4240) | P | projectId | `[recordType, recordId, activityId, relationType]` | — | inherit |
| DocumentRevision (4261) | P | projectId | `[recordType, recordId, revision]` | — | inherit |
| Transmittal (4306), Correspondence (4350) | P | projectId | `[projectId, ref]` | — | inherit |
| CommercialCorrespondenceLink (4399), CommercialAttachmentRef (4419) | P | projectId | uuid-keyed / — | — | inherit |
| DailyReport (4445), SiteDiary (4489) | P | projectId | `[projectId, clientRequestId]` | — | inherit |
| Subscription (4530) | O | orgId @unique | orgId @unique | — | keep; plan drives personal/company |
| PaymentMethod (4559), Invoice (4575) | O/parent | subscription | — | — | keep |
| EnterpriseLead (4591) | O | orgId | — | — | keep |
| Location (4604) | P+O | both | `[projectId, code]` | — | CFK |
| CostCode (4649) | O | orgId | `[orgId, code]` | — | keep; **+@@unique([id, orgId])** to allow MFK |
| ProjectCostCode (4683) | P+O | both | `[projectId, costCodeId]` | — | CFK + MFK (costCodeId, orgId) |
| BudgetLine (4707) | P+O | both | `[projectId, costCodeId, costType]` | — | CFK + MFK (certified table: constraint only, no data change) |
| BudgetLineChange (4744) | P+O | both | — | — | CFK |
| BudgetLineActivityAllocation (4768) | P | projectId | `[budgetLineId, activityId]` | — | inherit |
| BudgetSnapshot (4788) | P+O | both | reportingPeriodId @unique | — | CFK |
| Commitment (4811) | P+O | both | `[projectId, ref]`, `[projectId, type, number]` | — | CFK; vendorCompanyId MFK |
| CommitmentSovLine (4872) | P+O | both | `[commitmentId, lineNumber]` | — | CFK + MFK (costCodeId) |
| CommitmentChangeOrder (4911) | P+O | both | `[commitmentId, number]`, `[projectId, ref]` | — | CFK |
| ScopeMatrix (4962), ScopeMatrixItem (4995) | P+O | both | commitmentId/bidPackageId @unique / — | — | CFK |
| SubcontractCloseout (5035), CloseoutItem (5065) | P+O | both | commitmentId @unique / `[closeoutId, key]` | — | CFK |
| SubPayApp (5098) | P+O | both | `[commitmentId, number]`, `[projectId, ref]` | — | CFK |
| SubPayAppLine (5173), SubPayAppPayment (5209) | P+O | both | `[payAppId, sovLineId]` / — | — | CFK |
| CompanyEquipment (5231) | O | orgId | `[orgId, name]` | — | keep |
| ProjectTemplate (5252) | O | orgId | `[orgId, name]` | — | keep |
| Attachment (5279) | P+O | both | `[recordType, recordId, documentId]` | — | CFK |
| Photo (5307) | P+O | both | documentId @unique | — | CFK |
| DrawingSet (5344), Sheet (5379), SheetRevision (5415) | P+O | both | `[projectId, setNumber]`, `[projectId, number]`, `[setId, pageNumber]` | — | CFK |
| PunchItem (5463) | P+O | both | `[projectId, ref]`, `[projectId, kind, number]`, `[projectId, clientRequestId]` | legacyDefectId (migrated id) | CFK |
| PunchItemEvent (5534), Markup (5558), Pin (5582), SheetReference (5609), SpecSection (5635) | P+O | both | as noted | — | CFK |
| Worker (5665) | O | orgId (+companyId, userId?) | `[orgId, employeeNumber]` | — | keep; `userId` → membership check in service |
| Crew (5695) | P+O | both | `[projectId, name]` | — | CFK |
| CrewMember (5722) | P/parent | crew; worker | `[crewId, workerId]` | — | inherit; service asserts worker.orgId = crew.orgId |
| BimModel (5741), BimElement (5786), BimElementLink (5833) | P+O | both | as noted | — | CFK |
| Conversation (5861) | O?P | orgId; projectId nullable | `[orgId, directKey]` | — | CFK (MATCH SIMPLE) |
| ConversationMember (5892), ConversationMessage (5913) | O/parent | orgId + conversationId | `[conversationId, userId]` / — | — | keep |
| InboundEmail (5941) | O?P | orgId; projectId nullable | `[orgId, provider, messageId]` | — | CFK (MATCH SIMPLE) |
| Lookahead (5987), LookaheadItem (6023) | P+O | both | `[projectId, number]`, `[projectId, ref]` / — | — | CFK |
| Timesheet (6074), TimeEntry (6114) | P+O | both | `[projectId, clientRequestId]` / — | — | CFK; TimeEntry MFK (costCodeId) |
| ChangeEvent (6153), ChangeEventLine (6197) | P+O | both | `[projectId, number]`, `[projectId, ref]` / — | — | CFK; ChangeEventLine MFK; +typed source FKs rfi / dailyLog / ncr / punchItem / drawingRevision / submittal / meetingActionItem / exception, SET NULL (PC-7b 20261005060000, unapplied) |
| Rfq (6233) | P+O | both | `[changeEventId, number]`, `[projectId, ref]` | tokenHash (public portal, by design) | CFK |
| SsoTicket (6289) | O/user | orgId + userId | — | tokenHash | `+membershipId` |
| DirectCost (6308), DirectCostLine (6361), DirectCostPayment (6399) | P+O | both | `[projectId, number]`, `[projectId, ref]` / — / — | — | CFK; DirectCostLine MFK |
| DocumentText (6422), DocumentChunk (6454) | P+O | both | documentId @unique / `[documentId, index]` | — | CFK |
| Comment (6479) | P+O | both | — | — | CFK |
| CommentMention (6507) | O/parent | orgId + commentId | `[commentId, userId]` | — | keep |
| RecordSubscription (6523) | P+O | both + userId | `[recordType, recordId, userId]` | — | CFK |
| PermissionTemplate (6546) | O | orgId | `[orgId, name]` | — | keep; `+@@unique([id, orgId])` |
| PermissionTemplateTool (6574), PermissionTemplateGrant (6586) | O/parent | templateId | as noted | — | keep |
| ProjectUserPermission (6600) | P+O | both + userId | `[projectId, userId]` | — | CFK + FK (orgId,userId)→membership + MFK (templateId) |
| BackgroundJob (6623) | SYS (tenant ids, no FK) | orgId required | — | — | **sweep**; `+membershipId?`; no FK |
| OutboundEvent (6657) | SYS (tenant ids, no FK) | orgId | — | — | **sweep**; no FK |
| FormTemplate (6683) | O?P | orgId; projectId nullable | — | — | CFK (MATCH SIMPLE); `+@@unique([id, orgId])` |
| FormSection (6711), FormItem (6724) | O/parent | templateId | — | — | keep |
| FormInstance (6750) | P+O | both | `[projectId, ref]`, `[projectId, clientRequestId]` | legacyItpId | CFK + MFK (templateId) |
| FormItemResponse (6816) | P/parent | instanceId | `[instanceId, itemId]` | — | inherit |
| Signature (6839) | P+O columns, no relation | — | — | — | **REL + CFK** |
| SubmittalPackage (6867) | P+O | both | `[projectId, ref]` | — | CFK |
| SubmittalWorkflowTemplate (6897) | O?P | orgId; projectId nullable | — | — | CFK (MATCH SIMPLE) |
| SubmittalStep (6918), SubmittalStepAssignment (6940) | P/parent | submittal | — / `[stepId, userId]` | — | inherit |
| DailyLog (6965) | P+O | both | `[projectId, date]` | — | CFK |
| DailyLogManpower (7003), DailyLogEquipment (7037), DailyLogDelivery (7071), DailyLogVisitor (7105), DailyLogDelay (7135), DailyLogNote (7168) | P+O columns, no relation | dailyLogId only | `[projectId, clientRequestId]` | — | **REL + CFK** (+ DailyLogQuantity new, PC-5) |
| ProjectException (PC-7b, migration 20261005060000, unapplied) | P+O | both, with relations | open-row partial unique `(projectId, kind, subjectType, subjectId, COALESCE(secondary…, ''))` WHERE resolvedAt IS NULL (raw SQL) | — | CFK from birth: `(projectId, orgId) → Project(id, orgId)` CASCADE, `orgId → Organisation` CASCADE, MFK `(costCodeId, orgId) → CostCode` SET NULL (costCodeId); wbsNode / location / changeEvent SET NULL — OCTAPM_CHANGE_INTELLIGENCE.md §1 |
| DailyLogQuantity, QuantityProgressEntry (PC-6, migration 20261005050000, unapplied) | P+O | both, with relations | `[projectId, clientRequestId]` | — | CFK from birth: `(projectId, orgId) → Project(id, orgId)` CASCADE, `orgId → Organisation` CASCADE; activity / boqItem RESTRICT, the rest SET NULL — OCTAPM_PROGRESS_MEASUREMENT.md §3-§4 |
| ReportDefinition (7198) | O?P | orgId; projectId nullable (= every project the viewer can see) | — | — | CFK (MATCH SIMPLE); viewer scope re-evaluated per membership |
| GanttLayout (7238) | P+O | both | `[projectId, createdBy, name]` | — | CFK |
| ReportSchedule (7260), ReportRun (7290) | O/parent | orgId + reportId | — | — | keep |
| ProjectHealthSnapshot (7320) | P+O | both | projectId @unique | — | CFK |
| WorkflowTemplate (7360) | O?P | orgId; projectId nullable | — | — | CFK (MATCH SIMPLE) |
| WorkflowInstance (7389), WorkflowStepAssignment (7425) | P+O | both | — | — | CFK |
| CustomFieldDefinition (7453) | O?P | orgId; projectId nullable | `[orgId, recordType, key]` | — | CFK (MATCH SIMPLE); key namespace issue noted (§2) |
| CustomFieldset (7485) | O | orgId | — | — | keep; `+@@unique([id, orgId])` |
| ProjectFieldset (7507) | P+O | both | `[projectId, recordType]` | — | CFK + MFK (fieldsetId) |
| RecordTypeDefinition (7524) | O | orgId | `[orgId, tool, key]` | — | keep |
| CustomFieldValue (7548) | P+O | both | `[recordId, fieldId]` | — | CFK |
| ApiClient (7572) | O/user | orgId + userId | — | keyHash | `+membershipId` |
| WebhookSubscription (7597) | O?P | orgId; projectId nullable | — | — | CFK (MATCH SIMPLE); `secret` encryption to verify (ENT-3) |
| WebhookDelivery (7623) | O/parent | orgId + subscriptionId | — | — | keep |
| AccountingConnection (7650), AccountingCodeMapping (7671) | O | orgId | `[orgId, provider]`, `[orgId, provider, costCode]` | — | keep |
| AccountingSync (7687) | P+O | both | `[provider, recordType, recordId]` | — | CFK |
| BidPackage (7719) | P+O | both | `[projectId, ref]` | — | CFK |
| BidPackageLine (7769), BidAddendum (7794), BidInvitation (7810, `[packageId, contactEmail]`, tokenHash public), BidQuestion (7838), Bid (7860, invitationId @unique), BidLine (7889, `[bidId, packageLineId]`) | P/parent, orgId column no relation | packageId | as noted | — | **REL** (org) |
| AssistantConversation (7909) | O/user (project optional) | orgId + userId | — | — | CFK (MATCH SIMPLE) |
| AssistantMessage (7933) | O/parent, orgId no relation | conversationId | — | — | REL |
| ContractProfile (7960) | P+O | both | projectId @unique | — | CFK |
| VendorPrequalification (7999) | O | orgId + companyId | companyId @unique | — | keep |
| PrequalCriterion (8032) | O/parent, orgId no relation | prequalId | `[prequalId, key]` | — | REL |
| SubcontractorEvaluation (8069) | P+O | both | commitmentId @unique | — | CFK |
| EvaluationCriterion (8104) | O/parent, orgId no relation | evaluationId | `[evaluationId, key]` | — | REL |
| CostLedgerEntry (8144) | P+O | both | **`[orgId, sourceKey]`** (certified) | — | CFK only; nothing else touched |
| ReferenceCounter (8217) | SYS (tenant in key) | `scope` string | scope @id | — | keep; purge rule by scope prefix on org/project delete (ENT-3) |
| SocketIoAttachment (8236) | SYS by design | — | id | — | keep |
| AuthThrottle (8249) | SYS by design | — | `[scope, key]` (email/IP) | — | keep |
| RateLimitBucket (8266) | SYS by design | — | key @id | — | keep |

Tally (239): ROOT 1 · identity 1 · O 24 · O?P 18 · O/user 9 · O/parent 20 · P+O 82 (incl. 14 relation-less) · P 71 · P/parent 15 · SYS 6 · NONE 1 · new 1 (not counted).

---

## 2. Tenant-scoped uniqueness audit (§37)

**Rule [D]:** every customer-visible number, reference or code is unique within its owner scope — `projectId` for project records, `orgId` for org masters — never globally. Global uniques are allowed only for system secrets (hashed tokens, storage keys, device endpoints) and for `User.email`.

| Finding | Evidence | Action |
|---|---|---|
| All existing uniques on refs/codes are scoped by projectId or orgId | schema `@@unique` lines in §1 | none |
| Only global unique on a customer identifier: `User.email` | `:161` | keep (identity is global) |
| `PushSubscription.endpoint @unique` binds a device to one `orgId` | `:4198`; `push.service.js:120-124` | keep unique; drop the org meaning (fan-out per identity) |
| `PrimeContract @@unique([orgId, ref])` — unique per org, not per project | `:2268` | keep (a contract ref is a company-level reference) |
| Refs with NO uniqueness: `Activity.activityCode/p6ActivityId/wbsCode`, `ChangeOrder.ref`, `Risk.ref`, `NcrRecord.ref`, `ProcurementOrder.ref`, `ProcurementSupplier.code`, `MaterialMaster.code`, `DrawingRecord.drawingNumber`, `IpcItem` | `:1556-1558, 1925, 2307, 3574, 2788, 2706, 3026, 4021, 2020` | Add `@@unique([projectId, ref])` for ChangeOrder, Risk, NcrRecord, ProcurementOrder after a dedupe dry-run (PC-7 / ENT-3) — PC-7b: ChangeOrder, Risk, NcrRecord in 20261005060100 (0 duplicates); ProcurementOrder held back (2 live duplicate groups, owner); Activity codes stay non-unique (P6 allows duplicates across revisions) but `WbsNode` gets `[projectId, code]` |
| `ActivityBoqAllocation` active-pair uniqueness only in raw SQL | migration 20260608170000 l.44 | keep (Prisma cannot express partial uniques); document in PC-3 |
| Polymorphic uniques keyed on record uuids, not projectId (`DocumentRevision`, `WorkflowActivityLink`, `Attachment`, `RecordSubscription`, `CustomFieldValue`, `AccountingSync`, `BimElementLink`) | `:4296, 4255, 5299, 6539, 7564, 7712, 5851` | keep — uuids make them safe; CFK guarantees the row's org |
| `CustomFieldDefinition @@unique([orgId, recordType, key])` — project-level fields share the org namespace | `:7480` | change to `[orgId, projectId, recordType, key]` with `projectId` defaulting to `''` sentinel? **No** — keep as is and document; a project field key collision is a product limitation, not a tenancy bug |
| `StockBalance` / `InventoryCountLine` uniques include nullable `locationId` (NULLs distinct) | `:3168, 3339` | replace with partial unique indexes (`WHERE "locationId" IS NULL`) in ENT-3, raw SQL like the allocation index |
| `ExtraServicesConfig` has no scope at all | `:1444-1449` | `@@unique([orgId, label])` |
| `Organisation.name` not unique (13 duplicates locally) | `:11-14` | do not make it unique; add `slug @unique` |
| `ReferenceCounter.scope` embeds the tenant uuid | `:8217`; `utils/reference-number.js:19-20` | keep; already tenant-keyed |

Cross-tenant collision test (§37, part of the §53 matrix): create the same `ref`/`code`/`taskNumber`/`sku`/`sourceKey` in two organisations and in two projects of one organisation; every insert must succeed; the same value twice in one scope must fail with the existing 409 codes.

---

## 3. Direct orgId vs inherited (§35) — list with reasons

### 3.1 Must carry a direct `orgId` (already do, or are added)

| Table | Reason (rule from architecture doc §5) |
|---|---|
| OrganizationMembership (new), ProjectAssignment (**added**), ProjectUserPermission, ApiClient, RefreshSession, SsoTicket | rule 3: access/membership rows must be checkable without loading a project |
| All 24 org masters and O?P tables (CostCode, Company, Worker, PermissionTemplate, FormTemplate, WorkflowTemplate, CustomFieldDefinition, ReportDefinition, WebhookSubscription, Conversation, InboundEmail, AssistantConversation, InventoryItem, Warehouse, StockTransaction, …) | rule 1: can exist without a project |
| Task, Notification, DocumentText/DocumentChunk, Comment, RecordSubscription, CostLedgerEntry, AuditEvent, RecordHistorySnapshot | rule 2: queried org-wide (task list, notification centre, global search, ledger idempotency, audit) |
| Attachment, WorkflowInstance, ApprovalWorkflowEvent, CustomFieldValue, Signature, Pin, BimElementLink | rule 4: polymorphic subject |
| The remaining 60-odd P+O tables (Location, BudgetLine, Commitment, SubPayApp, DailyLog, PunchItem, Sheet, …) | already carry it; keeping it costs nothing and CFK makes it trustworthy. No table loses its `orgId`. |
| ExtraServicesConfig (**added**) | rule 1 and it is currently unowned |

### 3.2 Inherit through `Project.orgId` (no `orgId` added)

All 71 P and 15 P/parent tables: the BOQ/schedule/cost/commercial/procurement/quality/document-control core plus their children. Reasons: (a) none is reachable except through a project-nested route or a service that has already resolved `{ id: projectId, orgId }`; (b) the id-only lookup audit found 0 cross-tenant reads among them; (c) several are certified financial tables (`CostRecord`, `ChangeOrder`, `IpcCertificate`, `IpcItem`, `BudgetRevision`) whose rows must not be rewritten; (d) an `orgId` there would be a second place for the same fact with no constraint value that the project-side CFK does not already give the P+O tables. **Exception granted:** `ProjectAssignment` (rule 3).

### 3.3 Never get an FK on the org side

`BackgroundJob`, `OutboundEvent`, `AuditEvent`, `RecordHistorySnapshot`, `AuthAuditEvent` (nullable by design): orphan rows of deleted tenants exist (431 / 7,205 / 7,335) [C]; handled by the retention sweep with a dry-run and counts (wave plan ENT-3).
