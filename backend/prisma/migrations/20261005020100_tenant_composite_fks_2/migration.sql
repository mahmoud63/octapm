-- Enterprise programme, step M7 — composite tenant foreign keys, batch 2 of 7 (wave ENT-3).
--
-- Each table below carries both a projectId and an orgId. Until now only
-- projectId was a foreign key, so nothing in the database stopped a row from
-- naming a project of one organisation and the orgId of another. The
-- single-column key is replaced by (projectId, orgId) → Project(id, orgId)
-- (the unique pair ENT-1 added), keeping the same ON DELETE / ON UPDATE
-- action. A nullable projectId is skipped by MATCH SIMPLE, so the
-- "null = company-wide" tables get the same constraint.
--
-- No row is changed: scripts/enterprise/validate-composite-fks.js counted 0
-- mismatched and 0 orphaned rows per table before this batch was written.
-- The key is added NOT VALID and validated in a second step so the scan
-- takes a SHARE UPDATE EXCLUSIVE lock rather than blocking writers. The
-- block is idempotent: a re-run finds the composite key and adds nothing.

-- PrimeContract, PrimeContractAdvance, InventoryItem, Warehouse, StockTransaction, RfiResponse, ApprovalWorkflowEvent, Notification, Location, ProjectCostCode, BudgetLine, BudgetLineChange, BudgetSnapshot, Commitment
DO $$
DECLARE
  t record;
  old_name text;
  new_name text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('PrimeContract', 'CASCADE', 'CASCADE'),
    ('PrimeContractAdvance', 'CASCADE', 'CASCADE'),
    ('InventoryItem', 'CASCADE', 'CASCADE'),
    ('Warehouse', 'CASCADE', 'CASCADE'),
    ('StockTransaction', 'SET NULL', 'CASCADE'),
    ('RfiResponse', 'CASCADE', 'CASCADE'),
    ('ApprovalWorkflowEvent', 'RESTRICT', 'CASCADE'),
    ('Notification', 'CASCADE', 'CASCADE'),
    ('Location', 'CASCADE', 'CASCADE'),
    ('ProjectCostCode', 'CASCADE', 'CASCADE'),
    ('BudgetLine', 'CASCADE', 'CASCADE'),
    ('BudgetLineChange', 'CASCADE', 'CASCADE'),
    ('BudgetSnapshot', 'CASCADE', 'CASCADE'),
    ('Commitment', 'CASCADE', 'CASCADE')
  ) AS v(table_name, on_delete, on_update) LOOP
    new_name := t.table_name || '_projectId_orgId_fkey';
    -- The single-column key, by its columns rather than its name: some
    -- constraints in older databases carry a name Prisma would not choose.
    SELECT c.conname INTO old_name FROM pg_constraint c
     WHERE c.conrelid = format('%I', t.table_name)::regclass AND c.contype = 'f'
       AND c.confrelid = '"Project"'::regclass AND c.conname <> new_name
       AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = format('%I', t.table_name)::regclass AND a.attname = 'projectId')];
    IF old_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t.table_name, old_name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('%I', t.table_name)::regclass AND conname = new_name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE %s ON UPDATE %s NOT VALID',
                     t.table_name, new_name, t.on_delete, t.on_update);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "PrimeContract" VALIDATE CONSTRAINT "PrimeContract_projectId_orgId_fkey";
ALTER TABLE "PrimeContractAdvance" VALIDATE CONSTRAINT "PrimeContractAdvance_projectId_orgId_fkey";
ALTER TABLE "InventoryItem" VALIDATE CONSTRAINT "InventoryItem_projectId_orgId_fkey";
ALTER TABLE "Warehouse" VALIDATE CONSTRAINT "Warehouse_projectId_orgId_fkey";
ALTER TABLE "StockTransaction" VALIDATE CONSTRAINT "StockTransaction_projectId_orgId_fkey";
ALTER TABLE "RfiResponse" VALIDATE CONSTRAINT "RfiResponse_projectId_orgId_fkey";
ALTER TABLE "ApprovalWorkflowEvent" VALIDATE CONSTRAINT "ApprovalWorkflowEvent_projectId_orgId_fkey";
ALTER TABLE "Notification" VALIDATE CONSTRAINT "Notification_projectId_orgId_fkey";
ALTER TABLE "Location" VALIDATE CONSTRAINT "Location_projectId_orgId_fkey";
ALTER TABLE "ProjectCostCode" VALIDATE CONSTRAINT "ProjectCostCode_projectId_orgId_fkey";
ALTER TABLE "BudgetLine" VALIDATE CONSTRAINT "BudgetLine_projectId_orgId_fkey";
ALTER TABLE "BudgetLineChange" VALIDATE CONSTRAINT "BudgetLineChange_projectId_orgId_fkey";
ALTER TABLE "BudgetSnapshot" VALIDATE CONSTRAINT "BudgetSnapshot_projectId_orgId_fkey";
ALTER TABLE "Commitment" VALIDATE CONSTRAINT "Commitment_projectId_orgId_fkey";

-- RfiResponse: no relation to Organisation either (the matrix's
-- relation-less tables); the org-side key is added the same way.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['RfiResponse'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('%I', t)::regclass AND conname = t || '_orgId_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID', t, t || '_orgId_fkey');
    END IF;
  END LOOP;
END $$;

ALTER TABLE "RfiResponse" VALIDATE CONSTRAINT "RfiResponse_orgId_fkey";

-- PrimeContract.projectId is unique on its own; Prisma asks for the pair on a one-to-one composite relation.
CREATE UNIQUE INDEX IF NOT EXISTS "PrimeContract_projectId_orgId_key" ON "PrimeContract"("projectId", "orgId");
