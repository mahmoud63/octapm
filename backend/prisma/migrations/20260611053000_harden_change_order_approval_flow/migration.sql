-- TASK-V3-P1-commercial-change-order-approval-flow
-- Store explicit approval impact summaries and support one official budget revision lookup per approved variation.

ALTER TABLE "ChangeOrder"
  ADD COLUMN "scheduleImpactSummary" TEXT,
  ADD COLUMN "costImpactSummary" TEXT;

ALTER TABLE "ChangeOrder"
  ALTER COLUMN "status" SET DEFAULT 'draft';

CREATE INDEX "BudgetRevision_projectId_linkedChangeOrder_idx"
ON "BudgetRevision"("projectId", "linkedChangeOrder");
