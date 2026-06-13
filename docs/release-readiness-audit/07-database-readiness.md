# Database Readiness

## Schema Review
The Prisma schema is one of the stronger parts of the project. Prisma validation passed, and the schema includes broad construction entities with org/project context. Key models include Project at backend/prisma/schema.prisma:178, AuditEvent at 491, ProjectDocument at 1004, Activity at 1094, ChangeOrder at 1545, NcrRecord at 2656, SafetyIncident at 2741, Rfi at 2808, Submittal at 2855, DocumentRevision at 3101, and DailyReport at 3248.

## Main Entities
- Companies, users, project assignments, project parties.
- Projects, activities, activity dependencies, schedule/import/export support.
- BOQ, activity allocations, progress, earned value support.
- Documents, revisions, drawings, transmittals, correspondence.
- RFIs and submittals.
- Cost, change orders, IPC, sub-valuations, cash flow, EOT/weather delays.
- Procurement, long-lead, equipment/material tracking.
- Quality, NCR, ITP, defects, material tests.
- Safety incidents and observations.
- Meetings, tasks, risks, audit events, notifications.

## Missing Entities
No obvious major Phase 1a entity category is entirely absent. The open question is not whether the schema exists, but whether each workflow has validated transitions, audit events, permissions, and reporting behavior.

## Relationship Issues
The design generally follows orgId/projectId scoping. Activity-linked construction data appears well represented. Some features require deeper verification, especially document attachments to workflow records, approval event links, and party-scoped access.

## Constraint Issues
Prisma validation passed, but the audit did not run migrations against a fresh PostgreSQL instance. Financial workflows need additional validation for uniqueness, status transitions, retention, and immutable audit records.

## Indexing Issues
Indexes appear broadly present but were not exhaustively reviewed for query plans. Reporting/search performance should be validated with realistic project volumes.

## Data Integrity Risks
- Broken backend workflow tests can lead to incorrect persisted workflow states.
- Financial updates from change orders/IPCs need strict audit and approval validation.
- Document versioning and superseded drawing logic require UAT.
- Dirty release baseline includes deleted tracked private-document files, which must be resolved before certification.

## Migration Readiness
Cannot fully verify. Prisma schema validation passed, but production migration safety requires clean branch, migration dry run, backup, rollback, and restore rehearsal evidence.

## Multi-Tenant Data Isolation
Mostly Ready by design because orgId/projectId fields and project access middleware are widely used. Must be verified through negative integration and UAT tests.

## Reporting Readiness
Mostly Ready structurally. Reporting output cannot be certified while upstream workflow tests fail and live UAT evidence is missing.

## Database Launch Blockers
- TASK-P0-BE-001 and TASK-P0-BE-002 because workflow state integrity is affected.
- TASK-P0-REL-001 because dirty tracked state prevents certifying the schema/source baseline.
- TASK-P1-DEVOPS-002 because migration/deployment evidence is incomplete.
