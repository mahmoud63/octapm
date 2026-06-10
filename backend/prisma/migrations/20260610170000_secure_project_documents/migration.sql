-- TASK-P1 secure project document metadata and BOQ source upload linkage.

CREATE TABLE "ProjectDocument" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "linkedEntityType" TEXT,
  "linkedEntityId" TEXT,
  "originalName" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "storageProvider" TEXT NOT NULL,
  "bucket" TEXT,
  "objectKey" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "storageVersionId" TEXT,
  "scanStatus" TEXT NOT NULL DEFAULT 'clean',
  "scannedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'available',
  "retentionPolicy" TEXT,
  "retentionExpiresAt" TIMESTAMP(3),
  "uploadedBy" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BoqRevision"
ADD COLUMN "sourceDocumentId" TEXT;

CREATE UNIQUE INDEX "ProjectDocument_storageKey_key"
ON "ProjectDocument"("storageKey");

CREATE INDEX "ProjectDocument_orgId_idx"
ON "ProjectDocument"("orgId");

CREATE INDEX "ProjectDocument_projectId_idx"
ON "ProjectDocument"("projectId");

CREATE INDEX "ProjectDocument_orgId_projectId_documentType_idx"
ON "ProjectDocument"("orgId", "projectId", "documentType");

CREATE INDEX "ProjectDocument_projectId_linkedEntityType_linkedEntityId_idx"
ON "ProjectDocument"("projectId", "linkedEntityType", "linkedEntityId");

CREATE INDEX "ProjectDocument_storageProvider_bucket_idx"
ON "ProjectDocument"("storageProvider", "bucket");

CREATE INDEX "ProjectDocument_retentionExpiresAt_idx"
ON "ProjectDocument"("retentionExpiresAt");

CREATE INDEX "BoqRevision_sourceDocumentId_idx"
ON "BoqRevision"("sourceDocumentId");

ALTER TABLE "ProjectDocument"
ADD CONSTRAINT "ProjectDocument_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectDocument"
ADD CONSTRAINT "ProjectDocument_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BoqRevision"
ADD CONSTRAINT "BoqRevision_sourceDocumentId_fkey"
FOREIGN KEY ("sourceDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
