-- OCTA-FIN-COMMIT-020: commitments (subcontracts / purchase orders) with a schedule of values and change orders.

CREATE TABLE "Commitment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'subcontract',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "vendorCompanyId" TEXT,
  "projectPartyId" TEXT,
  "supplierId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "retentionRate" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "paymentTerms" TEXT,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "insuranceJson" JSONB NOT NULL DEFAULT '[]',
  "executedDocumentId" TEXT,
  "executedAt" TIMESTAMP(3),
  "executedBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "submittedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "closedAt" TIMESTAMP(3),
  "closedBy" TEXT,
  "voidReason" TEXT,
  "notes" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Commitment_projectId_ref_key" ON "Commitment"("projectId", "ref");
CREATE UNIQUE INDEX "Commitment_projectId_type_number_key" ON "Commitment"("projectId", "type", "number");
CREATE INDEX "Commitment_orgId_idx" ON "Commitment"("orgId");
CREATE INDEX "Commitment_projectId_status_idx" ON "Commitment"("projectId", "status");
CREATE INDEX "Commitment_projectId_type_idx" ON "Commitment"("projectId", "type");
CREATE INDEX "Commitment_vendorCompanyId_idx" ON "Commitment"("vendorCompanyId");
CREATE INDEX "Commitment_projectPartyId_idx" ON "Commitment"("projectPartyId");
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_projectPartyId_fkey" FOREIGN KEY ("projectPartyId") REFERENCES "ProjectParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcurementSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_executedDocumentId_fkey" FOREIGN KEY ("executedDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CommitmentSovLine" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "costCodeId" TEXT,
  "budgetLineId" TEXT,
  "boqItemId" TEXT,
  "activityId" TEXT,
  "unit" TEXT,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommitmentSovLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommitmentSovLine_commitmentId_lineNumber_key" ON "CommitmentSovLine"("commitmentId", "lineNumber");
CREATE INDEX "CommitmentSovLine_orgId_idx" ON "CommitmentSovLine"("orgId");
CREATE INDEX "CommitmentSovLine_projectId_commitmentId_idx" ON "CommitmentSovLine"("projectId", "commitmentId");
CREATE INDEX "CommitmentSovLine_projectId_activityId_idx" ON "CommitmentSovLine"("projectId", "activityId");
CREATE INDEX "CommitmentSovLine_budgetLineId_idx" ON "CommitmentSovLine"("budgetLineId");
CREATE INDEX "CommitmentSovLine_costCodeId_idx" ON "CommitmentSovLine"("costCodeId");
CREATE INDEX "CommitmentSovLine_boqItemId_idx" ON "CommitmentSovLine"("boqItemId");
ALTER TABLE "CommitmentSovLine" ADD CONSTRAINT "CommitmentSovLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitmentSovLine" ADD CONSTRAINT "CommitmentSovLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitmentSovLine" ADD CONSTRAINT "CommitmentSovLine_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitmentSovLine" ADD CONSTRAINT "CommitmentSovLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommitmentSovLine" ADD CONSTRAINT "CommitmentSovLine_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommitmentSovLine" ADD CONSTRAINT "CommitmentSovLine_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommitmentSovLine" ADD CONSTRAINT "CommitmentSovLine_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CommitmentChangeOrder" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "primeChangeOrderId" TEXT,
  "linesJson" JSONB NOT NULL DEFAULT '[]',
  "submittedAt" TIMESTAMP(3),
  "submittedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedBy" TEXT,
  "rejectedReason" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommitmentChangeOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommitmentChangeOrder_commitmentId_number_key" ON "CommitmentChangeOrder"("commitmentId", "number");
CREATE UNIQUE INDEX "CommitmentChangeOrder_projectId_ref_key" ON "CommitmentChangeOrder"("projectId", "ref");
CREATE INDEX "CommitmentChangeOrder_orgId_idx" ON "CommitmentChangeOrder"("orgId");
CREATE INDEX "CommitmentChangeOrder_projectId_status_idx" ON "CommitmentChangeOrder"("projectId", "status");
CREATE INDEX "CommitmentChangeOrder_primeChangeOrderId_idx" ON "CommitmentChangeOrder"("primeChangeOrderId");
ALTER TABLE "CommitmentChangeOrder" ADD CONSTRAINT "CommitmentChangeOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitmentChangeOrder" ADD CONSTRAINT "CommitmentChangeOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitmentChangeOrder" ADD CONSTRAINT "CommitmentChangeOrder_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitmentChangeOrder" ADD CONSTRAINT "CommitmentChangeOrder_primeChangeOrderId_fkey" FOREIGN KEY ("primeChangeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BudgetLine" ADD COLUMN "committedFromCommitments" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "ProcurementOrder" ADD COLUMN "commitmentId" TEXT;
CREATE INDEX "ProcurementOrder_commitmentId_idx" ON "ProcurementOrder"("commitmentId");
ALTER TABLE "ProcurementOrder" ADD CONSTRAINT "ProcurementOrder_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
