-- Expand procurement from shallow order/material rows into supplier, package,
-- PO-line, receipt, activity usage, and lead-time alert workflow tables.

CREATE TABLE "ProcurementSupplier" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "contactName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "tradeCategories" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'approved',
  "leadTimeReliability" DOUBLE PRECISION,
  "notes" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcurementSupplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcurementPackage" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "supplierId" TEXT,
  "activityId" TEXT,
  "packageNumber" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planning',
  "buyer" TEXT,
  "plannedAwardDate" TIMESTAMP(3),
  "requiredOnSiteDate" TIMESTAMP(3),
  "leadWeeks" INTEGER NOT NULL DEFAULT 0,
  "bufferDays" INTEGER NOT NULL DEFAULT 14,
  "notes" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcurementPackage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProcurementOrder"
  ADD COLUMN "packageId" TEXT,
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "orderDate" TIMESTAMP(3),
  ADD COLUMN "requiredBy" TIMESTAMP(3),
  ADD COLUMN "promisedDate" TIMESTAMP(3),
  ADD COLUMN "buyer" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "updatedBy" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "ProcurementPoLine" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "packageId" TEXT,
  "supplierId" TEXT,
  "activityId" TEXT NOT NULL,
  "activityMaterialId" TEXT,
  "materialMasterId" TEXT,
  "lineNumber" INTEGER NOT NULL,
  "itemCode" TEXT,
  "description" TEXT NOT NULL,
  "spec" TEXT,
  "unit" TEXT NOT NULL,
  "orderedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rejectedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "issuedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "consumedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ordered',
  "leadWeeks" INTEGER NOT NULL DEFAULT 0,
  "requiredTiming" TEXT NOT NULL DEFAULT 'activity_start',
  "needOffsetDays" INTEGER NOT NULL DEFAULT 0,
  "bufferDays" INTEGER NOT NULL DEFAULT 14,
  "requiredDate" TIMESTAMP(3),
  "promisedDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcurementPoLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryReceipt" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "packageId" TEXT,
  "supplierId" TEXT,
  "receiptNumber" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedBy" TEXT,
  "warehouseLocation" TEXT,
  "deliveryNote" TEXT,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "notes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryReceiptLine" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "poLineId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "activityMaterialId" TEXT,
  "acceptedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rejectedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "issuedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryReceiptLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MaterialMaster"
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ActivityMaterial"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "materialMasterId" TEXT,
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "procurementPackageId" TEXT,
  ADD COLUMN "code" TEXT,
  ADD COLUMN "spec" TEXT,
  ADD COLUMN "plannedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "requiredDate" TIMESTAMP(3),
  ADD COLUMN "requiredTiming" TEXT NOT NULL DEFAULT 'activity_start',
  ADD COLUMN "needOffsetDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leadWeeks" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bufferDays" INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN "orderByDate" TIMESTAMP(3),
  ADD COLUMN "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "issuedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "consumedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "wasteQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'planned',
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "updatedBy" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ActivityMaterial" AS am
SET
  "projectId" = a."projectId",
  "plannedQty" = am."qty"
FROM "Activity" AS a
WHERE am."activityId" = a."id";

ALTER TABLE "ActivityMaterial" ALTER COLUMN "projectId" SET NOT NULL;

CREATE TABLE "ActivityMaterialUsage" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "activityMaterialId" TEXT NOT NULL,
  "poLineId" TEXT,
  "receiptLineId" TEXT,
  "usedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "wasteQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "usageDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "installedLocation" TEXT,
  "recordedBy" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityMaterialUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcurementLeadTimeAlert" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "activityId" TEXT,
  "packageId" TEXT,
  "orderId" TEXT,
  "poLineId" TEXT,
  "activityMaterialId" TEXT,
  "severity" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "daysAtRisk" INTEGER NOT NULL DEFAULT 0,
  "needDate" TIMESTAMP(3),
  "orderByDate" TIMESTAMP(3),
  "expectedDeliveryDate" TIMESTAMP(3),
  "acknowledgedBy" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcurementLeadTimeAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcurementSupplier_projectId_name_key" ON "ProcurementSupplier"("projectId", "name");
CREATE INDEX "ProcurementSupplier_projectId_idx" ON "ProcurementSupplier"("projectId");
CREATE INDEX "ProcurementSupplier_projectId_status_idx" ON "ProcurementSupplier"("projectId", "status");

CREATE UNIQUE INDEX "ProcurementPackage_projectId_packageNumber_key" ON "ProcurementPackage"("projectId", "packageNumber");
CREATE INDEX "ProcurementPackage_projectId_idx" ON "ProcurementPackage"("projectId");
CREATE INDEX "ProcurementPackage_supplierId_idx" ON "ProcurementPackage"("supplierId");
CREATE INDEX "ProcurementPackage_activityId_idx" ON "ProcurementPackage"("activityId");
CREATE INDEX "ProcurementPackage_projectId_status_idx" ON "ProcurementPackage"("projectId", "status");

