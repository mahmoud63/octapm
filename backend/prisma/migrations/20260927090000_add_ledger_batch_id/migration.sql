-- Migration batch id on cost ledger entries (OCTA-FIN-MIGRATE-062).
--
-- Actual cost that predates the ledger cannot be reconstructed from source
-- transactions, so it is represented explicitly as a `legacy_opening_balance`
-- entry rather than being pretended into an invoice or a pay application.
-- `batchId` says which migration run created it, so a batch can be found,
-- audited or reversed as a unit.

ALTER TABLE "CostLedgerEntry" ADD COLUMN "batchId" TEXT;

CREATE INDEX "CostLedgerEntry_batchId_idx" ON "CostLedgerEntry"("batchId");
