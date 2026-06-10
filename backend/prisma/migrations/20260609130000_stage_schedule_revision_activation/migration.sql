ALTER TABLE "Activity"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "retiredAt" TIMESTAMP(3),
ADD COLUMN "retiredBy" TEXT,
ADD COLUMN "retiredReason" TEXT,
ADD COLUMN "retiredRevisionId" TEXT;

ALTER TABLE "ScheduleRevision"
ADD COLUMN "source" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "activatedBy" TEXT,
ADD COLUMN "activatedAt" TIMESTAMP(3),
ADD COLUMN "activationComment" TEXT,
ADD COLUMN "previousActiveRevisionId" TEXT,
ADD COLUMN "rolledBackBy" TEXT,
ADD COLUMN "rolledBackAt" TIMESTAMP(3),
ADD COLUMN "rollbackReason" TEXT,
ADD COLUMN "mappingJson" JSONB,
ADD COLUMN "activationAuditJson" JSONB;

UPDATE "ScheduleRevision" sr
SET "isActive" = true
WHERE sr.id IN (
  SELECT DISTINCT ON ("projectId") id
  FROM "ScheduleRevision"
  ORDER BY "projectId", "createdAt" DESC
);

CREATE INDEX "Activity_projectId_isActive_idx"
ON "Activity"("projectId", "isActive");

CREATE INDEX "ScheduleRevision_projectId_isActive_idx"
ON "ScheduleRevision"("projectId", "isActive");