CREATE INDEX "ProcurementOrder_packageId_idx" ON "ProcurementOrder"("packageId");
CREATE INDEX "ProcurementOrder_supplierId_idx" ON "ProcurementOrder"("supplierId");

CREATE UNIQUE INDEX "ProcurementPoLine_orderId_lineNumber_key" ON "ProcurementPoLine"("orderId", "lineNumber");
CREATE INDEX "ProcurementPoLine_projectId_idx" ON "ProcurementPoLine"("projectId");
CREATE INDEX "ProcurementPoLine_orderId_idx" ON "ProcurementPoLine"("orderId");
CREATE INDEX "ProcurementPoLine_packageId_idx" ON "ProcurementPoLine"("packageId");
CREATE INDEX "ProcurementPoLine_supplierId_idx" ON "ProcurementPoLine"("supplierId");
CREATE INDEX "ProcurementPoLine_activityId_idx" ON "ProcurementPoLine"("activityId");
CREATE INDEX "ProcurementPoLine_activityMaterialId_idx" ON "ProcurementPoLine"("activityMaterialId");
CREATE INDEX "ProcurementPoLine_projectId_status_idx" ON "ProcurementPoLine"("projectId", "status");
CREATE INDEX "ProcurementPoLine_projectId_requiredDate_idx" ON "ProcurementPoLine"("projectId", "requiredDate");
CREATE INDEX "ProcurementPoLine_projectId_promisedDate_idx" ON "ProcurementPoLine"("projectId", "promisedDate");

CREATE UNIQUE INDEX "DeliveryReceipt_projectId_receiptNumber_key" ON "DeliveryReceipt"("projectId", "receiptNumber");
CREATE INDEX "DeliveryReceipt_projectId_idx" ON "DeliveryReceipt"("projectId");
CREATE INDEX "DeliveryReceipt_orderId_idx" ON "DeliveryReceipt"("orderId");
CREATE INDEX "DeliveryReceipt_packageId_idx" ON "DeliveryReceipt"("packageId");
CREATE INDEX "DeliveryReceipt_supplierId_idx" ON "DeliveryReceipt"("supplierId");
CREATE INDEX "DeliveryReceipt_projectId_receivedAt_idx" ON "DeliveryReceipt"("projectId", "receivedAt");

CREATE INDEX "DeliveryReceiptLine_projectId_idx" ON "DeliveryReceiptLine"("projectId");
CREATE INDEX "DeliveryReceiptLine_receiptId_idx" ON "DeliveryReceiptLine"("receiptId");
CREATE INDEX "DeliveryReceiptLine_orderId_idx" ON "DeliveryReceiptLine"("orderId");
CREATE INDEX "DeliveryReceiptLine_poLineId_idx" ON "DeliveryReceiptLine"("poLineId");
CREATE INDEX "DeliveryReceiptLine_activityId_idx" ON "DeliveryReceiptLine"("activityId");
CREATE INDEX "DeliveryReceiptLine_activityMaterialId_idx" ON "DeliveryReceiptLine"("activityMaterialId");

CREATE INDEX "MaterialMaster_supplierId_idx" ON "MaterialMaster"("supplierId");
CREATE INDEX "MaterialMaster_projectId_code_idx" ON "MaterialMaster"("projectId", "code");

CREATE INDEX "ActivityMaterial_projectId_idx" ON "ActivityMaterial"("projectId");
CREATE INDEX "ActivityMaterial_projectId_activityId_idx" ON "ActivityMaterial"("projectId", "activityId");
CREATE INDEX "ActivityMaterial_materialMasterId_idx" ON "ActivityMaterial"("materialMasterId");
CREATE INDEX "ActivityMaterial_supplierId_idx" ON "ActivityMaterial"("supplierId");
CREATE INDEX "ActivityMaterial_procurementPackageId_idx" ON "ActivityMaterial"("procurementPackageId");
CREATE INDEX "ActivityMaterial_projectId_status_idx" ON "ActivityMaterial"("projectId", "status");
CREATE INDEX "ActivityMaterial_projectId_requiredDate_idx" ON "ActivityMaterial"("projectId", "requiredDate");

CREATE INDEX "ActivityMaterialUsage_projectId_idx" ON "ActivityMaterialUsage"("projectId");
CREATE INDEX "ActivityMaterialUsage_activityId_idx" ON "ActivityMaterialUsage"("activityId");
CREATE INDEX "ActivityMaterialUsage_activityMaterialId_idx" ON "ActivityMaterialUsage"("activityMaterialId");
CREATE INDEX "ActivityMaterialUsage_poLineId_idx" ON "ActivityMaterialUsage"("poLineId");
CREATE INDEX "ActivityMaterialUsage_receiptLineId_idx" ON "ActivityMaterialUsage"("receiptLineId");
CREATE INDEX "ActivityMaterialUsage_projectId_usageDate_idx" ON "ActivityMaterialUsage"("projectId", "usageDate");

