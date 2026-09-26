-- Enterprise programme, step M7 — StockTransaction's tenant key nulls only the project (wave ENT-3, review fix).
--
-- Batch 2 gave StockTransaction's (projectId, orgId) → Project(id, orgId)
-- key a bare ON DELETE SET NULL, which nulls BOTH columns of the pair. orgId
-- is NOT NULL, so a hard delete of any project that has a stock movement
-- failed on the transaction row rather than on a foreign key — an error the
-- E2E reset and the live kit cannot clear by name. No product path hard
-- deletes a project (archive is soft), but those two scripts do.
--
-- The key is dropped and re-added with the column-list form (PostgreSQL 15+)
-- the master keys of 021000 already use: only projectId is nulled, the row
-- keeps its organisation and its warehouse. NOT VALID + VALIDATE as in every
-- batch, and idempotent: a key that already names its SET NULL column is
-- left alone.
DO $$
DECLARE
  set_cols smallint[];
BEGIN
  SELECT c.confdelsetcols INTO set_cols FROM pg_constraint c
   WHERE c.conrelid = '"StockTransaction"'::regclass AND c.conname = 'StockTransaction_projectId_orgId_fkey';
  IF FOUND AND (set_cols IS NULL OR array_length(set_cols, 1) IS NULL) THEN
    ALTER TABLE "StockTransaction" DROP CONSTRAINT "StockTransaction_projectId_orgId_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"StockTransaction"'::regclass AND conname = 'StockTransaction_projectId_orgId_fkey') THEN
    ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_projectId_orgId_fkey"
      FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId")
      ON DELETE SET NULL ("projectId") ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE "StockTransaction" VALIDATE CONSTRAINT "StockTransaction_projectId_orgId_fkey";
