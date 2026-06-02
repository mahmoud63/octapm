-- Captures schema changes that were applied to the Prisma schema but never
-- recorded as a migration (BoqActivity / ExtraServicesConfig tables and the
-- extra BoqItem columns). Generated with `prisma migrate diff`.

-- DropForeignKey
ALTER TABLE "ResourceAllocation" DROP CONSTRAINT "ResourceAllocation_projectId_fkey";

-- DropForeignKey
ALTER TABLE "WeeklyReport" DROP CONSTRAINT "WeeklyReport_projectId_fkey";

-- AlterTable
ALTER TABLE "BoqItem" ADD COLUMN     "code" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "BoqActivity" (
    "id" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityCode" TEXT NOT NULL,
    "activityName" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "budget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dependencyType" TEXT,
    "predecessorCode" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoqActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraServicesConfig" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExtraServicesConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoqActivity_boqItemId_idx" ON "BoqActivity"("boqItemId");

-- CreateIndex
CREATE INDEX "BoqActivity_projectId_idx" ON "BoqActivity"("projectId");

-- CreateIndex
CREATE INDEX "BoqActivity_projectId_activityCode_idx" ON "BoqActivity"("projectId", "activityCode");

-- AddForeignKey
ALTER TABLE "BoqActivity" ADD CONSTRAINT "BoqActivity_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoqActivity" ADD CONSTRAINT "BoqActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
