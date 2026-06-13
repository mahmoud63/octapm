-- Add archive metadata for contractual records that must be retained for audit,
-- claims, and project history. Normal API delete actions now set these fields
-- instead of physically deleting rows.

ALTER TABLE "Project"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT;

ALTER TABLE "Rfi"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT;

ALTER TABLE "Submittal"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT;

ALTER TABLE "ChangeOrder"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT;

ALTER TABLE "Risk"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT;

ALTER TABLE "SafetyIncident"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT;

CREATE INDEX "Project_orgId_status_archivedAt_idx"
  ON "Project"("orgId", "status", "archivedAt");

CREATE INDEX "Rfi_projectId_status_archivedAt_idx"
  ON "Rfi"("projectId", "status", "archivedAt");

CREATE INDEX "Submittal_projectId_status_archivedAt_idx"
  ON "Submittal"("projectId", "status", "archivedAt");

CREATE INDEX "ChangeOrder_projectId_status_archivedAt_idx"
  ON "ChangeOrder"("projectId", "status", "archivedAt");

CREATE INDEX "Risk_projectId_status_archivedAt_idx"
  ON "Risk"("projectId", "status", "archivedAt");

CREATE INDEX "SafetyIncident_projectId_status_archivedAt_idx"
  ON "SafetyIncident"("projectId", "status", "archivedAt");
