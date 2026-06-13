# Controlled Pilot Readiness Decision

Decision date: 2026-06-13.
Baseline commit SHA: `5c512a023166ca2b1e3dab6d31d06383f5582efb`.
Status: no-go for controlled pilot until live UAT and operational rehearsal
evidence are attached. Internal demo remains allowed.

## Release Gate Status

| Gate | Status | Evidence |
| --- | --- | --- |
| Clean baseline before evidence work | Passed locally | `git status --short` returned clean before changes. |
| Exact npm command matrix | Passed locally | Prisma, OpenAPI, backend Jest, frontend lint/build, security/private storage, infra validators, and UAT manifest validation passed. |
| Node/npm runtime | Static evidence improved | Local and CI use `.nvmrc` Node 24/npm 11; EC2 bootstrap now installs and verifies Node 24/npm 11. |
| Dependency audit | Partially remediated | High/critical audit findings fixed; two moderate production chains remain documented in `docs/security/dependency-audit-triage.md`. |
| Live browser UAT | Not run | No staging URL, test accounts, or UAT credentials were present in the local environment. |
| Backup/restore rehearsal | Not run | No cloud/RDS credentials or staging restore target were present locally. |
| Rollback rehearsal | Not run | No staging deployment target or prior release artifact rehearsal was available locally. |
| Monitoring/alert rehearsal | Not run | No AWS/alert-channel credentials were present locally. |

## Security Status

- Secret hygiene validator passes locally.
- Private runtime storage validator passes locally.
- No secret values are recorded in this decision document.
- Dependency audit no longer has high or critical findings after remediation.
- Remaining moderate findings require Security/Backend risk acceptance before
  any controlled shadow pilot.

## Calculation Certification Status

- CPM, EV, IPC, and BOQ/activity-link tests pass locally.
- Independent Excel/Primavera/finance comparison evidence is not attached.
- Calculation outputs must remain advisory until `docs/calculations/calculation-certification-plan.md` is completed and signed off.

## Performance Status

- No load/performance run has been executed.
- Frontend build still warns on the large project-detail chunk.
- `docs/performance/performance-test-plan.md` defines required scenarios before paid customer or production readiness.

## Runtime Limitations

- BOQ/import job state is process-local memory and is lost on restart.
- Rate limiting is process-local memory and does not protect multiple API
  instances consistently.
- A shadow pilot, if later approved, must use a single backend instance and must
  not claim horizontal scalability or production SLA.

## AI And Import Limitations

- AI schedule/BOQ outputs require human review and approval.
- Imported schedules/progress require review before activation.
- CPM, EV, IPC, and import outputs are advisory until reconciled with legacy
  controls and external fixtures.

## Pilot Scope Allowed Today

| Scope item | Decision |
| --- | --- |
| Internal demo | Allowed after local command matrix passes. |
| Closed alpha with internal users | Allowed only if clearly non-contractual and no external party access is used. |
| Controlled shadow pilot | Blocked until live UAT and ops evidence exist, or formal risk acceptance explicitly covers the missing ops evidence. |
| Controlled paid pilot | Blocked. |
| Production/source-of-truth use | Blocked. |

## Features Disabled Or Restricted During Any Shadow Pilot

- OCTAPM is not the contractual source of truth.
- Primavera/Excel/legacy document system remains official.
- External-party access remains disabled or limited until live RBAC/UAT passes.
- AI outputs require human review.
- Imported schedules/progress require review.
- EV/IPC outputs are advisory until manually reconciled.
- Documents must not be stored only in OCTAPM unless restore proof exists.
- Long-running imports need manual retry/reconciliation because job state is not durable.

## Manual Review Requirements

| Area | Required review |
| --- | --- |
| Project setup | PM/admin confirms project, roles, and access before data entry. |
| BOQ/imports | QS/planning review every import and allocation before approval. |
| Schedule activation | Planning lead reviews draft revision and activation audit. |
| Progress/EV | PM/planning approve progress; finance/controller reconciles EV. |
| IPC/payment | QS/Finance reconcile against official workbook before use. |
| RFI/submittal/documents | Document controller confirms records remain duplicated in official system. |

## Data Safety Rules

- No live contractual record may exist only in PMcopilots before restore evidence.
- Daily export or backup must be completed for any pilot data entered.
- Test users must use least-privilege roles.
- No real secrets may be stored in docs, evidence JSON, screenshots, or logs.

## Support Process

| Event | Required action |
| --- | --- |
| UAT defect | File severity, owner, reproduction evidence, and retest result. |
| Import failure | Stop relying on generated output; retry manually or restore from legacy file. |
| Permission failure | Disable affected external access path until fixed and retested. |
| Data inconsistency | Reconcile against legacy source of truth and record correction notes. |

## Rollback Plan

Rollback is documented but not rehearsed. Before controlled pilot, execute
`docs/ops/rollback-evidence-checklist.md` against staging and attach deployment
logs, post-rollback smoke, and database compatibility result. Until then, any
pilot must retain the legacy system as the rollback path.

## Go/No-Go Decision

Overall verdict: demo-ready only.

Recommended launch type: internal demo only.

Required before controlled shadow pilot:

- Live browser UAT evidence for pilot-critical flows.
- Backup/restore rehearsal evidence, or formal shadow-mode risk acceptance with
  legacy source-of-truth and daily export controls.
- Rollback rehearsal evidence or formal risk acceptance.
- Monitoring/alert receipt evidence.
- Security/Backend acceptance of remaining moderate dependency findings.
- Product/Business acceptance that calculations are advisory.
