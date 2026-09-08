-- Let a bid package say which procurement package it is pricing.
--
-- Comparing supplier quotes for materials is the same job as levelling
-- subcontract bids, and the bid engine already does it: BidPackage.commitmentType
-- accepts "purchase_order". What was missing was any connection back to the
-- procurement package being priced, so a buyer had to go to Commercial, know to
-- choose the right commitment type, and then keep the two in their head.
--
-- Nullable: subcontract bidding has no procurement package behind it.
--
-- ON DELETE SET NULL rather than CASCADE: the quotes and the award decision are
-- a record of what was asked and answered, and deleting the package must not
-- erase them.
ALTER TABLE "BidPackage" ADD COLUMN "procurementPackageId" TEXT;

CREATE INDEX "BidPackage_procurementPackageId_idx" ON "BidPackage"("procurementPackageId");

ALTER TABLE "BidPackage" ADD CONSTRAINT "BidPackage_procurementPackageId_fkey"
  FOREIGN KEY ("procurementPackageId") REFERENCES "ProcurementPackage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
