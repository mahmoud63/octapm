-- OCTA-FIN-SUBPAY-021: subcontractor payment applications against commitment schedules of values.

CREATE TABLE "SubPayApp" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "periodLabel" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'draft',
  "workThisPeriod" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "workCumulative" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "materialsOnSite" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "grossThisPeriod" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "retentionRate" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "retentionThisPeriod" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "retentionCumulative" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "backCharges" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "backChargesNote" TEXT,
  "netThisPeriod" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "overClaimAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "waiverRequired" BOOLEAN NOT NULL DEFAULT false,
  "waiverDocumentId" TEXT,
  "complianceOverrideReason" TEXT,
  "overClaimOverrideReason" TEXT,
  "reviewNote" TEXT,
  "rejectionCode" TEXT,
  "rejectedReason" TEXT,
  "notes" TEXT,
  "submittedAt" TIMESTAMP(3),
  "submittedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedBy" TEXT,
  "paidAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubPayApp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubPayApp_commitmentId_number_key" ON "SubPayApp"("commitmentId", "number");
CREATE UNIQUE INDEX "SubPayApp_projectId_ref_key" ON "SubPayApp"("projectId", "ref");
CREATE INDEX "SubPayApp_orgId_idx" ON "SubPayApp"("orgId");
CREATE INDEX "SubPayApp_projectId_status_idx" ON "SubPayApp"("projectId", "status");
CREATE INDEX "SubPayApp_commitmentId_status_idx" ON "SubPayApp"("commitmentId", "status");
ALTER TABLE "SubPayApp" ADD CONSTRAINT "SubPayApp_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubPayApp" ADD CONSTRAINT "SubPayApp_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubPayApp" ADD CONSTRAINT "SubPayApp_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubPayApp" ADD CONSTRAINT "SubPayApp_waiverDocumentId_fkey" FOREIGN KEY ("waiverDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SubPayAppLine" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "payAppId" TEXT NOT NULL,
  "sovLineId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "scheduledAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "previousAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "thisPeriodAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "cumulativeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "materialsOnSite" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "approvedPct" DOUBLE PRECISION,
  "capAmount" DECIMAL(18,2),
  "overClaimAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubPayAppLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubPayAppLine_payAppId_sovLineId_key" ON "SubPayAppLine"("payAppId", "sovLineId");
CREATE INDEX "SubPayAppLine_orgId_idx" ON "SubPayAppLine"("orgId");
CREATE INDEX "SubPayAppLine_projectId_payAppId_idx" ON "SubPayAppLine"("projectId", "payAppId");
CREATE INDEX "SubPayAppLine_sovLineId_idx" ON "SubPayAppLine"("sovLineId");
ALTER TABLE "SubPayAppLine" ADD CONSTRAINT "SubPayAppLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubPayAppLine" ADD CONSTRAINT "SubPayAppLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubPayAppLine" ADD CONSTRAINT "SubPayAppLine_payAppId_fkey" FOREIGN KEY ("payAppId") REFERENCES "SubPayApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubPayAppLine" ADD CONSTRAINT "SubPayAppLine_sovLineId_fkey" FOREIGN KEY ("sovLineId") REFERENCES "CommitmentSovLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SubPayAppPayment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "payAppId" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "method" TEXT,
  "reference" TEXT,
  "note" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubPayAppPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SubPayAppPayment_orgId_idx" ON "SubPayAppPayment"("orgId");
CREATE INDEX "SubPayAppPayment_projectId_paidAt_idx" ON "SubPayAppPayment"("projectId", "paidAt");
CREATE INDEX "SubPayAppPayment_payAppId_idx" ON "SubPayAppPayment"("payAppId");
ALTER TABLE "SubPayAppPayment" ADD CONSTRAINT "SubPayAppPayment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubPayAppPayment" ADD CONSTRAINT "SubPayAppPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubPayAppPayment" ADD CONSTRAINT "SubPayAppPayment_payAppId_fkey" FOREIGN KEY ("payAppId") REFERENCES "SubPayApp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
