-- TASK-P1-domain-improve-change-order-and-eot-impact-model
-- Harden commercial change order and EOT impact proof.
-- Pre-deploy checklist:
--   1. Take a PostgreSQL backup/snapshot before applying.
--   2. Dry-run on a staging clone and compare existing commercial link counts
--      before/after migration.
--   3. Confirm ProjectDocument links resolve only clean project-scoped documents.

ALTER TABLE "ChangeOrderActivityLink"
  ADD COLUMN "criticalPathImpactDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "costImpact" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "approvedScheduleImpactDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "approvedCostImpact" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "baselineStart" TIMESTAMP(3),
  ADD COLUMN "baselineFinish" TIMESTAMP(3),
  ADD COLUMN "impactedStart" TIMESTAMP(3),
  ADD COLUMN "impactedFinish" TIMESTAMP(3),
  ADD COLUMN "impactBasis" TEXT,
  ADD COLUMN "cpmSnapshotJson" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "EotClaimActivityLink"
  ADD COLUMN "approvedEotDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ldExposure" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "baselineStart" TIMESTAMP(3),
  ADD COLUMN "baselineFinish" TIMESTAMP(3),
  ADD COLUMN "impactedStart" TIMESTAMP(3),
  ADD COLUMN "impactedFinish" TIMESTAMP(3),
  ADD COLUMN "impactBasis" TEXT;

ALTER TABLE "CommercialAttachmentRef"
  ADD COLUMN "documentId" TEXT,
  ADD COLUMN "sizeBytes" INTEGER,
  ADD COLUMN "sha256" TEXT,
  ADD COLUMN "scanStatus" TEXT;

CREATE INDEX "CommercialAttachmentRef_documentId_idx"
  ON "CommercialAttachmentRef"("documentId");

ALTER TABLE "CommercialAttachmentRef"
  ADD CONSTRAINT "CommercialAttachmentRef_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "ChangeOrderActivityLink" link
SET
  "criticalPathImpactDays" = GREATEST(
    0,
    COALESCE(link."scheduleImpactDays", 0) - GREATEST(0, COALESCE(link."floatImpactDays", activity."totalFloat", 0))
  ),
  "costImpact" = COALESCE(allocations."amount", 0),
  "cpmSnapshotJson" = jsonb_build_object(
    'totalFloat', activity."totalFloat",
    'isCritical', activity."isCritical",
    'scheduleImpactDays', link."scheduleImpactDays",
    'floatImpactDays', link."floatImpactDays",
    'criticalPathImpact', link."criticalPathImpact",
    'criticalPathImpactDays', GREATEST(
      0,
      COALESCE(link."scheduleImpactDays", 0) - GREATEST(0, COALESCE(link."floatImpactDays", activity."totalFloat", 0))
    ),
    'costImpact', COALESCE(allocations."amount", 0),
    'backfill', true
  )
FROM "Activity" activity
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(coa."amount"), 0) AS "amount"
  FROM "ChangeOrderAllocationLink" coa
  WHERE coa."projectId" = link."projectId"
    AND coa."changeOrderId" = link."changeOrderId"
) allocations ON true
WHERE activity."id" = link."activityId"
  AND activity."projectId" = link."projectId";

UPDATE "EotClaimActivityLink" link
SET
  "approvedEotDays" = COALESCE(claim."eotDaysGranted", 0),
  "ldExposure" = GREATEST(
    0,
    COALESCE(link."criticalPathImpactDays", 0) - COALESCE(claim."eotDaysGranted", 0)
  ) * COALESCE(claim."ldRatePerDay", 0),
  "cpmSnapshotJson" = COALESCE(link."cpmSnapshotJson", '{}'::jsonb) || jsonb_build_object(
    'approvedEotDays', COALESCE(claim."eotDaysGranted", 0),
    'ldExposure', GREATEST(
      0,
      COALESCE(link."criticalPathImpactDays", 0) - COALESCE(claim."eotDaysGranted", 0)
    ) * COALESCE(claim."ldRatePerDay", 0),
    'backfill', true
  )
FROM "EotClaim" claim
WHERE claim."id" = link."eotClaimId"
  AND claim."projectId" = link."projectId";
