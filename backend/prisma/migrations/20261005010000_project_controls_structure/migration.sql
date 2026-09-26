-- Project-controls programme, wave PC-1 (structure). Everything here is
-- additive: two new tables, nullable or defaulted columns on four existing
-- ones, and indexes and foreign keys that only constrain new rows. No row is
-- rewritten: Activity.wbsCode, dependencies and allocations are untouched;
-- activation of a schedule revision sets Activity.wbsNodeId from now on.
--
-- WbsNode carries orgId beside projectId with a composite foreign key to
-- Project(id, orgId) (ENT-1 added that unique pair), so Postgres refuses a
-- node filed under another organisation's project regardless of which
-- service wrote it.

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "wbsNodeId" TEXT;

-- AlterTable
ALTER TABLE "ActivityBoqAllocation" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "unitCode" TEXT;

-- AlterTable
ALTER TABLE "BoqItem" ADD COLUMN     "costCodeId" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "mappingRule" TEXT NOT NULL DEFAULT 'required',
ADD COLUMN     "unitCode" TEXT,
ADD COLUMN     "wbsNodeId" TEXT;

-- AlterTable
ALTER TABLE "ProgressSubmission" ADD COLUMN     "locationId" TEXT;

-- CreateTable
CREATE TABLE "WbsNode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "isPackage" BOOLEAN NOT NULL DEFAULT false,
    "ownerPartyId" TEXT,
    "commitmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WbsNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliasesJson" JSONB NOT NULL DEFAULT '[]',
    "dimension" TEXT NOT NULL DEFAULT 'count',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WbsNode_orgId_idx" ON "WbsNode"("orgId");

-- CreateIndex
CREATE INDEX "WbsNode_projectId_path_idx" ON "WbsNode"("projectId", "path");

-- CreateIndex
CREATE INDEX "WbsNode_projectId_parentId_sortOrder_idx" ON "WbsNode"("projectId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "WbsNode_projectId_externalId_idx" ON "WbsNode"("projectId", "externalId");

-- CreateIndex
CREATE INDEX "WbsNode_parentId_idx" ON "WbsNode"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "WbsNode_projectId_code_key" ON "WbsNode"("projectId", "code");

-- CreateIndex
CREATE INDEX "UnitOfMeasure_orgId_status_idx" ON "UnitOfMeasure"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_orgId_code_key" ON "UnitOfMeasure"("orgId", "code");

-- CreateIndex
CREATE INDEX "Activity_wbsNodeId_idx" ON "Activity"("wbsNodeId");

-- CreateIndex
CREATE INDEX "Activity_locationId_idx" ON "Activity"("locationId");

-- CreateIndex
CREATE INDEX "ActivityBoqAllocation_locationId_idx" ON "ActivityBoqAllocation"("locationId");

-- CreateIndex
CREATE INDEX "BoqItem_wbsNodeId_idx" ON "BoqItem"("wbsNodeId");

-- CreateIndex
CREATE INDEX "BoqItem_locationId_idx" ON "BoqItem"("locationId");

-- CreateIndex
CREATE INDEX "BoqItem_costCodeId_idx" ON "BoqItem"("costCodeId");

-- CreateIndex
CREATE INDEX "ProgressSubmission_locationId_idx" ON "ProgressSubmission"("locationId");

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityBoqAllocation" ADD CONSTRAINT "ActivityBoqAllocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressSubmission" ADD CONSTRAINT "ProgressSubmission_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WbsNode" ADD CONSTRAINT "WbsNode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WbsNode" ADD CONSTRAINT "WbsNode_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WbsNode" ADD CONSTRAINT "WbsNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WbsNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitOfMeasure" ADD CONSTRAINT "UnitOfMeasure_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
