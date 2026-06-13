# Construction Industry Readiness

## Industry-Readiness Score
- Controlled internal testing readiness: 7/10.
- Public industry launch readiness today: 4/10.

The platform fits the construction management domain better than a generic task tracker. Its strongest design decision is the activity-linked model: schedule, progress, cost, commercial, quality, and site data are built around project and activity context. However, real construction use requires contractual reliability. Failed RFI/submittal/risk tests, unverified staging UAT, and incomplete release evidence make the current build unsuitable as a live source of truth.

## Role Fit
- Contractors: Strong potential because schedule, BOQ, procurement, cost, commercial, progress, QA/QC, safety, and reporting modules exist. Not ready until test and deployment gates are green.
- Consultants: Partially ready. RFI/submittal review workflows exist but party-scoped access is currently a critical blocker.
- Owners/clients: Partially ready for dashboards and reports; not ready for contractual reliance without verified audit trails, approvals, and financial visibility rules.
- Subcontractors: Partially ready. External party access is modeled, but party workflow regression blocks safe onboarding.
- Project managers: Strong conceptual fit, but current release cannot be trusted until backend/frontend gates pass.
- Site engineers: Site reporting, daily reports, photos, safety, and progress modules exist. Mobile/tablet and field UAT evidence is missing.
- Document controllers: Document control, revisions, RFIs, submittals, drawings, and audit concepts exist. Full document-control UAT and file-access tests are still required.
- Commercial/finance teams: Cost, change orders, IPC, retention, cash flow, and sub-valuations exist. Financial role visibility and approval audit need staging verification.

| Industry Need | Current Support | Evidence | Gap | Risk | Recommendation |
|---|---|---|---|---|---|
| Activity-linked project controls | Mostly Ready | Activity model at backend/prisma/schema.prisma:1094; project module routes in backend/src/routes/projects.js:274-305 | Live UAT and formula verification incomplete | Incorrect EV/schedule decisions | Verify CPM, EV, progress, and cost formulas in UAT. |
| Contractual RFI workflow | Broken | backend/src/services/rfi.service.js:375 calls assertPartyWorkflowAccess; helper assumes non-null projectAccess at company-party.service.js:665 | Backend tests fail | Contractual correspondence disruption | Complete TASK-P0-BE-001 before external users. |
| Submittal workflow | Broken | backend/src/services/submittal.service.js:406, 620, 744, 792 | Same party-scope regression | Consultant/subcontractor review blocked | Complete TASK-P0-BE-001 and run consultant UAT. |
| Risk closeout | Broken | backend/src/services/risk.service.js:861-878 | Submitted closeout approval regression | Risk status unreliable | Complete TASK-P0-BE-002. |
| Document versioning and drawing revisions | Mostly Ready | ProjectDocument at schema.prisma:1004; DocumentRevision at schema.prisma:3101 | Full document UAT not verified | Superseded document confusion | Run document controller UAT. |
| Financial controls | Mostly Ready | ChangeOrder at schema.prisma:1545; IPC route at backend/src/routes/projects.js:334 | Financial visibility and formulas not live-verified | Payment/cost reporting errors | Run commercial/finance UAT and audit tests. |
| Daily site records | Mostly Ready | DailyReport at schema.prisma:3248; site reporting module in project-detail.tsx:362 | Mobile/photo/signoff evidence missing | Field adoption risk | Complete TASK-P2-UX-001. |
| QA/QC and safety | Mostly Ready | NcrRecord at schema.prisma:2656; SafetyIncident at schema.prisma:2741 | Closure workflow UAT missing | Quality/safety traceability gaps | Run QA/QC and safety UAT. |
| Notifications | Partially Ready | email.service.js:65-66 local fallback; notification.service.js exists | Production delivery Cannot Verify | Missed approvals and deadlines | Complete TASK-P1-NOTIF-001. |
| Auditability | Mostly Ready | AuditEvent at schema.prisma:491 | Completeness not proven in staging | Dispute and claims risk | Verify all contractual status changes emit audit events. |
