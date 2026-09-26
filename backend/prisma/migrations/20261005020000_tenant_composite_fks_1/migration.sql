-- Enterprise programme, step M7 — composite tenant foreign keys, batch 1 of 7 (wave ENT-3).
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

-- ProjectAssignment, InvitationToken, Task, TaskComment, TaskAttachment, TaskHistory, Meeting, MeetingAttendee, MeetingAgendaItem, MeetingDecision, MeetingActionItem, MeetingDistribution, MeetingComment, ProjectDocument
DO $$
DECLARE
  t record;
  old_name text;
  new_name text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('ProjectAssignment', 'RESTRICT', 'CASCADE'),
    ('InvitationToken', 'CASCADE', 'CASCADE'),
    ('Task', 'CASCADE', 'CASCADE'),
    ('TaskComment', 'CASCADE', 'CASCADE'),
    ('TaskAttachment', 'CASCADE', 'CASCADE'),
    ('TaskHistory', 'CASCADE', 'CASCADE'),
    ('Meeting', 'CASCADE', 'CASCADE'),
    ('MeetingAttendee', 'CASCADE', 'CASCADE'),
    ('MeetingAgendaItem', 'CASCADE', 'CASCADE'),
    ('MeetingDecision', 'CASCADE', 'CASCADE'),
    ('MeetingActionItem', 'CASCADE', 'CASCADE'),
    ('MeetingDistribution', 'CASCADE', 'CASCADE'),
    ('MeetingComment', 'CASCADE', 'CASCADE'),
    ('ProjectDocument', 'RESTRICT', 'CASCADE')
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

ALTER TABLE "ProjectAssignment" VALIDATE CONSTRAINT "ProjectAssignment_projectId_orgId_fkey";
ALTER TABLE "InvitationToken" VALIDATE CONSTRAINT "InvitationToken_projectId_orgId_fkey";
ALTER TABLE "Task" VALIDATE CONSTRAINT "Task_projectId_orgId_fkey";
ALTER TABLE "TaskComment" VALIDATE CONSTRAINT "TaskComment_projectId_orgId_fkey";
ALTER TABLE "TaskAttachment" VALIDATE CONSTRAINT "TaskAttachment_projectId_orgId_fkey";
ALTER TABLE "TaskHistory" VALIDATE CONSTRAINT "TaskHistory_projectId_orgId_fkey";
ALTER TABLE "Meeting" VALIDATE CONSTRAINT "Meeting_projectId_orgId_fkey";
ALTER TABLE "MeetingAttendee" VALIDATE CONSTRAINT "MeetingAttendee_projectId_orgId_fkey";
ALTER TABLE "MeetingAgendaItem" VALIDATE CONSTRAINT "MeetingAgendaItem_projectId_orgId_fkey";
ALTER TABLE "MeetingDecision" VALIDATE CONSTRAINT "MeetingDecision_projectId_orgId_fkey";
ALTER TABLE "MeetingActionItem" VALIDATE CONSTRAINT "MeetingActionItem_projectId_orgId_fkey";
ALTER TABLE "MeetingDistribution" VALIDATE CONSTRAINT "MeetingDistribution_projectId_orgId_fkey";
ALTER TABLE "MeetingComment" VALIDATE CONSTRAINT "MeetingComment_projectId_orgId_fkey";
ALTER TABLE "ProjectDocument" VALIDATE CONSTRAINT "ProjectDocument_projectId_orgId_fkey";
