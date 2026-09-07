-- The client contract (OCTA-COM-PRIME-051).
--
-- PrimeContract holds the commercial envelope the BOQ cannot: original value,
-- what approved client change orders did to it, and the terms that turn
-- certified work into a sum of money. PrimeContractAdvance is the append-only
-- ledger of the advance payment and every recovery taken out of a certificate.
--
-- The IpcCertificate columns all default to zero, so certificates raised
-- before a contract existed read exactly as they always did.

-- AlterTable
ALTER TABLE "IpcCertificate" ADD COLUMN     "advanceRecovery" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deductionsNote" TEXT,
ADD COLUMN     "grossThisPeriod" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "materialsOnSite" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- An existing certificate's gross is what it certified: no stored materials
-- were tracked before this migration.
UPDATE "IpcCertificate" SET "grossThisPeriod" = "totalCert";

-- CreateTable
CREATE TABLE "PrimeContract" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientCompanyId" TEXT,
    "contractType" TEXT NOT NULL DEFAULT 'lump_sum',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "originalValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "approvedChangesValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pendingChangesValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "revisedValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "retentionRate" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "retentionCapRate" DOUBLE PRECISION,
    "advanceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advanceAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advancePaidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceRecoveryRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "advanceRecoveredAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "materialsOnSiteRate" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "startDate" TIMESTAMP(3),
    "completionDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrimeContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrimeContractAdvance" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'payment',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "certificateId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrimeContractAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrimeContract_projectId_key" ON "PrimeContract"("projectId");

-- CreateIndex
CREATE INDEX "PrimeContract_orgId_idx" ON "PrimeContract"("orgId");

-- CreateIndex
CREATE INDEX "PrimeContract_clientCompanyId_idx" ON "PrimeContract"("clientCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimeContract_orgId_ref_key" ON "PrimeContract"("orgId", "ref");

-- CreateIndex
CREATE INDEX "PrimeContractAdvance_orgId_idx" ON "PrimeContractAdvance"("orgId");

-- CreateIndex
CREATE INDEX "PrimeContractAdvance_contractId_kind_idx" ON "PrimeContractAdvance"("contractId", "kind");

-- CreateIndex
CREATE INDEX "PrimeContractAdvance_certificateId_idx" ON "PrimeContractAdvance"("certificateId");

-- CreateIndex
CREATE UNIQUE INDEX "PrimeContractAdvance_projectId_reference_key" ON "PrimeContractAdvance"("projectId", "reference");

-- AddForeignKey
ALTER TABLE "PrimeContract" ADD CONSTRAINT "PrimeContract_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimeContract" ADD CONSTRAINT "PrimeContract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimeContract" ADD CONSTRAINT "PrimeContract_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimeContractAdvance" ADD CONSTRAINT "PrimeContractAdvance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimeContractAdvance" ADD CONSTRAINT "PrimeContractAdvance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrimeContractAdvance" ADD CONSTRAINT "PrimeContractAdvance_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PrimeContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
