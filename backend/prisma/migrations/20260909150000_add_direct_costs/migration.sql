-- OCTA-FIN-DIRECT-039: direct costs (invoices, expenses, payroll) with lines and payments.

CREATE TABLE "DirectCost" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'invoice',
  "vendorCompanyId" TEXT,
  "vendorName" TEXT,
  "invoiceNumber" TEXT,
  "description" TEXT NOT NULL,
  "costDate" DATE NOT NULL,
  "dueDate" DATE,
  "receivedDate" DATE,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "paidTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "paymentTerms" TEXT,
  "notes" TEXT,
  "submittedBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "postedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "voidedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DirectCost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DirectCost_projectId_number_key" ON "DirectCost"("projectId", "number");
CREATE UNIQUE INDEX "DirectCost_projectId_ref_key" ON "DirectCost"("projectId", "ref");
CREATE INDEX "DirectCost_orgId_idx" ON "DirectCost"("orgId");
CREATE INDEX "DirectCost_projectId_status_idx" ON "DirectCost"("projectId", "status");
CREATE INDEX "DirectCost_projectId_costDate_idx" ON "DirectCost"("projectId", "costDate");
CREATE INDEX "DirectCost_vendorCompanyId_idx" ON "DirectCost"("vendorCompanyId");
ALTER TABLE "DirectCost"
  ADD CONSTRAINT "DirectCost_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DirectCost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DirectCost_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DirectCostLine" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "directCostId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "costCodeId" TEXT,
  "budgetLineId" TEXT,
  "activityId" TEXT,
  "costType" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unit" TEXT,
  "unitCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "postedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DirectCostLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DirectCostLine_orgId_idx" ON "DirectCostLine"("orgId");
CREATE INDEX "DirectCostLine_directCostId_idx" ON "DirectCostLine"("directCostId");
CREATE INDEX "DirectCostLine_projectId_activityId_idx" ON "DirectCostLine"("projectId", "activityId");
CREATE INDEX "DirectCostLine_projectId_costCodeId_idx" ON "DirectCostLine"("projectId", "costCodeId");
ALTER TABLE "DirectCostLine"
  ADD CONSTRAINT "DirectCostLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DirectCostLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DirectCostLine_directCostId_fkey" FOREIGN KEY ("directCostId") REFERENCES "DirectCost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DirectCostLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DirectCostLine_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "DirectCostLine_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DirectCostPayment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "directCostId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "method" TEXT,
  "reference" TEXT,
  "note" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectCostPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DirectCostPayment_orgId_idx" ON "DirectCostPayment"("orgId");
CREATE INDEX "DirectCostPayment_projectId_paidAt_idx" ON "DirectCostPayment"("projectId", "paidAt");
CREATE INDEX "DirectCostPayment_directCostId_idx" ON "DirectCostPayment"("directCostId");
ALTER TABLE "DirectCostPayment"
  ADD CONSTRAINT "DirectCostPayment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DirectCostPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DirectCostPayment_directCostId_fkey" FOREIGN KEY ("directCostId") REFERENCES "DirectCost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
