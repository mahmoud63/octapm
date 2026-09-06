-- OCTA-QA-045: allow company-scoped audit events.
--
-- AuditEvent.projectId was NOT NULL, so an organisation-level entity could
-- never be audited. Three services already worked around it by swallowing the
-- failure (report definitions, workflow engine templates), and two did not —
-- so creating a company form template or submittal workflow template failed
-- outright with AUDIT_EVENT_INVALID.
--
-- RecordHistorySnapshot is written alongside every audit event and carried the
-- same constraint, so it has to move together or the trail breaks at the
-- second table instead of the first.
--
-- Dropping NOT NULL is non-destructive: every existing row keeps its project.

ALTER TABLE "AuditEvent" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "RecordHistorySnapshot" ALTER COLUMN "projectId" DROP NOT NULL;