CREATE UNIQUE INDEX "ProcurementLeadTimeAlert_projectId_poLineId_key" ON "ProcurementLeadTimeAlert"("projectId", "poLineId");
CREATE UNIQUE INDEX "ProcurementLeadTimeAlert_projectId_activityMaterialId_key" ON "ProcurementLeadTimeAlert"("projectId", "activityMaterialId");
CREATE INDEX "ProcurementLeadTimeAlert_projectId_idx" ON "ProcurementLeadTimeAlert"("projectId");
CREATE INDEX "ProcurementLeadTimeAlert_activityId_idx" ON "ProcurementLeadTimeAlert"("activityId");
CREATE INDEX "ProcurementLeadTimeAlert_packageId_idx" ON "ProcurementLeadTimeAlert"("packageId");
CREATE INDEX "ProcurementLeadTimeAlert_orderId_idx" ON "ProcurementLeadTimeAlert"("orderId");
CREATE INDEX "ProcurementLeadTimeAlert_poLineId_idx" ON "ProcurementLeadTimeAlert"("poLineId");
CREATE INDEX "ProcurementLeadTimeAlert_activityMaterialId_idx" ON "ProcurementLeadTimeAlert"("activityMaterialId");
CREATE INDEX "ProcurementLeadTimeAlert_projectId_severity_status_idx" ON "ProcurementLeadTimeAlert"("projectId", "severity", "status");

ALTER TABLE "ProcurementSupplier" ADD CONSTRAINT "ProcurementSupplier_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcurementPackage" ADD CONSTRAINT "ProcurementPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcurementPackage" ADD CONSTRAINT "ProcurementPackage_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcurementSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementPackage" ADD CONSTRAINT "ProcurementPackage_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementOrder" ADD CONSTRAINT "ProcurementOrder_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ProcurementPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementOrder" ADD CONSTRAINT "ProcurementOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcurementSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementPoLine" ADD CONSTRAINT "ProcurementPoLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcurementPoLine" ADD CONSTRAINT "ProcurementPoLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProcurementOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcurementPoLine" ADD CONSTRAINT "ProcurementPoLine_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ProcurementPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementPoLine" ADD CONSTRAINT "ProcurementPoLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcurementSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementPoLine" ADD CONSTRAINT "ProcurementPoLine_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcurementPoLine" ADD CONSTRAINT "ProcurementPoLine_activityMaterialId_fkey" FOREIGN KEY ("activityMaterialId") REFERENCES "ActivityMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementPoLine" ADD CONSTRAINT "ProcurementPoLine_materialMasterId_fkey" FOREIGN KEY ("materialMasterId") REFERENCES "MaterialMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProcurementOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ProcurementPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcurementSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceiptLine" ADD CONSTRAINT "DeliveryReceiptLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceiptLine" ADD CONSTRAINT "DeliveryReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "DeliveryReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceiptLine" ADD CONSTRAINT "DeliveryReceiptLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProcurementOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceiptLine" ADD CONSTRAINT "DeliveryReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "ProcurementPoLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceiptLine" ADD CONSTRAINT "DeliveryReceiptLine_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceiptLine" ADD CONSTRAINT "DeliveryReceiptLine_activityMaterialId_fkey" FOREIGN KEY ("activityMaterialId") REFERENCES "ActivityMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaterialMaster" ADD CONSTRAINT "MaterialMaster_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcurementSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterial" ADD CONSTRAINT "ActivityMaterial_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterial" ADD CONSTRAINT "ActivityMaterial_materialMasterId_fkey" FOREIGN KEY ("materialMasterId") REFERENCES "MaterialMaster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterial" ADD CONSTRAINT "ActivityMaterial_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcurementSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterial" ADD CONSTRAINT "ActivityMaterial_procurementPackageId_fkey" FOREIGN KEY ("procurementPackageId") REFERENCES "ProcurementPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterialUsage" ADD CONSTRAINT "ActivityMaterialUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterialUsage" ADD CONSTRAINT "ActivityMaterialUsage_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterialUsage" ADD CONSTRAINT "ActivityMaterialUsage_activityMaterialId_fkey" FOREIGN KEY ("activityMaterialId") REFERENCES "ActivityMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterialUsage" ADD CONSTRAINT "ActivityMaterialUsage_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "ProcurementPoLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterialUsage" ADD CONSTRAINT "ActivityMaterialUsage_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "DeliveryReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementLeadTimeAlert" ADD CONSTRAINT "ProcurementLeadTimeAlert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcurementLeadTimeAlert" ADD CONSTRAINT "ProcurementLeadTimeAlert_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementLeadTimeAlert" ADD CONSTRAINT "ProcurementLeadTimeAlert_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ProcurementPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementLeadTimeAlert" ADD CONSTRAINT "ProcurementLeadTimeAlert_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProcurementOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcurementLeadTimeAlert" ADD CONSTRAINT "ProcurementLeadTimeAlert_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "ProcurementPoLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcurementLeadTimeAlert" ADD CONSTRAINT "ProcurementLeadTimeAlert_activityMaterialId_fkey" FOREIGN KEY ("activityMaterialId") REFERENCES "ActivityMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
