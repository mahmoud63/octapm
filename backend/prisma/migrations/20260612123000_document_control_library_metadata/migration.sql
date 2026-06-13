ALTER TABLE "ProjectDocument"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "documentNumber" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "folderPath" TEXT,
  ADD COLUMN "discipline" TEXT,
  ADD COLUMN "confidentiality" TEXT NOT NULL DEFAULT 'project';

ALTER TABLE "DocumentRevision"
  ADD COLUMN "documentNumber" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "folderPath" TEXT,
  ADD COLUMN "discipline" TEXT,
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "sizeBytes" INTEGER,
  ADD COLUMN "submittedBy" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "reviewDueAt" TIMESTAMP(3);

CREATE INDEX "ProjectDocument_projectId_category_idx"
  ON "ProjectDocument"("projectId", "category");

CREATE INDEX "ProjectDocument_projectId_folderPath_idx"
  ON "ProjectDocument"("projectId", "folderPath");

CREATE INDEX "DocumentRevision_projectId_category_idx"
  ON "DocumentRevision"("projectId", "category");

CREATE INDEX "DocumentRevision_projectId_folderPath_idx"
  ON "DocumentRevision"("projectId", "folderPath");

CREATE INDEX "DocumentRevision_projectId_status_idx"
  ON "DocumentRevision"("projectId", "status");
