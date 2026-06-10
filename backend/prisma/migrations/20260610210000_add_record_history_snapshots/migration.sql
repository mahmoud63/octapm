-- TASK-P1-database-add-audit-log-and-record-history
-- Add durable record snapshots for each centralized audit event.
-- Pre-deploy checklist:
--   1. Take a PostgreSQL backup/snapshot before applying.
--   2. Dry-run on a staging clone and compare AuditEvent vs RecordHistorySnapshot counts.
--   3. Roll back by restoring the backup/snapshot if the migration or validation fails.

CREATE TABLE "RecordHistorySnapshot" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "actorRole" TEXT,
  "auditEventId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "oldStatus" TEXT,
  "newStatus" TEXT,
  "reason" TEXT,
  "previousSnapshotJson" JSONB,
  "snapshotJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "changeSetJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "metadataJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RecordHistorySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecordHistorySnapshot_auditEventId_key" ON "RecordHistorySnapshot"("auditEventId");
CREATE INDEX "RecordHistorySnapshot_orgId_idx" ON "RecordHistorySnapshot"("orgId");
CREATE INDEX "RecordHistorySnapshot_projectId_idx" ON "RecordHistorySnapshot"("projectId");
CREATE INDEX "RecordHistorySnapshot_orgId_projectId_occurredAt_idx" ON "RecordHistorySnapshot"("orgId", "projectId", "occurredAt");
CREATE INDEX "RecordHistorySnapshot_projectId_entityType_entityId_occurredAt_idx" ON "RecordHistorySnapshot"("projectId", "entityType", "entityId", "occurredAt");
CREATE INDEX "RecordHistorySnapshot_entityType_entityId_idx" ON "RecordHistorySnapshot"("entityType", "entityId");

INSERT INTO "RecordHistorySnapshot" (
  "id",
  "orgId",
  "projectId",
  "entityType",
  "entityId",
  "action",
  "actorId",
  "actorRole",
  "auditEventId",
  "occurredAt",
  "oldStatus",
  "newStatus",
  "reason",
  "previousSnapshotJson",
  "snapshotJson",
  "changeSetJson",
  "metadataJson",
  "createdAt"
)
SELECT
  'rhs-' || md5("id") AS "id",
  "orgId",
  "projectId",
  "entityType",
  "entityId",
  "action",
  "actorId",
  "actorRole",
  "id" AS "auditEventId",
  "occurredAt",
  "oldStatus",
  "newStatus",
  "reason",
  "oldSummaryJson" AS "previousSnapshotJson",
  COALESCE("newSummaryJson", "summaryJson", "oldSummaryJson", '{}'::jsonb) AS "snapshotJson",
  '{}'::jsonb AS "changeSetJson",
  COALESCE("metadataJson", '{}'::jsonb) AS "metadataJson",
  "createdAt"
FROM "AuditEvent"
WHERE NOT EXISTS (
  SELECT 1
  FROM "RecordHistorySnapshot" rhs
  WHERE rhs."auditEventId" = "AuditEvent"."id"
);
