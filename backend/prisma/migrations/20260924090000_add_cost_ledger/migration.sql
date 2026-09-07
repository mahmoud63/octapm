-- Cost ledger (OCTA-FIN-LEDGER-059).
-- Every actual cost, once, with its origin attached. The unique index on
-- (orgId, sourceKey) is what makes a posting idempotent: one economic event
-- produces one entry, so a retry, double click, repeated webhook or concurrent
-- approval cannot post twice.

-- CreateTable
CREATE TABLE "CostLedgerEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLineId" TEXT,
    "activityId" TEXT,
    "costCodeId" TEXT,
    "budgetLineId" TEXT,
    "commitmentId" TEXT,
    "costType" TEXT NOT NULL DEFAULT 'other',
    "amount" DECIMAL(18,2) NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unitCost" DECIMAL(18,4),
    "incurredOn" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedBy" TEXT,
    "reversalOfId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostLedgerEntry_projectId_incurredOn_idx" ON "CostLedgerEntry"("projectId", "incurredOn");

-- CreateIndex
CREATE INDEX "CostLedgerEntry_projectId_sourceType_idx" ON "CostLedgerEntry"("projectId", "sourceType");

-- CreateIndex
CREATE INDEX "CostLedgerEntry_projectId_activityId_idx" ON "CostLedgerEntry"("projectId", "activityId");

-- CreateIndex
CREATE INDEX "CostLedgerEntry_projectId_budgetLineId_idx" ON "CostLedgerEntry"("projectId", "budgetLineId");

-- CreateIndex
CREATE INDEX "CostLedgerEntry_commitmentId_idx" ON "CostLedgerEntry"("commitmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CostLedgerEntry_orgId_sourceKey_key" ON "CostLedgerEntry"("orgId", "sourceKey");

-- AddForeignKey
ALTER TABLE "CostLedgerEntry" ADD CONSTRAINT "CostLedgerEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLedgerEntry" ADD CONSTRAINT "CostLedgerEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLedgerEntry" ADD CONSTRAINT "CostLedgerEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLedgerEntry" ADD CONSTRAINT "CostLedgerEntry_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLedgerEntry" ADD CONSTRAINT "CostLedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "CostLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
