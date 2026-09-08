-- Link a long-lead item to the procurement package it is being bought under.
--
-- ProcurementPackage and LongLeadItem carried the same six facts — required on
-- site, required timing, need offset, lead weeks, buffer, latest order date —
-- with nothing joining them, so the planner and the buyer maintained the same
-- dates and statuses separately and the register could not see what had
-- actually been ordered.
--
-- Nullable on purpose. A long-lead item is registered before anything is
-- ordered, which is the whole point of the register; while the link is null the
-- item behaves exactly as it did. Once it is set, status, expected delivery and
-- delivered-at are derived from the package, its orders and its deliveries.
--
-- ON DELETE SET NULL: removing a package must not take the planner's register
-- entry with it — the requirement outlives the way it was bought.
ALTER TABLE "LongLeadItem" ADD COLUMN "procurementPackageId" TEXT;

CREATE INDEX "LongLeadItem_procurementPackageId_idx" ON "LongLeadItem"("procurementPackageId");

ALTER TABLE "LongLeadItem" ADD CONSTRAINT "LongLeadItem_procurementPackageId_fkey"
  FOREIGN KEY ("procurementPackageId") REFERENCES "ProcurementPackage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
