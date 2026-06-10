ALTER TABLE "LongLeadItem"
  ADD COLUMN "requiredTiming" TEXT NOT NULL DEFAULT 'activity_start',
  ADD COLUMN "needOffsetDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bufferDays" INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN "expectedDeliveryDate" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3),
  ADD COLUMN "warehouseStatus" TEXT NOT NULL DEFAULT 'not_received';

ALTER TABLE "ProcurementOrder"
  ADD COLUMN "requiredTiming" TEXT NOT NULL DEFAULT 'activity_start',
  ADD COLUMN "needOffsetDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bufferDays" INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN "warehouseStatus" TEXT NOT NULL DEFAULT 'not_received',
  ADD COLUMN "receivedAt" TIMESTAMP(3),
  ADD COLUMN "issuedAt" TIMESTAMP(3);

CREATE INDEX "LongLeadItem_activityId_idx" ON "LongLeadItem"("activityId");
CREATE INDEX "LongLeadItem_projectId_status_idx" ON "LongLeadItem"("projectId", "status");
CREATE INDEX "LongLeadItem_projectId_warehouseStatus_idx" ON "LongLeadItem"("projectId", "warehouseStatus");

CREATE INDEX "ProcurementOrder_activityId_idx" ON "ProcurementOrder"("activityId");
CREATE INDEX "ProcurementOrder_projectId_status_idx" ON "ProcurementOrder"("projectId", "status");
CREATE INDEX "ProcurementOrder_projectId_warehouseStatus_idx" ON "ProcurementOrder"("projectId", "warehouseStatus");
