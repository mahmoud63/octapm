-- Enterprise programme, step M7 — keys to the organisation masters and to the membership (wave ENT-3).
--
-- 1. (costCodeId, orgId) → CostCode(id, orgId) on the six project tables that
--    name a cost code, replacing the single-column key with the same action.
--    Where that action was SET NULL, only costCodeId is nulled (the column
--    list form, PostgreSQL 15+): orgId is NOT NULL and must stay.
-- 2. ProjectAssignment.orgId becomes NOT NULL. The rows still NULL are filled
--    from their project (the M3 rule, idempotent). A BEFORE trigger fills the
--    column from the project whenever a writer leaves it out, because clients
--    built before this migration (the API of the previous release, the seed)
--    still insert assignments without it and must not start failing on a
--    column they never knew. The trigger is a bridge, not a rule: services
--    write the column themselves.
-- 3. (orgId, userId) → OrganizationMembership(orgId, userId) on
--    ProjectAssignment and ProjectUserPermission: an assignment or a
--    permission can only name a person who belongs to the project's
--    organisation. NO ACTION, checked at the end of the statement, so an
--    organisation's cascade can remove the projects and the memberships in
--    whichever order PostgreSQL walks them. validate-composite-fks.js found 0
--    assignments and 0 permissions without a membership.

-- 1. cost code masters
DO $$
DECLARE
  t record;
  old_name text;
  new_name text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('BudgetLine', 'RESTRICT', 'CASCADE'),
    ('ProjectCostCode', 'CASCADE', 'CASCADE'),
    ('CommitmentSovLine', 'SET NULL ("costCodeId")', 'CASCADE'),
    ('TimeEntry', 'SET NULL ("costCodeId")', 'CASCADE'),
    ('ChangeEventLine', 'SET NULL ("costCodeId")', 'CASCADE'),
    ('DirectCostLine', 'SET NULL ("costCodeId")', 'CASCADE')
  ) AS v(table_name, on_delete, on_update) LOOP
    new_name := t.table_name || '_costCodeId_orgId_fkey';
    SELECT c.conname INTO old_name FROM pg_constraint c
     WHERE c.conrelid = format('%I', t.table_name)::regclass AND c.contype = 'f'
       AND c.confrelid = '"CostCode"'::regclass AND c.conname <> new_name
       AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = format('%I', t.table_name)::regclass AND a.attname = 'costCodeId')];
    IF old_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t.table_name, old_name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('%I', t.table_name)::regclass AND conname = new_name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("costCodeId", "orgId") REFERENCES "CostCode"("id", "orgId") ON DELETE %s ON UPDATE %s NOT VALID',
                     t.table_name, new_name, t.on_delete, t.on_update);
    END IF;
  END LOOP;
END $$;

ALTER TABLE "BudgetLine" VALIDATE CONSTRAINT "BudgetLine_costCodeId_orgId_fkey";
ALTER TABLE "ProjectCostCode" VALIDATE CONSTRAINT "ProjectCostCode_costCodeId_orgId_fkey";
ALTER TABLE "CommitmentSovLine" VALIDATE CONSTRAINT "CommitmentSovLine_costCodeId_orgId_fkey";
ALTER TABLE "TimeEntry" VALIDATE CONSTRAINT "TimeEntry_costCodeId_orgId_fkey";
ALTER TABLE "ChangeEventLine" VALIDATE CONSTRAINT "ChangeEventLine_costCodeId_orgId_fkey";
ALTER TABLE "DirectCostLine" VALIDATE CONSTRAINT "DirectCostLine_costCodeId_orgId_fkey";

-- 2. ProjectAssignment.orgId
UPDATE "ProjectAssignment" pa SET "orgId" = p."orgId"
FROM "Project" p WHERE p."id" = pa."projectId" AND pa."orgId" IS NULL;

CREATE OR REPLACE FUNCTION "octapm_project_assignment_org"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."orgId" IS NULL THEN
    SELECT p."orgId" INTO NEW."orgId" FROM "Project" p WHERE p."id" = NEW."projectId";
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "ProjectAssignment_org_fill" ON "ProjectAssignment";
CREATE TRIGGER "ProjectAssignment_org_fill"
  BEFORE INSERT OR UPDATE OF "orgId", "projectId" ON "ProjectAssignment"
  FOR EACH ROW EXECUTE FUNCTION "octapm_project_assignment_org"();

ALTER TABLE "ProjectAssignment" ALTER COLUMN "orgId" SET NOT NULL;

-- 3. memberships
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ProjectAssignment', 'ProjectUserPermission'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('%I', t)::regclass AND conname = t || '_orgId_userId_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("orgId", "userId") REFERENCES "OrganizationMembership"("orgId", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID', t, t || '_orgId_userId_fkey');
    END IF;
  END LOOP;
END $$;

ALTER TABLE "ProjectAssignment" VALIDATE CONSTRAINT "ProjectAssignment_orgId_userId_fkey";
ALTER TABLE "ProjectUserPermission" VALIDATE CONSTRAINT "ProjectUserPermission_orgId_userId_fkey";
