-- Legacy subcontractor valuations named their subcontractor in free text, with
-- no company behind it (OCTA-FIN-SUBVAL-064). Subcontract commitments and their
-- payment applications replaced them: those name a company, post to the cost
-- ledger, and carry retention and payments of their own.
--
-- The rows are kept. What stops is new ones: a free-text party is exactly the
-- record nothing downstream can follow. Historical rows can be attributed to a
-- company where the name resolves — reported, never merged automatically — and
-- the free text stays alongside as what was actually written at the time.
ALTER TABLE "SubValuation" ADD COLUMN "companyId" TEXT;

ALTER TABLE "SubValuation"
  ADD CONSTRAINT "SubValuation_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SubValuation_companyId_idx" ON "SubValuation"("companyId");
