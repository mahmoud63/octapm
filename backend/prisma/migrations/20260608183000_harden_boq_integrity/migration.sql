DO $$
DECLARE
  duplicate_item TEXT;
  duplicate_activity TEXT;
BEGIN
  SELECT CONCAT('projectId=', "projectId", ', code=', "code", ', count=', COUNT(*))
    INTO duplicate_item
    FROM "BoqItem"
   WHERE "code" IS NOT NULL
   GROUP BY "projectId", "code"
  HAVING COUNT(*) > 1
   LIMIT 1;

  IF duplicate_item IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add BOQ item code uniqueness; duplicate exists: %', duplicate_item;
  END IF;

  SELECT CONCAT('projectId=', "projectId", ', activityCode=', "activityCode", ', count=', COUNT(*))
    INTO duplicate_activity
    FROM "BoqActivity"
   GROUP BY "projectId", "activityCode"
  HAVING COUNT(*) > 1
   LIMIT 1;

  IF duplicate_activity IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add BOQ activity code uniqueness; duplicate exists: %', duplicate_activity;
  END IF;
END $$;

DROP INDEX IF EXISTS "BoqActivity_projectId_activityCode_idx";

CREATE UNIQUE INDEX "BoqItem_projectId_code_key" ON "BoqItem"("projectId", "code");
CREATE UNIQUE INDEX "BoqActivity_projectId_activityCode_key" ON "BoqActivity"("projectId", "activityCode");
