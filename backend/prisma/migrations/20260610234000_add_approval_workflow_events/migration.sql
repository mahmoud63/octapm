-- TASK-P1-domain-implement-approval-workflows
-- Add a normalized approval workflow event ledger for contractual records.
-- Pre-deploy checklist:
--   1. Take a PostgreSQL backup/snapshot before applying.
--   2. Dry-run on a staging clone and compare AuditEvent/WorkflowStatusHistory counts
--      against ApprovalWorkflowEvent backfill counts for affected record types.
--   3. Roll back by restoring the backup/snapshot if the migration or validation fails.

CREATE TABLE "ApprovalWorkflowEvent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "workflowType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "actorId" TEXT,
  "actorRole" TEXT,
  "decision" TEXT,
  "reason" TEXT,
  "comment" TEXT,
  "metadataJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApprovalWorkflowEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalWorkflowEvent_orgId_idx" ON "ApprovalWorkflowEvent"("orgId");
CREATE INDEX "ApprovalWorkflowEvent_projectId_idx" ON "ApprovalWorkflowEvent"("projectId");
CREATE INDEX "ApprovalWorkflowEvent_orgId_projectId_createdAt_idx" ON "ApprovalWorkflowEvent"("orgId", "projectId", "createdAt");
CREATE INDEX "ApprovalWorkflowEvent_projectId_recordType_recordId_createdAt_idx" ON "ApprovalWorkflowEvent"("projectId", "recordType", "recordId", "createdAt");
CREATE INDEX "ApprovalWorkflowEvent_projectId_workflowType_toStatus_idx" ON "ApprovalWorkflowEvent"("projectId", "workflowType", "toStatus");
CREATE INDEX "ApprovalWorkflowEvent_actorId_createdAt_idx" ON "ApprovalWorkflowEvent"("actorId", "createdAt");

ALTER TABLE "ApprovalWorkflowEvent"
  ADD CONSTRAINT "ApprovalWorkflowEvent_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ApprovalWorkflowEvent" (
  "id",
  "orgId",
  "projectId",
  "recordType",
  "recordId",
  "workflowType",
  "action",
  "fromStatus",
  "toStatus",
  "actorId",
  "actorRole",
  "decision",
  "reason",
  "comment",
  "metadataJson",
  "createdAt"
)
SELECT
  'awe-audit-' || md5(ae."id") AS "id",
  ae."orgId",
  ae."projectId",
  ae."entityType" AS "recordType",
  ae."entityId" AS "recordId",
  ae."entityType" AS "workflowType",
  ae."action",
  ae."oldStatus",
  ae."newStatus",
  ae."actorId",
  ae."actorRole",
  CASE
    WHEN ae."action" IN ('approved', 'certified', 'baseline_locked') THEN 'approved'
    WHEN ae."action" = 'rejected' THEN 'rejected'
    WHEN ae."action" = 'superseded' THEN 'superseded'
    ELSE ae."action"
  END AS "decision",
  ae."reason",
  NULL AS "comment",
  COALESCE(ae."metadataJson", '{}'::jsonb) AS "metadataJson",
  ae."occurredAt" AS "createdAt"
FROM "AuditEvent" ae
WHERE ae."entityType" IN (
  'boq_revision',
  'schedule_revision',
  'activity_cost_loading',
  'rfi',
  'submittal',
  'change_order',
  'ipc_certificate',
  'eot_claim',
  'ncr',
  'safety_incident'
);

INSERT INTO "ApprovalWorkflowEvent" (
  "id",
  "orgId",
  "projectId",
  "recordType",
  "recordId",
  "workflowType",
  "action",
  "fromStatus",
  "toStatus",
  "actorId",
  "actorRole",
  "decision",
  "reason",
  "comment",
  "metadataJson",
  "createdAt"
)
SELECT
  'awe-status-' || md5(wsh."id") AS "id",
  p."orgId",
  wsh."projectId",
  wsh."recordType",
  wsh."recordId",
  wsh."recordType" AS "workflowType",
  'status_changed' AS "action",
  wsh."oldStatus",
  wsh."newStatus",
  wsh."createdBy" AS "actorId",
  wsh."actorRole",
  CASE
    WHEN wsh."newStatus" IN ('approved', 'certified', 'baselined', 'closed') THEN 'approved'
    WHEN wsh."newStatus" IN ('rejected', 'resubmit') THEN 'rejected'
    WHEN wsh."newStatus" = 'superseded' THEN 'superseded'
    ELSE 'status_changed'
  END AS "decision",
  NULL AS "reason",
  wsh."comment",
  '{}'::jsonb AS "metadataJson",
  wsh."createdAt"
FROM "WorkflowStatusHistory" wsh
JOIN "Project" p ON p."id" = wsh."projectId"
WHERE wsh."recordType" IN (
  'rfi',
  'submittal',
  'ncr',
  'safety_incident'
);
