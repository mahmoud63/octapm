-- Lock the official BOQ-to-Activity allocation spine.
-- Prisma cannot represent partial unique indexes in schema.prisma, so the
-- active-pair invariant is enforced here while inactive/rejected history
-- remains available for audit traceability.

DO $$
DECLARE
  duplicate_pair_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO duplicate_pair_count
    FROM (
      SELECT "projectId", "boqItemId", "activityId"
        FROM "ActivityBoqAllocation"
       WHERE "isActive" = true
       GROUP BY "projectId", "boqItemId", "activityId"
      HAVING COUNT(*) > 1
    ) duplicates;

  IF duplicate_pair_count > 0 THEN
    RAISE EXCEPTION
      'Cannot lock ActivityBoqAllocation active pairs: % duplicate active BOQ/activity pair(s) exist',
      duplicate_pair_count
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ActivityBoqAllocation_active_pair_key"
ON "ActivityBoqAllocation"("projectId", "boqItemId", "activityId")
WHERE "isActive" = true;
