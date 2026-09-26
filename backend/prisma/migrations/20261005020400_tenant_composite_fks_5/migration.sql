-- Enterprise programme, step M7 — composite tenant foreign keys, batch 5 of 7 (wave ENT-3).
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

-- Timesheet, TimeEntry, ChangeEvent, ChangeEventLine, Rfq, DirectCost, DirectCostLine, DirectCostPayment, DocumentText, DocumentChunk, Comment, RecordSubscription, ProjectUserPermission, FormTemplate
DO $$
DECLARE
  t record;
  old_name text;
  new_name text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('Timesheet', 'CASCADE', 'CASCADE'),
    ('TimeEntry', 'CASCADE', 'CASCADE'),
    ('ChangeEvent', 'CASCADE', 'CASCADE'),
    ('ChangeEventLine', 'CASCADE', 'CASCADE'),
    ('Rfq', 'CASCADE', 'CASCADE'),
    ('DirectCost', 'CASCADE', 'CASCADE'),
    ('DirectCostLine', 'CASCADE', 'CASCADE'),
    ('DirectCostPayment', 'CASCADE', 'CASCADE'),
    ('DocumentText', 'CASCADE', 'CASCADE'),
    ('DocumentChunk', 'CASCADE', 'CASCADE'),
    ('Comment', 'CASCADE', 'CASCADE'),
    ('RecordSubscription', 'CASCADE', 'CASCADE'),
    ('ProjectUserPermission', 'CASCADE', 'CASCADE'),
    ('FormTemplate', 'CASCADE', 'CASCADE')
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

ALTER TABLE "Timesheet" VALIDATE CONSTRAINT "Timesheet_projectId_orgId_fkey";
ALTER TABLE "TimeEntry" VALIDATE CONSTRAINT "TimeEntry_projectId_orgId_fkey";
ALTER TABLE "ChangeEvent" VALIDATE CONSTRAINT "ChangeEvent_projectId_orgId_fkey";
ALTER TABLE "ChangeEventLine" VALIDATE CONSTRAINT "ChangeEventLine_projectId_orgId_fkey";
ALTER TABLE "Rfq" VALIDATE CONSTRAINT "Rfq_projectId_orgId_fkey";
ALTER TABLE "DirectCost" VALIDATE CONSTRAINT "DirectCost_projectId_orgId_fkey";
ALTER TABLE "DirectCostLine" VALIDATE CONSTRAINT "DirectCostLine_projectId_orgId_fkey";
ALTER TABLE "DirectCostPayment" VALIDATE CONSTRAINT "DirectCostPayment_projectId_orgId_fkey";
ALTER TABLE "DocumentText" VALIDATE CONSTRAINT "DocumentText_projectId_orgId_fkey";
ALTER TABLE "DocumentChunk" VALIDATE CONSTRAINT "DocumentChunk_projectId_orgId_fkey";
ALTER TABLE "Comment" VALIDATE CONSTRAINT "Comment_projectId_orgId_fkey";
ALTER TABLE "RecordSubscription" VALIDATE CONSTRAINT "RecordSubscription_projectId_orgId_fkey";
ALTER TABLE "ProjectUserPermission" VALIDATE CONSTRAINT "ProjectUserPermission_projectId_orgId_fkey";
ALTER TABLE "FormTemplate" VALIDATE CONSTRAINT "FormTemplate_projectId_orgId_fkey";
