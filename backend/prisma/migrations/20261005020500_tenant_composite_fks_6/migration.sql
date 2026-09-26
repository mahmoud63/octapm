-- Enterprise programme, step M7 — composite tenant foreign keys, batch 6 of 7 (wave ENT-3).
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

-- FormInstance, Signature, SubmittalPackage, SubmittalWorkflowTemplate, DailyLog, DailyLogManpower, DailyLogEquipment, DailyLogDelivery, DailyLogVisitor, DailyLogDelay, DailyLogNote, ReportDefinition, GanttLayout, ProjectHealthSnapshot
DO $$
DECLARE
  t record;
  old_name text;
  new_name text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('FormInstance', 'CASCADE', 'CASCADE'),
    ('Signature', 'CASCADE', 'CASCADE'),
    ('SubmittalPackage', 'CASCADE', 'CASCADE'),
    ('SubmittalWorkflowTemplate', 'CASCADE', 'CASCADE'),
    ('DailyLog', 'CASCADE', 'CASCADE'),
    ('DailyLogManpower', 'CASCADE', 'CASCADE'),
    ('DailyLogEquipment', 'CASCADE', 'CASCADE'),
    ('DailyLogDelivery', 'CASCADE', 'CASCADE'),
    ('DailyLogVisitor', 'CASCADE', 'CASCADE'),
    ('DailyLogDelay', 'CASCADE', 'CASCADE'),
    ('DailyLogNote', 'CASCADE', 'CASCADE'),
    ('ReportDefinition', 'CASCADE', 'CASCADE'),
    ('GanttLayout', 'CASCADE', 'CASCADE'),
    ('ProjectHealthSnapshot', 'CASCADE', 'CASCADE')
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

ALTER TABLE "FormInstance" VALIDATE CONSTRAINT "FormInstance_projectId_orgId_fkey";
ALTER TABLE "Signature" VALIDATE CONSTRAINT "Signature_projectId_orgId_fkey";
ALTER TABLE "SubmittalPackage" VALIDATE CONSTRAINT "SubmittalPackage_projectId_orgId_fkey";
ALTER TABLE "SubmittalWorkflowTemplate" VALIDATE CONSTRAINT "SubmittalWorkflowTemplate_projectId_orgId_fkey";
ALTER TABLE "DailyLog" VALIDATE CONSTRAINT "DailyLog_projectId_orgId_fkey";
ALTER TABLE "DailyLogManpower" VALIDATE CONSTRAINT "DailyLogManpower_projectId_orgId_fkey";
ALTER TABLE "DailyLogEquipment" VALIDATE CONSTRAINT "DailyLogEquipment_projectId_orgId_fkey";
ALTER TABLE "DailyLogDelivery" VALIDATE CONSTRAINT "DailyLogDelivery_projectId_orgId_fkey";
ALTER TABLE "DailyLogVisitor" VALIDATE CONSTRAINT "DailyLogVisitor_projectId_orgId_fkey";
ALTER TABLE "DailyLogDelay" VALIDATE CONSTRAINT "DailyLogDelay_projectId_orgId_fkey";
ALTER TABLE "DailyLogNote" VALIDATE CONSTRAINT "DailyLogNote_projectId_orgId_fkey";
ALTER TABLE "ReportDefinition" VALIDATE CONSTRAINT "ReportDefinition_projectId_orgId_fkey";
ALTER TABLE "GanttLayout" VALIDATE CONSTRAINT "GanttLayout_projectId_orgId_fkey";
ALTER TABLE "ProjectHealthSnapshot" VALIDATE CONSTRAINT "ProjectHealthSnapshot_projectId_orgId_fkey";

-- Signature, DailyLogManpower, DailyLogEquipment, DailyLogDelivery, DailyLogVisitor, DailyLogDelay, DailyLogNote: no relation to Organisation either (the matrix's
-- relation-less tables); the org-side key is added the same way.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Signature', 'DailyLogManpower', 'DailyLogEquipment', 'DailyLogDelivery', 'DailyLogVisitor', 'DailyLogDelay', 'DailyLogNote'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('%I', t)::regclass AND conname = t || '_orgId_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID', t, t || '_orgId_fkey');
    END IF;
  END LOOP;
END $$;

ALTER TABLE "Signature" VALIDATE CONSTRAINT "Signature_orgId_fkey";
ALTER TABLE "DailyLogManpower" VALIDATE CONSTRAINT "DailyLogManpower_orgId_fkey";
ALTER TABLE "DailyLogEquipment" VALIDATE CONSTRAINT "DailyLogEquipment_orgId_fkey";
ALTER TABLE "DailyLogDelivery" VALIDATE CONSTRAINT "DailyLogDelivery_orgId_fkey";
ALTER TABLE "DailyLogVisitor" VALIDATE CONSTRAINT "DailyLogVisitor_orgId_fkey";
ALTER TABLE "DailyLogDelay" VALIDATE CONSTRAINT "DailyLogDelay_orgId_fkey";
ALTER TABLE "DailyLogNote" VALIDATE CONSTRAINT "DailyLogNote_orgId_fkey";

-- ProjectHealthSnapshot.projectId is unique on its own; Prisma asks for the pair on a one-to-one composite relation.
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectHealthSnapshot_projectId_orgId_key" ON "ProjectHealthSnapshot"("projectId", "orgId");
