-- FB-010 shared audit trail and critical status history metadata.

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "actorRole" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "oldStatus" TEXT,
  "newStatus" TEXT,
  "reason" TEXT,
  "oldSummaryJson" JSONB,
  "newSummaryJson" JSONB,
  "summaryJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "attachmentsJson" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "metadataJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_orgId_idx" ON "AuditEvent"("orgId");
CREATE INDEX "AuditEvent_projectId_idx" ON "AuditEvent"("projectId");
CREATE INDEX "AuditEvent_orgId_projectId_occurredAt_idx" ON "AuditEvent"("orgId", "projectId", "occurredAt");
CREATE INDEX "AuditEvent_projectId_entityType_entityId_occurredAt_idx" ON "AuditEvent"("projectId", "entityType", "entityId", "occurredAt");
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

ALTER TABLE "ChangeOrder"
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "updatedBy" TEXT,
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvalComment" TEXT,
  ADD COLUMN "rejectedBy" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMP(3);

UPDATE "ChangeOrder"
SET "approvedAt" = "approvedDate"
WHERE "status" = 'approved' AND "approvedDate" IS NOT NULL;

ALTER TABLE "IpcCertificate"
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "certifiedBy" TEXT,
  ADD COLUMN "certifiedAt" TIMESTAMP(3),
  ADD COLUMN "certificationComment" TEXT;

UPDATE "IpcCertificate"
SET "submittedAt" = COALESCE("issueDate", "updatedAt")
WHERE "submittedBy" IS NOT NULL AND "submittedAt" IS NULL;
