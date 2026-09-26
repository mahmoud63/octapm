-- Enterprise programme, step M7 — composite tenant foreign keys, batch 7 of 7 (wave ENT-3).
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

-- WorkflowTemplate, WorkflowInstance, WorkflowStepAssignment, CustomFieldDefinition, ProjectFieldset, CustomFieldValue, WebhookSubscription, AccountingSync, BidPackage, AssistantConversation, ContractProfile, SubcontractorEvaluation, CostLedgerEntry
DO $$
DECLARE
  t record;
  old_name text;
  new_name text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('WorkflowTemplate', 'CASCADE', 'CASCADE'),
    ('WorkflowInstance', 'CASCADE', 'CASCADE'),
    ('WorkflowStepAssignment', 'CASCADE', 'CASCADE'),
    ('CustomFieldDefinition', 'CASCADE', 'CASCADE'),
    ('ProjectFieldset', 'CASCADE', 'CASCADE'),
    ('CustomFieldValue', 'CASCADE', 'CASCADE'),
    ('WebhookSubscription', 'CASCADE', 'CASCADE'),
    ('AccountingSync', 'CASCADE', 'CASCADE'),
    ('BidPackage', 'CASCADE', 'CASCADE'),
    ('AssistantConversation', 'CASCADE', 'CASCADE'),
    ('ContractProfile', 'CASCADE', 'CASCADE'),
    ('SubcontractorEvaluation', 'CASCADE', 'CASCADE'),
    ('CostLedgerEntry', 'CASCADE', 'CASCADE')
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

ALTER TABLE "WorkflowTemplate" VALIDATE CONSTRAINT "WorkflowTemplate_projectId_orgId_fkey";
ALTER TABLE "WorkflowInstance" VALIDATE CONSTRAINT "WorkflowInstance_projectId_orgId_fkey";
ALTER TABLE "WorkflowStepAssignment" VALIDATE CONSTRAINT "WorkflowStepAssignment_projectId_orgId_fkey";
ALTER TABLE "CustomFieldDefinition" VALIDATE CONSTRAINT "CustomFieldDefinition_projectId_orgId_fkey";
ALTER TABLE "ProjectFieldset" VALIDATE CONSTRAINT "ProjectFieldset_projectId_orgId_fkey";
ALTER TABLE "CustomFieldValue" VALIDATE CONSTRAINT "CustomFieldValue_projectId_orgId_fkey";
ALTER TABLE "WebhookSubscription" VALIDATE CONSTRAINT "WebhookSubscription_projectId_orgId_fkey";
ALTER TABLE "AccountingSync" VALIDATE CONSTRAINT "AccountingSync_projectId_orgId_fkey";
ALTER TABLE "BidPackage" VALIDATE CONSTRAINT "BidPackage_projectId_orgId_fkey";
ALTER TABLE "AssistantConversation" VALIDATE CONSTRAINT "AssistantConversation_projectId_orgId_fkey";
ALTER TABLE "ContractProfile" VALIDATE CONSTRAINT "ContractProfile_projectId_orgId_fkey";
ALTER TABLE "SubcontractorEvaluation" VALIDATE CONSTRAINT "SubcontractorEvaluation_projectId_orgId_fkey";
ALTER TABLE "CostLedgerEntry" VALIDATE CONSTRAINT "CostLedgerEntry_projectId_orgId_fkey";

-- ContractProfile.projectId is unique on its own; Prisma asks for the pair on a one-to-one composite relation.
CREATE UNIQUE INDEX IF NOT EXISTS "ContractProfile_projectId_orgId_key" ON "ContractProfile"("projectId", "orgId");
