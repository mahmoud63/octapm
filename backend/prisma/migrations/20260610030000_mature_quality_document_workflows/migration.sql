-- FB-014 mature quality and document workflows.

ALTER TABLE "NcrRecord"
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "approver" TEXT;

ALTER TABLE "ItpRecord"
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "approver" TEXT,
  ADD COLUMN "dueDate" TIMESTAMP(3);

ALTER TABLE "DefectRecord"
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "approver" TEXT,
  ADD COLUMN "dueDate" TIMESTAMP(3);

ALTER TABLE "SafetyIncident"
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "approver" TEXT,
  ADD COLUMN "dueDate" TIMESTAMP(3),
  ADD COLUMN "closedDate" TIMESTAMP(3);

ALTER TABLE "MaterialTest"
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "approver" TEXT,
  ADD COLUMN "dueDate" TIMESTAMP(3);

ALTER TABLE "Rfi"
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "approver" TEXT;

ALTER TABLE "Submittal"
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "approver" TEXT;

ALTER TABLE "DrawingRecord"
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "approver" TEXT,
  ADD COLUMN "dueDate" TIMESTAMP(3),
  ADD COLUMN "reviewedOn" TIMESTAMP(3);

ALTER TABLE "Transmittal"
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "approver" TEXT,
  ADD COLUMN "dueDate" TIMESTAMP(3);

ALTER TABLE "Correspondence"
  ADD COLUMN "owner" TEXT,
  ADD COLUMN "reviewer" TEXT,
  ADD COLUMN "approver" TEXT,
  ADD COLUMN "dueDate" TIMESTAMP(3);

CREATE TABLE "WorkflowAttachment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "fileName" TEXT,
  "fileUrl" TEXT,
  "storageKey" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "description" TEXT,
  "uploadedBy" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkflowAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowStatusHistory" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "oldStatus" TEXT,
  "newStatus" TEXT,
  "comment" TEXT,
  "createdBy" TEXT,
  "actorRole" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkflowStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowActivityLink" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL DEFAULT 'affected',
  "scheduleImpactDays" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WorkflowActivityLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentRevision" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "status" TEXT,
  "title" TEXT,
  "fileName" TEXT,
  "fileUrl" TEXT,
  "storageKey" TEXT,
  "issuedBy" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DocumentRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowAttachment_projectId_idx" ON "WorkflowAttachment"("projectId");
CREATE INDEX "WorkflowAttachment_projectId_recordType_recordId_idx" ON "WorkflowAttachment"("projectId", "recordType", "recordId");

CREATE INDEX "WorkflowStatusHistory_projectId_idx" ON "WorkflowStatusHistory"("projectId");
CREATE INDEX "WorkflowStatusHistory_projectId_recordType_recordId_createdAt_idx" ON "WorkflowStatusHistory"("projectId", "recordType", "recordId", "createdAt");

CREATE UNIQUE INDEX "WorkflowActivityLink_recordType_recordId_activityId_relationType_key" ON "WorkflowActivityLink"("recordType", "recordId", "activityId", "relationType");
CREATE INDEX "WorkflowActivityLink_projectId_idx" ON "WorkflowActivityLink"("projectId");
CREATE INDEX "WorkflowActivityLink_activityId_idx" ON "WorkflowActivityLink"("activityId");
CREATE INDEX "WorkflowActivityLink_projectId_recordType_recordId_idx" ON "WorkflowActivityLink"("projectId", "recordType", "recordId");

CREATE UNIQUE INDEX "DocumentRevision_recordType_recordId_revision_key" ON "DocumentRevision"("recordType", "recordId", "revision");
CREATE INDEX "DocumentRevision_projectId_idx" ON "DocumentRevision"("projectId");
CREATE INDEX "DocumentRevision_projectId_recordType_recordId_idx" ON "DocumentRevision"("projectId", "recordType", "recordId");

