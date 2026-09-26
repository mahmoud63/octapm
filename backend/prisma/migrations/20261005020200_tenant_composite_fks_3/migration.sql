-- Enterprise programme, step M7 — composite tenant foreign keys, batch 3 of 7 (wave ENT-3).
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

-- CommitmentSovLine, CommitmentChangeOrder, ScopeMatrix, ScopeMatrixItem, SubcontractCloseout, CloseoutItem, SubPayApp, SubPayAppLine, SubPayAppPayment, Attachment, Photo, DrawingSet, Sheet, SheetRevision
DO $$
DECLARE
  t record;
  old_name text;
  new_name text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('CommitmentSovLine', 'CASCADE', 'CASCADE'),
    ('CommitmentChangeOrder', 'CASCADE', 'CASCADE'),
    ('ScopeMatrix', 'CASCADE', 'CASCADE'),
    ('ScopeMatrixItem', 'CASCADE', 'CASCADE'),
    ('SubcontractCloseout', 'CASCADE', 'CASCADE'),
    ('CloseoutItem', 'CASCADE', 'CASCADE'),
    ('SubPayApp', 'CASCADE', 'CASCADE'),
    ('SubPayAppLine', 'CASCADE', 'CASCADE'),
    ('SubPayAppPayment', 'CASCADE', 'CASCADE'),
    ('Attachment', 'CASCADE', 'CASCADE'),
    ('Photo', 'CASCADE', 'CASCADE'),
    ('DrawingSet', 'CASCADE', 'CASCADE'),
    ('Sheet', 'CASCADE', 'CASCADE'),
    ('SheetRevision', 'CASCADE', 'CASCADE')
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

ALTER TABLE "CommitmentSovLine" VALIDATE CONSTRAINT "CommitmentSovLine_projectId_orgId_fkey";
ALTER TABLE "CommitmentChangeOrder" VALIDATE CONSTRAINT "CommitmentChangeOrder_projectId_orgId_fkey";
ALTER TABLE "ScopeMatrix" VALIDATE CONSTRAINT "ScopeMatrix_projectId_orgId_fkey";
ALTER TABLE "ScopeMatrixItem" VALIDATE CONSTRAINT "ScopeMatrixItem_projectId_orgId_fkey";
ALTER TABLE "SubcontractCloseout" VALIDATE CONSTRAINT "SubcontractCloseout_projectId_orgId_fkey";
ALTER TABLE "CloseoutItem" VALIDATE CONSTRAINT "CloseoutItem_projectId_orgId_fkey";
ALTER TABLE "SubPayApp" VALIDATE CONSTRAINT "SubPayApp_projectId_orgId_fkey";
ALTER TABLE "SubPayAppLine" VALIDATE CONSTRAINT "SubPayAppLine_projectId_orgId_fkey";
ALTER TABLE "SubPayAppPayment" VALIDATE CONSTRAINT "SubPayAppPayment_projectId_orgId_fkey";
ALTER TABLE "Attachment" VALIDATE CONSTRAINT "Attachment_projectId_orgId_fkey";
ALTER TABLE "Photo" VALIDATE CONSTRAINT "Photo_projectId_orgId_fkey";
ALTER TABLE "DrawingSet" VALIDATE CONSTRAINT "DrawingSet_projectId_orgId_fkey";
ALTER TABLE "Sheet" VALIDATE CONSTRAINT "Sheet_projectId_orgId_fkey";
ALTER TABLE "SheetRevision" VALIDATE CONSTRAINT "SheetRevision_projectId_orgId_fkey";
