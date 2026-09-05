-- OCTA-DATA-REFS-004: user / company references replace free-text accountability.
-- Adds ownerUserId, reviewerUserId, approverUserId, assigneeUserId,
-- assigneeCompanyId and ballInCourtUserId to every workflow record, backfills
-- them from the legacy text columns by exact (case-insensitive) email or name
-- match within the organisation, and keeps the text columns for one release.

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'Risk', 'NcrRecord', 'ItpRecord', 'DefectRecord', 'SafetyIncident', 'MaterialTest',
    'Rfi', 'Submittal', 'DrawingRecord', 'Transmittal', 'Correspondence'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "ownerUserId" TEXT', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN "reviewerUserId" TEXT', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN "approverUserId" TEXT', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN "assigneeUserId" TEXT', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN "assigneeCompanyId" TEXT', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN "ballInCourtUserId" TEXT', tbl);

    EXECUTE format('CREATE INDEX %I ON %I ("ownerUserId")', tbl || '_ownerUserId_idx', tbl);
    EXECUTE format('CREATE INDEX %I ON %I ("reviewerUserId")', tbl || '_reviewerUserId_idx', tbl);
    EXECUTE format('CREATE INDEX %I ON %I ("approverUserId")', tbl || '_approverUserId_idx', tbl);
    EXECUTE format('CREATE INDEX %I ON %I ("assigneeUserId")', tbl || '_assigneeUserId_idx', tbl);
    EXECUTE format('CREATE INDEX %I ON %I ("ballInCourtUserId")', tbl || '_ballInCourtUserId_idx', tbl);
    EXECUTE format('CREATE INDEX %I ON %I ("assigneeCompanyId")', tbl || '_assigneeCompanyId_idx', tbl);

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE',
      tbl, tbl || '_ownerUserId_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE',
      tbl, tbl || '_reviewerUserId_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE',
      tbl, tbl || '_approverUserId_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE',
      tbl, tbl || '_assigneeUserId_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("ballInCourtUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE',
      tbl, tbl || '_ballInCourtUserId_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("assigneeCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE',
      tbl, tbl || '_assigneeCompanyId_fkey');
  END LOOP;
END $$;

-- Backfill user references: a text value resolves only when exactly one active
-- user in the same organisation matches it by email or by name.
DO $$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('Risk', 'owner', 'ownerUserId'),
      ('NcrRecord', 'owner', 'ownerUserId'), ('NcrRecord', 'reviewer', 'reviewerUserId'), ('NcrRecord', 'approver', 'approverUserId'), ('NcrRecord', 'responsible', 'assigneeUserId'),
      ('ItpRecord', 'owner', 'ownerUserId'), ('ItpRecord', 'reviewer', 'reviewerUserId'), ('ItpRecord', 'approver', 'approverUserId'), ('ItpRecord', 'inspector', 'assigneeUserId'),
      ('DefectRecord', 'owner', 'ownerUserId'), ('DefectRecord', 'reviewer', 'reviewerUserId'), ('DefectRecord', 'approver', 'approverUserId'), ('DefectRecord', 'assignee', 'assigneeUserId'),
      ('SafetyIncident', 'owner', 'ownerUserId'), ('SafetyIncident', 'reviewer', 'reviewerUserId'), ('SafetyIncident', 'approver', 'approverUserId'), ('SafetyIncident', 'responsible', 'assigneeUserId'),
      ('MaterialTest', 'owner', 'ownerUserId'), ('MaterialTest', 'reviewer', 'reviewerUserId'), ('MaterialTest', 'approver', 'approverUserId'),
      ('Rfi', 'owner', 'ownerUserId'), ('Rfi', 'reviewer', 'reviewerUserId'), ('Rfi', 'approver', 'approverUserId'),
      ('Submittal', 'owner', 'ownerUserId'), ('Submittal', 'reviewer', 'reviewerUserId'), ('Submittal', 'approver', 'approverUserId'),
      ('DrawingRecord', 'owner', 'ownerUserId'), ('DrawingRecord', 'reviewer', 'reviewerUserId'), ('DrawingRecord', 'approver', 'approverUserId'),
      ('Transmittal', 'owner', 'ownerUserId'), ('Transmittal', 'reviewer', 'reviewerUserId'), ('Transmittal', 'approver', 'approverUserId'),
      ('Correspondence', 'owner', 'ownerUserId'), ('Correspondence', 'reviewer', 'reviewerUserId'), ('Correspondence', 'approver', 'approverUserId')
    ) AS t(tbl, src, dst)
  LOOP
    EXECUTE format($f$
      UPDATE %1$I r SET %3$I = m.user_id
      FROM (
        SELECT r2.id AS record_id,
               (SELECT min(u.id) FROM "User" u
                 WHERE u."orgId" = p."orgId"
                   AND u.status = 'active'
                   AND (lower(u.email) = lower(btrim(r2.%2$I)) OR lower(u.name) = lower(btrim(r2.%2$I)))
                 HAVING count(*) = 1) AS user_id
        FROM %1$I r2
        JOIN "Project" p ON p.id = r2."projectId"
        WHERE r2.%2$I IS NOT NULL AND btrim(r2.%2$I) <> '' AND r2.%3$I IS NULL
      ) m
      WHERE r.id = m.record_id AND m.user_id IS NOT NULL
    $f$, spec.tbl, spec.src, spec.dst);
  END LOOP;