ALTER TABLE "WorkflowAttachment" ADD CONSTRAINT "WorkflowAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowStatusHistory" ADD CONSTRAINT "WorkflowStatusHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowActivityLink" ADD CONSTRAINT "WorkflowActivityLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowActivityLink" ADD CONSTRAINT "WorkflowActivityLink_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill multi-activity links from legacy optional single-activity columns.
INSERT INTO "WorkflowActivityLink" (
  "id",
  "projectId",
  "recordType",
  "recordId",
  "activityId",
  "relationType",
  "createdAt",
  "updatedAt"
)
SELECT 'wf-act-' || md5(src."recordType" || src."recordId" || src."activityId"),
  src."projectId",
  src."recordType",
  src."recordId",
  src."activityId",
  'primary',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT "projectId", 'ncr' AS "recordType", "id" AS "recordId", "activityId" FROM "NcrRecord" WHERE "activityId" IS NOT NULL
  UNION ALL SELECT "projectId", 'itp', "id", "activityId" FROM "ItpRecord" WHERE "activityId" IS NOT NULL
  UNION ALL SELECT "projectId", 'defect', "id", "activityId" FROM "DefectRecord" WHERE "activityId" IS NOT NULL
  UNION ALL SELECT "projectId", 'safety_incident', "id", "activityId" FROM "SafetyIncident" WHERE "activityId" IS NOT NULL
  UNION ALL SELECT "projectId", 'material_test', "id", "activityId" FROM "MaterialTest" WHERE "activityId" IS NOT NULL
  UNION ALL SELECT "projectId", 'rfi', "id", "activityId" FROM "Rfi" WHERE "activityId" IS NOT NULL
  UNION ALL SELECT "projectId", 'submittal', "id", "activityId" FROM "Submittal" WHERE "activityId" IS NOT NULL
  UNION ALL SELECT "projectId", 'drawing', "id", "activityId" FROM "DrawingRecord" WHERE "activityId" IS NOT NULL
  UNION ALL SELECT "projectId", 'correspondence', "id", "activityId" FROM "Correspondence" WHERE "activityId" IS NOT NULL
) src
JOIN "Activity" activity
  ON activity."id" = src."activityId"
  AND activity."projectId" = src."projectId"
ON CONFLICT DO NOTHING;

-- Backfill current status snapshots for workflows that now show record history.
INSERT INTO "WorkflowStatusHistory" (
  "id",
  "projectId",
  "recordType",
  "recordId",
  "oldStatus",
  "newStatus",
  "comment",
  "createdAt"
)
SELECT 'wf-hist-' || md5(src."recordType" || src."recordId" || COALESCE(src."status", '')),
  src."projectId",
  src."recordType",
  src."recordId",
  NULL,
  src."status",
  'Backfilled current workflow status',
  CURRENT_TIMESTAMP
FROM (
  SELECT "projectId", 'ncr' AS "recordType", "id" AS "recordId", "status" FROM "NcrRecord"
  UNION ALL SELECT "projectId", 'itp', "id", "status" FROM "ItpRecord"
  UNION ALL SELECT "projectId", 'rfi', "id", "status" FROM "Rfi"
  UNION ALL SELECT "projectId", 'submittal', "id", "status" FROM "Submittal"
  UNION ALL SELECT "projectId", 'drawing', "id", "status" FROM "DrawingRecord"
  UNION ALL SELECT "projectId", 'correspondence', "id", "status" FROM "Correspondence"
) src;

INSERT INTO "DocumentRevision" (
  "id",
  "projectId",
  "recordType",
  "recordId",
  "revision",
  "status",
  "title",
  "fileUrl",
  "issuedAt",
  "createdAt",
  "updatedAt"
)
SELECT 'doc-rev-' || md5(src."recordType" || src."recordId" || src."revision"),
  src."projectId",
  src."recordType",
  src."recordId",
  src."revision",
  src."status",
  src."title",
  src."fileUrl",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT "projectId", 'submittal' AS "recordType", "id" AS "recordId", "revision", "status", "title", NULL::TEXT AS "fileUrl" FROM "Submittal"
  UNION ALL SELECT "projectId", 'drawing', "id", "revision", "status", "title", "fileUrl" FROM "DrawingRecord"
  UNION ALL SELECT "projectId", 'correspondence', "id", '1', "status", "subject", NULL::TEXT FROM "Correspondence"
) src
ON CONFLICT DO NOTHING;
