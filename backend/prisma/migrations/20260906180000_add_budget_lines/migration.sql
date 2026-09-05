-- OCTA-FIN-COSTCODE-019: project cost codes, budget lines, ledger, activity allocations, snapshots.

CREATE TABLE "ProjectCostCode" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "costCodeId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectCostCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectCostCode_projectId_costCodeId_key" ON "ProjectCostCode"("projectId", "costCodeId");
CREATE INDEX "ProjectCostCode_orgId_idx" ON "ProjectCostCode"("orgId");
CREATE INDEX "ProjectCostCode_projectId_status_idx" ON "ProjectCostCode"("projectId", "status");
ALTER TABLE "ProjectCostCode" ADD CONSTRAINT "ProjectCostCode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectCostCode" ADD CONSTRAINT "ProjectCostCode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectCostCode" ADD CONSTRAINT "ProjectCostCode_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BudgetLine" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "costCodeId" TEXT NOT NULL,
  "costType" TEXT NOT NULL DEFAULT 'other',
  "description" TEXT,
  "originalBudget" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "committed" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "actual" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "forecast" DECIMAL(18,2),
  "status" TEXT NOT NULL DEFAULT 'active',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BudgetLine_projectId_costCodeId_costType_key" ON "BudgetLine"("projectId", "costCodeId", "costType");
CREATE INDEX "BudgetLine_orgId_idx" ON "BudgetLine"("orgId");
CREATE INDEX "BudgetLine_projectId_status_idx" ON "BudgetLine"("projectId", "status");
CREATE INDEX "BudgetLine_costCodeId_idx" ON "BudgetLine"("costCodeId");
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BudgetLineChange" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "budgetLineId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "changeOrderId" TEXT,
  "counterpartLineId" TEXT,
  "note" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BudgetLineChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BudgetLineChange_orgId_idx" ON "BudgetLineChange"("orgId");
CREATE INDEX "BudgetLineChange_projectId_budgetLineId_idx" ON "BudgetLineChange"("projectId", "budgetLineId");
CREATE INDEX "BudgetLineChange_projectId_changeOrderId_idx" ON "BudgetLineChange"("projectId", "changeOrderId");
ALTER TABLE "BudgetLineChange" ADD CONSTRAINT "BudgetLineChange_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetLineChange" ADD CONSTRAINT "BudgetLineChange_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetLineChange" ADD CONSTRAINT "BudgetLineChange_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetLineChange" ADD CONSTRAINT "BudgetLineChange_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BudgetLineActivityAllocation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "budgetLineId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BudgetLineActivityAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BudgetLineActivityAllocation_budgetLineId_activityId_key" ON "BudgetLineActivityAllocation"("budgetLineId", "activityId");
CREATE INDEX "BudgetLineActivityAllocation_projectId_activityId_idx" ON "BudgetLineActivityAllocation"("projectId", "activityId");
ALTER TABLE "BudgetLineActivityAllocation" ADD CONSTRAINT "BudgetLineActivityAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetLineActivityAllocation" ADD CONSTRAINT "BudgetLineActivityAllocation_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetLineActivityAllocation" ADD CONSTRAINT "BudgetLineActivityAllocation_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BudgetSnapshot" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "reportingPeriodId" TEXT,
  "label" TEXT NOT NULL,
  "takenBy" TEXT,
  "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalsJson" JSONB NOT NULL DEFAULT '{}',
  "linesJson" JSONB NOT NULL DEFAULT '[]',
  "reconciliationJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BudgetSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BudgetSnapshot_reportingPeriodId_key" ON "BudgetSnapshot"("reportingPeriodId");
CREATE INDEX "BudgetSnapshot_orgId_idx" ON "BudgetSnapshot"("orgId");
CREATE INDEX "BudgetSnapshot_projectId_takenAt_idx" ON "BudgetSnapshot"("projectId", "takenAt");
ALTER TABLE "BudgetSnapshot" ADD CONSTRAINT "BudgetSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetSnapshot" ADD CONSTRAINT "BudgetSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetSnapshot" ADD CONSTRAINT "BudgetSnapshot_reportingPeriodId_fkey" FOREIGN KEY ("reportingPeriodId") REFERENCES "ReportingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChangeOrder" ADD COLUMN "budgetLineId" TEXT;
CREATE INDEX "ChangeOrder_budgetLineId_idx" ON "ChangeOrder"("budgetLineId");
ALTER TABLE "ChangeOrder" ADD CONSTRAINT "ChangeOrder_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
