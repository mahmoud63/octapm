-- AlterTable
ALTER TABLE "BimElementLink" ADD COLUMN     "factor" DOUBLE PRECISION,
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "quantity" DOUBLE PRECISION,
ADD COLUMN     "quantityField" TEXT,
ADD COLUMN     "rawQuantity" DOUBLE PRECISION,
ADD COLUMN     "unit" TEXT;

-- CreateTable
CREATE TABLE "BimMeasurementRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "quantityField" TEXT NOT NULL,
    "allowedTypes" JSONB NOT NULL DEFAULT '[]',
    "factor" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rounding" INTEGER NOT NULL DEFAULT 3,
    "unit" TEXT,
    "includeText" TEXT,
    "excludeText" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BimMeasurementRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BimChangeReview" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "fromModelId" TEXT NOT NULL,
    "toModelId" TEXT NOT NULL,
    "globalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "changeEventId" TEXT,
    "note" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BimChangeReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BimMeasurementRule_orgId_idx" ON "BimMeasurementRule"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "BimMeasurementRule_projectId_boqItemId_key" ON "BimMeasurementRule"("projectId", "boqItemId");

-- CreateIndex
CREATE INDEX "BimChangeReview_orgId_idx" ON "BimChangeReview"("orgId");

-- CreateIndex
CREATE INDEX "BimChangeReview_projectId_status_idx" ON "BimChangeReview"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BimChangeReview_toModelId_globalId_key" ON "BimChangeReview"("toModelId", "globalId");

-- AddForeignKey
ALTER TABLE "BimMeasurementRule" ADD CONSTRAINT "BimMeasurementRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BimMeasurementRule" ADD CONSTRAINT "BimMeasurementRule_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BimMeasurementRule" ADD CONSTRAINT "BimMeasurementRule_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BimChangeReview" ADD CONSTRAINT "BimChangeReview_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BimChangeReview" ADD CONSTRAINT "BimChangeReview_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

