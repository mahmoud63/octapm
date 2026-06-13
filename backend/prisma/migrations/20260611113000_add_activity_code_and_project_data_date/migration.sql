-- Promote activity identity and reporting data date to first-class fields.
-- activityCode is the Primavera-style Activity ID. wbsCode remains WBS only.

ALTER TABLE "Project"
  ADD COLUMN "dataDate" TIMESTAMP(3);

ALTER TABLE "Activity"
  ADD COLUMN "activityCode" TEXT;

-- Prefer accepted BOQ suggestion codes when a suggestion was accepted into an
-- official activity. These codes were the original generated activity IDs.
WITH accepted_boq_codes AS (
  SELECT
    "acceptedActivityId" AS "activityId",
    "activityCode",
    ROW_NUMBER() OVER (
      PARTITION BY "acceptedActivityId"
      ORDER BY "acceptedAt" DESC NULLS LAST, "updatedAt" DESC, "id" DESC
    ) AS rn
  FROM "BoqActivity"
  WHERE "acceptedActivityId" IS NOT NULL
    AND "status" = 'accepted'
    AND NULLIF(BTRIM("activityCode"), '') IS NOT NULL
)
UPDATE "Activity" activity
SET "activityCode" = accepted."activityCode"
FROM accepted_boq_codes accepted
WHERE activity."id" = accepted."activityId"
  AND accepted.rn = 1
  AND activity."activityCode" IS NULL;

-- Some existing official BOQ-created activities stored the generated Activity
-- ID in wbsCode. Only backfill from wbsCode when that value is unique among
-- active activities in the project so true WBS grouping codes are not promoted.
WITH unique_active_wbs_codes AS (
  SELECT "projectId", "wbsCode"
  FROM "Activity"
  WHERE "isActive" = true
    AND NULLIF(BTRIM("wbsCode"), '') IS NOT NULL
  GROUP BY "projectId", "wbsCode"
  HAVING COUNT(*) = 1
)
UPDATE "Activity" activity
SET "activityCode" = activity."wbsCode"
FROM unique_active_wbs_codes unique_wbs
WHERE activity."projectId" = unique_wbs."projectId"
  AND activity."wbsCode" = unique_wbs."wbsCode"
  AND activity."activityCode" IS NULL;

DO $$
DECLARE
  duplicate_code_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO duplicate_code_count
    FROM (
      SELECT "projectId", "activityCode"
      FROM "Activity"
      WHERE "isActive" = true
        AND "activityCode" IS NOT NULL
      GROUP BY "projectId", "activityCode"
      HAVING COUNT(*) > 1
    ) duplicates;

  IF duplicate_code_count > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce Activity activityCode uniqueness: % duplicate active project/activityCode pair(s) exist',
      duplicate_code_count
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Project_dataDate_idx"
ON "Project"("dataDate");

CREATE INDEX IF NOT EXISTS "Activity_projectId_activityCode_idx"
ON "Activity"("projectId", "activityCode");

-- Prisma cannot represent this partial unique index in schema.prisma.
CREATE UNIQUE INDEX IF NOT EXISTS "Activity_projectId_active_activityCode_key"
ON "Activity"("projectId", "activityCode")
WHERE "isActive" = true AND "activityCode" IS NOT NULL;