END $$;

-- Backfill company references: routed parties on RFIs/submittals, then exact
-- company-name matches on the assignee/responsible/owner text.
UPDATE "Rfi" r SET "assigneeCompanyId" = pp."companyId"
FROM "ProjectParty" pp
WHERE pp.id = COALESCE(r."reviewerPartyId", r."ownerPartyId") AND r."assigneeCompanyId" IS NULL;

UPDATE "Submittal" s SET "assigneeCompanyId" = pp."companyId"
FROM "ProjectParty" pp
WHERE pp.id = COALESCE(s."reviewerPartyId", s."ownerPartyId") AND s."assigneeCompanyId" IS NULL;

DO $$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('NcrRecord', 'responsible'), ('DefectRecord', 'assignee'), ('SafetyIncident', 'responsible'),
      ('Risk', 'owner'), ('ItpRecord', 'owner'), ('MaterialTest', 'owner'),
      ('Rfi', 'owner'), ('Submittal', 'owner'), ('DrawingRecord', 'owner'),
      ('Transmittal', 'owner'), ('Correspondence', 'owner')
    ) AS t(tbl, src)
  LOOP
    EXECUTE format($f$
      UPDATE %1$I r SET "assigneeCompanyId" = m.company_id
      FROM (
        SELECT r2.id AS record_id,
               (SELECT min(c.id) FROM "Company" c
                 WHERE c."orgId" = p."orgId"
                   AND lower(c.name) = lower(btrim(r2.%2$I))
                 HAVING count(*) = 1) AS company_id
        FROM %1$I r2
        JOIN "Project" p ON p.id = r2."projectId"
        WHERE r2.%2$I IS NOT NULL AND btrim(r2.%2$I) <> '' AND r2."assigneeCompanyId" IS NULL
      ) m
      WHERE r.id = m.record_id AND m.company_id IS NOT NULL
    $f$, spec.tbl, spec.src);
  END LOOP;
END $$;

-- Ball in court: whoever must act next on records that are still open.
DO $$
DECLARE
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('Risk', 'status', ARRAY['closed', 'archived']),
      ('NcrRecord', 'status', ARRAY['closed']),
      ('ItpRecord', 'status', ARRAY['passed', 'waived']),
      ('DefectRecord', 'status', ARRAY['closed']),
      ('SafetyIncident', 'status', ARRAY['closed', 'archived']),
      ('MaterialTest', 'result', ARRAY['pass']),
      ('Rfi', 'status', ARRAY['closed', 'archived']),
      ('Submittal', 'status', ARRAY['approved', 'archived']),
      ('DrawingRecord', 'status', ARRAY['superseded', 'cancelled']),
      ('Transmittal', 'status', ARRAY['acknowledged']),
      ('Correspondence', 'status', ARRAY['closed'])
    ) AS t(tbl, status_col, closed_values)
  LOOP
    EXECUTE format($f$
      UPDATE %1$I SET "ballInCourtUserId" = COALESCE("reviewerUserId", "approverUserId", "assigneeUserId", "ownerUserId")
      WHERE "ballInCourtUserId" IS NULL
        AND NOT (lower(%2$I) = ANY ($1))
    $f$, spec.tbl, spec.status_col) USING spec.closed_values;
  END LOOP;
END $$;
