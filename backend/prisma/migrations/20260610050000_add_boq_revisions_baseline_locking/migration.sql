-- Add BOQ revision history and baseline-aware current-row tracking.
-- Existing BOQ rows are backfilled into one active revision per project.

CREATE TABLE "BoqRevision" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "label" TEXT,
  "source" TEXT NOT NULL DEFAULT 'upload',
  "status" TEXT NOT NULL DEFAULT 'imported',
  "baselineLocked" BOOLEAN NOT NULL DEFAULT false,
  "lockedBy" TEXT,
  "lockedAt" TIMESTAMP(3),
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "addedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "removedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "blockedCount" INTEGER NOT NULL DEFAULT 0,
  "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "importedRowsJson" JSONB NOT NULL DEFAULT '[]',
  "compareJson" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BoqRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BoqItem"
ADD COLUMN "revisionId" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "baselineLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "supersededAt" TIMESTAMP(3),
ADD COLUMN "supersededByRevisionId" TEXT,
ADD COLUMN "supersededReason" TEXT;

WITH project_boq AS (
  SELECT
    bi."projectId",
    COUNT(*)::INTEGER AS "itemCount",
    COALESCE(SUM(bi."amount"), 0) AS "totalAmount",
    MIN(bi."createdAt") AS "createdAt",
    MAX(bi."updatedAt") AS "updatedAt",
    EXISTS (
      SELECT 1
      FROM "ScheduleRevision" sr
      WHERE sr."projectId" = bi."projectId"
        AND sr."status" = 'baselined'
    ) AS "hasBaseline",
    (
      SELECT MAX(sr."baselinedAt")
      FROM "ScheduleRevision" sr
      WHERE sr."projectId" = bi."projectId"
        AND sr."status" = 'baselined'
    ) AS "lockedAt",
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', bi."id",
          'code', COALESCE(bi."code", bi."ref", ''),
          'description', bi."description",
          'quantity', bi."qty",
          'unit', bi."unit",
          'rate', bi."rate",
          'amount', bi."amount",
          'sortOrder', bi."sortOrder"
        )
        ORDER BY bi."sortOrder", bi."createdAt"
      ),
      '[]'::jsonb
    ) AS "rowsJson"
  FROM "BoqItem" bi
  GROUP BY bi."projectId"
)
INSERT INTO "BoqRevision" (
  "id",
  "projectId",
  "revisionNumber",
  "label",
  "source",
  "status",
  "baselineLocked",
  "lockedAt",
  "itemCount",
  "addedCount",
  "totalAmount",
  "importedRowsJson",
  "compareJson",
  "createdAt",
  "updatedAt"
)
SELECT
  'boq-rev-' || md5("projectId"),
  "projectId",
  1,
  'Backfilled BOQ Revision 1',
  'migration',
  CASE WHEN "hasBaseline" THEN 'baselined' ELSE 'imported' END,
  "hasBaseline",
  "lockedAt",
  "itemCount",
  "itemCount",
  "totalAmount",
  "rowsJson",
  jsonb_build_object(
    'added', "rowsJson",
    'updated', '[]'::jsonb,
    'unchanged', '[]'::jsonb,
    'removed', '[]'::jsonb,
    'blocked', '[]'::jsonb,
    'summary', jsonb_build_object(
      'added', "itemCount",
      'updated', 0,
      'unchanged', 0,
      'removed', 0,
      'blocked', 0
    )
  ),
  COALESCE("createdAt", CURRENT_TIMESTAMP),
  COALESCE("updatedAt", CURRENT_TIMESTAMP)
FROM project_boq;

UPDATE "BoqItem" bi
SET
  "revisionId" = 'boq-rev-' || md5(bi."projectId"),
  "baselineLocked" = EXISTS (
    SELECT 1
    FROM "ScheduleRevision" sr
    WHERE sr."projectId" = bi."projectId"
      AND sr."status" = 'baselined'
  );

DROP INDEX IF EXISTS "BoqItem_projectId_code_key";

CREATE UNIQUE INDEX "BoqItem_projectId_active_code_key"
ON "BoqItem"("projectId", "code")
WHERE "isActive" = true AND "code" IS NOT NULL;

CREATE UNIQUE INDEX "BoqRevision_projectId_revisionNumber_key"
ON "BoqRevision"("projectId", "revisionNumber");

CREATE INDEX "BoqRevision_projectId_idx"
ON "BoqRevision"("projectId");

CREATE INDEX "BoqRevision_projectId_status_idx"
ON "BoqRevision"("projectId", "status");

CREATE INDEX "BoqRevision_projectId_baselineLocked_idx"
ON "BoqRevision"("projectId", "baselineLocked");

CREATE INDEX "BoqItem_projectId_isActive_idx"
ON "BoqItem"("projectId", "isActive");

CREATE INDEX "BoqItem_projectId_code_idx"
ON "BoqItem"("projectId", "code");

CREATE INDEX "BoqItem_revisionId_idx"
ON "BoqItem"("revisionId");

ALTER TABLE "BoqRevision"
ADD CONSTRAINT "BoqRevision_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BoqItem"
ADD CONSTRAINT "BoqItem_revisionId_fkey"
FOREIGN KEY ("revisionId") REFERENCES "BoqRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
