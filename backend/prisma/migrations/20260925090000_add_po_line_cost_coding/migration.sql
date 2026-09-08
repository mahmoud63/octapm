-- Cost coding on purchase-order lines (OCTA-FIN-POLINE-060).
-- A PO line could carry an activity but not a cost code or budget line, so the
-- coding was typed for the first time on the supplier invoice — by finance,
-- who were not the buyer. These let the buyer code the order when they raise
-- it, while they still know what it is for.
--
-- All three are nullable on purpose: a line for a service or a re-charge need
-- not hit the budget. `updatedAt` is deliberately left alone; the diff wants to
-- drop its default, which is unrelated drift.

ALTER TABLE "ProcurementPoLine" ADD COLUMN "costCodeId" TEXT;
ALTER TABLE "ProcurementPoLine" ADD COLUMN "budgetLineId" TEXT;
ALTER TABLE "ProcurementPoLine" ADD COLUMN "boqItemId" TEXT;

CREATE INDEX "ProcurementPoLine_costCodeId_idx" ON "ProcurementPoLine"("costCodeId");
CREATE INDEX "ProcurementPoLine_budgetLineId_idx" ON "ProcurementPoLine"("budgetLineId");
