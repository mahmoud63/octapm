-- Links a purchase order to what turned up and what was billed, so the three
-- can be matched (OCTA-INV-STOCK-050).
--
-- Written by hand rather than generated: `prisma migrate dev` also tries to
-- reconcile this schema's pre-existing drift and fails. See
-- 20260915090000_add_inventory_warehouse for the same note.

-- PO line → the stocked item it becomes on goods receipt.
ALTER TABLE "ProcurementPoLine" ADD COLUMN "inventoryItemId" TEXT;

-- Supplier invoice → the order it is against.
ALTER TABLE "DirectCost" ADD COLUMN "purchaseOrderId" TEXT;

-- Invoice line → the ordered line it bills.
ALTER TABLE "DirectCostLine" ADD COLUMN "poLineId" TEXT;

-- CreateIndex
CREATE INDEX "ProcurementPoLine_inventoryItemId_idx" ON "ProcurementPoLine"("inventoryItemId");

-- CreateIndex
CREATE INDEX "DirectCost_purchaseOrderId_idx" ON "DirectCost"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "DirectCostLine_poLineId_idx" ON "DirectCostLine"("poLineId");

-- AddForeignKey
ALTER TABLE "ProcurementPoLine" ADD CONSTRAINT "ProcurementPoLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectCost" ADD CONSTRAINT "DirectCost_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "ProcurementOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectCostLine" ADD CONSTRAINT "DirectCostLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "ProcurementPoLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
