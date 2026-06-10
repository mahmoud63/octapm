-- Add an accounting cutoff date for cumulative activity actuals so official
-- earned-value AC can be evaluated by reporting period instead of edit time.

ALTER TABLE "CostRecord"
ADD COLUMN "actualThroughDate" TIMESTAMP(3);

UPDATE "CostRecord"
SET "actualThroughDate" = "updatedAt"
WHERE "actual" <> 0
  AND "actualThroughDate" IS NULL;

UPDATE "ActivityProgress"
SET "approvedAt" = "updatedAt"
WHERE "status" = 'approved'
  AND "approvedAt" IS NULL;

ALTER TABLE "EvPeriodSnapshot"
ALTER COLUMN "formulaVersion" SET DEFAULT 'ev.v2';

CREATE INDEX "CostRecord_projectId_actualThroughDate_idx"
ON "CostRecord"("projectId", "actualThroughDate");
