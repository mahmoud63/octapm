-- TASK-V3-P2-qaqc-safety-closeout-workflows
-- Track NCR and safety closeout metadata while keeping evidence in WorkflowAttachment.

ALTER TABLE "NcrRecord"
  ADD COLUMN "closureComment" TEXT,
  ADD COLUMN "closureSubmittedBy" TEXT,
  ADD COLUMN "closureSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "closureApprovedBy" TEXT,
  ADD COLUMN "closureApprovedAt" TIMESTAMP(3),
  ADD COLUMN "reopenedBy" TEXT,
  ADD COLUMN "reopenedAt" TIMESTAMP(3);

ALTER TABLE "SafetyIncident"
  ADD COLUMN "responsible" TEXT,
  ADD COLUMN "closureComment" TEXT,
  ADD COLUMN "closureSubmittedBy" TEXT,
  ADD COLUMN "closureSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "closureApprovedBy" TEXT,
  ADD COLUMN "closureApprovedAt" TIMESTAMP(3),
  ADD COLUMN "reopenedBy" TEXT,
  ADD COLUMN "reopenedAt" TIMESTAMP(3);

CREATE INDEX "NcrRecord_projectId_status_dueDate_idx"
ON "NcrRecord"("projectId", "status", "dueDate");

CREATE INDEX "SafetyIncident_projectId_status_dueDate_idx"
ON "SafetyIncident"("projectId", "status", "dueDate");
