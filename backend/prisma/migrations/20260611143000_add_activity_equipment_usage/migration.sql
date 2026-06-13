-- Normalize approved daily-report equipment usage for activity utilization,
-- audit history, and official equipment cost posting.

CREATE TABLE "ActivityEquipmentUsage" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "equipmentId" TEXT,
  "dailyReportId" TEXT,
  "sourceLineIndex" INTEGER,
  "equipmentName" TEXT NOT NULL,
  "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rateType" TEXT,
  "rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "costAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "usageDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "recordedBy" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityEquipmentUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActivityEquipmentUsage_dailyReportId_sourceLineIndex_key" ON "ActivityEquipmentUsage"("dailyReportId", "sourceLineIndex");
CREATE INDEX "ActivityEquipmentUsage_projectId_idx" ON "ActivityEquipmentUsage"("projectId");
CREATE INDEX "ActivityEquipmentUsage_activityId_idx" ON "ActivityEquipmentUsage"("activityId");
CREATE INDEX "ActivityEquipmentUsage_equipmentId_idx" ON "ActivityEquipmentUsage"("equipmentId");
CREATE INDEX "ActivityEquipmentUsage_dailyReportId_idx" ON "ActivityEquipmentUsage"("dailyReportId");
CREATE INDEX "ActivityEquipmentUsage_projectId_activityId_idx" ON "ActivityEquipmentUsage"("projectId", "activityId");
CREATE INDEX "ActivityEquipmentUsage_projectId_usageDate_idx" ON "ActivityEquipmentUsage"("projectId", "usageDate");
CREATE INDEX "ActivityEquipmentUsage_projectId_status_idx" ON "ActivityEquipmentUsage"("projectId", "status");

ALTER TABLE "ActivityEquipmentUsage" ADD CONSTRAINT "ActivityEquipmentUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActivityEquipmentUsage" ADD CONSTRAINT "ActivityEquipmentUsage_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityEquipmentUsage" ADD CONSTRAINT "ActivityEquipmentUsage_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityEquipmentUsage" ADD CONSTRAINT "ActivityEquipmentUsage_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
