-- The purchase order lifecycle (OCTA-COM-PO-053).
--
-- A purchase order has three states, not one: where it is commercially
-- (status), how much of it has turned up (warehouseStatus) and how much has
-- been billed (invoiceStatus). An order that is fully delivered and half
-- invoiced cannot pick one of those as "the" status, so the API derives a
-- single lifecycle name from all three instead of forcing the database to.

-- AlterTable
ALTER TABLE "ProcurementOrder" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedBy" TEXT,
ADD COLUMN     "acknowledgedRef" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedBy" TEXT,
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryLocationId" TEXT,
ADD COLUMN     "deliveryTerms" TEXT,
ADD COLUMN     "invoiceStatus" TEXT NOT NULL DEFAULT 'not_invoiced',
ADD COLUMN     "invoicedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedBy" TEXT,
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedBy" TEXT,
ADD COLUMN     "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Existing orders carried no tax, so their value is their subtotal.
UPDATE "ProcurementOrder" SET "subtotal" = "value";

-- "partial" and "received" were fulfilment states stored in the commercial
-- column. warehouseStatus already carries the same fact, so the commercial
-- status becomes what it always meant: the order is issued.
UPDATE "ProcurementOrder"
SET "warehouseStatus" = 'partial'
WHERE "status" = 'partial' AND "warehouseStatus" = 'not_received';

UPDATE "ProcurementOrder"
SET "warehouseStatus" = 'received'
WHERE "status" = 'received' AND "warehouseStatus" <> 'received';

UPDATE "ProcurementOrder"
SET "status" = 'issued'
WHERE "status" IN ('partial', 'received');

-- An order with a supplier invoice against it has already been billed in part.
UPDATE "ProcurementOrder" AS o
SET "invoicedAmount" = billed.total,
    "invoiceStatus" = CASE
      WHEN billed.total >= o."value" - 0.01 THEN 'fully_invoiced'
      ELSE 'partially_invoiced'
    END
FROM (
  SELECT "purchaseOrderId" AS order_id, SUM("total") AS total
  FROM "DirectCost"
  WHERE "purchaseOrderId" IS NOT NULL AND "status" <> 'void'
  GROUP BY "purchaseOrderId"
) AS billed
WHERE o."id" = billed.order_id AND billed.total > 0;

-- CreateIndex
CREATE INDEX "ProcurementOrder_deliveryLocationId_idx" ON "ProcurementOrder"("deliveryLocationId");

-- CreateIndex
CREATE INDEX "ProcurementOrder_projectId_invoiceStatus_idx" ON "ProcurementOrder"("projectId", "invoiceStatus");

-- AddForeignKey
ALTER TABLE "ProcurementOrder" ADD CONSTRAINT "ProcurementOrder_deliveryLocationId_fkey" FOREIGN KEY ("deliveryLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
