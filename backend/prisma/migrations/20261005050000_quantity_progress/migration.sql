-- Project-controls programme, wave PC-6 (progress / quantity integration),
-- OCTAPM_PROGRESS_MEASUREMENT.md §3-§4. Two new tables and nothing else:
--
--   QuantityProgressEntry — one installed quantity of one BOQ item on one
--     activity on one day, un-official until status = approved. Installed is
--     always Σ approved entries; no "installed" column is added to BoqItem,
--     Activity, ActivityBoqAllocation, ActivityProgress, ProgressSubmission,
--     IpcItem, StockTransaction or any money table, so received, issued,
--     installed, certified and paid stay five separate truths and EV keeps
--     reading ActivityProgress only.
--   DailyLogQuantity — the daily log's seventh section, shaped like its six
--     siblings (status, party, composite tenant key, clientRequestId replay).
--
-- Tenancy as ENT-3: (projectId, orgId) → Project(id, orgId) plus
-- orgId → Organisation on both tables, so a cross-tenant or orphan row is
-- refused by PostgreSQL. @@unique(projectId, clientRequestId) makes an
-- offline replay idempotent at the database. ON DELETE: org/project/dailyLog
-- CASCADE (the tenant and the log own their rows); activity and boqItem
-- RESTRICT (an entry is source data for an official figure and must not
-- vanish with a hard delete — the activity delete already answers P2003
-- with 409 ACTIVITY_IN_USE); allocation, location, submission, dailyLog(entry)
-- and dailyLogQuantity SET NULL (hints and bundles the entry outlives).
--
-- Additive only: no existing column, index, constraint, enum or default is
-- touched, so no existing row or figure can change. Reversible by dropping
-- the two tables. Generated with `prisma migrate diff` from the schema at
-- 07c64c1 to this one and kept verbatim below; proven on a throwaway
-- database by scripts/db/verify-additive-migration.js and
-- scripts/db/prove-quantity-progress-constraints.js.

-- CreateTable
CREATE TABLE "QuantityProgressEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "allocationId" TEXT,
    "locationId" TEXT,
    "unitCode" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "submissionId" TEXT,
    "dailyLogId" TEXT,
    "dailyLogQuantityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "clientRequestId" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuantityProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLogQuantity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "partyId" TEXT,
    "activityId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "allocationId" TEXT,
    "locationId" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitCode" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "createdBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "clientRequestId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLogQuantity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuantityProgressEntry_orgId_idx" ON "QuantityProgressEntry"("orgId");

-- CreateIndex
CREATE INDEX "QuantityProgressEntry_projectId_activityId_status_idx" ON "QuantityProgressEntry"("projectId", "activityId", "status");

-- CreateIndex
CREATE INDEX "QuantityProgressEntry_projectId_boqItemId_status_idx" ON "QuantityProgressEntry"("projectId", "boqItemId", "status");

-- CreateIndex
CREATE INDEX "QuantityProgressEntry_allocationId_idx" ON "QuantityProgressEntry"("allocationId");

-- CreateIndex
CREATE INDEX "QuantityProgressEntry_locationId_idx" ON "QuantityProgressEntry"("locationId");

-- CreateIndex
CREATE INDEX "QuantityProgressEntry_submissionId_idx" ON "QuantityProgressEntry"("submissionId");

-- CreateIndex
CREATE INDEX "QuantityProgressEntry_dailyLogId_idx" ON "QuantityProgressEntry"("dailyLogId");

-- CreateIndex
CREATE INDEX "QuantityProgressEntry_dailyLogQuantityId_idx" ON "QuantityProgressEntry"("dailyLogQuantityId");

-- CreateIndex
CREATE UNIQUE INDEX "QuantityProgressEntry_projectId_clientRequestId_key" ON "QuantityProgressEntry"("projectId", "clientRequestId");

-- CreateIndex
CREATE INDEX "DailyLogQuantity_dailyLogId_idx" ON "DailyLogQuantity"("dailyLogId");

-- CreateIndex
CREATE INDEX "DailyLogQuantity_projectId_activityId_idx" ON "DailyLogQuantity"("projectId", "activityId");

-- CreateIndex
CREATE INDEX "DailyLogQuantity_projectId_boqItemId_idx" ON "DailyLogQuantity"("projectId", "boqItemId");

-- CreateIndex
CREATE INDEX "DailyLogQuantity_allocationId_idx" ON "DailyLogQuantity"("allocationId");

-- CreateIndex
CREATE INDEX "DailyLogQuantity_locationId_idx" ON "DailyLogQuantity"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLogQuantity_projectId_clientRequestId_key" ON "DailyLogQuantity"("projectId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "QuantityProgressEntry" ADD CONSTRAINT "QuantityProgressEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityProgressEntry" ADD CONSTRAINT "QuantityProgressEntry_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityProgressEntry" ADD CONSTRAINT "QuantityProgressEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityProgressEntry" ADD CONSTRAINT "QuantityProgressEntry_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityProgressEntry" ADD CONSTRAINT "QuantityProgressEntry_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ActivityBoqAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityProgressEntry" ADD CONSTRAINT "QuantityProgressEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityProgressEntry" ADD CONSTRAINT "QuantityProgressEntry_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ProgressSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityProgressEntry" ADD CONSTRAINT "QuantityProgressEntry_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "DailyLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuantityProgressEntry" ADD CONSTRAINT "QuantityProgressEntry_dailyLogQuantityId_fkey" FOREIGN KEY ("dailyLogQuantityId") REFERENCES "DailyLogQuantity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogQuantity" ADD CONSTRAINT "DailyLogQuantity_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogQuantity" ADD CONSTRAINT "DailyLogQuantity_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogQuantity" ADD CONSTRAINT "DailyLogQuantity_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogQuantity" ADD CONSTRAINT "DailyLogQuantity_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogQuantity" ADD CONSTRAINT "DailyLogQuantity_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogQuantity" ADD CONSTRAINT "DailyLogQuantity_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ActivityBoqAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLogQuantity" ADD CONSTRAINT "DailyLogQuantity_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

