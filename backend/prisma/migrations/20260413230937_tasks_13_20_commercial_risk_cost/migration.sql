/*
  Warnings:

  - Added the required column `updatedAt` to the `ChangeOrder` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `IpcItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ChangeOrder" ADD COLUMN     "activityId" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "CostRecord" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "IpcItem" ADD COLUMN     "certDate" TIMESTAMP(3),
ADD COLUMN     "ipcCertificateId" TEXT,
ADD COLUMN     "ipcPeriod" TEXT NOT NULL DEFAULT 'IPC-1',
ADD COLUMN     "netPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "retentionRate" DOUBLE PRECISION NOT NULL DEFAULT 5,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "IpcCertificate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "totalCert" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRet" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpcCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Risk" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "probability" TEXT NOT NULL DEFAULT 'medium',
    "impact" TEXT NOT NULL DEFAULT 'medium',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "mitigation" TEXT,
    "phase" TEXT,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LongLeadItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "item" TEXT NOT NULL,
    "leadWeeks" INTEGER NOT NULL DEFAULT 0,
    "orderBy" TEXT,
    "criticality" TEXT,
    "risk" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_ordered',
    "supplier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LongLeadItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BurnRateEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "category" TEXT,
    "note" TEXT,

    CONSTRAINT "BurnRateEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IpcCertificate_projectId_idx" ON "IpcCertificate"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "IpcCertificate_projectId_period_key" ON "IpcCertificate"("projectId", "period");

-- CreateIndex
CREATE INDEX "Risk_projectId_idx" ON "Risk"("projectId");

-- CreateIndex
CREATE INDEX "LongLeadItem_projectId_idx" ON "LongLeadItem"("projectId");

-- CreateIndex
CREATE INDEX "BurnRateEntry_projectId_idx" ON "BurnRateEntry"("projectId");

-- CreateIndex
CREATE INDEX "BurnRateEntry_date_idx" ON "BurnRateEntry"("date");

-- CreateIndex
CREATE INDEX "IpcItem_ipcCertificateId_idx" ON "IpcItem"("ipcCertificateId");

-- AddForeignKey
ALTER TABLE "ChangeOrder" ADD CONSTRAINT "ChangeOrder_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpcItem" ADD CONSTRAINT "IpcItem_ipcCertificateId_fkey" FOREIGN KEY ("ipcCertificateId") REFERENCES "IpcCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpcCertificate" ADD CONSTRAINT "IpcCertificate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LongLeadItem" ADD CONSTRAINT "LongLeadItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LongLeadItem" ADD CONSTRAINT "LongLeadItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BurnRateEntry" ADD CONSTRAINT "BurnRateEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
