# Onboarding Checklist

Task: `TASK-P2-DOC-001`

Audience: implementation team, PMcopilots admins, QA, support, and pilot customer champions.

## Phase 0: Internal Readiness

- [ ] Confirm the release candidate commit and environment.
- [ ] Confirm backend tests, frontend lint/build, Prisma validate, OpenAPI validate, and deployment smoke results are attached.
- [ ] Confirm known limitations are accepted for the target customer/pilot.
- [ ] Confirm support contacts, escalation owners, and incident process.
- [ ] Confirm data import scope and rollback/offboarding plan.
- [ ] Confirm no customer files or secrets are committed to git.

## Phase 1: Customer Discovery

- [ ] Identify customer champion, PM owner, planning owner, QS/commercial owner, finance owner, procurement owner, site owner, and support contact.
- [ ] Confirm pilot project, contract type, reporting cadence, data date, work calendar, retention rule, and baseline/revised completion dates.
- [ ] Confirm source systems: Primavera P6, MSP, Excel BOQ, document register, procurement sheets, cost trackers.
- [ ] Confirm whether the pilot is demo/training, parallel run, or approved source-of-truth rollout.
- [ ] Confirm unsupported scope is understood: BIM/4D, ERP integration, portfolio rollup, two-way P6 sync, and standalone mobile app UI.

## Phase 2: Tenant And Project Setup

- [ ] Create tenant/organization.
- [ ] Create first PM/admin user.
- [ ] Configure security, CORS, storage, notification, billing, and support settings for the environment.
- [ ] Create pilot project and required contract metadata.
- [ ] Add internal users with least-privilege roles.
- [ ] Add project assignments for non-PM users.
- [ ] Add project companies and party memberships for external users.
- [ ] Confirm project access negative tests with at least one unassigned user.

## Phase 3: Data Load

- [ ] Upload representative BOQ workbook and resolve validation issues.
- [ ] Confirm BOQ chunking when more than 60 items are present.
- [ ] Import or generate schedule and review Activity IDs, WBS, calendars, data date, dependencies, and critical path.
- [ ] Link BOQ items to activities through approved allocations.
- [ ] Configure progress methods and assigned users for field progress.
- [ ] Load procurement packages, suppliers, purchase orders, and long-lead items where applicable.
- [ ] Load document-control folders/categories and sample revisions.
- [ ] Load starting cost/actual data and reporting period settings.

## Phase 4: Role Training

- [ ] PM: approvals, baseline, readiness, dashboard, risk acceptance, audit history.
- [ ] Planning Engineer: schedule import/generation, revisions, CPM, data date, progress coordination.
- [ ] QS: BOQ validation, allocations, progress review, IPC drafting.
- [ ] Cost Controller: cost records, actual-through dates, variances, exports.
- [ ] Procurement: suppliers, packages, POs, long-lead alerts.
- [ ] Warehouse: receipts, material usage, delivery evidence.
- [ ] Site Engineer: assigned progress, daily reports, RFIs, NCRs, safety, photos.
- [ ] Finance: IPC certification, invoices, payments, retention, cost period locks.
- [ ] External parties: routed RFI/submittal/document workflows and project-scoped access.

## Phase 5: UAT Scenarios

- [ ] Project setup readiness.
- [ ] BOQ upload and approved allocation.
- [ ] Schedule import/generation, revision, approval, activation, rollback.
- [ ] Progress submission and approval to official EV.
- [ ] Dashboard health review and drill-through.
- [ ] Cost update and reporting period lock.
- [ ] IPC certification, invoice, payment, retention.
- [ ] Change order and EOT workflow with evidence.
- [ ] Procurement package, receipt, material usage, long-lead alert.
- [ ] RFI, submittal, document revision approval.
- [ ] NCR and safety closeout.
- [ ] Permission negative checks.
- [ ] Desktop, tablet, and mobile responsive smoke.

## Phase 6: Go-Live Decision

- [ ] Complete documentation readiness QA.
- [ ] Complete UAT signoff template.
- [ ] Complete go-live readiness gate.
- [ ] Record support runbook approval.
- [ ] Record known limitations acceptance.
- [ ] Record Product, QA, Security, Backend, Frontend, Business, DevOps, and Database owner signoffs.
- [ ] Confirm rollback/offboarding plan with customer champion.

## First Week Success Criteria

- [ ] Users can sign in without support assistance.
- [ ] Each role can find its assigned work.
- [ ] PM can explain project health from dashboard drill-through.
- [ ] Site Engineer can submit progress and daily report evidence.
- [ ] QS/Finance can complete one IPC training cycle.
- [ ] Planning can import or revise schedule without losing linked records.
- [ ] Support can resolve access and workflow questions using this documentation.
- [ ] Known limitations did not create unplanned customer expectation gaps.
